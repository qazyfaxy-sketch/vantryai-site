// AI visibility audits: does ChatGPT / Perplexity / Gemini / Claude recommend a business?
//
// For each buyer question we ask every AI engine whose key is set (official APIs, web search on),
// then check whether the business is named, which companies are named instead, and which sites
// the AI cited. One extra AI call writes the questions (if none are given) and one reads the
// answers to list the companies named. Results are stored for 180 days and shown at /r/:id.
//
// Honest by design: answers in the consumer apps can differ from API answers and change daily,
// so every report says when and how it was checked. Nothing here guarantees placement.
import { randomId, httpError } from "./util.js";

const TTL = 60 * 60 * 24 * 180;
const INDEX_KEY = "audits:index";
const MAX_QUESTIONS = 10;

export const ENGINES = {
  openai: { label: "ChatGPT", key: "OPENAI_API_KEY" },
  perplexity: { label: "Perplexity", key: "PERPLEXITY_API_KEY" },
  gemini: { label: "Gemini", key: "GEMINI_API_KEY" },
  claude: { label: "Claude", key: "ANTHROPIC_API_KEY" },
};

// Engines with a key set, optionally limited by AUDIT_ENGINES="openai,perplexity".
export function availableEngines(env) {
  const wanted = String(env.AUDIT_ENGINES || "").split(",").map((s) => s.trim()).filter(Boolean);
  return Object.keys(ENGINES).filter((id) => env[ENGINES[id].key] && (!wanted.length || wanted.includes(id)));
}

// ---------------- Asking each engine ----------------

const TIMEOUT = 45000;

async function post(url, headers, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${(data.error && (data.error.message || data.error)) || text.slice(0, 200)}`);
  return data;
}

const domainOf = (u) => {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
};
const src = (url, title) => ({ url: String(url || ""), title: String(title || "").slice(0, 140), domain: domainOf(url) || String(title || "").toLowerCase().replace(/^www\./, "") });

async function askOpenAI(env, q) {
  const d = await post("https://api.openai.com/v1/responses", { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, {
    model: env.OPENAI_SEARCH_MODEL || "gpt-5-mini",
    input: q,
    tools: [{ type: "web_search" }],
  });
  let text = d.output_text || "";
  const sources = [];
  for (const item of d.output || []) {
    if (item.type !== "message") continue;
    for (const c of item.content || []) {
      if (!d.output_text && c.text) text += c.text;
      for (const a of c.annotations || []) if (a.url) sources.push(src(a.url, a.title));
    }
  }
  return { text, sources };
}

async function askPerplexity(env, q) {
  const d = await post("https://api.perplexity.ai/chat/completions", { Authorization: `Bearer ${env.PERPLEXITY_API_KEY}` }, {
    model: env.PERPLEXITY_MODEL || "sonar",
    messages: [{ role: "user", content: q }],
  });
  const text = d.choices?.[0]?.message?.content || "";
  const sources = (d.search_results || []).map((r) => src(r.url, r.title));
  if (!sources.length) for (const u of d.citations || []) sources.push(src(u, ""));
  return { text, sources };
}

async function askGemini(env, q) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const d = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { "x-goog-api-key": env.GEMINI_API_KEY }, {
    contents: [{ role: "user", parts: [{ text: q }] }],
    tools: [{ google_search: {} }],
  });
  const cand = d.candidates?.[0] || {};
  const text = (cand.content?.parts || []).map((p) => p.text || "").join("");
  // Gemini's links are redirects; the title holds the real site name.
  const sources = (cand.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter(Boolean).map((w) => ({ url: String(w.uri || ""), title: String(w.title || ""), domain: String(w.title || domainOf(w.uri)).toLowerCase().replace(/^www\./, "") }));
  return { text, sources };
}

async function askClaude(env, q) {
  const d = await post("https://api.anthropic.com/v1/messages", { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, {
    model: env.AUDIT_CLAUDE_MODEL || env.AI_MODEL || "claude-haiku-5-5",
    max_tokens: 1200,
    messages: [{ role: "user", content: q }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
  });
  let text = "";
  const sources = [];
  for (const b of d.content || []) {
    if (b.type !== "text") continue;
    text += b.text || "";
    for (const c of b.citations || []) if (c.url) sources.push(src(c.url, c.title));
  }
  return { text, sources };
}

const ASK = { openai: askOpenAI, perplexity: askPerplexity, gemini: askGemini, claude: askClaude };

// ---------------- Matching the business ----------------

const SUFFIX = /\b(inc|llc|ltd|co|corp|corporation|company|software|app|hq|ai|io)\b\.?/g;
export const norm = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

// Names and site words that count as "this business": "Acme Scheduling Inc" and acme.com.
export function brandTerms(name, website) {
  const terms = new Set();
  const n = norm(name);
  if (n) terms.add(n);
  const short = n.replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
  if (short.length >= 4) terms.add(short);
  const host = domainOf(/^https?:/.test(website || "") ? website : `https://${website || ""}`);
  const root = host.split(".")[0];
  if (root && root.length >= 4) terms.add(norm(root));
  return { terms: [...terms].filter(Boolean), host };
}

export function isNamed(text, brand) {
  const t = ` ${norm(text)} `;
  const squashed = norm(text).replace(/\s+/g, "");
  return brand.terms.some((term) => t.includes(` ${term} `) || (term.length >= 6 && squashed.includes(term.replace(/\s+/g, ""))));
}

export const isCited = (sources, brand) => !!brand.host && sources.some((s) => s.domain === brand.host || s.domain.endsWith(`.${brand.host}`));

// ---------------- Helper AI calls (questions + who was named) ----------------

async function claudeJson(env, system, user, maxTokens = 900) {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const d = await post("https://api.anthropic.com/v1/messages", { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, {
      model: env.AI_MODEL || "claude-haiku-5-5",
      max_tokens: maxTokens,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = (d.content || []).map((c) => c.text || "").join("");
    const start = text.search(/[[{]/);
    const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
    return start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch (e) {
    console.log("Audit helper failed", e.message);
    return null;
  }
}

export async function writeQuestions(env, company, count = 3) {
  const fallback = [`What is the best ${company.category} for ${company.audience || "small businesses"}?`, `What are the top ${company.category} options right now?`, `Which ${company.category} do you recommend for ${company.audience || "a small team"}, and why?`];
  const got = await claudeJson(
    env,
    "You write the exact questions a potential customer types into ChatGPT when shopping for a product or service. Plain, natural, specific to the category and buyer. Never include the company's own name or any brand name. Return a JSON array of strings only.",
    `Category / what they sell: ${company.category}\nWho buys it: ${company.audience || "not given"}\nWrite ${count} different questions, from broad ("best ... for ...") to specific (a use case or a must-have feature).`
  );
  const qs = Array.isArray(got) ? got.map((q) => String(q).trim()).filter((q) => q.length > 8 && q.length < 200 && !isNamed(q, brandTerms(company.name, company.website))) : [];
  return (qs.length ? qs : fallback).slice(0, count);
}

async function extractNamed(env, results, company) {
  const payload = results.map((r, i) => ({ i, answer: r.text.slice(0, 2500) }));
  const got = await claudeJson(
    env,
    "You read AI answers and list the companies, products or brands each answer recommends or names as options. Use each brand's short name. Skip generic terms, websites that are only sources, and review sites like G2 or Capterra unless recommended as a product. Return JSON only: [{\"i\":0,\"named\":[\"Brand\",...]}].",
    JSON.stringify(payload),
    1500
  );
  if (!Array.isArray(got)) return;
  const own = brandTerms(company.name, company.website);
  for (const row of got) {
    const r = results[row.i];
    if (!r || !Array.isArray(row.named)) continue;
    r.named = [...new Set(row.named.map((n) => String(n).trim().slice(0, 60)).filter(Boolean))].filter((n) => !isNamed(n, own)).slice(0, 10);
  }
}

// ---------------- Running an audit ----------------

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export function cleanCompany(b) {
  const s = (v, n) => String(v || "").trim().slice(0, n);
  const company = { name: s(b.name, 80), website: s(b.website, 120).replace(/\/+$/, ""), category: s(b.category, 120), audience: s(b.audience, 120) };
  if (!company.name) throw httpError(400, "Please add the business name.");
  if (!company.category) throw httpError(400, "Please say what the business sells, for example \"scheduling software for dental offices\".");
  return company;
}

export async function runAudit(env, input, { questions, questionCount = 3, engines, origin = "admin", email = "" } = {}) {
  const company = cleanCompany(input);
  const use = (engines || availableEngines(env)).filter((e) => ASK[e]);
  if (!use.length) throw httpError(503, "No AI engines are set up yet. Add an API key (OpenAI, Perplexity, Gemini or Anthropic).");
  const qs = (questions && questions.length ? questions.map((q) => String(q).trim()).filter(Boolean) : await writeQuestions(env, company, questionCount)).slice(0, MAX_QUESTIONS);
  const brand = brandTerms(company.name, company.website);

  const jobs = qs.flatMap((q) => use.map((engine) => ({ q, engine })));
  const results = await pool(jobs, 4, ({ q, engine }) => askOne(env, engine, q, brand));
  return finishAudit(env, { company, questions: qs, engines: use, results, origin, email });
}

// One question to one engine, never throws (a failed engine becomes an "error" row).
export async function askOne(env, engine, q, brand) {
  try {
    const { text, sources } = await ASK[engine](env, q);
    const uniq = [...new Map(sources.filter((s) => s.domain).map((s) => [s.domain, s])).values()].slice(0, 8);
    return { q, engine, text: String(text || "").slice(0, 4000), sources: uniq, mentioned: isNamed(text, brand), cited: isCited(uniq, brand), named: [] };
  } catch (e) {
    console.log(`Audit ${engine} failed`, e.message);
    return { q, engine, text: "", sources: [], mentioned: false, cited: false, named: [], error: "This AI didn't answer this time." };
  }
}

// Lists who each answer named (in chunks), then saves the audit.
export async function finishAudit(env, { company, questions, engines, results, origin = "admin", email = "" }) {
  const answered = results.filter((r) => r.text);
  for (let i = 0; i < answered.length; i += 20) await extractNamed(env, answered.slice(i, i + 20), company);
  const audit = { id: `a${randomId(11)}`, createdAt: Date.now(), company, questions, engines, results, summary: summarize(results, engines), origin, email: String(email || "").slice(0, 120) };
  await saveAudit(env, audit);
  return audit;
}

export function summarize(results, engines) {
  const answered = results.filter((r) => !r.error);
  const byEngine = Object.fromEntries(engines.map((e) => {
    const rs = answered.filter((r) => r.engine === e);
    return [e, { total: rs.length, mentioned: rs.filter((r) => r.mentioned).length }];
  }));
  const tally = (list) => {
    const m = new Map();
    for (const x of list) {
      const k = x.toLowerCase();
      const cur = m.get(k) || { name: x, count: 0 };
      cur.count++;
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  };
  return {
    total: answered.length,
    mentioned: answered.filter((r) => r.mentioned).length,
    cited: answered.filter((r) => r.cited).length,
    byEngine,
    competitors: tally(answered.flatMap((r) => r.named)).slice(0, 10),
    sources: tally(answered.flatMap((r) => r.sources.map((s) => s.domain))).slice(0, 10),
  };
}

// ---------------- Storage ----------------

export async function saveAudit(env, audit) {
  await env.PREVIEWS.put(`audit:${audit.id}`, JSON.stringify(audit), { expirationTtl: TTL });
  let index = [];
  try { index = JSON.parse((await env.PREVIEWS.get(INDEX_KEY)) || "[]"); } catch {}
  index.unshift({ id: audit.id, name: audit.company.name, at: audit.createdAt, origin: audit.origin, score: `${audit.summary.mentioned}/${audit.summary.total}`, email: audit.email || "" });
  await env.PREVIEWS.put(INDEX_KEY, JSON.stringify(index.slice(0, 300)));
}

export async function getAudit(env, id) {
  if (!/^a[a-z0-9]{11}$/.test(id)) return null;
  const raw = await env.PREVIEWS.get(`audit:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listAudits(env) {
  try { return JSON.parse((await env.PREVIEWS.get(INDEX_KEY)) || "[]"); } catch { return []; }
}
