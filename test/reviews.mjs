// Tests for review requests (kit only: the client sends), with fake storage and email.
// Run: node test/reviews.mjs
import vm from "node:vm";
import worker from "../src/worker.js";
import { templates, reviewLinkOk } from "../src/lib/reviews.js";
import { runClientReviews, saveClient, getClient } from "../src/ai.js";

let ok = true;
let count = 0;
const check = (cond, msg) => {
  count++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) ok = false;
};

// ---------- the wording ----------
const tpl = templates({ name: "Chairside" });
const all = tpl.map((t) => `${t.subject}\n${t.body}`).join("\n");
check(tpl.length === 3 && tpl.every((t) => t.body.includes("{name}") && t.body.includes("{me}") && t.body.includes("{linkline}")), "three wordings, each with a name, a sender and a link spot");
check(!/discount|gift|free|reward|coupon|\$|offer you|in exchange|5[- ]star|five[- ]star|positive|glowing|great review|if you('| a)re happy|only if/i.test(all), "no incentives, no star-fishing, no pre-screening for happy customers");
check(tpl.every((t) => /honest|tell it the way it was|how it really went/i.test(t.body)), "every wording asks for an honest review, good or bad");
check(reviewLinkOk("https://g.page/r/abc/review") === "https://g.page/r/abc/review" && !reviewLinkOk("http://g.page/x") && !reviewLinkOk("javascript:alert(1)") && !reviewLinkOk("https://user:pw@x.com/a") && !reviewLinkOk("https://localhost/x") && !reviewLinkOk("nonsense"), "review links must be real https links");

// ---------- fake services ----------
const emails = [];
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.host === "api.resend.com") { emails.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  throw new Error(`Unexpected fetch ${url}`);
};
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k), list: async ({ prefix = "" } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
const env = { RESEND_API_KEY: "re", ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com", PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com", VIDEO_SECRET: "vsecret", PREVIEWS: kv };
const ctx = { waitUntil() {} };
const API = "https://api.vantryai.com";
const call = (path, opts = {}) => worker.fetch(new Request(API + path, { redirect: "manual", ...opts }), env, ctx);
const form = (obj) => ({ method: "POST", body: new URLSearchParams(obj) });
const base = { status: "active", onboardedAt: Date.now(), audits: [{ id: "a1", at: Date.now(), mentioned: 1, total: 2, kind: "baseline" }] };
await saveClient(env, { id: "cgrowth00001", plan: "growth", email: "owner@chairside.io", onboarding: { business: "Chairside", website: "chairside.io", reportEmail: "reports@chairside.io" }, ...base, listings: { batches: [{ id: "lbatch000001", status: "open" }] } });
await saveClient(env, { id: "cstarter0001", plan: "starter", email: "s@x.com", onboarding: { business: "Tiny", website: "chairside.io" }, ...base });
const batch = (targets) => store.set("lst:lbatch000001", JSON.stringify({ id: "lbatch000001", clientId: "cgrowth00001", status: "open", targets }));

// ---------- nothing until a profile is live ----------
batch([{ domain: "g2.com", type: "review", status: "todo", listingUrl: null }, { domain: "capterra.com", type: "directory", status: "submitted", listingUrl: "https://capterra.com/p/1" }]);
check((await runClientReviews(env)) === 0 && emails.length === 0, "no kit email until a profile is actually live");

// ---------- the kit email ----------
batch([{ domain: "g2.com", type: "review", status: "live", listingUrl: "https://www.g2.com/products/chairside/reviews" }, { domain: "bestof.blog", type: "article", status: "live", listingUrl: "https://bestof.blog/x" }]);
check((await runClientReviews(env)) === 1, "the kit is sent once a review site profile is live");
const mail = emails[0];
check(mail.to[0] === "reports@chairside.io" && mail.text.includes("/reviews/cgrowth00001") && mail.text.includes("g2.com") && !mail.text.includes("bestof.blog"), "the client gets a link to the kit, naming only review sites and directories");
check(/same message to every customer/.test(mail.text) && /offer nothing in return/.test(mail.text) && /never see your customers/.test(mail.text), "the email states the rules and that we never see customer details");
check((await runClientReviews(env)) === 0 && emails.length === 1, "it is sent only once");
check((await getClient(env, "cstarter0001")).reviews === undefined, "Starter clients get no kit");

// ---------- the page ----------
let r = await call("/reviews/cgrowth00001");
let h = await r.text();
check(r.status === 200 && r.headers.get("X-Robots-Tag") === "noindex" && h.includes("g2.com/products/chairside/reviews") && !h.includes("bestof.blog/x"), "the page lists real review profiles only");
check(h.includes("Send the same message to every customer") && h.includes("Don&#39;t offer discounts") && h.includes("never see your customers"), "the page shows the rules up front");
check((await call("/reviews/cstarter0001")).status === 404 && (await call("/reviews/cother0000001")).status === 404, "unknown and Starter clients get 404");
r = await call("/reviews/cgrowth00001", form({ link: "javascript:alert(1)" }));
check((await r.text()).includes("doesn&#39;t look like a link") && !(await getClient(env, "cgrowth00001")).reviews.link, "a bad link is refused");
r = await call("/reviews/cgrowth00001", form({ link: "https://g.page/r/chairside/review" }));
h = await r.text();
check(h.includes("Saved") && h.includes("https://g.page/r/chairside/review"), "a review link can be added");

// ---------- the in-browser emails (run the page's own script with a fake page) ----------
const script = h.match(/<script>([\s\S]*?)<\/script>/)[1];
const values = { tpl: "0", me: "Alex", lnk: "https://g.page/r/chairside/review", who: "Sam Rivera, sam@example.com\nnot an email\nPat <pat@example.com>\nsam@example.com\n  lee@example.com  " };
const made = [];
const els = {};
const doc = { getElementById: (id) => (els[id] ||= { value: values[id] ?? "", set innerHTML(v) { made.length = 0; }, appendChild: (a) => made.push(a), set textContent(v) { this.text = v; }, style: {} }), createElement: () => ({ style: {} }) };
vm.runInNewContext(script, { document: doc, encodeURIComponent, JSON });
els.go.onclick();
check(script.length > 100 && made.length === 3, "one email per distinct, valid address (bad lines and repeats skipped)");
const href = decodeURIComponent(made[0].href);
check(made[0].href.startsWith("mailto:sam%40example.com?subject=") && href.includes("Hi Sam,") && href.includes("Alex") && href.includes("https://g.page/r/chairside/review") && !href.includes("{"), "the email is filled in with the name, sender and link");
els.lnk.value = ""; els.go.onclick();
check(!decodeURIComponent(made[0].href).includes("You can leave it here") && !decodeURIComponent(made[0].href).includes("{linkline}"), "with no link chosen, the link line is left out cleanly");
check(!/lee@example|pat@example|Pat </.test(h), "the page never contains customer details: they stay in the browser");

console.log(`\n${count} checks, ${ok ? "all passed" : "SOME FAILED"}`);
process.exit(ok ? 0 : 1);
