// Follow-up emails for people who made a free preview but haven't bought.
// Most buyers decide after a reminder or two, so this is where many sales come from.
//   nurture:<previewId>  { email, name, createdAt, step }
//   unsub:<email>        set when they click "stop these emails"
// Schedule (days after the preview): 1, 3, 7, 14. Stops as soon as they pay or unsubscribe.
// Previews are kept 30 days, so the last email is a real "2 more weeks" reminder.
import { getJson, putJson, getPreview } from "./store.js";
import { sendEmail } from "./email.js";
import { normEmail } from "./auth.js";

const DAYS = [1, 3, 7, 14];
const PER_RUN = 60;
const DAY = 86400000;

export async function startNurture(env, previewId, input) {
  const email = normEmail(input.email);
  if (!email || (await env.PREVIEWS.get(`unsub:${email}`))) return;
  await putJson(env, `nurture:${previewId}`, { email, name: input.businessName, createdAt: Date.now(), step: 0 }, { expirationTtl: 31 * 86400 });
}

export const stopNurture = (env, previewId) => env.PREVIEWS.delete(`nurture:${previewId}`);

export async function unsubscribe(env, previewId) {
  const n = await getJson(env, `nurture:${previewId}`);
  const preview = n ? null : await getPreview(env, previewId);
  const email = n?.email || normEmail(preview?.input?.email);
  if (email) await env.PREVIEWS.put(`unsub:${email}`, "1");
  await stopNurture(env, previewId);
  return !!email;
}

function footer(env, previewId) {
  const api = env.PUBLIC_API || "https://api.vantryai.com";
  return `\n\n—\nVantry · booking@vantryai.com${env.MAILING_ADDRESS ? ` · ${env.MAILING_ADDRESS}` : ""}\nYou're getting this because you made a free preview at vantryai.com. Stop these emails: ${api}/u/${previewId}`;
}

export function nurtureEmail(step, { name, previewId, env }) {
  const api = env.PUBLIC_API || "https://api.vantryai.com";
  const link = (s) => `${api}/p/${previewId}?style=${s}`;
  const go = `${api}/go/${previewId}`;
  const emails = [
    {
      subject: `Your 3 designs for ${name} are saved`,
      text: `Hi,

Your free website designs for ${name} are still saved:

Modern: ${link("modern")}
Editorial: ${link("editorial")}
Minimal: ${link("minimal")}

Like one? Pick your web address and go live here:
${go}

It's $199.99 one time, your domain is included, and you get a full refund if you change your mind before it goes live.`,
    },
    {
      subject: `What's included with ${name}'s website`,
      text: `Hi,

Quick rundown of what you get with your ${name} site:

- Your own web address (included)
- A quote form that sends requests straight to your email
- Call and text buttons for phones
- Set up so Google and ChatGPT can find you
- An easy editor: change words and photos any time, or just tell the AI what to change
- A simple dashboard showing visits, calls and quote requests

$199.99 one time, then $50/year from year two. Full refund before launch.

See your designs: ${link("modern")}`,
    },
    {
      subject: `Want anything changed on your ${name} site?`,
      text: `Hi,

If something about your preview wasn't quite right (the wording, the colors, a service that's missing), just reply and tell me. Once you're live, you can also change anything yourself in a minute.

Your designs: ${link("modern")}
Ready to go live: ${go}

One quick question while I have you: would you pay $19/month for an automatic text that goes out when you miss a call, so the customer doesn't call someone else? Just reply "yes" or "no". It really helps.`,
    },
    {
      subject: `Your ${name} preview is saved for about 2 more weeks`,
      text: `Hi,

Last note from me: your free website designs for ${name} are saved for about two more weeks, then they're cleared.

If you'd like to keep one, you can go live here:
${go}

Not the right time? No problem, you won't hear from me again about this preview.`,
    },
  ];
  return emails[step];
}

// Runs every 10 minutes from the scheduled job.
export async function runNurture(env, now = Date.now()) {
  if (!env.RESEND_API_KEY) return 0;
  let sent = 0;
  let cursor;
  do {
    const page = await env.PREVIEWS.list({ prefix: "nurture:", cursor });
    for (const k of page.keys) {
      if (sent >= PER_RUN) return sent;
      const previewId = k.name.slice("nurture:".length);
      const n = await getJson(env, k.name);
      if (!n || n.step >= DAYS.length) { await env.PREVIEWS.delete(k.name); continue; }
      if (now - n.createdAt < DAYS[n.step] * DAY) continue;
      if (await env.PREVIEWS.get(`unsub:${n.email}`)) { await env.PREVIEWS.delete(k.name); continue; }
      const msg = nurtureEmail(n.step, { name: n.name, previewId, env });
      await sendEmail(env, { to: n.email, subject: msg.subject, text: msg.text + footer(env, previewId), replyTo: env.OWNER_EMAIL });
      n.step++;
      if (n.step >= DAYS.length) await env.PREVIEWS.delete(k.name);
      else await putJson(env, k.name, n, { expirationTtl: 31 * 86400 });
      sent++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return sent;
}
