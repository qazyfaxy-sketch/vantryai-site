// Tests for the LinkedIn helper. Run: node test/linkedin.mjs
import worker from "../src/worker.js";
import { cleanPost, postLinkOk } from "../src/lib/linkedin.js";
import { saveAudit } from "../src/lib/aiscan.js";
import { runClientLinkedin, saveClient, getClient } from "../src/ai.js";
let ok = true, count = 0;
const check = (c, m) => { count++; console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) ok = false; };

const co = { name: "Chairside" };
const good = "Which scheduling software works for a two-dentist practice?\n\nStart with how patients book. If they can't book online, you'll lose them to the office that lets them. Then look at reminders: text reminders before each visit cut down on forgotten appointments.\n\nChairside is online booking software for small dental offices. Patients book online and get text reminders before each visit.\n\nIf you're comparing options, write down the three things your front desk spends the most time on and check each tool against them.\n\n#dentalpractice";
check(cleanPost({ post: good }, co) === good, "a good post passes");
check(cleanPost({ post: good + " Chairside is the best." }, co) === null || !/best/i.test(cleanPost({ post: good + " Chairside is the best." }, co)), "overclaims are removed or rejected");
check(cleanPost({ post: good + "\nSee https://chairside.io" }, co) === null && cleanPost({ post: good + "\nPlease like and share!" }, co) === null && cleanPost({ post: good + "\nDM me for a deal" }, co) === null, "links, engagement requests and DM pitches are rejected");
check(cleanPost({ post: good.replace(/Chairside/g, "Acme") }, co) === null, "a post that never names the company is rejected");
check(cleanPost({ post: "Too short." }, co) === null && cleanPost({ post: good + " #a #b #c" }, co) === null, "thin posts and hashtag spam are rejected");
check(postLinkOk("https://www.linkedin.com/posts/jo-smith_dental-activity-123?utm=x") === "https://www.linkedin.com/posts/jo-smith_dental-activity-123" && postLinkOk("https://linkedin.com/feed/update/urn:li:activity:123/")?.includes("/feed/update/") && !postLinkOk("https://linkedin.com.evil.com/posts/x") && !postLinkOk("https://www.linkedin.com/in/jo-smith") && !postLinkOk("http://www.linkedin.com/posts/x"), "only real LinkedIn post links are accepted");

// ---------- fake services ----------
const emails = [];
let mode = "good";
const ok200 = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = opts.body ? String(opts.body) : "";
  if (/(^|\.)chairside\.io$/.test(url.host)) return new Response("<html><body><h1>Chairside: online booking for dental offices</h1><p>Patients book online and get text reminders before each visit. Built for small practices.</p></body></html>");
  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(body);
    if (b.system.includes("strict fact checker")) return ok200({ content: [{ type: "text", text: b.messages[0].content.split("Post:\n")[1].split("\n\nCompany")[0] }] });
    const post = mode === "bad" ? good + "\nSee https://chairside.io" : mode === "redo" || b.messages[0].content.includes("shorter") ? good.replace("Start with how patients book.", "Start with booking.") : good;
    return ok200({ content: [{ type: "text", text: JSON.stringify({ post: mode === "bad" ? post : post }) }] });
  }
  if (url.host === "api.resend.com") { emails.push(JSON.parse(body)); return ok200({ id: "em" }); }
  throw new Error(`Unexpected fetch ${url}`);
};
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k), list: async ({ prefix = "" } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
const env = { ANTHROPIC_API_KEY: "a", RESEND_API_KEY: "re", ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com", PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com", VIDEO_SECRET: "vsecret", PREVIEWS: kv };
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const API = "https://api.vantryai.com";
const call = (path, opts = {}) => worker.fetch(new Request(API + path, { redirect: "manual", ...opts }), env, ctx);
const form = (o) => ({ method: "POST", body: new URLSearchParams(o) });
await saveAudit(env, { id: "aaudit000001", createdAt: Date.now(), company: { name: "Chairside", website: "chairside.io" }, origin: "client", questions: ["q1", "q2"], engines: ["openai"], results: [
  { q: "Which scheduling software works for a two-dentist practice?", engine: "openai", mentioned: false, sources: [] },
  { q: "What is the best dental booking app?", engine: "openai", mentioned: true, sources: [] },
], summary: { mentioned: 1, total: 2, competitors: [], sources: [] } });
const base = { status: "active", onboardedAt: Date.now(), startedAt: Date.now(), audits: [{ id: "aaudit000001", at: Date.now(), mentioned: 1, total: 2, kind: "baseline" }] };
await saveClient(env, { id: "cgrowth00001", plan: "growth", email: "owner@chairside.io", onboarding: { business: "Chairside", website: "chairside.io", sell: "dental scheduling software", reportEmail: "reports@chairside.io" }, questions: ["How do I pick dental booking software for a small office?"], ...base });
await saveClient(env, { id: "cstarter0001", plan: "starter", email: "s@x.com", onboarding: { business: "Tiny", website: "chairside.io" }, ...base });
const link = () => emails.filter((e) => /LinkedIn post ready/.test(e.subject)).slice(-1)[0].text.match(/https:\/\/api\.vantryai\.com(\/ik\/\S+)/)[1];
const clientMail = () => emails.filter((e) => e.to[0] === "reports@chairside.io");

// ---------- the timer writes a draft ----------
check((await runClientLinkedin(env)) === 1, "the timer works on one client per run");
check((await getClient(env, "cstarter0001")).linkedin === undefined, "Starter clients get no LinkedIn posts");
let c = await getClient(env, "cgrowth00001");
const row = c.linkedin.rows[0];
check(row.q === "Which scheduling software works for a two-dentist practice?" && row.status === "review", "it starts with a question AI isn't naming them for");
check(emails.length === 1 && emails[0].to[0] === env.OWNER_EMAIL && clientMail().length === 0, "only you are emailed; the client hears nothing yet");
check((await runClientLinkedin(env)) === 0, "no second post while one waits");
let lk = link();
check((await call(lk.replace(/k=\w+/, "k=bad"))).status === 404, "the review page needs the signed link");
let rp = await (await call(lk)).text();
check(rp.includes("Approve and send to client") && rp.includes("Chairside is online booking software"), "review page shows the post and buttons");
const k = new URL(API + lk).searchParams.get("k");
let t = await (await call(lk.split("?")[0], form({ k, action: "redo", note: "shorter" }))).text();
check(t.includes("Rewritten") && t.includes("Start with booking."), "redo works and uses your note");
t = await (await call(lk.split("?")[0], form({ k, action: "approve" }))).text();
check(t.includes("Approved"), "approve works");
const cm = clientMail()[0];
check(cm && cm.text.includes("from your own profile") || cm.text.includes("post it from your own profile"), "the client is told to post it themselves");
check(/Don't ask friends, staff or "engagement groups"/.test(cm.text) && cm.text.includes("We never post for you"), "client email warns against engagement tricks");

// ---------- the client posts it ----------
const page = "/linkedin/cgrowth00001";
let cp = await (await call(page)).text();
check(cp.includes("Chairside is online booking software") && cp.includes("I posted it"), "client page shows the text and buttons");
check((await call("/linkedin/cother0000001")).status === 404, "unknown client page is 404");
const did = (await getClient(env, "cgrowth00001")).linkedin.rows[0].id;
cp = await (await call(page, form({ d: did, action: "posted", url: "https://www.linkedin.com/in/someone" }))).text();
check(cp.includes("doesn&#39;t look like a link") || cp.includes("doesn't look like a link"), "a profile link instead of a post link is refused");
cp = await (await call(page, form({ d: did, action: "posted", url: "https://www.linkedin.com/posts/jo-smith_dental-activity-123" }))).text();
check(cp.includes("Thanks!") && (await getClient(env, "cgrowth00001")).linkedin.rows[0].status === "posted", "'I posted it' with a real post link marks it posted");
check(emails.some((e) => e.subject.startsWith("LinkedIn post live")), "you're told when they post");

// ---------- limits, bad drafts, skips ----------
c = await getClient(env, "cgrowth00001"); c.linkedin.nextAt = 0; await saveClient(env, c);
check((await runClientLinkedin(env)) === 1, "a second post is written after the gap");
c = await getClient(env, "cgrowth00001");
check(c.linkedin.rows[1].q === "How do I pick dental booking software for a small office?", "the next question is a different one");
const lk2 = link(); const k2 = new URL(API + lk2).searchParams.get("k");
await call(lk2.split("?")[0], form({ k: k2, action: "skip" }));
c = await getClient(env, "cgrowth00001"); c.linkedin.nextAt = 0; await saveClient(env, c);
check((await runClientLinkedin(env)) === 0, "Growth stops at 2 a month");
mode = "bad";
c = await getClient(env, "cgrowth00001"); c.linkedin.rows.forEach((r) => (r.at = 0)); c.linkedin.nextAt = 0; c.linkedin.used = {}; await saveClient(env, c);
await runClientLinkedin(env);
c = await getClient(env, "cgrowth00001");
check(c.linkedin.rows.length === 2 && Object.values(c.linkedin.used).includes("the draft didn't pass the checks"), "a draft with a link never reaches you");
mode = "good";

// ---------- admin and dashboard ----------
c = await getClient(env, "cgrowth00001"); c.linkedin.nextAt = 0; c.linkedin.used = {}; await saveClient(env, c);
let r = await call("/admin/linkedin", form({ token: "admin-secret-123", clientId: "cgrowth00001" }));
check(r.status === 303 && decodeURIComponent(r.headers.get("location")).includes("Ready"), "admin can write one now");
check((await (await call("/admin/audits?token=admin-secret-123")).text()).includes("Write a LinkedIn post"), "admin page has the LinkedIn card");
check((await call("/admin/linkedin", form({ token: "nope", clientId: "cgrowth00001" }))).status === 404, "admin route needs your token");
console.log(`\n${count} checks`); process.exit(ok ? 0 : 1);
