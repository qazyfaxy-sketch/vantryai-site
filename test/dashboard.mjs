// Tests for the client dashboard, with fake storage.
// Run: node test/dashboard.mjs
import worker from "../src/worker.js";
import { beforeAfter, dashUrl } from "../src/lib/dashboard.js";
import { saveAudit } from "../src/lib/aiscan.js";
import { saveClient } from "../src/ai.js";

let ok = true;
let count = 0;
const check = (cond, msg) => {
  count++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) ok = false;
};

// ---------- pure ----------
const A = { results: [{ q: "q1", engine: "openai", mentioned: false }, { q: "q2", engine: "openai", mentioned: true }, { q: "q3", engine: "gemini", mentioned: false }, { q: "bad", engine: "openai", error: "x" }] };
const B = { results: [{ q: "q1", engine: "openai", mentioned: true }, { q: "q2", engine: "openai", mentioned: false }, { q: "q3", engine: "gemini", mentioned: false }, { q: "new", engine: "openai", mentioned: true }] };
const ba = beforeAfter(A, B);
check(ba[0].q === "q1" && ba[0].then === false && ba[0].now === true, "newly named questions come first");
check(ba.find((r) => r.q === "new").then === null, "a question that wasn't asked at the start shows as n/a, not as a loss");
check(ba.find((r) => r.q === "q2").now === false && ba.find((r) => r.q === "q2").then === true, "a lost answer is shown honestly");

// ---------- the page ----------
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k), list: async ({ prefix = "" } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
const env = { ADMIN_TOKEN: "admin-secret-123", OWNER_EMAIL: "booking@vantryai.com", PUBLIC_API: "https://api.vantryai.com", API_HOST: "api.vantryai.com", SITE_ORIGIN: "https://vantryai.com", VIDEO_SECRET: "vsecret", PREVIEWS: kv };
const ctx = { waitUntil() {} };
const API = "https://api.vantryai.com";
const call = (path, opts = {}) => worker.fetch(new Request(API + path, { redirect: "manual", ...opts }), env, ctx);
const mk = (id, t, results) => ({ id, createdAt: t, company: { name: "Chairside", website: "chairside.io" }, origin: "client", questions: ["q1", "q2"], engines: ["openai"], results: results.map((m, i) => ({ q: `q${i + 1}`, engine: "openai", mentioned: m, named: [], sources: [] })), summary: { mentioned: results.filter(Boolean).length, total: results.length, competitors: [], sources: [] } });
const t0 = Date.now() - 70 * 86400000;
await saveAudit(env, mk("abase0000001", t0, [false, false, true]));
await saveAudit(env, mk("alate0000001", Date.now(), [true, false, true]));
await saveClient(env, { id: "cgrowth00001", plan: "growth", status: "active", email: "owner@chairside.io", onboardedAt: t0, onboarding: { business: "Chairside", website: "chairside.io" }, audits: [{ id: "abase0000001", at: t0, mentioned: 1, total: 3, kind: "baseline" }, { id: "alate0000001", at: Date.now(), mentioned: 2, total: 3, kind: "monthly" }], pages: [{ id: "p1", status: "live", url: "https://chairside.io/answers/x", title: "Best <b>x</b>?" }, { id: "p2", status: "draft", url: "https://chairside.io/answers/y", title: "Draft page" }], videos: [{ id: "v1", status: "live", youtubeId: "dQw4w9WgXcQ", title: "A video" }, { id: "v2", status: "review", youtubeId: "abcdefghijk", title: "Not yet" }], listings: { batches: [{ id: "l1", status: "open", live: 2, submitted: 1, todo: 1 }] }, reddit: { rows: [{ id: "r1", status: "posted" }, { id: "r2", status: "open" }] }, outreach: { rows: [{ id: "o1", status: "sent" }, { id: "o2", status: "review" }] } });
await saveClient(env, { id: "cother0000001", plan: "growth", status: "active", email: "x@y.com", onboarding: { business: "Secret Co" }, audits: [] });
const url = (await dashUrl(env, "cgrowth00001")).replace(API, "");
check((await call(url.replace(/k=\w+/, "k=bad"))).status === 404 && (await call("/d/cgrowth00001")).status === 404, "the dashboard needs the signed link");
check((await call(url.replace("cgrowth00001", "cother0000001"))).status === 404, "one client's link doesn't open another client's page");
const r = await call(url);
const h = await r.text();
check(r.status === 200 && r.headers.get("X-Robots-Tag") === "noindex" && r.headers.get("Cache-Control") === "no-store", "the page is private: no-store and noindex");
check(h.includes("2 of 3") && h.includes("1 of 3"), "it shows the latest score and where they started");
check(h.includes("1 newly named") && h.includes("0 no longer named"), "then-and-now counts come from the saved answers");
check(h.includes("<svg") && h.includes("2/3") && h.includes("1/3"), "a chart shows the score by report");
check(h.includes("<strong>1</strong> page") && !h.includes("Draft page") && h.includes("&lt;b&gt;x"), "only live pages are listed, and titles are escaped");
check(h.includes("youtu.be/dQw4w9WgXcQ") && !h.includes("abcdefghijk"), "only live videos are listed");
check(h.includes("<strong>2</strong> listings live") && h.includes("2 still to do"), "listing progress is real");
check(h.includes("<strong>1</strong> Reddit answer") && h.includes("1 waiting for you") && h.includes("<strong>1</strong> note sent"), "Reddit and outreach counts count only what was posted or sent");
check(/can.t control what AI says/.test(h.replace(/&#39;/g, "'")) && !/guarantee(?!d)/i.test(h.replace(/never promise/gi, "")), "the page says plainly that results aren't controlled or promised");
check(!h.includes("Secret Co"), "nothing from other clients appears");
check((await call("/d/cgrowth00001?k=" + url.split("k=")[1], { method: "POST" })).status === 404, "the dashboard is read-only");
const adm = await (await call(`/admin/audits?token=${env.ADMIN_TOKEN}`)).text();
check(adm.includes("Client dashboards") && adm.includes("/d/cgrowth00001?k="), "you can open any client's dashboard from your admin page");

console.log(`\n${count} checks, ${ok ? "all passed" : "SOME FAILED"}`);
process.exit(ok ? 0 : 1);
