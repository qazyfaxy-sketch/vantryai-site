// The Vantry Plus page in the customer's account: start a free trial, or use and set up Plus.
import { esc } from "../lib/util.js";
import { page } from "./shell.js";
import { FORM_CSS } from "./account.js";
import { DAYS, dollars } from "../plus.js";
import { prettyPhone } from "../lib/twilio.js";

const CSS = `<style>
.p-hero{background:linear-gradient(160deg,#fff,#EEF5FF);border:1px solid var(--line);border-radius:22px;padding:28px 24px;margin-bottom:18px}
.p-hero h1{margin:0 0 10px;font-size:34px}
.p-hero .lede{margin:0;max-width:52ch}
.mine{display:block;margin-top:14px;font-weight:600;color:var(--ink)}
.feat{list-style:none;padding:0;margin:0;display:grid;gap:14px}
.feat li{display:grid;grid-template-columns:40px 1fr;gap:12px;align-items:start}
.feat svg{width:40px;height:40px;padding:9px;border-radius:12px;background:var(--pale);color:var(--indigo)}
.feat strong{display:block;font-size:16px}.feat span{font-size:14px;color:var(--muted)}
.price-box{text-align:center}
.price-box .big{font:600 44px/1.1 var(--serif);letter-spacing:-.02em;margin:0}
.price-box .big small{font:500 16px var(--sans);color:var(--muted)}
.price-box .fine{font-size:13px;color:var(--muted);margin:10px 0 0}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.tile{background:var(--pale);border-radius:14px;padding:12px}
.tile strong{display:block;font:700 26px/1.1 var(--serif)}.tile span{font-size:13px;color:var(--muted)}
.line-num{font:600 26px/1.2 var(--serif);margin:4px 0 6px}
.tog{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:14px 0;border-top:1px solid var(--line)}
.tog:first-of-type{border-top:0}
.tog strong{display:block;font-size:15px}.tog span{font-size:13px;color:var(--muted)}
.tog input[type=checkbox]{width:22px;height:22px;accent-color:var(--indigo);flex-shrink:0}
.sub{padding:4px 0 14px}
.days{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.days label{position:relative}.days input{position:absolute;opacity:0}
.days span{display:block;border:1px solid var(--line);border-radius:999px;padding:7px 12px;font-size:14px;cursor:pointer;background:#fff}
.days input:checked+span{background:var(--pale);box-shadow:0 0 0 2px var(--indigo) inset}
.days input:focus-visible+span{outline:3px solid var(--indigo);outline-offset:2px}
select{min-height:46px;border:1px solid #B9C3D1;border-radius:12px;padding:8px 12px;font:16px var(--sans);background:#fff}
.note{background:#FFF8E6;border:1px solid #F2DDA4;border-radius:12px;padding:12px 14px;font-size:14px;margin:10px 0 0}
@media(max-width:560px){.tiles{grid-template-columns:1fr 1fr}.p-hero h1{font-size:28px}}
</style>`;

const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FEATURES = [
  ["M4 5h16v11H8l-4 4z", "Missed-call text-back", "Can't pick up? The caller gets a text from you in seconds, so they don't call someone else."],
  ["M12 3v12M6 9l6 6 6-6M4 21h16", "New requests by text", "Quote requests land on your phone right away, and the customer gets an instant \"we got it\" text."],
  ["M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z", "Reviews in one tap", "Type a customer's number after a job and we text them your Google review link."],
  ["M7 3v3M17 3v3M4 8h16M5 5h14v15H5z", "Pick a time", "Customers choose a day and time right in your contact form. You confirm it."],
  ["M4 4h16v12H9l-5 4zM8 9h8M8 12h5", "Chat helper, day and night", "Answers visitors' questions from your own site info, even at 2am."],
  ["M3 7h18v10H3zM3 11h18", "Pay a bill", "A link on your site to the payment page you already use (Square, PayPal and others)."],
];

export function plusPage({ site, on, settings: s, stats, plusStats: ps = {}, price, trial, texting, ok = "", error = "", note = "" }) {
  const id = esc(site.id);
  const back = `<a class="back" href="/account"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Account</a>`;
  const msg = (error ? `<div class="alert" role="alert" style="margin-bottom:16px">${esc(error)}</div>` : "") + (ok ? `<div class="ok-box" role="status">${esc(ok)}</div>` : "");

  if (!on) {
    // Their own numbers make the case better than any claim we could write.
    const calls = stats?.visitsReady ? stats.totals.call : 0;
    const mine = calls
      ? `${calls.toLocaleString("en-US")} ${calls === 1 ? "person" : "people"} tapped Call on your site in the last 30 days. Every one you couldn't answer might have called someone else.`
      : "When a call goes to voicemail, most people just call the next business on the list.";
    const body = `<main style="width:min(640px,calc(100% - 32px))">${back}
${note === "started" ? '<div class="ok-box" role="status">Almost done. Plus turns on in a few seconds. Refresh this page.</div>' : ""}${msg}
<section class="p-hero"><h1>Never miss a customer</h1>
<p class="lede">Vantry Plus answers for you when you're busy, so every call, question and request turns into a reply.</p>
<span class="mine">${esc(mine)}</span></section>
<section class="card"><ul class="feat">${FEATURES.map(([d, t, x]) => `<li>${icon(d)}<div><strong>${t}</strong><span>${x}</span></div></li>`).join("")}</ul></section>
<section class="card price-box">
<p class="big">${dollars(price)}<small>/month</small></p>
<p class="muted small" style="margin:6px 0 18px">${trial ? `Free for ${trial} days. ` : ""}Cancel any time from this page. We set everything up for you.</p>
<form method="post" action="/account/site/${id}/plus/start"><button class="jelly block" type="submit">${trial ? `Start my free ${trial} days` : "Turn on Plus"}</button></form>
<p class="fine">Tools like this usually cost $100–300 a month and you set them up yourself.</p>
</section>
</main>`;
    return page({ title: "Vantry Plus", body: body + FORM_CSS + CSS });
  }

  const n = (k) => (ps[k] || 0).toLocaleString("en-US");
  const tiles = [["missed", "Missed calls texted back"], ["bookings", "Booking requests"], ["reviews", "Review requests sent"], ["chats", "Chats answered"]];
  const lineCard = !texting
    ? `<p style="margin:0">Your text line is being set up. Everything else in Plus already works.</p>`
    : site.plus.number
      ? `<p class="muted small" style="margin:0">Your local Vantry line</p><p class="line-num">${esc(prettyPhone(site.plus.number))}</p><p class="muted small" style="margin:0">It's on your website now. It rings ${esc(site.input?.phone || "your phone")} like normal, and texts back anyone you miss.</p>`
      : site.input?.phone
        ? `<p style="margin:0 0 12px">Your text line isn't set up yet.</p><form method="post" action="/account/site/${id}/plus/line"><button class="ghost" type="submit">Set up my line</button></form>`
        : `<p style="margin:0">Add your phone number in <a href="/account/site/${id}">Edit my site</a> and we'll set up your line.</p>`;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hl = (h) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);
  const sel = (name, v) => `<select name="${name}" aria-label="${name === "bookStart" ? "From" : "Until"}">${hours.map((h) => `<option value="${h}"${h === v ? " selected" : ""}>${hl(h)}</option>`).join("")}</select>`;
  const tog = (name, title, sub, extra = "") => `<div><label class="tog"><div><strong>${title}</strong><span>${sub}</span></div><input type="checkbox" name="${name}"${s[name] ? " checked" : ""}></label>${extra}</div>`;

  const body = `<main style="width:min(720px,calc(100% - 32px))">${back}
<div class="site-row" style="margin:6px 0 18px"><div><h1 style="margin:0">Vantry Plus</h1><p class="muted small" style="margin:6px 0 0">${esc(site.businessName)} · ${site.plus.status === "trialing" ? "Free trial" : "On"}</p></div>
<form method="post" action="/account/site/${id}/plus/billing"><button class="ghost" type="submit">Billing and cancel</button></form></div>
${note === "started" ? '<div class="ok-box" role="status">Plus is on. Here\'s everything it can do.</div>' : ""}${msg}

<section class="card"><p class="muted small" style="margin:0 0 10px">This month</p>
<div class="tiles">${tiles.map(([k, l]) => `<div class="tile"><strong>${n(k)}</strong><span>${l}</span></div>`).join("")}</div></section>

<section class="card">${lineCard}</section>

<section class="card"><h2>Ask for a review</h2>
<p class="muted small" style="margin:0 0 6px">Just finished a job? Send a thank-you with your Google review link. Customers are most likely to say yes the same day.</p>
${s.reviewUrl ? `<form id="rv"><div class="row2"><div><label class="f" for="rv-name">Customer's first name</label><input id="rv-name" name="name" type="text" maxlength="60" autocomplete="off"></div>
<div><label class="f" for="rv-contact">Cell number or email</label><input id="rv-contact" name="contact" type="text" maxlength="120" autocomplete="off" required></div></div>
<button class="jelly" type="submit" style="margin-top:14px">Send review request</button><p class="small" id="rv-msg" role="status" aria-live="polite" style="margin:8px 0 0"></p></form>`
    : `<p class="note">Add your Google review link below first. Then this button appears.</p>`}
</section>

<form method="post" action="/account/site/${id}/plus" class="card"><h2>Settings</h2>
${tog("textBack", "Missed-call text-back", "Your website shows your Vantry line. Missed callers get a text back.")}
${tog("textLeads", "Text me new requests", "Get each quote request as a text, not just an email.")}
${tog("chat", "Chat helper on my site", "Answers questions from your site's info. It never makes up prices.")}
${tog("booking", "Pick a time", "Adds a day and time choice to your contact form.", `<div class="sub"><div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" name="bookDays" value="${i}"${s.bookDays.includes(i) ? " checked" : ""}><span>${d}</span></label>`).join("")}</div>
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="small">From</span>${sel("bookStart", s.bookStart)}<span class="small">until</span>${sel("bookEnd", s.bookEnd)}</div></div>`)}
<label class="f" for="reviewUrl">Google review link <small>In your Google Business Profile, tap "Ask for reviews" and copy the link.</small></label>
<input id="reviewUrl" name="reviewUrl" type="url" maxlength="500" value="${esc(s.reviewUrl)}" placeholder="https://g.page/r/...">
<label class="f" for="payUrl">Payment link <small>optional, from Square, PayPal, Stripe or similar</small></label>
<input id="payUrl" name="payUrl" type="url" maxlength="500" value="${esc(s.payUrl)}" placeholder="https://">
<label class="f" for="alertPhone">Send text alerts to <small>optional, if not your business phone</small></label>
<input id="alertPhone" name="alertPhone" type="tel" maxlength="30" value="${esc(s.alertPhone ? prettyPhone(s.alertPhone) : "")}" placeholder="${esc(site.input?.phone || "")}">
<button class="jelly block" type="submit" style="margin-top:20px">Save settings</button>
</form>
</main>`;
  const script = `var rv=document.getElementById('rv');if(rv){var m=document.getElementById('rv-msg');rv.onsubmit=function(e){e.preventDefault();var b=rv.querySelector('button');b.disabled=true;m.textContent='Sending…';
fetch('/account/site/${id}/review',{method:'POST',body:new URLSearchParams(new FormData(rv))}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error);return j;});})
.then(function(j){m.textContent='Sent by '+j.via+'. Nice work.';rv.reset();}).catch(function(err){m.textContent=err.message||'Something went wrong.';}).finally(function(){b.disabled=false;});};}`;
  return page({ title: "Vantry Plus", body: body + FORM_CSS + CSS, script });
}
