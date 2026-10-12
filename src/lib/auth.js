// Customer accounts: email + password, so owners can edit their site any time.
//   account:<email>   { email, salt, hash, siteIds: [] }
//   sess:<token>      { email }   (30 days)
//   reset:<token>     { email }   (1 hour, single use; only for "Forgot password?")
//   rev:<siteId>      the version before the last save, for "Undo"
import { getJson, putJson } from "./store.js";
import { randomId } from "./util.js";

// Strong enough for this, and fast enough for the free Cloudflare plan (10ms per request).
// Each account remembers its own count, so this can be raised later.
const ITERATIONS = 25000;
const SESSION_DAYS = 30;
export const MIN_PASSWORD = 8;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: b64(await derive(password, salt)), iter: ITERATIONS };
}

export async function checkPassword(password, { salt, hash, iter }) {
  if (!salt || !hash) return false;
  const got = new Uint8Array(await derive(String(password), unb64(salt), iter || ITERATIONS));
  const want = unb64(hash);
  let diff = got.length ^ want.length;
  for (let i = 0; i < Math.max(got.length, want.length); i++) diff |= (got[i] || 0) ^ (want[i] || 0);
  return diff === 0;
}

export const normEmail = (e = "") => String(e).trim().toLowerCase().slice(0, 120);
export const getAccount = (env, email) => getJson(env, `account:${normEmail(email)}`);
export const putAccount = (env, acct) => putJson(env, `account:${acct.email}`, acct);

// Adds a site to an account, creating the account if it doesn't exist yet.
export async function attachSite(env, email, siteId, pw) {
  email = normEmail(email);
  let acct = await getAccount(env, email);
  if (!acct) {
    if (!pw) return null;
    acct = { email, ...pw, siteIds: [], createdAt: Date.now() };
  }
  if (!acct.siteIds.includes(siteId)) acct.siteIds.push(siteId);
  await putAccount(env, acct);
  return acct;
}

export async function startSession(env, email) {
  const token = randomId(40);
  await putJson(env, `sess:${token}`, { email: normEmail(email), at: Date.now() }, { expirationTtl: SESSION_DAYS * 86400 });
  return `vs=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export async function endSession(env, req) {
  const t = sessionToken(req);
  if (t) await env.PREVIEWS.delete(`sess:${t}`);
  return "vs=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

function sessionToken(req) {
  const m = (req.headers.get("Cookie") || "").match(/(?:^|;\s*)vs=([a-z0-9]{40})/);
  return m ? m[1] : null;
}

// Returns the signed-in account, or null.
export async function currentAccount(env, req) {
  const t = sessionToken(req);
  if (!t) return null;
  const s = await getJson(env, `sess:${t}`);
  return s ? getAccount(env, s.email) : null;
}

export async function makeResetToken(env, email) {
  const token = randomId(40);
  await putJson(env, `reset:${token}`, { email: normEmail(email) }, { expirationTtl: 3600 });
  return token;
}
export const readResetToken = (env, token) => (/^[a-z0-9]{40}$/.test(token || "") ? getJson(env, `reset:${token}`) : null);
export const useResetToken = (env, token) => env.PREVIEWS.delete(`reset:${token}`);
