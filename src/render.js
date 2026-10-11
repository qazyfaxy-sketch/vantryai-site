// Turns AI copy + owner info into a finished one-page site.
// Three looks: modern, editorial, minimal. Design is fixed; AI only fills words.

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const STYLES = {
  modern: {
    font: `'Inter', system-ui, sans-serif`,
    headFont: `'Inter', system-ui, sans-serif`,
    bg: "#F7F8F5", surface: "#FFFFFF", text: "#1C2420", muted: "#5B6660",
    brand: "#2F5D3A", brandText: "#FFFFFF", accent: "#E8772E", line: "#E3E7E1",
    heroBg: "linear-gradient(135deg,#1F3F28 0%,#2F5D3A 60%,#3E7449 100%)", heroText: "#FFFFFF",
  },
  editorial: {
    font: `'Inter', system-ui, sans-serif`,
    headFont: `'Fraunces', Georgia, serif`,
    bg: "#F6F1E8", surface: "#FFFDF8", text: "#2A241C", muted: "#6B6152",
    brand: "#3D5A3A", brandText: "#FFFFFF", accent: "#B8562B", line: "#E6DDCC",
    heroBg: "#F6F1E8", heroText: "#2A241C",
  },
  minimal: {
    font: `'Inter', system-ui, sans-serif`,
    headFont: `'Inter', system-ui, sans-serif`,
    bg: "#FFFFFF", surface: "#FAFAFA", text: "#111111", muted: "#5F6368",
    brand: "#111111", brandText: "#FFFFFF", accent: "#2F7D4F", line: "#EAEAEA",
    heroBg: "#FFFFFF", heroText: "#111111",
  },
};

// Color schemes. Each business gets one (picked from its name) so sites don't all look alike.
export const PALETTES = {
  forest:   { brand: "#2F5D3A", dark: "#1F3F28", accent: "#E8772E", tint: "#E7EFE4", leaf: ["#A9C79A", "#6E9A62", "#3E6B45"] },
  navy:     { brand: "#24456B", dark: "#162C47", accent: "#F2A33A", tint: "#E5ECF4", leaf: ["#9EC3A8", "#5E9373", "#2F5E4A"] },
  earth:    { brand: "#6B4A2E", dark: "#45301D", accent: "#D9893B", tint: "#F1E8DD", leaf: ["#C3C88E", "#8FA05E", "#5B7140"] },
  teal:     { brand: "#1F6B66", dark: "#124542", accent: "#F07A5A", tint: "#E0EFED", leaf: ["#9FD0C0", "#5FA391", "#2E6E62"] },
  charcoal: { brand: "#2B2F2C", dark: "#191C1A", accent: "#8DBB2F", tint: "#ECEEEA", leaf: ["#BFD88A", "#86AE4E", "#4F7A35"] },
  sage:     { brand: "#4F6F52", dark: "#334A36", accent: "#C9862E", tint: "#EDF1EA", leaf: ["#C9D9B8", "#93AF84", "#5E7E58"] },
};
const PALETTE_KEYS = Object.keys(PALETTES);
export function pickPalette(name = "") {
  let h = 0;
  for (const ch of String(name).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE_KEYS[h % PALETTE_KEYS.length];
}

// Decorative landscape for the top of the page, tinted to the color scheme.
function heroArt(p, onDark) {
  const [l1, l2, l3] = p.leaf;
  const sky = onDark ? "#FFFFFF14" : p.tint;
  return `<svg class="art" viewBox="0 0 520 420" aria-hidden="true" preserveAspectRatio="xMaxYMax meet">
  <circle cx="380" cy="120" r="70" fill="${sky}"/>
  <path d="M0 330 C120 270 230 300 330 260 C420 225 470 240 520 220 V420 H0Z" fill="${l1}" opacity="${onDark ? 0.55 : 0.9}"/>
  <path d="M60 420 C160 330 300 360 380 320 C440 290 490 300 520 290 V420Z" fill="${l2}" opacity="${onDark ? 0.75 : 1}"/>
  <path d="M250 420 C300 380 360 372 430 360 C470 353 500 356 520 352 V420Z" fill="${l3}"/>
  <path d="M180 420 C220 380 260 360 330 345" stroke="#F3EBD3" stroke-width="16" fill="none" stroke-linecap="round" opacity=".8"/>
  <g><rect x="402" y="200" width="7" height="120" rx="3" fill="${l3}"/><circle cx="405" cy="185" r="44" fill="${l2}"/><circle cx="388" cy="208" r="26" fill="${l1}" opacity=".85"/></g>
  <g><rect x="466" y="236" width="6" height="90" rx="3" fill="${l3}"/><circle cx="469" cy="225" r="32" fill="${l3}"/></g>
  <g><rect x="338" y="262" width="5" height="70" rx="2" fill="${l3}"/><circle cx="340" cy="252" r="24" fill="${l1}"/></g>
</svg>`;
}

// lead:   { endpoint, siteId } on a live site, so the quote form emails the owner.
// domain: the site's own domain, for search engines.
export function renderSite({ copy, input, style = "modern", previewBar = null, palette = null, lead = null, domain = null }) {
  const p = PALETTES[palette] || PALETTES[pickPalette(input.businessName)];
  const base = STYLES[style] || STYLES.modern;
  const s = { ...base, brand: p.brand, accent: style === "minimal" ? p.brand : p.accent };
  if (style === "modern") s.heroBg = `linear-gradient(135deg,${p.dark} 0%,${p.brand} 100%)`;
  if (style === "editorial") s.bg = "#F6F1E8";
  if (style === "minimal") s.bg = "#FFFFFF";
  const phone = esc(input.phone || "");
  const tel = phone.replace(/[^\d+]/g, "");

  const services = (copy.services || [])
    .map((x) => `<div class="card"><h3>${esc(x.name)}</h3><p>${esc(x.description)}</p></div>`)
    .join("");
  const areas = (copy.serviceAreas || []).map((a) => `<li>${esc(a)}</li>`).join("");
  const faqs = (copy.faqs || [])
    .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
    .join("");

  const bar = previewBar
    ? `<div class="pbar"><span class="ptext"><strong>This could be your website.</strong> <span class="pnote">Full refund before launch.</span></span>
         <a class="pbtn" href="${esc(previewBar.buyUrl)}">Make it live – $200</a></div>`
    : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(copy.seoTitle || input.businessName)}</title>
<meta name="description" content="${esc(copy.seoDescription || "")}">
${domain ? `<link rel="canonical" href="https://www.${esc(domain)}/">` : ""}
<meta property="og:title" content="${esc(copy.seoTitle || input.businessName)}">
<meta property="og:description" content="${esc(copy.seoDescription || "")}">
<meta property="og:type" content="website">
${previewBar ? '<meta name="robots" content="noindex">' : ""}
<script type="application/ld+json">${schema(copy, input, domain)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Fraunces:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{--bg:${s.bg};--surface:${s.surface};--text:${s.text};--muted:${s.muted};--brand:${s.brand};
--brandText:${s.brandText};--accent:${s.accent};--line:${s.line};--heroText:${s.heroText}}
*{box-sizing:border-box}body{margin:0;font-family:${s.font};color:var(--text);background:var(--bg);line-height:1.55}
h1,h2,h3{font-family:${s.headFont};line-height:1.15;margin:0 0 .5em}
a{color:inherit}.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
.pbar{position:sticky;top:0;z-index:10;display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap;
padding:10px 16px;background:#1E1B3A;color:#EDEBFF;font:600 14px/1.3 system-ui,sans-serif}
.ptext{text-align:center}.pnote{font-weight:400;opacity:.8}
.pbtn{position:relative;overflow:hidden;isolation:isolate;display:inline-flex;align-items:center;min-height:44px;padding:10px 24px;border-radius:999px;
background:linear-gradient(180deg,#7E6BFF 0%,#5D49F2 52%,#4733DA 100%);color:#fff;text-decoration:none;font:600 15px/1.2 system-ui,sans-serif;
text-shadow:0 1px 1px #24168A80;white-space:nowrap;box-shadow:inset 0 1px 0 #FFFFFFB8,inset 0 -4px 7px #2D1CB088,0 10px 22px -8px #7E6BFFCC,0 0 0 3px #B9B2F540;
transition:transform .18s,filter .18s}
.pbtn::before{content:'';position:absolute;inset:0 0 50% 0;border-radius:999px 999px 40% 40%/999px 999px 100% 100%;background:linear-gradient(#FFFFFF52,#FFFFFF0A 85%,#FFFFFF00);z-index:-1}
.pbtn:hover{transform:translateY(-1px);filter:brightness(1.07)}.pbtn:active{transform:scale(.97)}
.pbtn:focus-visible{outline:3px solid #B9B2F5;outline-offset:3px}
@media (prefers-reduced-motion:reduce){.pbtn:hover,.pbtn:active{transform:none}}
header{display:flex;justify-content:space-between;align-items:center;padding:18px 0}
.logo{font-weight:700;font-size:20px}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:700;
padding:14px 22px;border-radius:10px}
.btn.ghost{background:transparent;border:2px solid currentColor;color:inherit}
.hero{position:relative;overflow:hidden;background:${s.heroBg};color:var(--heroText);padding:72px 0 80px}
.hero .wrap{position:relative;z-index:1}
.art{position:absolute;right:0;bottom:0;width:min(46%,560px);height:auto;z-index:0;pointer-events:none}
.hero h1{font-size:clamp(32px,5vw,54px);max-width:16ch}
.hero p{font-size:19px;max-width:52ch;opacity:.92}
.ctas{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}
section{padding:64px 0}h2{font-size:clamp(26px,3.4vw,36px)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:16px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:22px}
.card h3{font-size:19px}.card p{margin:0;color:var(--muted)}
.about{max-width:62ch;font-size:18px}
.areas{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:16px 0 0}
.areas li{background:var(--surface);border:1px solid var(--line);padding:6px 12px;border-radius:999px}
details{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:10px}
summary{font-weight:600;cursor:pointer}.formmsg{margin:0;font-weight:600}details p{margin:.6em 0 0;color:var(--muted)}
.quote{background:var(--brand);color:var(--brandText);border-radius:18px;padding:36px}
form{display:grid;gap:12px;margin-top:16px;max-width:520px}
input,textarea{font:inherit;padding:12px 14px;border-radius:10px;border:1px solid var(--line);width:100%}
footer{padding:28px 0;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
.btn{white-space:nowrap}header{gap:12px}.logo{min-width:0}
@media (max-width:860px){.art{opacity:.35;width:70%}}
@media (max-width:640px){.pnote{display:block}.pbar{gap:8px}.hero{padding:8px 0 56px}section{padding:44px 0}.call .num{display:none}.call{padding:10px 16px}}
</style></head><body>
${bar}
<div class="hero">${heroArt(p, style === "modern")}<div class="wrap">
  <header><div class="logo">${esc(input.businessName)}</div>
  ${tel ? `<a class="btn ghost call" href="tel:${tel}">Call<span class="num"> ${phone}</span></a>` : ""}</header>
  <h1>${esc(copy.headline)}</h1>
  <p>${esc(copy.subheadline)}</p>
  <div class="ctas"><a class="btn" href="#quote">${esc(copy.ctaText || "Get a free quote")}</a>
  ${tel ? `<a class="btn ghost" href="sms:${tel}">Text us</a>` : ""}</div>
</div></div>

<section><div class="wrap"><h2>Services</h2><div class="grid">${services}</div></div></section>

<section><div class="wrap"><h2>About us</h2><p class="about">${esc(copy.about)}</p>
  ${areas ? `<h3 style="margin-top:28px">Areas we serve</h3><ul class="areas">${areas}</ul>` : ""}
</div></section>

<section><div class="wrap"><h2>Common questions</h2>${faqs}</div></section>

<section id="quote"><div class="wrap"><div class="quote">
  <h2>Get your free quote</h2><p>Tell us about your yard and we'll get back to you.</p>
  <form id="quote-form" data-endpoint="${lead ? esc(lead.endpoint) : ""}" data-site="${lead ? esc(lead.siteId) : ""}">
    <input name="name" placeholder="Your name" autocomplete="name" required maxlength="100">
    <input name="contact" placeholder="Phone or email" autocomplete="tel" required maxlength="120">
    <textarea name="details" rows="3" placeholder="What do you need done?" maxlength="2000"></textarea>
    <input name="company" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
    <button class="btn" type="submit">${esc(copy.ctaText || "Get a free quote")}</button>
    <p class="formmsg" role="status" aria-live="polite"></p>
  </form>
  <script>${formScript}</script>
</div></div></section>

<footer><div class="wrap">© ${new Date().getFullYear()} ${esc(input.businessName)}${phone ? " · " + phone : ""}</div></footer>
</body></html>`;
}

// Facts for Google about the business. Only what the owner gave us.
function schema(copy, input, domain) {
  const data = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: input.businessName,
    description: copy.seoDescription || copy.subheadline || undefined,
    telephone: input.phone || undefined,
    url: domain ? `https://www.${domain}/` : undefined,
    areaServed: (copy.serviceAreas && copy.serviceAreas.length ? copy.serviceAreas : [input.city]).filter(Boolean),
    address: input.city ? { "@type": "PostalAddress", addressLocality: String(input.city).split(",")[0].trim(), addressRegion: "OH", addressCountry: "US" } : undefined,
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

// Sends the quote form to Vantry, which emails the owner. On previews it explains instead.
const formScript = `(function(){var f=document.getElementById('quote-form');if(!f)return;var m=f.querySelector('.formmsg');
f.addEventListener('submit',function(e){e.preventDefault();var ep=f.dataset.endpoint;
if(!ep){m.textContent='This is a preview. Quote requests will reach you once your site is live.';return;}
var b=f.querySelector('button');b.disabled=true;m.textContent='Sending…';
var d={siteId:f.dataset.site,name:f.name.value,contact:f.contact.value,details:f.details.value,company:f.company.value};
fetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Error');return j;});})
.then(function(){f.reset();m.textContent='Thanks! We got your request and will get back to you soon.';})
.catch(function(err){m.textContent=err.message||'Something went wrong. Please call or text us instead.';})
.finally(function(){b.disabled=false;});});})();`;
