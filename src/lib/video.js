// YouTube videos for Growth and Pro clients, fully automatic.
//
// Why: in Ahrefs' study of 75,000 brands (Dec 2025), YouTube mentions had the strongest link to being
// named by AI. Each video answers one buyer question about the client, with their real product on screen.
//
// The flow, with no work for the client:
//   1. Cron picks a buyer question AI isn't naming them for yet (Growth: 2 videos / 30 days, Pro: 4).
//   2. We read their website and AI writes a script from it, then a second AI pass removes anything
//      the website doesn't support. Nothing is invented. It says up front that it's sponsored.
//   3. We ask GitHub Actions (free for this public repo) to render it: video/render.py screenshots their
//      pages, voices the script with ElevenLabs, adds captions and chapters, and uploads it to YouTube
//      as PRIVATE, marked as a paid promotion.
//   4. You get an email: watch it, then Approve (goes public, client gets told), Redo or Skip.
//      Set VIDEO_AUTO_PUBLISH="true" once you trust the quality.
//
// Routes:
//   GET  /api/video/job/:id     the renderer fetches its job + a short-lived YouTube token (X-Video-Secret)
//   POST /api/video/done        the renderer reports back (X-Video-Secret)
//   GET/POST /v/:id?k=          review page with Approve / Redo / Skip (signed link from your email)
//   GET  /youtube/callback      Google sign-in return for connecting a YouTube channel
//   /admin/youtube/connect      connect a channel (from the admin page)
//   POST /admin/video           make a video for a client now
import { json, html, httpError, randomId, readJson, safeEqual, esc } from "./util.js";
import { claudeJson, getAudit } from "./aiscan.js";
import { scrubText } from "./sitefix.js";
import { sendEmail } from "./email.js";
import { page } from "../pages/shell.js";

export const VIDEOS_PER_MONTH = { growth: 2, pro: 4 };
export const SHORTS_PER_MONTH = { growth: 4, pro: 8 };
const DAY = 86400000;
const MONTH = 30 * DAY;
const MAX_ATTEMPTS = 3;
const STALE_MS = 3 * 3600000;
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.force-ssl"];
const sign = "Thanks,\nVince\nVantry · vantryai.com";

const api = (env) => env.PUBLIC_API || "https://api.vantryai.com";
const vidKey = (id) => `vid:${id}`;
const chanKey = (ch) => `yt:ch:${ch}`;
const channelOf = (env, c) => (c && c.videoChannel) || env.VIDEO_CHANNEL || "main";

export function isVideoPath(p) {
  return /^\/api\/video\/job\/v[a-z0-9]{11}$/.test(p) || p === "/api/video/done" || /^\/v\/v[a-z0-9]{11}$/.test(p) || p === "/youtube/callback";
}

// ---------------- Storage ----------------

export async function getVideo(env, id) {
  const raw = /^v[a-z0-9]{11}$/.test(id) ? await env.PREVIEWS.get(vidKey(id)) : null;
  return raw ? JSON.parse(raw) : null;
}
const saveVideo = (env, v) => env.PREVIEWS.put(vidKey(v.id), JSON.stringify(v));

async function hmac(env, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.VIDEO_SECRET || env.ADMIN_TOKEN || "x"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
export const reviewUrl = async (env, id) => `${api(env)}/v/${id}?k=${await hmac(env, `video:${id}`)}`;

// ---------------- YouTube (Google sign-in, tokens, publish) ----------------

export async function connectUrl(env, channel) {
  if (!env.YT_CLIENT_ID) throw httpError(400, "Add YT_CLIENT_ID and YT_CLIENT_SECRET first (see README).");
  const ch = /^[a-z0-9-]{1,30}$/.test(channel) ? channel : "main";
  const state = `${ch}.${await hmac(env, `yt:${ch}`)}`;
  const q = new URLSearchParams({ client_id: env.YT_CLIENT_ID, redirect_uri: `${api(env)}/youtube/callback`, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function googleToken(env, params) {
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, ...params }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google sign-in failed: ${d.error_description || d.error || res.status}`);
  return d;
}

async function youtubeCallback(url, env) {
  const [ch, sig] = String(url.searchParams.get("state") || "").split(".");
  if (!ch || !safeEqual(sig || "", await hmac(env, `yt:${ch}`))) throw httpError(400, "That sign-in link expired. Start again from your admin page.");
  if (url.searchParams.get("error")) throw httpError(400, "Google sign-in was canceled. Start again from your admin page.");
  const tok = await googleToken(env, { grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: `${api(env)}/youtube/callback` });
  if (!tok.refresh_token) throw httpError(400, "Google didn't give us lasting access. Remove Vantry at myaccount.google.com/permissions, then connect again.");
  const info = await yt(tok.access_token, "GET", "/channels?part=snippet&mine=true");
  const item = info.items?.[0];
  if (!item) throw httpError(400, "That Google account has no YouTube channel. Create one at youtube.com, then connect again.");
  await env.PREVIEWS.put(chanKey(ch), JSON.stringify({ refresh: tok.refresh_token, channelId: item.id, title: item.snippet.title, at: Date.now() }));
  await env.PREVIEWS.delete(`yt:at:${ch}`);
  return html(page({ title: "YouTube connected", body: `<main><h1>Connected: ${esc(item.snippet.title)}</h1><p class="lede">New videos for the "${esc(ch)}" channel will upload here automatically. You can close this tab.</p></main>` }));
}

export async function getChannel(env, ch) {
  const raw = await env.PREVIEWS.get(chanKey(ch));
  return raw ? JSON.parse(raw) : null;
}

export async function accessToken(env, ch) {
  const cached = await env.PREVIEWS.get(`yt:at:${ch}`);
  if (cached) return cached;
  const c = await getChannel(env, ch);
  if (!c) return null;
  const tok = await googleToken(env, { grant_type: "refresh_token", refresh_token: c.refresh });
  await env.PREVIEWS.put(`yt:at:${ch}`, tok.access_token, { expirationTtl: Math.max(60, (tok.expires_in || 3600) - 600) });
  return tok.access_token;
}

async function yt(token, method, path, body) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return {};
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error?.message || `YouTube said ${res.status}`);
  return d;
}

async function publish(env, v) {
  const token = await accessToken(env, v.channel);
  if (!token) throw new Error("No YouTube channel connected.");
  await yt(token, "PUT", "/videos?part=status", { id: v.youtubeId, status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true, license: "youtube", publicStatsViewable: true } });
}

async function removeFromYouTube(env, v) {
  if (!v.youtubeId) return;
  try {
    const token = await accessToken(env, v.channel);
    if (token) await yt(token, "DELETE", `/videos?id=${encodeURIComponent(v.youtubeId)}`);
  } catch (e) {
    console.log("YouTube delete failed", e.message);
  }
}

// ---------------- Reading the client's website ----------------

export function pageText(htmlText) {
  return String(htmlText || "")
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

const GOOD_PAGES = /pricing|price|plans|features|product|how-it-works|how|solutions|platform|about|integrations|use-cases|why/i;

export function pickLinks(htmlText, base, max = 3) {
  const b = new URL(base);
  const seen = new Set([b.origin + b.pathname.replace(/\/$/, "")]);
  const out = [];
  for (const m of String(htmlText).matchAll(/href=["']([^"'#]+)["']/gi)) {
    let u;
    try { u = new URL(m[1], b); } catch { continue; }
    if (u.hostname.replace(/^www\./, "") !== b.hostname.replace(/^www\./, "")) continue;
    if (/\.(pdf|png|jpe?g|gif|svg|webp|zip|xml|css|js)$/i.test(u.pathname) || /login|signin|sign-in|signup|register|cart|account|privacy|terms|legal|cookie|careers|jobs|blog\/.+/i.test(u.pathname)) continue;
    const clean = u.origin + u.pathname.replace(/\/$/, "");
    if (seen.has(clean)) continue;
    seen.add(clean);
    const score = (GOOD_PAGES.test(u.pathname) ? 10 : 0) - u.pathname.split("/").length;
    out.push({ url: clean, score });
  }
  return out.sort((a, b2) => b2.score - a.score).slice(0, max).map((x) => x.url);
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "VantryCheck/1.0 (+https://vantryai.com/ai/)" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    return res.ok ? (await res.text()).slice(0, 500000) : null;
  } catch {
    return null;
  }
}

export async function readSite(website) {
  const site = String(website || "").trim();
  if (!site) return [];
  const home = (/^https?:\/\//.test(site) ? site : `https://${site}`).replace(/\/+$/, "");
  const homeHtml = await fetchPage(home);
  if (!homeHtml) return [];
  const others = pickLinks(homeHtml, home);
  const rest = await Promise.all(others.map(async (u) => ({ url: u, html: await fetchPage(u) })));
  return [{ url: home, html: homeHtml }, ...rest.filter((p) => p.html)].map((p) => ({ url: p.url, text: pageText(p.html).slice(0, 3500) })).filter((p) => p.text.length > 80);
}

// ---------------- Choosing the question and writing the script ----------------

export async function pickQuestion(env, c) {
  const used = new Set((c.videos || []).filter((v) => v.status !== "skipped").map((v) => v.q));
  const last = (c.audits || []).slice(-1)[0];
  const audit = last ? await getAudit(env, last.id) : null;
  const missed = audit ? [...new Set(audit.results.filter((r) => !r.error && !r.mentioned).map((r) => r.q))] : [];
  const all = [...missed, ...(c.questions || [])];
  return all.find((q) => !used.has(q)) || all[0] || null;
}

const SCRIPT_SYSTEM = (co, competitors, avoid) => `You write scripts for short, honest YouTube explainer videos for people shopping for ${co.category}. This video is about ${co.name} and is paid for by them; the intro already says so, so don't repeat it.
Rules you never break:
- Use ONLY facts found in the website text you're given. Never invent features, prices, numbers, customers, reviews, awards, integrations or results. If it's not in the text, leave it out.
- Never say ${co.name} is the best, #1, or better than anyone. No guarantees.
- Say nothing about competitors except, at most, that buyers also compare ${competitors || "other options"} (names only, no claims).
${avoid ? `- Never mention: ${avoid}\n` : ""}- Plain spoken English, short sentences, no hype words (revolutionary, game-changing, seamless...). Speak to the buyer as "you".
- About 260 to 380 words in total.
Return JSON only:
{"title": "under 90 characters, phrased like the buyer's question, includes ${co.name}",
 "summary": "2 plain sentences for the video description",
 "tags": ["up to 8 short search tags"],
 "segments": [{"chapter": "2-4 words", "say": "1 to 4 sentences", "page": "one of the page URLs given"}]}
Use 5 to 8 segments. The first answers the buyer's question directly. Pick the page that best shows what each segment talks about.`;

const CHECK_SYSTEM = `You are a strict fact checker. You get a video script (JSON) and the website text it must be based on.
Remove or rewrite every sentence that isn't directly supported by the website text, every superlative ("best", "#1", "leading"), every claim about another company and every guarantee. Keep the same JSON shape and keep it natural to read aloud. Return the corrected JSON only.`;

export async function writeScript(env, c, question, pages, note = "") {
  const co = companyOfClient(c);
  const sources = pages.map((p, i) => `PAGE ${i + 1}: ${p.url}\n${p.text}`).join("\n\n");
  const model = env.VIDEO_MODEL || "claude-sonnet-5-5";
  const draft = await claudeJson(env, SCRIPT_SYSTEM(co, String(c.onboarding?.competitors || "").replace(/\s+/g, " ").slice(0, 200), String(c.onboarding?.avoid || "").slice(0, 400)), `Buyer question: ${question}\n${note ? `Change requested by the reviewer: ${note}\n` : ""}Company: ${co.name} (${co.website})\nWho buys it: ${co.audience || "-"}\n\nWebsite text:\n${sources}`, 2500, model);
  if (!draft || !Array.isArray(draft.segments)) return null;
  const checked = await claudeJson(env, CHECK_SYSTEM, `Script:\n${JSON.stringify(draft)}\n\nWebsite text:\n${sources}`, 2500, model);
  return cleanScript(checked && Array.isArray(checked.segments) ? checked : draft, co, question, pages);
}

const SHORT_SYSTEM = (co, competitors, avoid) => `You write scripts for 25-to-40-second vertical "Shorts" for people shopping for ${co.category}. The video is about ${co.name} and is paid for by them (a "Paid promotion" label is on screen the whole time and the outro says so, so don't mention it).
Format rules:
- Beat 1 is the HOOK: the buyer's question in 9 words or fewer, spoken as a question. Nothing before it.
- Then 4 to 6 beats. Each beat is ONE idea in ONE short sentence of 6 to 16 words, spoken aloud, plain English, "you" voice.
- Each beat also has "text": the 2 to 5 word headline shown big on screen (a fact or a number from the page, like "$99 a month" or "Text reminders").
- Total spoken words: 70 to 100.
Rules you never break:
- Use ONLY facts found in the website text. Never invent features, prices, numbers, customers, reviews, awards, integrations or results. If it isn't in the text, leave it out.
- Never say ${co.name} is the best, #1 or better than anyone. No guarantees. No claims about competitors${competitors ? ` (buyers also compare ${competitors}; names only, if at all)` : ""}.
${avoid ? `- Never mention: ${avoid}\n` : ""}- No hype words (revolutionary, game-changing, seamless, ultimate...).
Return JSON only:
{"title": "under 80 characters, phrased like the buyer's question, includes ${co.name}",
 "summary": "2 plain sentences for the description",
 "tags": ["up to 8 short tags"],
 "segments": [{"chapter": "2-3 words", "say": "the spoken sentence", "text": "the on-screen headline", "page": "one of the page URLs given"}]}`;

const SHORT_CHECK = `You are a strict fact checker. You get a Shorts script (JSON) and the website text it must be based on.
Remove or rewrite every beat that isn't directly supported by the website text, every superlative ("best", "#1", "leading"), every claim about another company and every guarantee. Keep the same JSON shape, keep every "text" headline short (2 to 5 words) and every "say" to one sentence under 17 words. Return the corrected JSON only.`;

export async function writeShort(env, c, question, pages, note = "") {
  const co = companyOfClient(c);
  const sources = pages.map((p, i) => `PAGE ${i + 1}: ${p.url}\n${p.text.slice(0, 3500)}`).join("\n\n");
  const model = env.VIDEO_MODEL || "claude-sonnet-5-5";
  const draft = await claudeJson(env, SHORT_SYSTEM(co, String(c.onboarding?.competitors || "").replace(/\s+/g, " ").slice(0, 200), String(c.onboarding?.avoid || "").slice(0, 400)), `Buyer question: ${question}\n${note ? `Change requested by the reviewer: ${note}\n` : ""}Company: ${co.name} (${co.website})\nWho buys it: ${co.audience || "-"}\n\nWebsite text:\n${sources}`, 2000, model);
  if (!draft || !Array.isArray(draft.segments)) return null;
  const checked = await claudeJson(env, SHORT_CHECK, `Script:\n${JSON.stringify(draft)}\n\nWebsite text:\n${sources}`, 2000, model);
  return cleanShort(checked && Array.isArray(checked.segments) ? checked : draft, co, question, pages);
}

const words = (t) => String(t || "").trim().split(/\s+/).filter(Boolean).length;

export function cleanShort(s, co, question, pages) {
  const urls = pages.map((p) => p.url);
  const home = urls[0] || co.website;
  let body = (s.segments || [])
    .map((x) => ({ chapter: String(x.chapter || "").slice(0, 30).trim(), say: scrubText(String(x.say || "").replace(/\s+/g, " ").trim()).slice(0, 200), text: scrubText(String(x.text || "").replace(/\s+/g, " ").trim()).slice(0, 40), page: urls.includes(x.page) ? x.page : home }))
    .filter((x) => words(x.say) >= 3 && words(x.say) <= 24)
    .slice(0, 7);
  while (body.length > 4 && body.reduce((n, x) => n + words(x.say), 0) > 100) body.pop(); // keep it under about 40 seconds
  if (body.length < 4) return null;
  for (const b of body) if (!b.text || words(b.text) > 6) b.text = b.say.split(/\s+/).slice(0, 4).join(" ").replace(/[.,;:!?]+$/, "");
  const hookText = String(question).replace(/\?$/, "").trim().split(/\s+/).length <= 11 ? String(question).trim() : body[0].text;
  body[0].text = hookText;
  body[0].page = home;
  const outro = { chapter: "Learn more", visual: "title", say: `Sponsored by ${co.name}. Details in the description.`, text: hookText };
  let title = String(s.title || question).replace(/\s+/g, " ").trim();
  if (!title.toLowerCase().includes(co.name.toLowerCase())) title = `${title.replace(/\?$/, "")}: ${co.name}`;
  title = title.slice(0, 90);
  const summary = String(s.summary || "").replace(/\s+/g, " ").trim().slice(0, 300);
  return {
    format: "short",
    title,
    question,
    segments: [...body, outro],
    tags: (Array.isArray(s.tags) ? s.tags : []).map((t) => String(t).slice(0, 40)).filter(Boolean).slice(0, 8),
    description: `Sponsored by ${co.name}. This is a paid promotion.\n\n${summary}\n\n${co.name}: ${co.website}\n\nWhat's on screen is ${co.name}'s own website. Narrated with an AI voice. Facts come from ${co.name}'s public website; check it for current details and pricing.\n\n#Shorts`,
  };
}

export function companyOfClient(c) {
  const o = c.onboarding || {};
  const site = String(o.website || "").trim();
  const host = site.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return { name: String(o.business || host.split(".")[0] || "this company").slice(0, 80), website: site ? (/^https?:\/\//.test(site) ? site : `https://${site}`) : "", category: String(o.sell || "software").slice(0, 120), audience: String(o.buyers || "").slice(0, 160) };
}

export function cleanScript(s, co, question, pages) {
  const urls = pages.map((p) => p.url);
  const home = urls[0] || co.website;
  const body = (s.segments || [])
    .map((x) => ({ chapter: String(x.chapter || "").slice(0, 40).trim(), say: String(x.say || "").replace(/\s+/g, " ").trim().slice(0, 700), page: urls.includes(x.page) ? x.page : home }))
    .filter((x) => x.say.length > 10)
    .slice(0, 8);
  if (body.length < 3) return null;
  let title = String(s.title || question).replace(/\s+/g, " ").trim();
  if (!title.toLowerCase().includes(co.name.toLowerCase())) title = `${title.replace(/\?$/, "")}: ${co.name}`;
  title = title.slice(0, 95);
  const intro = { chapter: "Intro", visual: "title", say: `This video is sponsored by ${co.name}. If you're asking, "${question.replace(/\?$/, "")}?", here's what you should know about ${co.name}.` };
  const outro = { chapter: "Learn more", visual: "title", say: `That's a quick look at ${co.name}. If it sounds like a fit, the link is in the description. Thanks for watching.` };
  const summary = String(s.summary || "").replace(/\s+/g, " ").trim().slice(0, 400);
  return {
    title,
    question,
    segments: [intro, ...body, outro],
    tags: (Array.isArray(s.tags) ? s.tags : []).map((t) => String(t).slice(0, 40)).filter(Boolean).slice(0, 8),
    description: `Sponsored by ${co.name}. This is a paid promotion.\n\n${summary}\n\n${co.name}: ${co.website}\n\nWhat's on screen is ${co.name}'s own website. Narrated with an AI voice. Facts come from ${co.name}'s public website; check it for current details and pricing.`,
  };
}

// ---------------- Making a video ----------------

export async function dispatchRender(env, id) {
  if (!env.GH_DISPATCH_TOKEN) throw new Error("GH_DISPATCH_TOKEN isn't set, so GitHub can't render videos yet.");
  const res = await fetch(`https://api.github.com/repos/${env.GH_REPO || "qazyfaxy-sketch/vantryai-site"}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "vantry-engine", "Content-Type": "application/json" },
    body: JSON.stringify({ event_type: "render-video", client_payload: { id, api: api(env) } }),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function makeVideo(env, c, saveClient, { note = "", question: forced, format = "long" } = {}) {
  const question = forced || (await pickQuestion(env, c));
  if (!question) throw new Error("No buyer questions yet. Their starting report has to finish first.");
  const pages = await readSite(c.onboarding?.website);
  if (!pages.length) throw new Error(`Couldn't read their website (${c.onboarding?.website || "none given"}).`);
  const script = format === "short" ? await writeShort(env, c, question, pages, note) : await writeScript(env, c, question, pages, note);
  if (!script) throw new Error("The script didn't come out right. Try again in a bit.");
  script.question = question;
  const v = { id: `v${randomId(11)}`, clientId: c.id, channel: channelOf(env, c), status: "rendering", createdAt: Date.now(), script, company: companyOfClient(c), pages: pages.map((p) => p.url), attempts: 1, history: [] };
  await saveVideo(env, v);
  (c.videos ||= []).push({ id: v.id, at: v.createdAt, q: question, status: "rendering", title: script.title, format });
  c.videos = c.videos.slice(-60);
  await saveClient(env, c, `Video started: ${script.title}`);
  try {
    await dispatchRender(env, v.id);
  } catch (e) {
    await setStatus(env, v, c, saveClient, "failed", e.message);
    throw e;
  }
  return v;
}

async function setStatus(env, v, c, saveClient, status, error) {
  v.status = status;
  if (error) v.error = String(error).slice(0, 300);
  (v.history ||= []).push({ at: Date.now(), status, error: error || undefined });
  await saveVideo(env, v);
  if (c) {
    const row = (c.videos || []).find((x) => x.id === v.id);
    if (row) {
      row.status = status;
      if (v.youtubeId) row.youtubeId = v.youtubeId;
    }
    await saveClient(env, c, `Video ${status}: ${v.script.title}`);
  }
}

// ---------------- The cron step ----------------

export async function runVideos(env, { listClients, saveClient }) {
  if (!env.GH_DISPATCH_TOKEN || env.VIDEOS_OFF === "true") return 0;
  let started = 0;
  const budget = parseInt(env.VIDEO_BUDGET || "1", 10);
  for (const c of await listClients(env)) {
    try {
      // Renders that never reported back.
      for (const row of (c.videos || []).filter((x) => x.status === "rendering" && Date.now() - x.at > STALE_MS)) {
        const v = await getVideo(env, row.id);
        if (!v) continue;
        await setStatus(env, v, c, saveClient, "failed", "The render never finished.");
        await sendEmail(env, { to: env.OWNER_EMAIL, subject: `Video failed: ${v.company.name}`, text: `The render for "${v.script.title}" never finished. Check GitHub > Actions for the error, then press Redo:\n${await reviewUrl(env, v.id)}` });
      }
      const per = VIDEOS_PER_MONTH[c.plan];
      if (!per || c.status !== "active" || !c.onboardedAt || !(c.audits || []).length || started >= budget) continue;
      if (!(await getChannel(env, channelOf(env, c)))) continue;
      if ((c.videos || []).some((x) => x.status === "rendering" || x.status === "review")) continue;
      let format = "long";
      if (Date.now() >= (c.nextVideoAt || 0)) c.nextVideoAt = Date.now() + Math.floor(MONTH / per);
      else if (env.SHORTS_OFF !== "true" && Date.now() >= (c.nextShortAt || 0)) { format = "short"; c.nextShortAt = Date.now() + Math.floor(MONTH / SHORTS_PER_MONTH[c.plan]); }
      else continue;
      started++;
      await makeVideo(env, c, saveClient, { format });
    } catch (e) {
      console.log("Video failed for", c.id, e.message);
      await sendEmail(env, { to: env.OWNER_EMAIL, subject: `Video not made: ${c.onboarding?.business || c.email}`, text: `${e.message}\n\nIt tries again at the next scheduled slot, or make one now from your admin page.` }).catch(() => {});
    }
  }
  return started;
}

// ---------------- Routes ----------------

export async function videoRoute(req, url, env, { getClient, saveClient }) {
  const p = url.pathname;
  let m;
  if (p === "/youtube/callback") return await youtubeCallback(url, env);
  if ((m = p.match(/^\/api\/video\/job\/(v[a-z0-9]{11})$/))) {
    checkSecret(req, env);
    const v = await getVideo(env, m[1]);
    if (!v) throw httpError(404, "No such video.");
    let token = null;
    try { token = await accessToken(env, v.channel); } catch (e) { console.log("Token failed", e.message); }
    return json({ id: v.id, script: v.script, company: v.company, pages: v.pages, channel: v.channel, youtube: token ? { accessToken: token } : null, voice: env.ELEVENLABS_VOICE_ID || null });
  }
  if (req.method === "POST" && p === "/api/video/done") {
    checkSecret(req, env);
    const b = await readJson(req);
    const v = await getVideo(env, String(b.id || ""));
    if (!v) throw httpError(404, "No such video.");
    await onRendered(env, v, b, { getClient, saveClient });
    return json({ ok: true });
  }
  if ((m = p.match(/^\/v\/(v[a-z0-9]{11})$/))) return await reviewPage(req, url, env, m[1], { getClient, saveClient });
  throw httpError(404, "Page not found.");
}

function checkSecret(req, env) {
  if (!env.VIDEO_SECRET || !safeEqual(req.headers.get("X-Video-Secret") || "", env.VIDEO_SECRET)) throw httpError(404, "Page not found.");
}

async function onRendered(env, v, b, { getClient, saveClient }) {
  const c = await getClient(env, v.clientId);
  v.runUrl = /^https:\/\/github\.com\//.test(b.runUrl || "") ? b.runUrl : v.runUrl;
  v.durationSec = Number(b.durationSec) || v.durationSec;
  if (b.error) {
    await setStatus(env, v, c, saveClient, "failed", b.error);
    await sendEmail(env, { to: env.OWNER_EMAIL, subject: `Video failed: ${v.company.name}`, text: `"${v.script.title}" couldn't be made:\n${b.error}\n\n${v.runUrl ? `Details: ${v.runUrl}\n` : ""}Redo or skip it here:\n${await reviewUrl(env, v.id)}` });
    return;
  }
  v.youtubeId = /^[\w-]{6,20}$/.test(b.youtubeId || "") ? b.youtubeId : null;
  v.uploadError = b.uploadError ? String(b.uploadError).slice(0, 300) : null;
  if (v.youtubeId && env.VIDEO_AUTO_PUBLISH === "true") {
    try {
      await publish(env, v);
      await goLive(env, v, c, saveClient);
      await sendEmail(env, { to: env.OWNER_EMAIL, subject: `Published: ${v.script.title}`, text: `Auto-published for ${v.company.name}: https://youtu.be/${v.youtubeId}\nRemove it any time: ${await reviewUrl(env, v.id)}` });
      return;
    } catch (e) {
      v.publishError = e.message;
    }
  }
  await setStatus(env, v, c, saveClient, "review");
  await sendEmail(env, {
    to: env.OWNER_EMAIL,
    subject: `Video ready to check: ${v.company.name}`,
    text: `A new video for ${v.company.name} is ready:\n"${v.script.title}"\n\n${v.youtubeId ? `Watch it (private, only you can see it while signed in to YouTube): https://youtu.be/${v.youtubeId}` : `Download it from: ${v.runUrl || "GitHub > Actions"}${v.uploadError ? `\n(YouTube upload didn't work: ${v.uploadError})` : ""}`}\n\nApprove, redo or skip:\n${await reviewUrl(env, v.id)}`,
  });
}

async function goLive(env, v, c, saveClient) {
  v.publishedAt = Date.now();
  await setStatus(env, v, c, saveClient, "live");
  if (!c) return;
  await sendEmail(env, {
    to: c.onboarding?.reportEmail || c.email,
    subject: `New video about ${v.company.name} is live on YouTube`,
    text: `Hi,

A new video about ${v.company.name} just went live:
https://youtu.be/${v.youtubeId}

It answers a question your buyers ask AI: "${v.script.question}"

Why videos: AI tools read YouTube titles, descriptions and transcripts, and YouTube mentions are among the signals most linked to being recommended by AI. Sharing it or adding it to your website helps too.

It's labeled as a paid promotion, as YouTube and the FTC require. If anything in it is wrong or you'd like it changed, reply and we'll fix or remove it the same day.

${sign}`,
  });
}

async function reviewPage(req, url, env, id, { getClient, saveClient }) {
  const form = req.method === "POST" ? await req.formData() : null;
  const key = form ? String(form.get("k") || "") : url.searchParams.get("k") || "";
  if (!safeEqual(key, await hmac(env, `video:${id}`))) throw httpError(404, "Page not found.");
  const v = await getVideo(env, id);
  if (!v) throw httpError(404, "That video is gone.");
  const c = await getClient(env, v.clientId);
  let flash = "";
  if (form) {
    const action = String(form.get("action") || "");
    try {
      if (action === "approve" && v.status === "review") {
        if (!v.youtubeId) throw new Error("It isn't on YouTube yet. Upload the file yourself, then paste the link below.");
        try {
          await publish(env, v);
        } catch (e) {
          throw new Error(`YouTube wouldn't make it public (${e.message}). Until YouTube approves your API project, uploads stay locked as private. For now: download the file from GitHub, upload it in YouTube Studio with the title and description below, and paste the new link here.`);
        }
        await goLive(env, v, c, saveClient);
        flash = "Published. The client got an email with the link.";
      } else if (action === "link") {
        const vid = String(form.get("link") || "").match(/(?:youtu\.be\/|v=|shorts\/|video\/)([\w-]{11})/)?.[1];
        if (!vid) throw new Error("Paste the YouTube link of the video.");
        if (v.youtubeId && v.youtubeId !== vid) await removeFromYouTube(env, v);
        v.youtubeId = vid;
        await goLive(env, v, c, saveClient);
        flash = "Saved. The client got an email with the link.";
      } else if (action === "redo") {
        if ((v.attempts || 1) >= MAX_ATTEMPTS) throw new Error(`Already tried ${MAX_ATTEMPTS} times. Skip this one; the next question gets its own video.`);
        await removeFromYouTube(env, v);
        if (!c) throw new Error("Client not found.");
        const note = String(form.get("note") || "").trim().slice(0, 300);
        await setStatus(env, v, c, saveClient, "redone");
        const nv = await makeVideo(env, c, saveClient, { note, question: v.script.question, format: v.script.format === "short" ? "short" : "long" });
        nv.attempts = (v.attempts || 1) + 1;
        await saveVideo(env, nv);
        return html(page({ title: "Redoing", body: `<main><h1>On it.</h1><p class="lede">A new version is rendering${note ? " with your note" : ""}. You'll get an email in about 10 minutes.</p></main>` }));
      } else if (action === "skip" || action === "remove") {
        await removeFromYouTube(env, v);
        await setStatus(env, v, c, saveClient, action === "skip" ? "skipped" : "removed");
        flash = action === "skip" ? "Skipped and deleted from YouTube. The next one comes at the next scheduled slot." : "Removed from YouTube.";
      }
    } catch (e) {
      flash = e.message;
    }
  }
  const s = v.script;
  const watch = v.youtubeId ? `<p><a href="https://youtu.be/${esc(v.youtubeId)}" target="_blank" rel="noopener">Watch on YouTube</a> · <a href="https://studio.youtube.com/video/${esc(v.youtubeId)}/edit" target="_blank" rel="noopener">Open in YouTube Studio</a></p>` : v.runUrl ? `<p><a href="${esc(v.runUrl)}" target="_blank" rel="noopener">Download the video from GitHub</a> (under "Artifacts")</p>` : "";
  const hidden = `<input type="hidden" name="k" value="${esc(key)}">`;
  const btn = (action, label, cls = "jelly sm") => `<form method="post" style="display:inline">${hidden}<input type="hidden" name="action" value="${action}"><button class="${cls}">${label}</button></form>`;
  const body = `<main>
<p class="muted small">${esc(v.company.name)} · ${esc(v.status)}</p>
<h1>${esc(s.title)}</h1>
${flash ? `<p class="card"><strong>${esc(flash)}</strong></p>` : ""}
<div class="card">${watch}
${v.status === "review" ? `<p>${btn("approve", "Approve and publish")} ${btn("skip", "Skip", "ghost sm")}</p>
<form method="post">${hidden}<input type="hidden" name="action" value="redo"><label>Redo with a note (optional)<textarea name="note" rows="2" placeholder="e.g. say less about pricing, show the features page more"></textarea></label><button class="ghost sm">Redo</button></form>` : ""}
${v.status === "review" || v.status === "failed" ? `<form method="post">${hidden}<input type="hidden" name="action" value="link"><label>Uploaded it yourself? Paste the YouTube link<input type="text" name="link" placeholder="https://youtu.be/..."></label><button class="ghost sm">Save link</button></form>` : ""}
${v.status === "failed" ? `<p>${btn("redo", "Try again")} ${btn("skip", "Skip", "ghost sm")}</p>` : ""}
${v.status === "live" ? `<p>${btn("remove", "Remove from YouTube", "ghost sm")}</p>` : ""}
</div>
<div class="card"><h2>Script</h2><p class="muted small">Buyer question: ${esc(s.question)}</p>${s.segments.map((x) => `<p><strong>${esc(x.chapter)}</strong><br>${esc(x.say)}</p>`).join("")}</div>
<div class="card"><h2>Description</h2><p style="white-space:pre-wrap">${esc(s.description)}</p></div>
</main><style>label{display:block;font-weight:600;font-size:14px;margin:14px 0 8px}textarea,label input{width:100%;margin-top:6px;border:1px solid #B9C3D1;border-radius:12px;padding:10px 12px;font:15px var(--sans)}</style>`;
  return html(page({ title: "Check video", body }), 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
}

// ---------------- Admin ----------------

export async function videoAdmin(req, url, env, form, token, { getClient, saveClient }) {
  if (url.pathname === "/admin/youtube/connect") return Response.redirect(await connectUrl(env, url.searchParams.get("channel") || "main"), 302);
  if (req.method === "POST" && url.pathname === "/admin/video") {
    const c = await getClient(env, String(form.get("clientId") || ""));
    let msg;
    try {
      if (!c) throw new Error("Client not found.");
      const v = await makeVideo(env, c, saveClient, { format: String(form.get("format") || "") === "short" ? "short" : "long" });
      msg = `Rendering "${v.script.title}". You'll get an email when it's ready.`;
    } catch (e) {
      msg = `Couldn't start it: ${e.message}`;
    }
    return Response.redirect(`${api(env)}/admin/audits?token=${encodeURIComponent(token)}&flash=${encodeURIComponent(msg)}`, 303);
  }
  throw httpError(404, "Page not found.");
}

// The "Videos" card on the AI admin page.
export async function videoCard(env, clients, token) {
  const ch = channelOf(env, null);
  const conn = await getChannel(env, ch);
  const t = encodeURIComponent(token);
  const ready = [
    ["YouTube channel", conn ? `Connected: ${esc(conn.title)}` : env.YT_CLIENT_ID ? `<a href="/admin/youtube/connect?token=${t}&channel=${esc(ch)}">Connect YouTube</a>` : "Add YT_CLIENT_ID and YT_CLIENT_SECRET"],
    ["Rendering (GitHub)", env.GH_DISPATCH_TOKEN ? "Ready" : "Add GH_DISPATCH_TOKEN"],
    ["Render callback", env.VIDEO_SECRET ? "Ready" : "Add VIDEO_SECRET"],
    ["Publishing", env.VIDEO_AUTO_PUBLISH === "true" ? "Automatic" : "You approve each video"],
  ];
  const rows = [];
  for (const c of clients) for (const x of c.videos || []) rows.push({ c, x });
  rows.sort((a, b) => b.x.at - a.x.at);
  const links = await Promise.all(rows.slice(0, 30).map((r) => reviewUrl(env, r.x.id)));
  const eligible = clients.filter((c) => VIDEOS_PER_MONTH[c.plan] && c.status === "active" && c.onboardedAt);
  return `<div class="card"><h2>Videos</h2>
<table>${ready.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table>
${eligible.length ? `<form method="post" action="/admin/video" style="margin-top:14px"><input type="hidden" name="token" value="${esc(token)}"><select name="clientId">${eligible.map((c) => `<option value="${c.id}">${esc(c.onboarding?.business || c.email)}</option>`).join("")}</select> <button class="jelly sm">Make a video now</button> <button class="ghost sm" name="format" value="short">Make a Short now</button></form>` : ""}
${rows.length ? `<table style="margin-top:14px"><tr><th>Video</th><th>Client</th><th>Status</th><th>When</th></tr>${rows.slice(0, 30).map((r, i) => `<tr><td><a href="${esc(links[i])}">${esc(r.x.title || r.x.q)}</a></td><td>${esc(r.c.onboarding?.business || r.c.email)}</td><td>${esc(r.x.status)}${r.x.youtubeId ? ` · <a href="https://youtu.be/${esc(r.x.youtubeId)}" target="_blank" rel="noopener">YouTube</a>` : ""}</td><td class="small">${new Date(r.x.at).toLocaleDateString("en-US", { timeZone: "America/New_York" })}</td></tr>`).join("")}</table>` : '<p class="muted">No videos yet. Growth clients get 2 a month and Pro clients 4, once their starting report is done.</p>'}
</div>`;
}
