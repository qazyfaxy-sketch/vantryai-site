// "Get recommended by ChatGPT": free AI visibility reports, monthly plans and onboarding.
//
//   POST /api/report            free report from the vantryai.com/ai page (rate limited, daily cap)
//   POST /api/audit/batch       reports for an outreach list (Authorization: Bearer ADMIN_TOKEN)
//   GET  /r/:id                 the report page
//   POST /api/ai/checkout       Stripe checkout for Starter / Growth / Pro
//   GET  /ai/welcome/:id        after payment
//   GET  /start/:id, POST       onboarding form (no call needed)
//   /admin/audits               run reports by hand, see recent reports and clients
//
// Stripe events handled from worker.js: checkout completed, subscription ended, invoice.upcoming
// (the reminder email 3 days before every renewal).
import { json, html, httpError, randomId, readJson, clientIp, rateLimit, safeEqual, esc, money } from "./lib/util.js";
import { runAudit, getAudit, listAudits, availableEngines, ENGINES } from "./lib/aiscan.js";
import { stripe } from "./lib/stripe.js";
import { sendEmail } from "./lib/email.js";
import { reportPage } from "./pages/report.js";
import { page } from "./pages/shell.js";
import { queueStart, runDelivery, QUESTION_LIMIT } from "./lib/delivery.js";
import { isVideoPath, videoRoute, videoAdmin, videoCard, runVideos } from "./lib/video.js";
import { isListingsPath, listingsRoute, listingsAdmin, listingsCard, runListings } from "./lib/listings.js";
import { isSitePath, siteRoute, siteAdmin, siteCard, runSiteWork, PAGES_PER_MONTH } from "./lib/sitefix.js";

export const AI_PLANS = {
  starter: { label: "Starter", cents: 14900, line: "AI visibility tracking + a monthly fix list" },
  growth: { label: "Growth", cents: 49700, line: "Done for you: monthly fixes plus 2 YouTube videos a month" },
  pro: { label: "Pro", cents: 99700, line: "Done for you: 50 buyer questions plus 4 YouTube videos a month" },
};

const PUBLIC_REPORTS_PER_IP_DAY = 3;
const PUBLIC_REPORTS_PER_EMAIL = 2;
const DEFAULT_AUDIT_DAILY_CAP = 20; // free reports per day (cost guard)
const BATCH_MAX = 5;

const base = (env, url) => env.PUBLIC_API || url.origin;
const plansUrl = (env) => `${env.SITE_ORIGIN || "https://vantryai.com"}/ai/#plans`;
const cancelText = (env) =>
  env.STRIPE_PORTAL_LINK
    ? `Cancel or change your plan any time, in one click: ${env.STRIPE_PORTAL_LINK}`
    : `Want to cancel? Reply to this email and we'll cancel it the same day.`;
const sign = "Thanks,\nVince\nVantry · vantryai.com";

export function isAiPath(p) {
  return isVideoPath(p) || isSitePath(p) || isListingsPath(p) || p === "/api/report" || p === "/api/audit/batch" || p === "/api/ai/checkout" || /^\/r\/a[a-z0-9]{11}$/.test(p) || /^\/ai\/welcome\/c[a-z0-9]{11}$/.test(p) || /^\/start\/c[a-z0-9]{11}$/.test(p);
}

export async function aiRoute(req, url, env, cors) {
  const p = url.pathname;
  let m;
  if (isVideoPath(p)) return await videoRoute(req, url, env, { getClient, saveClient });
  if (isSitePath(p)) return await siteRoute(req, url, env, { getClient, saveClient });
  if (isListingsPath(p)) return await listingsRoute(req, url, env, { getClient, saveClient });
  if (req.method === "POST" && p === "/api/report") return json(await freeReport(req, env, url), 200, cors);
  if (req.method === "POST" && p === "/api/audit/batch") return json(await batch(req, env, url));
  if (req.method === "POST" && p === "/api/ai/checkout") return json(await checkout(req, env, url), 200, cors);
  if (req.method === "GET" && (m = p.match(/^\/r\/(a[a-z0-9]{11})$/))) {
    const audit = await getAudit(env, m[1]);
    if (!audit) throw httpError(404, "This report has expired. Get a fresh one free at vantryai.com/ai.");
    return html(reportPage(audit, { plansUrl: plansUrl(env) }), 200, { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" });
  }
  if (req.method === "GET" && (m = p.match(/^\/ai\/welcome\/(c[a-z0-9]{11})$/))) return html(welcomePage(await getClient(env, m[1]) || notFound()), 200, { "Cache-Control": "no-store" });
  if ((m = p.match(/^\/start\/(c[a-z0-9]{11})$/))) return await onboarding(req, env, m[1]);
  throw httpError(404, "Page not found.");
}

const notFound = () => { throw httpError(404, "We couldn't find that. Check your email for the right link."); };

// ---------------- Free report (public) ----------------

async function verifyTurnstile(env, token, ip) {
  if (!token) throw httpError(400, "Please complete the quick check and try again.");
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }) });
  const d = await res.json();
  if (!d.success) throw httpError(400, "The quick check didn't pass. Please refresh and try again.");
}

async function freeReport(req, env, url) {
  const b = await readJson(req);
  if (b.company) throw httpError(400, "Please try again."); // hidden field: bots fill it
  const email = String(b.email || "").trim().toLowerCase().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, "Please enter a valid email so we can send you the report.");
  if (!String(b.website || "").trim()) throw httpError(400, "Please add your website.");
  const ip = clientIp(req);
  if (env.TURNSTILE_SECRET) await verifyTurnstile(env, b.turnstileToken, ip);
  if (!(await rateLimit(env, "report-ip", ip, PUBLIC_REPORTS_PER_IP_DAY, 86400))) throw httpError(429, "You've made a few reports today. Please try again tomorrow.");
  if (!(await rateLimit(env, "report-email", email, PUBLIC_REPORTS_PER_EMAIL, 86400 * 30))) throw httpError(429, "We already sent reports to this email. Check your inbox, or reply to it for a fresh one.");
  const cap = parseInt(env.AUDIT_DAILY_CAP || DEFAULT_AUDIT_DAILY_CAP, 10);
  if (!(await rateLimit(env, "report-day", "all", cap, 86400))) throw httpError(503, "We're very busy today. Leave your email at booking@vantryai.com and we'll send your report tomorrow.");

  const engines = availableEngines(env).slice(0, 3); // cost guard
  const audit = await runAudit(env, { name: b.name, website: b.website, category: b.category, audience: b.audience }, { questionCount: 3, engines, origin: "public", email });
  const link = `${base(env, url)}/r/${audit.id}`;
  const s = audit.summary;
  await sendEmail(env, {
    to: email,
    subject: `Your AI visibility report: ${audit.company.name} named in ${s.mentioned} of ${s.total} answers`,
    text: `Hi,

Here's your free report. We asked AI the questions your buyers ask, and checked who it recommends:
${link}

${s.mentioned === 0 ? `${audit.company.name} wasn't named in any of the ${s.total} answers.` : `${audit.company.name} was named in ${s.mentioned} of ${s.total} answers.`}${s.competitors[0] ? ` The company named most often was ${s.competitors[0].name}.` : ""}

If you want help getting named, reply to this email or see the plans:
${plansUrl(env)}

${sign}`,
  });
  await sendEmail(env, { to: env.OWNER_EMAIL, subject: `Free report: ${audit.company.name} (${s.mentioned}/${s.total})`, text: `${email} asked for a report.\n${link}` });
  return { url: link, mentioned: s.mentioned, total: s.total };
}

// ---------------- Batch reports for outreach ----------------

async function batch(req, env, url) {
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || !safeEqual(auth, env.ADMIN_TOKEN)) throw httpError(404, "Page not found.");
  const b = await readJson(req);
  // Cloudflare caps outside calls per request (50 on the free plan), so size the batch to fit.
  const qCount = Math.min(5, parseInt(b.questionCount || 3, 10) || 3);
  const eCount = (Array.isArray(b.engines) && b.engines.length) || availableEngines(env).length || 1;
  const perCompany = qCount * eCount + 4; // questions x engines + helper AI calls + margin
  const max = Math.max(1, Math.min(BATCH_MAX, Math.floor(45 / perCompany)));
  const list = Array.isArray(b.companies) ? b.companies.slice(0, max) : [];
  if (!list.length) throw httpError(400, `Send "companies": [{name, website, category, audience}] (up to ${max} at a time with these settings).`);
  const out = [];
  for (const c of list) {
    try {
      const audit = await runAudit(env, c, { questions: c.questions, questionCount: qCount, engines: b.engines, origin: "outreach" });
      const first = audit.results.find((r) => r.q === audit.questions[0] && !r.error && r.engine === (audit.engines.includes("openai") ? "openai" : audit.engines[0]));
      out.push({
        name: audit.company.name,
        url: `${base(env, url)}/r/${audit.id}`,
        mentioned: audit.summary.mentioned,
        total: audit.summary.total,
        question: audit.questions[0],
        engine: first ? ENGINES[first.engine].label : null,
        namedInstead: first ? first.named.slice(0, 3) : [],
        topCompetitors: audit.summary.competitors.slice(0, 3).map((x) => x.name),
      });
    } catch (e) {
      out.push({ name: c.name, error: e.message });
    }
  }
  return { results: out };
}

// ---------------- Plans and checkout ----------------

const clientKey = (id) => `aic:${id}`;
export async function getClient(env, id) {
  const raw = /^c[a-z0-9]{11}$/.test(id) ? await env.PREVIEWS.get(clientKey(id)) : null;
  return raw ? JSON.parse(raw) : null;
}
export async function saveClient(env, c, note) {
  if (note) (c.history ||= []).push({ at: Date.now(), note });
  await env.PREVIEWS.put(clientKey(c.id), JSON.stringify(c));
  let index = [];
  try { index = JSON.parse((await env.PREVIEWS.get("aiclients:index")) || "[]"); } catch {}
  if (!index.includes(c.id)) {
    index.unshift(c.id);
    await env.PREVIEWS.put("aiclients:index", JSON.stringify(index.slice(0, 1000)));
  }
}
export async function listClients(env) {
  let index = [];
  try { index = JSON.parse((await env.PREVIEWS.get("aiclients:index")) || "[]"); } catch {}
  return (await Promise.all(index.slice(0, 100).map((id) => getClient(env, id)))).filter(Boolean);
}

async function checkout(req, env, url) {
  if (!(await rateLimit(env, "ai-checkout", clientIp(req), 20, 3600))) throw httpError(429, "Too many tries. Please wait a few minutes.");
  const b = await readJson(req);
  const plan = AI_PLANS[b.plan] ? b.plan : null;
  if (!plan) throw httpError(400, "Please pick a plan.");
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email || "")) ? String(b.email).trim().toLowerCase() : undefined;
  const reportId = /^a[a-z0-9]{11}$/.test(String(b.reportId || "")) ? b.reportId : undefined;
  const client = { id: `c${randomId(11)}`, plan, status: "checkout", createdAt: Date.now(), email: email || "", reportId, history: [] };
  const P = AI_PLANS[plan];
  const session = await stripe(env, "/checkout/sessions", {
    mode: "subscription",
    line_items: { 0: { quantity: 1, price_data: { currency: "usd", unit_amount: P.cents, recurring: { interval: "month" }, product_data: { name: `Vantry AI Visibility: ${P.label}`, description: P.line } } } },
    customer_email: email,
    client_reference_id: client.id,
    metadata: { aiClientId: client.id, aiPlan: plan },
    subscription_data: { metadata: { aiClientId: client.id, aiPlan: plan } },
    allow_promotion_codes: true,
    custom_text: { submit: { message: "Month to month, cancel any time. First month money-back. We email you 3 days before every renewal." } },
    success_url: `${base(env, url)}/ai/welcome/${client.id}`,
    cancel_url: plansUrl(env),
  });
  client.checkoutSession = session.id;
  await saveClient(env, client, `Checkout started (${P.label})`);
  return { url: session.url };
}

export async function onAiStarted(env, session) {
  const c = await getClient(env, session.metadata.aiClientId);
  if (!c || c.status === "active") return;
  c.status = "active";
  c.startedAt = Date.now();
  c.email = session.customer_details?.email || session.customer_email || c.email;
  c.name = session.customer_details?.name || "";
  c.stripe = { customer: session.customer, subscription: session.subscription };
  await saveClient(env, c, "Paid");
  const P = AI_PLANS[c.plan];
  const start = `${env.PUBLIC_API || "https://api.vantryai.com"}/start/${c.id}`;
  await sendEmail(env, {
    to: c.email,
    subject: "You're in: let's get you recommended by AI",
    text: `Hi${c.name ? ` ${c.name.split(" ")[0]}` : ""},

Thanks for joining Vantry AI Visibility (${P.label}, ${money(P.cents)}/month).

First step, about 5 minutes, no call needed. Tell us about your buyers and competitors here:
${start}

What happens next:
- A few hours after the form: your starting report, on your own buyer questions, plus your first fix list.
- Every 30 days: a fresh report showing what changed, and what we're fixing next.
- Day 60: our promise. If you're not named in at least one new AI answer by then, your next month is free, automatically.

Not happy in your first month? Reply and we'll refund it, no questions.
We'll also email you 3 days before every renewal. ${cancelText(env)}

${sign}`,
  });
  await sendEmail(env, { to: env.OWNER_EMAIL, subject: `New AI client: ${c.email} (${P.label})`, text: `New ${P.label} client ${c.id}: ${c.email}\nWaiting for onboarding: ${start}${c.reportId ? `\nTheir report: ${env.PUBLIC_API}/r/${c.reportId}` : ""}` });
}

export async function onAiEnded(env, sub) {
  const c = await getClient(env, sub.metadata.aiClientId);
  if (!c) return;
  c.status = "canceled";
  c.endedAt = Date.now();
  await saveClient(env, c, "Subscription ended");
  await sendEmail(env, { to: env.OWNER_EMAIL, subject: `AI client canceled: ${c.email}`, text: `${c.email} (${c.plan}) canceled. Worth a short, kind note asking what we could do better.` });
}

// Stripe sends invoice.upcoming before each renewal (set the timing to 3 days in Stripe).
export async function onInvoiceUpcoming(env, invoice) {
  const meta = invoice.subscription_details?.metadata || invoice.parent?.subscription_details?.metadata || {};
  if (!meta.aiClientId) return false;
  const c = await getClient(env, meta.aiClientId);
  const to = invoice.customer_email || c?.email;
  if (!to) return true;
  const date = new Date((invoice.next_payment_attempt || invoice.period_end || Date.now() / 1000) * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" });
  await sendEmail(env, {
    to,
    subject: `Heads up: your Vantry plan renews on ${date}`,
    text: `Hi,

A quick heads-up so nothing surprises you: your Vantry AI Visibility plan renews on ${date} for ${money(invoice.amount_due || 0)}.

Nothing to do if you'd like to keep going. ${cancelText(env)}

${sign}`,
  });
  return true;
}

function welcomePage(c) {
  const start = `/start/${c.id}`;
  const body = `<main>
<h1>${c.status === "active" ? "You're in." : "Almost there."}</h1>
<p class="lede">${c.status === "active" ? "Thanks for joining Vantry AI Visibility." : "Your payment is going through. This page updates in a minute."}</p>
<div class="card"><h2>One quick step, about 5 minutes</h2><p class="muted">Tell us about your buyers and competitors so we ask AI the right questions. No call needed.</p><a class="jelly" href="${start}">Fill in the short form</a></div>
<div class="card"><h2>What happens next</h2><p><strong>A few hours after the form:</strong> your starting report and first fix list.<br><strong>Every 30 days:</strong> a fresh report showing what changed.<br><strong>Day 60:</strong> if you're not named in at least one new AI answer, your next month is free, automatically.</p></div>
</main>`;
  return page({ title: "Welcome", body });
}

// ---------------- Onboarding (no call) ----------------

const FIELDS = [
  ["business", "Company name", "text"],
  ["website", "Your website", "text"],
  ["sell", "What you sell, in one sentence", "text"],
  ["buyers", "Who your best customers are", "textarea"],
  ["competitors", "Your top 3 competitors (names or websites)", "textarea"],
  ["questions", "Questions customers ask before they buy", "textarea"],
  ["avoid", "Anything we should never say about you (optional)", "textarea"],
  ["reportEmail", "Where should monthly reports go? (email)", "text"],
];

async function onboarding(req, env, id) {
  const c = await getClient(env, id);
  if (!c) notFound();
  if (req.method === "POST") {
    const form = await req.formData();
    if (form.get("company")) return html(page({ title: "Thanks", body: "<main><h1>Thanks!</h1></main>" }));
    c.onboarding = Object.fromEntries(FIELDS.map(([k]) => [k, String(form.get(k) || "").trim().slice(0, 1500)]));
    c.onboardedAt = Date.now();
    if (!c.job && !(c.audits || []).length) await queueStart(env, c); // starting report runs on the next cron ticks
    await saveClient(env, c, "Onboarding form filled in");
    const siteLink = `${env.PUBLIC_API || "https://api.vantryai.com"}/site/${c.id}`;
    if (PAGES_PER_MONTH[c.plan]) {
      await sendEmail(env, {
        to: c.onboarding.reportEmail || c.email,
        subject: "One optional step: let us publish fixes to your website",
        text: `Hi,

Thanks for the details. Your starting report is on its way.

Every month we write pages that answer your buyers' questions, plus the code AI tools read, all fact-checked against your own website. Connect your site once (about 2 minutes) and we publish them for you:
${siteLink}

WordPress: install our small plugin and paste a code. Anything else (Webflow, Wix, Squarespace, Shopify): add one DNS record and we host the pages on a subdomain of your site. Or skip it, and copy each page from that link yourself.

${sign}`,
      });
    }
    await sendEmail(env, { to: env.OWNER_EMAIL, subject: `Onboarding done: ${c.onboarding.website || c.email}`, text: FIELDS.map(([k, label]) => `${label}:\n${c.onboarding[k] || "-"}`).join("\n\n") });
    return html(page({ title: "Got it", body: `<main><h1>Got it. We're on it.</h1><p class="lede">Your starting report, on ${c.questions?.length || "your"} buyer questions, arrives by email within a few hours. Then you get a fresh report every month, with what changed and what we\'re fixing. Questions any time: just reply to any of our emails.</p>${PAGES_PER_MONTH[c.plan] ? `<div class="card"><h2>Optional, 2 minutes: connect your website</h2><p>So we can publish your fact-checked pages and AI code for you.</p><a class="jelly" href="/site/${c.id}">Connect your website</a></div>` : ""}</main>` }));
  }
  const v = c.onboarding || {};
  const inputs = FIELDS.map(([k, label, type]) => `<label class="f"><span>${esc(label)}</span>${type === "textarea" ? `<textarea name="${k}" rows="3">${esc(v[k] || "")}</textarea>` : `<input type="text" name="${k}" value="${esc(v[k] || (k === "reportEmail" ? c.email : ""))}">`}</label>`).join("");
  const body = `<main><h1>Tell us about your business</h1><p class="lede">About 5 minutes. This is how we pick the questions your buyers ask AI. No call needed.</p>
<form class="card" method="post">${inputs}<input type="text" name="company" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true"><button class="jelly block">Send</button></form></main>
<style>.f{display:block;margin-bottom:16px}.f span{display:block;font-weight:600;margin-bottom:6px}textarea{width:100%;border:1px solid #B9C3D1;border-radius:12px;padding:12px 14px;font:16px var(--sans)}</style>`;
  return html(page({ title: "Get started", body }), 200, { "Cache-Control": "no-store" });
}

// ---------------- Admin: run reports by hand ----------------

export async function aiAdmin(req, url, env, form, token) {
  if (url.pathname.startsWith("/admin/youtube") || url.pathname === "/admin/video") return await videoAdmin(req, url, env, form, token, { getClient, saveClient });
  if (req.method === "POST" && url.pathname === "/admin/listings") return await listingsAdmin(req, url, env, form, token, { getClient, saveClient });
  if (req.method === "POST" && url.pathname === "/admin/page") return await siteAdmin(req, url, env, form, token, { getClient, saveClient });
  let flash = String(url.searchParams.get("flash") || "").slice(0, 400);
  if (req.method === "POST" && url.pathname === "/admin/audit") {
    try {
      const questions = String(form.get("questions") || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const audit = await runAudit(env, { name: form.get("name"), website: form.get("website"), category: form.get("category"), audience: form.get("audience") }, { questions, questionCount: 3, origin: "admin" });
      flash = `Done: ${audit.company.name} named in ${audit.summary.mentioned} of ${audit.summary.total}. Report: ${env.PUBLIC_API || url.origin}/r/${audit.id}`;
    } catch (e) {
      flash = `Couldn't run it: ${e.message}`;
    }
  }
  const audits = await listAudits(env);
  const clients = await listClients(env);
  const engines = availableEngines(env).map((e) => ENGINES[e].label).join(", ") || "none yet (add an API key)";
  const t = encodeURIComponent(token);
  const body = `<main class="wide">
<h1>AI visibility</h1>
<p class="lede">Engines on: ${esc(engines)}.</p>
${flash ? `<p class="card ok"><strong>${esc(flash)}</strong></p>` : ""}
<form class="card" method="post" action="/admin/audit"><input type="hidden" name="token" value="${esc(token)}">
<h2>Run a report</h2>
<div class="g"><label>Business name<input type="text" name="name" required></label><label>Website<input type="text" name="website" placeholder="example.com"></label>
<label>What they sell<input type="text" name="category" required placeholder="scheduling software for dental offices"></label><label>Who buys it<input type="text" name="audience" placeholder="small dental practices"></label></div>
<label>Questions (optional, one per line; leave empty and AI writes 3)<textarea name="questions" rows="3"></textarea></label>
<button class="jelly sm">Run report</button></form>
<div class="card"><h2>Clients</h2>${clients.length ? `<table><tr><th>Email</th><th>Plan</th><th>Status</th><th>Onboarding</th><th>Latest report</th></tr>${clients.map((c) => { const a = (c.audits || []).slice(-1)[0]; return `<tr><td>${esc(c.email || "-")}</td><td>${esc(AI_PLANS[c.plan]?.label || c.plan)}</td><td>${esc(c.status)}</td><td>${c.onboardedAt ? "Done" : `<a href="/start/${c.id}">Link</a>`}</td><td>${c.job ? `Checking: ${c.job.next} of ${c.job.pairs.length}` : a ? `<a href="/r/${a.id}" target="_blank" rel="noopener">${a.mentioned}/${a.total}</a>` : "-"}${c.promise ? `<br><span class="small muted">60-day: ${c.promise.kept ? "kept" : c.promise.freeMonth ? "free month given" : "needs you"}</span>` : ""}</td></tr>`; }).join("")}</table>` : '<p class="muted">No clients yet.</p>'}</div>
${await videoCard(env, clients, token)}
${await siteCard(env, clients, token)}
${await listingsCard(env, clients, token)}
<div class="card"><h2>Recent reports</h2>${audits.length ? `<table><tr><th>Business</th><th>Named</th><th>From</th><th>When</th></tr>${audits.slice(0, 60).map((a) => `<tr><td><a href="/r/${a.id}" target="_blank" rel="noopener">${esc(a.name)}</a>${a.email ? `<br><span class="small muted">${esc(a.email)}</span>` : ""}</td><td>${esc(a.score)}</td><td>${esc(a.origin)}</td><td class="small">${new Date(a.at).toLocaleString("en-US", { timeZone: "America/New_York" })}</td></tr>`).join("")}</table>` : '<p class="muted">No reports yet.</p>'}</div>
<p><a href="/admin?token=${t}">Back to website orders</a></p>
</main>
<style>.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}label{display:block;font-weight:600;font-size:14px;margin-bottom:12px}label input,label textarea{margin-top:6px}textarea{width:100%;border:1px solid #B9C3D1;border-radius:12px;padding:12px;font:15px var(--sans)}
table{border-collapse:collapse;width:100%;font-size:14px}th{text-align:left;font-size:12px;color:var(--muted);padding:8px}td{padding:10px 8px;border-top:1px solid var(--line);vertical-align:top}</style>`;
  return html(page({ title: "AI visibility", body }), 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
}

// Cron: starting reports, monthly reports, fix lists and the 60-day promise.
export const runClientDelivery = (env) => runDelivery(env, { listClients, saveClient });
// Cron: YouTube videos for Growth and Pro clients.
export const runClientVideos = (env) => runVideos(env, { listClients, saveClient });
// Cron: website pages, schema and llms.txt for Growth and Pro clients.
export const runClientListings = (env) => runListings(env, { listClients, saveClient });
export const runClientSite = (env) => runSiteWork(env, { listClients, saveClient });
