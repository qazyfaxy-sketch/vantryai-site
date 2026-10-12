// The customer's own account: log in, see their sites, edit them.
import { esc } from "../lib/util.js";
import { page } from "./shell.js";
import { PALETTES, SECTIONS, sectionList } from "../render.js";

const FORM_CSS = `<style>
label.f{display:block;font-weight:600;font-size:14px;margin:16px 0 6px}
label.f small{font-weight:400;color:var(--muted)}
input[type=email],input[type=password],input[type=tel],textarea{width:100%;min-height:50px;border:1px solid #B9C3D1;border-radius:12px;padding:12px 14px;font:16px var(--sans);background:#fff;color:var(--ink)}
textarea{min-height:96px;resize:vertical;line-height:1.5}
.pair{border:1px solid var(--line);border-radius:14px;padding:4px 14px 14px;margin-top:12px;background:#FBFCFF}
.pair label.f{margin-top:10px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.opts{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.opt{position:relative}.opt input{position:absolute;opacity:0}
.opt span{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:999px;padding:9px 16px;cursor:pointer;background:#fff;font-size:14px}
.opt input:checked+span{border-color:var(--indigo);box-shadow:0 0 0 2px var(--indigo) inset;background:var(--pale)}
.opt input:focus-visible+span{outline:3px solid var(--indigo);outline-offset:2px}
.sw{display:inline-flex}.sw i{width:16px;height:16px;border-radius:50%;margin-right:-4px;border:2px solid #fff}
.ok-box{border:1px solid #BFE3CF;background:#EEF9F2;color:#1F5C3B;border-radius:12px;padding:12px 14px;font-size:14px;margin-bottom:18px}
.site-row{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap}
.site-row h2{margin:0}.acts{display:flex;gap:8px;flex-wrap:wrap}
.links{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;font-size:14px}
.save{margin-top:8px}
.tag{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:3px 10px;background:var(--pale);color:var(--indigo)}
.tag.live{background:#E3F5EA;color:#1F7A4D}
@media(max-width:560px){.row2{grid-template-columns:1fr}}
</style>`;

const msg = (error, ok) =>
  (error ? `<div class="alert" role="alert" style="margin-bottom:16px">${esc(error)}</div>` : "") +
  (ok ? `<div class="ok-box" role="status">${esc(ok)}</div>` : "");

export function loginPage({ error = "", ok = "", email = "" } = {}) {
  const body = `<main style="width:min(460px,calc(100% - 32px))">
<h1>Log in</h1>
<p class="lede">Edit your website any time.</p>
${msg(error, ok)}
<form method="post" action="/login" class="card">
  <label class="f" for="email" style="margin-top:0">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" required maxlength="120" value="${esc(email)}">
  <label class="f" for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200">
  <button class="jelly block save" type="submit" style="margin-top:20px">Log in</button>
  <div class="links"><a href="/forgot">Forgot password?</a><a href="https://vantryai.com">Don't have a site yet?</a></div>
</form>
</main>${FORM_CSS}`;
  return page({ title: "Log in", body });
}

export function forgotPage({ error = "", ok = "", email = "" } = {}) {
  const body = `<main style="width:min(460px,calc(100% - 32px))">
<h1>Reset your password</h1>
<p class="lede">Type the email you used when you bought your site. We'll send you a link to pick a new password.</p>
${msg(error, ok)}
<form method="post" action="/forgot" class="card">
  <label class="f" for="email" style="margin-top:0">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" required maxlength="120" value="${esc(email)}">
  <button class="jelly block save" type="submit" style="margin-top:20px">Send reset link</button>
  <div class="links"><a href="/login">Back to log in</a></div>
</form>
</main>${FORM_CSS}`;
  return page({ title: "Reset password", body });
}

export function resetPage({ token, error = "" }) {
  const body = `<main style="width:min(460px,calc(100% - 32px))">
<h1>Pick a new password</h1>
${msg(error)}
<form method="post" action="/reset" class="card">
  <input type="hidden" name="t" value="${esc(token)}">
  <label class="f" for="password" style="margin-top:0">New password <small>(at least 8 characters)</small></label>
  <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="200">
  <button class="jelly block save" type="submit" style="margin-top:20px">Save password and log in</button>
</form>
</main>${FORM_CSS}`;
  return page({ title: "New password", body });
}

const STATUS = { live: ["Live", "live"], needs_review: ["Being checked", ""], domain_registering: ["Setting up your domain", ""], waiting_dns: ["Waiting for your domain", ""], paid: ["Setting up", ""], domain_problem: ["Setting up", ""], canceled: ["Offline", ""] };

// 30 small bars, one per day. Visits when we have them, otherwise quote requests.
function chart(days, key) {
  const max = Math.max(1, ...days.map((d) => d[key]));
  const w = 300, h = 64, bw = w / days.length;
  const bars = days.map((d, i) => {
    const bh = d[key] ? Math.max(3, (d[key] / max) * (h - 4)) : 2;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${d[key] ? "#3B88DA" : "#D9E4F3"}"><title>${d.day}: ${d[key]}</title></rect>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${key === "view" ? "Visits" : "Quote requests"} per day, last 30 days">${bars}</svg>`;
}

function statsBlock(st) {
  if (!st) return "";
  const t = st.totals;
  const num = (n, label, ready = true) => `<div class="stat"><strong>${ready ? n.toLocaleString("en-US") : "–"}</strong><span>${label}</span></div>`;
  return `<div class="stats-box">
  <p class="muted small" style="margin:0 0 10px">Last 30 days</p>
  <div class="stats">${num(t.view, "Visits", st.visitsReady)}${num(t.call, "Call taps", st.visitsReady)}${num(t.text, "Text taps", st.visitsReady)}${num(t.quote, "Quote requests")}</div>
  ${chart(st.days, st.visitsReady ? "view" : "quote")}
  <p class="muted small" style="margin:6px 0 0">${st.visitsReady ? "Visits per day" : "Quote requests per day. Visits and taps will show here soon."}</p>
</div>`;
}

export function accountPage({ email, sites, orders, stats = {} }) {
  const rows = sites
    .map((s) => {
      const o = orders[s.id] || {};
      const [label, cls] = STATUS[o.status] || ["Setting up", ""];
      return `<section class="card"><div class="site-row">
  <div><h2>${esc(s.businessName)}</h2><p class="muted small" style="margin:4px 0 0">${esc(s.domain)} <span class="tag ${cls}">${label}</span></p></div>
  <div class="acts"><a class="jelly sm" href="/account/site/${esc(s.id)}">Edit my site</a><a class="ghost" href="/account/site/${esc(s.id)}/view" target="_blank" rel="noopener">View</a></div>
</div>${statsBlock(stats[s.id])}</section>`;
    })
    .join("");
  const body = `<main>
<div class="site-row" style="margin-bottom:24px"><div><h1 style="margin:0">Your account</h1><p class="muted small" style="margin:6px 0 0">${esc(email)}</p></div>
<form method="post" action="/logout"><button class="ghost" type="submit">Log out</button></form></div>
${rows || '<section class="card"><p style="margin:0">No sites yet. If you just paid, give it a minute and refresh.</p></section>'}
</main>${FORM_CSS}<style>
.stats-box{border-top:1px solid var(--line);margin-top:18px;padding-top:16px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.stat{background:var(--pale);border-radius:14px;padding:12px}
.stat strong{display:block;font:700 24px/1.1 var(--serif);letter-spacing:-.02em}
.stat span{font-size:13px;color:var(--muted)}
.chart{display:block;width:100%;height:64px}
@media(max-width:560px){.stats{grid-template-columns:1fr 1fr}}
</style>`;
  return page({ title: "Your account", body });
}

export function editorPage({ site, ok = "", error = "", canUndo = false, media }) {
  const c = site.copy || {};
  const i = site.input || {};
  const pal = PALETTES[site.palette] ? site.palette : "";
  const id = esc(site.id);
  const imgUrl = (pid) => `${media.imgBase}/img/${id}/${esc(pid)}`;
  const field = (name, label, value, max, hint = "") =>
    `<label class="f" for="${name}">${label}${hint ? ` <small>${hint}</small>` : ""}</label><input id="${name}" name="${name}" type="text" maxlength="${max}" value="${esc(value || "")}">`;
  const area = (name, label, value, max, hint = "", rows = 3) =>
    `<label class="f" for="${name}">${label}${hint ? ` <small>${hint}</small>` : ""}</label><textarea id="${name}" name="${name}" maxlength="${max}" rows="${rows}">${esc(value || "")}</textarea>`;
  const services = c.services || [];
  const faqs = c.faqs || [];
  const sectionsNow = sectionList(site.sections);
  const sectionName = Object.fromEntries(SECTIONS);
  const photos = site.photos || [];

  const body = `<div class="ed-top"><div class="ed-in">
  <a class="back" href="/account"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Account</a>
  <div class="tabs" role="tablist"><button type="button" class="tab" data-tab="edit" aria-selected="true">Edit</button><button type="button" class="tab" data-tab="preview" aria-selected="false">Preview</button></div>
  <button class="jelly sm" type="submit" form="ed">Save</button>
</div></div>
<div class="ed-wrap" data-show="edit">
<div class="ed-form">
<h1>Edit your site</h1>
<p class="lede">Changes show in the preview as you type. Press Save to put them on your site.</p>
${msg(error, ok)}
<form id="ed" method="post" action="/account/site/${id}">
<input type="hidden" name="photos" value="${esc(photos.join(","))}">
<input type="hidden" name="logo" value="${esc(site.logo || "")}">
<input type="hidden" name="heroPhoto" value="${esc(site.heroPhoto || "")}">
<input type="hidden" name="sections" value="${esc(JSON.stringify(sectionsNow))}">

<section class="card ai"><h2>Tell AI what to change</h2>
  <p class="muted small" style="margin:0 0 8px">For example: "Add that we do weddings" or "Make it sound more friendly". You check it in the preview, then Save.</p>
  <textarea id="ai-text" maxlength="600" rows="2" placeholder="What should change?"></textarea>
  <button type="button" class="ghost" id="ai-go" style="margin-top:10px">Make the change</button>
  <p class="small" id="ai-msg" role="status" aria-live="polite" style="margin:8px 0 0"></p>
</section>

<details class="card" open><summary><h2>Photos and logo</h2></summary>
  <p class="muted small" style="margin:0">Tap the star to use a photo at the top of your page.</p>
  <div class="thumbs" id="thumbs">${photos.map((p) => `<div class="thumb" data-id="${esc(p)}"><img src="${imgUrl(p)}" alt=""><button type="button" class="star${site.heroPhoto === p ? " on" : ""}" aria-label="Use at the top of the page" aria-pressed="${site.heroPhoto === p}">★</button><button type="button" class="rm" aria-label="Remove photo">×</button></div>`).join("")}</div>
  <label class="ghost upl"><input type="file" id="add-photos" accept="image/*" multiple hidden>Add photos</label>
  <p class="small" id="photo-msg" role="status" aria-live="polite" style="margin:8px 0 0"></p>
  <div class="logo-row"><div class="logo-box" id="logo-box">${site.logo ? `<img src="${imgUrl(site.logo)}" alt="Your logo">` : '<span class="muted small">No logo</span>'}</div>
  <div class="acts"><label class="ghost upl"><input type="file" id="add-logo" accept="image/*" hidden>${site.logo ? "Change logo" : "Upload logo"}</label>${site.logo ? '<button type="button" class="ghost" id="rm-logo">Remove</button>' : ""}</div></div>
</details>

<details class="card" open><summary><h2>Your business</h2></summary>
  <div class="row2">${field("businessName", "Business name", i.businessName, 80)}${field("phone", "Phone", i.phone, 30)}</div>
  <div class="row2">${field("city", "City", i.city, 80)}
  <div><label class="f" for="leadEmail">Send quote requests to</label><input id="leadEmail" name="leadEmail" type="email" maxlength="120" value="${esc(site.leadEmail || site.ownerEmail || "")}"></div></div>
</details>

<details class="card" open><summary><h2>Top of your page</h2></summary>
  ${field("headline", "Headline", c.headline, 90)}
  ${area("subheadline", "Line under the headline", c.subheadline, 220, "", 2)}
  ${field("ctaText", "Button text", c.ctaText, 30, "e.g. Get a free quote")}
</details>

<details class="card"><summary><h2>Services</h2></summary>
${Array.from({ length: 8 }, (_, n) => { const sv = services[n] || {}; return `<div class="pair" data-slot="svc"${n > services.length ? " hidden" : ""}>${field(`sname${n}`, "Service", sv.name, 60)}${area(`sdesc${n}`, "Short description", sv.description, 200, "", 2)}</div>`; }).join("")}
  <button type="button" class="ghost more" data-more="svc">Add a service</button>
  <p class="muted small">Clear a service's name to remove it.</p>
</details>

<details class="card"><summary><h2>About and hours</h2></summary>
  ${area("about", "About you", c.about, 700, "", 4)}
  ${area("serviceAreas", "Areas you serve", (c.serviceAreas || []).join("\n"), 800, "one per line")}
  ${area("hours", "Hours", (c.hours || []).join("\n"), 520, "one per line, e.g. Mon–Fri 8am–6pm")}
</details>

<details class="card"><summary><h2>Common questions</h2></summary>
${Array.from({ length: 5 }, (_, n) => { const f = faqs[n] || {}; return `<div class="pair" data-slot="faq"${n > faqs.length ? " hidden" : ""}>${field(`fq${n}`, "Question", f.q, 140)}${area(`fa${n}`, "Answer", f.a, 400, "", 2)}</div>`; }).join("")}
  <button type="button" class="ghost more" data-more="faq">Add a question</button>
</details>

<details class="card"><summary><h2>Sections</h2></summary>
  <p class="muted small" style="margin:0 0 10px">Show, hide and reorder the parts of your page. Empty sections don't show.</p>
  <ul class="secs" id="secs">${sectionsNow.map((x) => `<li data-id="${x.id}"><label class="sw-t"><input type="checkbox"${x.show ? " checked" : ""}><span>${sectionName[x.id]}</span></label><span class="mv"><button type="button" data-mv="-1" aria-label="Move ${sectionName[x.id]} up">↑</button><button type="button" data-mv="1" aria-label="Move ${sectionName[x.id]} down">↓</button></span></li>`).join("")}</ul>
</details>

<details class="card"><summary><h2>Look</h2></summary>
  <label class="f">Style</label><div class="opts">
  ${[["modern", "Full photo"], ["editorial", "Side by side"], ["minimal", "Light and simple"]].map(([k, label]) => `<label class="opt"><input type="radio" name="style" value="${k}"${site.style === k ? " checked" : ""}><span>${label}</span></label>`).join("")}</div>
  <label class="f">Colors</label><div class="opts">
  <label class="opt"><input type="radio" name="palette" value=""${pal === "" ? " checked" : ""}><span>Recommended for you</span></label>
  ${Object.entries(PALETTES).map(([k, p]) => `<label class="opt"><input type="radio" name="palette" value="${k}"${pal === k ? " checked" : ""}><span><span class="sw"><i style="background:${p.dark}"></i><i style="background:${p.brand}"></i><i style="background:${p.accent}"></i></span>&nbsp;${esc(p.name)}</span></label>`).join("")}</div>
</details>

<button class="jelly block" type="submit">Save changes</button>
</form>
<div class="links"><a class="ghost" href="/account/site/${id}/view" target="_blank" rel="noopener">View my live site</a>
${canUndo ? `<form method="post" action="/account/site/${id}/undo" style="margin:0"><button class="ghost" type="submit">Undo my last save</button></form>` : ""}</div>
</div>
<div class="ed-preview"><div class="frame-bar"><span class="muted small">Preview</span><span class="dev"><button type="button" data-dev="phone" aria-pressed="false">Phone</button><button type="button" data-dev="desktop" aria-pressed="true">Computer</button></span></div>
<div class="frame-box"><iframe id="pv" title="Preview of your site" sandbox="allow-same-origin"></iframe></div></div>
</div>
${FORM_CSS}<style>

.ed-top{position:sticky;top:0;z-index:20;background:#FBFCFFF2;backdrop-filter:blur(8px);border-bottom:1px solid #E4E8F3}
.ed-in{width:min(1320px,calc(100% - 32px));margin:auto;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:60px}
.tabs{display:none;gap:4px;background:var(--pale);padding:4px;border-radius:999px}
.tab{border:0;background:none;border-radius:999px;padding:8px 16px;font:600 14px var(--sans);color:var(--muted);cursor:pointer;min-height:36px}
.tab[aria-selected=true]{background:#fff;color:var(--ink);box-shadow:0 2px 8px #222C5C14}
.ed-wrap{width:min(1320px,calc(100% - 32px));margin:0 auto;display:grid;grid-template-columns:minmax(0,500px) minmax(0,1fr);gap:28px;padding:28px 0 80px;align-items:start}
.ed-form h1{font-size:32px}
details.card>summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center}
details.card>summary::-webkit-details-marker{display:none}
details.card>summary::after{content:'+';font-size:22px;color:var(--muted)}
details.card[open]>summary::after{content:'–'}
details.card>summary h2{margin:0}
details.card[open]>summary{margin-bottom:10px}
.ai{background:linear-gradient(160deg,#fff,#EEF5FF)}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin:12px 0}
.thumb{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;background:var(--line)}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.thumb button{position:absolute;top:6px;width:30px;height:30px;border-radius:50%;border:0;background:#0B1B3FAA;color:#fff;font-size:16px;line-height:1;cursor:pointer}
.thumb .star{left:6px}.thumb .star.on{background:#F2B33A;color:#3A2600}.thumb .rm{right:6px}
.thumb.loading{display:grid;place-items:center;font-size:12px;color:var(--muted)}
.upl{cursor:pointer}
.logo-row{display:flex;align-items:center;gap:14px;margin-top:16px;padding-top:16px;border-top:1px solid var(--line);flex-wrap:wrap}
.logo-box{width:120px;height:60px;border:1px dashed #B9C3D1;border-radius:12px;display:grid;place-items:center;background:#fff;overflow:hidden}
.logo-box img{max-width:100%;max-height:100%}
.more{margin-top:12px}
.secs{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.secs li{display:flex;justify-content:space-between;align-items:center;border:1px solid var(--line);border-radius:12px;padding:8px 10px 8px 14px;background:#fff}
.sw-t{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;cursor:pointer}
.sw-t input{width:20px;height:20px;accent-color:var(--indigo)}
.mv{display:flex;gap:4px}.mv button{width:38px;height:38px;border:1px solid var(--line);border-radius:10px;background:#fff;font-size:16px;cursor:pointer}
.ed-preview{position:sticky;top:84px}
.frame-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.dev{display:flex;gap:4px;background:var(--pale);padding:4px;border-radius:999px}
.dev button{border:0;background:none;border-radius:999px;padding:6px 12px;font:600 13px var(--sans);color:var(--muted);cursor:pointer}
.dev button[aria-pressed=true]{background:#fff;color:var(--ink)}
.frame-box{border:1px solid var(--line);border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 20px 50px -24px #1E3A7A55;height:calc(100vh - 140px);margin:0 auto;transition:width .2s}
.frame-box.phone{width:390px;max-width:100%}
.frame-box iframe{width:100%;height:100%;border:0;display:block}
@media(max-width:900px){
  .tabs{display:flex}
  .ed-wrap{grid-template-columns:1fr;padding-top:18px}
  .ed-wrap[data-show=edit] .ed-preview{display:none}
  .ed-wrap[data-show=preview] .ed-form{display:none}
  .ed-preview{position:static}.dev{display:none}
  .frame-box{height:calc(100vh - 130px);height:calc(100dvh - 130px);width:100%!important}
}
</style>`;

  const script = `
var f=document.getElementById('ed'),pv=document.getElementById('pv'),SITE=${JSON.stringify(site.id)},IMG=${JSON.stringify(media.imgBase + "/img/" + site.id + "/")};
var H=function(n){return f.elements[n];};
var timer=null;
function refresh(){clearTimeout(timer);timer=setTimeout(function(){
  fetch('/account/site/'+SITE+'/preview',{method:'POST',body:new URLSearchParams(new FormData(f))}).then(function(r){return r.text();}).then(function(h){
    var y=0;try{y=pv.contentWindow.scrollY;}catch(e){}
    pv.srcdoc=h;pv.onload=function(){try{pv.contentWindow.scrollTo(0,y);}catch(e){}};
  });},350);}
f.addEventListener('input',refresh);f.addEventListener('change',refresh);refresh();

// Tabs on phones
[].forEach.call(document.querySelectorAll('.tab'),function(t){t.onclick=function(){
  document.querySelector('.ed-wrap').dataset.show=t.dataset.tab;
  [].forEach.call(document.querySelectorAll('.tab'),function(x){x.setAttribute('aria-selected',x===t);});window.scrollTo(0,0);};});
[].forEach.call(document.querySelectorAll('[data-dev]'),function(b){b.onclick=function(){
  document.querySelector('.frame-box').classList.toggle('phone',b.dataset.dev==='phone');
  [].forEach.call(document.querySelectorAll('[data-dev]'),function(x){x.setAttribute('aria-pressed',x===b);});};});

// More services / questions
[].forEach.call(document.querySelectorAll('[data-more]'),function(b){
  function sync(){b.hidden=!document.querySelector('[data-slot='+b.dataset.more+'][hidden]');}
  b.onclick=function(){var n=document.querySelector('[data-slot='+b.dataset.more+'][hidden]');if(n){n.hidden=false;var i=n.querySelector('input');if(i)i.focus();}sync();};sync();});

// Sections
var secs=document.getElementById('secs');
function saveSecs(){H('sections').value=JSON.stringify([].map.call(secs.children,function(li){return{id:li.dataset.id,show:li.querySelector('input').checked};}));refresh();}
secs.addEventListener('change',saveSecs);
secs.addEventListener('click',function(e){var b=e.target.closest('[data-mv]');if(!b)return;var li=b.closest('li');
  if(b.dataset.mv==='-1'&&li.previousElementSibling)secs.insertBefore(li,li.previousElementSibling);
  else if(b.dataset.mv==='1'&&li.nextElementSibling)secs.insertBefore(li.nextElementSibling,li);
  b.focus();saveSecs();});

// Photos
var thumbs=document.getElementById('thumbs'),pmsg=document.getElementById('photo-msg');
function syncPhotos(){var ids=[].map.call(thumbs.querySelectorAll('.thumb[data-id]'),function(t){return t.dataset.id;});H('photos').value=ids.join(',');
  if(ids.indexOf(H('heroPhoto').value)<0)H('heroPhoto').value='';refresh();}
function shrink(file,max,type){return new Promise(function(ok,bad){var img=new Image();img.onload=function(){var s=Math.min(1,max/Math.max(img.width,img.height));
  var c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  c.toBlob(function(b){b?ok(b):bad(new Error('Could not read that photo.'));},type,.85);URL.revokeObjectURL(img.src);};
  img.onerror=function(){bad(new Error('That file is not a photo we can read.'));};img.src=URL.createObjectURL(file);});}
function upload(blob){return fetch('/account/site/'+SITE+'/photo',{method:'POST',headers:{'Content-Type':blob.type},body:blob}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Upload failed');return j;});});}
function thumbHtml(id,url){return '<img src="'+url+'" alt=""><button type="button" class="star" aria-label="Use at the top of the page" aria-pressed="false">★</button><button type="button" class="rm" aria-label="Remove photo">×</button>';}
document.getElementById('add-photos').onchange=function(){var files=[].slice.call(this.files);this.value='';
  var room=${12}-thumbs.querySelectorAll('.thumb').length;if(files.length>room){pmsg.textContent='You can have up to 12 photos.';files=files.slice(0,Math.max(0,room));}
  files.reduce(function(p,file){return p.then(function(){var t=document.createElement('div');t.className='thumb loading';t.textContent='Uploading…';thumbs.appendChild(t);
    return shrink(file,1600,'image/jpeg').then(upload).then(function(j){t.className='thumb';t.dataset.id=j.id;t.innerHTML=thumbHtml(j.id,j.url);syncPhotos();pmsg.textContent='';})
    .catch(function(e){t.remove();pmsg.textContent=e.message;});});},Promise.resolve());};
thumbs.addEventListener('click',function(e){var t=e.target.closest('.thumb');if(!t)return;
  if(e.target.classList.contains('rm')){t.remove();syncPhotos();}
  else if(e.target.classList.contains('star')){var on=!e.target.classList.contains('on');
    [].forEach.call(thumbs.querySelectorAll('.star'),function(s){s.classList.remove('on');s.setAttribute('aria-pressed','false');});
    if(on){e.target.classList.add('on');e.target.setAttribute('aria-pressed','true');}H('heroPhoto').value=on?t.dataset.id:'';refresh();}});
var logoBox=document.getElementById('logo-box');
document.getElementById('add-logo').onchange=function(){var file=this.files[0];this.value='';if(!file)return;pmsg.textContent='Uploading logo…';
  shrink(file,600,'image/png').then(upload).then(function(j){H('logo').value=j.id;logoBox.innerHTML='<img src="'+j.url+'" alt="Your logo">';pmsg.textContent='';refresh();})
  .catch(function(e){pmsg.textContent=e.message;});};
var rmLogo=document.getElementById('rm-logo');if(rmLogo)rmLogo.onclick=function(){H('logo').value='';logoBox.innerHTML='<span class="muted small">No logo</span>';rmLogo.remove();refresh();};

// AI changes
var aiBtn=document.getElementById('ai-go'),aiMsg=document.getElementById('ai-msg');
aiBtn.onclick=function(){var t=document.getElementById('ai-text').value.trim();if(!t){aiMsg.textContent='Type what you would like to change.';return;}
  aiBtn.disabled=true;aiMsg.textContent='Working on it…';var d=new FormData(f);d.set('instruction',t);
  fetch('/account/site/'+SITE+'/ai',{method:'POST',body:new URLSearchParams(d)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error);return j;});})
  .then(function(j){var c=j.copy;['businessName','headline','subheadline','ctaText','about'].forEach(function(k){if(H(k))H(k).value=c[k]||'';});
    H('serviceAreas').value=(c.serviceAreas||[]).join('\\n');H('hours').value=(c.hours||[]).join('\\n');
    for(var n=0;n<8;n++){var s=c.services[n]||{};H('sname'+n).value=s.name||'';H('sdesc'+n).value=s.description||'';H('sname'+n).closest('.pair').hidden=n>c.services.length;}
    for(var n=0;n<5;n++){var q=c.faqs[n]||{};H('fq'+n).value=q.q||'';H('fa'+n).value=q.a||'';H('fq'+n).closest('.pair').hidden=n>c.faqs.length;}
    aiMsg.textContent='Done. Check the preview, then press Save.';refresh();})
  .catch(function(e){aiMsg.textContent=e.message||'Something went wrong. Please try again.';}).finally(function(){aiBtn.disabled=false;});};

// Warn before leaving with unsaved changes
var dirty=false;f.addEventListener('input',function(){dirty=true;});f.addEventListener('submit',function(){dirty=false;});
window.addEventListener('beforeunload',function(e){if(dirty){e.preventDefault();e.returnValue='';}});
`;
  return page({ title: `Edit ${site.businessName}`, body, script });
}
