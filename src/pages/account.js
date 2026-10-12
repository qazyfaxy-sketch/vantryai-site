// The customer's own account: log in, see their sites, edit them.
import { esc } from "../lib/util.js";
import { page } from "./shell.js";
import { PALETTES, pickPalette } from "../render.js";

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
.links{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px;font-size:14px}
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

export function accountPage({ email, sites, orders }) {
  const rows = sites
    .map((s) => {
      const o = orders[s.id] || {};
      const [label, cls] = STATUS[o.status] || ["Setting up", ""];
      return `<section class="card"><div class="site-row">
  <div><h2>${esc(s.businessName)}</h2><p class="muted small" style="margin:4px 0 0">${esc(s.domain)} <span class="tag ${cls}">${label}</span></p></div>
  <div class="acts"><a class="jelly sm" href="/account/site/${esc(s.id)}">Edit my site</a><a class="ghost" href="/account/site/${esc(s.id)}/view" target="_blank" rel="noopener">View</a></div>
</div></section>`;
    })
    .join("");
  const body = `<main>
<div class="site-row" style="margin-bottom:24px"><div><h1 style="margin:0">Your account</h1><p class="muted small" style="margin:6px 0 0">${esc(email)}</p></div>
<form method="post" action="/logout"><button class="ghost" type="submit">Log out</button></form></div>
${rows || '<section class="card"><p style="margin:0">No sites yet. If you just paid, give it a minute and refresh.</p></section>'}
</main>${FORM_CSS}`;
  return page({ title: "Your account", body });
}

export function editorPage({ site, ok = "", error = "", canUndo = false }) {
  const c = site.copy || {};
  const i = site.input || {};
  const services = [...(c.services || [])];
  while (services.length < Math.min(8, (c.services || []).length + 2)) services.push({ name: "", description: "" });
  const faqs = [...(c.faqs || [])];
  while (faqs.length < Math.min(5, (c.faqs || []).length + 1)) faqs.push({ q: "", a: "" });
  const pal = site.palette || pickPalette(site.businessName);
  const field = (name, label, value, max, hint = "") =>
    `<label class="f" for="${name}">${label}${hint ? ` <small>${hint}</small>` : ""}</label><input id="${name}" name="${name}" type="text" maxlength="${max}" value="${esc(value || "")}">`;
  const area = (name, label, value, max, hint = "") =>
    `<label class="f" for="${name}">${label}${hint ? ` <small>${hint}</small>` : ""}</label><textarea id="${name}" name="${name}" maxlength="${max}">${esc(value || "")}</textarea>`;

  const body = `<main>
<p class="small" style="margin:0 0 10px"><a href="/account">← Your account</a></p>
<h1>Edit ${esc(site.businessName)}</h1>
<p class="lede">Change anything, then press Save. Your site updates within a minute.</p>
${msg(error, ok)}
<form method="post" action="/account/site/${esc(site.id)}">
<section class="card"><h2>Your business</h2>
  <div class="row2">${field("businessName", "Business name", i.businessName, 80)}${field("phone", "Phone", i.phone, 30)}</div>
  <div class="row2">${field("city", "City", i.city, 80)}
  <div><label class="f" for="leadEmail">Send quote requests to</label><input id="leadEmail" name="leadEmail" type="email" maxlength="120" value="${esc(site.leadEmail || site.ownerEmail || "")}"></div></div>
</section>

<section class="card"><h2>Top of your page</h2>
  ${field("headline", "Headline", c.headline, 90)}
  ${area("subheadline", "Line under the headline", c.subheadline, 220)}
  ${field("ctaText", "Button text", c.ctaText, 30, "e.g. Get a free quote")}
</section>

<section class="card"><h2>Services</h2><p class="muted small" style="margin:0">Leave a name empty to remove that service.</p>
${services.map((s, n) => `<div class="pair">${field(`sname${n}`, "Service", s.name, 60)}${area(`sdesc${n}`, "Short description", s.description, 200)}</div>`).join("")}
</section>

<section class="card"><h2>About you</h2>
  ${area("about", "About", c.about, 700)}
  ${area("serviceAreas", "Areas you serve", (c.serviceAreas || []).join("\n"), 800, "one per line")}
</section>

<section class="card"><h2>Common questions</h2><p class="muted small" style="margin:0">Leave a question empty to remove it.</p>
${faqs.map((f, n) => `<div class="pair">${field(`fq${n}`, "Question", f.q, 140)}${area(`fa${n}`, "Answer", f.a, 400)}</div>`).join("")}
</section>

<section class="card"><h2>Look</h2>
  <label class="f">Style</label><div class="opts">
  ${["modern", "editorial", "minimal"].map((k) => `<label class="opt"><input type="radio" name="style" value="${k}"${site.style === k ? " checked" : ""}><span>${k[0].toUpperCase() + k.slice(1)}</span></label>`).join("")}</div>
  <label class="f">Colors</label><div class="opts">
  ${Object.entries(PALETTES).map(([k, p]) => `<label class="opt"><input type="radio" name="palette" value="${k}"${pal === k ? " checked" : ""}><span><span class="sw"><i style="background:${p.dark}"></i><i style="background:${p.brand}"></i><i style="background:${p.accent}"></i></span>&nbsp;${k[0].toUpperCase() + k.slice(1)}</span></label>`).join("")}</div>
</section>

<button class="jelly block" type="submit">Save changes</button>
</form>
<div class="links"><a href="/account/site/${esc(site.id)}/view" target="_blank" rel="noopener">View my site</a>
${canUndo ? `<form method="post" action="/account/site/${esc(site.id)}/undo" style="margin:0"><button class="ghost" type="submit">Undo my last save</button></form>` : ""}</div>
</main>${FORM_CSS}`;
  return page({ title: `Edit ${site.businessName}`, body });
}
