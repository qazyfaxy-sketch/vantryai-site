// Tests for AI visibility reports, plans and onboarding, with fake AI engines, Stripe and email.
// Run: node test/ai.mjs
import worker from "../src/worker.js";
import { brandTerms, isNamed, isCited, summarize } from "../src/lib/aiscan.js";
import { blockedBots, fixList } from "../src/lib/delivery.js";
import { runClientDelivery } from "../src/ai.js";
import { signPayload } from "../src/lib/stripe.js";

let ok = true;
let count = 0;
const check = (cond, msg) => {
  count++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) ok = false;
};

// ---------- pure helpers ----------
const brand = brandTerms("Chairside Scheduling Inc", "https://www.chairside.io/");
check(brand.host === "chairside.io", "brand host comes from the website");
check(isNamed("Top picks: Chairside Scheduling, Dentrix and Weave.", brand), "full name is matched");
check(isNamed("Try chairside for small offices", brand), "site name is matched");
check(!isNamed("Dentrix and Weave are popular.", brand), "not matched when absent");
check(!isNamed("chairs and sides", brandTerms("Chairside", "chairside.io")), "no false match on similar words");
check(isCited([{ domain: "blog.chairside.io" }], brand), "a citation of their own site counts as cited");
const sum = summarize([
  { engine: "openai", mentioned: true, named: ["Weave", "Dentrix"], sources: [{ domain: "g2.com" }] },
  { engine: "openai", mentioned: false, named: ["Weave"], sources: [{ domain: "g2.com" }, { domain: "reddit.com" }] },
  { engine: "perplexity", error: "x", named: [], sources: [] },
], ["openai", "perplexity"]);
check(sum.total === 2 && sum.mentioned === 1, "summary skips failed answers");
check(sum.competitors[0].name === "Weave" && sum.competitors[0].count === 2, "competitors are counted");
check(sum.sources[0].name === "g2.com", "sources are counted");

check(JSON.stringify(blockedBots("User-agent: GPTBot\nDisallow: /\n")) === '["GPTBot"]', "robots.txt: a blocked AI crawler is found");
check(blockedBots("User-agent: *\nDisallow: /\n").length === 6, "robots.txt: blocking everyone blocks every AI crawler");
check(blockedBots("User-agent: *\nDisallow: /admin\n").length === 0, "robots.txt: blocking one folder isn't blocking AI");
check(fixList({ reachable: true, blocked: ["GPTBot"], schema: false, llms: false, comparison: true, pricing: true, faqSchema: true, description: true }, { company: { website: "x.com" }, summary: { sources: [] }, results: [] })[0].title.includes("GPTBot"), "fix list puts blocked AI crawlers first");

// ---------- fake services ----------
const emails = [];
const stripeCalls = [];
let geminiDown = false;
let chatgptNamesUs = false;
const calls = [];
const ok200 = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
const ANSWER = "For dental offices, the most recommended options are Weave, Dentrix Ascend and NexHealth. Many small practices also like Chairside.";

globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = opts.body ? (typeof opts.body === "string" ? opts.body : opts.body.toString()) : "";
  calls.push(`${url.host}${url.pathname}`);
  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(body);
    if (b.tools) return ok200({ content: [{ type: "text", text: ANSWER, citations: [{ url: "https://www.capterra.com/dental", title: "Capterra" }] }] });
    if (b.system.includes("exact questions")) return ok200({ content: [{ type: "text", text: JSON.stringify(["What is the best scheduling software for dental offices?", "Which patient scheduling app works for a 2-dentist practice?", "Chairside Scheduling vs Weave?"]) }] });
    if (b.system.includes("list the companies")) {
      const items = JSON.parse(b.messages[0].content);
      return ok200({ content: [{ type: "text", text: JSON.stringify(items.map((x) => ({ i: x.i, named: x.answer.includes("Weave") ? ["Weave", "Dentrix Ascend", "NexHealth", "Chairside"] : [] }))) }] });
    }
  }
  if (url.host === "api.openai.com" && url.pathname === "/v1/responses") {
    const t = chatgptNamesUs ? "Weave, NexHealth and Chairside Scheduling are the usual picks for dental scheduling." : "Weave and NexHealth are the usual picks for dental scheduling.";
    return ok200({ output: [{ type: "web_search_call" }, { type: "message", content: [{ type: "output_text", text: t, annotations: [{ type: "url_citation", url: "https://www.reddit.com/r/Dentistry/x", title: "Reddit" }] }] }] });
  }
  if (url.host === "chairside.io") {
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n", { status: 200 });
    if (url.pathname === "/llms.txt") return new Response("Not found", { status: 404 });
    return new Response('<html><head><title>Chairside</title></head><body><a href="/pricing">Pricing</a></body></html>', { status: 200 });
  }
  if (url.host === "api.perplexity.ai") return ok200({ choices: [{ message: { content: ANSWER } }], search_results: [{ url: "https://www.g2.com/categories/dental", title: "G2" }] });
  if (url.host === "generativelanguage.googleapis.com") {
    if (geminiDown) return new Response("oops", { status: 500 });
    return ok200({ candidates: [{ content: { parts: [{ text: "Popular choices include Weave and Dentrix." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/x", title: "capterra.com" } }] } }] });
  }
  if (url.host === "api.resend.com") { emails.push(JSON.parse(body)); return ok200({ id: "em" }); }
  if (url.host === "api.stripe.com") {
    stripeCalls.push({ path: url.pathname, params: new URLSearchParams(body) });
    return ok200({ id: "cs_ai_1", url: "https://checkout.stripe.com/c/pay/cs_ai_1" });
  }
  throw new Error(`Unexpected fetch ${url}`);
};

const store = new Map();
const kv = {
  get: async (k) => store.get(k) ?? null,
  put: async (k, v) => void store.set(k, v),
  delete: async (k) => void store.delete(k),
  list: async ({ prefix = "" } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const env = {
  ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", PERPLEXITY_API_KEY: "p", GEMINI_API_KEY: "g",
  STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_test", RESEND_API_KEY: "re",
  ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com", ALLOWED_ORIGIN: "https://vantryai.com",
  PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com",
  PREVIEWS: kv,
};
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const API = "https://api.vantryai.com";
const call = (path, opts = {}) => worker.fetch(new Request(API + path, opts), env, ctx);
const postJson = (path, obj, headers = {}) => call(path, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4", ...headers }, body: JSON.stringify(obj) });
const form = (obj) => ({ method: "POST", body: new URLSearchParams(obj) });
const webhook = async (event) => {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = await signPayload(env.STRIPE_WEBHOOK_SECRET, t, body);
  const r = await call("/api/stripe/webhook", { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${sig}` }, body });
  await Promise.all(ctx.waits.splice(0));
  return r;
};

// ---------- admin report ----------
const adminGet = await call(`/admin/audits?token=${env.ADMIN_TOKEN}`);
check(adminGet.status === 200 && (await adminGet.text()).includes("ChatGPT, Perplexity, Gemini, Claude"), "admin page lists the engines that are on");
check((await call("/admin/audits?token=wrong")).status === 404, "admin page needs the token");
const ar = await (await call("/admin/audit", form({ token: env.ADMIN_TOKEN, name: "Chairside Scheduling", website: "chairside.io", category: "scheduling software for dental offices", audience: "small dental practices", questions: "" }))).text();
const reportUrl = (ar.match(/https:\/\/api\.vantryai\.com\/r\/(a[a-z0-9]{11})/) || [])[0];
check(!!reportUrl, "admin can run a report and gets a link");
const auditId = reportUrl.split("/r/")[1];
const audit = JSON.parse(store.get(`audit:${auditId}`));
check(audit.questions.length === 2, "AI-written questions that name the business itself are dropped");
check(audit.results.length === 8, "every question is asked to every engine (2 x 4)");
check(audit.results.filter((r) => r.engine === "openai").every((r) => !r.mentioned), "ChatGPT answers without the business are not counted as named");
check(audit.results.filter((r) => r.engine === "perplexity").every((r) => r.mentioned), "Perplexity answers that name the business count");
check(!audit.summary.competitors.some((c) => c.name === "Chairside"), "the business itself isn't listed as a competitor");
check(audit.summary.competitors[0].name === "Weave", "top competitor is found");
const rp = await call(`/r/${auditId}`);
const rhtml = await rp.text();
check(rp.status === 200 && rhtml.includes("Does AI recommend Chairside Scheduling?"), "report page renders");
check(rhtml.includes(`${audit.summary.mentioned}</strong><span>of ${audit.summary.total}`), "report shows the real score");
check(rhtml.includes("Weave") && rhtml.includes("g2.com"), "report shows competitors and sources");
check(rhtml.includes("official API") && rhtml.includes("won't"), "report explains how it was checked and promises no ranking");
check(!rhtml.includes("<script"), "report page has no scripts");
check((await call("/r/a00000000000")).status === 404, "unknown report is a 404");

// ---------- one engine fails ----------
geminiDown = true;
const ar2 = await (await call("/admin/audit", form({ token: env.ADMIN_TOKEN, name: "Chairside", website: "chairside.io", category: "dental scheduling", questions: "best dental scheduling app?" }))).text();
const id2 = (ar2.match(/\/r\/(a[a-z0-9]{11})/) || [])[1];
const a2 = JSON.parse(store.get(`audit:${id2}`));
check(a2.questions.length === 1 && a2.results.length === 4, "hand-written questions are used as given");
check(a2.results.find((r) => r.engine === "gemini").error && a2.summary.total === 3, "a failing engine is skipped, not counted");
check((await call(`/r/${id2}`)).status === 200, "report still renders when one engine fails");
geminiDown = false;

// ---------- public free report ----------
let r = await postJson("/api/report", { name: "Chairside", website: "", category: "dental scheduling", email: "doc@clinic.com" });
check(r.status === 400, "free report needs a website");
r = await postJson("/api/report", { name: "Chairside", website: "chairside.io", category: "dental scheduling", email: "nope" });
check(r.status === 400, "free report needs a valid email");
r = await postJson("/api/report", { name: "Chairside", website: "chairside.io", category: "dental scheduling", email: "x@y.com", company: "bot" });
check(r.status === 400, "bots that fill the hidden field are refused");
emails.length = 0;
r = await postJson("/api/report", { name: "Chairside", website: "chairside.io", category: "dental scheduling", audience: "dentists", email: "Doc@Clinic.com" });
const rj = await r.json();
check(r.status === 200 && /\/r\/a[a-z0-9]{11}$/.test(rj.url), "free report returns a report link");
const pubAudit = JSON.parse(store.get(`audit:${rj.url.split("/r/")[1]}`));
check(pubAudit.engines.length === 3, "free reports use at most 3 engines (cost guard)");
check(emails.some((e) => e.to[0] === "doc@clinic.com" && e.text.includes(rj.url)), "the requester gets the report by email");
check(emails.some((e) => e.to[0] === env.OWNER_EMAIL && e.subject.startsWith("Free report")), "you get told about every free report");
await postJson("/api/report", { name: "Chairside", website: "chairside.io", category: "dental scheduling", email: "doc@clinic.com" });
r = await postJson("/api/report", { name: "Chairside", website: "chairside.io", category: "dental scheduling", email: "doc@clinic.com" });
check(r.status === 429, "the same email can't run unlimited free reports");
const before = calls.length;
env.AUDIT_DAILY_CAP = "0";
r = await postJson("/api/report", { name: "Other", website: "other.com", category: "dental scheduling", email: "new@clinic.com" }, { "CF-Connecting-IP": "9.9.9.9" });
check(r.status === 503 && calls.length === before, "the daily cap stops free reports before any AI is called");
delete env.AUDIT_DAILY_CAP;

// ---------- batch for outreach ----------
r = await postJson("/api/audit/batch", { companies: [{ name: "X", category: "y" }] });
check(r.status === 404, "batch reports need the admin token");
r = await postJson("/api/audit/batch", { companies: [{ name: "Chairside", website: "chairside.io", category: "dental scheduling", questions: ["best dental scheduling software?"] }, { name: "", category: "x" }], engines: ["openai", "perplexity"] }, { Authorization: `Bearer ${env.ADMIN_TOKEN}` });
const bj = await r.json();
check(r.status === 200 && bj.results.length === 2, "batch returns one row per company");
check(bj.results[0].engine === "ChatGPT" && bj.results[0].namedInstead[0] === "Weave" && bj.results[0].question === "best dental scheduling software?", "batch gives what an outreach email needs: question, engine, who was named instead");
check(!!bj.results[1].error, "a bad row in a batch doesn't stop the rest");

// ---------- plans: checkout ----------
r = await postJson("/api/ai/checkout", { plan: "gold" });
check(r.status === 400, "unknown plan is refused");
r = await postJson("/api/ai/checkout", { plan: "growth", email: "owner@chairside.io", reportId: auditId });
const cj = await r.json();
check(cj.url.startsWith("https://checkout.stripe.com"), "checkout returns the Stripe page");
const sp = stripeCalls.at(-1).params;
check(sp.get("mode") === "subscription" && sp.get("line_items[0][price_data][unit_amount]") === "49700" && sp.get("line_items[0][price_data][recurring][interval]") === "month", "Growth is $497 a month");
const clientId = sp.get("metadata[aiClientId]");
check(/^c[a-z0-9]{11}$/.test(clientId) && sp.get("subscription_data[metadata][aiClientId]") === clientId, "the client id rides along on the subscription");
check(sp.get("custom_text[submit][message]").includes("3 days before every renewal"), "checkout promises the renewal reminder");
check(sp.get("cancel_url") === "https://vantryai.com/ai/#plans", "backing out returns to the plans");

// ---------- plans: paid ----------
emails.length = 0;
await webhook({ type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "paid", metadata: { aiClientId: clientId, aiPlan: "growth" }, customer: "cus_1", subscription: "sub_1", customer_details: { email: "owner@chairside.io", name: "Dana Smith" } } } });
const client = JSON.parse(store.get(`aic:${clientId}`));
check(client.status === "active" && client.stripe.subscription === "sub_1", "paid client is active");
const welcome = emails.find((e) => e.to[0] === "owner@chairside.io");
check(welcome && welcome.text.includes(`/start/${clientId}`) && welcome.text.includes("Hi Dana"), "welcome email has the onboarding link");
check(welcome.text.includes("Day 60") && welcome.text.includes("refund"), "welcome email states the timeline, guarantee and refund");
check(emails.some((e) => e.to[0] === env.OWNER_EMAIL && e.subject.includes("New AI client")), "you get told about new clients");
const wp = await (await call(`/ai/welcome/${clientId}`)).text();
check(wp.includes("You're in.") && wp.includes(`/start/${clientId}`), "welcome page links to onboarding");
await webhook({ type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "paid", metadata: { aiClientId: clientId }, customer_details: { email: "owner@chairside.io" } } } });
check(emails.filter((e) => e.to[0] === "owner@chairside.io").length === 1, "a repeated Stripe event doesn't send a second welcome");

// ---------- renewal reminder ----------
emails.length = 0;
const due = Math.floor(Date.UTC(2026, 10, 20, 15) / 1000);
await webhook({ type: "invoice.upcoming", data: { object: { customer_email: "owner@chairside.io", amount_due: 49700, next_payment_attempt: due, subscription_details: { metadata: { aiClientId: clientId } } } } });
const remind = emails.find((e) => e.to[0] === "owner@chairside.io");
check(remind && remind.subject.includes("November 20") && remind.text.includes("$497"), "reminder email states the renewal date and amount");
check(remind.text.includes("cancel"), "reminder email says how to cancel");
env.STRIPE_PORTAL_LINK = "https://billing.stripe.com/p/login/test";
emails.length = 0;
await webhook({ type: "invoice.upcoming", data: { object: { customer_email: "owner@chairside.io", amount_due: 49700, next_payment_attempt: due, subscription_details: { metadata: { aiClientId: clientId } } } } });
check(emails[0].text.includes("https://billing.stripe.com/p/login/test"), "with a portal link set, cancel is one click");
emails.length = 0;
await webhook({ type: "invoice.upcoming", data: { object: { customer_email: "site@owner.com", amount_due: 5000, subscription_details: { metadata: { orderId: "o123" } } } } });
check(emails.length === 0, "website customers don't get AI plan reminders");

// ---------- onboarding ----------
const of = await (await call(`/start/${clientId}`)).text();
check(of.includes("Tell us about your business") && of.includes("owner@chairside.io"), "onboarding form loads with their email filled in");
emails.length = 0;
const op = await call(`/start/${clientId}`, form({ business: "Chairside Scheduling", website: "chairside.io", sell: "Scheduling for dentists", buyers: "2-5 dentist practices", competitors: "Weave, NexHealth", questions: "Does it text patients?\nBest dental scheduling app", avoid: "", reportEmail: "owner@chairside.io" }));
check(op.status === 200 && (await op.text()).includes("We're on it"), "onboarding form submits");
check(JSON.parse(store.get(`aic:${clientId}`)).onboarding.competitors === "Weave, NexHealth", "onboarding answers are saved");
check(emails.some((e) => e.to[0] === env.OWNER_EMAIL && e.text.includes("Weave, NexHealth")), "you get the onboarding answers by email");
check((await call("/start/c00000000000")).status === 404, "unknown onboarding link is a 404");

// ---------- delivery: starting report, monthly report, fix list, 60-day promise ----------
const cl = () => JSON.parse(store.get(`aic:${clientId}`));
const tick = async () => { await runClientDelivery(env); };
let c1 = cl();
check(c1.questions.length === 4 && c1.questions[0] === "Does it text patients?" && c1.questions[1] === "Best dental scheduling app?", "tracked questions start with the client's own questions");
check(c1.questions.length <= 25 && !c1.questions.some((q) => /chairside/i.test(q)), "AI fills the rest (Growth allows 25) and never uses their own name");
check(c1.job && c1.job.pairs.length === 16 && c1.job.kind === "baseline", "the starting report is queued (questions x engines)");
emails.length = 0;
env.DELIVERY_BUDGET = "5";
await tick();
c1 = cl();
check(c1.job.next === 5 && !(c1.audits || []).length, "big checks run in small pieces on the timer");
await tick(); await tick(); await tick();
c1 = cl();
check(!c1.job && c1.audits.length === 1 && c1.audits[0].kind === "baseline", "the starting report finishes over a few timer runs");
const startMail = emails.find((e) => e.to[0] === "owner@chairside.io");
check(startMail && startMail.subject.startsWith("Your starting AI visibility report") && startMail.text.includes("/r/a"), "the client gets their starting report by email");
check(startMail.text.includes("GPTBot") && startMail.text.includes("llms.txt") && startMail.text.includes("structured data"), "the fix list comes from a real check of their website");
check(!startMail.text.includes("pricing page"), "fixes they already have (a pricing page) aren't listed");
check(startMail.text.includes("What we're working on this month"), "Growth clients see it as work we're doing for them");
check(emails.some((e) => e.to[0] === env.OWNER_EMAIL && e.subject.startsWith("To do:")), "you get the to-do list for done-for-you clients");
emails.length = 0;
await tick();
check(emails.length === 0 && !cl().job, "nothing runs again until a month has passed");

// a month later, ChatGPT starts naming them
let cc = cl(); cc.audits[0].at -= 31 * 86400000; store.set(`aic:${clientId}`, JSON.stringify(cc));
chatgptNamesUs = true;
env.DELIVERY_BUDGET = "20";
await tick();
cc = cl();
check(cc.audits.length === 2 && cc.audits[1].kind === "monthly", "a fresh report runs every 30 days");
const monthMail = emails.find((e) => e.to[0] === "owner@chairside.io");
check(monthMail && monthMail.text.includes("last month:") && monthMail.text.includes("New this month") && monthMail.text.includes("(ChatGPT)"), "the monthly email compares with last month and lists new answers");

// 60-day promise: kept, because new answers appeared
cc.startedAt -= 61 * 86400000; store.set(`aic:${clientId}`, JSON.stringify(cc));
const stripeBefore = stripeCalls.length;
await tick();
check(cl().promise && cl().promise.kept === true && stripeCalls.length === stripeBefore, "60-day promise: kept when new answers appeared, no free month needed");

// 60-day promise: a client with no new answers gets a free month
const c2 = { ...cl(), id: "c2xxxxxxxxxx", promise: undefined, stripe: { subscription: "sub_2" }, audits: [] };
c2.audits = [{ ...cl().audits[0], at: Date.now() - 2 * 86400000 }, { ...cl().audits[0], kind: "monthly", at: Date.now() - 86400000 }];
store.set(`aic:${c2.id}`, JSON.stringify(c2));
store.set("aiclients:index", JSON.stringify([c2.id, clientId]));
emails.length = 0;
await tick();
const c2s = JSON.parse(store.get(`aic:${c2.id}`));
const sub = stripeCalls.find((x) => x.path === "/v1/subscriptions/sub_2");
check(c2s.promise && c2s.promise.kept === false && c2s.promise.freeMonth === true, "60-day promise: no new answers means the next month is made free");
check(stripeCalls.some((x) => x.path === "/v1/coupons" && x.params.get("percent_off") === "100" && x.params.get("duration") === "once") && sub && sub.params.get("discounts[0][coupon]"), "the free month is a one-time 100% Stripe discount on their subscription");
check(emails.some((e) => e.subject === "Your next month is on us") && emails.some((e) => e.subject.startsWith("Applied: 60-day promise")), "client and you both hear about the free month");
await tick();
check(stripeCalls.filter((x) => x.path === "/v1/subscriptions/sub_2").length === 1, "the free month is given only once");
await worker.scheduled({}, env, ctx); await Promise.all(ctx.waits.splice(0));
check(true, "the cron runs client delivery without errors");

// ---------- cancel ----------
emails.length = 0;
await webhook({ type: "customer.subscription.deleted", data: { object: { id: "sub_1", metadata: { aiClientId: clientId } } } });
check(JSON.parse(store.get(`aic:${clientId}`)).status === "canceled", "canceled subscription marks the client canceled");
check(emails.some((e) => e.subject.includes("canceled")), "you get told about cancellations");
const adm = await (await call(`/admin/audits?token=${env.ADMIN_TOKEN}`)).text();
check(adm.includes("owner@chairside.io") && adm.includes("Chairside Scheduling"), "admin shows clients and recent reports");

console.log(`\n${count} checks. ${ok ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}`);
process.exit(ok ? 0 : 1);
