// Tests for client YouTube videos, with fake AI, GitHub, Google/YouTube and email.
// Run: node test/video.mjs
import worker from "../src/worker.js";
import { pageText, pickLinks, cleanScript } from "../src/lib/video.js";
import { saveAudit } from "../src/lib/aiscan.js";
import { runClientVideos, saveClient, getClient } from "../src/ai.js";

let ok = true;
let count = 0;
const check = (cond, msg) => {
  count++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) ok = false;
};

// ---------- pure helpers ----------
check(pageText("<style>x{}</style><h1>Hi &amp; bye</h1><script>evil()</script><p>Text</p>") === "Hi & bye\nText", "page text drops scripts and styles");
const links = pickLinks('<a href="/pricing">P</a><a href="/login">L</a><a href="https://other.com/x">O</a><a href="/features/">F</a><a href="/blog/post-1">B</a><a href="/logo.png">I</a>', "https://chairside.io");
check(links.includes("https://chairside.io/pricing") && links.includes("https://chairside.io/features"), "picks pricing and features pages");
check(!links.some((l) => /login|other\.com|blog|png/.test(l)), "skips login, other sites, blog posts and images");
const co = { name: "Chairside", website: "https://chairside.io", category: "dental scheduling", audience: "" };
const cs = cleanScript({ title: "Best dental scheduling app?", segments: [{ chapter: "A", say: "Chairside books patients online.", page: "https://evil.com" }, { chapter: "B", say: "It sends text reminders.", page: "https://chairside.io/pricing" }, { chapter: "C", say: "Pricing is on the site." }] }, co, "What's the best dental scheduling app?", [{ url: "https://chairside.io" }, { url: "https://chairside.io/pricing" }]);
check(cs.title.includes("Chairside"), "title always includes the company name");
check(cs.segments[1].page === "https://chairside.io" && cs.segments[2].page === "https://chairside.io/pricing", "pages outside their site are replaced with their homepage");
check(cs.segments[0].say.startsWith("This video is sponsored by Chairside"), "every video opens by saying it's sponsored");
check(cs.description.startsWith("Sponsored by Chairside. This is a paid promotion."), "description starts with the paid-promotion disclosure");
check(cleanScript({ segments: [{ say: "Too short." }] }, co, "q?", [{ url: "x" }]) === null, "a thin script is rejected");

// ---------- fake services ----------
const emails = [];
const dispatches = [];
const ytCalls = [];
const prompts = [];
let publishFails = false;
const ok200 = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
const SCRIPT = { title: "Best scheduling software for a small dental office?", summary: "A look at Chairside.", tags: ["dental scheduling"], segments: [
  { chapter: "What it is", say: "Chairside is online booking for dental offices.", page: "https://chairside.io" },
  { chapter: "Features", say: "Patients book and get text reminders.", page: "https://chairside.io/features" },
  { chapter: "Pricing", say: "Plans start at the price on their pricing page.", page: "https://chairside.io/pricing" },
] };

globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = opts.body ? (typeof opts.body === "string" ? opts.body : opts.body.toString()) : "";
  if (url.host === "chairside.io") {
    if (url.pathname === "/") return new Response('<html><body><h1>Chairside: online booking for dental offices</h1><p>Patients book online and get text reminders before each visit. Built for small practices.</p><a href="/pricing">Pricing</a><a href="/features">Features</a><a href="/login">Log in</a></body></html>');
    return new Response(`<html><body><h1>${url.pathname}</h1><p>Details about ${url.pathname.slice(1)} for Chairside, the dental booking app for small offices. Plans and features are listed here.</p></body></html>`);
  }
  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(body);
    prompts.push(b.messages[0].content);
    return ok200({ content: [{ type: "text", text: JSON.stringify(SCRIPT) }] });
  }
  if (url.host === "api.github.com") { dispatches.push({ auth: opts.headers.Authorization, body: JSON.parse(body) }); return new Response(null, { status: 204 }); }
  if (url.host === "oauth2.googleapis.com") {
    const p = new URLSearchParams(body);
    if (p.get("grant_type") === "authorization_code") return ok200({ access_token: "at1", refresh_token: "rt1", expires_in: 3600 });
    return ok200({ access_token: "at2", expires_in: 3600 });
  }
  if (url.host === "www.googleapis.com") {
    ytCalls.push({ method: opts.method, path: url.pathname + url.search, body, auth: opts.headers?.Authorization });
    if (url.pathname.endsWith("/channels")) return ok200({ items: [{ id: "UC123", snippet: { title: "Dental Software Guide" } }] });
    if (opts.method === "PUT" && publishFails) return new Response(JSON.stringify({ error: { message: "The video is locked" } }), { status: 403 });
    if (opts.method === "DELETE") return new Response(null, { status: 204 });
    return ok200({ id: "x" });
  }
  if (url.host === "api.resend.com") { emails.push(JSON.parse(body)); return ok200({ id: "em" }); }
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
  ANTHROPIC_API_KEY: "a", RESEND_API_KEY: "re", ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com",
  PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com",
  GH_DISPATCH_TOKEN: "ghp_test", VIDEO_SECRET: "vsecret", YT_CLIENT_ID: "cid", YT_CLIENT_SECRET: "csecret",
  PREVIEWS: kv,
};
const ctx = { waits: [], waitUntil(p) { this.waits.push(p); } };
const API = "https://api.vantryai.com";
const call = (path, opts = {}) => worker.fetch(new Request(API + path, { redirect: "manual", ...opts }), env, ctx);
const form = (obj) => ({ method: "POST", body: new URLSearchParams(obj) });

// A Growth client whose starting report is done, plus a Starter client.
await saveAudit(env, { id: "aaudit000001", createdAt: Date.now(), company: { name: "Chairside", website: "chairside.io" }, origin: "client", questions: ["best dental scheduling software?", "dental booking app for 2 dentists?"], engines: ["openai"], results: [{ q: "best dental scheduling software?", engine: "openai", mentioned: true, named: [], sources: [] }, { q: "dental booking app for 2 dentists?", engine: "openai", mentioned: false, named: ["Weave"], sources: [] }], summary: { mentioned: 1, total: 2, competitors: [], sources: [] } });
const base = { status: "active", onboardedAt: Date.now(), startedAt: Date.now(), audits: [{ id: "aaudit000001", at: Date.now(), mentioned: 1, total: 2, kind: "baseline" }], questions: ["best dental scheduling software?", "dental booking app for 2 dentists?"] };
await saveClient(env, { id: "cgrowth00001", plan: "growth", email: "owner@chairside.io", onboarding: { business: "Chairside", website: "chairside.io", sell: "dental scheduling software", buyers: "small dental offices", competitors: "Weave, NexHealth", avoid: "patient names", reportEmail: "reports@chairside.io" }, ...base });
await saveClient(env, { id: "cstarter0001", plan: "starter", email: "s@x.com", onboarding: { business: "Tiny", website: "chairside.io" }, ...base });

// ---------- nothing happens until YouTube is connected ----------
check((await runClientVideos(env)) === 0, "no videos before a YouTube channel is connected");

const adm0 = await (await call(`/admin/audits?token=${env.ADMIN_TOKEN}`)).text();
check(adm0.includes("Videos") && adm0.includes("Connect YouTube"), "admin page shows the Videos card with a Connect YouTube link");

let r = await call(`/admin/youtube/connect?token=${env.ADMIN_TOKEN}&channel=main`);
const google = new URL(r.headers.get("Location"));
check(r.status === 302 && google.host === "accounts.google.com" && google.searchParams.get("access_type") === "offline", "Connect YouTube sends you to Google sign-in for lasting access");
r = await call(`/youtube/callback?code=abc&state=main.wrongsig`);
check(r.status === 400, "a forged sign-in return is refused");
r = await call(`/youtube/callback?code=abc&state=${encodeURIComponent(google.searchParams.get("state"))}`);
check(r.status === 200 && (await r.text()).includes("Dental Software Guide"), "after Google sign-in the channel is connected");
check(JSON.parse(store.get("yt:ch:main")).refresh === "rt1", "the channel's lasting access is saved (never shown)");

// ---------- the cron makes a video ----------
check((await runClientVideos(env)) === 1, "cron starts one video");
let c = await getClient(env, "cgrowth00001");
const row = c.videos?.[0];
check(row && row.status === "rendering", "the client's video is rendering");
check(row.q === "dental booking app for 2 dentists?", "it picks a question AI isn't naming them for yet");
check(c.nextVideoAt > Date.now() + 14 * 86400000 && c.nextVideoAt < Date.now() + 16 * 86400000, "Growth: next video in about 15 days (2 a month)");
check(dispatches.length === 1 && dispatches[0].body.event_type === "render-video" && dispatches[0].body.client_payload.id === row.id, "GitHub is asked to render it");
check(prompts[0].includes("Weave") === false || prompts.length >= 2, "script was written and then fact-checked");
check(prompts.length === 2, "two AI passes: write, then fact-check against their website");
check((await getClient(env, "cstarter0001")).videos === undefined, "Starter clients don't get videos");
check((await runClientVideos(env)) === 0, "no second video while one is in progress");

// ---------- the renderer ----------
r = await call(`/api/video/job/${row.id}`);
check(r.status === 404, "job details need the shared secret");
r = await call(`/api/video/job/${row.id}`, { headers: { "X-Video-Secret": "vsecret" } });
const job = await r.json();
check(job.script.segments[0].say.includes("sponsored by Chairside") && job.youtube.accessToken === "at2", "the renderer gets the script and a short-lived YouTube token");
check(job.script.segments.every((s) => !s.page || s.page.startsWith("https://chairside.io")), "every page on screen is the client's own");

r = await call("/api/video/done", { method: "POST", headers: { "Content-Type": "application/json", "X-Video-Secret": "vsecret" }, body: JSON.stringify({ id: row.id, youtubeId: "dQw4w9WgXcQ", durationSec: 140, runUrl: "https://github.com/qazyfaxy-sketch/vantryai-site/actions/runs/1" }) });
check(r.status === 200, "renderer reports back");
c = await getClient(env, "cgrowth00001");
check(c.videos[0].status === "review", "the video waits for your approval");
const ready = emails.find((e) => e.subject.startsWith("Video ready to check"));
check(ready && ready.to[0] === env.OWNER_EMAIL && ready.text.includes("https://youtu.be/dQw4w9WgXcQ"), "you get an email with the private YouTube link");
const review = ready.text.match(/https:\/\/api\.vantryai\.com(\/v\/\S+)/)[1];

// ---------- review ----------
r = await call(review.replace(/k=\w+/, "k=bad"));
check(r.status === 404, "the review page needs the signed link");
r = await call(review);
const rp = await r.text();
check(r.status === 200 && rp.includes("Approve and publish") && rp.includes("sponsored by Chairside"), "review page shows the script and buttons");
const k = new URL(API + review).searchParams.get("k");
r = await call(review.split("?")[0], form({ k, action: "approve" }));
const ap = await r.text();
check(ap.includes("Published"), "Approve publishes it");
check(ytCalls.some((x) => x.method === "PUT" && x.body.includes('"privacyStatus":"public"')), "YouTube is told to make it public");
check((await getClient(env, "cgrowth00001")).videos[0].status === "live", "status is live");
check(emails.some((e) => e.to[0] === "reports@chairside.io" && e.text.includes("https://youtu.be/dQw4w9WgXcQ") && e.text.includes("paid promotion")), "the client gets told, with the link and the disclosure");

// ---------- make one now, then redo it ----------
r = await call("/admin/video", form({ token: env.ADMIN_TOKEN, clientId: "cgrowth00001" }));
check(r.status === 303 && decodeURIComponent(r.headers.get("Location")).includes("Rendering"), "Make a video now starts one from the admin page");
c = await getClient(env, "cgrowth00001");
const v2 = c.videos.slice(-1)[0];
await call("/api/video/done", { method: "POST", headers: { "Content-Type": "application/json", "X-Video-Secret": "vsecret" }, body: JSON.stringify({ id: v2.id, youtubeId: "abcdefghijk" }) });
const review2 = emails.filter((e) => e.subject.startsWith("Video ready")).slice(-1)[0].text.match(/https:\/\/api\.vantryai\.com(\/v\/\S+)/)[1];
const k2 = new URL(API + review2).searchParams.get("k");
const before = prompts.length;
r = await call(review2.split("?")[0], form({ k: k2, action: "redo", note: "show the pricing page more" }));
check((await r.text()).includes("On it"), "Redo starts a new version");
check(ytCalls.some((x) => x.method === "DELETE" && x.path.includes("abcdefghijk")), "the old version is deleted from YouTube");
check(prompts.slice(before).some((p) => p.includes("show the pricing page more")), "your note goes into the new script");
c = await getClient(env, "cgrowth00001");
check(c.videos.find((x) => x.id === v2.id).status === "redone" && c.videos.slice(-1)[0].status === "rendering", "old marked redone, new one rendering");

// ---------- YouTube won't publish yet (API project not approved) ----------
const v3 = c.videos.slice(-1)[0];
await call("/api/video/done", { method: "POST", headers: { "Content-Type": "application/json", "X-Video-Secret": "vsecret" }, body: JSON.stringify({ id: v3.id, youtubeId: "lockedvid01" }) });
const review3 = emails.filter((e) => e.subject.startsWith("Video ready")).slice(-1)[0].text.match(/https:\/\/api\.vantryai\.com(\/v\/\S+)/)[1];
const k3 = new URL(API + review3).searchParams.get("k");
publishFails = true;
r = await call(review3.split("?")[0], form({ k: k3, action: "approve" }));
check((await r.text()).includes("locked as private"), "if YouTube keeps it locked, the page explains the 2-minute manual upload");
r = await call(review3.split("?")[0], form({ k: k3, action: "link", link: "https://youtu.be/manual12345" }));
check((await r.text()).includes("Saved"), "pasting the link of a manual upload marks it live");
check((await getClient(env, "cgrowth00001")).videos.slice(-1)[0].youtubeId === "manual12345", "the manual upload's link is saved");
publishFails = false;

// ---------- failures ----------
c = await getClient(env, "cgrowth00001");
c.nextVideoAt = 0;
await saveClient(env, c);
await runClientVideos(env);
c = await getClient(env, "cgrowth00001");
const v4 = c.videos.slice(-1)[0];
await call("/api/video/done", { method: "POST", headers: { "Content-Type": "application/json", "X-Video-Secret": "vsecret" }, body: JSON.stringify({ id: v4.id, error: "ElevenLabs said 401" }) });
check(emails.some((e) => e.subject.startsWith("Video failed") && e.text.includes("ElevenLabs said 401")), "a failed render emails you the reason");
c = await getClient(env, "cgrowth00001");
c.nextVideoAt = 0;
await saveClient(env, c);
await runClientVideos(env);
c = await getClient(env, "cgrowth00001");
c.videos.slice(-1)[0].at = Date.now() - 4 * 3600000;
await saveClient(env, c);
await runClientVideos(env);
check((await getClient(env, "cgrowth00001")).videos.slice(-1)[0].status === "failed", "a render that never reports back is marked failed after 3 hours");

const adm = await (await call(`/admin/audits?token=${env.ADMIN_TOKEN}`)).text();
check(adm.includes("Connected: Dental Software Guide") && adm.includes("Make a video now"), "admin page shows the connected channel and the make-now button");

console.log(`\n${count} checks, ${ok ? "all passed" : "SOME FAILED"}`);
process.exit(ok ? 0 : 1);
