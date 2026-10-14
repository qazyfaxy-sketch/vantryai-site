// Vantry Plus: one monthly plan with every "never miss a customer" tool.
//   - Missed-call text-back: the site shows a local Vantry line that rings the owner's phone.
//     If they don't pick up, the caller gets a text right away and the owner is told.
//   - New quote requests by text, plus an instant "we got it" text to the customer
//   - Review requests: one tap texts (or emails) a customer the owner's Google review link
//   - Pick-a-time booking in the contact form
//   - A 24/7 chat helper that answers from the site's own info and takes requests
//   - A "Pay a bill" link to the payment page the owner already uses
//
// Stored on the site record:  site.plus = { status, sub, customer, number, numberSid, settings... }
// KV:  tnum:<+1number> -> siteId   pstat:<siteId>:<YYYY-MM> -> { missed, texts, reviews, chats, bookings }
import { getSite, putSite, getJson, putJson } from "./lib/store.js";
import { stripe } from "./lib/stripe.js";
import { send, sendEmail } from "./lib/email.js";
import { twilioOn, sendSms, sendSmsFrom, buyNumber, releaseNumber, toE164, prettyPhone } from "./lib/twilio.js";
import { aiSummary } from "./render.js";
import { rateLimit, httpError, clientIp, readJson } from "./lib/util.js";

export const plusPrice = (env) => parseInt(env.PLUS_PRICE_CENTS || "3900", 10);
export const plusTrialDays = (env) => parseInt(env.PLUS_TRIAL_DAYS || "14", 10);
export const dollars = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
export const plusOn = (site) => ["active", "trialing"].includes(site?.plus?.status);

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DEFAULT_SETTINGS = {
  textBack: true,
  textLeads: true,
  booking: false,
  bookDays: [1, 2, 3, 4, 5],
  bookStart: 9,
  bookEnd: 17,
  chat: true,
  reviewUrl: "",
  payUrl: "",
  alertPhone: "",
};
export const settingsOf = (site) => ({ ...DEFAULT_SETTINGS, ...(site?.plus?.settings || {}) });

// What the site renderer needs. Empty when Plus is off, so nothing changes for other sites.
export function plusView(site, env) {
  if (!plusOn(site)) return null;
  const s = settingsOf(site);
  const api = env.PUBLIC_API || "https://api.vantryai.com";
  return {
    phone: s.textBack && site.plus.number ? prettyPhone(site.plus.number) : null,
    booking: s.booking && s.bookDays.length ? { days: s.bookDays, start: s.bookStart, end: s.bookEnd } : null,
    payUrl: s.payUrl || null,
    chat: s.chat && env.ANTHROPIC_API_KEY ? { endpoint: `${api}/api/chat` } : null,
  };
}

// ---------- Monthly results (shown in the account and the monthly email) ----------

const month = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
export async function bump(env, siteId, key) {
  const k = `pstat:${siteId}:${month()}`;
  const s = (await getJson(env, k)) || {};
  s[key] = (s[key] || 0) + 1;
  await putJson(env, k, s, { expirationTtl: 400 * 86400 });
}
export const plusStats = async (env, siteId, t) => (await getJson(env, `pstat:${siteId}:${month(t)}`)) || {};

// ---------- Billing ----------

export async function startPlusCheckout(env, site, email) {
  if (plusOn(site)) throw httpError(400, "Plus is already on for this site.");
  const api = env.PUBLIC_API || "https://api.vantryai.com";
  const trial = plusTrialDays(env);
  const session = await stripe(env, "/checkout/sessions", {
    mode: "subscription",
    customer_email: email,
    line_items: {
      0: {
        price_data: {
          currency: "usd",
          unit_amount: plusPrice(env),
          recurring: { interval: "month" },
          product_data: { name: "Vantry Plus", description: `Missed-call text-back, leads by text, review requests, booking and a chat helper for ${site.businessName}.` },
        },
        quantity: 1,
      },
    },
    metadata: { plusSiteId: site.id },
    subscription_data: { metadata: { plusSiteId: site.id }, ...(trial ? { trial_period_days: trial } : {}) },
    custom_text: { submit: { message: trial ? `Free for ${trial} days. Cancel any time in your account before then and you won't be charged.` : "Cancel any time in your account." } },
    success_url: `${api}/account/site/${site.id}/plus?started=1`,
    cancel_url: `${api}/account/site/${site.id}/plus`,
  });
  return session.url;
}

export async function billingPortal(env, site) {
  if (!site.plus?.customer) throw httpError(400, "We couldn't find your billing details. Email booking@vantryai.com.");
  const api = env.PUBLIC_API || "https://api.vantryai.com";
  const s = await stripe(env, "/billing_portal/sessions", { customer: site.plus.customer, return_url: `${api}/account/site/${site.id}/plus` });
  return s.url;
}

// Stripe webhook: Plus checkout finished.
export async function onPlusStarted(env, session) {
  const site = await getSite(env, session.metadata?.plusSiteId);
  if (!site) return;
  if (plusOn(site) && site.plus.sub === session.subscription) return; // already handled
  site.plus = { ...(site.plus || {}), status: "active", sub: session.subscription, customer: session.customer, since: Date.now() };
  await putSite(env, site);
  await setUpLine(env, site);
  await send(env, "plusStarted", { site: await getSite(env, site.id) });
}

// Stripe webhook: Plus canceled. The website itself stays online.
export async function onPlusEnded(env, sub) {
  const site = await getSite(env, sub.metadata?.plusSiteId);
  if (!site?.plus || site.plus.sub !== sub.id) return;
  if (site.plus.number) await env.PREVIEWS.delete(`tnum:${site.plus.number}`);
  try { await releaseNumber(env, site.plus.numberSid); } catch (e) { console.log("Release number failed", e.message); }
  site.plus = { ...site.plus, status: "ended", endedAt: Date.now(), number: null, numberSid: null };
  await putSite(env, site);
}

// Gives the site its own local line (needs Twilio). Safe to run again.
export async function setUpLine(env, site) {
  if (!twilioOn(env) || !plusOn(site) || site.plus.number) return site;
  const owner = toE164(site.input?.phone);
  if (!owner) return site; // no phone on the site yet; the Plus page asks for one
  try {
    const { sid, number } = await buyNumber(env, owner, site.businessName);
    site.plus = { ...site.plus, number, numberSid: sid };
    await env.PREVIEWS.put(`tnum:${number}`, site.id);
    await putSite(env, site);
  } catch (e) {
    await send(env, "ownerAlert", { subject: `Plus line for ${site.businessName}`, text: `Couldn't buy a phone number: ${e.message}. Open their Plus page to try again.` });
  }
  return site;
}

// ---------- Settings (from the Plus page) ----------

const httpsUrl = (v) => {
  const s = String(v || "").trim().slice(0, 500);
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === "https:" ? u.href : "";
  } catch { return ""; }
};

export function settingsFromForm(f, site) {
  const on = (k) => f.get(k) === "on";
  const hour = (k, d) => Math.min(23, Math.max(0, parseInt(f.get(k), 10) || d));
  const days = f.getAll("bookDays").map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6);
  const s = {
    textBack: on("textBack"),
    textLeads: on("textLeads"),
    booking: on("booking"),
    bookDays: [...new Set(days)].sort(),
    bookStart: hour("bookStart", 9),
    bookEnd: hour("bookEnd", 17),
    chat: on("chat"),
    reviewUrl: httpsUrl(f.get("reviewUrl")),
    payUrl: httpsUrl(f.get("payUrl")),
    alertPhone: toE164(f.get("alertPhone")) || "",
  };
  let error = "";
  if (s.bookEnd <= s.bookStart) error = "Your booking end time needs to be after the start time.";
  else if (s.booking && !s.bookDays.length) error = "Pick at least one day for booking.";
  else if (String(f.get("reviewUrl") || "").trim() && !s.reviewUrl) error = "The review link doesn't look right. Copy it from your Google Business Profile.";
  else if (String(f.get("payUrl") || "").trim() && !s.payUrl) error = "The payment link doesn't look right. It should start with https://";
  else if (String(f.get("alertPhone") || "").trim() && !s.alertPhone) error = "The phone for text alerts doesn't look like a US number.";
  return { settings: s, error };
}

// Where owner alerts go: the alert phone, else the business phone.
const ownerCell = (site) => settingsOf(site).alertPhone || toE164(site.input?.phone);

// ---------- Review requests ----------

export async function requestReview(env, site, { name, contact }) {
  const s = settingsOf(site);
  if (!s.reviewUrl) throw httpError(400, "Add your Google review link first (below), then you can send requests.");
  name = String(name || "").trim().slice(0, 60);
  contact = String(contact || "").trim().slice(0, 120);
  const phone = toE164(contact);
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact) ? contact.toLowerCase() : null;
  if (!phone && !email) throw httpError(400, "Type the customer's cell number or email.");
  if (!(await rateLimit(env, "review", site.id, 40, 86400))) throw httpError(429, "That's a lot of requests today. Try again tomorrow.");
  const key = `rr:${site.id}:${phone || email}`;
  if (await env.PREVIEWS.get(key)) throw httpError(409, "You already asked this customer in the last 30 days.");
  const hi = name ? `Hi ${name.split(" ")[0]}, ` : "Hi, ";
  if (phone && twilioOn(env)) {
    await sendSmsFrom(env, site.plus?.number, phone, `${hi}thanks for choosing ${site.businessName}! Would you mind leaving us a quick review? It really helps a small business like ours: ${s.reviewUrl}\nReply STOP to opt out.`);
  } else if (email) {
    await sendEmail(env, {
      to: email,
      replyTo: site.leadEmail || site.ownerEmail,
      subject: `Thanks from ${site.businessName}`,
      text: `${hi}\n\nThanks for choosing ${site.businessName}! If you have a minute, would you leave us a quick review? It really helps a small business like ours.\n\n${s.reviewUrl}\n\nThank you,\n${site.businessName}`,
    });
  } else {
    throw httpError(400, "Texting isn't turned on yet. Use the customer's email for now.");
  }
  await env.PREVIEWS.put(key, "1", { expirationTtl: 30 * 86400 });
  await bump(env, site.id, "reviews");
  return { ok: true, via: phone && twilioOn(env) ? "text" : "email" };
}

// ---------- Quote requests (called after the email goes out) ----------

export async function onLead(env, site, lead) {
  if (!plusOn(site) || !twilioOn(env)) return;
  const s = settingsOf(site);
  const when = lead.when ? `\nWants: ${lead.when}` : "";
  if (s.textLeads && ownerCell(site)) {
    await sendSms(env, ownerCell(site), `New request from your website\n${lead.name} · ${lead.contact}${when}\n${(lead.details || "").slice(0, 300)}`).catch((e) => console.log("Lead text failed", e.message));
    await bump(env, site.id, "texts");
  }
  // Answer the customer in seconds. People usually hire whoever replies first.
  const customer = toE164(lead.contact);
  if (customer) {
    await sendSmsFrom(env, site.plus.number, customer, `Thanks ${lead.name.split(" ")[0]}! ${site.businessName} got your request${lead.when ? ` for ${lead.when}` : ""} and will get back to you soon.`).catch((e) => console.log("Customer text failed", e.message));
  }
}

// ---------- Calls and texts to the Vantry line (Twilio webhooks) ----------

export const siteForNumber = async (env, to) => {
  const id = await env.PREVIEWS.get(`tnum:${to}`);
  return id ? getSite(env, id) : null;
};

// The call wasn't answered: text the caller back and tell the owner.
export async function onMissedCall(env, site, caller) {
  if (!plusOn(site)) return;
  const from = toE164(caller);
  if (!from) return;
  if (!(await rateLimit(env, "textback", `${site.id}:${from}`, 1, 3600))) return; // one per caller per hour
  await sendSmsFrom(env, site.plus.number, from, `Hi, this is ${site.businessName}. Sorry we missed your call! How can we help? Reply here and we'll get right back to you.`);
  if (ownerCell(site)) await sendSms(env, ownerCell(site), `Missed call from ${prettyPhone(from)}. We texted them back for you. Call or text them when you can.`).catch(() => {});
  await bump(env, site.id, "missed");
}

// A customer texted the Vantry line: pass it to the owner.
export async function onIncomingText(env, site, from, body) {
  if (!ownerCell(site) || toE164(from) === ownerCell(site)) return;
  await sendSms(env, ownerCell(site), `Text from ${prettyPhone(from)} to your ${site.businessName} line:\n"${String(body || "").slice(0, 400)}"\nText them back at ${prettyPhone(from)}.`);
}

// ---------- Chat helper on customer sites ----------

const CHAT_MODEL = "claude-haiku-5-5";
export async function chat(req, env) {
  const b = await readJson(req);
  const site = /^o[a-z0-9]{12}$/.test(String(b.siteId || "")) && (await getSite(env, b.siteId));
  if (!site || !site.live || !plusOn(site) || !settingsOf(site).chat) throw httpError(400, "Chat isn't available right now.");
  if (!env.ANTHROPIC_API_KEY) throw httpError(503, "Chat isn't available right now.");
  if (!(await rateLimit(env, "chat-ip", clientIp(req), 40, 86400)) || !(await rateLimit(env, "chat-site", site.id, 400, 86400))) {
    throw httpError(429, "Chat is busy right now. Please use the form or call instead.");
  }
  const msgs = (Array.isArray(b.messages) ? b.messages : [])
    .slice(-10)
    .map((m) => ({ role: m?.role === "assistant" ? "assistant" : "user", content: String(m?.content || "").slice(0, 600) }))
    .filter((m) => m.content);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw httpError(400, "Type a question.");
  while (msgs[0]?.role === "assistant") msgs.shift();
  const phone = plusView(site, env)?.phone || site.input?.phone || "";
  const system = `You are the friendly website helper for ${site.businessName}. Answer visitors' questions in 1 to 3 short sentences, using only the business info below.
If the answer isn't in the info (prices, exact availability, anything you're unsure of), say you're not sure and suggest they use the "Let's get started" form on this page${phone ? ` or call or text ${phone}` : ""}.
Never invent prices, discounts, licenses, guarantees, reviews or facts. Don't take bookings or promise times yourself. Plain text only, no markdown.

Business info:
${aiSummary(site.copy, site.input, site.domain)}`;
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.AI_MODEL || CHAT_MODEL, max_tokens: 300, system, messages: msgs }),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw httpError(502, "Sorry, that took too long. Please try again.");
  }
  if (!res.ok) throw httpError(502, "Sorry, chat is busy. Please use the form below.");
  const reply = ((await res.json()).content || []).map((x) => x.text || "").join("").trim().slice(0, 800);
  if (msgs.length === 1) await bump(env, site.id, "chats");
  return { reply: reply || "Sorry, I didn't catch that. Could you ask another way?" };
}
