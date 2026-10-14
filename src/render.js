// Turns AI copy + owner info into a finished one-page site.
// Every business category has its own look (colors, fonts, photos). The customer picks one of
// three layouts: "modern" (full photo), "editorial" (split) or "minimal" (light, framed photo).
// The design is fixed code; the AI only writes the words, so every site comes out polished.
import { categoryOf } from "./prompt.js";

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// font: serif (elegant), condensed (bold, loud), sans (clean, modern), script (expressive)
// dark: the whole page is dark. Colors are checked for readable contrast.
export const LOOKS = {
  landscaping:  { name: "Forest",    font: "serif",     bg: "#F4F1EA", surface: "#FFFFFF", ink: "#1E2420", muted: "#5B625C", line: "#E2DDD2", brand: "#2D3E2F", accent: "#2D3E2F", accentInk: "#F4F1EA", heroBg: "#1F2B22", heroInk: "#F5F1E6" },
  homeServices: { name: "Slate",     font: "serif",     bg: "#F3F2EF", surface: "#FFFFFF", ink: "#1B1F24", muted: "#5A6068", line: "#DFDDD8", brand: "#24313D", accent: "#24313D", accentInk: "#FFFFFF", heroBg: "#1C252E", heroInk: "#F3F1EC" },
  cleaning:     { name: "Fresh",     font: "serif",     bg: "#F5FAF8", surface: "#FFFFFF", ink: "#1D2D2A", muted: "#56685F", line: "#DCE9E4", brand: "#13806F", accent: "#13806F", accentInk: "#FFFFFF", heroBg: "#EAF4F0", heroInk: "#1D2D2A" },
  beauty:       { name: "Blush",     font: "serif",     bg: "#F7EEE7", surface: "#FFFBF8", ink: "#3A2A24", muted: "#7A6258", line: "#EBDBD0", brand: "#5A3A2E", accent: "#3A2A24", accentInk: "#F7EEE7", heroBg: "#EBD6C7", heroInk: "#3A2A24" },
  food:         { name: "Wine",      font: "serif",     bg: "#FBF5EE", surface: "#FFFFFF", ink: "#2B1A17", muted: "#6E5650", line: "#EEDFD3", brand: "#6B1E24", accent: "#6B1E24", accentInk: "#FBEFE2", heroBg: "#521619", heroInk: "#F8EADB" },
  health:       { name: "Sage",      font: "serif",     bg: "#F3F6F1", surface: "#FFFFFF", ink: "#22302A", muted: "#59675F", line: "#DDE5DA", brand: "#3B5C45", accent: "#3B5C45", accentInk: "#FFFFFF", heroBg: "#E5EBE0", heroInk: "#22302A" },
  fitness:      { name: "Volt",      font: "condensed", dark: true, bg: "#0F100E", surface: "#191A17", ink: "#F2F2EE", muted: "#A6A99F", line: "#2A2B27", brand: "#D9FF3F", accent: "#D9FF3F", accentInk: "#0F100E", heroBg: "#0F100E", heroInk: "#FFFFFF" },
  professional: { name: "Ink",       font: "serif",     bg: "#F5F3EF", surface: "#FFFFFF", ink: "#151515", muted: "#5F5D59", line: "#E2DED7", brand: "#151515", accent: "#151515", accentInk: "#FFFFFF", heroBg: "#ECE8E1", heroInk: "#151515" },
  creative:     { name: "Studio",    font: "condensed", bg: "#FFFFFF", surface: "#F5F5F3", ink: "#111111", muted: "#5C5C5C", line: "#E6E6E3", brand: "#1F47FF", accent: "#111111", accentInk: "#FFFFFF", heroBg: "#FFFFFF", heroInk: "#111111" },
  retail:       { name: "Peach",     font: "serif",     bg: "#FBF3EC", surface: "#FFFFFF", ink: "#3A2A22", muted: "#76604F", line: "#EFDFD2", brand: "#B5563A", accent: "#B5563A", accentInk: "#FFFFFF", heroBg: "#F4E1D3", heroInk: "#3A2A22" },
  education:    { name: "Bright",    font: "sans",      bg: "#FFFFFF", surface: "#F5F7FF", ink: "#141B3A", muted: "#565D7A", line: "#E3E7F5", brand: "#1E4FE0", accent: "#1E4FE0", accentInk: "#FFFFFF", heroBg: "#F2F5FF", heroInk: "#1E4FE0", pop: "#FFD93D" },
  pets:         { name: "Rust",      font: "serif",     bg: "#FBF4EC", surface: "#FFFFFF", ink: "#3A2116", muted: "#77584A", line: "#EEDDCF", brand: "#9E4B28", accent: "#9E4B28", accentInk: "#FFF4E8", heroBg: "#9E4B28", heroInk: "#FFF4E8" },
  realEstate:   { name: "Coast",     font: "serif",     bg: "#F4F5F3", surface: "#FFFFFF", ink: "#1C2226", muted: "#596168", line: "#DFE2E0", brand: "#2C4350", accent: "#2C4350", accentInk: "#FFFFFF", heroBg: "#253944", heroInk: "#F4F5F3" },
  events:       { name: "Champagne", font: "serif",     bg: "#FAF6EF", surface: "#FFFFFF", ink: "#3B3128", muted: "#76695C", line: "#EDE3D5", brand: "#86663D", accent: "#3B3128", accentInk: "#FAF6EF", heroBg: "#F1E9DC", heroInk: "#3B3128" },
  auto:         { name: "Carbon",    font: "serif",     dark: true, bg: "#111214", surface: "#1A1B1E", ink: "#F1F1F1", muted: "#A0A4AA", line: "#2B2D31", brand: "#E8E8E8", accent: "#F1F1F1", accentInk: "#111214", heroBg: "#111214", heroInk: "#FFFFFF" },
  travel:       { name: "Lagoon",    font: "serif",     bg: "#F2F8F8", surface: "#FFFFFF", ink: "#123137", muted: "#52696D", line: "#D8E7E8", brand: "#0E6670", accent: "#0E6670", accentInk: "#FFFFFF", heroBg: "#0E5159", heroInk: "#FFFFFF" },
  tech:         { name: "Nebula",    font: "sans",      dark: true, bg: "#0B1030", surface: "#121A44", ink: "#EEF0FF", muted: "#A9AFD8", line: "#222B5C", brand: "#8C7DFF", accent: "#6A57F5", accentInk: "#FFFFFF", heroBg: "#0B1030", heroInk: "#FFFFFF" },
  industrial:   { name: "Forge",     font: "sans",      dark: true, bg: "#141414", surface: "#1E1E1E", ink: "#EFEFEF", muted: "#A3A3A3", line: "#2C2C2C", brand: "#F28C28", accent: "#F28C28", accentInk: "#141414", heroBg: "#141414", heroInk: "#FFFFFF" },
  agriculture:  { name: "Meadow",    font: "serif",     bg: "#F5F2E8", surface: "#FFFFFF", ink: "#232B1D", muted: "#5E6650", line: "#E3DECB", brand: "#465A2C", accent: "#465A2C", accentInk: "#F7F2E2", heroBg: "#2F3D1F", heroInk: "#F7F2E2" },
  family:       { name: "Honey",     font: "serif",     bg: "#FBF5EE", surface: "#FFFFFF", ink: "#3A2A20", muted: "#76604F", line: "#EFE2D3", brand: "#B8602A", accent: "#F0A35E", accentInk: "#3A2A20", heroBg: "#F5E8D8", heroInk: "#3A2A20" },
  nonprofit:    { name: "Common",    font: "serif",     bg: "#F5F7F2", surface: "#FFFFFF", ink: "#18332C", muted: "#526760", line: "#DCE4DC", brand: "#1F5A4B", accent: "#F6D33C", accentInk: "#18332C", heroBg: "#1F5A4B", heroInk: "#FFFFFF" },
  entertainment:{ name: "Stage",     font: "script",    dark: true, bg: "#140B0C", surface: "#1F1314", ink: "#F6EDEA", muted: "#BBA8A4", line: "#33201F", brand: "#F0454C", accent: "#D92F37", accentInk: "#FFFFFF", heroBg: "#140B0C", heroInk: "#FFFFFF" },
  personal:     { name: "Linen",     font: "serif",     bg: "#EFE7DC", surface: "#F8F3EC", ink: "#2E2620", muted: "#6D6055", line: "#DDD1C2", brand: "#5E4C3D", accent: "#2E2620", accentInk: "#EFE7DC", heroBg: "#E5DACB", heroInk: "#2E2620" },
  repair:       { name: "Brass",     font: "serif",     dark: true, bg: "#181613", surface: "#221F1B", ink: "#F3EEE6", muted: "#AEA69B", line: "#34302A", brand: "#E9792F", accent: "#E9792F", accentInk: "#181613", heroBg: "#181613", heroInk: "#FFFFFF" },
  science:      { name: "Tide",      font: "serif",     bg: "#F1F7F6", surface: "#FFFFFF", ink: "#0F2E2D", muted: "#4F6766", line: "#D6E5E3", brand: "#0F3B3A", accent: "#0F3B3A", accentInk: "#EAF7F6", heroBg: "#0F3B3A", heroInk: "#EAF7F6", pop: "#9BE7E3" },
  general:      { name: "Harbor",    font: "serif",     bg: "#F6F7F9", surface: "#FFFFFF", ink: "#141A24", muted: "#59606B", line: "#E1E4EA", brand: "#2B579E", accent: "#2B579E", accentInk: "#FFFFFF", heroBg: "#E8EDF5", heroInk: "#141A24" },
};

// The color choices shown in the editor (any look works for any business).
export const PALETTES = Object.fromEntries(Object.entries(LOOKS).map(([k, l]) => [k, { name: l.name, dark: l.heroBg, brand: l.brand, accent: l.accent }]));
export const lookFor = (trade, palette) => LOOKS[palette] || LOOKS[categoryOf(trade)] || LOOKS.general;
// Kept for older code: the recommended look's key for a business.
export const pickPalette = (_name, trade = "") => categoryOf(trade);

// Photos for each category, used until the owner uploads their own.
// Add a category here once vantryai.com/stock/<category>-1.jpg (top) and -2.jpg (about) exist.
// media.stock is the set of categories whose AI photos are ready (served at /stock/<category>-<n>.jpg).

const FONTS = {
  serif: { head: `'Fraunces', Georgia, serif`, weight: 400, track: "-0.025em", caps: false },
  condensed: { head: `'Anton', 'Arial Narrow', Impact, sans-serif`, weight: 400, track: "0", caps: true },
  sans: { head: `'Manrope', 'Inter', system-ui, sans-serif`, weight: 700, track: "-0.035em", caps: false },
  script: { head: `'Playfair Display', Georgia, serif`, weight: 700, track: "-0.01em", caps: false, italic: true },
};
const FONT_LINK = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Fraunces:opsz,wght@9..144,300..600&family=Anton&family=Manrope:wght@600;700;800&family=Playfair+Display:ital,wght@1,600;1,700&display=swap";

// The page sections, in their default order. Owners can hide and reorder them in their account.
export const SECTIONS = [
  ["services", "Services"],
  ["gallery", "Photos"],
  ["about", "About"],
  ["hours", "Hours"],
  ["faq", "Common questions"],
  ["quote", "Contact form"],
];
export const DEFAULT_ORDER = SECTIONS.map(([k]) => k);

export function sectionList(saved) {
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(saved) ? saved : []) {
    if (DEFAULT_ORDER.includes(x?.id) && !seen.has(x.id)) {
      seen.add(x.id);
      out.push({ id: x.id, show: x.show !== false });
    }
  }
  for (const id of DEFAULT_ORDER) if (!seen.has(id)) out.push({ id, show: true });
  return out;
}

// lead:   { endpoint, siteId } on a live site, so the quote form emails the owner.
// domain: the site's own domain, for search engines.
// media:  { siteId, photos: [id], logo, heroPhoto, sections, imgBase } from the owner's account.
export function renderSite({ copy, input, style = "modern", previewBar = null, palette = null, lead = null, domain = null, media = null }) {
  const m = media || {};
  const cat = categoryOf(input.trade);
  const L = lookFor(input.trade, palette);
  const F = FONTS[L.font] || FONTS.serif;
  const layout = ["modern", "editorial", "minimal"].includes(style) ? style : "modern";
  const imgBase = m.imgBase || "https://api.vantryai.com";
  const img = (id) => `${imgBase}/img/${esc(m.siteId)}/${esc(id)}`;
  const photos = (m.photos || []).filter(Boolean);
  const ownHero = m.heroPhoto && photos.includes(m.heroPhoto) ? m.heroPhoto : null;
  const stock = (n) => (m.stock && m.stock.has && m.stock.has(cat) ? `${imgBase}/stock/${cat}-${n}.jpg` : null);
  const heroSrc = ownHero ? img(ownHero) : stock(1);
  const aboutOwn = photos.find((p) => p !== ownHero);
  const aboutSrc = aboutOwn ? img(aboutOwn) : stock(2);
  const hours = (copy.hours || []).filter(Boolean);
  const phone = esc(input.phone || "");
  const tel = phone.replace(/[^\d+]/g, "");
  const city = esc(String(input.city || "").split(",")[0].trim());
  const name = esc(input.businessName);
  const cta = esc(copy.ctaText || "Get in touch");
  const services = copy.services || [];
  const areas = copy.serviceAreas || [];
  const faqs = copy.faqs || [];

  // Facts strip: only things the owner gave us.
  const facts = [
    city && `<li><span>Based in</span>${city}</li>`,
    phone && `<li><span>Call or text</span><a href="tel:${tel}">${phone}</a></li>`,
    hours[0] && `<li><span>Hours</span>${esc(hours[0])}</li>`,
    areas.length > 1 && `<li><span>Serving</span>${esc(areas.slice(0, 3).join(", "))}${areas.length > 3 ? " and nearby" : ""}</li>`,
  ].filter(Boolean).slice(0, 3);

  const art = `<div class="art" aria-hidden="true"><i></i><i></i><i></i></div>`;
  const heroMedia = heroSrc ? `<img class="hero-img" src="${heroSrc}" alt="" fetchpriority="high">` : art;
  const ctas = `<div class="ctas"><a class="btn" href="#contact">${cta}</a>${tel ? `<a class="btn line" href="tel:${tel}">Call ${phone}</a>` : ""}</div>`;
  const eyebrow = copy.serviceAreas?.length || city ? `<p class="eyebrow">${esc((services[0]?.name ? services.slice(0, 2).map((s) => s.name).join(" · ") : "") || city)}</p>` : "";

  const nav = `<nav class="nav"><div class="wrap nav-in">
  <a class="brand" href="#top">${m.logo ? `<img class="logo-img" src="${img(m.logo)}" alt="${name}">` : name}</a>
  <div class="nav-links"><a href="#services">Services</a><a href="#about">About</a><a href="#contact">Contact</a></div>
  ${tel ? `<a class="nav-call" href="tel:${tel}" aria-label="Call ${phone}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" fill="currentColor"/></svg><span>${phone}</span></a>` : `<a class="btn sm" href="#contact">${cta}</a>`}
</div></nav>`;

  const heroText = `${eyebrow}<h1>${esc(copy.headline)}</h1><p class="lede">${esc(copy.subheadline)}</p>${ctas}`;
  const hero = `<header class="hero${ownHero ? " has-photo" : ""}" id="top" data-layout="${layout}"${heroSrc ? " data-img" : ""}>${nav}
${layout === "minimal"
    ? `<div class="wrap hero-in">${heroText}</div>${heroSrc ? `<div class="wrap"><div class="hero-frame">${heroMedia}</div></div>` : ""}`
    : layout === "editorial"
      ? `<div class="hero-grid"><div class="hero-copy"><div class="hero-in">${heroText}</div></div><div class="hero-side">${heroMedia}</div></div>`
      : `<div class="hero-bg">${heroMedia}</div><div class="wrap hero-in">${heroText}</div>`}
${facts.length ? `<div class="wrap"><ul class="facts">${facts.join("")}</ul></div>` : ""}
</header>`;

  const blocks = {
    services: services.length ? `<section id="services"><div class="wrap">
  <div class="sec-head"><h2>What we do</h2>${areas.length ? `<p>Serving ${esc(areas.slice(0, 4).join(", "))}.</p>` : ""}</div>
  <div class="svc">${services.map((s) => `<article><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p></article>`).join("")}</div>
  <a class="btn" href="#contact">${cta}</a>
</div></section>` : "",
    gallery: photos.length ? `<section id="photos"><div class="wrap"><div class="sec-head"><h2>Our work</h2></div>
  <div class="gallery">${photos.map((id) => `<img src="${img(id)}" alt="" loading="lazy">`).join("")}</div></div></section>` : "",
    about: copy.about ? `<section id="about" class="about"><div class="wrap ${aboutSrc ? "about-grid" : "narrow"}">
  ${aboutSrc ? `<div class="about-media"><img src="${aboutSrc}" alt="" loading="lazy"></div>` : ""}
  <div><h2>About ${name}</h2><p class="about-text">${esc(copy.about)}</p>
  ${areas.length ? `<p class="small-h">Areas we serve</p><ul class="chips">${areas.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}</div>
</div></section>` : "",
    hours: hours.length ? `<section id="hours"><div class="wrap narrow"><div class="sec-head"><h2>Hours</h2></div><ul class="hours">${hours.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></div></section>` : "",
    faq: faqs.length ? `<section id="faq"><div class="wrap narrow"><div class="sec-head"><h2>Common questions</h2></div>
  ${faqs.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</div></section>` : "",
  };
  const quoteHtml = `<section id="quote"><div class="wrap"><div class="contact" id="contact">
  <div class="contact-copy"><h2>Let's get started</h2><p>Tell us what you need and we'll get back to you soon.</p>
  ${tel ? `<p class="contact-alt">Prefer to talk? <a href="tel:${tel}">Call</a> or <a href="sms:${tel}">text</a> ${phone}.</p>` : ""}</div>
  <form id="quote-form" data-endpoint="${lead ? esc(lead.endpoint) : ""}" data-site="${lead ? esc(lead.siteId) : ""}">
    <label>Your name<input name="name" autocomplete="name" required maxlength="100"></label>
    <label>Phone or email<input name="contact" autocomplete="tel" required maxlength="120"></label>
    <label>What do you need?<textarea name="details" rows="3" maxlength="2000"></textarea></label>
    <input name="company" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
    <button class="btn" type="submit">${cta}</button>
    <p class="formmsg" role="status" aria-live="polite"></p>
  </form>
  <script>${formScript}</script>
</div></div></section>`;

  const bar = previewBar
    ? `<div class="pbar"><span class="ptext"><strong>This could be your website.</strong> <span class="pnote">Full refund before launch.</span></span>
<a class="pbtn" href="${esc(previewBar.buyUrl)}">Make it live – $199.99</a></div>`
    : "";

  const heroOnDark = layout === "modern" ? !!heroSrc || isDark(L.heroBg) : layout === "editorial" ? isDark(L.heroBg) : L.dark;
  const heroInk = layout === "modern" && heroSrc ? "#FFFFFF" : layout === "minimal" ? L.ink : L.heroInk;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(copy.seoTitle || input.businessName)}</title>
<meta name="description" content="${esc(copy.seoDescription || "")}">
${domain ? `<link rel="canonical" href="https://www.${esc(domain)}/">` : ""}
<meta property="og:title" content="${esc(copy.seoTitle || input.businessName)}">
<meta property="og:description" content="${esc(copy.seoDescription || "")}">
<meta property="og:type" content="website">
${heroSrc ? `<meta property="og:image" content="${heroSrc}">` : ""}
<meta name="theme-color" content="${L.heroBg}">
${previewBar ? '<meta name="robots" content="noindex">' : ""}
<script type="application/ld+json">${schema(copy, input, domain)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_LINK}" rel="stylesheet">
<style>
:root{--bg:${L.bg};--surface:${L.surface};--ink:${L.ink};--muted:${L.muted};--line:${L.line};--brand:${L.brand};--accent:${L.accent};--accentInk:${L.accentInk};
--heroBg:${L.heroBg};--heroInk:${heroInk};--cInk:${L.heroInk};--hBtn:${heroBtn(L, layout)[0]};--hBtnInk:${heroBtn(L, layout)[1]};--pop:${L.pop || L.accent};--head:${F.head};--hw:${F.weight};--track:${F.track}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:var(--bg);color:var(--ink);font:400 17px/1.6 'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}a{color:inherit}
h1,h2,h3{font-family:var(--head);font-weight:var(--hw);letter-spacing:var(--track);line-height:1.04;margin:0;text-wrap:balance${F.caps ? ";text-transform:uppercase" : ""}${F.italic ? ";font-style:italic" : ""}}
.wrap{width:min(1180px,calc(100% - 40px));margin:0 auto}.narrow{width:min(760px,calc(100% - 40px))}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:50px;padding:14px 26px;border-radius:${L.font === "sans" ? "12px" : "2px"};background:var(--accent);color:var(--accentInk);
text-decoration:none;font:600 13px/1 'Inter',sans-serif;letter-spacing:.12em;text-transform:uppercase;border:1px solid var(--accent);cursor:pointer;transition:transform .2s,filter .2s;white-space:nowrap}
.btn:hover{filter:brightness(1.08);transform:translateY(-1px)}.btn:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--pop);outline-offset:3px}
.btn.line{background:transparent;color:inherit;border-color:currentColor}.btn.sm{min-height:42px;padding:10px 18px}
/* nav */
.nav{position:relative;z-index:3}.nav-in{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:76px}
.brand{font-family:var(--head);font-weight:var(--hw);font-size:22px;letter-spacing:var(--track);text-decoration:none${F.caps ? ";text-transform:uppercase" : ""}}
.logo-img{display:block;max-height:46px;max-width:190px;width:auto;height:auto}
.nav-links{display:flex;gap:30px;font-size:14px}.nav-links a{text-decoration:none;opacity:.85}.nav-links a:hover{opacity:1}
.nav-call{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:600;font-size:15px;border:1px solid currentColor;border-radius:999px;padding:9px 16px;opacity:.95}
.nav-call svg{width:16px;height:16px}
/* hero */
.hero{position:relative;color:var(--heroInk);background:var(--heroBg);overflow:hidden;isolation:isolate}
.eyebrow{font-size:12px;letter-spacing:.18em;text-transform:uppercase;margin:0 0 22px;opacity:.85;font-weight:500}
.hero h1{font-size:clamp(46px,7.4vw,${F.caps ? "112px" : "92px"});max-width:13ch;margin-bottom:24px}
.lede{font-size:clamp(17px,1.6vw,20px);max-width:46ch;margin:0 0 34px;opacity:.9}
.ctas{display:flex;gap:12px;flex-wrap:wrap}
.hero[data-layout=modern]{min-height:min(92vh,880px);display:flex;flex-direction:column}
.hero[data-layout=modern] .hero-in{flex:1;display:flex;flex-direction:column;justify-content:center;padding:60px 0 80px;position:relative;z-index:2}
.hero-bg{position:absolute;inset:0;z-index:0}.hero-bg .hero-img{width:100%;height:100%;object-fit:cover}
.hero[data-layout=modern][data-img] .hero-bg::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.38) 45%,rgba(0,0,0,.08) 100%),linear-gradient(0deg,rgba(0,0,0,.35),transparent 40%)}
.hero .btn:not(.line){background:var(--hBtn);color:var(--hBtnInk);border-color:var(--hBtn)}
.hero[data-layout=modern][data-img] .btn{background:${isDark(L.accent) ? "#FFFFFF" : L.accent};color:${isDark(L.accent) ? L.ink : L.accentInk};border-color:transparent}
.hero[data-layout=modern][data-img] .btn.line{background:transparent;color:#fff;border-color:#ffffffb3}
.hero[data-layout=editorial] .nav{background:var(--heroBg)}
.hero-grid{display:grid;grid-template-columns:1fr 1fr;min-height:min(86vh,820px)}
.hero[data-layout=editorial] h1{font-size:clamp(44px,5.4vw,80px);max-width:14ch}
.hero-copy{display:flex;align-items:center;padding:40px max(20px,calc((100vw - 1180px)/2)) 70px}.hero-copy .hero-in{max-width:560px}
.hero-side{position:relative;min-height:420px}.hero-side .hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero[data-layout=editorial] .nav{position:absolute;left:0;right:0;background:none}
.hero[data-layout=editorial] .hero-copy{padding-top:110px}
.hero[data-layout=minimal]{background:var(--bg);color:var(--ink)}
.hero[data-layout=minimal] .hero-in{text-align:center;display:flex;flex-direction:column;align-items:center;padding:70px 0 54px}
.hero[data-layout=minimal] h1{max-width:16ch}.hero[data-layout=minimal] .lede{max-width:52ch}
.hero[data-layout=minimal] .ctas{justify-content:center}
.hero-frame{margin-bottom:8px;position:relative;border-radius:${L.font === "sans" ? "28px" : "6px"};overflow:hidden;aspect-ratio:16/7;background:var(--heroBg)}
.hero-frame .hero-img{width:100%;height:100%;object-fit:cover}
.art{position:absolute;inset:0;overflow:hidden;background:radial-gradient(120% 90% at 85% 15%,color-mix(in srgb,var(--brand) 55%,transparent),transparent 60%),radial-gradient(90% 80% at 10% 100%,color-mix(in srgb,var(--pop) 35%,transparent),transparent 60%),var(--heroBg)}
.art i{position:absolute;border-radius:50%;filter:blur(2px);background:color-mix(in srgb,var(--heroInk) 10%,transparent)}
.art i:nth-child(1){width:46%;aspect-ratio:1;right:-6%;top:-12%}.art i:nth-child(2){width:28%;aspect-ratio:1;right:22%;bottom:-10%;background:color-mix(in srgb,var(--pop) 30%,transparent)}
.art i:nth-child(3){width:14%;aspect-ratio:1;right:12%;top:52%;background:color-mix(in srgb,var(--heroInk) 16%,transparent)}
.hero-side .art,.hero-frame .art{background:radial-gradient(100% 90% at 70% 20%,color-mix(in srgb,var(--pop) 45%,transparent),transparent 65%),color-mix(in srgb,var(--brand) 85%,#000)}
.facts{list-style:none;margin:0;padding:22px 0 26px;display:flex;gap:16px 48px;flex-wrap:wrap;border-top:1px solid color-mix(in srgb,currentColor 22%,transparent);position:relative;z-index:2;font-size:15px}
.facts span{display:block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.7;margin-bottom:2px}.facts a{text-decoration:none}
.hero[data-layout=editorial] .facts{display:none}.hero[data-layout=minimal] .facts{margin-top:24px}
/* sections */
section{padding:clamp(70px,9vw,120px) 0}
.sec-head{display:flex;justify-content:space-between;align-items:end;gap:20px;flex-wrap:wrap;margin-bottom:44px}
.sec-head h2,.about h2,.contact h2{font-size:clamp(36px,4.6vw,60px)}.sec-head p{color:var(--muted);margin:0;max-width:40ch}
.svc{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:0 48px;margin-bottom:40px}
.svc article{border-top:1px solid var(--line);padding:26px 0 30px}
.svc h3{font-size:clamp(24px,2.3vw,30px);margin-bottom:10px}.svc p{margin:0;color:var(--muted)}
#services{background:var(--bg)}
.about{background:var(--surface)}
.about-grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(30px,6vw,90px);align-items:center}
.about-media{position:relative;aspect-ratio:4/5;border-radius:${L.font === "sans" ? "24px" : "4px"};overflow:hidden;background:var(--heroBg)}.about-media img{width:100%;height:100%;object-fit:cover}
.about-text{font-size:clamp(18px,1.7vw,21px);line-height:1.65;margin:22px 0 28px}
.small-h{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0}.chips li{border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:14px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:14px}
.gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:${L.font === "sans" ? "16px" : "3px"};background:var(--line)}
.hours{list-style:none;padding:0;margin:0;font-size:19px}.hours li{padding:14px 0;border-top:1px solid var(--line)}
details{border-top:1px solid var(--line);padding:22px 0}details:last-child{border-bottom:1px solid var(--line)}
summary{font-family:var(--head);font-weight:var(--hw);font-size:clamp(20px,2vw,24px);letter-spacing:var(--track);cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:20px${F.caps ? ";text-transform:uppercase" : ""}}
summary::-webkit-details-marker{display:none}summary::after{content:'+';font-family:'Inter',sans-serif;font-weight:300;font-size:28px;line-height:1}
details[open] summary::after{content:'–'}details p{margin:12px 0 0;color:var(--muted);max-width:60ch}
#quote{padding-top:0}#quote .wrap{width:min(1180px,calc(100% - 40px))}
.contact{display:grid;grid-template-columns:1fr 1.1fr;gap:clamp(30px,5vw,80px);background:var(--heroBg);color:var(--cInk);padding:clamp(34px,6vw,80px);border-radius:${L.font === "sans" ? "28px" : "4px"}}
.contact-copy p{opacity:.85;font-size:18px;max-width:36ch}.contact-alt a{font-weight:600}
form{display:grid;gap:16px;align-content:start}
label{display:grid;gap:6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;opacity:.92}
input,textarea{font:16px 'Inter',sans-serif;padding:14px 16px;border-radius:${L.font === "sans" ? "12px" : "2px"};border:1px solid color-mix(in srgb,var(--cInk) 30%,transparent);background:color-mix(in srgb,var(--cInk) 7%,transparent);color:inherit;width:100%;text-transform:none;letter-spacing:0}
input::placeholder,textarea::placeholder{color:inherit;opacity:.6}
.contact .btn{justify-self:start;background:${isDark(L.heroBg) === isDark(L.accent) ? (isDark(L.heroBg) ? "#FFFFFF" : L.ink) : L.accent};color:${isDark(L.heroBg) === isDark(L.accent) ? (isDark(L.heroBg) ? L.ink : L.bg) : L.accentInk};border-color:transparent}
.formmsg{margin:0;font-weight:600}
footer{padding:36px 0 44px;color:var(--muted);font-size:14px}.foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.foot a{text-decoration:none}.byv a{text-decoration:underline;text-underline-offset:3px}
/* preview bar */
.pbar{position:sticky;top:0;z-index:20;display:flex;gap:12px;justify-content:center;align-items:center;flex-wrap:wrap;padding:10px 16px;background:#141A3D;color:#EEF3FF;font:600 14px/1.3 'Inter',system-ui,sans-serif}
.ptext{text-align:center}.pnote{font-weight:400;opacity:.8}
.pbtn{display:inline-flex;align-items:center;min-height:44px;padding:10px 24px;border-radius:999px;background:linear-gradient(165deg,#71A1EA 0%,#4D79C2 35%,#3B65B2 70%,#305194 100%);border:1px solid #C2D8FF;color:#fff;text-decoration:none;font:600 15px/1.2 'Inter',sans-serif;box-shadow:inset 0 2px 2px #ffffffb0,inset 0 -4px 7px #14306860,0 9px 24px #5E83D940;white-space:nowrap}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn{transition:none}.btn:hover{transform:none}}
@media(max-width:900px){
  .nav-links{display:none}.nav-call span{display:none}.nav-call{padding:10px;border-radius:50%}
  .hero-grid{grid-template-columns:1fr}.hero-side{min-height:0;aspect-ratio:4/3;order:2}.hero-side .hero-img{position:absolute}
  .hero[data-layout=editorial] .nav{position:relative;background:var(--heroBg)}.hero[data-layout=editorial] .hero-copy{padding:20px 20px 46px}
  .hero[data-layout=modern]{min-height:min(88svh,760px)}.hero[data-layout=modern] .hero-in{padding:30px 0 56px;justify-content:flex-end}
  .hero[data-layout=modern][data-img] .hero-bg::after{background:linear-gradient(0deg,rgba(0,0,0,.72) 0%,rgba(0,0,0,.45) 50%,rgba(0,0,0,.25) 100%)}
  .hero[data-layout=minimal] .hero-in{padding:40px 0 36px}.hero-frame{aspect-ratio:4/3}
  .facts{gap:14px 30px;padding:18px 0 22px}
  .about-grid,.contact{grid-template-columns:1fr}.about-media{aspect-ratio:4/3}
  .ctas .btn{flex:1 1 auto}
}
@media(max-width:520px){.pnote{display:block}.hero h1{font-size:clamp(42px,12vw,60px)}.facts li:nth-child(3){display:none}}
</style></head><body>
${bar}
${hero}
<main>
${sectionList(m.sections).filter((x) => x.show).map((x) => (x.id === "quote" ? quoteHtml : blocks[x.id])).join("\n")}
</main>
<footer><div class="wrap foot"><span>© ${new Date().getFullYear()} ${name}${phone ? ` · <a href="tel:${tel}">${phone}</a>` : ""}</span>${lead ? '<span class="byv">Website by <a href="https://vantryai.com/?ref=site" rel="noopener">Vantry</a></span>' : ""}</div></footer>
</body></html>`;
}

// The main hero button must stand out from the hero background.
function heroBtn(L, layout) {
  const bg = layout === "minimal" ? L.bg : L.heroBg;
  if (isDark(bg) !== isDark(L.accent)) return [L.accent, L.accentInk];
  return isDark(bg) ? [L.heroInk, L.heroBg] : [L.ink, L.bg];
}

function isDark(hex = "#000000") {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35;
}

// Facts for Google and AI assistants (ChatGPT, Gemini, Siri) about the business.
// Only what the owner gave us: services, area, hours, phone and their own questions.
function schema(copy, input, domain) {
  const url = domain ? `https://www.${domain}/` : undefined;
  const services = (copy.services || []).filter((s) => s && s.name);
  const faqs = (copy.faqs || []).filter((f) => f && f.q && f.a);
  const hours = (copy.hours || []).filter(Boolean);
  const business = {
    "@type": "LocalBusiness",
    "@id": url ? `${url}#business` : undefined,
    name: input.businessName,
    description: copy.seoDescription || copy.subheadline || undefined,
    telephone: input.phone || undefined,
    url,
    areaServed: (copy.serviceAreas && copy.serviceAreas.length ? copy.serviceAreas : [input.city]).filter(Boolean),
    address: input.city ? { "@type": "PostalAddress", addressLocality: String(input.city).split(",")[0].trim(), addressCountry: "US" } : undefined,
    knowsAbout: services.length ? services.map((s) => s.name) : undefined,
    hasOfferCatalog: services.length
      ? { "@type": "OfferCatalog", name: "Services", itemListElement: services.map((s) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.name, description: s.description || undefined } })) }
      : undefined,
    // Owners write hours in their own words, so they're shared as a note rather than guessed into a format.
    additionalProperty: hours.length ? [{ "@type": "PropertyValue", name: "Hours", value: hours.join("; ") }] : undefined,
  };
  const graph = [business];
  if (faqs.length) graph.push({ "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
}

// A plain-text summary at /llms.txt that AI assistants can read in one go.
export function aiSummary(copy = {}, input = {}, domain = "") {
  const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
  const lines = [`# ${clean(input.businessName)}`, ""];
  const desc = clean(copy.seoDescription || copy.subheadline);
  if (desc) lines.push(`> ${desc}`, "");
  if (copy.about) lines.push(clean(copy.about), "");
  const facts = [
    input.trade && `- Type of business: ${clean(input.trade)}`,
    input.city && `- Location: ${clean(input.city)}`,
    copy.serviceAreas?.length && `- Areas served: ${copy.serviceAreas.map(clean).join(", ")}`,
    input.phone && `- Phone (call or text): ${clean(input.phone)}`,
    domain && `- Website: https://www.${domain}/`,
    domain && `- Request a quote: https://www.${domain}/#contact`,
  ].filter(Boolean);
  if (facts.length) lines.push("## Contact", ...facts, "");
  const services = (copy.services || []).filter((s) => s?.name);
  if (services.length) lines.push("## Services", ...services.map((s) => `- ${clean(s.name)}${s.description ? `: ${clean(s.description)}` : ""}`), "");
  const hours = (copy.hours || []).filter(Boolean);
  if (hours.length) lines.push("## Hours", ...hours.map((h) => `- ${clean(h)}`), "");
  const faqs = (copy.faqs || []).filter((f) => f?.q && f?.a);
  if (faqs.length) lines.push("## Common questions", ...faqs.flatMap((f) => [`### ${clean(f.q)}`, clean(f.a), ""]));
  return lines.join("\n").trim() + "\n";
}

// Sends the quote form to Vantry, which emails the owner. On previews it explains instead.
// On live sites it also counts taps on Call and Text links.
const formScript = `(function(){var f=document.getElementById('quote-form');if(!f)return;var m=f.querySelector('.formmsg');
if(f.dataset.endpoint){var ev=f.dataset.endpoint.replace(/\\/api\\/lead$/,'/api/event');document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="tel:"],a[href^="sms:"]');if(!a)return;
try{navigator.sendBeacon(ev,new Blob([JSON.stringify({siteId:f.dataset.site,e:a.getAttribute('href').slice(0,3)==='tel'?'call':'text'})],{type:'text/plain'}));}catch(x){}});}
f.addEventListener('submit',function(e){e.preventDefault();var ep=f.dataset.endpoint;
if(!ep){m.textContent='This is a preview. Quote requests will reach you once your site is live.';return;}
var b=f.querySelector('button');b.disabled=true;m.textContent='Sending…';
var d={siteId:f.dataset.site,name:f.name.value,contact:f.contact.value,details:f.details.value,company:f.company.value};
fetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Error');return j;});})
.then(function(){f.reset();m.textContent='Thanks! We got your request and will get back to you soon.';})
.catch(function(err){m.textContent=err.message||'Something went wrong. Please call or text us instead.';})
.finally(function(){b.disabled=false;});});})();`;
