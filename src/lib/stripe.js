// Stripe: secure checkout pages, signed webhooks and the monthly-plan schedule.
// Prices are created on the fly (price_data), so nothing needs setting up in Stripe first.
import { httpError } from "./util.js";

const API = "https://api.stripe.com/v1";
// Pinned so Stripe changes can't silently break checkout.
const STRIPE_VERSION = "2024-06-20";

export const PLANS = {
  once: { label: "Pay once", today: 20000, summary: "$200 today, then $50/year from year two" },
  monthly: { label: "Pay monthly", today: 4900, summary: "$49/month for 12 months, then $50/year" },
};

// Stripe wants form encoding with bracket keys: line_items[0][price_data][currency]=usd
export function formEncode(obj, prefix, out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(env, path, params, method = "POST") {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_VERSION,
    },
    body: method === "GET" ? undefined : formEncode(params || {}).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${path} failed: ${data.error?.message || res.status}`);
  return data;
}

export async function createCheckout(env, { order, businessName, publicBase }) {
  const product = (name, description) => ({ name, description });
  const items =
    order.plan === "once"
      ? [
          {
            price_data: { currency: "usd", unit_amount: 15000, product_data: product("Website build", `${businessName} website, built and launched`) },
            quantity: 1,
          },
          {
            price_data: {
              currency: "usd",
              unit_amount: 5000,
              recurring: { interval: "year" },
              product_data: product("Website hosting + domain", `Keeps ${order.domain.name} online. First year included today.`),
            },
            quantity: 1,
          },
        ]
      : [
          {
            price_data: {
              currency: "usd",
              unit_amount: 4900,
              recurring: { interval: "month" },
              product_data: product("Website plan, 12-month minimum", `${businessName} website, domain and hosting. Then $50/year after 12 months.`),
            },
            quantity: 1,
          },
        ];

  const session = await stripe(env, "/checkout/sessions", {
    mode: "subscription",
    line_items: Object.fromEntries(items.map((it, i) => [i, it])),
    customer_email: order.email,
    client_reference_id: order.id,
    metadata: { orderId: order.id },
    subscription_data: { metadata: { orderId: order.id } },
    billing_address_collection: "required",
    phone_number_collection: { enabled: true },
    allow_promotion_codes: true,
    custom_text: {
      submit: { message: "Full refund if you change your mind before your site goes live." },
    },
    success_url: `${publicBase}/thanks/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicBase}/go/${order.previewId}?style=${order.style}`,
  });
  return session;
}

// After the first monthly payment: 12 months at $49, then $50/year, automatically.
export async function scheduleMonthlyPlan(env, subscriptionId) {
  const sub = await stripe(env, `/subscriptions/${subscriptionId}`, null, "GET");
  if (sub.schedule) return sub.schedule;
  const item = sub.items.data[0];
  const sched = await stripe(env, "/subscription_schedules", { from_subscription: subscriptionId });
  await stripe(env, `/subscription_schedules/${sched.id}`, {
    end_behavior: "release",
    phases: {
      0: { start_date: sched.phases[0].start_date, items: { 0: { price: item.price.id, quantity: 1 } }, iterations: 12 },
      1: {
        items: {
          0: {
            price_data: { currency: "usd", product: item.price.product, unit_amount: 5000, recurring: { interval: "year" } },
            quantity: 1,
          },
        },
      },
    },
  });
  return sched.id;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function signPayload(secret, timestamp, body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

// Checks the Stripe-Signature header so nobody can fake a "payment received" event.
export async function verifyWebhook(env, body, header, toleranceSeconds = 300) {
  if (!header || !env.STRIPE_WEBHOOK_SECRET) throw httpError(400, "Missing signature");
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const sigs = header.split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3));
  const t = parseInt(parts.t, 10);
  if (!t || !sigs.length) throw httpError(400, "Bad signature header");
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds) throw httpError(400, "Signature too old");
  const expected = await signPayload(env.STRIPE_WEBHOOK_SECRET, t, body);
  if (!sigs.some((s) => s.length === expected.length && timingSafe(s, expected))) throw httpError(400, "Bad signature");
  return JSON.parse(body);
}

function timingSafe(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
