// The client dashboard: one private page per client that shows, with dates, what AI said before and
// what it says now, and everything we did. No login to forget: the link is signed and sent in every
// report email. Nothing here is estimated: every number is a count of real, saved answers.
//
// Routes:
//   GET /d/:clientId?k=   the dashboard (signed link)
import { html, httpError, safeEqual, esc } from "./util.js";
import { getAudit, ENGINES } from "./aiscan.js";
import { companyOfClient } from "./video.js";
import { hmac } from "./listings.js";
import { page } from "../pages/shell.js";

const api = (env) => env.PUBLIC_API || "https://api.vantryai.com";
export const isDashPath = (p) => /^\/d\/c[a-z0-9]{11}$/.test(p);
export const dashUrl = async (env, id) => `${api(env)}/d/${id}?k=${await hmac(env, `dash:${id}`)}`;

const dateOf = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const eng = (e) => ENGINES[e]?.label || e;
const rk = (r) => `${r.engine}|${r.q}`;

// Per-question view: was the brand named at the start, and is it named now?
export function beforeAfter(first, last) {
  const then = new Map((first?.results || []).filter((r) => !r.error).map((r) => [rk(r), !!r.mentioned]));
  const rows = (last?.results || []).filter((r) => !r.error).map((r) => ({ q: r.q, engine: r.engine, then: then.has(rk(r)) ? then.get(rk(r)) : null, now: !!r.mentioned }));
  rows.sort((a, b) => (b.now && b.then === false) - (a.now && a.then === false) || (b.now - a.now));
  return rows;
}

function chart(points) {
  if (points.length < 2) return "";
  const W = 560, H = 150, pad = 28, bw = Math.min(56, (W - pad * 2) / points.length - 10);
  const step = (W - pad * 2) / points.length;
  const bars = points.map((p, i) => {
    const h = p.total ? Math.round(((H - 50) * p.mentioned) / p.total) : 0;
    const x = pad + i * step + (step - bw) / 2;
    return `<rect x="${x}" y="${H - 28 - h}" width="${bw}" height="${Math.max(h, 2)}" rx="6" fill="currentColor" opacity=".85"/><text x="${x + bw / 2}" y="${H - 32 - h}" text-anchor="middle" font-size="12" fill="currentColor">${p.mentioned}/${p.total}</text><text x="${x + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#6b7280">${esc(p.label)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Answers that named you, by report" style="width:100%;max-width:560px;color:#3B88DA">${bars}</svg>`;
}

async function dashboard(env, c) {
  const co = companyOfClient(c);
  const entries = (c.audits || []).slice(-8);
  const first = entries[0] ? await getAudit(env, (c.audits.find((a) => a.kind === "baseline") || c.audits[0]).id) : null;
  const last = entries.length ? await getAudit(env, entries[entries.length - 1].id) : null;
  const rows = last && first ? beforeAfter(first, last) : [];
  const gained = rows.filter((r) => r.now && r.then === false).length;
  const lost = rows.filter((r) => !r.now && r.then === true).length;
  const points = entries.map((a) => ({ mentioned: a.mentioned, total: a.total, label: new Date(a.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) }));
  const livePages = (c.pages || []).filter((p) => p.status === "live" && p.url);
  const liveVideos = (c.videos || []).filter((v) => v.status === "live" && v.youtubeId);
  const lrows = c.listings?.batches || [];
  const listed = lrows.reduce((n, r) => n + (r.live || 0), 0);
  const listTodo = lrows.reduce((n, r) => n + (r.todo || 0) + (r.submitted || 0), 0);
  const posted = (c.reddit?.rows || []).filter((r) => r.status === "posted").length;
  const redditOpen = (c.reddit?.rows || []).filter((r) => r.status === "open").length;
  const sent = (c.outreach?.rows || []).filter((r) => r.status === "sent" || r.status === "replied").length;
  const latest = entries[entries.length - 1];
  const k = await hmac(env, `dash:${c.id}`);
  const body = `<main class="wide">
<p class="muted small">${esc(co.name)}</p>
<h1>Where AI stands on ${esc(co.name)}</h1>
${latest ? `<p class="lede">In our latest check (${dateOf(latest.at)}), AI named ${esc(co.name)} in <strong>${latest.mentioned} of ${latest.total}</strong> answers to your buyers' questions.${entries.length > 1 && first ? ` At the start it was ${entries[0].mentioned} of ${entries[0].total}.` : ""}</p>` : `<p class="lede">Your first report is on its way. It will show up here.</p>`}
${points.length > 1 ? `<div class="card"><h2>Answers that named you, by report</h2>${chart(points)}</div>` : ""}
<div class="card"><p class="small muted" style="margin:0">AI answers change from one run to the next, so one report can move up or down by chance. We ask the same questions each month and show every answer. We can't control what AI says, and we never promise a result.</p></div>
${rows.length ? `<div class="card"><h2>Then and now, question by question</h2>
<p class="muted small">${gained} newly named · ${lost} no longer named · compared with your starting report (${first ? dateOf(first.createdAt) : ""}) and your latest (${latest ? dateOf(latest.at) : ""}).</p>
<table style="width:100%;border-collapse:collapse;font-size:14px"><tr><th style="text-align:left;padding:8px">Question</th><th style="padding:8px">AI</th><th style="padding:8px">Then</th><th style="padding:8px">Now</th></tr>${rows.slice(0, 40).map((r) => `<tr style="border-top:1px solid var(--line)"><td style="padding:8px">${esc(r.q)}</td><td style="padding:8px;text-align:center">${esc(eng(r.engine))}</td><td style="padding:8px;text-align:center">${r.then === null ? "n/a" : r.then ? "Named" : "No"}</td><td style="padding:8px;text-align:center"><strong>${r.now ? "Named" : "No"}</strong></td></tr>`).join("")}</table>
<p class="small" style="margin-top:12px"><a href="${api(env)}/r/${esc(latest.id)}" target="_blank" rel="noopener">Open the full latest report, with every answer</a></p></div>` : ""}
<div class="card"><h2>What we've done for you</h2>
<ul>
<li><strong>${livePages.length}</strong> page${livePages.length === 1 ? "" : "s"} on your site${livePages.length ? `: ${livePages.slice(-5).map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title || p.url)}</a>`).join(", ")}` : ""}</li>
<li><strong>${liveVideos.length}</strong> video${liveVideos.length === 1 ? "" : "s"} on YouTube${liveVideos.length ? `: ${liveVideos.slice(-4).map((v) => `<a href="https://youtu.be/${esc(v.youtubeId)}" target="_blank" rel="noopener">${esc(v.title || "Watch")}</a>`).join(", ")}` : ""}</li>
<li><strong>${listed}</strong> listing${listed === 1 ? "" : "s"} live on review sites and directories${listTodo ? ` · <a href="${api(env)}/listings/${esc(c.id)}">${listTodo} still to do</a>` : lrows.length ? ` · <a href="${api(env)}/listings/${esc(c.id)}">see your kit</a>` : ""}</li>
<li><strong>${sent}</strong> note${sent === 1 ? "" : "s"} sent to writers of articles AI cites</li>
<li><strong>${posted}</strong> Reddit answer${posted === 1 ? "" : "s"} posted${redditOpen ? ` · <a href="${api(env)}/reddit/${esc(c.id)}">${redditOpen} waiting for you</a>` : ""}</li>
</ul>
<p class="muted small">Pages, videos, listings and notes are done by plan. Reddit answers and listings are posted by you, from your own accounts.</p></div>
<p class="muted small">Questions? Reply to any email from us. This link is private to you: please don't share it.</p>
</main>`;
  return html(page({ title: `${co.name}: AI visibility`, body }), 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" });
}

export async function dashRoute(req, url, env, { getClient }) {
  const m = url.pathname.match(/^\/d\/(c[a-z0-9]{11})$/);
  if (!m || req.method !== "GET") throw httpError(404, "Page not found.");
  if (!safeEqual(url.searchParams.get("k") || "", await hmac(env, `dash:${m[1]}`))) throw httpError(404, "Page not found.");
  const c = await getClient(env, m[1]);
  if (!c || c.status === "canceled") throw httpError(404, "We couldn't find that. Check your email for the right link.");
  return await dashboard(env, c);
}

export async function dashCard(env, clients) {
  const list = clients.filter((c) => c.status === "active" && (c.audits || []).length);
  const links = await Promise.all(list.map((c) => dashUrl(env, c.id)));
  return list.length ? `<div class="card"><h2>Client dashboards</h2><table><tr><th>Client</th><th>Link</th></tr>${list.map((c, i) => `<tr><td>${esc(c.onboarding?.business || c.email)}</td><td><a href="${esc(links[i])}" target="_blank" rel="noopener">Open dashboard</a></td></tr>`).join("")}</table></div>` : "";
}
