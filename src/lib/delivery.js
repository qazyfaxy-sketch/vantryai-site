// What paying AI-visibility clients get, automatically:
//   1. Starting report right after onboarding, on their own buyer questions.
//   2. A fresh report every 30 days, compared with last month ("named in 5 of 25, up from 2").
//   3. A fix list: their website checked for what AI needs, plus the sites AI cites that they're missing from.
//      Starter clients get it to do themselves; for Growth and Pro it's also your to-do list.
//   4. The 60-day promise: if nothing new names them by day 60, their next month is made free in Stripe.
//
// Client checks can be big (Pro: 50 questions x 4 engines), so they run in small pieces on the
// 10-minute cron and finish over an hour or two. Nothing here can throw out of the cron.
import { availableEngines, askOne, brandTerms, finishAudit, getAudit, writeQuestions } from "./aiscan.js";
import { stripe } from "./stripe.js";
import { dashUrl } from "./dashboard.js";
import { sendEmail } from "./email.js";

export const QUESTION_LIMIT = { starter: 10, growth: 25, pro: 50 };
const DAY = 86400000;
const MONTH = 30 * DAY;
const PROMISE_DAYS = 60;

const sign = "Thanks,\nVince\nVantry · vantryai.com";
const reportUrl = (env, id) => `${env.PUBLIC_API || "https://api.vantryai.com"}/r/${id}`;

// ---------------- Questions we track for a client ----------------

export async function buildQuestions(env, c) {
  const limit = QUESTION_LIMIT[c.plan] || 10;
  const own = String(c.onboarding?.questions || "")
    .split(/\n|\?/)
    .map((s) => s.trim().replace(/^[-*•\d.)\s]+/, ""))
    .filter((s) => s.length > 8)
    .map((s) => (s.endsWith("?") ? s : `${s}?`));
  const company = companyOf(c);
  const want = Math.max(0, limit - own.length);
  const written = want ? await writeQuestions(env, company, Math.min(want, 12)) : [];
  return [...new Set([...own, ...written])].slice(0, limit);
}

export function companyOf(c) {
  const o = c.onboarding || {};
  const site = String(o.website || "").trim();
  const host = site.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return {
    name: String(o.business || host.split(".")[0] || "Your company").slice(0, 80),
    website: site,
    category: String(o.sell || "software").slice(0, 120),
    audience: String(o.buyers || "").slice(0, 120),
  };
}

// Called when the onboarding form is sent: queue the starting report.
export async function queueStart(env, c) {
  c.questions = await buildQuestions(env, c);
  c.job = newJob(env, c, "baseline");
  return c;
}

function newJob(env, c, kind) {
  const engines = availableEngines(env);
  return { kind, createdAt: Date.now(), engines, pairs: c.questions.flatMap((q) => engines.map((e) => [q, e])), next: 0, results: [] };
}

// ---------------- The cron step ----------------

export async function runDelivery(env, { listClients, saveClient }) {
  const budget = parseInt(env.DELIVERY_BUDGET || "12", 10); // AI calls per cron run (Cloudflare caps outside calls per run)
  let used = 0;
  for (const c of await listClients(env)) {
    try {
      if (c.status !== "active" || !c.onboardedAt) continue;
      if (!c.job && dueForMonthly(c)) {
        c.job = newJob(env, c, "monthly");
        await saveClient(env, c, "Monthly check queued");
      }
      if (c.job && used < budget) {
        used += await work(env, c, budget - used, saveClient);
      }
      if (!c.job && promiseDue(c)) await checkPromise(env, c, saveClient);
    } catch (e) {
      console.log("Delivery failed for", c.id, e.stack || e.message);
    }
  }
  return used;
}

const lastAudit = (c) => (c.audits || []).slice(-1)[0];
const dueForMonthly = (c) => !!lastAudit(c) && Date.now() - lastAudit(c).at >= MONTH;
const promiseDue = (c) => !c.promise && c.startedAt && Date.now() - c.startedAt >= PROMISE_DAYS * DAY && (c.audits || []).length >= 2;

async function work(env, c, allowance, saveClient) {
  const job = c.job;
  if (!job.engines.length) return 0;
  const brand = brandTerms(companyOf(c).name, companyOf(c).website);
  const slice = job.pairs.slice(job.next, job.next + allowance);
  const rows = await Promise.all(slice.map(([q, e]) => askOne(env, e, q, brand)));
  job.results.push(...rows);
  job.next += slice.length;
  if (job.next < job.pairs.length) {
    await saveClient(env, c);
    return slice.length;
  }
  // Done: save the report, compare with last time, send it.
  const audit = await finishAudit(env, { company: companyOf(c), questions: c.questions, engines: job.engines, results: job.results, origin: `client:${c.id}` });
  const prev = lastAudit(c) ? await getAudit(env, lastAudit(c).id) : null;
  const site = await checkSite(c.onboarding?.website);
  const fixes = fixList(site, audit);
  (c.audits ||= []).push({ id: audit.id, at: audit.createdAt, mentioned: audit.summary.mentioned, total: audit.summary.total, kind: job.kind });
  c.audits = c.audits.slice(-24);
  c.job = null;
  await saveClient(env, c, `${job.kind === "baseline" ? "Starting" : "Monthly"} report sent (${audit.summary.mentioned}/${audit.summary.total})`);
  await sendReport(env, c, audit, prev, fixes, job.kind);
  return slice.length;
}

// ---------------- Comparing two months ----------------

const key = (r) => `${r.engine}|${r.q}`;
export function compare(audit, prev) {
  if (!prev) return { newlyNamed: [], lost: [] };
  const before = new Map(prev.results.filter((r) => !r.error).map((r) => [key(r), r.mentioned]));
  const now = audit.results.filter((r) => !r.error);
  return {
    newlyNamed: now.filter((r) => r.mentioned && before.get(key(r)) === false),
    lost: now.filter((r) => !r.mentioned && before.get(key(r)) === true),
  };
}

// ---------------- Website check ----------------

const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Google-Extended"];

async function getText(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "VantryCheck/1.0 (+https://vantryai.com/ai/)" }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    return res.ok ? (await res.text()).slice(0, 400000) : null;
  } catch {
    return null;
  }
}

export async function checkSite(website) {
  const site = String(website || "").trim();
  if (!site) return null;
  const base = (/^https?:\/\//.test(site) ? site : `https://${site}`).replace(/\/+$/, "");
  const [home, robots, llms] = await Promise.all([getText(base), getText(`${base}/robots.txt`), getText(`${base}/llms.txt`)]);
  if (!home) return { reachable: false, base };
  const lower = home.toLowerCase();
  const blocked = robots ? blockedBots(robots) : [];
  return {
    reachable: true,
    base,
    title: /<title[^>]*>\s*[^<\s][^<]*<\/title>/i.test(home),
    description: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{30,}/i.test(home) || /<meta[^>]+content=["'][^"']{30,}["'][^>]+name=["']description["']/i.test(home),
    schema: /application\/ld\+json/i.test(home),
    faqSchema: /"@type"\s*:\s*"FAQPage"/i.test(home),
    llms: !!(llms && llms.trim().length > 20 && !/<html/i.test(llms)),
    blocked,
    pricing: /href=["'][^"']*pricing/i.test(lower),
    comparison: /href=["'][^"']*(\bvs\b|-vs-|compare|alternative)/i.test(lower),
  };
}

export function blockedBots(robots) {
  const groups = [];
  let cur = null;
  for (const raw of robots.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase(), val = m[2].trim();
    if (field === "user-agent") {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
    } else if (cur && (field === "disallow" || field === "allow")) cur.rules.push([field, val]);
  }
  const blocksAll = (g) => g.rules.some(([f, v]) => f === "disallow" && v === "/") && !g.rules.some(([f, v]) => f === "allow" && v === "/");
  return AI_BOTS.filter((bot) => {
    const own = groups.find((g) => g.agents.includes(bot.toLowerCase()));
    const g = own || groups.find((x) => x.agents.includes("*"));
    return g ? blocksAll(g) : false;
  });
}

// ---------------- The fix list (priority order) ----------------

export function fixList(site, audit) {
  const fixes = [];
  const add = (title, why) => fixes.push({ title, why });
  if (site && !site.reachable) add("Make sure your website loads for AI tools", `We couldn't load ${site.base}. If AI can't read your site, it can't learn about you.`);
  if (site?.reachable && site.blocked.length) add(`Let AI tools read your site (now blocked: ${site.blocked.join(", ")})`, "Your robots.txt tells these AI crawlers to stay out, so they can't learn about you. Allow them.");
  // Most evidence: AI tends to repeat what trusted third-party sites say. Studies link this to being named more (a pattern, not a guarantee).
  const s = audit.summary;
  const notCited = s.sources.filter((x) => !x.name.endsWith(brandTerms("", audit.company.website).host || "~")).slice(0, 4).map((x) => x.name);
  if (notCited.length) add(`Get listed accurately on the sites AI trusts: ${notCited.join(", ")}`, "These are the sites AI cited for your buyers' questions. AI tends to repeat what trusted sites say, and studies link being mentioned on them with being named more. It's a pattern, not a guarantee. Use accurate details and only real reviews.");
  const missed = audit.results.filter((r) => !r.error && !r.mentioned && r.named.length).slice(0, 3);
  for (const r of missed) add(`Answer "${r.q}"`, `${r.named.slice(0, 3).join(", ")} ${r.named.length > 1 ? "were" : "was"} named instead. A clear, honest page answering this question gives search engines and AI something to use.`);
  if (site?.reachable) {
    if (!site.comparison) add("Publish comparison pages (you vs. the companies AI names)", "Buyers ask AI for alternatives and comparisons. Clear, fair comparison pages give them something to cite.");
    if (!site.pricing) add("Publish a clear pricing page", "AI answers often mention price. Without a pricing page, AI may guess or skip you.");
    if (!site.faqSchema) add("Answer buyer questions on your site", "Write short, honest answers to the exact questions buyers ask AI. Original, useful answers are what search engines, including Google's AI features, reward.");
    if (!site.description) add("Write a clear meta description for your homepage", "One sentence on what you do and for whom. Search engines read it.");
    // Basics: cheap and tidy, but tests have not shown they make AI name you more. Listed last, and said plainly.
    if (!site.schema) add("Add structured data (schema) to your homepage (a basic)", "Good housekeeping that helps search engines read your basics. Tests haven't shown it makes AI name you more, so don't expect it to move results on its own.");
    if (!site.llms) add("Add an llms.txt file (a basic)", "A plain summary of your business at yoursite.com/llms.txt. Google says it isn't needed and studies haven't found it changes citations. It's cheap, but optional.");
  }
  return fixes.slice(0, 10);
}

// ---------------- Emails ----------------

async function sendReport(env, c, audit, prev, fixes, kind) {
  const s = audit.summary;
  const name = audit.company.name;
  const { newlyNamed, lost } = compare(audit, prev);
  const to = c.onboarding?.reportEmail || c.email;
  const doneForYou = c.plan === "growth" || c.plan === "pro";
  const headline = kind === "baseline"
    ? `Here's your starting point: ${name} is named in ${s.mentioned} of ${s.total} AI answers to your buyers' questions.`
    : `This month: ${name} is named in ${s.mentioned} of ${s.total} AI answers${prev ? ` (last month: ${prev.summary.mentioned} of ${prev.summary.total})` : ""}.`;
  const label = (r) => `- "${r.q}" (${r.engine === "openai" ? "ChatGPT" : r.engine[0].toUpperCase() + r.engine.slice(1)})`;
  const fixText = fixes.map((f, i) => `${i + 1}. ${f.title}\n   ${f.why}`).join("\n");
  const text = `Hi,

${headline}

${newlyNamed.length ? `New this month, you're now named for:\n${newlyNamed.slice(0, 10).map(label).join("\n")}\n\n` : ""}${lost.length ? `Answers that stopped naming you (AI answers change, we're on it):\n${lost.slice(0, 5).map(label).join("\n")}\n\n` : ""}${s.competitors.length ? `Named most often instead of you: ${s.competitors.slice(0, 3).map((x) => x.name).join(", ")}.\n\n` : ""}Your full report, with every answer:
${reportUrl(env, audit.id)}

Your dashboard (then and now, and everything we've done):
${await dashUrl(env, c.id)}

${doneForYou ? "What we're working on this month:" : "Your fix list for this month, most important first:"}
${fixText || "Nothing urgent. Keep going."}

Questions? Just reply.

${sign}`;
  await sendEmail(env, { to, subject: kind === "baseline" ? `Your starting AI visibility report: ${s.mentioned} of ${s.total}` : `Your AI visibility this month: ${s.mentioned} of ${s.total}${newlyNamed.length ? `, ${newlyNamed.length} new` : ""}`, text });
  await sendEmail(env, {
    to: env.OWNER_EMAIL,
    subject: `${doneForYou ? "To do" : "Sent"}: ${name} ${kind} report (${s.mentioned}/${s.total})`,
    text: `${c.email} (${c.plan})\n${reportUrl(env, audit.id)}\n\n${doneForYou ? "Do these this month:\n" : "Fix list we sent them:\n"}${fixText}`,
  });
}

// ---------------- The 60-day promise ----------------

async function promiseCoupon(env) {
  const cached = await env.PREVIEWS.get("ai:promiseCoupon");
  if (cached) return cached;
  const coupon = await stripe(env, "/coupons", { percent_off: 100, duration: "once", name: "60-day promise: next month free" });
  await env.PREVIEWS.put("ai:promiseCoupon", coupon.id);
  return coupon.id;
}

async function checkPromise(env, c, saveClient) {
  const base = (c.audits || []).find((a) => a.kind === "baseline") || c.audits[0];
  const latest = lastAudit(c);
  const [a0, a1] = await Promise.all([getAudit(env, base.id), getAudit(env, latest.id)]);
  if (!a0 || !a1) return;
  const gained = compare(a1, a0).newlyNamed.length;
  if (gained > 0) {
    c.promise = { at: Date.now(), kept: true, gained };
    await saveClient(env, c, `60-day promise kept (${gained} new answers)`);
    return;
  }
  c.promise = { at: Date.now(), kept: false };
  let applied = false;
  if (c.stripe?.subscription) {
    try {
      await stripe(env, `/subscriptions/${c.stripe.subscription}`, { discounts: { 0: { coupon: await promiseCoupon(env) } } });
      applied = true;
    } catch (e) {
      console.log("Promise coupon failed", e.message);
    }
  }
  c.promise.freeMonth = applied;
  await saveClient(env, c, applied ? "60-day promise: next month made free" : "60-day promise: free month NOT applied, needs you");
  await sendEmail(env, {
    to: c.onboarding?.reportEmail || c.email,
    subject: "Your next month is on us",
    text: `Hi,

We promised that if no new AI answer named you within 60 days, your next month would be free. It hasn't happened yet, so ${applied ? "your next month is free. You don't need to do anything." : "we're making your next month free. You'll see it on your next invoice."}

We're keeping at it. Your latest report:
${reportUrl(env, a1.id)}

${sign}`,
  });
  await sendEmail(env, { to: env.OWNER_EMAIL, subject: `${applied ? "Applied" : "ACTION NEEDED"}: 60-day promise for ${c.email}`, text: applied ? `No new answers in 60 days, so their next month is free (Stripe coupon applied).` : `No new answers in 60 days. The automatic free month failed. In Stripe, add a 100% one-time discount to their subscription.` });
}
