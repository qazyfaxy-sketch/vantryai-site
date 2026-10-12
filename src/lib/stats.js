// Simple stats for each customer site: visits, call taps, text taps, quote requests.
// Visits and taps go to Cloudflare Workers Analytics Engine (binding STATS, dataset vantry_stats),
// which is free and built for counting. Quote requests are already saved as lead:<siteId>:<ts>.
// Reading the numbers needs a Cloudflare token with "Account Analytics: Read".

const DATASET = "vantry_stats";
const EVENTS = ["view", "call", "text"];
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor|curl|wget|python|go-http/i;

export const isBot = (ua = "") => !ua || BOT.test(ua);

export function track(env, siteId, event) {
  if (!env.STATS || !EVENTS.includes(event) || !/^o[a-z0-9]{12}$/.test(siteId)) return;
  try {
    env.STATS.writeDataPoint({ blobs: [siteId, event], doubles: [1], indexes: [siteId] });
  } catch (e) {
    console.log("Stats write failed", e.message);
  }
}

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

// Returns { days: [{ day, view, call, text, quote }], totals, visitsReady }
export async function getStats(env, siteId, days = 30) {
  const since = Date.now() - days * 86400000;
  const rows = {};
  for (let i = days - 1; i >= 0; i--) rows[dayKey(Date.now() - i * 86400000)] = { view: 0, call: 0, text: 0, quote: 0 };

  // Quote requests: counted from what we saved.
  let cursor;
  do {
    const page = await env.PREVIEWS.list({ prefix: `lead:${siteId}:`, cursor });
    for (const k of page.keys) {
      const ts = parseInt(k.name.split(":").pop(), 10);
      if (ts >= since && rows[dayKey(ts)]) rows[dayKey(ts)].quote++;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  // Visits and taps: from Analytics Engine.
  let visitsReady = false;
  const token = env.CF_ANALYTICS_TOKEN || env.CF_API_TOKEN;
  if (token && env.CF_ACCOUNT_ID && /^o[a-z0-9]{12}$/.test(siteId)) {
    const sql = `SELECT blob2 AS event, toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, SUM(_sample_interval) AS n
FROM ${DATASET} WHERE index1 = '${siteId}' AND timestamp > NOW() - INTERVAL '${days}' DAY
GROUP BY event, day FORMAT JSON`;
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: sql,
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const d = await res.json();
        for (const r of d.data || []) {
          const k = String(r.day).slice(0, 10);
          if (rows[k] && EVENTS.includes(r.event)) rows[k][r.event] += Number(r.n) || 0;
        }
        visitsReady = true;
      } else {
        console.log("Stats query failed", res.status, (await res.text()).slice(0, 200));
      }
    } catch (e) {
      console.log("Stats query error", e.message);
    }
  }

  const list = Object.entries(rows).map(([day, v]) => ({ day, ...v }));
  const totals = list.reduce((t, r) => ({ view: t.view + r.view, call: t.call + r.call, text: t.text + r.text, quote: t.quote + r.quote }), { view: 0, call: 0, text: 0, quote: 0 });
  return { days: list, totals, visitsReady };
}
