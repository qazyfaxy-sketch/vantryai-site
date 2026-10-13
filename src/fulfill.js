// What happens after payment, step by step. Every step is safe to run twice,
// because Stripe can resend webhooks and the 10-minute job retries waiting orders.
//
//   paid -> domain_registering -> needs_review -> (you approve) -> live
//                   \-> domain_problem (you get an email; "Retry setup" in admin)
//   own domain: paid -> waiting_dns -> needs_review/approved -> live
import { getOrder, saveOrder, getPreview, getSite, putSite, setHost, removeHost, markPending, clearPending } from "./lib/store.js";
import { registerDomain, registrationStatus, registrantFrom, connectBoughtDomain, addCustomHostname, getCustomHostname, hostnameIsActive } from "./lib/cloudflare.js";
import { scheduleMonthlyPlan } from "./lib/stripe.js";
import { send } from "./lib/email.js";
import { attachSite } from "./lib/auth.js";
import { queueSitePhoto, imagesOn } from "./lib/images.js";
import { stopNurture } from "./lib/nurture.js";

const DNS_GIVE_UP_DAYS = 14;

export async function onCheckoutCompleted(env, session) {
  const orderId = session.metadata?.orderId || session.client_reference_id;
  const order = orderId && (await getOrder(env, orderId));
  if (!order) {
    await send(env, "ownerAlert", { subject: "Payment with no order", text: `Stripe checkout ${session.id} has no matching order. Check Stripe.` });
    return;
  }
  if (order.status !== "checkout") return; // already handled

  order.status = "paid";
  order.paidAt = Date.now();
  order.stripe = { session: session.id, customer: session.customer, subscription: session.subscription };
  order.contact = session.customer_details || {};
  if (order.contact.email) order.billingEmail = order.contact.email;

  // Copy the preview into a permanent site record (previews expire after 30 days).
  await stopNurture(env, order.previewId); // they bought: no more reminders
  const preview = await getPreview(env, order.previewId);
  if (!preview) {
    await saveOrder(env, order, "Paid, but the preview had expired");
    await send(env, "ownerAlert", { subject: `Preview expired for ${order.businessName}`, text: `Order ${order.id} was paid but its preview is gone. Rebuild it by hand.` });
    return;
  }
  const site = {
    id: order.id,
    businessName: preview.input.businessName,
    city: preview.input.city,
    ownerEmail: order.email,
    domain: order.domain.name,
    style: order.style,
    copy: preview.copy,
    input: preview.input,
    live: false,
    createdAt: Date.now(),
  };
  site.leadEmail = order.email;
  await putSite(env, site);
  await setHost(env, order.domain.name, site.id); // shows "coming soon" until you approve
  await attachSite(env, order.email, site.id, order.pw); // their login for editing the site
  delete order.pw;
  if (imagesOn(env)) await queueSitePhoto(env, site.id); // a unique AI photo for their site
  await saveOrder(env, order, "Payment received");

  if (order.plan === "monthly" && session.subscription) {
    try {
      order.stripe.schedule = await scheduleMonthlyPlan(env, session.subscription);
      await saveOrder(env, order, "Set up 12 x $49, then $50/year");
    } catch (e) {
      await send(env, "ownerAlert", { subject: `Monthly schedule for ${site.businessName}`, text: `Couldn't set the 12-month schedule on subscription ${session.subscription}: ${e.message}. Set it in Stripe by hand.` });
    }
  }

  await send(env, "orderReceived", { order, site });
  await send(env, "ownerNewOrder", { order, site });
  await advance(env, order);
}

// Moves an order forward as far as it can go right now.
export async function advance(env, order) {
  if (["live", "canceled", "checkout"].includes(order.status)) {
    await clearPending(env, order.id);
    return order;
  }
  try {
    if (!order.domain.ready) {
      if (order.domain.mode === "new") await stepRegister(env, order);
      else await stepOwnDomain(env, order);
    }
  } catch (e) {
    order.status = "domain_problem";
    await saveOrder(env, order, e.message.slice(0, 300));
    await clearPending(env, order.id);
    await send(env, "ownerAlert", { subject: `Domain setup for ${order.businessName}`, text: `${e.message}\n\nFix it, then press "Retry setup":\n${env.PUBLIC_API}/admin?token=${env.ADMIN_TOKEN}` });
    return order;
  }

  if (order.domain.ready) {
    if (order.approved) return goLive(env, order);
    if (order.status !== "needs_review") {
      order.status = "needs_review";
      await saveOrder(env, order, "Domain ready. Waiting for your approval");
    }
    await clearPending(env, order.id);
  }
  return order;
}

async function stepRegister(env, order) {
  const name = order.domain.name;
  let state;
  if (!order.domain.requested) {
    const registrant = registrantFrom(order.contact, order.businessName);
    const r = await registerDomain(env, name, registrant);
    order.domain.requested = true;
    order.domain.registrant = registrant ? "customer" : "account-default";
    state = r.state;
    if (r.error) order.domain.lastError = r.error;
  } else {
    const r = await registrationStatus(env, name);
    state = r.state;
    if (r.error) order.domain.lastError = r.error;
  }

  if (state === "succeeded") {
    await connectBoughtDomain(env, name);
    order.domain.ready = true;
    await saveOrder(env, order, `Registered ${name} and connected it`);
    return;
  }
  if (state === "in_progress" || state === "unknown") {
    order.status = "domain_registering";
    await saveOrder(env, order, `Registering ${name}`);
    await markPending(env, order.id);
    return;
  }
  // failed, action_required or blocked
  order.domain.requested = false; // "Retry setup" will try registering again
  throw new Error(`Registering ${name} ${state}: ${order.domain.lastError || "no details"}`);
}

async function stepOwnDomain(env, order) {
  const host = `www.${order.domain.name}`;
  const ch = (await getCustomHostname(env, host)) || (await addCustomHostname(env, host));
  if (hostnameIsActive(ch)) {
    order.domain.ready = true;
    await saveOrder(env, order, `${host} is connected`);
    return;
  }
  const days = (Date.now() - (order.paidAt || Date.now())) / 86400000;
  if (days > DNS_GIVE_UP_DAYS && !order.domain.nudged) {
    order.domain.nudged = true;
    await send(env, "ownerAlert", { subject: `${order.businessName} hasn't connected their domain`, text: `It's been ${DNS_GIVE_UP_DAYS} days. Reach out to ${order.email} and help them connect ${order.domain.name}.` });
  }
  if (order.status !== "waiting_dns") {
    order.status = "waiting_dns";
    await saveOrder(env, order, `Waiting for ${host} to point to us`);
  }
  await markPending(env, order.id);
}

export async function goLive(env, order) {
  const site = await getSite(env, order.id);
  if (!site) throw new Error("Site record missing");
  site.live = true;
  site.offline = false;
  site.liveAt = Date.now();
  await putSite(env, site);
  await setHost(env, order.domain.name, site.id);
  const firstTime = order.status !== "live" && !order.wentLiveAt;
  order.status = "live";
  order.wentLiveAt ||= Date.now();
  await saveOrder(env, order, "Live");
  await clearPending(env, order.id);
  if (firstTime) await send(env, "siteLive", { order, site });
  return order;
}

export async function approve(env, orderId) {
  const order = await getOrder(env, orderId);
  if (!order) throw new Error("No such order");
  order.approved = true;
  await saveOrder(env, order, "Approved");
  return advance(env, order);
}

export async function retry(env, orderId) {
  const order = await getOrder(env, orderId);
  if (!order) throw new Error("No such order");
  if (order.status === "domain_problem") order.status = "paid";
  await saveOrder(env, order, "Retrying setup");
  return advance(env, order);
}

export async function takeOffline(env, orderId, reason) {
  const order = await getOrder(env, orderId);
  if (!order) return null;
  const site = await getSite(env, order.id);
  if (site) {
    site.live = false;
    site.offline = true;
    await putSite(env, site);
  }
  order.status = "canceled";
  await saveOrder(env, order, reason);
  await clearPending(env, order.id);
  return order;
}

export async function putBackOnline(env, orderId) {
  const order = await getOrder(env, orderId);
  if (!order) throw new Error("No such order");
  order.status = "paid";
  order.approved = true;
  await saveOrder(env, order, "Putting back online");
  return advance(env, order);
}

// Called by Stripe when a subscription ends (customer canceled, or payments failed).
export async function onSubscriptionEnded(env, sub) {
  const orderId = sub.metadata?.orderId;
  if (!orderId) return;
  const order = await takeOffline(env, orderId, "Subscription ended in Stripe");
  if (order) {
    await send(env, "ownerAlert", { subject: `${order.businessName}'s plan ended`, text: `Their subscription ended, so ${order.domain.name} now shows an "offline" page. The domain stays theirs.` });
  }
}

// Runs every 10 minutes: checks on domains that were still registering or waiting for DNS.
export async function runPending(env, listPending) {
  const ids = await listPending(env);
  for (const id of ids.slice(0, 40)) {
    const order = await getOrder(env, id);
    if (!order) {
      await clearPending(env, id);
      continue;
    }
    await advance(env, order);
  }
  return ids.length;
}

export { removeHost };
