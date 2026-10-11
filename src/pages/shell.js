// Shared look for Vantry's own pages (domain picker, thank-you, admin).
// Matches vantryai.com: lavender/navy, Fraunces headings, jelly buttons.
import { esc } from "../lib/util.js";

export function page({ title, body, script = "", noindex = true }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Vantry</title>
${noindex ? '<meta name="robots" content="noindex">' : ""}
<meta name="referrer" content="no-referrer">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='18' fill='%234B3FD6'/%3E%3Ctext x='32' y='45' text-anchor='middle' font-family='Georgia' font-size='49' fill='white'%3Ev%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--navy:#141A3D;--indigo:#4B3FD6;--pale:#F3F1FF;--ink:#1B1D33;--muted:#5D6080;--line:#D9D6EC;--ok:#1F7A4D;--bad:#9B203F;--serif:'Fraunces',Georgia,serif;--sans:'Inter',Arial,sans-serif}
*{box-sizing:border-box}html{background:#F0ECFF}body{margin:0;min-height:100vh;background:linear-gradient(160deg,#FCFBFF 0%,#F0ECFF 100%);color:var(--ink);font:16px/1.6 var(--sans)}
a{color:var(--indigo)}
.top{border-bottom:1px solid #E8E4F3;background:#FCFBFFF0}
.top .in{width:min(1040px,calc(100% - 32px));margin:auto;display:flex;align-items:center;justify-content:space-between;min-height:68px;gap:16px}
.wordmark{font-size:26px;font-weight:700;letter-spacing:-1.5px;color:var(--navy);text-decoration:none}
.wordmark::after{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--indigo);margin-left:3px}
.top small{color:var(--muted);font-size:13px}
main{width:min(760px,calc(100% - 32px));margin:0 auto;padding:44px 0 80px}
main.wide{width:min(1040px,calc(100% - 32px))}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(32px,5vw,44px);line-height:1.12;letter-spacing:-1.2px;margin:0 0 10px;text-wrap:balance}
h2{font-family:var(--serif);font-weight:500;font-size:22px;letter-spacing:-.3px;margin:0 0 6px}
.lede{color:var(--muted);margin:0 0 30px;font-size:17px}
.card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:clamp(18px,4vw,24px);margin-bottom:18px;box-shadow:0 12px 30px #39235B0A}
.muted{color:var(--muted)}.small{font-size:13px}
.jelly{position:relative;isolation:isolate;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;min-height:56px;padding:14px 32px;border:0;border-radius:999px;background:linear-gradient(180deg,#7E6BFF 0%,#5D49F2 52%,#4733DA 100%);color:#fff;font:600 16px/1.2 var(--sans);text-decoration:none;text-shadow:0 1px 1px #24168A80;cursor:pointer;box-shadow:inset 0 1px 0 #FFFFFFB8,inset 0 -4px 7px #2D1CB088,0 12px 26px -8px #5D49F2B3,0 0 0 4px #B9B2F538;transition:transform .18s,filter .18s}
.jelly::before{content:'';position:absolute;inset:0 0 50% 0;border-radius:999px 999px 40% 40%/999px 999px 100% 100%;background:linear-gradient(#FFFFFF52,#FFFFFF0A 85%,#FFFFFF00);z-index:-1;pointer-events:none}
.jelly:hover{transform:translateY(-2px);filter:brightness(1.06)}.jelly:active{transform:scale(.97)}
.jelly:disabled{opacity:.6;cursor:wait;transform:none}
.jelly.block{display:flex;width:100%}
.jelly.sm{min-height:40px;padding:8px 18px;font-size:14px}
.ghost{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 16px;font:600 14px var(--sans);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;min-height:40px}
input[type=text],input[type=search]{width:100%;min-height:50px;border:1px solid #BDBAD0;border-radius:12px;padding:12px 14px;font:16px var(--sans);background:#fff;color:var(--ink)}
:focus-visible{outline:3px solid var(--indigo);outline-offset:3px}
.alert{border:1px solid #E4B3C0;background:#FFF1F4;color:#84213C;border-radius:12px;padding:12px 14px;font-size:14px}
.ok{color:var(--ok)}.bad{color:var(--bad)}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body>
<header class="top"><div class="in"><a class="wordmark" href="https://vantryai.com" aria-label="Vantry home">vantry</a><small>Questions? <a href="mailto:booking@vantryai.com">booking@vantryai.com</a></small></div></header>
${body}
${script ? `<script>${script}</script>` : ""}
</body></html>`;
}

// Shown on a customer's domain before launch, or after a site is taken offline.
export function placeholder({ title, message }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#F6F4FF;color:#1B1D33;font:17px/1.6 -apple-system,Segoe UI,Arial,sans-serif;text-align:center}
h1{font:400 36px/1.15 Georgia,serif;margin:0 0 10px}p{margin:0;color:#5D6080}</style></head>
<body><div><h1>${esc(title)}</h1><p>${esc(message)}</p></div></body></html>`;
}
