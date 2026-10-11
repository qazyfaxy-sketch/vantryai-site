// Cloudflare Worker: the whole Vantry back end in one place.
//
// On api.vantryai.com:
//   POST /api/preview          survey answers -> 1 AI call -> 3 style previews
//   GET  /p/:id?style=         a preview with a "Make it live – $200" bar
//   GET  /go/:id?style=        pick a style, web address and plan
//   GET  /api/domains/check    live domain availability (Cloudflare Registrar)
//   POST /api/checkout         creates a Stripe checkout page
//   POST /api/stripe/webhook   Stripe tells us about payments and cancellations
//   GET  /thanks/:orderId      after payment
//   POST /api/lead             quote requests from customers' sites
//   GET  /admin?token=         your orders dashboard (approve, retry, take offline)
//
// On any customer domain: serves that customer's website.
// Every 10 minutes (cron): checks on domains still registering or waiting for DNS.
//
// Settings are listed in wrangler.toml and README.md.
import { buildSystemPrompt, buildUserPrompt } from "./prompt.js";
import { renderSite } from "./render.js";
import { json, html, httpError, randomId, readJson, clientIp, rateLimit, safeEqual } from "./lib/util.js";
import { getPreview, putPreview, getOrder, saveOrder, getSite, getHostSiteId, normalizeHost, addLead, listOrders, listPending } from "./lib/store.js";
import { cleanDomain, isValidDomain, searchToDomain, suggestDomains, SELL_TLDS, tldOf } from "./lib/domains.js";
import { checkDomains } from "./lib/cloudflare.js";
import { createCheckout, verifyWebhook } from "./lib/stripe.js";
import { send } from "./lib/email.js";
import { onCheckoutCompleted, onSubscriptionEnded, approve, retry, takeOffline, putBackOnline, runPending } from "./fulfill.js";
import { goPage } from "./pages/go.js";
import { thanksPage } from "./pages/thanks.js";
import { adminPage } from "./pages/admin.js";
import { placeholder } from "./pages/shell.js";

const MAX_PREVIEWS_PER_EMAIL = 2;
const MAX_PREVIEWS_PER_IP_HOUR = 6;
const DEFAULT_DAILY_PREVIEW_CAP = 300; // hard ceiling on AI spend per day
const MODEL = "claude-haiku-5-5"; // fast and cheap; change if needed
const STYLES = ["modern", "editorial", "minimal"];

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const apiHost = (env.API_HOST || "api.vantryai.com").toLowerCase();
    const host = url.hostname.toLowerCase();
    const isApi = host === apiHost || host.endsWith(".workers.dev") || host === "localhost" || host === "127.0.0.1";
    // vantryai.com and its other subdomains are your own sites: let them through untouched.
    const ownHost = new URL(env.SITE_ORIGIN || "https://vantryai.com").hostname;
    const saasHost = (env.SAAS_CNAME_TARGET || "sites.vantryai.com").toLowerCase();
    if (!isApi && host !== saasHost && (host === ownHost || host.endsWith(`.${ownHost}`))) return fetch(req);
    try {
      if (!isApi) return await serveHostedSite(host, url, env);
      return await route(req, url, env, ctx);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.log("Error", err.stack || err.message);
      const message = status === 500 ? "Something went wrong. Please try again." : err.message;
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) return html(placeholder({ title: "Sorry", message }), status);
      return json({ error: message }, status, corsFor(url.pathname, env));
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPending(env, listPending));
  },
};

function corsFor(path, env) {
  // Quote forms live on customers' own domains, so that one endpoint accepts any origin.
  const origin = path === "/api/lead" ? "*" : env.ALLOWED_ORIGIN || "https://vantryai.com";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function route(req, url, env, ctx) {
  const p = url.pathname;
  const cors = corsFor(p, env);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  if (req.method === "POST" && p === "/api/preview") return json(await createPreview(req, env, publicBase(env, url)), 200, cors);
  if (req.method === "POST" && p === "/api/lead") return json(await receiveLead(req, env), 200, cors);
  if (req.method === "GET" && p === "/api/domains/check") return json(await domainCheck(req, url, env));
  if (req.method === "POST" && p === "/api/checkout") return json(await startCheckout(req, env, publicBase(env, url)));
  if (req.method === "POST" && p === "/api/stripe/webhook") return await stripeWebhook(req, env, ctx);

  let m;
  if (req.method === "GET" && (m = p.match(/^\/p\/([a-z0-9]{10})$/))) return await showPreview(m[1], url, env);
  if (req.method === "GET" && (m = p.match(/^\/go\/([a-z0-9]{10})$/))) return await showGo(m[1], url, env);
  if (req.method === "GET" && (m = p.match(/^\/thanks\/(o[a-z0-9]{12})$/))) return await showThanks(m[1], env);
  if (p === "/admin" || p.startsWith("/admin/")) return await admin(req, url, env);
  if (p === "/" || p === "") return Response.redirect(env.SITE_ORIGIN || "https://vantryai.com", 302);
  throw httpError(404, "Page not found.");
}

const publicBase = (env, url) => env.PUBLIC_API || url.origin;

// ---------------- Previews (the AI part) ----------------

async function createPreview(req, env, base) {
  const body = await readJson(req);
  if (body.company) throw httpError(400, "Please try again."); // bots fill hidden fields
  const input = clean(body);
  const ip = clientIp(req);

  if (env.TURNSTILE_SECRET) await verifyTurnstile(env, body.turnstileToken, ip);
  if (!(await rateLimit(env, "preview-ip", ip, MAX_PREVIEWS_PER_IP_HOUR, 3600))) {
    throw httpError(429, "Too many previews from this connection. Please try again in an hour.");
  }
  const countKey = `count:${input.email}`;
  const used = parseInt((await env.PREVIEWS.get(countKey)) || "0", 10);
  if (used >= MAX_PREVIEWS_PER_EMAIL) {
    throw httpError(429, "You've used your free previews. Email booking@vantryai.com and we'll help you directly.");
  }
  const cap = parseInt(env.DAILY_PREVIEW_CAP || DEFAULT_DAILY_PREVIEW_CAP, 10);
  if (!(await rateLimit(env, "preview-day", "all", cap, 86400))) {
    throw httpError(503, "We're very busy right now. Please try again tomorrow, or email booking@vantryai.com.");
  }

  const copy = await writeCopy(input, env);
  const id = randomId();
  await putPreview(env, id, { input, copy, createdAt: Date.now() });
  await env.PREVIEWS.put(countKey, String(used + 1), { expirationTtl: 60 * 60 * 24 * 30 });

  const link = (s) => `${base}/p/${id}?style=${s}`;
  return { id, previews: { modern: link("modern"), editorial: link("editorial"), minimal: link("minimal") } };
}

async function verifyTurnstile(env, token, ip) {
  if (!token) throw httpError(400, "Please complete the quick check and try again.");
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const d = await res.json();
  if (!d.success) throw httpError(400, "The quick check didn't pass. Please refresh and try again.");
}

async function writeCopy(input, env) {
  const request = () =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: env.AI_MODEL || MODEL,
        max_tokens: 1500,
        system: buildSystemPrompt(input.trade),
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      }),
      signal: AbortSignal.timeout(45000),
    });

  // One retry for busy/temporary errors, and one retry if the AI's answer isn't usable.
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await request();
    } catch (e) {
      if (attempt === 2) throw new Error(`AI request failed: ${e.message}`);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 2) throw new Error(`AI busy: ${res.status}`);
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) throw new Error(`AI request failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text || "").join("");
    try {
      return parseCopy(text);
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}

// Exported for tests. Checks the AI's JSON and trims anything too long.
export function parseCopy(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("AI did not return JSON");
  const c = JSON.parse(text.slice(start, end + 1));
  for (const k of ["headline", "subheadline", "services", "about"]) {
    if (!c[k]) throw new Error(`AI response missing ${k}`);
  }
  const s = (v, n) => String(v || "").trim().slice(0, n);
  return {
    headline: s(c.headline, 90),
    subheadline: s(c.subheadline, 220),
    ctaText: s(c.ctaText, 30) || "Get a free quote",
    services: (Array.isArray(c.services) ? c.services : []).slice(0, 8).map((x) => ({ name: s(x.name, 60), description: s(x.description, 200) })).filter((x) => x.name),
    about: s(c.about, 700),
    serviceAreas: (Array.isArray(c.serviceAreas) ? c.serviceAreas : []).slice(0, 12).map((a) => s(a, 60)).filter(Boolean),
    faqs: (Array.isArray(c.faqs) ? c.faqs : []).slice(0, 5).map((f) => ({ q: s(f.q, 140), a: s(f.a, 400) })).filter((f) => f.q && f.a),
    seoTitle: s(c.seoTitle, 70),
    seoDescription: s(c.seoDescription, 170),
  };
}

export function clean(body) {
  const str = (v, max) => String(v || "").trim().slice(0, max);
  const input = {
    businessName: str(body.businessName, 80),
    city: str(body.city, 80),
    serviceAreas: str(body.serviceAreas, 200),
    services: str(body.services, 500),
    phone: str(body.phone, 30),
    email: str(body.email, 120).toLowerCase(),
    notes: str(body.notes, 500),
    trade: str(body.trade, 30) || "landscaping",
  };
  const names = { businessName: "your business name", city: "your city", services: "your services", email: "your email" };
  for (const k of Object.keys(names)) {
    if (!input[k]) throw httpError(400, `Please fill in ${names[k]}.`);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw httpError(400, "Please enter a valid email.");
  return input;
}

const pickStyle = (v) => (STYLES.includes(v) ? v : "modern");

async function showPreview(id, url, env) {
  const preview = await getPreview(env, id);
  if (!preview) return html(placeholder({ title: "This preview has expired", message: "Previews last 30 days. Make a new one free at vantryai.com." }), 404);
  const style = pickStyle(url.searchParams.get("style"));
  const buyUrl = `/go/${id}?style=${style}`;
  return html(renderSite({ copy: preview.copy, input: preview.input, style, previewBar: { buyUrl } }), 200, { "X-Robots-Tag": "noindex" });
}

// ---------------- Picking a domain ----------------

async function showGo(id, url, env) {
  const preview = await getPreview(env, id);
  if (!preview) return html(placeholder({ title: "This preview has expired", message: "Previews last 30 days. Make a new one free at vantryai.com." }), 404);
  return html(
    goPage({
      previewId: id,
      style: pickStyle(url.searchParams.get("style")),
      businessName: preview.input.businessName,
      suggestions: suggestDomains(preview.input.businessName, preview.input.city),
    }),
    200,
    { "X-Robots-Tag": "noindex" }
  );
}

async function domainCheck(req, url, env) {
  const id = url.searchParams.get("id") || "";
  if (!/^[a-z0-9]{10}$/.test(id) || !(await getPreview(env, id))) throw httpError(400, "This preview has expired. Please make a new one.");
  if (!(await rateLimit(env, "domains", clientIp(req), 60, 3600))) throw httpError(429, "Too many searches. Please wait a few minutes.");

  let names = [];
  const q = url.searchParams.get("q");
  if (q) {
    const d = searchToDomain(q);
    if (!isValidDomain(d)) throw httpError(400, "Use letters, numbers and dashes only, like greenridgelawn.com.");
    const label = d.split(".").slice(0, -1).join(".");
    const asked = SELL_TLDS.includes(tldOf(d)) ? [d] : [];
    names = [...asked, ...SELL_TLDS.map((t) => `${label}.${t}`)];
  } else {
    names = (url.searchParams.get("names") || "").split(",").map(cleanDomain);
  }
  names = [...new Set(names)].filter((d) => isValidDomain(d) && SELL_TLDS.includes(tldOf(d))).slice(0, 12);
  if (!names.length) return { results: [] };
  const results = await checkDomains(env, names);
  // Never send prices to the page: included names cost the customer nothing extra.
  return { results: results.map(({ name, available, included }) => ({ name, available, included })) };
}

// ---------------- Checkout ----------------

async function startCheckout(req, env, base) {
  if (!(await rateLimit(env, "checkout", clientIp(req), 20, 3600))) throw httpError(429, "Too many tries. Please wait a few minutes.");
  const b = await readJson(req);
  const previewId = String(b.previewId || "");
  const preview = /^[a-z0-9]{10}$/.test(previewId) && (await getPreview(env, previewId));
  if (!preview) throw httpError(400, "This preview has expired. Please make a new one.");
  const style = pickStyle(b.style);
  const plan = b.plan === "monthly" ? "monthly" : "once";
  const mode = b.domainMode === "own" ? "own" : "new";
  const name = cleanDomain(b.domain);
  if (!isValidDomain(name)) throw httpError(400, "That doesn't look like a web address. Try something like yourbusiness.com.");
  if (name.endsWith("vantryai.com")) throw httpError(400, "Please pick your own web address.");
  if (await getHostSiteId(env, name)) throw httpError(409, "That domain is already connected to a Vantry site. Email booking@vantryai.com if it's yours.");

  if (mode === "new") {
    if (!SELL_TLDS.includes(tldOf(name))) throw httpError(400, `We can register names ending in ${SELL_TLDS.map((t) => "." + t).join(", ")}.`);
    const [r] = await checkDomains(env, [name]);
    if (!r?.available) throw httpError(409, `${name} was just taken. Please pick another.`);
    if (!r.included) throw httpError(409, `${name} is a premium name and isn't included. Please pick another.`);
  }

  const order = {
    id: `o${randomId(12)}`,
    previewId,
    style,
    plan,
    email: preview.input.email,
    businessName: preview.input.businessName,
    domain: { mode, name },
    status: "checkout",
    createdAt: Date.now(),
    history: [],
  };
  const session = await createCheckout(env, { order, businessName: preview.input.businessName, publicBase: base });
  order.checkoutSession = session.id;
  await saveOrder(env, order, "Checkout started");
  return { url: session.url };
}

async function stripeWebhook(req, env, ctx) {
  const body = await req.text();
  const event = await verifyWebhook(env, body, req.headers.get("Stripe-Signature"));
  const obj = event.data?.object || {};
  let work = null;
  if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.payment_status !== "unpaid") {
    work = onCheckoutCompleted(env, obj);
  } else if (event.type === "customer.subscription.deleted") {
    work = onSubscriptionEnded(env, obj);
  } else if (event.type === "invoice.payment_failed") {
    work = send(env, "ownerAlert", { subject: "A payment failed", text: `Invoice ${obj.id} for ${obj.customer_email || obj.customer} failed. Stripe will retry it automatically.` });
  }
  // Answer Stripe right away; the setup work continues in the background.
  if (work) ctx.waitUntil(work.catch((e) => console.log("Webhook work failed", e.stack || e.message)));
  return json({ received: true });
}

async function showThanks(orderId, env) {
  const order = await getOrder(env, orderId);
  if (!order) throw httpError(404, "We couldn't find that order. Check your email for your receipt.");
  return html(thanksPage(order, await getSite(env, orderId)), 200, { "Cache-Control": "no-store" });
}

// ---------------- Quote requests from customer sites ----------------

async function receiveLead(req, env) {
  const b = await readJson(req);
  if (b.company) return { ok: true }; // a bot filled the hidden field; pretend it worked
  const siteId = String(b.siteId || "");
  const site = /^o[a-z0-9]{12}$/.test(siteId) && (await getSite(env, siteId));
  if (!site || !site.live) throw httpError(400, "This form isn't active yet. Please call or text instead.");
  const ip = clientIp(req);
  if (!(await rateLimit(env, "lead-ip", ip, 5, 3600))) throw httpError(429, "Thanks, we already got your message.");
  if (!(await rateLimit(env, "lead-site", siteId, 60, 86400))) throw httpError(429, "Please call or text instead.");
  const lead = {
    name: String(b.name || "").trim().slice(0, 100),
    contact: String(b.contact || "").trim().slice(0, 120),
    details: String(b.details || "").trim().slice(0, 2000),
  };
  if (!lead.name || !lead.contact) throw httpError(400, "Please add your name and a phone number or email.");
  await addLead(env, siteId, lead);
  await send(env, "newLead", { site, lead });
  return { ok: true };
}

// ---------------- Customer websites ----------------

async function serveHostedSite(host, url, env) {
  const siteId = await getHostSiteId(env, host);
  const site = siteId && (await getSite(env, siteId));
  if (!site) return html(placeholder({ title: "Coming soon", message: "This website is being set up." }), 404);
  if (site.offline) return html(placeholder({ title: site.businessName, message: "This website is currently offline." }), 503);
  if (!site.live) return html(placeholder({ title: site.businessName, message: "Our new website is almost ready. Check back soon." }), 200, { "Cache-Control": "no-store" });

  const bare = normalizeHost(host);
  // One address for Google: send domain.com to www.domain.com (only bought domains route both).
  if (host === bare && host === site.domain) return Response.redirect(`https://www.${bare}${url.pathname}${url.search}`, 301);

  if (url.pathname === "/robots.txt") {
    return new Response(`User-agent: *\nAllow: /\nSitemap: https://www.${bare}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain" } });
  }
  if (url.pathname === "/sitemap.xml") {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.${bare}/</loc></url></urlset>`;
    return new Response(xml, { headers: { "Content-Type": "application/xml" } });
  }
  if (url.pathname !== "/") return Response.redirect(`https://${host}/`, 301);

  const page = renderSite({
    copy: site.copy,
    input: site.input,
    style: site.style,
    domain: bare,
    lead: { endpoint: `${env.PUBLIC_API || "https://api.vantryai.com"}/api/lead`, siteId: site.id },
  });
  return html(page, 200, { "Cache-Control": "public, max-age=300" });
}

// ---------------- Your dashboard ----------------

async function admin(req, url, env) {
  if (!env.ADMIN_TOKEN) throw httpError(404, "Page not found.");
  let token = url.searchParams.get("token") || "";
  let form = null;
  if (req.method === "POST") {
    form = await req.formData();
    token = form.get("token") || "";
  }
  if (!safeEqual(token, env.ADMIN_TOKEN)) throw httpError(404, "Page not found.");
  const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

  let m;
  if (req.method === "GET" && (m = url.pathname.match(/^\/admin\/site\/(o[a-z0-9]{12})$/))) {
    const site = await getSite(env, m[1]);
    if (!site) throw httpError(404, "No site for that order yet.");
    return html(renderSite({ copy: site.copy, input: site.input, style: site.style, domain: site.domain }), 200, noStore);
  }

  let flash = "";
  if (req.method === "POST" && url.pathname === "/admin/action") {
    const orderId = String(form.get("orderId") || "");
    const action = String(form.get("action") || "");
    try {
      if (action === "approve") {
        const o = await approve(env, orderId);
        flash = o.status === "live" ? `${o.businessName} is live. We emailed them.` : `Approved. ${o.businessName} goes live as soon as the domain is ready.`;
      } else if (action === "retry") {
        const o = await retry(env, orderId);
        flash = `Retried ${o.businessName}: now "${o.status}".`;
      } else if (action === "offline") {
        const o = await takeOffline(env, orderId, "Taken offline from admin");
        flash = `${o?.businessName || "Site"} is offline.`;
      } else if (action === "online") {
        const o = await putBackOnline(env, orderId);
        flash = `${o.businessName}: now "${o.status}".`;
      }
    } catch (e) {
      flash = `Couldn't do that: ${e.message}`;
    }
  }
  return html(adminPage(await listOrders(env), token, flash), 200, noStore);
}
