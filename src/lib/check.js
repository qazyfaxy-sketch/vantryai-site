// "Is everything set up?" Your page at /admin/check.
//   - Setup list: what's on, what's missing, and what each missing thing stops. Never shows a secret.
//   - "Test my keys": makes one free or tiny real call to each service to prove the key works.
//   - "Email myself a test": sends one email from your outreach address to YOUR OWN inbox.
//   - Looks up (never changes) the email records on your outreach domain.
import { json, html, httpError, esc } from "./util.js";
import { page } from "../pages/shell.js";
import { getChannel } from "./video.js";
import { claudeJson } from "./aiscan.js";
import { sendGate } from "./outreach.js";
import { rootOf } from "./listings.js";

const api = (env) => env.PUBLIC_API || "https://api.vantryai.com";
const has = (env, k) => !!String(env[k] || "").trim();

// [name, [needed env names], what it unlocks, what to do]
const GROUPS = [
  ["Free reports and everything AI", ["ANTHROPIC_API_KEY"], "Writing questions, pages, scripts and fact checks.", "Add ANTHROPIC_API_KEY in Cloudflare (Workers > vantry > Settings > Variables)."],
  ["ChatGPT in your reports", ["OPENAI_API_KEY"], "The free report and monthly reports can't ask ChatGPT without it.", "Add OPENAI_API_KEY."],
  ["Perplexity / Gemini (optional)", ["PERPLEXITY_API_KEY", "GEMINI_API_KEY"], "More AI engines in reports. Nice to have.", "Add either key if you want them."],
  ["Your admin login", ["ADMIN_TOKEN", "OWNER_EMAIL"], "This page and your review emails.", "Add ADMIN_TOKEN and OWNER_EMAIL."],
  ["Email (Resend)", ["RESEND_API_KEY"], "Every email: reports, review links, outreach.", "Add RESEND_API_KEY."],
  ["Outreach sending", ["OUTREACH_FROM", "MAILING_ADDRESS"], "Article notes and prospect emails. The law requires a real mailing address; the from-address must be on usevantry.com or joinvantry.com.", "Add OUTREACH_FROM (like Vince <vince@usevantry.com>) and MAILING_ADDRESS."],
  ["Bounce and spam protection", ["RESEND_WEBHOOK_SECRET"], "Auto-blocks bad addresses, sorts replies and pauses sending if you start getting complaints.", "In Resend add a webhook to /api/email/events (bounced, complained, received) and paste its secret as RESEND_WEBHOOK_SECRET."],
  ["Payments (Stripe)", ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], "Selling plans.", "Add both. Use live-mode keys when you're ready for real customers."],
  ["Customer portal link", ["STRIPE_PORTAL_LINK"], "Clients can cancel in one click (it's in the emails).", "Create the Stripe customer portal link and paste it."],
  ["Videos: YouTube", ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "VIDEO_SECRET"], "Uploading videos and Shorts.", "Create the Google Cloud project, then add these."],
  ["Videos: voice and rendering", ["ELEVENLABS_VOICE_ID", "GH_DISPATCH_TOKEN"], "Rendering videos on GitHub. (The ElevenLabs key itself lives in GitHub secrets.)", "Add GH_DISPATCH_TOKEN (and a voice id if you want a specific voice)."],
  ["Answers hub (Cloudflare for SaaS)", ["CF_SAAS_ZONE_ID", "CF_API_TOKEN", "SAAS_CNAME_TARGET"], "Hosting clients' answer pages on their own domains.", "Follow README step 4. Clients can still copy-paste pages without it."],
];

export function configRows(env) {
  return GROUPS.map(([name, keys, unlocks, todo]) => {
    const missing = keys.filter((k) => !has(env, k));
    const optional = /optional/.test(name);
    const ok = optional ? keys.some((k) => has(env, k)) : !missing.length;
    return { name, ok, missing: optional && ok ? [] : missing, unlocks, todo };
  });
}

// ---------- live tests: one small real call each ----------

async function tryCall(name, fn) {
  try {
    const r = await fn();
    return { name, ok: r.ok, note: r.note };
  } catch (e) {
    return { name, ok: false, note: `couldn't reach it (${String(e.message).slice(0, 80)})` };
  }
}
const get = (url, headers = {}) => fetch(url, { headers, signal: AbortSignal.timeout(10000) });
const txt = async (domain, type) => {
  try {
    const r = await get(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, { Accept: "application/dns-json" });
    const j = await r.json();
    return (j.Answer || []).map((a) => String(a.data).replace(/"/g, ""));
  } catch {
    return null;
  }
};

export async function domainRows(env) {
  const from = String(env.OUTREACH_FROM || "");
  const dom = (from.match(/@([a-z0-9.-]+)/i) || [])[1]?.toLowerCase();
  if (!dom) return [];
  const root = rootOf(dom);
  const [mx, spf, dmarc] = await Promise.all([txt(root, "MX"), txt(root, "TXT"), txt(`_dmarc.${root}`, "TXT")]);
  const rows = [];
  rows.push({ name: `${root}: receives mail (MX)`, ok: mx ? mx.length > 0 : null, note: mx?.length ? "yes" : "no mail server found. Replies and bounces to this domain would be lost." });
  rows.push({ name: `${root}: sender record (SPF)`, ok: spf ? spf.some((x) => x.startsWith("v=spf1")) : null, note: spf?.some((x) => x.startsWith("v=spf1")) ? "found" : "missing. Email from this domain is more likely to land in spam. Resend shows the exact record to add." });
  rows.push({ name: `${root}: spam policy (DMARC)`, ok: dmarc ? dmarc.some((x) => x.startsWith("v=DMARC1")) : null, note: dmarc?.some((x) => x.startsWith("v=DMARC1")) ? "found" : "missing. Google and Yahoo expect one for bulk email." });
  return rows;
}

export async function liveRows(env) {
  const out = [];
  out.push(await tryCall("Storage (KV)", async () => { await env.PREVIEWS.put("check:t", "1", { expirationTtl: 60 }); const v = await env.PREVIEWS.get("check:t"); return { ok: v === "1", note: v === "1" ? "reads and writes" : "can't read what it wrote" }; }));
  const beat = parseInt((await env.PREVIEWS.get("cron:last")) || "0", 10);
  out.push({ name: "Timer (runs every 10 minutes)", ok: beat > 0 && Date.now() - beat < 40 * 60000, note: beat ? `last ran ${Math.round((Date.now() - beat) / 60000)} minutes ago` : "hasn't run yet (the Cloudflare cron trigger may be off)" });
  if (has(env, "ANTHROPIC_API_KEY")) out.push(await tryCall("Anthropic (Claude)", async () => { const j = await claudeJson(env, 'Return JSON only: {"ok": true}', "ping", 20); return { ok: !!j?.ok, note: j?.ok ? "key works" : "the key was rejected or the model name is wrong" }; }));
  if (has(env, "OPENAI_API_KEY")) out.push(await tryCall("OpenAI (ChatGPT)", async () => { const r = await get("https://api.openai.com/v1/models", { Authorization: `Bearer ${env.OPENAI_API_KEY}` }); return { ok: r.ok, note: r.ok ? "key works" : `rejected (${r.status})` }; }));
  if (has(env, "GEMINI_API_KEY")) out.push(await tryCall("Gemini", async () => { const r = await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(env.GEMINI_API_KEY)}`); return { ok: r.ok, note: r.ok ? "key works" : `rejected (${r.status})` }; }));
  if (has(env, "RESEND_API_KEY")) out.push(await tryCall("Resend (email)", async () => {
    const r = await get("https://api.resend.com/domains", { Authorization: `Bearer ${env.RESEND_API_KEY}` });
    if (r.status === 401 || r.status === 403) return { ok: true, note: "key works for sending (it can't list domains, which is normal for a send-only key)" };
    if (!r.ok) return { ok: false, note: `rejected (${r.status})` };
    const d = (await r.json()).data || [];
    const from = (String(env.OUTREACH_FROM || "").match(/@([a-z0-9.-]+)/i) || [])[1]?.toLowerCase() || "";
    const mine = d.find((x) => from && (from === x.name || from.endsWith(`.${x.name}`)));
    return from ? { ok: !!mine && mine.status === "verified", note: mine ? `${mine.name} is ${mine.status}` : `${from} isn't added in Resend yet` } : { ok: true, note: `key works; ${d.length} domain(s) added` };
  }));
  if (has(env, "STRIPE_SECRET_KEY")) out.push(await tryCall("Stripe", async () => { const r = await get("https://api.stripe.com/v1/balance", { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }); const live = String(env.STRIPE_SECRET_KEY).startsWith("sk_live") || String(env.STRIPE_SECRET_KEY).startsWith("rk_live"); return { ok: r.ok, note: r.ok ? (live ? "key works, LIVE mode (real money)" : "key works, TEST mode (no real money yet)") : `rejected (${r.status})` }; }));
  if (has(env, "GH_DISPATCH_TOKEN")) out.push(await tryCall("GitHub (video rendering)", async () => { const r = await get(`https://api.github.com/repos/${env.GH_REPO || "qazyfaxy-sketch/vantryai-site"}`, { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, "User-Agent": "vantry-engine" }); return { ok: r.ok, note: r.ok ? "token can see the repo" : `rejected (${r.status})` }; }));
  out.push(await tryCall("YouTube", async () => { const ch = await getChannel(env, env.VIDEO_CHANNEL || "main"); return { ok: !!ch, note: ch ? `connected: ${ch.title || "your channel"}` : "not connected yet (press Connect YouTube on the AI page)" }; }));
  out.push(...(await domainRows(env)));
  return out;
}

export async function sendTest(env) {
  const gate = sendGate(env);
  if (gate) throw new Error(`Can't send yet: ${gate}.`);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.OUTREACH_FROM, to: [env.OWNER_EMAIL], subject: "Vantry outreach test", text: `This is a test from your outreach address. If it landed in your inbox (not spam), sending works.\n\n${env.MAILING_ADDRESS}` }),
  });
  if (!r.ok) throw new Error(`Resend said ${r.status}: ${(await r.text()).slice(0, 160)}`);
}

const mark = (ok) => (ok === true ? "✅" : ok === false ? "❌" : "❔");

export async function checkAdmin(req, url, env, form, token) {
  const hid = `<input type="hidden" name="token" value="${esc(token)}">`;
  let live = null, flash = "";
  if (req.method === "POST") {
    const a = String(form.get("action") || "");
    if (a === "live") live = await liveRows(env);
    else if (a === "mail") {
      try { await sendTest(env); flash = `Sent a test to ${env.OWNER_EMAIL}. Check your inbox, and your spam folder.`; } catch (e) { flash = e.message; }
    }
  }
  const rows = configRows(env);
  const todo = rows.filter((r) => !r.ok);
  const body = `<main class="wide"><h1>Is everything set up?</h1>
${flash ? `<p class="card"><strong>${esc(flash)}</strong></p>` : ""}
<div class="card"><p><strong>${todo.length ? `${todo.length} thing${todo.length === 1 ? "" : "s"} still to set up.` : "Every setting is in."}</strong> This page never shows your secrets, only whether they're there.</p>
<table>${rows.map((r) => `<tr><td>${mark(r.ok)}</td><td><strong>${esc(r.name)}</strong>${r.ok ? "" : `<br><span class="small muted">${esc(r.unlocks)}</span><br><span class="small">Missing: ${esc(r.missing.join(", "))}. ${esc(r.todo)}</span>`}</td></tr>`).join("")}</table></div>
<div class="card"><h2>Test the real connections</h2><p class="muted small">Makes one tiny real call to each service (free or a fraction of a cent) and looks up the email records on your outreach domain. Nothing is changed.</p>
<form method="post" action="/admin/check" style="display:inline">${hid}<input type="hidden" name="action" value="live"><button class="jelly sm">Test my keys</button></form>
<form method="post" action="/admin/check" style="display:inline">${hid}<input type="hidden" name="action" value="mail"><button class="ghost sm">Email myself a test</button></form>
${live ? `<table style="margin-top:12px">${live.map((r) => `<tr><td>${mark(r.ok)}</td><td><strong>${esc(r.name)}</strong><br><span class="small muted">${esc(r.note)}</span></td></tr>`).join("")}</table>` : ""}</div>
<p><a href="/admin/audits?token=${encodeURIComponent(token)}">Back</a></p></main>
<style>table{border-collapse:collapse;width:100%}td{padding:8px;border-top:1px solid var(--line);vertical-align:top}</style>`;
  return html(page({ title: "Setup check", body }), 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
}
