// Tests for the prospect engine: intake, free check, fixed-wording emails, warm-up caps, bounces, pause.
// Run: node test/prospects.mjs
import worker from "../src/worker.js";
import { parseProspects, addProspects, buildEmail, dayCap, health } from "../src/lib/prospects.js";
import { runClientProspects } from "../src/ai.js";

let ok = true, count = 0;
const check = (cond, msg) => { count++; console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) ok = false; };

// ---------- parsing ----------
const p = parseProspects(`Company, website, email, first name, what they sell
Acme Scheduling, https://www.acme.com/, Jo@Acme.com, Jo, scheduling software for dental offices
Beta Books | beta.io | sam@beta.io
Noreply Inc, noreply.io, noreply@noreply.io
Bad Row, bad.io, nobody
Gamma, gamma.io, kim@gamma.io, <script>, `);
check(p.rows.length === 3 && p.rows[0].email === "jo@acme.com" && p.rows[0].domain === "acme.com" && p.rows[0].first === "Jo", "lines are parsed, emails lowercased, sites cleaned");
check(p.rows[1].first === "" && p.rows[2].first === "", "missing or odd first names are left blank");
check(p.bad.length === 2 && p.bad.some((b) => /noreply/.test(b)), "role addresses and bad rows are reported, not added");

// ---------- fake services ----------
const emails = [], hooks = [];
let noMx = new Set(), sayNamed = "", plainHosts = /^$/;
const answerText = () => `${sayNamed ? sayNamed + ", " : ""}Weave and NexHealth are common picks.`;
const ok200 = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = opts.body ? (typeof opts.body === "string" ? opts.body : opts.body.toString()) : "";
  if (url.host === "cloudflare-dns.com") {
    const n = url.searchParams.get("name");
    if (n === "dns-fail.io") return new Response("x", { status: 500 });
    return ok200(noMx.has(n) ? { Status: 0, Answer: [] } : { Status: 0, Answer: [{ type: 15, data: "10 mx." + n }] });
  }
  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(body);
    if (b.tools) { const a = answerText(); return ok200({ content: [{ type: "text", text: a, citations: [] }] }); }
    if (b.system.includes("sort replies")) { const m = b.messages[0].content; return ok200({ content: [{ type: "text", text: JSON.stringify(m.includes("Tuesday") ? { label: "interested", summary: "Wants to talk Tuesday." } : m.includes("How much") ? { label: "question", summary: "Asks about price." } : { label: "other", summary: "Unclear reply." }) }] }); }
    if (b.system.includes("exact questions")) return ok200({ content: [{ type: "text", text: JSON.stringify(["What is the best scheduling software for dental offices?", "Which scheduling app suits a small practice?", "Top dental booking tools?"]) }] });
    if (b.system.includes("list the companies")) {
      const items = JSON.parse(b.messages[0].content);
      return ok200({ content: [{ type: "text", text: JSON.stringify(items.map((x) => ({ i: x.i, named: ["Weave", "NexHealth", ...(x.answer.includes("Acme") ? ["Acme Scheduling"] : [])] }))) }] });
    }
    if (b.system.includes("what they sell")) return ok200({ content: [{ type: "text", text: JSON.stringify({ sell: "bookkeeping software for freelancers", buyers: "freelancers" }) }] });
  }
  if (url.host === "api.openai.com") {
    const full = answerText();
    return ok200({ output_text: full, output: [{ type: "message", content: [{ type: "output_text", text: full, annotations: [] }] }] });
  }
  if (/^(www\.)?(beta\.io|gamma\.io|acme\.com|named\.io|co\d\.com)$/.test(url.host)) return new Response("<html><body><h1>Beta Books</h1><p>Simple bookkeeping software for freelancers who hate spreadsheets.</p></body></html>");
  if (url.host === "found.io" || url.host === "www.found.io") {
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { status: 200 });
    if (url.pathname === "/contact") return new Response('<html><body>Write to <a href="mailto:Ana@found.io">Ana</a> or other@gmail.com</body></html>');
    return new Response('<html><head><meta property="og:site_name" content="Found IO"></head><body><a href="/contact">Contact us</a></body></html>');
  }
  if (url.host === "nomail.io") return url.pathname === "/robots.txt" ? new Response("", { status: 404 }) : new Response("<html><body>No email here</body></html>");
  if (url.host === "blocked.io") return url.pathname === "/robots.txt" ? new Response("User-agent: *\nDisallow: /\n") : new Response("<html></html>");
  if (url.host === "info.io") return url.pathname === "/robots.txt" ? new Response("", { status: 404 }) : new Response('<html><body>Email info@info.io or help@info.io or x@evil.com</body></html>');
  if (url.host === "api.resend.com") { const b = JSON.parse(body); emails.push(b); return ok200({ id: "msg" + emails.length }); }
  throw new Error(`Unexpected fetch ${url}`);
};
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k), list: async ({ prefix = "" } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
const SECRET = "whsec_" + btoa("webhook-secret-bytes-1234");
const env = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", RESEND_API_KEY: "re", ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com", PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com", VIDEO_SECRET: "vsecret", PREVIEWS: kv, OUTREACH_FROM: "Vince <vince@usevantry.com>", MAILING_ADDRESS: "1 Main St, Boston, MA 02101", RESEND_WEBHOOK_SECRET: SECRET };
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const API = "https://api.vantryai.com";
const call = (path, opts = {}) => worker.fetch(new Request(API + path, { redirect: "manual", ...opts }), env, ctx);
const form = (o) => ({ method: "POST", body: new URLSearchParams({ token: "admin-secret-123", ...o }) });
const admin = () => call("/admin/prospects?token=admin-secret-123").then((r) => r.text());
const data = () => JSON.parse(store.get("pros:data"));

// ---------- intake ----------
check((await call("/admin/prospects")).status === 404 && (await call("/admin/prospects?token=nope")).status === 404, "the page needs your token");
await store.set("sup:out@acme.com", "1");
const list = `Acme Scheduling, acme.com, jo@acme.com, Jo, scheduling software for dental offices
Acme Again, acme.com, other@acme.com
Beta Books, beta.io, sam@beta.io, Sam
Typo Co, typo.io, a@typo.io, Ann, crm software
Out Co, out.io, out@acme.com
Big Co, big.io, kim@big.io, Kim, scheduling software for dental offices`;
noMx.add("typo.io");
let r = await call("/admin/prospects", form({ action: "add", list }));
check(r.status === 303 && decodeURIComponent(r.headers.get("location")).includes("Added 4"), "paste adds the usable ones");
check(data().rows.length === 4 && !data().rows.some((x) => x.email === "other@acme.com" || x.email === "out@acme.com"), "second contact at the same company and opted-out people are dropped");
r = await call("/admin/prospects", form({ action: "add", list: "Acme, acme.com, jo@acme.com" }));
check(data().rows.length === 4, "pasting again doesn't duplicate");

// ---------- the check ----------
check((await runClientProspects(env)) === 2, "cron checks two per run");
await runClientProspects(env);
let rows = data().rows, by = (e) => rows.find((x) => x.email === e);
rows = data().rows;
check(by("jo@acme.com").st === "ready" && by("jo@acme.com").m === 0 && by("jo@acme.com").t === 6 && by("jo@acme.com").nq === 3 && by("jo@acme.com").named.includes("Weave"), "a company that isn't named becomes ready, with the real result saved");
check(by("a@typo.io").st === "skipped" && /mail server/.test(by("a@typo.io").why), "an address whose domain has no mail server is skipped before any email");
check(by("sam@beta.io").cat === "bookkeeping software for freelancers" && by("sam@beta.io").st === "ready", "what they sell is read from their site when not given");
check(emails.length === 0, "checking sends nothing");

// ---------- an already-visible company is skipped ----------
sayNamed = "Named Co";
await call("/admin/prospects", form({ action: "add", list: "Named Co, named.io, n@named.io, Nia, scheduling software for dental offices" }));
await runClientProspects(env);
const nm = data().rows.find((x) => x.email === "n@named.io");
check(nm.st === "skipped" && /every answer/.test(nm.why), "a company already named in every answer is not emailed");
sayNamed = "";

// ---------- the email ----------
const jo = data().rows.find((x) => x.email === "jo@acme.com");
const e1 = buildEmail(env, jo);
const t1 = e1.body("https://api.vantryai.com/optout?x");
check(/named in 0 of 6/.test(t1) && /3 questions/.test(t1) && t1.includes("Weave") && t1.includes(`/r/${jo.auditId}`) && t1.includes("Hi Jo,"), "email states the real result, competitors, the report link, and uses the first name");
check(t1.includes("promotional email") && t1.includes("1 Main St, Boston") && t1.includes("optout?x") && /I'm Vince/.test(t1), "email says who sent it, that it's promotional, with address and opt-out");
check(!/\b(best|#1|guarantee|rank|boost)\b/i.test(e1.subject.replace(/best/i, "")) && !/^re:|^fwd:/i.test(e1.subject) && e1.subject.length <= 70, "subject is plain and truthful, no fake Re:");
check(!/guarantee|#1|will get you|ensure/i.test(t1), "no promises in the email");

// ---------- sending ----------
check(dayCap({ ...env }, { firstSend: 0 }) === 5 && dayCap(env, { firstSend: Date.now() - 8 * 864e5 }) === 10 && dayCap(env, { firstSend: Date.now() - 30 * 864e5 }) === 50 && dayCap({ PROSPECT_DAILY: "7" }, { firstSend: Date.now() - 30 * 864e5 }) === 7, "new domains warm up: 5, 10, 20, 40, then your cap");
let q = await (await call("/admin/prospects?token=admin-secret-123")).text();
check(q.includes("Ready to send (3)") && q.includes("Hi Jo,") && q.includes("Nobody is emailed unless you press Send"), "page previews the ready emails and says nothing sends by itself");
check(emails.length === 0, "just viewing the page sends nothing");
const envBak = { ...env };
delete env.MAILING_ADDRESS;
await call("/admin/prospects", form({ action: "send" }));
check(emails.length === 0, "no sending without a mailing address");
env.MAILING_ADDRESS = envBak.MAILING_ADDRESS;
env.OUTREACH_FROM = "Vince <booking@vantryai.com>";
await call("/admin/prospects", form({ action: "send" }));
check(emails.length === 0, "never sends from vantryai.com");
env.OUTREACH_FROM = envBak.OUTREACH_FROM;
await call("/admin/prospects", form({ action: "send" }));
check(emails.length === 3 && emails.every((m) => m.from.includes("usevantry.com") && m.headers["List-Unsubscribe"].includes("optout") && m.headers["List-Unsubscribe-Post"]), "send goes out from the outreach domain with one-click unsubscribe");
check(data().rows.filter((x) => x.st === "sent").length === 3 && data().firstSend > 0, "sent people are marked");
await call("/admin/prospects", form({ action: "send" }));
check(emails.length === 3, "nobody is emailed twice");

// daily cap
const more = Array.from({ length: 8 }, (_, i) => `Co${i}, co${i}.com, p${i}@co${i}.com, P, bookkeeping software`).join("\n");
await addProspects(env, more);
for (let i = 0; i < 6; i++) await runClientProspects(env);
await call("/admin/prospects", form({ action: "send" }));
check(emails.length === 5, "the first week stops at 5 emails a day");

// ---------- replies and follow-ups ----------
let d = data();
const sam = d.rows.find((x) => x.email === "sam@beta.io");
await call("/admin/prospects", form({ action: "follow" }));
check(emails.length === 5, "no follow-up before 5 days");
d.rows.filter((x) => x.sentAt).forEach((x) => (x.sentAt -= 6 * 864e5));
store.set("pros:data", JSON.stringify(d));
await call("/admin/prospects", form({ action: "replied", id: sam.id }));
store.forEach((v, k) => k.startsWith("rl:pros-day") && store.delete(k));
await call("/admin/prospects", form({ action: "follow" }));
const fu = emails.slice(5);
check(fu.length === d.rows.filter((x) => x.sentAt).length - 1 && !fu.some((m) => m.to[0] === "sam@beta.io"), "follow-up goes to people who haven't replied, not to those who did");
check(fu.every((m) => /Following up/.test(m.subject) && m.text.includes("optout")), "follow-up is short and has the opt-out");
store.forEach((v, k) => k.startsWith("rl:pros-day") && store.delete(k));
const n = emails.length;
await call("/admin/prospects", form({ action: "follow" }));
check(emails.length === n, "only one follow-up, ever");

// ---------- bounces and complaints ----------
const sign = async (obj, secret = SECRET, ts = Math.floor(Date.now() / 1000)) => {
  const body = JSON.stringify(obj), id = "evt_" + Math.random();
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return { method: "POST", body, headers: { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": "v1," + btoa(String.fromCharCode(...mac)) } };
};
const joMsg = data().rows.find((x) => x.email === "jo@acme.com").msg;
check((await call("/api/email/events", { method: "POST", body: "{}" })).status === 404, "webhook needs a valid signature");
check((await call("/api/email/events", await sign({ type: "email.bounced", data: { email_id: joMsg } }, "whsec_" + btoa("wrong-secret-xxxxxxxx")))).status === 404, "a wrong signature is rejected");
check((await call("/api/email/events", await sign({ type: "email.bounced", data: { email_id: joMsg } }, SECRET, 1000))).status === 404, "an old signed message is rejected");
const emailsBefore = emails.length;
check((await call("/api/email/events", await sign({ type: "email.bounced", data: { email_id: joMsg } }))).status === 200, "a real bounce event is accepted");
check(data().rows.find((x) => x.email === "jo@acme.com").st === "bounced" && !!store.get("sup:jo@acme.com"), "the bounced address is marked and never emailed again");
const nb = data().rows.length;
await addProspects(env, "Acme Two, acme2.com, jo@acme.com");
check(data().rows.length === nb, "a bounced address can't be added again");
check(!data().paused, "one bounce doesn't pause sending");

// pause when rates are bad
d = data();
d.rows = Array.from({ length: 25 }, (_, i) => ({ id: "px" + i, name: "X" + i, domain: `x${i}.com`, email: `x${i}@x${i}.com`, st: i < 3 ? "sent" : "sent", sentAt: Date.now() - i * 1000, msg: "m" + i, auditId: "a1", cat: "c", m: 0, t: 3, q: "q", named: [] }));
store.set("pros:data", JSON.stringify(d));
check(health(data()).bad === "", "healthy list isn't paused");
await call("/api/email/events", await sign({ type: "email.complained", data: { email_id: "m3" } }));
check(data().paused && /spam/.test(data().paused.reason), "a spam complaint at this size pauses sending");
check(emails.some((m) => m.to[0] === env.OWNER_EMAIL && /paused/i.test(m.subject)), "you're emailed when it pauses");
d = data(); d.rows.find((x) => x.st === "sent") && (d.rows.find((x) => x.id === "px5").st = "ready");
store.set("pros:data", JSON.stringify(d));
const n2 = emails.length;
await call("/admin/prospects", form({ action: "send" }));
check(emails.length === n2, "paused means nothing sends");
check((await admin()).includes("PAUSED"), "the page shows the pause");
await call("/admin/prospects", form({ action: "resume" }));
check(!data().paused, "you can resume");

// ---------- replies ----------
{
  const { handleReply } = await import("../src/lib/prospects.js");
  const mailsBefore = emails.length;
  let r = await handleReply(env, { from: "Pat <x7@x7.com>", text: "Sounds interesting, can we talk Tuesday?" });
  check(r.label === "interested" && data().rows.find((x) => x.id === "px7").st === "replied" && !!data().rows.find((x) => x.id === "px7").replied, "an interested reply is sorted and stops follow-ups");
  check(emails.length === mailsBefore + 1 && emails.at(-1).to[0] === env.OWNER_EMAIL && /Interested: X7/.test(emails.at(-1).subject), "you're emailed about an interested reply");
  r = await handleReply(env, { from: "x8@x8.com", text: "How much does it cost?\n> On Monday Vince wrote: hi" });
  check(r.label === "question", "a question is sorted as a question");
  r = await handleReply(env, { from: "x9@x9.com", text: "Please unsubscribe me from this." });
  check(r.label === "optout" && data().rows.find((x) => x.id === "px9").st === "optedout" && !!store.get("sup:x9@x9.com"), "an opt-out reply goes on the never-email list");
  r = await handleReply(env, { from: "x10@x10.com", text: "No thanks, not interested." });
  check(r.label === "no" && !!store.get("sup:x10@x10.com"), "'not interested' stops all future email");
  r = await handleReply(env, { from: "x11@x11.com", text: "I am out of office until Monday." });
  check(r.label === "auto" && !data().rows.find((x) => x.id === "px11").replied, "an out-of-office reply doesn't count as a real reply");
  r = await handleReply(env, { from: "stranger@nowhere.com", text: "hello" });
  check(r.matched === false && data().inbox.length === 1, "replies from unknown senders are saved, not lost");
  r = await handleReply(env, { from: "someone-else@x12.com", text: "Please remove me" });
  check(r.matched && data().rows.find((x) => x.id === "px12").st === "optedout" && !!store.get("sup:someone-else@x12.com"), "a reply from a colleague at the same company is matched and both addresses are blocked");
  const hook = await call("/api/email/events", await sign({ type: "email.received", data: { from: "Pat <x13@x13.com>", text: "Remove me from your list." } }));
  check(hook.status === 200 && data().rows.find((x) => x.id === "px13").st === "optedout", "the Resend inbound webhook sorts replies automatically");
  await call("/admin/prospects", form({ action: "reply", from: "x14@x14.com", text: "Sounds interesting, can we talk Tuesday?" }));
  const pg = await admin();
  check(pg.includes("Wants to talk Tuesday.") && pg.includes("Paste a reply"), "the page lists replies and lets you paste one");
}

// ---------- finding contacts ----------
{
  const { findFor, addSites } = await import("../src/lib/prospects.js");
  const f = await findFor("found.io");
  check(f.email === "ana@found.io" && f.name === "Found IO", "finds the email the site publishes on its own domain, from its contact page");
  check((await findFor("nomail.io")).why.includes("no public contact"), "no email on the site means no prospect (we never guess)");
  check((await findFor("blocked.io")).why.includes("robots"), "a site that blocks bots in robots.txt is left alone");
  const g = await findFor("info.io");
  check(g.email === "info@info.io" && g.generic === true, "a general address is used only if there's nothing better; other-domain and help@ addresses are ignored");
  const before = data().rows.length;
  const r2 = await addSites(env, "found.io\nnomail.io, nomail.io\nBlocked Co | blocked.io\nnot a site\nfound.io");
  check(r2.added === 3 && r2.dupes === 1 && r2.bad.length === 1, "pasting sites queues them and skips repeats and junk");
  await call("/admin/prospects", form({ action: "sites", sites: "info.io" }));
  check(data().queue.length === 4, "the admin form queues sites too");
  await runClientProspects(env);
  check(data().queue.length === 1 && data().rows.length === before + 1 && data().rows.find((x) => x.email === "ana@found.io")?.found === true, "the timer looks up 3 at a time and adds the ones with a public email");
  check(data().noMail.length === 2, "sites with no usable email are listed, not emailed");
  await runClientProspects(env);
  check((await admin()).includes("Find contacts for me"), "page shows the finder");
}

// ---------- admin card and routes ----------
check((await (await call("/admin?token=admin-secret-123")).text()).length > 0, "main admin still loads");
check((await call("/api/email/events")).status === 404, "webhook GET is 404");
console.log(`\n${count} checks`);
process.exit(ok ? 0 : 1);
