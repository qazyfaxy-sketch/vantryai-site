// Everything is stored in one KV namespace (binding: PREVIEWS) using key prefixes:
//   preview:<id>        survey answers + AI copy (expires after 30 days)
//   order:<id>          an order and its progress
//   pending:<id>        orders the 10-minute job should keep working on
//   site:<id>           a customer's finished site (html + live flag)
//   host:<hostname>     which site a domain shows
//   lead:<siteId>:<ts>  quote requests from a customer's site

const PREVIEW_TTL = 60 * 60 * 24 * 30;

export async function getJson(env, key) {
  const raw = await env.PREVIEWS.get(key);
  return raw ? JSON.parse(raw) : null;
}
export async function putJson(env, key, value, opts) {
  await env.PREVIEWS.put(key, JSON.stringify(value), opts);
}

export const getPreview = (env, id) => getJson(env, `preview:${id}`);
export const putPreview = (env, id, v) => putJson(env, `preview:${id}`, v, { expirationTtl: PREVIEW_TTL });

export const getOrder = (env, id) => getJson(env, `order:${id}`);
export async function saveOrder(env, order, note) {
  order.updatedAt = Date.now();
  if (note) (order.history ||= []).push({ at: order.updatedAt, status: order.status, note });
  await putJson(env, `order:${order.id}`, order);
  return order;
}

// Orders waiting on something outside our control (domain registration, customer DNS).
export const markPending = (env, id) => env.PREVIEWS.put(`pending:${id}`, "1");
export const clearPending = (env, id) => env.PREVIEWS.delete(`pending:${id}`);
export async function listPending(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.PREVIEWS.list({ prefix: "pending:", cursor });
    out.push(...page.keys.map((k) => k.name.slice("pending:".length)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

export async function listOrders(env) {
  const ids = [];
  let cursor;
  do {
    const page = await env.PREVIEWS.list({ prefix: "order:", cursor });
    ids.push(...page.keys.map((k) => k.name.slice("order:".length)));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const orders = await Promise.all(ids.map((id) => getOrder(env, id)));
  return orders.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

export const getSite = (env, id) => getJson(env, `site:${id}`);
export const putSite = (env, site) => putJson(env, `site:${site.id}`, site);

export const normalizeHost = (h = "") => String(h).toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
export const getHostSiteId = (env, host) => env.PREVIEWS.get(`host:${normalizeHost(host)}`);
export const setHost = (env, host, siteId) => env.PREVIEWS.put(`host:${normalizeHost(host)}`, siteId);
export const removeHost = (env, host) => env.PREVIEWS.delete(`host:${normalizeHost(host)}`);

export async function addLead(env, siteId, lead) {
  const ts = Date.now();
  await putJson(env, `lead:${siteId}:${ts}`, { ...lead, at: ts });
}
