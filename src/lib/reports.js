// Monthly results email: on the 1st of each month, every live site's owner gets their numbers.
// It's the clearest proof the website is working, which is why people keep paying.
import { listOrders, getSite } from "./store.js";
import { getStats } from "./stats.js";
import { send } from "./email.js";

const PER_RUN = 25; // emails per 10-minute run, so a big month spreads out

export async function runMonthlyReports(env, now = new Date()) {
  if (now.getUTCDate() !== 1 || now.getUTCHours() < 14) return 0; // the 1st, from about 10am Eastern
  const month = now.toISOString().slice(0, 7);
  let sent = 0;
  for (const o of await listOrders(env)) {
    if (sent >= PER_RUN) break;
    if (o.status !== "live") continue;
    const key = `report:${month}:${o.id}`;
    if (await env.PREVIEWS.get(key)) continue;
    const site = await getSite(env, o.id);
    if (!site || site.offline || site.noReports) {
      await env.PREVIEWS.put(key, "skipped", { expirationTtl: 60 * 86400 });
      continue;
    }
    const stats = await getStats(env, o.id, 30);
    await send(env, "monthlyReport", { site, stats });
    await env.PREVIEWS.put(key, "sent", { expirationTtl: 60 * 86400 });
    sent++;
  }
  return sent;
}
