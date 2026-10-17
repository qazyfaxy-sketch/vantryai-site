// Tests for the website engine (hub + copy-paste paths, comparisons, cron), with fake AI, Cloudflare and email.
// The WordPress path is tested end to end against a real WordPress (see README).
// Run: node test/site.mjs
import worker from "../src/worker.js";
import { buildSchema, buildLlms, cleanPage, rivalSites, slugify, seal, unseal } from "../src/lib/sitefix.js";
import { saveAudit } from "../src/lib/aiscan.js";
import { runClientSite, saveClient, getClient } from "../src/ai.js";

let ok = true;
let count = 0;
const check = (cond, msg) => {
  count++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) ok = false;
};

// ---------- pure helpers ----------
const co = { name: "Chairside", website: "https://chairside.io", category: "dental scheduling", audience: "" };
const sch = buildSchema(co, { description: "Booking for dentists.", isSoftware: true, pricing: [{ plan: "Solo", price: "$1,059.50", period: "per month" }, { plan: "Group", price: "Custom" }], pages: {} });
check(sch[1]["@type"] === "SoftwareApplication" && sch[1].offers.length === 1 && sch[1].offers[0].price === "1059.50", "schema: software with only the prices their site states");
check(buildSchema(co, { isSoftware: false, category: "plumbing" })[1]["@type"] === "Service", "schema: a service business is a Service");
check(buildLlms(co, { description: "Booking.", features: ["Reminders"] }, [{ title: "A", url: "https://x/a" }]).includes("- [A](https://x/a)"), "llms.txt lists live pages");
check(slugify("Chairside vs. Weave: What's different?") === "chairside-vs-weave-what-s-different", "slugs are clean");
const cp = cleanPage({ title: "Booking app", intro: "Chairside is online booking. It is the best booking app, guaranteed. Setup takes a day.", sections: [{ h2: "A", paragraphs: ["Results guaranteed in a week. Patients book online."] }, { h2: "B", bullets: ["y"] }] }, "answer");
check(cp.intro === "Chairside is online booking. Setup takes a day." && cp.sections[0].paragraphs[0] === "Patients book online.", "sentences that overclaim (best, guaranteed) are dropped");
check(cleanPage({ intro: "x", sections: [{ h2: "A", paragraphs: ["x"] }] }, "answer") === null, "a thin page is rejected");
check(JSON.stringify(rivalSites({ onboarding: { competitors: "Weave (getweave.com), NexHealth, https://www.dentrix.com/ascend" } }).map((r) => r.site)) === '["https://getweave.com","https://www.dentrix.com/ascend"]', "competitor websites are read from the onboarding form");

// ---------- fake services ----------
const emails = [];
const prompts = [];
const cf = [];
let hostActive = false;
const ok200 = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
const ANSWER = { title: "Best scheduling software for a small dental office?", slug: "dental-scheduling-small-office", metaDescription: "How Chairside handles booking.", intro: "Chairside is online booking for dental offices.", sections: [{ h2: "What to look for", paragraphs: ["Text reminders."], bullets: ["Reminders"] }, { h2: "How Chairside does it", paragraphs: ["Patients book online."], bullets: [] }], faq: [{ q: "Does it send reminders?", a: "Yes, by text." }] };
const COMPARE = { title: "Chairside vs Weave: how they compare", slug: "chairside-vs-weave", metaDescription: "A fair comparison.", intro: "Both help dental offices.", rows: [{ label: "Starting price", a: "$59/month", b: "Not listed on their website" }, { label: "Text reminders", a: "Yes", b: "Yes" }, { label: "Online booking", a: "Yes", b: "Yes" }], sections: [{ h2: "Who Chairside fits", paragraphs: ["Small offices."], bullets: [] }, { h2: "Who Weave fits", paragraphs: ["Offices wanting phones too."], bullets: [] }], faq: [] };
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = opts.body ? String(opts.body) : "";
  if (url.host === "chairside.io" || url.host === "getweave.com") return new Response(`<html><body><h1>${url.host} home</h1><p>Online booking and text reminders for dental offices. Plans from $59 per month for one dentist.</p><a href="/pricing">Pricing</a></body></html>`);
  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(body);
    prompts.push({ system: b.system, user: b.messages[0].content });
    if (b.system.includes("extract facts")) return ok200({ content: [{ type: "text", text: JSON.stringify({ description: "Online booking for dental offices.", isSoftware: true, features: ["Online booking"], pricing: [{ plan: "Solo", price: "$59", period: "per month" }], pages: {} }) }] });
    const isCompare = b.system.includes("fair comparison") || b.messages[0].content.includes("WEAVE WEBSITE") || b.messages[0].content.includes('"rows"');
    return ok200({ content: [{ type: "text", text: JSON.stringify(isCompare ? COMPARE : ANSWER) }] });
  }
  if (url.host === "api.cloudflare.com") {
    cf.push({ method: opts.method || "GET", path: url.pathname + url.search, body });
    if ((opts.method || "GET") === "GET") return ok200({ success: true, result: hostActive ? [{ hostname: "answers.chairside.io", status: "active", ssl: { status: "active" } }] : [] });
    return ok200({ success: true, result: { hostname: "answers.chairside.io", status: "pending", ssl: { status: "pending" } } });
  }
  if (url.host === "api.resend.com") { emails.push(JSON.parse(body)); return ok200({ id: "em" }); }
  throw new Error(`Unexpected fetch ${url}`);
};

const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k), list: async () => ({ keys: [], list_complete: true }) };
const env = {
  ANTHROPIC_API_KEY: "a", RESEND_API_KEY: "re", ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com",
  PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com",
  CF_API_TOKEN: "cf", CF_SAAS_ZONE_ID: "zone1", PREVIEWS: kv,
};
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const call = (path, opts = {}, host = "api.vantryai.com") => worker.fetch(new Request(`https://${host}${path}`, { redirect: "manual", ...opts }), env, ctx);
const form = (obj) => ({ method: "POST", body: new URLSearchParams(obj) });

check((await unseal(env, await seal(env, "secret-key-123"))) === "secret-key-123", "connect keys are stored encrypted and can be read back");

await saveAudit(env, { id: "aaudit000001", createdAt: Date.now(), company: { name: "Chairside", website: "chairside.io" }, origin: "client", questions: ["best dental scheduling software?", "dental booking app for 2 dentists?"], engines: ["openai"], results: [{ q: "best dental scheduling software?", engine: "openai", mentioned: false, named: ["Weave"], sources: [] }, { q: "dental booking app for 2 dentists?", engine: "openai", mentioned: false, named: ["NexHealth"], sources: [] }], summary: { mentioned: 0, total: 2, competitors: [], sources: [] } });
const base = { status: "active", onboardedAt: Date.now(), startedAt: Date.now(), audits: [{ id: "aaudit000001", at: Date.now(), mentioned: 0, total: 2, kind: "baseline" }], questions: ["best dental scheduling software?", "dental booking app for 2 dentists?"] };
await saveClient(env, { id: "cgrowth00001", plan: "growth", email: "owner@chairside.io", onboarding: { business: "Chairside", website: "chairside.io", sell: "dental scheduling software", competitors: "Weave (getweave.com), NexHealth", avoid: "patient names", reportEmail: "reports@chairside.io" }, ...base });
await saveClient(env, { id: "cstarter0001", plan: "starter", email: "s@x.com", onboarding: { business: "Tiny", website: "chairside.io" }, ...base });

// ---------- not connected: copy-paste ----------
check((await runClientSite(env)) === 1, "cron writes a page");
let c = await getClient(env, "cgrowth00001");
check(c.pages?.[0]?.status === "review" && c.pages[0].q === "best dental scheduling software?", "first page answers a question AI isn't naming them for");
check(c.nextPageAt > Date.now() + 9 * 86400000 && c.nextPageAt < Date.now() + 11 * 86400000, "Growth: next page in about 10 days (3 a month)");
check(prompts.length === 2 && prompts[0].user.includes("Weave") && prompts[1].system.includes("fact checker"), "written with the names AI picked instead, then fact-checked");
check(prompts[0].system.includes("patient names"), "the client's never-say list goes into the instructions");
check((await getClient(env, "cstarter0001")).pages === undefined, "Starter clients don't get pages");
check((await runClientSite(env)) === 0, "no second page while one waits for approval");
const ready = emails.find((e) => e.subject.startsWith("Page ready to check"));
const review = ready.text.match(/https:\/\/api\.vantryai\.com(\/pg\/\S+)/)[1];
let r = await call(review.replace(/k=\w+/, "k=bad"));
check(r.status === 404, "review page needs the signed link");
r = await call(review);
check((await r.text()).includes("How Chairside does it"), "review page shows the full page");
const k = new URL(`https://x${review}`).searchParams.get("k");
r = await call(review.split("?")[0], form({ k, action: "approve" }));
check((await r.text()).includes("ready on their Vantry page"), "without a connected site, approving makes it ready to copy");
check(emails.some((e) => e.to[0] === "reports@chairside.io" && e.subject.startsWith("New page ready") && e.text.includes("/site/cgrowth00001")), "client gets the page link to copy it, plus how to connect");
r = await call("/site/cgrowth00001");
const sp = await r.text();
check(sp.includes("Download the Vantry Connect plugin") && /cgrowth00001\.[a-z0-9]{32}/.test(sp), "client page offers the WordPress plugin with a connect code");
check(sp.includes("answers.chairside.io") && sp.includes("application/ld+json") && sp.includes("&lt;h2&gt;How Chairside does it"), "client page offers the hub, the homepage code and the page HTML to copy");
const code1 = sp.match(/cgrowth00001\.[a-z0-9]{32}/)[0];
check((await (await call("/site/cgrowth00001")).text()).includes(code1), "the connect code stays the same between visits");
r = await call("/api/site/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "cgrowth00001.wrongwrongwrongwrongwrongwrong12", site: "https://chairside.io/", rest: "https://chairside.io/wp-json/vantry/v1/" }) });
check(r.status === 400, "a wrong connect code is refused");

// ---------- hub on their own subdomain ----------
r = await call("/site/cgrowth00001", form({ action: "hub", host: "answers.evil.com" }));
check((await r.text()).includes("Use a subdomain of chairside.io"), "the hub must be on their own domain");
r = await call("/site/cgrowth00001", form({ action: "hub", host: "answers.chairside.io" }));
const hp = await r.text();
check(hp.includes("Add this DNS record") && hp.includes("sites.vantryai.com"), "client is shown the one DNS record to add");
check(cf.some((x) => x.method === "POST" && x.path.includes("/custom_hostnames")), "the subdomain is added to Cloudflare");
hostActive = true;
await runClientSite(env);
c = await getClient(env, "cgrowth00001");
check(c.site.hub.status === "active", "the cron notices the DNS record works");
check(c.pages[0].status === "live" && c.pages[0].url === "https://answers.chairside.io/dental-scheduling-small-office", "pages waiting to be copied go live on the hub");
check(emails.some((e) => e.subject.startsWith("Your answers page is live")), "client gets told the hub is live");
r = await call("/", {}, "answers.chairside.io");
let t = await r.text();
check(r.status === 200 && t.includes("Answers from Chairside") && t.includes("/dental-scheduling-small-office") && t.includes('"SoftwareApplication"'), "hub home lists the pages, with structured data");
r = await call("/dental-scheduling-small-office", {}, "answers.chairside.io");
t = await r.text();
check(r.status === 200 && t.includes("How Chairside does it") && t.includes('"FAQPage"') && t.includes('rel="canonical"'), "hub page is live with FAQ structured data");
check((await (await call("/llms.txt", {}, "answers.chairside.io")).text()).startsWith("# Chairside"), "hub serves llms.txt");
check((await (await call("/robots.txt", {}, "answers.chairside.io")).text()).includes("Allow: /"), "hub lets every crawler in");
check((await (await call("/sitemap.xml", {}, "answers.chairside.io")).text()).includes("dental-scheduling-small-office"), "hub has a sitemap");
check((await call("/nope", {}, "answers.chairside.io")).status === 404, "unknown hub pages are 404s");

// ---------- comparison page every third page ----------
c = await getClient(env, "cgrowth00001");
c.nextPageAt = 0;
c.foundation.at = Date.now();
await saveClient(env, c);
await runClientSite(env); // 2nd page: next question
c = await getClient(env, "cgrowth00001");
check(c.pages[1].q === "dental booking app for 2 dentists?", "second page answers the next question");
const rv2 = emails.filter((e) => e.subject.startsWith("Page ready")).slice(-1)[0].text.match(/https:\/\/api\.vantryai\.com(\/pg\/\S+)/)[1];
await call(rv2.split("?")[0], form({ k: new URL(`https://x${rv2}`).searchParams.get("k"), action: "approve" }));
c = await getClient(env, "cgrowth00001");
c.nextPageAt = 0;
await saveClient(env, c);
await runClientSite(env); // 3rd page: comparison
c = await getClient(env, "cgrowth00001");
check(c.pages[2].kind === "compare" && c.pages[2].rival === "Getweave", "third page is a comparison with a competitor whose site we know");
check(prompts.some((p) => p.user.includes("GETWEAVE WEBSITE")), "the comparison reads the competitor's own website");
const rv3 = emails.filter((e) => e.subject.startsWith("Page ready")).slice(-1)[0].text.match(/https:\/\/api\.vantryai\.com(\/pg\/\S+)/)[1];
r = await call(rv3);
t = await r.text();
check(t.includes("Not listed on their website") && t.includes("Based on each company") , "comparison shows a fair table with sources and date");
r = await call(rv3.split("?")[0], form({ k: new URL(`https://x${rv3}`).searchParams.get("k"), action: "redo", note: "mention online booking first" }));
check((await r.text()).includes("A new version is ready"), "Redo writes a new version right away");
check(prompts.slice(-2)[0].user.includes("mention online booking first"), "the note goes into the new version");
c = await getClient(env, "cgrowth00001");
check(c.pages.find((x) => x.status === "redone") && c.pages.slice(-1)[0].kind === "compare", "old version marked redone, new comparison waiting");

// ---------- admin ----------
const adm = await (await call(`/admin/audits?token=${env.ADMIN_TOKEN}`)).text();
check(adm.includes("Website pages") && adm.includes("Hub (active)") && adm.includes("Write a page now"), "admin page shows website pages, connection and the write-now button");
r = await call("/admin/page", form({ token: env.ADMIN_TOKEN, clientId: "cgrowth00001" }));
check(r.status === 303, "Write a page now works from the admin page");

console.log(`\n${count} checks, ${ok ? "all passed" : "SOME FAILED"}`);
process.exit(ok ? 0 : 1);
