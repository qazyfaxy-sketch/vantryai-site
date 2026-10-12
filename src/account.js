// Customer accounts on api.vantryai.com:
//   GET/POST /login            email + password
//   GET/POST /forgot           emails a reset link (only if they forgot their password)
//   GET/POST /reset?t=         pick a new password
//   POST     /logout
//   GET      /account                    their sites, with stats
//   GET/POST /account/site/:id           the editor (saves go live right away)
//   POST     /account/site/:id/preview   live preview of unsaved changes
//   POST     /account/site/:id/photo     upload a photo or logo
//   POST     /account/site/:id/ai        "tell AI what to change" (fills the form, doesn't save)
//   POST     /account/site/:id/undo      back to the version before the last save
//   GET      /account/site/:id/view      the site as it is now
//   GET      /img/:siteId/:photoId       uploaded photos
import { html, json, httpError, clientIp, rateLimit, randomId } from "./lib/util.js";
import { getSite, putSite, getOrder, saveOrder, getJson, putJson, listOrders } from "./lib/store.js";
import { currentAccount, getAccount, putAccount, checkPassword, hashPassword, startSession, endSession, makeResetToken, readResetToken, useResetToken, normEmail, MIN_PASSWORD } from "./lib/auth.js";
import { PALETTES, renderSite, sectionList } from "./render.js";
import { getStats } from "./lib/stats.js";
import { send } from "./lib/email.js";
import { loginPage, forgotPage, resetPage, accountPage, editorPage } from "./pages/account.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const page = (body, status = 200, extra = {}) => html(body, status, { ...NO_STORE, ...extra });
const redirect = (to, cookie) => new Response(null, { status: 303, headers: { Location: to, ...NO_STORE, ...(cookie ? { "Set-Cookie": cookie } : {}) } });

export const MAX_PHOTOS = 12;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MODEL = "claude-haiku-5-5";

export const isAccountPath = (p) => p === "/login" || p === "/logout" || p === "/forgot" || p === "/reset" || p === "/account" || p.startsWith("/account/");

// What the site renderer needs to show photos, the logo and the owner's section order.
export const siteMedia = (site, env) => ({
  siteId: site.id,
  photos: site.photos || [],
  logo: site.logo || null,
  heroPhoto: site.heroPhoto || null,
  sections: site.sections || null,
  imgBase: env.PUBLIC_API || "https://api.vantryai.com",
});

export async function serveImage(env, siteId, photoId) {
  const { value, metadata } = await env.PREVIEWS.getWithMetadata(`img:${siteId}:${photoId}`, "arrayBuffer");
  if (!value) throw httpError(404, "Image not found.");
  return new Response(value, { headers: { "Content-Type": metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
}

export async function accountRoute(req, url, env) {
  const p = url.pathname;
  if (req.method === "POST") checkOrigin(req, env);

  if (p === "/login") return req.method === "POST" ? doLogin(req, env) : (await currentAccount(env, req)) ? redirect("/account") : page(loginPage());
  if (p === "/logout" && req.method === "POST") return redirect("/login", await endSession(env, req));
  if (p === "/forgot") return req.method === "POST" ? doForgot(req, env) : page(forgotPage());
  if (p === "/reset") return req.method === "POST" ? doReset(req, env) : showReset(url, env);

  const acct = await currentAccount(env, req);
  if (!acct) {
    if (req.method === "GET") return redirect("/login");
    if (/\/(preview|photo|ai)$/.test(p)) return json({ error: "Please log in again." }, 401);
    return page(loginPage({ error: "Please log in again." }), 401);
  }

  if (p === "/account" && req.method === "GET") return showAccount(env, acct);
  let m;
  if ((m = p.match(/^\/account\/site\/(o[a-z0-9]{12})(\/view|\/undo|\/preview|\/photo|\/ai)?$/))) {
    const site = await ownedSite(env, acct, m[1]);
    const action = m[2] || "";
    if (action === "/view" && req.method === "GET") return page(renderSite({ ...siteView(site), media: siteMedia(site, env) }));
    if (req.method === "POST") {
      if (action === "/undo") return undo(env, site);
      if (action === "/preview") return previewDraft(req, env, site);
      if (action === "/photo") return uploadPhoto(req, url, env, site);
      if (action === "/ai") return aiEdit(req, env, site);
      if (!action) return saveEdits(req, env, site);
    }
    if (!action && req.method === "GET") return showEditor(env, site, url.searchParams.get("saved") ? "Saved. Your site is updated." : "");
  }
  throw httpError(404, "Page not found.");
}

// Forms must come from our own pages.
function checkOrigin(req, env) {
  const origin = req.headers.get("Origin");
  if (!origin || origin === "null") return;
  const ok = [env.PUBLIC_API || "https://api.vantryai.com", env.SITE_ORIGIN || "https://vantryai.com"].map((u) => new URL(u).origin);
  if (!ok.includes(origin)) throw httpError(403, "Please use the form on our site.");
}

// ---------------- Logging in ----------------

async function doLogin(req, env) {
  const f = await req.formData();
  const email = normEmail(f.get("email"));
  const password = String(f.get("password") || "");
  if (!(await rateLimit(env, "login-ip", clientIp(req), 20, 900)) || !(await rateLimit(env, "login-email", email, 10, 3600))) {
    return page(loginPage({ error: "Too many tries. Please wait 15 minutes, or reset your password.", email }), 429);
  }
  const acct = email && (await getAccount(env, email));
  if (!acct || !(await checkPassword(password, acct))) {
    return page(loginPage({ error: "That email and password don't match. Try again or reset your password.", email }), 401);
  }
  return redirect("/account", await startSession(env, email));
}

async function doForgot(req, env) {
  const f = await req.formData();
  const email = normEmail(f.get("email"));
  const done = page(forgotPage({ ok: "If that email has a Vantry site, a reset link is on its way. Check your inbox and spam folder.", email }));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return page(forgotPage({ error: "Please enter a valid email.", email }), 400);
  if (!(await rateLimit(env, "forgot-ip", clientIp(req), 5, 3600)) || !(await rateLimit(env, "forgot-email", email, 3, 3600))) return done;
  // Works for older sites too, made before accounts existed.
  const has = (await getAccount(env, email)) || (await sitesForEmail(env, email)).length;
  if (has) {
    const token = await makeResetToken(env, email);
    await send(env, "resetLink", { email, link: `${env.PUBLIC_API || "https://api.vantryai.com"}/reset?t=${token}` });
  }
  return done;
}

async function showReset(url, env) {
  const t = url.searchParams.get("t") || "";
  if (!(await readResetToken(env, t))) return page(forgotPage({ error: "That link has expired or was already used. Send yourself a new one." }), 400);
  return page(resetPage({ token: t }));
}

async function doReset(req, env) {
  const f = await req.formData();
  const t = String(f.get("t") || "");
  const r = await readResetToken(env, t);
  if (!r) return page(forgotPage({ error: "That link has expired or was already used. Send yourself a new one." }), 400);
  const password = String(f.get("password") || "");
  if (password.length < MIN_PASSWORD) return page(resetPage({ token: t, error: `Use at least ${MIN_PASSWORD} characters.` }), 400);
  const pw = await hashPassword(password);
  let acct = await getAccount(env, r.email);
  if (!acct) acct = { email: r.email, siteIds: [], createdAt: Date.now() };
  for (const id of await sitesForEmail(env, r.email)) if (!acct.siteIds.includes(id)) acct.siteIds.push(id);
  Object.assign(acct, pw);
  await putAccount(env, acct);
  await useResetToken(env, t);
  return redirect("/account", await startSession(env, r.email));
}

// Paid orders whose survey or billing email matches.
async function sitesForEmail(env, email) {
  const orders = await listOrders(env);
  return orders.filter((o) => o.status !== "checkout" && (normEmail(o.email) === email || normEmail(o.billingEmail) === email)).map((o) => o.id);
}

async function ownedSite(env, acct, id) {
  if (!acct.siteIds.includes(id)) throw httpError(404, "Page not found.");
  const site = await getSite(env, id);
  if (!site) throw httpError(404, "We're still setting up this site. Try again in a minute.");
  return site;
}

// ---------------- Account home with stats ----------------

async function showAccount(env, acct) {
  const sites = (await Promise.all(acct.siteIds.map((id) => getSite(env, id)))).filter(Boolean);
  const orders = Object.fromEntries((await Promise.all(sites.map((s) => getOrder(env, s.id)))).filter(Boolean).map((o) => [o.id, o]));
  const stats = Object.fromEntries(await Promise.all(sites.map(async (s) => [s.id, await getStats(env, s.id, 30)])));
  return page(accountPage({ email: acct.email, sites, orders, stats }));
}

// ---------------- The editor ----------------

async function showEditor(env, site, ok = "", error = "") {
  const canUndo = !!(await env.PREVIEWS.get(`rev:${site.id}`));
  return page(editorPage({ site, ok, error, canUndo, media: siteMedia(site, env) }), error ? 400 : 200);
}

const siteView = (site) => ({ copy: site.copy, input: site.input, style: site.style, palette: site.palette, domain: site.domain });
const lines = (v, max, len) => String(v || "").split(/\n/).map((a) => a.trim().slice(0, len)).filter(Boolean).slice(0, max);
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

// Turns the editor form into an updated copy of the site. Doesn't save anything.
async function draftFromForm(f, site, env) {
  const s = (k, n) => String(f.get(k) || "").trim().slice(0, n);
  const services = [];
  for (let n = 0; n < 8; n++) {
    const name = s(`sname${n}`, 60);
    if (name) services.push({ name, description: s(`sdesc${n}`, 200) });
  }
  const faqs = [];
  for (let n = 0; n < 5; n++) {
    const q = s(`fq${n}`, 140), a = s(`fa${n}`, 400);
    if (q && a) faqs.push({ q, a });
  }
  const businessName = s("businessName", 80);
  const leadEmail = normEmail(f.get("leadEmail"));
  const headline = s("headline", 90);
  const error = !businessName ? "Your business name can't be empty."
    : !headline ? "Your headline can't be empty."
    : !services.length ? "Keep at least one service."
    : leadEmail && !validEmail(leadEmail) ? "The quote email doesn't look right."
    : "";

  // Photos must be ones this site uploaded.
  const ids = String(f.get("photos") || "").split(",").filter((x) => /^[a-z0-9]{16}$/.test(x));
  const owned = new Set(site.uploads || []);
  const photos = [...new Set(ids)].filter((x) => owned.has(x)).slice(0, MAX_PHOTOS);
  const logo = owned.has(s("logo", 16)) ? s("logo", 16) : null;
  const heroPhoto = photos.includes(s("heroPhoto", 16)) ? s("heroPhoto", 16) : null;
  let sections = null;
  try { sections = sectionList(JSON.parse(String(f.get("sections") || "null"))); } catch {}

  const style = String(f.get("style") || "");
  const pal = String(f.get("palette") || "");
  const draft = {
    ...site,
    businessName,
    city: s("city", 80),
    leadEmail: leadEmail || site.ownerEmail,
    input: { ...site.input, businessName, phone: s("phone", 30), city: s("city", 80) },
    copy: {
      ...(site.copy || {}),
      headline,
      subheadline: s("subheadline", 220),
      ctaText: s("ctaText", 30) || "Get a free quote",
      about: s("about", 700),
      services,
      faqs,
      serviceAreas: lines(f.get("serviceAreas"), 12, 60),
      hours: lines(f.get("hours"), 8, 60),
    },
    photos,
    logo,
    heroPhoto,
    sections: sections || site.sections || null,
    style: ["modern", "editorial", "minimal"].includes(style) ? style : site.style,
    palette: PALETTES[pal] ? pal : null, // empty = recommended look for their business
  };
  return { draft, error };
}

async function previewDraft(req, env, site) {
  const { draft } = await draftFromForm(await req.formData(), site, env);
  return page(renderSite({ ...siteView(draft), media: siteMedia(draft, env) }));
}

async function saveEdits(req, env, site) {
  if (!(await rateLimit(env, "edit-site", site.id, 60, 3600))) return showEditor(env, site, "", "That's a lot of saves. Please wait a few minutes.");
  const { draft, error } = await draftFromForm(await req.formData(), site, env);
  if (error) return showEditor(env, site, "", error);

  // Keep the old version so "Undo" can bring it back.
  const keep = ({ copy, input, style, palette, leadEmail, businessName, city, photos, logo, heroPhoto, sections }) => ({ copy, input, style, palette, leadEmail, businessName, city, photos, logo, heroPhoto, sections });
  await putJson(env, `rev:${site.id}`, keep(site), { expirationTtl: 60 * 60 * 24 * 30 });
  await putSite(env, { ...site, ...keep(draft), editedAt: Date.now() });

  const order = await getOrder(env, site.id);
  if (order) await saveOrder(env, order, "Customer edited their site");
  return redirect(`/account/site/${site.id}?saved=1`);
}

async function undo(env, site) {
  const prev = await getJson(env, `rev:${site.id}`);
  if (!prev) return showEditor(env, site, "", "There's nothing to undo.");
  const restored = { ...site, ...prev, editedAt: Date.now() };
  await putSite(env, restored);
  await env.PREVIEWS.delete(`rev:${site.id}`);
  return showEditor(env, restored, "Done. Your site is back to how it was before your last save.");
}

// Photos are shrunk in the browser first, so they're small. Stored in KV next to the site.
async function uploadPhoto(req, url, env, site) {
  const type = (req.headers.get("Content-Type") || "").split(";")[0];
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return json({ error: "Use a JPG, PNG or WebP photo." }, 400);
  if ((site.uploads || []).length >= 60) return json({ error: "You've uploaded a lot of photos. Email booking@vantryai.com and we'll help." }, 400);
  if (!(await rateLimit(env, "upload", site.id, 40, 86400))) return json({ error: "That's a lot of uploads today. Please try again tomorrow." }, 429);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX_IMAGE_BYTES) return json({ error: "That photo is too big. Try a smaller one." }, 400);
  const b = new Uint8Array(buf.slice(0, 12));
  const real = (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50);
  if (!real) return json({ error: "That file isn't a photo we can use." }, 400);
  const id = randomId(16);
  await env.PREVIEWS.put(`img:${site.id}:${id}`, buf, { metadata: { type } });
  // Remember it belongs to this site, without touching anything else the owner hasn't saved.
  const fresh = (await getSite(env, site.id)) || site;
  fresh.uploads = [...(fresh.uploads || []), id];
  await putSite(env, fresh);
  return json({ id, url: `${env.PUBLIC_API || "https://api.vantryai.com"}/img/${site.id}/${id}` });
}

// "Tell AI what to change": rewrites the words from the current form. The owner reviews, then saves.
async function aiEdit(req, env, site) {
  const f = await req.formData();
  const instruction = String(f.get("instruction") || "").trim().slice(0, 600);
  if (!instruction) return json({ error: "Type what you'd like to change." }, 400);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "AI changes aren't turned on yet." }, 503);
  if (!(await rateLimit(env, "ai-edit", site.id, 20, 86400))) return json({ error: "You've used today's AI changes. You can still edit everything by hand." }, 429);
  const { draft } = await draftFromForm(f, site, env);
  const c = draft.copy;
  const current = { businessName: draft.businessName, headline: c.headline, subheadline: c.subheadline, ctaText: c.ctaText, about: c.about, services: c.services, serviceAreas: c.serviceAreas, hours: c.hours, faqs: c.faqs };
  const system = `You edit the words on a small local business's one-page website. Type of business: ${site.input?.trade || "local service"}.
Apply the owner's requested change. Keep everything they didn't ask to change exactly the same.
Rules: plain, friendly English. Never invent licenses, insurance, awards, years in business, reviews, ratings, prices or guarantees.
You may use any fact the owner states in their request.
Limits: headline max 9 words, subheadline max 25 words, ctaText max 4 words, up to 8 services (description max 20 words), up to 5 faqs, up to 8 hours lines.
Return ONLY a JSON object with exactly these keys: businessName, headline, subheadline, ctaText, about, services [{name, description}], serviceAreas [string], hours [string], faqs [{q, a}].`;
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: env.AI_MODEL || MODEL,
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: `The website now:\n${JSON.stringify(current)}\n\nThe owner's request:\n${instruction}` }],
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    return json({ error: "The AI took too long. Please try again." }, 502);
  }
  if (!res.ok) return json({ error: "The AI is busy. Please try again in a minute." }, 502);
  const text = ((await res.json()).content || []).map((x) => x.text || "").join("");
  try {
    const o = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const t = (v, n) => String(v ?? "").trim().slice(0, n);
    const arr = (v) => (Array.isArray(v) ? v : []);
    return json({
      copy: {
        businessName: t(o.businessName, 80) || draft.businessName,
        headline: t(o.headline, 90) || c.headline,
        subheadline: t(o.subheadline, 220),
        ctaText: t(o.ctaText, 30) || c.ctaText,
        about: t(o.about, 700),
        services: arr(o.services).slice(0, 8).map((x) => ({ name: t(x?.name, 60), description: t(x?.description, 200) })).filter((x) => x.name),
        serviceAreas: arr(o.serviceAreas).slice(0, 12).map((x) => t(x, 60)).filter(Boolean),
        hours: arr(o.hours).slice(0, 8).map((x) => t(x, 60)).filter(Boolean),
        faqs: arr(o.faqs).slice(0, 5).map((x) => ({ q: t(x?.q, 140), a: t(x?.a, 400) })).filter((x) => x.q && x.a),
      },
    });
  } catch {
    return json({ error: "The AI's answer didn't come through right. Please try again." }, 502);
  }
}
