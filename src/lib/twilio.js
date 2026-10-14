// Twilio: phone numbers, texts and calls for Vantry Plus.
// Turns on when the TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN secrets are set.
// US texting also needs carrier approval (A2P 10DLC). Put the approved Messaging Service's
// id in TWILIO_MESSAGING_SERVICE_SID and every new number is added to it automatically.
const API = "https://api.twilio.com/2010-04-01";
const MSG_API = "https://messaging.twilio.com/v1";

export const twilioOn = (env) => !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);

// "(614) 555-0101" -> "+16145550101". Only US/Canada numbers.
export function toE164(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === "1") return `+${d}`;
  return null;
}

// "+16145550101" -> "(614) 555-0101"
export function prettyPhone(e164) {
  const d = String(e164 || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(e164 || "");
}

async function tw(env, url, params, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" || method === "DELETE" ? undefined : new URLSearchParams(params || {}).toString(),
    signal: AbortSignal.timeout(20000),
  });
  if (method === "DELETE") {
    if (!res.ok && res.status !== 404) throw new Error(`Twilio delete failed: ${res.status}`);
    return null;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(`Twilio: ${data.message || res.status}`);
  return data;
}

const acct = (env) => `${API}/Accounts/${env.TWILIO_ACCOUNT_SID}`;

export async function sendSms(env, to, body) {
  const To = toE164(to);
  if (!twilioOn(env) || !To) return null;
  const params = { To, Body: String(body).slice(0, 640) };
  if (env.TWILIO_MESSAGING_SERVICE_SID) params.MessagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  else if (env.TWILIO_FROM) params.From = env.TWILIO_FROM;
  else return null;
  return tw(env, `${acct(env)}/Messages.json`, params);
}

// Texts from a site's own Vantry line, so replies come back to that business.
export async function sendSmsFrom(env, from, to, body) {
  const To = toE164(to);
  if (!twilioOn(env) || !To || !from) return sendSms(env, to, body);
  return tw(env, `${acct(env)}/Messages.json`, { To, From: from, Body: String(body).slice(0, 640) });
}

// Buys a local number (same area code as the owner when possible) that rings the owner.
export async function buyNumber(env, ownerPhone, label) {
  const api = env.PUBLIC_API || "https://api.vantryai.com";
  const area = (toE164(ownerPhone) || "").slice(2, 5);
  const search = async (q) => (await tw(env, `${acct(env)}/AvailablePhoneNumbers/US/Local.json?${q}SmsEnabled=true&VoiceEnabled=true&PageSize=1`, null, "GET")).available_phone_numbers?.[0];
  const pick = (area && (await search(`AreaCode=${area}&`))) || (await search(""));
  if (!pick) throw new Error("No phone numbers available right now");
  const num = await tw(env, `${acct(env)}/IncomingPhoneNumbers.json`, {
    PhoneNumber: pick.phone_number,
    FriendlyName: String(label || "Vantry Plus").slice(0, 60),
    VoiceUrl: `${api}/api/twilio/voice`,
    VoiceMethod: "POST",
    SmsUrl: `${api}/api/twilio/sms`,
    SmsMethod: "POST",
  });
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    try {
      await tw(env, `${MSG_API}/Services/${env.TWILIO_MESSAGING_SERVICE_SID}/PhoneNumbers`, { PhoneNumberSid: num.sid });
    } catch (e) {
      console.log("Couldn't add number to messaging service", e.message);
    }
  }
  return { sid: num.sid, number: num.phone_number };
}

export const releaseNumber = (env, sid) => (sid ? tw(env, `${acct(env)}/IncomingPhoneNumbers/${sid}.json`, null, "DELETE") : null);

// Proves a request really came from Twilio (X-Twilio-Signature).
export async function verifyTwilio(env, url, params, signature) {
  if (!env.TWILIO_AUTH_TOKEN || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.TWILIO_AUTH_TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))));
  if (sig.length !== signature.length) return false;
  let d = 0;
  for (let i = 0; i < sig.length; i++) d |= sig.charCodeAt(i) ^ signature.charCodeAt(i);
  return d === 0;
}

const x = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
export const twiml = (inner = "") => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { "Content-Type": "text/xml" } });
export const say = (text) => `<Say voice="Polly.Joanna">${x(text)}</Say>`;
export const dial = (number, action, callerId) => `<Dial timeout="20" action="${x(action)}" method="POST"${callerId ? ` callerId="${x(callerId)}"` : ""}><Number>${x(number)}</Number></Dial>`;
