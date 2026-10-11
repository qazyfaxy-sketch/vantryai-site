// Small helpers shared by every part of the engine.

export const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

export function randomId(len = 10) {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => a[b % a.length]).join("");
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw httpError(400, "Something was wrong with that request. Please try again.");
  }
}

export function clientIp(req) {
  return req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "unknown";
}

// Simple fixed-window rate limit stored in KV. Good enough for low volume:
// KV is eventually consistent, so a burst can slip a few requests past the limit.
export async function rateLimit(env, bucket, key, limit, windowSeconds) {
  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const k = `rl:${bucket}:${key}:${windowId}`;
  const used = parseInt((await env.PREVIEWS.get(k)) || "0", 10);
  if (used >= limit) return false;
  await env.PREVIEWS.put(k, String(used + 1), { expirationTtl: Math.max(60, windowSeconds * 2) });
  return true;
}

// Compares secrets without leaking how many characters matched.
export function safeEqual(a = "", b = "") {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
