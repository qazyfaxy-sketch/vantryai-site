// Cloudflare API calls: buying domains (Registrar API), DNS, routing and
// customer-owned domains (Cloudflare for SaaS custom hostnames).
import { MAX_INCLUDED_DOMAIN_COST } from "./domains.js";

const API = "https://api.cloudflare.com/client/v4";

async function cf(env, path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { success: false, errors: [{ message: `HTTP ${res.status}` }] };
  }
  data.httpStatus = res.status;
  return data;
}

const errText = (d) => (d.errors || []).map((e) => `${e.code || ""} ${e.message || ""}`.trim()).join("; ") || `HTTP ${d.httpStatus}`;
const num = (v) => (v === undefined || v === null || v === "" ? null : parseFloat(v));

// ---------- Registrar ----------

// Returns [{ name, available, included, price, renewal, reason }]
export async function checkDomains(env, names) {
  if (!names.length) return [];
  const d = await cf(env, `/accounts/${env.CF_ACCOUNT_ID}/registrar/domain-check`, {
    method: "POST",
    body: { domains: names.slice(0, 20) },
  });
  if (!d.success) throw new Error(`Domain check failed: ${errText(d)}`);
  const rows = d.result?.domains || [];
  return names.map((name) => {
    const r = rows.find((x) => x.name === name);
    if (!r) return { name, available: false, reason: "unknown" };
    const price = num(r.pricing?.registration_cost);
    const renewal = num(r.pricing?.renewal_cost);
    const included =
      r.registrable === true &&
      r.tier !== "premium" &&
      price !== null &&
      price <= MAX_INCLUDED_DOMAIN_COST &&
      (renewal === null || renewal <= MAX_INCLUDED_DOMAIN_COST);
    return { name, available: r.registrable === true, included, price, renewal, reason: r.reason || (r.tier === "premium" ? "premium" : null) };
  });
}

// Stripe gives "+16145550142"; the registrar wants "+1.6145550142".
export function registrarPhone(p = "") {
  const digits = String(p).replace(/[^\d+]/g, "");
  const m = digits.match(/^\+?(1)(\d{10})$/) || digits.match(/^\+(\d{1,3})(\d{4,14})$/);
  return m ? `+${m[1]}.${m[2]}` : null;
}

export function registrantFrom(contact = {}, businessName = "") {
  const a = contact.address || {};
  const phone = registrarPhone(contact.phone);
  if (!contact.email || !phone || !a.line1 || !a.city || !a.postal_code || !a.country) return null;
  return {
    email: contact.email,
    phone,
    postal_info: {
      name: contact.name || businessName,
      organization: businessName || undefined,
      address: {
        street: [a.line1, a.line2].filter(Boolean).join(", "),
        city: a.city,
        state: a.state || "",
        postal_code: a.postal_code,
        country_code: a.country,
      },
    },
  };
}

// Returns { state: "succeeded"|"in_progress"|"failed"|"action_required"|"blocked", error? }
export async function registerDomain(env, name, registrant) {
  const body = { domain_name: name, auto_renew: true };
  if (registrant) body.contacts = { registrant };
  const d = await cf(env, `/accounts/${env.CF_ACCOUNT_ID}/registrar/registrations`, { method: "POST", body });
  if (!d.success) {
    // Already registered to this account (e.g. a retried webhook) counts as done.
    const status = await registrationStatus(env, name);
    if (status.state === "succeeded" || status.state === "in_progress") return status;
    return { state: "failed", error: errText(d) };
  }
  return { state: d.result?.state || (d.result?.completed ? "succeeded" : "in_progress") };
}

export async function registrationStatus(env, name) {
  const d = await cf(env, `/accounts/${env.CF_ACCOUNT_ID}/registrar/registrations/${name}/registration-status`);
  if (!d.success) return { state: "unknown", error: errText(d) };
  const r = d.result || {};
  return { state: r.state || (r.completed ? "succeeded" : "in_progress"), error: r.error?.message || null };
}

// ---------- Domains we bought: zone, DNS and routing to this Worker ----------

export async function ensureZone(env, name) {
  const found = await cf(env, `/zones?name=${encodeURIComponent(name)}`);
  if (found.success && found.result?.length) return found.result[0].id;
  const made = await cf(env, `/zones`, {
    method: "POST",
    body: { name, account: { id: env.CF_ACCOUNT_ID }, type: "full" },
  });
  if (!made.success) throw new Error(`Could not add ${name} to Cloudflare: ${errText(made)}`);
  return made.result.id;
}

async function ensureRecord(env, zoneId, rec) {
  const q = await cf(env, `/zones/${zoneId}/dns_records?name=${encodeURIComponent(rec.name)}`);
  if (q.success && q.result?.length) return;
  const d = await cf(env, `/zones/${zoneId}/dns_records`, { method: "POST", body: rec });
  if (!d.success) throw new Error(`DNS setup failed for ${rec.name}: ${errText(d)}`);
}

async function ensureRoute(env, zoneId, pattern) {
  const q = await cf(env, `/zones/${zoneId}/workers/routes`);
  if (q.success && (q.result || []).some((r) => r.pattern === pattern)) return;
  const d = await cf(env, `/zones/${zoneId}/workers/routes`, {
    method: "POST",
    body: { pattern, script: env.WORKER_NAME },
  });
  if (!d.success) throw new Error(`Routing failed for ${pattern}: ${errText(d)}`);
}

// Points domain.com and www.domain.com at this Worker. 192.0.2.1 is a
// placeholder address: the Worker answers every request, so it's never reached.
export async function connectBoughtDomain(env, name) {
  const zoneId = await ensureZone(env, name);
  await ensureRecord(env, zoneId, { type: "A", name, content: "192.0.2.1", proxied: true, ttl: 1 });
  await ensureRecord(env, zoneId, { type: "CNAME", name: `www.${name}`, content: name, proxied: true, ttl: 1 });
  await ensureRoute(env, zoneId, `${name}/*`);
  await ensureRoute(env, zoneId, `www.${name}/*`);
  return zoneId;
}

// ---------- Domains the customer already owns (Cloudflare for SaaS) ----------

export async function getCustomHostname(env, hostname) {
  const d = await cf(env, `/zones/${env.CF_SAAS_ZONE_ID}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  return d.success && d.result?.length ? d.result[0] : null;
}

export async function addCustomHostname(env, hostname) {
  const existing = await getCustomHostname(env, hostname);
  if (existing) return existing;
  const d = await cf(env, `/zones/${env.CF_SAAS_ZONE_ID}/custom_hostnames`, {
    method: "POST",
    body: { hostname, ssl: { method: "http", type: "dv" } },
  });
  if (!d.success) throw new Error(`Could not connect ${hostname}: ${errText(d)}`);
  return d.result;
}

// True once the customer's DNS points at us and the certificate is issued.
export const hostnameIsActive = (h) => h && h.status === "active" && (!h.ssl || h.ssl.status === "active");
