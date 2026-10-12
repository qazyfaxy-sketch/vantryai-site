// Emails sent through Resend (resend.com). Every email is plain and short.
// If RESEND_API_KEY isn't set, emails are skipped and the rest keeps working.
import { esc } from "./util.js";

export async function sendEmail(env, { to, subject, text, replyTo }) {
  if (!env.RESEND_API_KEY || !to) return { skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM || "Vantry <hello@vantryai.com>",
        to: [to],
        subject,
        text,
        html: layout(text),
        reply_to: replyTo || env.OWNER_EMAIL || undefined,
      }),
    });
    if (!res.ok) console.log("Email failed", res.status, await res.text());
    return { ok: res.ok };
  } catch (e) {
    console.log("Email error", e.message);
    return { ok: false };
  }
}

function layout(text) {
  const body = esc(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#3B88DA">$1</a>')}</p>`)
    .join("");
  return `<div style="font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#1B1D33;max-width:560px;margin:0 auto;padding:24px">
<p style="font-weight:700;font-size:20px;letter-spacing:-.5px;margin:0 0 20px">vantry<span style="color:#3B88DA">.</span></p>${body}</div>`;
}

const sign = "Thanks,\nVantry\nbooking@vantryai.com";
const ACCOUNT = "https://api.vantryai.com/login";

export function dnsSteps(domain, target) {
  return `To connect ${domain}, log in to the company where you bought it and add these two settings:

1. A CNAME record: name "www", value "${target}"
2. A forward (sometimes called a redirect) from ${domain} to https://www.${domain}

Not sure how? Reply with the name of the company you bought it from (for example GoDaddy or Squarespace) and we'll send exact steps.`;
}

export const templates = {
  orderReceived: ({ order, site, env }) => ({
    to: order.email,
    subject: `Payment received: your website is being set up`,
    text: `Hi,

Thanks for choosing Vantry. We received your payment for ${site.businessName}.

What happens next:
- ${order.domain.mode === "new" ? `We're registering ${order.domain.name} for you. It's yours to keep.` : `You'll connect your domain, ${order.domain.name} (steps below).`}
- A real person checks your site.
- We email you as soon as it's live, usually within 2 business days.

${order.domain.mode === "own" ? dnsSteps(order.domain.name, env.SAAS_CNAME_TARGET || "sites.vantryai.com") + "\n\n" : ""}You can log in and edit your site any time, with this email and the password you picked:
${ACCOUNT}

Changed your mind? You get a full refund any time before your site goes live. Just reply to this email.

${sign}`,
  }),

  ownerNewOrder: ({ order, site, env }) => ({
    to: env.OWNER_EMAIL,
    subject: `New order: ${site.businessName} (${order.plan === "once" ? "$199.99" : "$49/mo"})`,
    text: `New order ${order.id}
Business: ${site.businessName}, ${site.city}
Customer: ${order.contact?.name || ""} ${order.email}
Domain: ${order.domain.name} (${order.domain.mode === "new" ? "we register it" : "they own it"})
Style: ${order.style}

Review and approve it here:
${env.PUBLIC_API}/admin?token=${env.ADMIN_TOKEN}`,
  }),

  siteLive: ({ order, site }) => ({
    to: order.email,
    subject: `Your website is live: ${order.domain.name}`,
    text: `Hi,

Good news: ${site.businessName} is live at https://www.${order.domain.name}

Quote requests from your site will come straight to this email address.

A few ideas to get more calls:
- Add the link to your Google Business Profile and Facebook page.
- Put it on your truck, cards and invoices.

Want to change something? Log in and edit your site any time. Changes show up within a minute:
${ACCOUNT}

Stuck? Just reply to this email.

${sign}`,
  }),

  newLead: ({ site, lead }) => ({
    to: site.leadEmail || site.ownerEmail,
    replyTo: /@/.test(lead.contact) ? lead.contact : undefined,
    subject: `New quote request from your website`,
    text: `You have a new quote request from ${site.domain || "your website"}.

Name: ${lead.name}
Phone or email: ${lead.contact}
What they need: ${lead.details || "(not given)"}

Reply fast: people often hire the first business that gets back to them.

Sent by Vantry`,
  }),

  resetLink: ({ email, link }) => ({
    to: email,
    subject: "Reset your Vantry password",
    text: `Hi,

Someone asked to reset the password for your Vantry account. Pick a new one here (the link works for 1 hour):
${link}

Didn't ask for this? You can ignore this email. Your password stays the same.

${sign}`,
  }),

  monthlyReport: ({ site, stats }) => {
    const t = stats.totals;
    const n = (x) => x.toLocaleString("en-US");
    const lines = [
      stats.visitsReady && `- ${n(t.view)} visits`,
      stats.visitsReady && `- ${n(t.call)} taps on Call`,
      stats.visitsReady && t.text && `- ${n(t.text)} taps on Text`,
      `- ${n(t.quote)} quote request${t.quote === 1 ? "" : "s"}`,
    ].filter(Boolean).join("\n");
    const tip = t.quote || t.call ? "Reply fast to new requests. People often hire the first business that gets back to them." : "Tip: add your website to your Google Business Profile, Facebook page and business cards. More places means more visits.";
    return {
      to: site.leadEmail || site.ownerEmail,
      subject: `Your website this month: ${stats.visitsReady ? `${n(t.view)} visits, ` : ""}${n(t.quote)} quote request${t.quote === 1 ? "" : "s"}`,
      text: `Hi,

Here's how ${site.businessName}'s website did in the last 30 days:

${lines}

${tip}

Want to change anything? Log in and edit your site any time:
${ACCOUNT}

${sign}`,
    };
  },

  ownerAlert: ({ env, subject, text }) => ({ to: env.OWNER_EMAIL, subject: `Action needed: ${subject}`, text }),
};

export const send = (env, name, data) => sendEmail(env, templates[name]({ ...data, env }));
