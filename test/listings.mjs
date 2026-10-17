// Tests for the listings engine, with fake AI, fake directory sites, email and storage.
// Run: node test/listings.mjs
import worker from "../src/worker.js";
import { collectCited, submitLinks, listingUrlOk, cleanDomain, rootOf, cleanKit, fit } from "../src/lib/listings.js";
import { saveAudit } from "../src/lib/aiscan.js";
import { runClientListings, saveClient, getClient } from "../src/ai.js";

let ok = true;
let count = 0;
const check = (cond, msg) => {
  count++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) ok = false;
};

// ---------- pure helpers ----------
check(cleanDomain("https://www.Capterra.com/x?y") === "capterra.com" && cleanDomain("localhost") === "" && cleanDomain("a.internal") === "", "domains are cleaned; junk is refused");
check(rootOf("shop.example.co.uk") === "example.co.uk" && rootOf("a.b.g2.com") === "g2.com", "root of a host");
const l = submitLinks('<a href="/log-in">Log in</a><a href="/vendors/claim">Claim your profile</a><a href="/vendors/submit">Add your product</a><a href="https://evil.com/submit">Add your product</a>', "https://capterra.com/", "capterra.com");
check(l.submit === "https://capterra.com/vendors/submit" && l.claim === "https://capterra.com/vendors/claim", "finds the sign-up and claim links, only on the same site");
check(submitLinks('<a href="/about">About us</a>', "https://x.com/", "x.com").submit === null, "no link when there is none");
check(listingUrlOk("https://capterra.com/p/1/chairside", "capterra.com") && !listingUrlOk("http://capterra.com/p/1", "capterra.com") && !listingUrlOk("https://capterra.com/", "capterra.com") && !listingUrlOk("https://evil.com/capterra.com", "capterra.com") && !listingUrlOk("https://capterra.com.evil.com/p", "capterra.com"), "profile links must be https, on that site, and not the homepage");
check(!/best|#1/i.test(fit("Chairside books patients. It is the best app ever. It sends reminders.", 300)), "overclaiming sentences are dropped");
check(cleanKit({ short: "x", medium: "y", category: "c" }, { name: "A", website: "a.com" }) === null, "a thin kit is rejected");
const ca = collectCited({ results: [{ engine: "openai", sources: [{ url: "https://www.capterra.com/a", domain: "capterra.com" }, { url: "https://capterra.com/b", domain: "capterra.com" }] }, { engine: "gemini", sources: [{ url: "https://capterra.com/c", domain: "capterra.com" }] }, { engine: "openai", error: "x", sources: [{ url: "https://bad.com", domain: "bad.com" }] }] });
check(ca.total === 2 && ca.list[0].domain === "capterra.com" && ca.list[0].n === 2 && !ca.list.some((x) => x.domain === "bad.com"), "counts answers per site once, ignores failed answers");

// ---------- fake services ----------
const emails = [];
const prompts = [];
let classifyFails = false;
const ok200 = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
const KIT = { tagline: "Online booking for dental offices", short: "Chairside is online booking software for small dental offices.", medium: "Chairside is online booking software for small dental offices. Patients book online and get text reminders before each visit. It is built for small practices. We are the best in the world.", long: "Chairside is online booking software for small dental offices. Patients book online and get text reminders.", category: "dental scheduling software", alsoCategories: ["appointment reminders"], audience: "small dental practices", features: ["Online booking", "Text reminders"], integrations: [], pricing: "", trial: "", keywords: ["dental"], screenshots: ["https://chairside.io/pricing", "https://evil.com/x.png"] };
const TYPES = { "capterra.com": ["directory", "yes"], "g2.com": ["review", "yes"], "softwarehub.io": ["marketplace", "maybe"], "plainlist.com": ["directory", "yes"], "deadsite.com": ["directory", "yes"], "bestof.blog": ["article", "no"], "weave.com": ["competitor", "no"] };
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = opts.body ? (typeof opts.body === "string" ? opts.body : opts.body.toString()) : "";
  const h = url.host.replace(/^www\./, "");
  if (h === "chairside.io") {
    if (url.pathname === "/") return new Response('<html><body><h1>Chairside: online booking for dental offices</h1><p>Patients book online and get text reminders before each visit. Built for small practices.</p><a href="/pricing">Pricing</a></body></html>');
    return new Response(`<html><body><h1>${url.pathname}</h1><p>Details about ${url.pathname.slice(1)} for Chairside, the dental booking app for small offices.</p></body></html>`);
  }
  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(body);
    prompts.push({ system: b.system, user: b.messages[0].content });
    if (b.system.includes("You label websites")) {
      if (classifyFails) return ok200({ content: [{ type: "text", text: "sorry" }] });
      const doms = JSON.parse(b.messages[0].content.split("Websites (JSON):\n")[1]).map((x) => x.domain);
      return ok200({ content: [{ type: "text", text: JSON.stringify(doms.map((d) => ({ domain: d, type: TYPES[d]?.[0] || "other", fits: TYPES[d]?.[1] || "no" }))) }] });
    }
    return ok200({ content: [{ type: "text", text: JSON.stringify(KIT) }] });
  }
  if (url.host === "api.resend.com") { emails.push(JSON.parse(body)); return ok200({ id: "em" }); }
  if (h === "capterra.com") {
    if (url.pathname === "/") return new Response('<a href="/log-in">Log in</a><a href="/vendors/submit">Add your product</a><a href="/vendors/claim">Claim your profile</a>');
    if (url.pathname === "/p/1/chairside") return new Response("<h1>Chairside reviews and pricing</h1>");
    if (url.pathname === "/p/2/other") return new Response("<h1>Some other product</h1>");
    return new Response("nope", { status: 404 });
  }
  if (h === "g2.com") return new Response("blocked", { status: 403 });
  if (h === "softwarehub.io") return url.pathname === "/" ? new Response('<a href="/for-vendors">For vendors</a>') : new Response("x", { status: 404 });
  if (h === "plainlist.com") return new Response("<p>Just a list.</p>", { status: url.pathname === "/" ? 200 : 404 });
  if (h === "deadsite.com") throw new Error("ENOTFOUND");
  throw new Error(`Unexpected fetch ${url}`);
};

const store = new Map();
const kv = {
  get: async (k) => store.get(k) ?? null,
  put: async (k, v) => void store.set(k, v),
  delete: async (k) => void store.delete(k),
  list: async ({ prefix = "" } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const env = { ANTHROPIC_API_KEY: "a", RESEND_API_KEY: "re", ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com", PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com", VIDEO_SECRET: "vsecret", PREVIEWS: kv };
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const API = "https://api.vantryai.com";
const call = (path, opts = {}) => worker.fetch(new Request(API + path, { redirect: "manual", ...opts }), env, ctx);
const form = (obj) => ({ method: "POST", body: new URLSearchParams(obj) });
const src = (d) => ({ url: `https://${d}/x`, title: d, domain: d });

await saveAudit(env, { id: "aaudit000001", createdAt: Date.now(), company: { name: "Chairside", website: "chairside.io" }, origin: "client", questions: ["q1", "q2"], engines: ["openai", "gemini"], results: [
  { q: "q1", engine: "openai", mentioned: true, named: [], sources: ["capterra.com", "g2.com", "softwarehub.io", "plainlist.com", "deadsite.com", "chairside.io", "weave.com", "reddit.com", "bestof.blog"].map(src) },
  { q: "q2", engine: "gemini", mentioned: false, named: [], sources: ["capterra.com", "g2.com", "reddit.com"].map(src) },
], summary: { mentioned: 1, total: 2, competitors: [], sources: [] } });
const base = { status: "active", onboardedAt: Date.now(), startedAt: Date.now(), audits: [{ id: "aaudit000001", at: Date.now(), mentioned: 1, total: 2, kind: "baseline" }], questions: ["q1", "q2"] };
await saveClient(env, { id: "cgrowth00001", plan: "growth", email: "owner@chairside.io", onboarding: { business: "Chairside", website: "chairside.io", sell: "dental scheduling software", buyers: "small dental offices", competitors: "weave.com", avoid: "patient names", reportEmail: "reports@chairside.io" }, ...base });
await saveClient(env, { id: "cstarter0001", plan: "starter", email: "s@x.com", onboarding: { business: "Tiny", website: "chairside.io" }, ...base });

// ---------- cron: find, check, write, then a batch ----------
check((await runClientListings(env)) === 1, "cron works on one client per run");
let c = await getClient(env, "cgrowth00001");
const seen = c.listings.seen;
check(!seen["chairside.io"] && !seen["weave.com"] && !seen["reddit.com"], "their own site, competitors and social sites are never candidates");
check(seen["capterra.com"].n === 2 && seen["capterra.com"].tot === 2 && seen["g2.com"].n === 2, "each site records how many answers cited it");
check(seen["capterra.com"].probe === "link" && seen["capterra.com"].submit === "https://capterra.com/vendors/submit" && seen["capterra.com"].claim === "https://capterra.com/vendors/claim", "a real sign-up link is found on the site");
check(seen["g2.com"].probe === "find" && !seen["g2.com"].submit, "a site that blocks our check is 'find it yourself', with no invented link");
check(seen["softwarehub.io"].probe === "link" && seen["softwarehub.io"].submit === "https://softwarehub.io/for-vendors", "falls back to common sign-up paths");
check(seen["plainlist.com"].probe === "nolink" && seen["deadsite.com"].probe === "dead", "sites with no way to add a company, or that don't load, are not offered");
check(seen["bestof.blog"].type === "article" && !seen["bestof.blog"].probe, "articles are never probed or offered");
check((await getClient(env, "cstarter0001")).listings === undefined, "Starter clients get no listings");
await runClientListings(env); // writes the kit
c = await getClient(env, "cgrowth00001");
check(c.listingKit?.data.category === "dental scheduling software", "profile kit written");
check(!/best in the world/i.test(c.listingKit.data.medium) && JSON.stringify(c.listingKit.data).indexOf("evil.com") < 0, "overclaims and outside links are stripped from the kit");
check(c.listingKit.data.screenshots.every((u) => u.startsWith("https://chairside.io")), "screenshot pages are only their own");
check(prompts.some((p) => p.user.includes("Website text:") && p.system.includes("patient names")), "their 'avoid' list is given to the writer");
await runClientListings(env); // makes the batch
c = await getClient(env, "cgrowth00001");
const row = c.listings.batches[0];
check(row && row.status === "review" && row.total === 3, "a batch of 3 usable sites is waiting for your review");
const rev = emails.find((e) => e.subject.startsWith("Listing kit ready"));
check(rev && rev.to[0] === env.OWNER_EMAIL, "you get the review email");
check(!emails.some((e) => e.to[0] === "reports@chairside.io"), "the client hears nothing before you approve");
const review = rev.text.match(/https:\/\/api\.vantryai\.com(\/lk\/\S+)/)[1];
check((await runClientListings(env)) === 0, "no second batch while one is waiting");

// ---------- review ----------
check((await call(review.replace(/k=\w+/, "k=bad"))).status === 404, "review page needs the signed link");
let r = await call(review);
const rp = await r.text();
check(r.status === 200 && rp.includes("Approve and send") && rp.includes("capterra.com") && rp.includes("client finds it"), "review page shows sites and the kit");
check(r.headers.get("X-Robots-Tag") === "noindex", "review page is noindex");
const k = new URL(API + review).searchParams.get("k");
r = await call(review.split("?")[0], form({ k, action: "approve" }));
check((await r.text()).includes("Approved"), "approve works");
const client = emails.find((e) => e.to[0] === "reports@chairside.io" && e.subject.includes("listing kit"));
check(client && client.text.includes("capterra.com") && /can't guarantee/.test(client.text) && /never pay for or write reviews/.test(client.text), "client email names the sites, promises nothing, warns about reviews");
const page = "/listings/cgrowth00001";

// ---------- client page ----------
r = await call(page);
let cp = await r.text();
check(r.status === 200 && cp.includes("https://capterra.com/vendors/submit") && cp.includes("I submitted it"), "client page has the kit and the real sign-up link");
check(cp.includes("Our check couldn't load this site") && !/href="https:\/\/g2\.com\/[a-z]/.test(cp), "blocked sites say 'find it yourself', no invented link");
check((await call("/listings/cother0000001")).status === 404, "unknown client page is 404");
const post = (o) => call(page, form({ b: row.id, ...o }));
cp = await (await post({ d: "capterra.com", action: "submitted", url: "https://evil.com/p" })).text();
check(cp.includes("look like a link"), "a link on another site is refused");
cp = await (await post({ d: "capterra.com", action: "submitted", url: "https://capterra.com/p/2/other" })).text();
check(cp.includes("see your name on that page"), "a page without their name is not marked live");
cp = await (await post({ d: "capterra.com", action: "submitted", url: "https://capterra.com/p/1/chairside" })).text();
check(cp.includes("Confirmed") && (await getClient(env, "cgrowth00001")).listings.batches[0].live === 1, "a page with their name is verified and marked live");
await post({ d: "g2.com", action: "skip" });
cp = await (await post({ d: "g2.com", action: "skip" })).text();
check(cp.includes("Skipped"), "a site can be skipped");

// ---------- reminders ----------
await post({ d: "softwarehub.io", action: "submitted" });
c = await getClient(env, "cgrowth00001");
check(c.listings.batches[0].status === "complete", "batch completes when nothing is left to do");
const done = emails.find((e) => e.subject.startsWith("Listings done"));
check(!!done, "you are told when they finish");

// ---------- next month, errors ----------
c = await getClient(env, "cgrowth00001");
check(c.listings.nextAt > Date.now() + 29 * 86400000, "next kit is a month away");
c.listings.nextAt = 0;
c.listings.seen = {};
c.listings.auditId = null;
await saveClient(env, c);
classifyFails = true;
emails.length = 0;
await runClientListings(env);
check(emails.some((e) => e.subject.startsWith("Listings stopped")), "a failure emails you once");
c = await getClient(env, "cgrowth00001");
check(c.listings.nextAt > Date.now() && c.listings.nextAt < Date.now() + 4 * 3600000, "it retries in a few hours");
classifyFails = false;
c.listings.nextAt = 0;
await saveClient(env, c);
await runClientListings(env);
c = await getClient(env, "cgrowth00001");

// ---------- admin ----------
const adm = await (await call(`/admin/audits?token=${env.ADMIN_TOKEN}`)).text();
check(adm.includes("Listings") && adm.includes("Find sites and make a kit now"), "admin page shows the Listings card");
r = await call("/admin/listings", form({ token: env.ADMIN_TOKEN, clientId: "cgrowth00001" }));
check(r.status === 303, "make-now returns to the admin page");
r = await call("/admin/listings", form({ token: "wrong", clientId: "cgrowth00001" }));
check(r.status !== 303 && r.status < 500, "make-now needs the admin token");

console.log(`\n${count} checks, ${ok ? "all passed" : "SOME FAILED"}`);
process.exit(ok ? 0 : 1);
