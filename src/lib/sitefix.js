// The website engine for Growth and Pro clients: AI writes the fixes and pages, checks them against
// the client's real website, and publishes them. Three ways to publish, so it works for anyone:
//
//   wordpress  They install the small "Vantry Connect" plugin and paste a code (2 minutes). We then
//              publish pages, add structured data (schema) to their homepage, serve /llms.txt and let
//              AI crawlers in, all through the plugin.
//   hub        Any other platform (Webflow, Wix, Squarespace, Shopify, custom): they add ONE DNS record
//              for a subdomain like answers.theirsite.com. We host their answer pages there, on their
//              own domain, with schema, llms.txt and a sitemap.
//   kit        Nothing connected: every page and fix is ready to copy and paste from their Vantry page.
//
// Every month (Growth: 3 pages, Pro: 6): pages answering buyer questions AI isn't naming them for,
// plus fair comparison pages when we know a competitor's website. Facts come only from websites,
// a second AI pass removes anything unsupported, and you approve each page by email
// (SITE_AUTO_PUBLISH="true" skips that). Clients get an email when a page goes live.
import { json, html, httpError, randomId, readJson, safeEqual, esc } from "./util.js";
import { claudeJson, getAudit } from "./aiscan.js";
import { readSite, companyOfClient } from "./video.js";
import { sendEmail } from "./email.js";
import { addCustomHostname, getCustomHostname, hostnameIsActive } from "./cloudflare.js";
import { page } from "../pages/shell.js";
import { renderHubPage, renderHubIndex, pageBody } from "../pages/hub.js";

export const PAGES_PER_MONTH = { growth: 3, pro: 6 };
const DAY = 86400000;
const MONTH = 30 * DAY;
const MAX_ATTEMPTS = 3;
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Claude-SearchBot", "Google-Extended"];
const sign = "Thanks,\nVince\nVantry · vantryai.com";
const api = (env) => env.PUBLIC_API || "https://api.vantryai.com";
const pgKey = (id) => `pg:${id}`;
const hubKey = (host) => `hub:${String(host).toLowerCase()}`;
const PLUGIN_URL = "https://vantryai.com/downloads/vantry-connect.zip";

export function isSitePath(p) {
  return /^\/site\/c[a-z0-9]{11}$/.test(p) || p === "/api/site/connect" || /^\/pg\/g[a-z0-9]{11}$/.test(p);
}

// ---------------- Storage + crypto ----------------

export async function getPage(env, id) {
  const raw = /^g[a-z0-9]{11}$/.test(id) ? await env.PREVIEWS.get(pgKey(id)) : null;
  return raw ? JSON.parse(raw) : null;
}
const savePage = (env, p) => env.PREVIEWS.put(pgKey(p.id), JSON.stringify(p));

async function hmac(env, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.VIDEO_SECRET || env.ADMIN_TOKEN || "x"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
export const reviewUrl = async (env, id) => `${api(env)}/pg/${id}?k=${await hmac(env, `page:${id}`)}`;

async function aesKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vantry-site:${env.SITE_KEY_SECRET || env.ADMIN_TOKEN || "x"}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), new TextEncoder().encode(text));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function unseal(env, sealed) {
  const [iv, ct] = String(sealed || "").split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

// ---------------- Facts (from their website only) ----------------

const FACTS_SYSTEM = `You extract facts about a company from its own website text. Only what the text clearly says; never guess.
Return JSON only:
{"description": "1-2 plain sentences: what it is and who it's for",
 "audience": "who it's for, in their words, or empty",
 "category": "short category, e.g. dental scheduling software",
 "isSoftware": true or false,
 "features": ["up to 10 short phrases"],
 "pricing": [{"plan": "", "price": "as written, e.g. $59", "period": "per month / per year / one-time / empty", "note": ""}],
 "trial": "free trial or free plan details as written, or empty",
 "integrations": ["names, if listed"],
 "pages": {"pricing": "URL or empty", "features": "URL or empty"}}`;

export async function extractFacts(env, c, pages) {
  const co = companyOfClient(c);
  const text = pages.map((p) => `PAGE: ${p.url}\n${p.text}`).join("\n\n");
  const f = await claudeJson(env, FACTS_SYSTEM, `Company: ${co.name} (${co.website})\n\n${text}`, 1500);
  if (!f || typeof f !== "object") return null;
  const urls = new Set(pages.map((p) => p.url));
  return {
    description: String(f.description || "").slice(0, 400),
    audience: String(f.audience || co.audience || "").slice(0, 200),
    category: String(f.category || co.category || "").slice(0, 100),
    isSoftware: !!f.isSoftware,
    features: (Array.isArray(f.features) ? f.features : []).map((x) => String(x).slice(0, 80)).slice(0, 10),
    pricing: (Array.isArray(f.pricing) ? f.pricing : []).filter((x) => x && x.price).map((x) => ({ plan: String(x.plan || "").slice(0, 40), price: String(x.price).slice(0, 30), period: String(x.period || "").slice(0, 30), note: String(x.note || "").slice(0, 80) })).slice(0, 6),
    trial: String(f.trial || "").slice(0, 120),
    integrations: (Array.isArray(f.integrations) ? f.integrations : []).map((x) => String(x).slice(0, 40)).slice(0, 12),
    pages: { pricing: urls.has(f.pages?.pricing) ? f.pages.pricing : "", features: urls.has(f.pages?.features) ? f.pages.features : "" },
  };
}

// ---------------- Structured data (schema) + llms.txt ----------------

export function buildSchema(co, facts) {
  const org = { "@context": "https://schema.org", "@type": "Organization", name: co.name, url: co.website };
  if (facts?.description) org.description = facts.description;
  const main = {
    "@context": "https://schema.org",
    "@type": facts?.isSoftware ? "SoftwareApplication" : "Service",
    name: co.name,
    url: co.website,
    description: facts?.description || undefined,
  };
  if (facts?.isSoftware) {
    main.applicationCategory = "BusinessApplication";
    main.operatingSystem = "Web";
  } else {
    main.provider = { "@type": "Organization", name: co.name };
    if (facts?.category) main.serviceType = facts.category;
  }
  if (facts?.audience) main.audience = { "@type": "Audience", audienceType: facts.audience };
  const offers = (facts?.pricing || [])
    .map((p) => ({ p, n: String(p.price).replace(/,/g, "").match(/\$\s?(\d+(?:\.\d{1,2})?)/) }))
    .filter((x) => x.n)
    .map(({ p, n }) => ({ "@type": "Offer", name: p.plan || undefined, price: n[1], priceCurrency: "USD", url: facts.pages?.pricing || co.website }));
  if (offers.length) main.offers = offers;
  return JSON.parse(JSON.stringify([org, main]));
}

export function buildLlms(co, facts, livePages = []) {
  const lines = [`# ${co.name}`, "", `> ${facts?.description || `${co.name}: ${co.category}.`}`, ""];
  if (facts?.audience) lines.push(`Who it's for: ${facts.audience}`, "");
  if (facts?.features?.length) lines.push("## What it does", ...facts.features.map((f) => `- ${f}`), "");
  if (facts?.pricing?.length) lines.push("## Pricing (from our website)", ...facts.pricing.map((p) => `- ${[p.plan, p.price, p.period].filter(Boolean).join(" ")}${p.note ? ` (${p.note})` : ""}`), "");
  if (facts?.trial) lines.push(`Free trial: ${facts.trial}`, "");
  lines.push("## Key pages", `- [Home](${co.website})`);
  if (facts?.pages?.pricing) lines.push(`- [Pricing](${facts.pages.pricing})`);
  if (facts?.pages?.features) lines.push(`- [Features](${facts.pages.features})`);
  if (livePages.length) lines.push("", "## Answers to common questions", ...livePages.map((p) => `- [${p.title}](${p.url})`));
  return lines.join("\n") + "\n";
}

// ---------------- Writing pages ----------------

const RULES = (co, avoid) => `Rules you never break:
- Facts about ${co.name} come ONLY from its website text below. Never invent features, prices, numbers, customers, reviews, awards, integrations or results. If it isn't in the text, leave it out.
- Never call anyone the best, #1, leading or "top". No guarantees. No made-up quotes or testimonials.
- General buying advice (what to look for, questions to ask) is fine, as long as it makes no claim about a specific company.
${avoid ? `- Never mention: ${avoid}\n` : ""}- Plain, specific English. Short paragraphs. No hype words. Write for a buyer, in the second person.`;

const ANSWER_SYSTEM = (co, avoid) => `You write a page for ${co.name}'s own website that honestly answers a question buyers ask AI assistants. The page should be the clearest, most useful answer to that question that ${co.name} can truthfully give.
${RULES(co, avoid)}
Return JSON only:
{"title": "page title, under 70 characters, close to the buyer's wording",
 "slug": "short-url-words",
 "metaDescription": "under 155 characters",
 "intro": "2-3 sentences that answer the question directly and say where ${co.name} fits",
 "sections": [{"h2": "", "paragraphs": [""], "bullets": [""]}],
 "faq": [{"q": "", "a": "1-3 sentences"}]}
3 to 5 sections (for example: what to look for, how ${co.name} handles it, who it's a good fit for, pricing if stated). 4 to 6 FAQ items.`;

const COMPARE_SYSTEM = (co, rival, avoid) => `You write a fair comparison page, "${co.name} vs ${rival}", for ${co.name}'s website. Fair means: the same facts checked for both, ${rival}'s strengths stated plainly, no attacks.
${RULES(co, avoid)}
- Facts about ${rival} come ONLY from ${rival}'s website text below. Where a site doesn't say, write "Not listed on their website".
Return JSON only:
{"title": "${co.name} vs ${rival}: ...", "slug": "", "metaDescription": "under 155 characters",
 "intro": "2-3 neutral sentences",
 "rows": [{"label": "e.g. Starting price", "a": "${co.name}'s value", "b": "${rival}'s value"}],
 "sections": [{"h2": "", "paragraphs": [""], "bullets": [""]}],
 "faq": [{"q": "", "a": ""}]}
5 to 8 rows. Sections should include who each one fits best.`;

const CHECK_SYSTEM = `You are a strict fact checker. You get a web page (JSON) and the website text it must be based on.
Remove or rewrite every statement about a specific company that the text doesn't directly support, every superlative ("best", "#1", "leading", "top"), every guarantee and every testimonial or quote. Keep general buying advice. Keep the same JSON shape. Return the corrected JSON only.`;

export function slugify(s) {
  return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "") || "page";
}

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const OVERCLAIM = /(\bthe best\b|#1\b|\bnumber one\b|\bindustry[- ]leading\b|\bworld[- ]class\b|\bguarantee[ds]?\b|\bunmatched\b|\bunbeatable\b)/i;
const scrubText = (t) => (String(t).match(/[^.!?]+[.!?]*/g) || [String(t)]).filter((x) => !OVERCLAIM.test(x)).join("").replace(/\s{2,}/g, " ").trim();

export function cleanPage(raw, kind) {
  if (!raw || typeof raw !== "object") return null;
  const sections = (Array.isArray(raw.sections) ? raw.sections : []).map((s) => ({
    h2: clip(s.h2, 100),
    paragraphs: (Array.isArray(s.paragraphs) ? s.paragraphs : []).map((p) => clip(p, 900)).filter(Boolean).slice(0, 5),
    bullets: (Array.isArray(s.bullets) ? s.bullets : []).map((b) => clip(b, 220)).filter(Boolean).slice(0, 10),
  })).filter((s) => s.h2 && (s.paragraphs.length || s.bullets.length)).slice(0, 6);
  const faq = (Array.isArray(raw.faq) ? raw.faq : []).map((f) => ({ q: clip(f.q, 200), a: clip(f.a, 600) })).filter((f) => f.q && f.a).slice(0, 8);
  const rows = kind === "compare" ? (Array.isArray(raw.rows) ? raw.rows : []).map((r) => ({ label: clip(r.label, 60), a: clip(r.a, 200), b: clip(r.b, 200) })).filter((r) => r.label).slice(0, 10) : [];
  const intro = scrubText(clip(raw.intro, 700));
  if (!intro || sections.length < 2 || (kind === "compare" && rows.length < 3)) return null;
  // Last line of defense after the fact-check: drop any sentence that still overclaims.
  const scrub = scrubText;
  return {
    title: scrub(clip(raw.title, 90)),
    slug: slugify(raw.slug || raw.title),
    metaDescription: clip(raw.metaDescription, 160),
    intro,
    sections: sections.map((s) => ({ ...s, paragraphs: s.paragraphs.map(scrub), bullets: s.bullets.map(scrub) })),
    faq: faq.map((f) => ({ q: f.q, a: scrub(f.a) })),
    rows,
  };
}

export function pageSchema(co, p, url) {
  const out = [{ "@context": "https://schema.org", "@type": "Article", headline: p.title, description: p.metaDescription, dateModified: new Date(p.updatedAt || p.createdAt).toISOString().slice(0, 10), author: { "@type": "Organization", name: co.name, url: co.website }, publisher: { "@type": "Organization", name: co.name }, mainEntityOfPage: url || undefined }];
  if (p.faq?.length) out.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  return JSON.parse(JSON.stringify(out));
}

// Competitor websites we know: domains written in the onboarding form.
export function rivalSites(c) {
  const text = String(c.onboarding?.competitors || "");
  const out = [];
  for (const m of text.matchAll(/\b((?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.(?:com|io|co|ai|app|net|org|so|dev|us|software|tech|health|me)(?:\/\S*)?)/gi)) {
    const site = /^https?:\/\//i.test(m[1]) ? m[1] : `https://${m[1]}`;
    const name = m[2].replace(/-/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
    if (!out.some((o) => o.site === site)) out.push({ name, site: site.replace(/\/+$/, "") });
  }
  return out.slice(0, 5);
}

export async function writePage(env, c, plan, note = "") {
  const co = companyOfClient(c);
  const avoid = String(c.onboarding?.avoid || "").slice(0, 400);
  const own = await readSite(c.onboarding?.website);
  if (!own.length) throw new Error(`Couldn't read their website (${c.onboarding?.website || "none given"}).`);
  const ownText = own.map((p) => `PAGE: ${p.url}\n${p.text}`).join("\n\n");
  const model = env.PAGE_MODEL || env.VIDEO_MODEL || "claude-sonnet-5-5";
  let system, user, sources;
  if (plan.kind === "compare") {
    const theirs = await readSite(plan.rival.site);
    if (!theirs.length) throw new Error(`Couldn't read ${plan.rival.name}'s website.`);
    const rivalText = theirs.map((p) => `PAGE: ${p.url}\n${p.text}`).join("\n\n");
    system = COMPARE_SYSTEM(co, plan.rival.name, avoid);
    sources = `${co.name.toUpperCase()} WEBSITE:\n${ownText}\n\n${plan.rival.name.toUpperCase()} WEBSITE:\n${rivalText}`;
    user = `${note ? `Change requested by the reviewer: ${note}\n\n` : ""}${sources}`;
  } else {
    system = ANSWER_SYSTEM(co, avoid);
    sources = `${co.name.toUpperCase()} WEBSITE:\n${ownText}`;
    user = `Buyer question: ${plan.question}\nWho buys it: ${co.audience || "-"}\n${plan.namedInstead?.length ? `Other options AI named for this question (names only; make no claims about them): ${plan.namedInstead.join(", ")}\n` : ""}${note ? `Change requested by the reviewer: ${note}\n` : ""}\n${sources}`;
  }
  const draft = await claudeJson(env, system, user, 3000, model);
  if (!draft) return null;
  const checked = await claudeJson(env, CHECK_SYSTEM, `Page:\n${JSON.stringify(draft)}\n\nWebsite text:\n${sources}`, 3000, model);
  return cleanPage(checked && checked.intro ? checked : draft, plan.kind);
}

// What to write next: a comparison every third page (when we know a rival's site), otherwise the next
// buyer question AI isn't naming them for.
export async function nextPlan(env, c) {
  const done = (c.pages || []).filter((p) => p.status !== "skipped" && p.status !== "redone");
  const rivals = rivalSites(c).filter((r) => !done.some((p) => p.rival === r.name));
  if (rivals.length && done.length % 3 === 2) return { kind: "compare", rival: rivals[0] };
  const used = new Set(done.map((p) => p.q));
  const last = (c.audits || []).slice(-1)[0];
  const audit = last ? await getAudit(env, last.id) : null;
  const missed = audit ? audit.results.filter((r) => !r.error && !r.mentioned) : [];
  const q = [...missed.map((r) => r.q), ...(c.questions || [])].find((x) => !used.has(x));
  if (q) return { kind: "answer", question: q, namedInstead: [...new Set(missed.filter((r) => r.q === q).flatMap((r) => r.named))].slice(0, 4) };
  if (rivals.length) return { kind: "compare", rival: rivals[0] };
  return null;
}

export async function makePage(env, c, saveClient, { note = "", plan: forced } = {}) {
  const plan = forced || (await nextPlan(env, c));
  if (!plan) throw new Error("Nothing new to write yet: every tracked question already has a page.");
  const content = await writePage(env, c, plan, note);
  if (!content) throw new Error("The page didn't come out right. Try again in a bit.");
  const taken = new Set((c.pages || []).filter((p) => p.status !== "skipped" && p.status !== "redone").map((p) => p.slug));
  let slug = content.slug;
  for (let i = 2; taken.has(slug); i++) slug = `${content.slug}-${i}`;
  const p = { id: `g${randomId(11)}`, clientId: c.id, kind: plan.kind, q: plan.question || null, rival: plan.rival?.name || null, rivalSite: plan.rival?.site || null, ...content, slug, status: "review", createdAt: Date.now(), attempts: 1 };
  await savePage(env, p);
  (c.pages ||= []).push({ id: p.id, at: p.createdAt, kind: p.kind, q: p.q, rival: p.rival, slug, title: p.title, status: "review" });
  c.pages = c.pages.slice(-120);
  await saveClient(env, c, `Page written: ${p.title}`);
  if (env.SITE_AUTO_PUBLISH === "true") {
    try {
      await publishPage(env, p, c, saveClient);
      return p;
    } catch (e) {
      p.publishError = e.message;
      await savePage(env, p);
    }
  }
  await sendEmail(env, { to: env.OWNER_EMAIL, subject: `Page ready to check: ${companyOfClient(c).name}`, text: `A new ${p.kind === "compare" ? "comparison" : "answer"} page for ${companyOfClient(c).name} is ready:\n"${p.title}"\n\nRead it, then approve, redo or skip:\n${await reviewUrl(env, p.id)}` });
  return p;
}

// ---------------- Publishing ----------------

const methodOf = (c) => c.site?.method || "kit";
export const hubUrl = (c, slug = "") => `https://${c.site.hub.host}/${slug}`;

async function wpCall(env, c, method, path, body) {
  const key = await unseal(env, c.site.wp.key);
  const res = await fetch(`${c.site.wp.rest.replace(/\/+$/, "")}/${path}`, { method, headers: { "X-Vantry-Key": key, "Content-Type": "application/json", "User-Agent": "Vantry/1.0" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Their WordPress said ${res.status}: ${d.message || d.error || "no details"}`);
  return d;
}

function livePages(c) {
  return (c.pages || []).filter((p) => p.status === "live" && p.url);
}

export async function publishPage(env, p, c, saveClient) {
  const co = companyOfClient(c);
  const method = methodOf(c);
  if (method === "wordpress") {
    const guessUrl = `${c.site.wp.site.replace(/\/+$/, "")}/${p.slug}/`;
    const r = await wpCall(env, c, "POST", "page", { vid: p.id, title: p.title, slug: p.slug, content: pageBody(co, p), description: p.metaDescription, schema: JSON.stringify(pageSchema(co, p, guessUrl)) });
    p.url = r.url || guessUrl;
  } else if (method === "hub" && c.site.hub?.status === "active") {
    p.url = hubUrl(c, p.slug);
  } else {
    p.url = null; // kit: ready to copy from their Vantry page
  }
  p.status = p.url ? "live" : "ready";
  p.publishedAt = Date.now();
  await savePage(env, p);
  const row = (c.pages || []).find((x) => x.id === p.id);
  if (row) Object.assign(row, { status: p.status, url: p.url, title: p.title });
  await saveClient(env, c, `Page ${p.status}: ${p.title}`);
  if (method !== "kit") await refreshFoundation(env, c, saveClient, { quiet: true }).catch((e) => console.log("llms refresh failed", e.message));
  const to = c.onboarding?.reportEmail || c.email;
  await sendEmail(env, {
    to,
    subject: p.url ? `New page live on your site: ${p.title}` : `New page ready for your site: ${p.title}`,
    text: `Hi,

${p.url ? `We published a new page on your website:\n${p.url}` : `A new page is ready for your website. Copy it from your Vantry page (2 minutes), or connect your site once and we'll publish pages for you:\n${api(env)}/site/${c.id}`}

${p.kind === "compare" ? `It's a fair, fact-checked comparison with ${p.rival}, based on both companies' public websites.` : `It answers a question your buyers ask AI: "${p.q}"`} Every fact in it comes from your own website.

If anything is wrong or you'd like it changed or removed, reply and we'll do it the same day.

${sign}`,
  });
}

async function unpublish(env, p, c) {
  if (methodOf(c) === "wordpress" && p.status === "live") {
    try { await wpCall(env, c, "DELETE", "page", { vid: p.id }); } catch (e) { console.log("WP delete failed", e.message); }
  }
}

// Homepage schema + llms.txt + AI crawlers allowed. Runs after connecting, then monthly.
export async function refreshFoundation(env, c, saveClient, { quiet = false } = {}) {
  const co = companyOfClient(c);
  if (!c.facts || Date.now() - (c.facts.at || 0) > MONTH) {
    const pages = await readSite(c.onboarding?.website);
    const facts = pages.length ? await extractFacts(env, c, pages) : null;
    if (facts) c.facts = { at: Date.now(), data: facts };
  }
  const facts = c.facts?.data || null;
  const schema = buildSchema(co, facts);
  const llms = buildLlms(co, facts, livePages(c));
  c.foundation = { at: Date.now(), schema, llms };
  if (methodOf(c) === "wordpress") {
    const r = await wpCall(env, c, "POST", "settings", { schema: JSON.stringify(schema), llms, allowAi: true, bots: AI_BOTS });
    c.foundation.wp = { robotsFile: !!r.physicalRobots, llmsFile: !!r.physicalLlms };
  }
  await saveClient(env, c, quiet ? undefined : "Website foundation updated (schema, llms.txt, AI crawlers)");
  return c.foundation;
}

// ---------------- Connecting ----------------

export async function startConnect(env, c, saveClient) {
  if (c.site?.pendingKey) {
    try { return `${c.id}.${await unseal(env, c.site.pendingKey)}`; } catch {}
  }
  const key = randomId(32);
  c.site = { ...(c.site || {}), pendingKey: await seal(env, key), method: c.site?.method || "kit" };
  await saveClient(env, c);
  return `${c.id}.${key}`;
}

async function pluginConnect(req, env, { getClient, saveClient }) {
  const b = await readJson(req);
  const [id, key] = String(b.code || "").split(".");
  const c = await getClient(env, id || "");
  if (!c || !c.site?.pendingKey) throw httpError(400, "That code isn't valid. Copy it again from your Vantry page.");
  let expected = "";
  try { expected = await unseal(env, c.site.pendingKey); } catch {}
  if (!key || !safeEqual(key, expected)) throw httpError(400, "That code isn't valid. Copy it again from your Vantry page.");
  const site = String(b.site || ""), rest = String(b.rest || "");
  const httpsOnly = env.DEV_ALLOW_HTTP !== "true";
  if (httpsOnly && (!/^https:\/\//.test(site) || !/^https:\/\//.test(rest))) throw httpError(400, "Your site needs to use https.");
  c.site = { method: "wordpress", wp: { site, rest, key: c.site.pendingKey }, connectedAt: Date.now() };
  // Check we can really reach it.
  try {
    const st = await wpCall(env, c, "GET", "status");
    c.site.wp.name = String(st.name || "").slice(0, 80);
  } catch (e) {
    c.site = { method: "kit", pendingKey: c.site.wp.key };
    await saveClient(env, c);
    throw httpError(400, `We couldn't reach your site's plugin: ${e.message}`);
  }
  await saveClient(env, c, "WordPress connected");
  try { await refreshFoundation(env, c, saveClient); } catch (e) { console.log("Foundation failed", e.message); }
  // Publish anything already approved but waiting.
  for (const row of (c.pages || []).filter((x) => x.status === "ready")) {
    const p = await getPage(env, row.id);
    if (p) await publishPage(env, p, c, saveClient).catch((e) => console.log("Publish failed", e.message));
  }
  await sendEmail(env, { to: env.OWNER_EMAIL, subject: `WordPress connected: ${companyOfClient(c).name}`, text: `${site}\nSchema, llms.txt and AI crawler access are set. New pages will publish there.` });
  return json({ ok: true });
}

function rootDomain(website) {
  return String(website || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
}

async function setupHub(env, c, host, saveClient) {
  const h = String(host || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const root = rootDomain(c.onboarding?.website);
  if (!root || !h.endsWith(`.${root}`) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) throw new Error(`Use a subdomain of ${root || "your website"}, like answers.${root || "yoursite.com"}.`);
  if (!env.CF_SAAS_ZONE_ID) throw new Error("Hosting isn't switched on yet. We'll email you as soon as it is.");
  const ch = await addCustomHostname(env, h);
  await env.PREVIEWS.put(hubKey(h), c.id);
  c.site = { method: "hub", hub: { host: h, status: hostnameIsActive(ch) ? "active" : "pending", at: Date.now() } };
  await saveClient(env, c, `Answers hub set up at ${h} (waiting for DNS)`);
}

async function checkHub(env, c, saveClient) {
  const ch = await getCustomHostname(env, c.site.hub.host);
  if (!hostnameIsActive(ch)) return false;
  c.site.hub.status = "active";
  await saveClient(env, c, `Answers hub live at ${c.site.hub.host}`);
  for (const row of (c.pages || []).filter((x) => x.status === "ready")) {
    const p = await getPage(env, row.id);
    if (p) await publishPage(env, p, c, saveClient);
  }
  await sendEmail(env, { to: c.onboarding?.reportEmail || c.email, subject: `Your answers page is live: ${c.site.hub.host}`, text: `Hi,\n\nYour DNS record works. Your answer pages now live at:\nhttps://${c.site.hub.host}/\n\nNew pages will appear there automatically.\n\n${sign}` });
  return true;
}

// ---------------- Serving the hub (answers.theirsite.com) ----------------

export async function hubFor(env, host) {
  return env.PREVIEWS.get(hubKey(host));
}

export async function serveHub(env, host, url, getClient) {
  const c = await getClient(env, await hubFor(env, host));
  if (!c || c.status !== "active" || c.site?.method !== "hub") return html("<h1>Not found</h1>", 404);
  const co = companyOfClient(c);
  const live = livePages(c);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  if (p === "/robots.txt") return new Response(`User-agent: *\nAllow: /\n\nSitemap: https://${host}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain" } });
  if (p === "/llms.txt") return new Response(c.foundation?.llms || buildLlms(co, c.facts?.data, live), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  if (p === "/sitemap.xml") return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${host}/</loc></url>${live.map((x) => `<url><loc>${esc(x.url)}</loc></url>`).join("")}</urlset>`, { headers: { "Content-Type": "application/xml" } });
  if (p === "/") return html(renderHubIndex(co, live, c.foundation?.schema || buildSchema(co, c.facts?.data), host), 200, { "Cache-Control": "public, max-age=300" });
  const row = live.find((x) => `/${x.slug}` === p);
  const pg = row && (await getPage(env, row.id));
  if (!pg) return html(renderHubIndex(co, live, null, host, true), 404);
  return html(renderHubPage(co, pg, live, pageSchema(co, pg, pg.url), host), 200, { "Cache-Control": "public, max-age=300" });
}

// ---------------- The cron step ----------------

export async function runSiteWork(env, { listClients, saveClient }) {
  if (env.SITE_WORK_OFF === "true" || !env.ANTHROPIC_API_KEY) return 0;
  let done = 0;
  const budget = parseInt(env.SITE_BUDGET || "1", 10);
  for (const c of await listClients(env)) {
    try {
      const per = PAGES_PER_MONTH[c.plan];
      if (!per || c.status !== "active" || !c.onboardedAt) continue;
      if (c.site?.method === "hub" && c.site.hub?.status === "pending" && env.CF_SAAS_ZONE_ID) await checkHub(env, c, saveClient);
      if (done >= budget) continue;
      const method = methodOf(c);
      if (method !== "kit" && (!c.foundation || Date.now() - c.foundation.at > MONTH)) {
        await refreshFoundation(env, c, saveClient);
        done++;
        continue;
      }
      if (!(c.audits || []).length || (c.pages || []).some((x) => x.status === "review")) continue;
      if (Date.now() < (c.nextPageAt || 0)) continue;
      c.nextPageAt = Date.now() + Math.floor(MONTH / per);
      done++;
      await makePage(env, c, saveClient);
    } catch (e) {
      console.log("Site work failed for", c.id, e.message);
      await sendEmail(env, { to: env.OWNER_EMAIL, subject: `Website work stopped: ${c.onboarding?.business || c.email}`, text: `${e.message}\n\nIt tries again at the next slot. You can also make a page now from your admin page.` }).catch(() => {});
    }
  }
  return done;
}

// ---------------- Routes ----------------

export async function siteRoute(req, url, env, { getClient, saveClient }) {
  const p = url.pathname;
  let m;
  if (req.method === "POST" && p === "/api/site/connect") return await pluginConnect(req, env, { getClient, saveClient });
  if ((m = p.match(/^\/site\/(c[a-z0-9]{11})$/))) return await clientSitePage(req, env, m[1], { getClient, saveClient });
  if ((m = p.match(/^\/pg\/(g[a-z0-9]{11})$/))) return await reviewPage(req, url, env, m[1], { getClient, saveClient });
  throw httpError(404, "Page not found.");
}

const copyBox = (label, text, rows = 8) => `<label class="f"><span>${esc(label)}</span><textarea readonly rows="${rows}" onclick="this.select()">${esc(text)}</textarea></label><button type="button" class="ghost sm" onclick="navigator.clipboard.writeText(this.previousElementSibling.querySelector('textarea').value);this.textContent='Copied'">Copy</button>`;

async function clientSitePage(req, env, id, { getClient, saveClient }) {
  const c = await getClient(env, id);
  if (!c || c.status !== "active") throw httpError(404, "We couldn't find that. Check your email for the right link.");
  let flash = "";
  if (req.method === "POST") {
    const form = await req.formData();
    try {
      if (form.get("action") === "hub") {
        await setupHub(env, c, form.get("host"), saveClient);
        flash = "Almost done. Add the DNS record below, then this page shows when it's live.";
      } else if (form.get("action") === "disconnect") {
        c.site = { method: "kit" };
        await saveClient(env, c, "Website disconnected by client");
        flash = "Disconnected. Pages already published stay on your site.";
      }
    } catch (e) {
      flash = e.message;
    }
  }
  const co = companyOfClient(c);
  const root = rootDomain(c.onboarding?.website) || "yoursite.com";
  const method = methodOf(c);
  const code = method === "wordpress" ? null : await startConnect(env, c, saveClient);
  const status = method === "wordpress" ? `Connected: WordPress at ${esc(c.site.wp.site)}` : method === "hub" ? (c.site.hub.status === "active" ? `Live: <a href="https://${esc(c.site.hub.host)}/" target="_blank" rel="noopener">${esc(c.site.hub.host)}</a>` : `Waiting for your DNS record for ${esc(c.site.hub.host)}`) : "Not connected yet";
  const pages = (c.pages || []).filter((x) => x.status === "live" || x.status === "ready").slice(-20).reverse();
  const full = await Promise.all(pages.map((x) => getPage(env, x.id)));
  const foundation = c.foundation || { schema: buildSchema(co, c.facts?.data), llms: buildLlms(co, c.facts?.data, livePages(c)) };
  const body = `<main>
<h1>Your website</h1>
<p class="lede">We write pages that answer your buyers' questions and add the code AI tools read. Connect your site once and we publish them for you. Status: <strong>${status}</strong></p>
${flash ? `<p class="card"><strong>${esc(flash)}</strong></p>` : ""}
${method === "hub" && c.site.hub.status !== "active" ? `<div class="card"><h2>Add this DNS record</h2><p>Where you manage your domain (GoDaddy, Namecheap, Cloudflare, Squarespace Domains...), add:</p><table><tr><th>Type</th><th>Name</th><th>Value</th></tr><tr><td>CNAME</td><td>${esc(c.site.hub.host.replace(`.${root}`, ""))}</td><td>${esc(env.SAAS_CNAME_TARGET || "sites.vantryai.com")}</td></tr></table><p class="muted small">It usually works within an hour. We'll email you when it's live.</p></div>` : ""}
${method !== "wordpress" ? `<div class="card"><h2>WordPress site? (2 minutes)</h2><ol><li><a href="${PLUGIN_URL}">Download the Vantry Connect plugin</a></li><li>In WordPress: Plugins &gt; Add New &gt; Upload Plugin, choose the file, then Activate.</li><li>Go to Settings &gt; Vantry and paste this code:</li></ol>${copyBox("Your connect code", code, 2)}<p class="muted small">You can disconnect any time from the same page. We can only add and update the pages we create, plus your homepage's AI code.</p></div>
<form class="card" method="post"><h2>Webflow, Wix, Squarespace, Shopify or anything else?</h2><p>We host your answer pages on a subdomain of your own website. You add one DNS record, once.</p><label class="f"><span>Subdomain</span><input type="text" name="host" value="answers.${esc(root)}"></label><input type="hidden" name="action" value="hub"><button class="jelly sm">Set it up</button></form>` : `<form class="card" method="post"><input type="hidden" name="action" value="disconnect"><button class="ghost sm">Disconnect</button></form>`}
<div class="card"><h2>Code for your homepage (structured data)</h2><p class="muted small">${method === "wordpress" ? "Already added to your homepage by the plugin." : "Paste it into your site's header code (Webflow: Site settings &gt; Custom code; Wix: Settings &gt; Custom code; Squarespace: Settings &gt; Code injection)."}</p>${copyBox("Paste into your header", `<script type="application/ld+json">\n${JSON.stringify(foundation.schema, null, 2)}\n</script>`, 8)}</div>
<div class="card"><h2>llms.txt</h2><p class="muted small">${method === "wordpress" ? "Already live at your-site/llms.txt." : "A plain summary AI tools read. Upload it as a file named llms.txt at the root of your site, if your platform allows."}</p>${copyBox("llms.txt", foundation.llms, 8)}</div>
<div class="card"><h2>Your pages</h2>${full.filter(Boolean).length ? full.filter(Boolean).map((pg) => `<details><summary><strong>${esc(pg.title)}</strong> ${pg.url ? `· <a href="${esc(pg.url)}" target="_blank" rel="noopener">live</a>` : "· ready to add"}</summary>${copyBox("Page HTML (paste into a new page)", pageBody(co, pg), 10)}</details>`).join("") : '<p class="muted">Your first pages arrive within a few days of your starting report.</p>'}</div>
</main><style>.f{display:block;margin:10px 0 6px}.f span{display:block;font-weight:600;margin-bottom:6px}textarea,input[type=text]{width:100%;border:1px solid #B9C3D1;border-radius:12px;padding:10px 12px;font:14px ui-monospace,Menlo,monospace}table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:8px 12px;text-align:left}details{margin:12px 0}</style>`;
  return html(page({ title: "Your website", body }), 200, { "Cache-Control": "no-store" });
}

async function reviewPage(req, url, env, id, { getClient, saveClient }) {
  const form = req.method === "POST" ? await req.formData() : null;
  const key = form ? String(form.get("k") || "") : url.searchParams.get("k") || "";
  if (!safeEqual(key, await hmac(env, `page:${id}`))) throw httpError(404, "Page not found.");
  const p = await getPage(env, id);
  if (!p) throw httpError(404, "That page is gone.");
  const c = await getClient(env, p.clientId);
  if (!c) throw httpError(404, "Client not found.");
  const co = companyOfClient(c);
  let flash = "";
  if (form) {
    const action = String(form.get("action") || "");
    try {
      if (action === "approve" && p.status === "review") {
        await publishPage(env, p, c, saveClient);
        flash = p.url ? `Published: ${p.url}. The client got an email.` : "Approved. It's ready on their Vantry page, and the client got an email.";
      } else if (action === "redo") {
        if ((p.attempts || 1) >= MAX_ATTEMPTS) throw new Error(`Already tried ${MAX_ATTEMPTS} times. Skip this one.`);
        const note = String(form.get("note") || "").trim().slice(0, 300);
        p.status = "redone";
        await savePage(env, p);
        const row = (c.pages || []).find((x) => x.id === p.id);
        if (row) row.status = "redone";
        const np = await makePage(env, c, saveClient, { note, plan: p.kind === "compare" ? { kind: "compare", rival: { name: p.rival, site: p.rivalSite } } : { kind: "answer", question: p.q } });
        np.attempts = (p.attempts || 1) + 1;
        await savePage(env, np);
        return html(page({ title: "Redoing", body: `<main><h1>Done.</h1><p class="lede">A new version is ready: <a href="${esc(await reviewUrl(env, np.id))}">read it</a>.</p></main>` }));
      } else if (action === "skip" || action === "remove") {
        await unpublish(env, p, c);
        p.status = action === "skip" ? "skipped" : "removed";
        await savePage(env, p);
        const row = (c.pages || []).find((x) => x.id === p.id);
        if (row) row.status = p.status;
        await saveClient(env, c, `Page ${p.status}: ${p.title}`);
        flash = action === "skip" ? "Skipped." : "Removed from their site.";
      }
    } catch (e) {
      flash = e.message;
    }
  }
  const hidden = `<input type="hidden" name="k" value="${esc(key)}">`;
  const btn = (action, label, cls = "jelly sm") => `<form method="post" style="display:inline">${hidden}<input type="hidden" name="action" value="${action}"><button class="${cls}">${label}</button></form>`;
  const where = methodOf(c) === "wordpress" ? `their WordPress site (${esc(c.site.wp.site)})` : methodOf(c) === "hub" ? `their answers hub (${esc(c.site.hub.host)})` : "their Vantry page, for them to copy (site not connected)";
  const body = `<main>
<p class="muted small">${esc(co.name)} · ${esc(p.kind === "compare" ? `comparison with ${p.rival}` : "answer page")} · ${esc(p.status)}</p>
<h1>${esc(p.title)}</h1>
${flash ? `<p class="card"><strong>${esc(flash)}</strong></p>` : ""}
<div class="card">${p.status === "review" ? `<p>Approving publishes it to ${where}.</p><p>${btn("approve", "Approve and publish")} ${btn("skip", "Skip", "ghost sm")}</p><form method="post">${hidden}<input type="hidden" name="action" value="redo"><label class="f"><span>Redo with a note (optional)</span><textarea name="note" rows="2" placeholder="e.g. shorter, say more about pricing"></textarea></label><button class="ghost sm">Redo</button></form>` : p.url ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">Open the live page</a></p>${p.status === "live" ? btn("remove", "Remove from their site", "ghost sm") : ""}` : ""}</div>
<div class="card"><p class="muted small">${p.q ? `Buyer question: ${esc(p.q)}` : `Compared with: ${esc(p.rival)} (${esc(p.rivalSite || "")})`} · Description: ${esc(p.metaDescription)}</p><article class="pv">${pageBody(co, p)}</article></div>
</main><style>.f{display:block;margin:12px 0 6px}.f span{display:block;font-weight:600}textarea{width:100%;border:1px solid #B9C3D1;border-radius:12px;padding:10px 12px;font:15px var(--sans)}.pv table{border-collapse:collapse;width:100%}.pv td,.pv th{border:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}</style>`;
  return html(page({ title: "Check page", body }), 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
}

// ---------------- Admin ----------------

export async function siteAdmin(req, url, env, form, token, { getClient, saveClient }) {
  const c = await getClient(env, String(form?.get("clientId") || ""));
  let msg;
  try {
    if (!c) throw new Error("Client not found.");
    const p = await makePage(env, c, saveClient);
    msg = `Written: "${p.title}". Check your email to approve it.`;
  } catch (e) {
    msg = `Couldn't write it: ${e.message}`;
  }
  return Response.redirect(`${api(env)}/admin/audits?token=${encodeURIComponent(token)}&flash=${encodeURIComponent(msg)}`, 303);
}

export async function siteCard(env, clients, token) {
  const rows = [];
  for (const c of clients) for (const x of c.pages || []) rows.push({ c, x });
  rows.sort((a, b) => b.x.at - a.x.at);
  const links = await Promise.all(rows.slice(0, 30).map((r) => reviewUrl(env, r.x.id)));
  const eligible = clients.filter((c) => PAGES_PER_MONTH[c.plan] && c.status === "active" && c.onboardedAt);
  const conn = (c) => (c.site?.method === "wordpress" ? "WordPress" : c.site?.method === "hub" ? `Hub (${c.site.hub.status})` : "Not connected");
  return `<div class="card"><h2>Website pages</h2>
${eligible.length ? `<table>${eligible.map((c) => `<tr><td>${esc(c.onboarding?.business || c.email)}</td><td>${esc(conn(c))}</td><td><a href="/site/${c.id}" target="_blank" rel="noopener">Their page</a></td></tr>`).join("")}</table>
<form method="post" action="/admin/page" style="margin-top:14px"><input type="hidden" name="token" value="${esc(token)}"><select name="clientId">${eligible.map((c) => `<option value="${c.id}">${esc(c.onboarding?.business || c.email)}</option>`).join("")}</select> <button class="jelly sm">Write a page now</button></form>` : ""}
${rows.length ? `<table style="margin-top:14px"><tr><th>Page</th><th>Client</th><th>Status</th></tr>${rows.slice(0, 30).map((r, i) => `<tr><td><a href="${esc(links[i])}">${esc(r.x.title)}</a></td><td>${esc(r.c.onboarding?.business || r.c.email)}</td><td>${esc(r.x.status)}${r.x.url ? ` · <a href="${esc(r.x.url)}" target="_blank" rel="noopener">open</a>` : ""}</td></tr>`).join("")}</table>` : '<p class="muted">No pages yet. Growth clients get 3 a month and Pro clients 6, once their starting report is done.</p>'}
</div>`;
}
