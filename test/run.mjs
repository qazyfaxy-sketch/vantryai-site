// End-to-end test of the whole back end with fake AI, Stripe, Cloudflare, email and storage.
// Run: node test/run.mjs
import worker from "../src/worker.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { signPayload } from "../src/lib/stripe.js";
import { suggestDomains, cleanDomain } from "../src/lib/domains.js";
import { registrarPhone } from "../src/lib/cloudflare.js";
import { writeFileSync, mkdirSync } from "node:fs";

let ok = true;
let count = 0;
const check = (cond, msg) => {
  count++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) ok = false;
};

// ---------- fake services ----------
const fakeCopy = {
  headline: "A yard you're proud to come home to",
  subheadline: "Lawn care, cleanups, and landscaping for homeowners in Columbus and nearby towns. Free quotes, fast replies.",
  ctaText: "Get a free quote",
  services: [
    { name: "Lawn mowing", description: "Weekly or every-other-week mowing, edging, and cleanup." },
    { name: "Spring & fall cleanup", description: "Leaves, branches, and beds cleared." },
    { name: "Mulch & bed edging", description: "Fresh mulch and clean edges." },
  ],
  about: "Green Ridge Lawn Care is a local crew serving Columbus homeowners.",
  serviceAreas: ["Columbus", "Westerville", "Dublin"],
  faqs: [{ q: "Do you offer free estimates?", a: "Yes. Send us a quick message." }],
  seoTitle: "Green Ridge Lawn Care | Lawn Care in Columbus, OH",
  seoDescription: "Lawn mowing, cleanups, and mulching for Columbus homeowners.",
};

const calls = [];
const imageCalls = [];
const emails = [];
let stripeSessions = [];
let regState = "in_progress"; // what the registrar reports for new registrations
let regFails = false;
let hostnameActive = false;
const taken = new Set(["greenridgelawncare.com"]);
const zones = {};

const ok200 = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });

globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = opts.method || "GET";
  calls.push(`${method} ${url.host}${url.pathname}`);
  const body = opts.body ? (typeof opts.body === "string" ? opts.body : opts.body.toString()) : "";

  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(body);
    if (!b.system.includes("Never invent licenses")) throw new Error("system prompt missing rules");
    return ok200({ content: [{ type: "text", text: JSON.stringify(fakeCopy) }] });
  }
  if (url.host === "api.openai.com") {
    imageCalls.push(JSON.parse(body));
    const jpg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3));
    return ok200({ data: [{ b64_json: jpg }] });
  }
  if (url.host === "api.resend.com") {
    emails.push(JSON.parse(body));
    return ok200({ id: "em_1" });
  }
  if (url.host === "api.stripe.com") {
    const p = new URLSearchParams(body);
    if (url.pathname === "/v1/checkout/sessions") {
      const id = `cs_${stripeSessions.length + 1}`;
      stripeSessions.push({ id, params: p });
      return ok200({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    if (url.pathname === "/v1/subscriptions/sub_2") return ok200({ id: "sub_2", items: { data: [{ price: { id: "price_49", product: "prod_1" } }] } });
    if (url.pathname === "/v1/subscription_schedules") return ok200({ id: "sub_sched_1", phases: [{ start_date: 1700000000 }] });
    if (url.pathname === "/v1/subscription_schedules/sub_sched_1") {
      stripeSessions.push({ id: "schedule-update", params: p });
      return ok200({ id: "sub_sched_1" });
    }
  }
  if (url.host === "api.cloudflare.com") {
    const path = url.pathname.replace("/client/v4", "");
    if (path.endsWith("/registrar/domain-check")) {
      const { domains } = JSON.parse(body);
      return ok200({
        success: true,
        result: {
          domains: domains.map((name) => {
            if (taken.has(name)) return { name, registrable: false, reason: "domain_unavailable" };
            if (name.startsWith("fancy")) return { name, registrable: true, tier: "premium", pricing: { currency: "USD", registration_cost: "2500.00", renewal_cost: "2500.00" } };
            return { name, registrable: true, tier: "standard", pricing: { currency: "USD", registration_cost: "10.44", renewal_cost: "10.44" } };
          }),
        },
      });
    }
    if (path.endsWith("/registrar/registrations") && method === "POST") {
      const b = JSON.parse(body);
      calls.push(`registrant:${b.contacts ? b.contacts.registrant.phone : "default"}`);
      if (regFails) return ok200({ success: false, errors: [{ code: 1000, message: "registry said no" }] });
      return ok200({ success: true, result: { domain_name: b.domain_name, state: regState, completed: regState === "succeeded" } });
    }
    if (path.includes("/registration-status")) {
      if (regFails) return ok200({ success: true, result: { state: "failed", error: { message: "registry said no" } } });
      return ok200({ success: true, result: { state: regState, completed: regState === "succeeded" } });
    }
    if (path === "/zones" && method === "GET") {
      const n = url.searchParams.get("name");
      return ok200({ success: true, result: zones[n] ? [{ id: zones[n] }] : [] });
    }
    if (path === "/zones" && method === "POST") {
      const b = JSON.parse(body);
      zones[b.name] = `zone_${b.name}`;
      return ok200({ success: true, result: { id: zones[b.name] } });
    }
    if (path.endsWith("/dns_records") || path.endsWith("/workers/routes")) {
      return ok200({ success: true, result: method === "GET" ? [] : { id: "x" } });
    }
    if (path.endsWith("/analytics_engine/sql")) {
      calls.push(`sql:${body.includes("index1 = '") ? "site" : "?"}`);
      const today = new Date().toISOString().slice(0, 10) + " 00:00:00";
      return ok200({ data: [{ event: "view", day: today, n: 42 }, { event: "call", day: today, n: 3 }] });
    }
    if (path.endsWith("/custom_hostnames")) {
      if (method === "GET") return ok200({ success: true, result: hostnameActive ? [{ id: "ch1", status: "active", ssl: { status: "active" } }] : [] });
      return ok200({ success: true, result: { id: "ch1", status: "pending", ssl: { status: "pending_validation" } } });
    }
  }
  throw new Error(`Unexpected fetch ${method} ${url}`);
};

// In-memory KV with list() support
const store = new Map();
const kv = {
  get: async (k) => store.get(k) ?? null,
  getWithMetadata: async (k) => ({ value: store.get(k) ?? null, metadata: store.get(`meta:${k}`) ?? null }),
  put: async (k, v, o) => { store.set(k, v); if (o?.metadata) store.set(`meta:${k}`, o.metadata); },
  delete: async (k) => void store.delete(k),
  list: async ({ prefix = "" } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};

const env = {
  ANTHROPIC_API_KEY: "test",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  CF_API_TOKEN: "cf_test",
  CF_ACCOUNT_ID: "acct1",
  CF_SAAS_ZONE_ID: "zone_saas",
  WORKER_NAME: "vantry",
  RESEND_API_KEY: "re_test",
  ADMIN_TOKEN: "admin-secret-123",
  OWNER_EMAIL: "booking@vantryai.com",
  ALLOWED_ORIGIN: "https://vantryai.com",
  PUBLIC_API: "https://api.vantryai.com",
  API_HOST: "api.vantryai.com",
  SAAS_CNAME_TARGET: "sites.vantryai.com",
  PREVIEWS: kv,
  STATS: { writeDataPoint: (d) => statPoints.push(d) },
};
const statPoints = [];

const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const flush = async () => {
  while (pending.length) await pending.shift();
};
const API = "https://api.vantryai.com";
const PW = "mowing-2026!";
const req = (path, opts = {}, host = API) => new Request(host + path, opts);
const call = async (path, opts, host) => {
  const r = await worker.fetch(req(path, opts, host), env, ctx);
  await flush();
  return r;
};
const postJson = (path, body, headers = {}) =>
  call(path, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.1.1.1", ...headers }, body: JSON.stringify(body) });
const webhook = async (event, secret = env.STRIPE_WEBHOOK_SECRET) => {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = await signPayload(secret, t, body);
  return call("/api/stripe/webhook", { method: "POST", headers: { "Stripe-Signature": `t=${t},v1=${sig}` }, body });
};
const cron = async () => {
  await worker.scheduled({}, env, ctx);
  await flush();
};
const order = (id) => JSON.parse(store.get(`order:${id}`));
const emailTo = (to, subj) => emails.find((e) => e.to[0] === to && e.subject.includes(subj));

// ---------- unit checks ----------
check(suggestDomains("Green Ridge Lawn Care", "Columbus").includes("greenridgelawncare.com"), "suggests domains from the business name");
check(suggestDomains("Maple & Moss Landscaping LLC", "Cleveland, Ohio").includes("mapleandmosslandscaping.com"), "suggestions handle & and LLC");
check(cleanDomain("https://www.Green-Ridge.com/about") === "green-ridge.com", "cleans typed domains");
check(registrarPhone("+16145550142") === "+1.6145550142", "formats phone for the registrar");
check(buildSystemPrompt("landscaping").includes("Snow removal"), "landscaping knowledge loaded");

// ---------- 1. previews ----------
const survey = {
  businessName: "Green Ridge Lawn Care", city: "Columbus", serviceAreas: "Westerville, Dublin",
  services: "Lawn mowing, spring and fall cleanup, mulch and edging", phone: "(614) 555-0142",
  email: "Owner@GreenRidge.test", trade: "landscaping",
};
const r1 = await postJson("/api/preview", survey);
const d1 = await r1.json();
check(r1.status === 200 && d1.previews?.modern, "survey creates 3 preview links");
check(calls.filter((c) => c.includes("anthropic")).length === 1, "only 1 AI call for all 3 styles");
check(r1.headers.get("Access-Control-Allow-Origin") === "https://vantryai.com", "preview API only allows vantryai.com");

mkdirSync("test/out", { recursive: true });
for (const style of ["modern", "editorial", "minimal"]) {
  const res = await call(new URL(d1.previews[style]).pathname + `?style=${style}`);
  const page = await res.text();
  check(res.status === 200 && page.includes("Green Ridge Lawn Care") && page.includes(`/go/${d1.id}?style=${style}`), `${style} preview renders with "Make it live" going to domain picker`);
  check(page.includes('name="robots" content="noindex"') && page.includes("This is a preview"), `${style} preview is hidden from Google and its form explains it's a preview`);
  writeFileSync(`test/out/preview-${style}.html`, page);
}

check((await postJson("/api/preview", { ...survey, company: "spam" })).status === 400, "bots filling the hidden field are rejected");
await postJson("/api/preview", survey);
check((await postJson("/api/preview", survey)).status === 429, "3rd preview for the same email is blocked");
check((await postJson("/api/preview", { ...survey, email: "", businessName: "" })).status === 400, "missing fields rejected");
for (let i = 0; i < 4; i++) await postJson("/api/preview", { ...survey, email: `x${i}@y.test` }, { "CF-Connecting-IP": "9.9.9.9" });
check((await postJson("/api/preview", { ...survey, email: "x9@y.test" }, { "CF-Connecting-IP": "9.9.9.9" })).status === 200, "5th preview per IP per hour still allowed");
await postJson("/api/preview", { ...survey, email: "x10@y.test" }, { "CF-Connecting-IP": "9.9.9.9" });
check((await postJson("/api/preview", { ...survey, email: "x11@y.test" }, { "CF-Connecting-IP": "9.9.9.9" })).status === 429, "7th preview from one IP in an hour is blocked");

const r5 = await postJson("/api/preview", { ...survey, email: "safe@y.test", businessName: "<script>alert(1)</script>" }, { "CF-Connecting-IP": "2.2.2.2" });
const d5 = await r5.json();
const h5 = await (await call(new URL(d5.previews.modern).pathname)).text();
check(!h5.includes("<script>alert(1)</script>"), "user input is escaped");
check((await call("/p/zzzzzzzzzz")).status === 404, "unknown preview returns 404");

// ---------- 1b. any type of business ----------
const salonPrompt = buildSystemPrompt("Hair salon");
check(salonPrompt.includes("Hair salon") && !salonPrompt.includes("Snow removal"), "non-yard businesses don't get landscaping instructions");
check(buildSystemPrompt("Lawn care, Snow removal").includes("Snow removal"), "yard businesses still get landscaping know-how");
const pSalon = await (await postJson("/api/preview", { ...survey, businessName: "Shear Joy Salon", email: "joy@salon.test", trade: "Hair salon, Barbershop" }, { "CF-Connecting-IP": "5.5.5.5" })).json();
const salonPage = await (await call(new URL(pSalon.previews.modern).pathname + "?style=modern")).text();
check(salonPage.includes("Make it live – $199.99") && !salonPage.includes("your yard") && !salonPage.includes("stroke=\"#F3EBD3\""), "salon preview has no yard wording or landscape picture, and shows $199.99");

// ---------- 2. domain picker ----------
const go = await call(`/go/${d1.id}?style=editorial`);
const goHtml = await go.text();
check(go.status === 200 && goHtml.includes("Pick your web address") && goHtml.includes("greenridgelawncare.com"), "domain picker page shows suggestions");
check(goHtml.includes('value="editorial" checked'), "domain picker keeps the chosen style");

const dc = await (await call(`/api/domains/check?id=${d1.id}&names=greenridgelawncare.com,greenridgelawn.com,fancyname.com`)).json();
const byName = Object.fromEntries(dc.results.map((r) => [r.name, r]));
check(byName["greenridgelawncare.com"].available === false, "taken domain shows as taken");
check(byName["greenridgelawn.com"].included === true, "normal .com is available and included");
check(byName["fancyname.com"].available && !byName["fancyname.com"].included, "premium names aren't included");
check(!JSON.stringify(dc).includes("10.44"), "domain prices are never sent to the page");
const ds = await (await call(`/api/domains/check?id=${d1.id}&q=green ridge mowing`)).json();
check(ds.results.some((r) => r.name === "greenridgemowing.com") && ds.results.some((r) => r.name === "greenridgemowing.net"), "search turns words into .com/.net/.co/.org options");
check((await call(`/api/domains/check?id=nopenopeno&q=x`)).status === 400, "domain search needs a real preview");

// ---------- 3. checkout: new domain, pay once ----------
check((await postJson("/api/checkout", { password: PW, previewId: d1.id, style: "editorial", plan: "once", domainMode: "new", domain: "greenridgelawncare.com" })).status === 409, "can't buy a taken domain");
check((await postJson("/api/checkout", { password: PW, previewId: d1.id, style: "editorial", plan: "once", domainMode: "new", domain: "fancyname.com" })).status === 409, "can't pick a premium domain");
check((await postJson("/api/checkout", { password: PW, previewId: d1.id, plan: "once", domainMode: "new", domain: "not a domain" })).status === 400, "rejects nonsense domains");

const co = await postJson("/api/checkout", { password: PW, previewId: d1.id, style: "editorial", plan: "once", domainMode: "new", domain: "GreenRidgeLawn.com" });
const coj = await co.json();
check(co.status === 200 && coj.url.startsWith("https://checkout.stripe.com/"), "checkout returns a Stripe page");
const s1 = stripeSessions[0].params;
const orderId1 = s1.get("metadata[orderId]");
check(s1.get("mode") === "subscription", "pay-once uses a subscription so the $50/year renews automatically");
check(s1.get("line_items[0][price_data][unit_amount]") === "14999" && !s1.has("line_items[0][price_data][recurring][interval]"), "$149.99 one-time build fee");
check(s1.get("line_items[1][price_data][unit_amount]") === "5000" && s1.get("line_items[1][price_data][recurring][interval]") === "year", "$50/year hosting (so $199.99 today)");
check(s1.get("customer_email") === "owner@greenridge.test" && s1.get("billing_address_collection") === "required", "prefills email and collects address for the domain");
check(order(orderId1).status === "checkout" && order(orderId1).domain.name === "greenridgelawn.com", "order saved before payment");

// ---------- 4. webhook ----------
const session1 = {
  id: "cs_1", object: "checkout.session", mode: "subscription", payment_status: "paid",
  metadata: { orderId: orderId1 }, client_reference_id: orderId1, customer: "cus_1", subscription: "sub_1",
  customer_details: { name: "Pat Green", email: "owner@greenridge.test", phone: "+16145550142", address: { line1: "1 Main St", city: "Columbus", state: "OH", postal_code: "43215", country: "US" } },
};
check((await webhook({ type: "checkout.session.completed", data: { object: session1 } }, "wrong_secret")).status === 400, "webhook with a fake signature is rejected");
check(order(orderId1).status === "checkout", "fake webhook changed nothing");

const w1 = await webhook({ type: "checkout.session.completed", data: { object: session1 } });
check(w1.status === 200, "real webhook accepted");
check(order(orderId1).status === "domain_registering", "after payment, domain registration starts");
check(calls.includes("registrant:+1.6145550142"), "domain registered with the customer's own contact details");
check(store.has(`pending:${orderId1}`), "order queued for the 10-minute check");
check(!!emailTo("owner@greenridge.test", "Payment received") && !!emailTo("booking@vantryai.com", "New order"), "customer and you both get emails");

const before = emails.length;
await webhook({ type: "checkout.session.completed", data: { object: session1 } });
check(emails.length === before, "a repeated webhook doesn't double-process");

const comingSoon = await call("/", {}, "https://www.greenridgelawn.com");
check((await comingSoon.text()).includes("almost ready"), "domain shows 'coming soon' before approval");

const thanks = await call(`/thanks/${orderId1}`);
check((await thanks.text()).includes("registering your domain"), "thank-you page shows progress");

// ---------- 5. cron finishes registration ----------
regState = "succeeded";
await cron();
check(order(orderId1).status === "needs_review", "once registered, the order waits for your review");
check(zones["greenridgelawn.com"] && calls.some((c) => c.includes("/dns_records")) && calls.some((c) => c.includes("/workers/routes")), "domain is pointed at the site automatically");
check(!store.has(`pending:${orderId1}`), "order leaves the queue");

// ---------- 6. admin ----------
check((await call("/admin")).status === 404, "admin page hidden without the token");
check((await call("/admin?token=wrong")).status === 404, "admin page hidden with a wrong token");
const adm = await (await call(`/admin?token=${env.ADMIN_TOKEN}`)).text();
check(adm.includes("Green Ridge Lawn Care") && adm.includes("Ready for your review"), "admin lists the order");
const adminSite = await call(`/admin/site/${orderId1}?token=${env.ADMIN_TOKEN}`);
check(adminSite.status === 200 && (await adminSite.text()).includes("A yard you"), "you can view the site before approving");

const form = (fields) => {
  const f = new URLSearchParams(fields);
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: f.toString() };
};
const ap = await (await call("/admin/action", form({ token: env.ADMIN_TOKEN, orderId: orderId1, action: "approve" }))).text();
check(ap.includes("is live") && order(orderId1).status === "live", "one click approves and puts the site live");
check(!!emailTo("owner@greenridge.test", "Your website is live"), "customer is told their site is live");

// ---------- 7. live site + quote form ----------
const apex = await call("/", {}, "https://greenridgelawn.com");
check(apex.status === 301 && apex.headers.get("Location") === "https://www.greenridgelawn.com/", "domain.com redirects to www.domain.com");
const live = await call("/", {}, "https://www.greenridgelawn.com");
const liveHtml = await live.text();
check(live.status === 200 && liveHtml.includes(`data-site="${orderId1}"`) && !liveHtml.includes("Make it live"), "live site serves with a working quote form and no preview bar");
check(liveHtml.includes("Website by <a href=\"https://vantryai.com/?ref=site\""), "live sites carry a small 'Website by Vantry' link");
check(liveHtml.includes('"@type":"LocalBusiness"') && liveHtml.includes('rel="canonical" href="https://www.greenridgelawn.com/"'), "live site has Google business info");
check((await (await call("/robots.txt", {}, "https://www.greenridgelawn.com")).text()).includes("sitemap.xml"), "robots.txt and sitemap for Google");
check(liveHtml.includes('"@type":"OfferCatalog"') && liveHtml.includes('"@type":"Service"'), "live site lists its services for AI assistants");
const llms = await (await call("/llms.txt", {}, "https://www.greenridgelawn.com")).text();
check(llms.startsWith("# ") && llms.includes("## Services") && llms.includes("https://www.greenridgelawn.com/"), "live site has an AI-readable summary at /llms.txt");

const leadOk = await postJson("/api/lead", { siteId: orderId1, name: "Sam", contact: "sam@example.com", details: "Weekly mowing" });
check(leadOk.status === 200 && leadOk.headers.get("Access-Control-Allow-Origin") === "*", "quote form accepted from the customer's domain");
const leadMail = emailTo("owner@greenridge.test", "New quote request");
check(!!leadMail && leadMail.text.includes("Weekly mowing") && leadMail.reply_to === "sam@example.com", "owner gets the lead by email and can just hit reply");
const leadsBefore = emails.length;
await postJson("/api/lead", { siteId: orderId1, name: "Bot", contact: "x", company: "spam" });
check(emails.length === leadsBefore, "spam bots filling the hidden field are ignored");

// ---------- 8. own domain + monthly plan ----------
const p2 = await (await postJson("/api/preview", { ...survey, businessName: "Buckeye Mowing", email: "pat@buckeye.test" }, { "CF-Connecting-IP": "3.3.3.3" })).json();
const co2 = await postJson("/api/checkout", { password: PW, previewId: p2.id, style: "modern", plan: "monthly", domainMode: "own", domain: "https://www.BuckeyeMowing.net/" });
check(co2.status === 200, "checkout works with a domain they already own");
const s2 = stripeSessions[stripeSessions.length - 1].params;
const orderId2 = s2.get("metadata[orderId]");
check(s2.get("line_items[0][price_data][unit_amount]") === "4900" && s2.get("line_items[0][price_data][recurring][interval]") === "month", "monthly plan is $49/month");
await webhook({ type: "checkout.session.completed", data: { object: { ...session1, id: "cs_2", metadata: { orderId: orderId2 }, client_reference_id: orderId2, subscription: "sub_2" } } });
const sched = stripeSessions.find((s) => s.id === "schedule-update").params;
check(sched.get("phases[0][iterations]") === "12" && sched.get("phases[1][items][0][price_data][recurring][interval]") === "year" && sched.get("phases[1][items][0][price_data][unit_amount]") === "5000", "monthly plan switches to $50/year after 12 payments");
check(order(orderId2).status === "waiting_dns", "own domain waits for the customer's DNS");
check(emailTo("pat@buckeye.test", "Payment received").text.includes("sites.vantryai.com"), "customer gets the exact DNS settings");
await call("/admin/action", form({ token: env.ADMIN_TOKEN, orderId: orderId2, action: "approve" }));
check(order(orderId2).status === "waiting_dns" && order(orderId2).approved, "approving early waits for DNS before going live");
hostnameActive = true;
await cron();
check(order(orderId2).status === "live", "goes live automatically once their DNS is connected");
check((await (await call("/", {}, "https://www.buckeyemowing.net")).text()).includes("Buckeye Mowing"), "their domain shows their site");

// ---------- 9. cancellation ----------
await webhook({ type: "customer.subscription.deleted", data: { object: { id: "sub_2", metadata: { orderId: orderId2 } } } });
const off = await call("/", {}, "https://www.buckeyemowing.net");
check(off.status === 503 && (await off.text()).includes("offline"), "when a plan ends, the site shows an offline page");
check((await postJson("/api/lead", { siteId: orderId2, name: "A", contact: "b@c.d" })).status === 400, "offline sites don't take quote requests");

// ---------- 9b. your own site passes through ----------
const passBefore = calls.length;
let passed = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, opts) => { const u = new URL(typeof input === "string" ? input : input.url); if (u.host === "vantryai.com") { passed = true; return new Response("github pages"); } return realFetch(input, opts); };
const own = await call("/", {}, "https://vantryai.com");
check(passed && (await own.text()) === "github pages", "vantryai.com itself is never touched by the engine");
globalThis.fetch = realFetch;

// ---------- 10. domain registration failure + retry ----------
const p3 = await (await postJson("/api/preview", { ...survey, businessName: "Riverbend Trees", email: "lee@river.test" }, { "CF-Connecting-IP": "4.4.4.4" })).json();
await postJson("/api/checkout", { password: PW, previewId: p3.id, plan: "once", domainMode: "new", domain: "riverbendtrees.com" });
const orderId3 = stripeSessions[stripeSessions.length - 1].params.get("metadata[orderId]");
regFails = true;
await webhook({ type: "checkout.session.completed", data: { object: { ...session1, id: "cs_3", metadata: { orderId: orderId3 }, client_reference_id: orderId3, subscription: "sub_3" } } });
check(order(orderId3).status === "domain_problem" && !!emailTo("booking@vantryai.com", "Domain setup for Riverbend"), "a failed registration emails you");
regFails = false;
regState = "succeeded";
await call("/admin/action", form({ token: env.ADMIN_TOKEN, orderId: orderId3, action: "retry" }));
check(order(orderId3).status === "needs_review", "'Retry setup' fixes it after the problem is solved");
check((await postJson("/api/checkout", { password: PW, previewId: d1.id, plan: "once", domainMode: "own", domain: "greenridgelawn.com" })).status === 409, "a domain already in use can't be bought twice");

// ---------- 11. customer accounts ----------
check((await postJson("/api/checkout", { previewId: p3.id, plan: "once", domainMode: "own", domain: "otherriver.com", password: "short" })).status === 400, "checkout needs a password for a new account");
check(!order(orderId1).pw && !JSON.stringify([...store.values()]).includes(PW), "passwords are never stored in plain text, and the hash leaves the order");
const acct1 = JSON.parse(store.get("account:owner@greenridge.test"));
check(acct1.siteIds.includes(orderId1) && acct1.hash && acct1.salt, "paying creates the customer's account");
const loginForm = (email, password, origin = API) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin, "CF-Connecting-IP": "7.7.7.7" }, body: new URLSearchParams({ email, password }).toString() });
check((await call("/account")).status === 303, "account page sends you to log in");
const bad = await call("/login", loginForm("owner@greenridge.test", "wrong-password"));
check(bad.status === 401 && !bad.headers.get("Set-Cookie"), "wrong password doesn't log in");
check((await call("/login", loginForm("owner@greenridge.test", PW, "https://evil.test"))).status === 403, "login form posted from another site is blocked");
const good = await call("/login", loginForm("Owner@GreenRidge.test", PW));
const cookie = (good.headers.get("Set-Cookie") || "").split(";")[0];
check(good.status === 303 && good.headers.get("Location") === "/account" && /^vs=[a-z0-9]{40}$/.test(cookie), "right password logs in (email any case)");
check((good.headers.get("Set-Cookie") || "").includes("HttpOnly") && (good.headers.get("Set-Cookie") || "").includes("Secure"), "login cookie is HttpOnly and Secure");
const authed = (path, opts = {}) => call(path, { ...opts, headers: { ...(opts.headers || {}), Cookie: cookie } });
const acctPage = await (await authed("/account")).text();
check(acctPage.includes("Green Ridge Lawn Care") && acctPage.includes(`/account/site/${orderId1}`), "account lists their site");
check((await authed(`/account/site/${orderId2}`)).status === 404, "you can't open someone else's site");
const ed = await (await authed(`/account/site/${orderId1}`)).text();
check(ed.includes('name="headline"') && ed.includes("A yard you") && ed.includes('name="palette"'), "editor shows their words, style and colors");
const edit = new URLSearchParams({ businessName: "Green Ridge Lawn Care", phone: "614-555-0199", city: "Columbus", leadEmail: "jobs@greenridge.test", headline: "Columbus lawns, done right", subheadline: "Weekly mowing and cleanups.", ctaText: "Book a mow", about: "Local crew.", serviceAreas: "Columbus\nDublin", sname0: "Lawn mowing", sdesc0: "Weekly.", sname1: "", fq0: "Free quotes?", fa0: "Yes.", style: "minimal", palette: "tech" });
const sv = await authed(`/account/site/${orderId1}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: API }, body: edit.toString() });
check(sv.status === 303, "saving edits works");
const liveNow = await (await call("/", {}, "https://www.greenridgelawn.com")).text();
check(liveNow.includes("Columbus lawns, done right") && liveNow.includes("Book a mow") && !liveNow.includes("Spring &amp; fall cleanup") && liveNow.includes("#0B1030"), "edits show on the live site right away (words, services, colors)");
await postJson("/api/lead", { siteId: orderId1, name: "Jo", contact: "jo@example.com", details: "Edging" }, { "CF-Connecting-IP": "8.8.8.8" });
check(!!emailTo("jobs@greenridge.test", "New quote request"), "quote requests go to the email they picked");
const emptyName = new URLSearchParams(edit); emptyName.set("businessName", "");
check((await authed(`/account/site/${orderId1}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: emptyName.toString() })).status === 400, "can't save an empty business name");
await authed(`/account/site/${orderId1}/undo`, { method: "POST" });
check((await (await call("/", {}, "https://www.greenridgelawn.com")).text()).includes("A yard you"), "undo brings back the version before the last save");
const lo = await authed("/logout", { method: "POST" });
check((await authed("/account")).status === 303, "after logging out, the old cookie no longer works");

// forgot password -> reset (also for sites made before accounts existed)
store.delete("account:pat@buckeye.test");
const fg = await call("/forgot", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "6.6.6.6" }, body: "email=pat%40buckeye.test" });
const resetMail = emailTo("pat@buckeye.test", "Reset your Vantry password");
check(fg.status === 200 && !!resetMail, "forgot password emails a reset link");
const nobody = emails.length;
await call("/forgot", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "6.6.6.5" }, body: "email=nobody%40x.test" });
check(emails.length === nobody, "no email is sent for addresses without a site (and the page looks the same)");
const tok = resetMail.text.match(/t=([a-z0-9]{40})/)[1];
const rs = await call("/reset", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: tok, password: "new-pass-123" }).toString() });
check(rs.status === 303 && JSON.parse(store.get("account:pat@buckeye.test")).siteIds.includes(orderId2), "reset sets the password and finds their existing site");
check((await call(`/reset?t=${tok}`)).status === 400, "a reset link only works once");
check((await call("/login", loginForm("pat@buckeye.test", "new-pass-123"))).status === 303, "they can log in with the new password");

// ---------- 12. editor: preview, photos, sections, AI, stats ----------
const c2 = (await call("/login", loginForm("owner@greenridge.test", PW))).headers.get("Set-Cookie").split(";")[0];
const as2 = (path, opts = {}) => call(path, { ...opts, headers: { ...(opts.headers || {}), Cookie: c2 } });
const edHtml = await (await as2(`/account/site/${orderId1}`)).text();
check(edHtml.includes('id="pv"') && edHtml.includes("Tell AI what to change") && edHtml.includes('id="secs"') && edHtml.includes("Add photos"), "editor has live preview, AI box, sections and photo upload");
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1]);
const up = await as2(`/account/site/${orderId1}/photo`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: jpeg });
const upj = await up.json();
check(up.status === 200 && /^[a-z0-9]{16}$/.test(upj.id), "photo upload works");
check((await as2(`/account/site/${orderId1}/photo`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new TextEncoder().encode("<html>not a photo") })).status === 400, "fake photos (not real image files) are rejected");
check((await call(`/account/site/${orderId1}/photo`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: jpeg })).status === 401, "can't upload without logging in");
const im = await call(`/img/${orderId1}/${upj.id}`);
check(im.status === 200 && im.headers.get("Content-Type") === "image/jpeg", "uploaded photos are served");
const base = new URLSearchParams({ businessName: "Green Ridge Lawn Care", phone: "614-555-0142", city: "Columbus", headline: "Fresh cuts weekly", subheadline: "Sub", ctaText: "Get a quote", about: "Local crew.", serviceAreas: "Columbus", hours: "Mon–Fri 8am–6pm\nSat 9am–1pm", sname0: "Mowing", sdesc0: "Weekly.", fq0: "Q?", fa0: "A.", style: "modern", palette: "forest", photos: `${upj.id},zzzzzzzzzzzzzzzz`, heroPhoto: upj.id, logo: upj.id,
  sections: JSON.stringify([{ id: "faq", show: true }, { id: "services", show: true }, { id: "gallery", show: true }, { id: "hours", show: true }, { id: "about", show: false }, { id: "quote", show: true }]) });
const prevRes = await as2(`/account/site/${orderId1}/preview`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: base.toString() });
const prevHtml = await prevRes.text();
check(prevRes.status === 200 && prevHtml.includes("Fresh cuts weekly") && prevHtml.includes(`/img/${orderId1}/${upj.id}`) && !prevHtml.includes("zzzzzzzzzzzzzzzz"), "preview shows unsaved changes and only this site's photos");
check(prevHtml.indexOf('id="faq"') < prevHtml.indexOf('id="services"') && !prevHtml.includes('id="about"') && prevHtml.includes("Sat 9am–1pm") && prevHtml.includes('class="hero has-photo"') && prevHtml.includes('class="logo-img"'), "sections follow the owner's order, hidden ones are gone, hours/top photo/logo show");
check(!(await (await call("/", {}, "https://www.greenridgelawn.com")).text()).includes("Fresh cuts weekly"), "preview doesn't change the live site until Save");
await as2(`/account/site/${orderId1}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: base.toString() });
const live2 = await call("/", { headers: { "User-Agent": "Mozilla/5.0 (iPhone)" } }, "https://www.greenridgelawn.com");
const live2Html = await live2.text();
check(live2Html.includes("Fresh cuts weekly") && live2Html.includes('id="photos"'), "after Save, the live site has the new words and photos");
check(statPoints.some((d) => d.blobs[0] === orderId1 && d.blobs[1] === "view"), "real visits are counted");
const pts = statPoints.length;
await call("/", { headers: { "User-Agent": "Googlebot/2.1" } }, "https://www.greenridgelawn.com");
check(statPoints.length === pts, "bots are not counted as visits");
const evt = await call("/api/event", { method: "POST", headers: { "Content-Type": "text/plain", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify({ siteId: orderId1, e: "call" }) });
check(evt.status === 200 && evt.headers.get("Access-Control-Allow-Origin") === "*" && statPoints.some((d) => d.blobs[1] === "call"), "call taps on the customer's site are counted");
check(live2Html.includes("/api/event"), "live site reports call and text taps");
const ai = await as2(`/account/site/${orderId1}/ai`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(base), instruction: "Make it friendlier" }).toString() });
const aij = await ai.json();
check(ai.status === 200 && aij.copy.headline === fakeCopy.headline && aij.copy.services.length === 3, "AI change returns new words for the form (not saved yet)");
const dash = await (await as2("/account")).text();
check(dash.includes("Last 30 days") && dash.includes(">42<") && dash.includes(">3<") && dash.includes("Quote requests"), "account shows visits, call taps and quote requests");
check(calls.includes("sql:site"), "stats are read only for that one site");

// ---------- 13. AI quality check ----------
import("../src/prompt.js").then(() => {});
const { qualityIssues, playbookFor } = await import("../src/prompt.js");
const inp = { businessName: "Fade Factory", city: "Columbus", services: "fades, beard trims", notes: "", phone: "" };
check(qualityIssues(fakeCopy, { ...inp, businessName: "Green Ridge Lawn Care", services: "mowing, cleanup, mulch" }).length === 0, "good copy passes the quality check");
const badCopy = { headline: "Elevate Your Look With Columbus's #1 Barbers!", subheadline: "x", ctaText: "Book", about: "With 15 years of experience, we are licensed and insured.", services: [{ name: "Fades", description: "Top-notch fades." }], faqs: [] };
const bi = qualityIssues(badCopy, inp).join(" | ");
check(/exclamation/.test(bi) && /elevate/.test(bi) && /#1/.test(bi) && /15/.test(bi) && /licensed/i.test(bi), "quality check catches hype words, made-up numbers and fake claims");
check(playbookFor("Barbershop").label.startsWith("Beauty") && playbookFor("Plumbing").label.startsWith("Home") && playbookFor("Food truck").label.startsWith("Food") && playbookFor("Underwater basket weaving").label === "Business" && playbookFor("Something else, Doula").label === "Family and care" && playbookFor("Escape room").label.startsWith("Entertainment"), "each business type gets its own playbook");
// a bad first draft gets sent back once for a fix
let aiCalls = 0;
const realFetch2 = globalThis.fetch;
globalThis.fetch = async (input, opts) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.host === "api.anthropic.com") {
    aiCalls++;
    const b = JSON.parse(opts.body);
    const draft = b.messages.length === 1 ? { ...fakeCopy, headline: "The Best Lawn Care, Guaranteed!" } : fakeCopy;
    if (b.messages.length === 3 && !b.messages[2].content.includes("exclamation")) throw new Error("fix request missing the problems");
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(draft) }] }), { status: 200 });
  }
  return realFetch2(input, opts);
};
const fixRes = await (await postJson("/api/preview", { ...survey, businessName: "Fixit Lawns", email: "fix@x.test" }, { "CF-Connecting-IP": "5.5.5.5" })).json();
globalThis.fetch = realFetch2;
const fixedPrev = JSON.parse(store.get(`preview:${fixRes.id}`));
check(aiCalls === 2 && fixedPrev.copy.headline === fakeCopy.headline, "a draft that breaks the rules is fixed by the AI before anyone sees it");

// ---------- 14. AI photos + monthly email ----------
const { queueSitePhoto, runImageJobs } = await import("../src/lib/images.js");
const { runMonthlyReports } = await import("../src/lib/reports.js");
check((await runImageJobs(env)) === 0 && imageCalls.length === 0, "AI photos stay off until the OpenAI key is added");
env.OPENAI_API_KEY = "sk-test";
env.IMAGE_DAILY_CAP = "100";
const site1Before = JSON.parse(store.get(`site:${orderId1}`));
await queueSitePhoto(env, orderId1);
const madeFirst = await runImageJobs(env);
const site1After = JSON.parse(store.get(`site:${orderId1}`));
check(madeFirst === 3 && site1After.aiPhoto && site1After.uploads.includes(site1After.aiPhoto), "paying customers get their own AI photo");
check(site1After.heroPhoto === site1Before.heroPhoto, "an AI photo never replaces a photo the owner picked");
check(imageCalls[0].prompt.includes("No text") && imageCalls[0].size === "1536x1024", "photo prompts ask for clean, text-free banner photos");
for (let i = 0; i < 20; i++) await runImageJobs(env);
const idx = JSON.parse(store.get("stock:index") || "[]");
check(idx.length === 26 && store.has("stock:beauty:1") && store.has("stock:general:2"), "category photos get made for every category, a few at a time");
const st = await call("/stock/beauty-1.jpg");
check(st.status === 200 && st.headers.get("Content-Type") === "image/jpeg", "category photos are served");
const beforeRuns = imageCalls.length;
await runImageJobs(env);
check(imageCalls.length === beforeRuns, "once every photo exists, no more images are made (no surprise costs)");
await new Promise((r) => setTimeout(r, 0));
const stockMod = await import("../src/lib/images.js");
const salonPrev2 = await (await call(`/p/${pSalon.id}?style=modern`)).text();
check(salonPrev2.includes("/stock/beauty-1.jpg"), "previews use the category photo");
delete env.OPENAI_API_KEY;
const repBefore = emails.length;
check((await runMonthlyReports(env, new Date("2026-11-15T15:00:00Z"))) === 0, "monthly email only goes out on the 1st");
const sentN = await runMonthlyReports(env, new Date("2026-11-01T15:00:00Z"));
const rep = emails.slice(repBefore).find((e) => e.subject.startsWith("Your website this month"));
check(sentN >= 1 && !!rep && rep.text.includes("quote request"), "live sites get a monthly results email");
check((await runMonthlyReports(env, new Date("2026-11-01T16:00:00Z"))) === 0, "the monthly email is only sent once");

// ---------- 15. follow-up emails for previews that didn't buy ----------
const { runNurture } = await import("../src/lib/nurture.js");
const pN = await (await postJson("/api/preview", { ...survey, businessName: "Nurture Nails", email: "nails@n.test", trade: "Nail salon" }, { "CF-Connecting-IP": "12.12.12.12" })).json();
check(store.has(`nurture:${pN.id}`), "making a preview starts the reminder emails");
const t0 = Date.now();
const toN = () => emails.filter((e) => e.to[0] === "nails@n.test").length;
const nb = toN();
await runNurture(env, t0 + 3600000);
check(toN() === nb, "no reminder in the first day");
await runNurture(env, t0 + 1.1 * 86400000);
const m1 = emails.filter((e) => e.to[0] === "nails@n.test").pop();
check(m1.to[0] === "nails@n.test" && m1.subject.includes("Nurture Nails") && m1.text.includes(`/go/${pN.id}`) && m1.text.includes(`/u/${pN.id}`), "day 1 reminder has their designs, a go-live link and an unsubscribe link");
await runNurture(env, t0 + 1.2 * 86400000);
check(toN() === nb + 1, "each reminder is sent once");
await runNurture(env, t0 + 3.1 * 86400000);
check(toN() === nb + 2, "day 3 reminder goes out");
const un = await call(`/u/${pN.id}`);
check(un.status === 200 && store.has("unsub:nails@n.test") && !store.has(`nurture:${pN.id}`), "one click unsubscribes");
await runNurture(env, t0 + 8 * 86400000);
check(toN() === nb + 2, "no more reminders after unsubscribing");
check(!store.has(`nurture:${d1.id}`), "people who bought get no reminders");

console.log(`\n${count} checks. ${ok ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}`);
process.exit(ok ? 0 : 1);
