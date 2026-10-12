// Customer accounts on api.vantryai.com:
//   GET/POST /login            email + password
//   GET/POST /forgot           emails a reset link (only if they forgot their password)
//   GET/POST /reset?t=         pick a new password
//   POST     /logout
//   GET      /account          their sites
//   GET/POST /account/site/:id edit a site (saves go live right away)
//   GET      /account/site/:id/view   see the site as it is now
//   POST     /account/site/:id/undo   go back to the version before the last save
import { html, httpError, clientIp, rateLimit } from "./lib/util.js";
import { getSite, putSite, getOrder, saveOrder, getJson, putJson, listOrders } from "./lib/store.js";
import { currentAccount, getAccount, putAccount, checkPassword, hashPassword, startSession, endSession, makeResetToken, readResetToken, useResetToken, normEmail, MIN_PASSWORD } from "./lib/auth.js";
import { PALETTES } from "./render.js";
import { renderSite } from "./render.js";
import { send } from "./lib/email.js";
import { loginPage, forgotPage, resetPage, accountPage, editorPage } from "./pages/account.js";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const page = (body, status = 200, extra = {}) => html(body, status, { ...NO_STORE, ...extra });
const redirect = (to, cookie) => new Response(null, { status: 303, headers: { Location: to, ...NO_STORE, ...(cookie ? { "Set-Cookie": cookie } : {}) } });

export const isAccountPath = (p) => p === "/login" || p === "/logout" || p === "/forgot" || p === "/reset" || p === "/account" || p.startsWith("/account/");

export async function accountRoute(req, url, env) {
  const p = url.pathname;
  if (req.method === "POST") checkOrigin(req, env);

  if (p === "/login") return req.method === "POST" ? doLogin(req, env) : (await currentAccount(env, req)) ? redirect("/account") : page(loginPage());
  if (p === "/logout" && req.method === "POST") return redirect("/login", await endSession(env, req));
  if (p === "/forgot") return req.method === "POST" ? doForgot(req, env) : page(forgotPage());
  if (p === "/reset") return req.method === "POST" ? doReset(req, env) : showReset(url, env);

  const acct = await currentAccount(env, req);
  if (!acct) return req.method === "GET" ? redirect("/login") : page(loginPage({ error: "Please log in again." }), 401);

  if (p === "/account" && req.method === "GET") return showAccount(env, acct);
  let m;
  if ((m = p.match(/^\/account\/site\/(o[a-z0-9]{12})(\/view|\/undo)?$/))) {
    const site = await ownedSite(env, acct, m[1]);
    if (m[2] === "/view" && req.method === "GET") return page(renderSite(siteView(site)));
    if (m[2] === "/undo" && req.method === "POST") return undo(env, site);
    if (!m[2] && req.method === "GET") return showEditor(env, site, url.searchParams.get("saved") ? "Saved. Your site is updated." : "");
    if (!m[2] && req.method === "POST") return saveEdits(req, env, site);
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

async function showAccount(env, acct) {
  const sites = (await Promise.all(acct.siteIds.map((id) => getSite(env, id)))).filter(Boolean);
  const orders = Object.fromEntries((await Promise.all(sites.map((s) => getOrder(env, s.id)))).filter(Boolean).map((o) => [o.id, o]));
  return page(accountPage({ email: acct.email, sites, orders }));
}

async function showEditor(env, site, ok = "", error = "") {
  const canUndo = !!(await env.PREVIEWS.get(`rev:${site.id}`));
  return page(editorPage({ site, ok, error, canUndo }), error ? 400 : 200);
}

const siteView = (site) => ({ copy: site.copy, input: site.input, style: site.style, palette: site.palette, domain: site.domain });

async function saveEdits(req, env, site) {
  if (!(await rateLimit(env, "edit-site", site.id, 60, 3600))) return showEditor(env, site, "", "That's a lot of saves. Please wait a few minutes.");
  const f = await req.formData();
  const s = (k, n) => String(f.get(k) || "").trim().slice(0, n);
  const c = site.copy || {};

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
  const next = {
    businessName: s("businessName", 80),
    phone: s("phone", 30),
    city: s("city", 80),
    leadEmail: normEmail(f.get("leadEmail")),
    headline: s("headline", 90),
    subheadline: s("subheadline", 220),
    ctaText: s("ctaText", 30) || "Get a free quote",
    about: s("about", 700),
    serviceAreas: String(f.get("serviceAreas") || "").split(/\n|,/).map((a) => a.trim().slice(0, 60)).filter(Boolean).slice(0, 12),
  };
  const err = !next.businessName ? "Your business name can't be empty."
    : !next.headline ? "Your headline can't be empty."
    : !services.length ? "Keep at least one service."
    : next.leadEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.leadEmail) ? "The quote email doesn't look right."
    : "";
  if (err) return showEditor(env, site, "", err);

  // Keep the old version so "Undo" can bring it back.
  await putJson(env, `rev:${site.id}`, { copy: site.copy, input: site.input, style: site.style, palette: site.palette, leadEmail: site.leadEmail, businessName: site.businessName, city: site.city }, { expirationTtl: 60 * 60 * 24 * 30 });

  site.copy = { ...c, headline: next.headline, subheadline: next.subheadline, ctaText: next.ctaText, about: next.about, services, faqs, serviceAreas: next.serviceAreas };
  site.input = { ...site.input, businessName: next.businessName, phone: next.phone, city: next.city };
  site.businessName = next.businessName;
  site.city = next.city;
  site.leadEmail = next.leadEmail || site.ownerEmail;
  const style = String(f.get("style") || "");
  if (["modern", "editorial", "minimal"].includes(style)) site.style = style;
  const pal = String(f.get("palette") || "");
  if (PALETTES[pal]) site.palette = pal;
  site.editedAt = Date.now();
  await putSite(env, site);

  const order = await getOrder(env, site.id);
  if (order) await saveOrder(env, order, "Customer edited their site");
  return redirect(`/account/site/${site.id}?saved=1`);
}

async function undo(env, site) {
  const prev = await getJson(env, `rev:${site.id}`);
  if (!prev) return showEditor(env, site, "", "There's nothing to undo.");
  Object.assign(site, prev, { editedAt: Date.now() });
  await putSite(env, site);
  await env.PREVIEWS.delete(`rev:${site.id}`);
  return showEditor(env, site, "Done. Your site is back to how it was before your last save.");
}
