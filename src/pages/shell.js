// Shared look for Vantry's own pages (domain picker, thank-you, admin).
// Matches vantryai.com: blue/navy, Poppins headings, jelly buttons.
import { esc } from "../lib/util.js";

export function page({ title, body, script = "", noindex = true }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Vantry</title>
${noindex ? '<meta name="robots" content="noindex">' : ""}
<meta name="referrer" content="no-referrer">
<link rel="icon" type="image/png" sizes="32x32" href="https://vantryai.com/favicon-32.png"><link rel="apple-touch-icon" href="https://vantryai.com/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root{--navy:#141A3D;--indigo:#3B88DA;--pale:#F1F7FF;--ink:#1B1D33;--muted:#5D6080;--line:#D5DFED;--ok:#1F7A4D;--bad:#9B203F;--serif:'Poppins','Inter',Arial,sans-serif;--sans:'Inter',Arial,sans-serif}
*{box-sizing:border-box}html{background:#ECF3FF}body{margin:0;min-height:100vh;background:linear-gradient(160deg,#FBFCFF 0%,#ECF3FF 100%);color:var(--ink);font:16px/1.6 var(--sans)}
a{color:#2E6FC0;font-weight:600;text-decoration:none;border-radius:6px;transition:color .15s}a:hover{color:#1F4E9E;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:4px}
.back{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:8px 14px 8px 10px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--ink);font-size:14px}.back:hover{text-decoration:none;border-color:#9DBCE6;color:var(--ink)}.back svg{width:16px;height:16px}
.ghost:hover{text-decoration:none;border-color:#9DBCE6}.jelly:hover{text-decoration:none}
.top{border-bottom:1px solid #E4E8F3;background:#FBFCFFF0}
.top .in{width:min(1040px,calc(100% - 32px));margin:auto;display:flex;align-items:center;justify-content:space-between;min-height:68px;gap:16px}
.wordmark{font-size:26px;font-weight:700;letter-spacing:-1.5px;color:var(--navy);text-decoration:none}
.wordmark img{display:block;height:34px;width:auto}
.top small{color:var(--muted);font-size:13px}@media(max-width:560px){.top small span{display:none}}
main{width:min(760px,calc(100% - 32px));margin:0 auto;padding:44px 0 80px}
main.wide{width:min(1040px,calc(100% - 32px))}
h1{font-family:var(--serif);font-weight:700;font-size:clamp(32px,5vw,44px);line-height:1.08;letter-spacing:-.035em;margin:0 0 10px;text-wrap:balance}
h2{font-family:var(--serif);font-weight:600;font-size:21px;letter-spacing:-.02em;margin:0 0 6px}
.lede{color:var(--muted);margin:0 0 30px;font-size:17px}
.card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:clamp(18px,4vw,24px);margin-bottom:18px;box-shadow:0 12px 30px #222C5C0A}
.muted{color:var(--muted)}.small{font-size:13px}
.jelly{position:relative;isolation:isolate;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;min-height:56px;padding:14px 32px;border:0;border-radius:999px;background:linear-gradient(180deg,#6BACFF 0%,#4594F6 52%,#2F7DDE 100%);color:#fff;font:600 16px/1.2 var(--sans);text-decoration:none;text-shadow:0 1px 1px #13498D80;cursor:pointer;box-shadow:inset 0 1px 0 #FFFFFFB8,inset 0 -4px 7px #185FB488,0 12px 26px -8px #4594F6B3,0 0 0 4px #B0D1F738;transition:transform .18s,filter .18s}
.jelly::before{content:'';position:absolute;inset:0 0 50% 0;border-radius:999px 999px 40% 40%/999px 999px 100% 100%;background:linear-gradient(#FFFFFF52,#FFFFFF0A 85%,#FFFFFF00);z-index:-1;pointer-events:none}
.jelly:hover{transform:translateY(-2px);filter:brightness(1.06)}.jelly:active{transform:scale(.97)}
.jelly:disabled{opacity:.6;cursor:wait;transform:none}
.jelly.block{display:flex;width:100%}
.jelly.sm{min-height:40px;padding:8px 18px;font-size:14px}
.ghost{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 16px;font:600 14px var(--sans);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;min-height:40px}
input[type=text],input[type=search]{width:100%;min-height:50px;border:1px solid #B9C3D1;border-radius:12px;padding:12px 14px;font:16px var(--sans);background:#fff;color:var(--ink)}
:focus-visible{outline:3px solid var(--indigo);outline-offset:3px}
.alert{border:1px solid #E4B3C0;background:#FFF1F4;color:#84213C;border-radius:12px;padding:12px 14px;font-size:14px}
.ok{color:var(--ok)}.bad{color:var(--bad)}
@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body>
<header class="top"><div class="in"><a class="wordmark" href="https://vantryai.com" aria-label="Vantry home"><img src="https://vantryai.com/logo.png" srcset="https://vantryai.com/logo@2x.png 2x" alt="Vantry" height="34"></a><small><span>Questions? </span><a href="mailto:booking@vantryai.com">booking@vantryai.com</a></small></div></header>
${body}
${script ? `<script>${script}</script>` : ""}
</body></html>`;
}

// Shown on a customer's domain before launch, or after a site is taken offline.
export function placeholder({ title, message }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#F4F8FF;color:#1B1D33;font:17px/1.6 -apple-system,Segoe UI,Arial,sans-serif;text-align:center}
h1{font:400 36px/1.15 Georgia,serif;margin:0 0 10px}p{margin:0;color:#5D6080}</style></head>
<body><div><h1>${esc(title)}</h1><p>${esc(message)}</p></div></body></html>`;
}
