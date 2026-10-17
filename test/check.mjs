// Tests for the setup-check page. Run: node test/check.mjs
import worker from "../src/worker.js";
import { configRows } from "../src/lib/check.js";
let ok = true, count = 0;
const check = (c, m) => { count++; console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) ok = false; };
const ok200 = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
const sent = [];
let stripeLive = false, resendLists = true;
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = opts.body ? String(opts.body) : "";
  if (url.host === "api.anthropic.com") return ok200({ content: [{ type: "text", text: '{"ok": true}' }] });
  if (url.host === "api.openai.com") return opts.headers.Authorization.includes("bad") ? new Response("no", { status: 401 }) : ok200({ data: [] });
  if (url.host === "api.stripe.com") return ok200({ object: "balance" });
  if (url.host === "api.github.com") return ok200({ id: 1 });
  if (url.host === "cloudflare-dns.com") {
    const n = url.searchParams.get("name"), t = url.searchParams.get("type");
    if (t === "MX") return ok200({ Status: 0, Answer: [{ type: 15, data: "10 mx.usevantry.com" }] });
    if (n.startsWith("_dmarc")) return ok200({ Status: 0 });
    return ok200({ Status: 0, Answer: [{ type: 16, data: '"v=spf1 include:amazonses.com ~all"' }] });
  }
  if (url.host === "api.resend.com" && url.pathname === "/domains") return resendLists ? ok200({ data: [{ name: "usevantry.com", status: "verified" }] }) : new Response("restricted", { status: 401 });
  if (url.host === "api.resend.com" && url.pathname === "/emails") { sent.push(JSON.parse(body)); return ok200({ id: "e1" }); }
  throw new Error(`Unexpected fetch ${url}`);
};
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k), list: async () => ({ keys: [], list_complete: true }) };
const env = { ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com", PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com", PREVIEWS: kv, ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", RESEND_API_KEY: "re", STRIPE_SECRET_KEY: "sk_test_x", GH_DISPATCH_TOKEN: "gh", OUTREACH_FROM: "Vince <vince@usevantry.com>", MAILING_ADDRESS: "1 Main St" };
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const call = (path, opts = {}) => worker.fetch(new Request("https://api.vantryai.com" + path, opts), env, ctx);
const post = (o) => ({ method: "POST", body: new URLSearchParams({ token: "admin-secret-123", ...o }) });

const rows = configRows(env);
check(rows.find((r) => r.name.startsWith("Free reports")).ok && !rows.find((r) => r.name.startsWith("Bounce")).ok, "setup list shows what's in and what's missing");
check(rows.find((r) => r.name.startsWith("Outreach")).ok && !rows.find((r) => r.name.startsWith("Payments")).ok, "payments show missing when the webhook secret isn't set");
check((await call("/admin/check")).status === 404 && (await call("/admin/check?token=x")).status === 404, "the page needs your token");
let p = await (await call("/admin/check?token=admin-secret-123")).text();
check(p.includes("Is everything set up?") && p.includes("RESEND_WEBHOOK_SECRET"), "the page names exactly what to add");
check(!p.includes("sk_test_x") && !p.includes("Bearer"), "no secret value is ever shown");
p = await (await call("/admin/check", post({ action: "live" }))).text();
check(p.includes("Anthropic (Claude)") && p.includes("key works") && p.includes("TEST mode"), "key tests report which keys work, and that Stripe is in test mode");
check(p.includes("usevantry.com is verified") && p.includes("usevantry.com: sender record (SPF)") && /spam policy \(DMARC\)<\/strong><br><span class="small muted">missing/.test(p), "it checks the outreach domain's email records and says what's missing");
check(p.includes("hasn&#39;t run yet") || p.includes("hasn't run yet"), "it says if the 10-minute timer has never run");
await worker.scheduled({}, env, ctx); await Promise.all(ctx.waits);
p = await (await call("/admin/check", post({ action: "live" }))).text();
check(p.includes("last ran 0 minutes ago"), "after the timer runs it shows a heartbeat");
resendLists = false;
p = await (await call("/admin/check", post({ action: "live" }))).text();
check(p.includes("send-only key"), "a send-only Resend key is handled");
p = await (await call("/admin/check", post({ action: "mail" }))).text();
check(sent.length === 1 && sent[0].to[0] === env.OWNER_EMAIL && sent[0].from.includes("usevantry.com") && p.includes("Sent a test"), "the test email goes only to you, from the outreach address");
const bak = env.MAILING_ADDRESS; delete env.MAILING_ADDRESS;
p = await (await call("/admin/check", post({ action: "mail" }))).text();
check(sent.length === 1 && p.includes("MAILING_ADDRESS"), "no test email without a mailing address");
env.MAILING_ADDRESS = bak;
check((await (await call("/admin/audits?token=admin-secret-123")).text()).includes("Is everything set up?"), "the main admin page links to the check");
console.log(`\n${count} checks`); process.exit(ok ? 0 : 1);
