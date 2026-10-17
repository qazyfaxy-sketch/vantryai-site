// HTML for client pages: the page body (used everywhere: WordPress, copy-paste, review) and the
// hosted "answers" hub on the client's own subdomain. Plain, fast, readable by AI crawlers:
// no scripts needed, real headings, structured data in the <head>.
import { esc } from "../lib/util.js";

const date = (ms) => new Date(ms || Date.now()).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function pageBody(co, p) {
  const parts = [`<p class="lead"><strong>${esc(p.intro)}</strong></p>`];
  if (p.kind === "compare" && p.rows?.length) {
    parts.push(`<table><thead><tr><th></th><th>${esc(co.name)}</th><th>${esc(p.rival)}</th></tr></thead><tbody>${p.rows.map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.a)}</td><td>${esc(r.b)}</td></tr>`).join("")}</tbody></table>`);
  }
  for (const s of p.sections || []) {
    parts.push(`<h2>${esc(s.h2)}</h2>`);
    for (const para of s.paragraphs) parts.push(`<p>${esc(para)}</p>`);
    if (s.bullets.length) parts.push(`<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`);
  }
  if (p.faq?.length) {
    parts.push(`<h2>Common questions</h2>`);
    for (const f of p.faq) parts.push(`<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`);
  }
  parts.push(`<p><em>${p.kind === "compare" ? `Based on each company's public website as of ${date(p.updatedAt || p.createdAt)}. Check their sites for current details and pricing.` : `Last updated ${date(p.updatedAt || p.createdAt)}.`}</em></p>`);
  return parts.join("\n");
}

const shell = ({ title, description, canonical, schema, body, co }) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">` : ""}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta property="og:title" content="${esc(title)}">${description ? `<meta property="og:description" content="${esc(description)}">` : ""}
${schema ? `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>` : ""}
<style>
:root{--ink:#16202f;--muted:#5b6475;--line:#e3e7ee;--accent:#2f5fd0;--bg:#fff;--soft:#f6f8fb}
@media (prefers-color-scheme:dark){:root{--ink:#e8ecf3;--muted:#a3abba;--line:#2a3140;--accent:#8fb0ff;--bg:#11151c;--soft:#181e28}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
header,main,footer{max-width:760px;margin:0 auto;padding:0 20px}header{display:flex;justify-content:space-between;align-items:center;padding-top:22px;padding-bottom:22px;border-bottom:1px solid var(--line);max-width:none}
header .in{max-width:760px;margin:0 auto;width:100%;padding:0 20px;display:flex;justify-content:space-between;align-items:center}
header a{color:var(--ink);text-decoration:none;font-weight:700}header .site{font-weight:500;color:var(--accent)}
h1{font-size:clamp(30px,5vw,42px);line-height:1.15;margin:44px 0 18px;letter-spacing:-.01em}h2{font-size:26px;line-height:1.25;margin:40px 0 10px}h3{font-size:19px;margin:26px 0 4px}
.lead{font-size:20px}a{color:var(--accent)}ul{padding-left:22px}li{margin:6px 0}
table{border-collapse:collapse;width:100%;margin:24px 0;font-size:16px}th,td{border:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top}thead th{background:var(--soft)}tbody th{width:28%;background:var(--soft);font-weight:600}
.list{list-style:none;padding:0}.list li{border-top:1px solid var(--line);padding:16px 0}.list a{font-weight:600;text-decoration:none;font-size:20px}.list p{margin:4px 0 0;color:var(--muted);font-size:16px}
footer{color:var(--muted);font-size:15px;padding-top:30px;padding-bottom:50px;border-top:1px solid var(--line);margin-top:60px}
@media (max-width:600px){body{font-size:17px}table{font-size:14px}th,td{padding:8px}}
</style></head><body>
<header><div class="in"><a href="/">${esc(co.name)} answers</a><a class="site" href="${esc(co.website)}">${esc(co.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a></div></header>
<main>${body}</main>
<footer>© ${new Date().getUTCFullYear()} ${esc(co.name)} · <a href="${esc(co.website)}">Visit ${esc(co.name)}</a></footer>
</body></html>`;

export function renderHubPage(co, p, live, schema, host) {
  const others = live.filter((x) => x.slug !== p.slug).slice(0, 6);
  const body = `<h1>${esc(p.title)}</h1>
${pageBody(co, p)}
<p><a href="${esc(co.website)}">Learn more on ${esc(co.name)}'s website</a></p>
${others.length ? `<h2>More answers</h2><ul class="list">${others.map((x) => `<li><a href="/${esc(x.slug)}">${esc(x.title)}</a></li>`).join("")}</ul>` : ""}`;
  return shell({ title: `${p.title} | ${co.name}`, description: p.metaDescription, canonical: `https://${host}/${p.slug}`, schema, body, co });
}

export function renderHubIndex(co, live, schema, host, notFound = false) {
  const body = `<h1>${notFound ? "That page isn't here" : `Answers from ${esc(co.name)}`}</h1>
<p class="lead">${notFound ? "It may have moved. Here's everything we've published:" : `Straight answers to the questions people ask before choosing ${esc(co.name)}.`}</p>
${live.length ? `<ul class="list">${live.map((x) => `<li><a href="/${esc(x.slug)}">${esc(x.title)}</a></li>`).join("")}</ul>` : "<p>New answers are on the way.</p>"}`;
  return shell({ title: notFound ? `Not found | ${co.name}` : `Answers | ${co.name}`, description: `Answers to common questions about ${co.name}.`, canonical: notFound ? null : `https://${host}/`, schema, body, co });
}
