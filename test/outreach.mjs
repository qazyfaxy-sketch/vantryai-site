// Tests for article outreach, with fake AI, fake article sites, email and storage.
// Run: node test/outreach.mjs
import worker from "../src/worker.js";
import { authorName, findContact, cleanNote, sendGate, footer } from "../src/lib/outreach.js";
import { runClientOutreach, saveClient, getClient } from "../src/ai.js";

let ok = true;
let count = 0;
const check = (cond, msg) => {
  count++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) ok = false;
};

// ---------- pure helpers ----------
check(authorName('<script type="application/ld+json">{"@type":"Article","author":{"@type":"Person","name":"Jane Writer"}}</script>') === "Jane Writer", "reads the writer's name from the page data");
check(authorName('<meta name="author" content="Staff Writers">') === "" && authorName('<meta name="author" content="Editorial Team">') === "", "staff and team bylines are not names");
const fc = findContact('<a href="mailto:Jane@bestof.com">mail</a><a href="mailto:me@gmail.com">x</a><a href="mailto:noreply@bestof.com">n</a><a href="mailto:editor@bestof.com">e</a><a href="/contact">Contact us</a><a href="/author/jane" rel="author">Jane</a>', "https://www.bestof.com/post");
check(fc.email.email === "jane@bestof.com" && !fc.email.generic, "takes the writer's own address from the site, before a general one");
check(!JSON.stringify(fc).includes("gmail") && !JSON.stringify(fc).includes("noreply"), "ignores other domains and no-reply addresses");
check(fc.contactPage === "https://www.bestof.com/contact" && fc.authorPage === "https://www.bestof.com/author/jane", "finds the contact and author pages");
check(findContact("<p>nothing</p>", "https://x.com/").email === null, "no email when the site shows none (we never guess one)");
const co = { name: "Chairside", website: "https://chairside.io" };
const good = { subject: "RE: Re: Your dental scheduling roundup!!", body: "Hi Jane,\n\nI'm writing on behalf of Chairside about your piece on dental scheduling tools. Chairside is online booking software for small dental offices. See https://evil.com/x for more.\n\nIf it's useful, would you consider whether it fits the piece? Happy to answer any questions." };
const cn = cleanNote(good, co, {});
check(cn && cn.subject === "Your dental scheduling roundup" && !cn.body.includes("evil.com"), "subject loses fake 'Re:' and shouting; outside links are removed");
check(cleanNote({ ...good, body: good.body + " We will pay you $50 for a mention." }, co, {}) === null, "a note that mentions payment is rejected");
check(cleanNote({ ...good, body: good.body.replace(/Chairside/g, "We") }, co, {}) === null, "a note that never says who it's for is rejected");
check(cleanNote({ subject: "Hello there", body: "Too short." }, co, {}) === null, "a thin note is rejected");
check(/best/i.test(cleanNote({ ...good, body: good.body + " Chairside is the best in the world." }, co, {}).body) === false, "overclaiming sentences are removed");
check(sendGate({}).includes("OUTREACH_FROM") && sendGate({ OUTREACH_FROM: "V <v@vantryai.com>", RESEND_API_KEY: "x", MAILING_ADDRESS: "PO Box 1" }).includes("separate domain") && sendGate({ OUTREACH_FROM: "V <v@usevantry.com>", RESEND_API_KEY: "x" }).includes("MAILING_ADDRESS") && sendGate({ OUTREACH_FROM: "V <v@usevantry.com>", RESEND_API_KEY: "x", MAILING_ADDRESS: "PO Box 1" }) === "", "sending needs a separate domain, a mailing address and an email key");
check(footer({ MAILING_ADDRESS: "PO Box 1, Columbus OH" }, co, "https://o/x").includes("PO Box 1, Columbus OH") && footer({}, co, "https://o/x").includes("https://o/x"), "every email carries the mailing address and an opt-out link");

// ---------- fake services ----------
const emails = [];
let badNote = false;
const ok200 = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
const NOTE = { subject: "Chairside for your scheduling roundup", body: "Hi Jane,\n\nI'm writing on behalf of Chairside about your piece on dental scheduling tools. Chairside is online booking software for small dental offices, with text reminders before each visit.\n\nIf it's useful, would you consider whether it fits the piece? Happy to answer any questions." };
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = opts.body ? (typeof opts.body === "string" ? opts.body : opts.body.toString()) : "";
  const h = url.host.replace(/^www\./, "");
  if (h === "chairside.io") return new Response(`<html><body><h1>Chairside: online booking for dental offices</h1><p>Patients book online and get text reminders before each visit. Built for small practices.</p></body></html>`);
  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(body);
    if (b.system.includes("strict fact checker")) return ok200({ content: [{ type: "text", text: b.messages[0].content.split("Email:\n")[1].split("\n\nCompany")[0] }] });
    return ok200({ content: [{ type: "text", text: JSON.stringify(badNote ? { ...NOTE, body: NOTE.body + " We'll pay you for coverage." } : NOTE) }] });
  }
  if (url.host === "api.resend.com") { emails.push({ ...JSON.parse(body), _auth: opts.headers.Authorization }); return ok200({ id: "em" }); }
  if (h === "bestofsoftware.com") return new Response('<html><head><title>Best dental scheduling software</title><script type="application/ld+json">{"author":{"@type":"Person","name":"Jane Writer"}}</script></head><body><p>A roundup of dental scheduling tools for small offices.</p><a href="mailto:jane@bestofsoftware.com">Email Jane</a><a href="mailto:tips@gmail.com">tip</a></body></html>');
  if (h === "techblog.io") {
    if (url.pathname === "/contact") return new Response('<a href="mailto:editor@techblog.io">editor@techblog.io</a>');
    return new Response('<html><head><title>Dental tools compared</title></head><body><p>Comparison.</p><a href="/contact">Contact us</a></body></html>');
  }
  if (h === "nomail.org") return new Response("<html><head><title>Roundup</title></head><body><p>No contact here.</p></body></html>");
  if (h === "gone.net") return new Response("nope", { status: 404 });
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
const base = { status: "active", onboardedAt: Date.now(), startedAt: Date.now(), audits: [{ id: "a1", at: Date.now(), mentioned: 1, total: 2, kind: "baseline" }] };
const seen = { "bestofsoftware.com": { type: "article", fits: "no", n: 3, tot: 4, url: "https://bestofsoftware.com/dental-scheduling", title: "Best dental scheduling" }, "techblog.io": { type: "article", fits: "no", n: 2, tot: 4, url: "https://techblog.io/dental", title: "Dental tools" }, "nomail.org": { type: "article", fits: "no", n: 1, tot: 4, url: "https://nomail.org/x", title: "Roundup" }, "capterra.com": { type: "directory", fits: "yes", n: 4, tot: 4, url: "https://capterra.com/x" } };
await saveClient(env, { id: "cgrowth00001", plan: "growth", email: "owner@chairside.io", onboarding: { business: "Chairside", website: "chairside.io", sell: "dental scheduling software", buyers: "small dental offices", avoid: "patient names" }, ...base, listings: { seen } });
await saveClient(env, { id: "cstarter0001", plan: "starter", email: "s@x.com", onboarding: { business: "Tiny", website: "chairside.io" }, ...base, listings: { seen } });
const reviewLink = (re) => emails.filter((e) => re.test(e.subject)).slice(-1)[0].text.match(/https:\/\/api\.vantryai\.com(\/ok\/\S+)/)[1];
const writerMail = () => emails.filter((e) => !e.to.includes("booking@vantryai.com"));

// ---------- cron makes one note and waits for you ----------
check((await runClientOutreach(env)) === 1, "cron works on one client per run");
let c = await getClient(env, "cgrowth00001");
check((await getClient(env, "cstarter0001")).outreach === undefined, "Starter clients get no outreach");
const row = c.outreach.rows[0];
check(row.domain === "bestofsoftware.com" && row.status === "review", "it picks the article AI cites most, and waits for review");
check(c.outreach.nextAt > Date.now() + 9 * 86400000, "Growth: notes are spaced out (3 a month)");
check(emails.length === 1 && emails[0].to[0] === env.OWNER_EMAIL && emails[0].subject.startsWith("Article note ready"), "only you are emailed; the writer hears nothing yet");
check((await runClientOutreach(env)) === 0, "no second note while one waits");
let link = reviewLink(/Article note ready/);
check((await call(link.replace(/k=\w+/, "k=bad"))).status === 404, "review page needs the signed link");
let rp = await (await call(link)).text();
check(rp.includes("jane@bestofsoftware.com") && rp.includes("Jane Writer") && rp.includes("shown on their own site") && !rp.includes("gmail"), "review page shows the real contact the site publishes");
check(rp.includes("Approve and send") && rp.includes("on behalf of Chairside") && rp.includes("One click and we won&#39;t email you again"), "the note says who it's for and has an opt-out line");
const k = new URL(API + link).searchParams.get("k");
const id = link.match(/\/ok\/(o\w+)/)[1];

// ---------- approving with sending not set up ----------
let r = await call(link.split("?")[0], form({ k, action: "approve" }));
let t = await r.text();
check(t.includes("isn&#39;t sent") && t.includes("OUTREACH_FROM"), "approve without outreach set up shows the email to copy, sends nothing");
check(writerMail().length === 0, "no email went to the writer");
check((await getClient(env, "cgrowth00001")).outreach.rows[0].status === "manual", "status is manual");
await call(link.split("?")[0], form({ k, action: "handsent" }));
check((await getClient(env, "cgrowth00001")).outreach.rows[0].status === "sent", "you can mark it sent by hand");
await call(link.split("?")[0], form({ k, action: "replied" }));
check((await getClient(env, "cgrowth00001")).outreach.rows[0].status === "replied", "marking a reply stops follow-ups");

// ---------- sending from a safe address ----------
env.OUTREACH_FROM = "Vince at Vantry <vince@vantryai.com>";
env.MAILING_ADDRESS = "PO Box 100, Columbus, OH 43215";
c = await getClient(env, "cgrowth00001"); c.outreach.nextAt = 0; await saveClient(env, c);
await runClientOutreach(env);
link = reviewLink(/Article note ready/);
check(/techblog\.io/.test(emails.filter((e) => /Article note ready/.test(e.subject)).slice(-1)[0].subject), "next note is for the next article");
t = await (await call(link)).text();
check(t.includes("editor@techblog.io") && t.includes("general address"), "an email on the contact page is found and marked general");
let k2 = new URL(API + link).searchParams.get("k");
t = await (await call(link.split("?")[0], form({ k: k2, action: "approve" }))).text();
check(t.includes("separate domain") && writerMail().length === 0, "sending from vantryai.com is blocked");
env.OUTREACH_FROM = "Vince at Vantry <vince@usevantry.com>";
c = await getClient(env, "cgrowth00001"); c.outreach.nextAt = 0; c.outreach.rows[1].status = "review"; await saveClient(env, c);
const p2 = JSON.parse(store.get(`out:${c.outreach.rows[1].id}`)); p2.status = "review"; store.set(`out:${p2.id}`, JSON.stringify(p2));
t = await (await call(link.split("?")[0], form({ k: k2, action: "approve" }))).text();
const sent = writerMail()[0];
check(t.includes("Approved and sent") && sent && sent.from.includes("@usevantry.com") && sent.to[0] === "editor@techblog.io", "approved note is sent from the outreach domain to the writer");
check(sent.text.includes("PO Box 100, Columbus, OH 43215") && sent.text.includes("/optout?e="), "the sent email has the mailing address and an opt-out link");
check(sent.headers["List-Unsubscribe"].includes("/optout") && sent.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "one-click unsubscribe headers are set");
check(sent.reply_to === env.OWNER_EMAIL, "replies come to you");

// ---------- opt-out ----------
const optLink = sent.text.match(/https:\/\/api\.vantryai\.com(\/optout\S+)/)[1];
check((await (await call(optLink)).text()).includes("Yes, stop emailing me"), "opt-out page asks for one press");
check((await call(optLink.replace(/k=\w+/, "k=zz"))).status === 400, "a forged opt-out link is refused");
r = await call(optLink.split("?")[0], { method: "POST", body: new URLSearchParams(new URL(API + optLink).searchParams) });
check((await r.text()).includes("opted out") && store.has("sup:editor@techblog.io"), "pressing it opts them out for good");
const row2 = (await getClient(env, "cgrowth00001")).outreach.rows[1];
const pp = JSON.parse(store.get(`out:${row2.id}`)); pp.status = "review"; store.set(`out:${pp.id}`, JSON.stringify(pp));
t = await (await call(link.split("?")[0], form({ k: k2, action: "approve" }))).text();
check(t.includes("opted out") && writerMail().length === 1, "an opted-out address is never emailed again");

// ---------- follow-up and the daily cap ----------
c = await getClient(env, "cgrowth00001");
c.outreach.nextAt = 0;
c.outreach.used = {};
c.listings.seen = { "bestofsoftware.com": { ...seen["bestofsoftware.com"], url: "https://bestofsoftware.com/dental-scheduling" } };
await saveClient(env, c);
emails.length = 0;
await runClientOutreach(env);
link = reviewLink(/Article note ready/); k2 = new URL(API + link).searchParams.get("k");
env.OUTREACH_DAILY = "1";
for (const key of [...store.keys()]) if (key.startsWith("rl:out-day")) store.delete(key);
await call(link.split("?")[0], form({ k: k2, action: "approve" }));
check(writerMail().length === 1 && writerMail()[0].to[0] === "jane@bestofsoftware.com", "second note is sent to the writer");
c = await getClient(env, "cgrowth00001");
const sentRow = c.outreach.rows.slice(-1)[0];
const sp = JSON.parse(store.get(`out:${sentRow.id}`)); sp.sentAt = Date.now() - 8 * 86400000; store.set(`out:${sp.id}`, JSON.stringify(sp));
sentRow.sentAt = sp.sentAt; await saveClient(env, c);
await runClientOutreach(env);
check(emails.some((e) => e.subject.startsWith("Follow-up ready")), "a week later you get one follow-up to approve");
const fl = reviewLink(/Follow-up ready/);
const fp = await (await call(fl)).text();
check(fp.includes("short follow-up") && fp.includes("Approve and send follow-up"), "follow-up is short and waits for you");
const before = writerMail().length;
const k3 = new URL(API + fl).searchParams.get("k");
t = await (await call(fl.split("?")[0], form({ k: k3, action: "approve" }))).text();
check(t.includes("over today") && writerMail().length === before, "the daily cap holds a send until tomorrow");
for (const key of [...store.keys()]) if (key.startsWith("rl:out-day")) store.delete(key);
await runClientOutreach(env);
check(writerMail().length === before + 1 && /follow-up/i.test(writerMail().slice(-1)[0].text), "the timer sends it the next day");
await runClientOutreach(env);
check(!emails.filter((e) => e.subject.startsWith("Follow-up ready")).slice(1).length, "only one follow-up, ever");

// ---------- bad AI output, no contact, errors ----------
badNote = true;
c = await getClient(env, "cgrowth00001");
c.outreach.nextAt = 0; c.outreach.used = {}; c.outreach.rows.forEach((x) => { x.status = "done"; x.at = 0; });
c.listings.seen = { "nomail.org": seen["nomail.org"] };
await saveClient(env, c);
emails.length = 0;
await runClientOutreach(env);
check(emails.some((e) => e.subject.startsWith("Article outreach stopped")), "a note that offers payment is thrown away and you're told");
badNote = false;
c = await getClient(env, "cgrowth00001"); c.outreach.nextAt = 0; c.outreach.used = {}; await saveClient(env, c);
await runClientOutreach(env);
link = reviewLink(/Article note ready/);
t = await (await call(link)).text();
check(t.includes("No email on their site") && t.includes("No contact page found"), "no email found: you are told, and nothing is guessed");
c = await getClient(env, "cgrowth00001"); c.outreach.rows.forEach((x) => { x.status = "done"; x.at = 0; }); c.outreach.nextAt = 0; c.outreach.used = {}; c.listings.seen = { "gone.net": { type: "article", n: 1, tot: 2, url: "https://gone.net/x", title: "x" } }; await saveClient(env, c);
await runClientOutreach(env);
check((await getClient(env, "cgrowth00001")).outreach.nextAt > Date.now(), "an unreadable article is skipped and retried later");

// ---------- admin ----------
const adm = await (await call(`/admin/audits?token=${env.ADMIN_TOKEN}`)).text();
check(adm.includes("Article outreach") && adm.includes("Find an article and write a note now"), "admin page shows the Article outreach card");
check(adm.includes("Sending is on"), "admin card says whether sending is on");
r = await call("/admin/outreach", form({ token: env.ADMIN_TOKEN, clientId: "cgrowth00001" }));
check(r.status === 303, "make-now returns to the admin page");
r = await call("/admin/outreach", form({ token: "wrong", clientId: "cgrowth00001" }));
check(r.status !== 303 && r.status < 500, "make-now needs the admin token");

console.log(`\n${count} checks, ${ok ? "all passed" : "SOME FAILED"}`);
process.exit(ok ? 0 : 1);
