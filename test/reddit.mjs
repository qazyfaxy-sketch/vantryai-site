// Tests for the Reddit helper, with fake AI, fake Reddit, email and storage.
// Run: node test/reddit.mjs
import worker from "../src/worker.js";
import { parseThread, collectThreads, readRules, readThread, cleanAnswer } from "../src/lib/reddit.js";
import { saveAudit } from "../src/lib/aiscan.js";
import { runClientReddit, saveClient, getClient } from "../src/ai.js";

let ok = true;
let count = 0;
const check = (cond, msg) => {
  count++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) ok = false;
};

// ---------- pure helpers ----------
check(parseThread("https://old.reddit.com/r/Dentistry/comments/abc123/which_software/?utm=x").url === "https://www.reddit.com/r/Dentistry/comments/abc123/", "thread links are cleaned to one form");
check(!parseThread("http://reddit.com/r/a1/comments/abc123/") && !parseThread("https://evil.com/r/dentistry/comments/abc123/") && !parseThread("https://reddit.com.evil.com/r/dentistry/comments/abc123/") && !parseThread("https://www.reddit.com/user/x"), "only https Reddit thread links are accepted");
const ct = collectThreads({ results: [{ engine: "a", sources: [{ url: "https://www.reddit.com/r/dentistry/comments/abc123/x/", title: "Which software? : r/dentistry" }, { url: "https://www.reddit.com/r/dentistry/comments/abc123/y/", title: "dup" }, { url: "https://capterra.com/x", title: "c" }] }, { engine: "b", sources: [{ url: "https://reddit.com/r/dentistry/comments/abc123/", title: "" }] }, { engine: "c", error: "x", sources: [{ url: "https://reddit.com/r/bad/comments/zzzzzz/", title: "" }] }] });
check(ct.total === 2 && ct.list.length === 1 && ct.list[0].n === 2 && ct.list[0].title === "Which software?", "counts each thread once per answer, ignores failed answers, cleans the title");
check(readRules({ rules: [{ short_name: "No self-promotion", description: "Ads are not allowed." }] }).bansPromo === true && readRules({ rules: [{ short_name: "Be kind", description: "Be nice." }] }).bansPromo === false && readRules({}) === null, "rules that ban promotion are detected");
check(readThread({}) === null && readThread([{ data: { children: [{ data: { title: "x", locked: true, subreddit: "A" } }] } }]).locked === true, "thread data is read safely");
const co = { name: "Chairside" };
const good = "Disclosure: I work with Chairside. For a small office the main things to check are whether patients can book online, whether reminders go out by text, and how long setup takes. Chairside is online booking software for small dental offices with text reminders before each visit. Happy to answer questions here.";
check(cleanAnswer({ fit: "yes", answer: good }, co) === good, "a good disclosed answer passes");
check(cleanAnswer({ fit: "yes", answer: good.replace("Disclosure: I work with Chairside. ", "") }, co) === null, "an answer without a disclosure is rejected");
check(cleanAnswer({ fit: "yes", answer: good + " See https://chairside.io" }, co) === null && cleanAnswer({ fit: "yes", answer: good + " DM me for a deal." }, co) === null && cleanAnswer({ fit: "yes", answer: good + " Please upvote." }, co) === null, "links, DM requests and upvote requests are rejected");
check(!/best/i.test(cleanAnswer({ fit: "yes", answer: good + " It is the best in the world." }, co) || ""), "overclaiming sentences are removed");
check(cleanAnswer({ fit: "no", reason: "x" }, co) === null && cleanAnswer({ fit: "yes", answer: "Disclosure: I work with Chairside. Too short." }, co) === null, "'no fit' and thin answers are rejected");

// ---------- fake services ----------
const emails = [];
let mode = "good";
const ok200 = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
const THREADS = {
  abc123: { sub: "dentistry", title: "Which scheduling software for a small practice?", body: "Two dentists, need online booking." },
  arch11: { sub: "dentistry", title: "Old thread about software", archived: true },
  def456: { sub: "dentalpractice", title: "Software recs?", body: "Looking for booking." },
  ghi789: { sub: "smallbiz", title: "Booking tool for a small clinic?", body: "Need reminders." },
  wea000: { sub: "weather", title: "Weather today", body: "Is it raining?" },
};
const BLOCKED = new Set(["ghi789"]);
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = opts.body ? (typeof opts.body === "string" ? opts.body : opts.body.toString()) : "";
  if (url.host === "chairside.io" || url.host === "www.chairside.io") return new Response("<html><body><h1>Chairside: online booking for dental offices</h1><p>Patients book online and get text reminders before each visit. Built for small practices.</p></body></html>");
  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(body);
    if (b.system.includes("strict fact checker")) return ok200({ content: [{ type: "text", text: b.messages[0].content.split("Answer:\n")[1].split("\n\nCompany")[0] }] });
    if (b.messages[0].content.includes("Weather today")) return ok200({ content: [{ type: "text", text: JSON.stringify({ fit: "no", reason: "not about software" }) }] });
    const answer = mode === "link" ? good + " See https://chairside.io" : good;
    return ok200({ content: [{ type: "text", text: JSON.stringify({ fit: "yes", answer }) }] });
  }
  if (url.host === "api.resend.com") { emails.push(JSON.parse(body)); return ok200({ id: "em" }); }
  if (url.host === "www.reddit.com") {
    const m = url.pathname.match(/^\/r\/(\w+)\/comments\/(\w+)\.json$/);
    if (m) {
      if (BLOCKED.has(m[2])) return new Response("blocked", { status: 403 });
      const t = THREADS[m[2]];
      return t ? ok200([{ data: { children: [{ data: { title: t.title, selftext: t.body || "", subreddit: t.sub, archived: !!t.archived, locked: false, num_comments: 4, created_utc: 1700000000 } }] } }]) : new Response("no", { status: 404 });
    }
    const r = url.pathname.match(/^\/r\/(\w+)\/about\/rules\.json$/);
    if (r) {
      if (r[1] === "smallbiz") return new Response("blocked", { status: 403 });
      return ok200({ rules: r[1] === "dentalpractice" ? [{ short_name: "No self-promotion", description: "Advertising is not allowed here." }] : [{ short_name: "Be kind", description: "Be respectful." }] });
    }
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
const env = { ANTHROPIC_API_KEY: "a", RESEND_API_KEY: "re", ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com", PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com", VIDEO_SECRET: "vsecret", PREVIEWS: kv };
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const API = "https://api.vantryai.com";
const call = (path, opts = {}) => worker.fetch(new Request(API + path, { redirect: "manual", ...opts }), env, ctx);
const form = (obj) => ({ method: "POST", body: new URLSearchParams(obj) });
const src = (id, sub, title) => ({ url: `https://www.reddit.com/r/${sub}/comments/${id}/x/`, title, domain: "reddit.com" });
await saveAudit(env, { id: "aaudit000001", createdAt: Date.now(), company: { name: "Chairside", website: "chairside.io" }, origin: "client", questions: ["q1", "q2", "q3"], engines: ["openai"], results: [
  { q: "q1", engine: "openai", sources: [src("abc123", "dentistry", "Which scheduling software? : r/dentistry"), src("arch11", "dentistry", "Old"), src("def456", "dentalpractice", "Recs"), src("ghi789", "smallbiz", "Booking tool")] },
  { q: "q2", engine: "openai", sources: [src("abc123", "dentistry", ""), src("def456", "dentalpractice", ""), src("ghi789", "smallbiz", ""), src("wea000", "weather", "Weather today")] },
  { q: "q3", engine: "openai", sources: [src("abc123", "dentistry", ""), src("arch11", "dentistry", "")] },
], summary: { mentioned: 0, total: 3, competitors: [], sources: [] } });
const base = { status: "active", onboardedAt: Date.now(), startedAt: Date.now(), audits: [{ id: "aaudit000001", at: Date.now(), mentioned: 0, total: 3, kind: "baseline" }] };
await saveClient(env, { id: "cgrowth00001", plan: "growth", email: "owner@chairside.io", onboarding: { business: "Chairside", website: "chairside.io", sell: "dental scheduling software", reportEmail: "reports@chairside.io" }, ...base });
await saveClient(env, { id: "cstarter0001", plan: "starter", email: "s@x.com", onboarding: { business: "Tiny", website: "chairside.io" }, ...base });
const link = (re) => emails.filter((e) => re.test(e.subject)).slice(-1)[0].text.match(/https:\/\/api\.vantryai\.com(\/rk\/\S+)/)[1];
const clientMail = () => emails.filter((e) => e.to[0] === "reports@chairside.io");

// ---------- the cron finds a thread and waits for you ----------
check((await runClientReddit(env)) === 1, "cron works on one client per run");
check((await getClient(env, "cstarter0001")).reddit === undefined, "Starter clients get no Reddit answers");
let c = await getClient(env, "cgrowth00001");
const row = c.reddit.rows[0];
check(row.thread === "abc123" && row.status === "review", "it picks the thread AI cites most and waits for review");
check(emails.length === 1 && emails[0].to[0] === env.OWNER_EMAIL && clientMail().length === 0, "only you are emailed; the client hears nothing yet");
check(c.reddit.used.abc123 === "drafted" && c.reddit.subs.dentistry > 0, "the subreddit is marked so we don't post there again soon");
check((await runClientReddit(env)) === 0, "no second answer while one waits");
let lk = link(/Reddit answer ready/);
check((await call(lk.replace(/k=\w+/, "k=bad"))).status === 404, "review page needs the signed link");
let rp = await (await call(lk)).text();
check(rp.includes("Disclosure: I work with Chairside") && rp.includes("Approve and send to client") && rp.includes("We checked: the thread is open"), "review page shows the disclosed answer and that the thread and rules were checked");
const k = new URL(API + lk).searchParams.get("k");
let t = await (await call(lk.split("?")[0], form({ k, action: "redo", note: "shorter" }))).text();
check(t.includes("Rewritten"), "redo works");
t = await (await call(lk.split("?")[0], form({ k, action: "approve" }))).text();
check(t.includes("Approved"), "approve works");
const cm = clientMail()[0];
check(cm && cm.text.includes("from your own Reddit account")&& cm.text.includes("Post it yourself, from a real account of yours") && /don't ask friends or staff to upvote/i.test(cm.text) && cm.text.includes("https://www.reddit.com/r/dentistry/comments/abc123/"), "client email links the thread and warns: own account, rules, no upvote requests");

// ---------- the client posts it ----------
const page = "/reddit/cgrowth00001";
let cp = await (await call(page)).text();
check(cp.includes("Disclosure: I work with Chairside") && cp.includes("I posted it") && cp.includes("r/dentistry"), "client page shows the thread, the text and the buttons");
const did = JSON.parse(store.get(`rdt:${c.reddit.rows[0].id}`)).id;
check((await call("/reddit/cother0000001")).status === 404, "unknown client page is 404");
cp = await (await call(page, form({ d: did, action: "posted", url: "https://www.reddit.com/r/dentistry/comments/zzz999/x/c1/" }))).text();
check(cp.includes("look like a link"), "a comment link from a different thread is refused");
cp = await (await call(page, form({ d: did, action: "posted", url: "https://www.reddit.com/r/dentistry/comments/abc123/which/kx1ab2/" }))).text();
check(cp.includes("Thanks!") && (await getClient(env, "cgrowth00001")).reddit.rows[0].status === "posted", "'I posted it' with the real comment link marks it posted");
check(emails.some((e) => e.subject.startsWith("Reddit answer posted") && e.text.includes("kx1ab2")), "you're told when they post");

// ---------- the next threads: skips and checks ----------
c = await getClient(env, "cgrowth00001"); c.reddit.nextAt = 0; await saveClient(env, c);
await runClientReddit(env);
c = await getClient(env, "cgrowth00001");
check(!c.reddit.seen.arch11 || !c.reddit.rows.some((r) => r.thread === "arch11"), "a second answer in the same subreddit is not drafted within 30 days");
check(/bans self-promotion/.test(c.reddit.used.def456), "a subreddit whose rules ban promotion is skipped");
check(c.reddit.rows[1]?.thread === "ghi789", "next is a thread in another subreddit");
rp = await (await call(link(/Reddit answer ready/))).text();
check(rp.includes("couldn&#39;t check") || rp.includes("We couldn't check") || rp.includes("We couldn&#39;t check"), "when Reddit blocks the check, you're told to check by hand");
const lk2 = link(/Reddit answer ready/); const k2 = new URL(API + lk2).searchParams.get("k");
await call(lk2.split("?")[0], form({ k: k2, action: "skip" }));
check((await getClient(env, "cgrowth00001")).reddit.rows[1].status === "skipped", "skip works");

// ---------- limits, no-fit, bad answers ----------
c = await getClient(env, "cgrowth00001"); c.reddit.nextAt = 0; await saveClient(env, c);
check((await runClientReddit(env)) === 0, "Growth is capped at 2 answers a month");
c = await getClient(env, "cgrowth00001"); c.reddit.rows.forEach((r) => (r.at = 0)); c.reddit.nextAt = 0; c.reddit.subs = {}; c.reddit.used = {}; c.reddit.seen = {}; c.reddit.auditId = null; await saveClient(env, c);
emails.length = 0;
mode = "link";
await runClientReddit(env);
c = await getClient(env, "cgrowth00001");
check(emails.some((e) => e.subject.startsWith("Reddit helper stopped")) && Object.values(c.reddit.used).some((v) => /didn't pass the checks/.test(v)), "answers with links are thrown away and you're told when nothing usable is found");
mode = "good";

// ---------- admin ----------
c = await getClient(env, "cgrowth00001"); c.reddit.nextAt = 0; c.reddit.rows.forEach((r) => (r.status = "done")); await saveClient(env, c);
const adm = await (await call(`/admin/audits?token=${env.ADMIN_TOKEN}`)).text();
check(adm.includes("Find a thread and write an answer") && adm.includes("Reddit"), "admin page shows the Reddit card");
let r = await call("/admin/reddit", form({ token: env.ADMIN_TOKEN, clientId: "cgrowth00001", url: "https://evil.com/r/x/comments/abc123/" }));
check(r.status === 303 && decodeURIComponent(r.headers.get("Location")).includes("isn't a link to a Reddit thread"), "a non-Reddit link is refused");
r = await call("/admin/reddit", form({ token: env.ADMIN_TOKEN, clientId: "cgrowth00001", url: "https://www.reddit.com/r/weather/comments/wea000/x/" }));
check(r.status === 303 && decodeURIComponent(r.headers.get("Location")).includes("None of") && /not a fit/.test((await getClient(env, "cgrowth00001")).reddit.used.wea000), "an off-topic thread is judged 'not a fit' and no answer is written");
r = await call("/admin/reddit", form({ token: env.ADMIN_TOKEN, clientId: "cgrowth00001", url: "https://www.reddit.com/r/dentistry/comments/abc123/x/" }));
check(r.status === 303 && decodeURIComponent(r.headers.get("Location")).includes("Ready"), "you can add a thread by link");
r = await call("/admin/reddit", form({ token: "wrong", clientId: "cgrowth00001" }));
check(r.status !== 303 && r.status < 500, "make-now needs the admin token");

console.log(`\n${count} checks, ${ok ? "all passed" : "SOME FAILED"}`);
process.exit(ok ? 0 : 1);
