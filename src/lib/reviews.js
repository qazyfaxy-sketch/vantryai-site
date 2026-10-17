// Review requests for Growth and Pro clients: real customers only, sent by the client.
//
// Why: review sites are among the sources AI cites most for "recommend" questions, and honest reviews
// from real customers are what make a profile worth citing. But reviews can't be faked, bought, gated or
// written for people, so this engine does the one honest thing: it gives the client a simple kit and
// makes asking easy. The CLIENT sends the requests, from their own email, to their own customers.
//
// What the kit is:
//   - Where customers can review them: the live profiles from the listings engine (review sites and
//     directories) plus any review link the client adds (for example a Google review link).
//   - Three short email wordings that ask for an honest review, "good or bad", with the same message to
//     every customer. No incentives, no pre-screening ("only if you're happy"), no scripted praise.
//   - A page where they paste the customers they want to ask. It builds one ready-to-send email per
//     person in the browser. We never see or store those names or emails.
//
// What this never does: write reviews, post reviews, send to customers for the client, offer discounts
// or gifts for reviews, ask only happy customers, or suggest staff and family review.
//
// Routes:
//   GET/POST /reviews/:clientId   the client's page (kit + links)
import { html, httpError, esc, rateLimit } from "./util.js";
import { companyOfClient } from "./video.js";
import { sendEmail } from "./email.js";
import { getBatch } from "./listings.js";
import { page } from "../pages/shell.js";

const api = (env) => env.PUBLIC_API || "https://api.vantryai.com";
const PLANS = new Set(["growth", "pro"]);
const sign = "Thanks,\nVince\nVantry · vantryai.com";
export const isReviewsPath = (p) => /^\/reviews\/c[a-z0-9]{11}$/.test(p);
const clientUrl = (env, c) => `${api(env)}/reviews/${c.id}`;

// ---------------- The wording (fixed, never AI-written, so nothing can be invented) ----------------

export function templates(co) {
  const where = "{linkline}";
  return [
    { label: "Short and friendly", subject: `Would you share your honest experience with ${co.name}?`, body: `Hi {name},\n\nThanks for being a customer of ${co.name}. If you have two minutes, would you share your honest experience in a short review? Good or bad, what you say helps other people decide, and it helps us get better.${where}\n\nThank you,\n{me}` },
    { label: "A little more personal", subject: `A small favor, if you have a minute`, body: `Hi {name},\n\nI hope things are going well. I'm {me} from ${co.name}. We're asking customers to share an honest review of what it's like to work with us. We'll read every one, and we're not asking for anything specific: just how it really went.${where}\n\nThank you for your time,\n{me}` },
    { label: "After you helped them", subject: `How did we do?`, body: `Hi {name},\n\nI wanted to check in after we worked together. If you're open to it, an honest review of ${co.name} would help future customers know what to expect. Tell it the way it was, whatever that is.${where}\n\nThanks again,\n{me}` },
  ];
}

const RULES = [
  "Send the same message to every customer. Don't ask only the ones you think are happy.",
  "Don't offer discounts, gifts or anything else in return for a review.",
  "Don't write the review for them or tell them what to say.",
  "Don't ask staff, family or friends to review you. Only real customers.",
];

// Review links: live profiles from the listings engine, plus links the client adds.
export function reviewLinkOk(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || !/\.[a-z]{2,}$/i.test(u.hostname) || /^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname)) return null;
  return `${u.origin}${u.pathname}${u.search}`.slice(0, 300);
}

async function liveProfiles(env, c) {
  const out = [];
  for (const row of (c.listings?.batches || []).slice(-6)) {
    const b = await getBatch(env, row.id);
    for (const t of b?.targets || []) if (t.status === "live" && t.listingUrl && (t.type === "review" || t.type === "directory" || t.type === "marketplace")) out.push({ domain: t.domain, url: t.listingUrl });
  }
  return out;
}

// ---------------- The cron: one email when the kit has something to offer ----------------

export async function runReviews(env, { listClients, saveClient }) {
  if (env.REVIEWS_OFF === "true") return 0;
  let n = 0;
  for (const c of await listClients(env)) {
    if (!PLANS.has(c.plan) || c.status !== "active" || !c.onboardedAt || c.reviews?.kitAt) continue;
    try {
      const live = await liveProfiles(env, c);
      if (!live.length) continue; // nothing live yet to send customers to
      c.reviews = { ...(c.reviews || {}), kitAt: Date.now() };
      await saveClient(env, c, "Review request kit ready");
      const co = companyOfClient(c);
      await sendEmail(env, { to: c.onboarding?.reportEmail || c.email, subject: `Ask your real customers for a review: kit for ${co.name}`, text: `Hi,\n\nYour profile is live on ${live.slice(0, 3).map((x) => x.domain).join(", ")}. Honest reviews from real customers are what make a profile worth trusting, and they're the part we can't do for you.\n\nWe made a simple kit: three short email wordings that ask for an honest review, and a page where you paste the customers you want to ask. It builds one ready-to-send email per person. You send them from your own email, so they come from someone the customer knows. We never see your customers' names or emails.\n\n${clientUrl(env, c)}\n\nThree rules keep this honest and keep your profile safe: send the same message to every customer (not just the happy ones), offer nothing in return, and never write or ask for specific praise. Review sites remove profiles that break these.\n\nQuestions? Just reply.\n\n${sign}` });
      n++;
    } catch (e) {
      console.log("Reviews failed for", c.id, e.message);
    }
  }
  return n;
}

// ---------------- The client page ----------------

const STYLE = `<style>.f{display:block;margin:14px 0 6px}.f span{display:block;font-weight:600;margin-bottom:6px;font-size:14px}textarea,input[type=text],select{width:100%;border:1px solid #B9C3D1;border-radius:12px;padding:10px 12px;font:14px var(--sans)}ul.rules li{margin:6px 0}.pair{display:flex;gap:10px;align-items:center;margin:6px 0;flex-wrap:wrap}.pair span{flex:1;min-width:180px;font-size:14px}</style>`;

async function clientPage(req, env, id, { getClient, saveClient }) {
  const c = await getClient(env, id);
  if (!c || c.status !== "active" || !PLANS.has(c.plan)) throw httpError(404, "We couldn't find that. Check your email for the right link.");
  const co = companyOfClient(c);
  let flash = "";
  if (req.method === "POST") {
    try {
      if (!(await rateLimit(env, "rev-act", c.id, 30, 86400))) throw new Error("That's a lot of clicks for one day. Please try again tomorrow.");
      const form = await req.formData();
      const link = String(form.get("link") || "").trim();
      const ok = link ? reviewLinkOk(link) : "";
      if (link && !ok) throw new Error("That doesn't look like a link. It should start with https:// and open the page where customers leave a review.");
      c.reviews = { ...(c.reviews || {}), link: ok || "" };
      await saveClient(env, c, ok ? "Review link added" : "Review link removed");
      flash = ok ? "Saved. It's in your kit now." : "Removed.";
    } catch (e) {
      flash = e.message;
    }
  }
  const live = await liveProfiles(env, c);
  const links = [...live.map((x) => ({ label: x.domain, url: x.url })), ...(c.reviews?.link ? [{ label: "Your review link", url: c.reviews.link }] : [])];
  const defaultLink = c.reviews?.link || live[0]?.url || "";
  const tpl = templates(co);
  const body = `<main>
<h1>Ask your real customers for a review</h1>
<p class="lede">Honest reviews from real customers are what make a profile worth trusting. You send the requests, from your own email. We never see your customers' names or emails.</p>
${flash ? `<p class="card"><strong>${esc(flash)}</strong></p>` : ""}
<div class="card"><h2>Four rules that keep you safe</h2><ul class="rules">${RULES.map((r) => `<li>${esc(r)}</li>`).join("")}</ul><p class="muted small">Review sites remove profiles that break these, and in the US the FTC treats fake or bought reviews as illegal.</p></div>
<div class="card"><h2>Where customers can review you</h2>
${links.length ? `<ul>${links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join("")}</ul>` : '<p class="muted">Your profiles aren\'t live yet. Add a link below, or finish your <a href="' + esc(api(env) + "/listings/" + c.id) + '">listing kit</a> first.</p>'}
<form method="post"><label class="f"><span>Add or change a review link (for example your Google review link)</span><input type="text" name="link" value="${esc(c.reviews?.link || "")}" placeholder="https://..."></label><button class="ghost sm">Save</button></form></div>
<div class="card"><h2>Make your emails</h2>
<p class="muted small">Pick a wording, paste who you want to ask (one per line: <code>Name, email</code>), and press the button. Each person gets a ready-to-send email that opens in your own email app. Nothing you paste leaves this page.</p>
<label class="f"><span>Wording</span><select id="tpl">${tpl.map((t, i) => `<option value="${i}">${esc(t.label)}</option>`).join("")}</select></label>
<label class="f"><span>Your first name (it signs the email)</span><input type="text" id="me" placeholder="Alex"></label>
<label class="f"><span>Your link for customers</span><select id="lnk"><option value="">No link</option>${links.map((l) => `<option value="${esc(l.url)}"${l.url === defaultLink ? " selected" : ""}>${esc(l.label)}</option>`).join("")}</select></label>
<label class="f"><span>Customers you've worked with (one per line)</span><textarea id="who" rows="6" placeholder="Name, email"></textarea></label>
<button type="button" class="jelly sm" id="go">Make my emails</button>
<div id="out" class="pair-list" style="margin-top:14px"></div></div>
<script>
(function(){
  var T=${JSON.stringify(tpl).replace(/</g, "\\u003c")};
  var CO=${JSON.stringify(co.name).replace(/</g, "\\u003c")};
  var E=/[^\\s@,;<>]+@[^\\s@,;<>]+\\.[^\\s@,;<>]+/;
  document.getElementById("go").onclick=function(){
    var t=T[+document.getElementById("tpl").value], me=document.getElementById("me").value.trim()||"The team at "+CO, link=document.getElementById("lnk").value, out=document.getElementById("out");
    out.innerHTML=""; var n=0, seen={};
    document.getElementById("who").value.split(/\\n/).forEach(function(line){
      var m=line.match(E), em=m&&m[0]; if(!em||seen[em.toLowerCase()]) return; seen[em.toLowerCase()]=1;
      var nm=(line.replace(em,"").replace(/[<>,;\\t]/g," ").trim().split(/\\s+/)[0])||"there";
      var body=t.body.replace(/\\{linkline\\}/g, link?"\\n\\nYou can leave it here: "+link:"").replace(/\\{name\\}/g,nm).replace(/\\{me\\}/g,me);
      var a=document.createElement("a"); a.className="ghost sm"; a.textContent="Open email to "+em; a.href="mailto:"+encodeURIComponent(em)+"?subject="+encodeURIComponent(t.subject)+"&body="+encodeURIComponent(body); a.style.display="block"; a.style.margin="6px 0"; out.appendChild(a); n++;
    });
    if(!n) out.textContent="Add at least one customer with an email address.";
  };
})();
</script>
<p class="muted small">Never write a review for a customer or ask for specific praise. Being listed correctly and having honest reviews can help AI find accurate information about you. It can't guarantee you'll be named.</p>
</main>${STYLE}`;
  return html(page({ title: "Ask for reviews", body }), 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
}

export async function reviewsRoute(req, url, env, { getClient, saveClient }) {
  const m = url.pathname.match(/^\/reviews\/(c[a-z0-9]{11})$/);
  if (!m) throw httpError(404, "Page not found.");
  return await clientPage(req, env, m[1], { getClient, saveClient });
}
