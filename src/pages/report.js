// The AI visibility report a business sees: is it named when buyers ask AI, who is named instead,
// and which sites the AI trusted. Every number comes straight from the stored answers.
import { esc } from "../lib/util.js";
import { ENGINES } from "../lib/aiscan.js";
import { page } from "./shell.js";

const when = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

export function reportPage(audit, { plansUrl = "https://vantryai.com/ai/#plans" } = {}) {
  const { company, summary: s } = audit;
  const name = esc(company.name);
  const pct = s.total ? Math.round((s.mentioned / s.total) * 100) : 0;
  const verdict = !s.total
    ? "We couldn't get answers this time. Please try again later."
    : s.mentioned === 0
      ? `When buyers ask AI about ${esc(company.category)}, ${name} didn't come up in any of the ${s.total} answers we checked.`
      : s.mentioned === s.total
        ? `${name} came up in every answer we checked. Nice work.`
        : `${name} came up in ${s.mentioned} of ${s.total} answers. The rest went to other companies.`;

  const engineRow = audit.engines
    .map((e) => {
      const b = s.byEngine[e] || { total: 0, mentioned: 0 };
      return `<div class="eng"><span>${esc(ENGINES[e]?.label || e)}</span><strong class="${b.mentioned ? "ok" : "bad"}">${b.mentioned} of ${b.total}</strong></div>`;
    })
    .join("");

  const competitors = s.competitors.length
    ? `<ol class="rank">${s.competitors.slice(0, 8).map((c) => `<li><span>${esc(c.name)}</span><span class="muted small">named ${c.count}×</span></li>`).join("")}</ol>`
    : `<p class="muted">No other companies were named clearly.</p>`;

  const sources = s.sources.length
    ? `<ul class="chips">${s.sources.slice(0, 10).map((x) => `<li>${esc(x.name)}</li>`).join("")}</ul>`
    : `<p class="muted">The AI didn't list sources for these answers.</p>`;

  const byQuestion = audit.questions
    .map((q) => {
      const rows = audit.results
        .filter((r) => r.q === q)
        .map((r) => {
          const label = esc(ENGINES[r.engine]?.label || r.engine);
          if (r.error) return `<div class="ans"><div class="ah"><strong>${label}</strong><span class="muted small">${esc(r.error)}</span></div></div>`;
          const tag = r.mentioned ? `<span class="pill okp">${name} named</span>` : `<span class="pill badp">Not named</span>`;
          const named = r.named.length ? `<p class="small"><span class="muted">Named instead:</span> ${r.named.slice(0, 6).map(esc).join(", ")}</p>` : "";
          const excerpt = r.text ? `<p class="ex">${esc(r.text.replace(/\s+/g, " ").slice(0, 320))}${r.text.length > 320 ? "…" : ""}</p>` : "";
          const srcs = r.sources.length ? `<p class="small muted">Sources: ${r.sources.slice(0, 5).map((x) => esc(x.domain)).join(" · ")}</p>` : "";
          return `<div class="ans"><div class="ah"><strong>${label}</strong>${tag}</div>${named}${excerpt}${srcs}</div>`;
        })
        .join("");
      return `<section class="card"><h2>“${esc(q)}”</h2>${rows}</section>`;
    })
    .join("");

  const body = `<main>
<p class="eyebrow">AI visibility report · ${esc(when(audit.createdAt))}</p>
<h1>Does AI recommend ${name}?</h1>
<p class="lede">${verdict}</p>

<section class="card score">
  <div class="big"><strong>${s.mentioned}</strong><span>of ${s.total} answers named ${name}</span></div>
  <div class="bar" role="img" aria-label="${pct}% of answers"><i style="width:${pct}%"></i></div>
  <div class="engs">${engineRow}</div>
</section>

<section class="card"><h2>Who AI recommends instead</h2>${competitors}</section>
<section class="card"><h2>The sites AI trusted for these answers</h2><p class="muted small">Being mentioned on sites like these is a big part of how AI decides who to recommend.</p>${sources}</section>

${byQuestion}

<section class="card cta">
  <h2>Want to be the one AI recommends?</h2>
  <p>We fix what AI reads about ${name}: your site, the lists and directories AI cites, and the answers buyers ask about. Every month you get a report like this one, so you can see the change yourself.</p>
  <p class="small muted">Month to month. First month money-back. If you're not named in at least one new AI answer within 60 days, your next month is free.</p>
  <a class="jelly" href="${esc(plansUrl)}">See plans, from $149/month</a>
</section>

<p class="small muted note">How we checked: we asked each AI the questions above through its official API with web search turned on, on ${esc(when(audit.createdAt))}. Answers in the apps can differ by person and change from day to day, so treat this as a snapshot, not a guarantee. Nobody can promise a ranking in AI answers, and we won't.</p>
</main>
<style>
.eyebrow{font-size:13px;font-weight:600;color:var(--muted);margin:0 0 8px}
.score .big{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.score .big strong{font:700 56px/1 var(--serif);letter-spacing:-.04em;color:var(--navy)}.score .big span{color:var(--muted)}
.bar{height:10px;border-radius:99px;background:#E7EEF8;margin:16px 0;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#6BACFF,#2F7DDE);border-radius:99px}
.engs{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}.eng{border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}.eng span{font-size:13px;color:var(--muted)}
.rank{margin:8px 0 0;padding-left:22px}.rank li{padding:6px 0;border-top:1px solid #EEF2F8;display:flex;justify-content:space-between;gap:12px}.rank li:first-child{border-top:0}
.chips{list-style:none;padding:0;margin:10px 0 0;display:flex;flex-wrap:wrap;gap:6px}.chips li{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:14px;background:#F8FAFE}
.ans{border-top:1px solid #EEF2F8;padding:12px 0}.ans:first-of-type{border-top:0}.ah{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.pill{font-size:12px;font-weight:600;border-radius:999px;padding:3px 10px}.okp{background:#E6F5EC;color:var(--ok)}.badp{background:#FDECEF;color:var(--bad)}
.ex{margin:6px 0;font-size:14px;color:#3A3D5C}
.cta{background:linear-gradient(160deg,#FFFFFF,#F1F7FF)}.cta .jelly{margin-top:6px}
.note{margin-top:24px}
</style>`;
  return page({ title: `AI visibility report for ${company.name}`, body });
}
