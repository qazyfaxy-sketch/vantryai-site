// Your private dashboard: every order, its progress, and one-click approve.
import { esc } from "../lib/util.js";
import { page } from "./shell.js";

const LABEL = {
  checkout: ["Not paid yet", "muted"],
  paid: ["Paid, setting up", ""],
  domain_registering: ["Registering domain", ""],
  domain_problem: ["Domain problem: needs you", "bad"],
  waiting_dns: ["Waiting for customer's DNS", ""],
  needs_review: ["Ready for your review", "bad"],
  live: ["Live", "ok"],
  canceled: ["Canceled / offline", "muted"],
};

export function adminPage(orders, token, flash = "") {
  const rows = orders
    .filter((o) => o.status !== "checkout" || Date.now() - o.createdAt < 2 * 86400000)
    .map((o) => {
      const [label, cls] = LABEL[o.status] || [o.status, ""];
      const btn = (action, text, primary) =>
        `<form method="post" action="/admin/action"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="orderId" value="${esc(o.id)}"><input type="hidden" name="action" value="${action}"><button class="${primary ? "jelly sm" : "ghost"}">${text}</button></form>`;
      const actions = [
        o.status !== "checkout" && `<a class="ghost" href="/admin/site/${esc(o.id)}?token=${encodeURIComponent(token)}" target="_blank" rel="noopener">View site</a>`,
        ["needs_review", "waiting_dns", "domain_registering"].includes(o.status) && !o.approved && btn("approve", "Approve", true),
        ["domain_problem", "paid", "domain_registering", "waiting_dns"].includes(o.status) && btn("retry", "Retry setup"),
        o.status === "live" && btn("offline", "Take offline"),
        o.status === "canceled" && o.stripe && btn("online", "Put back online"),
      ].filter(Boolean).join("");
      const last = (o.history || []).slice(-1)[0];
      return `<tr>
<td><strong>${esc(o.businessName || "")}</strong><br><span class="muted small">${esc(o.email)}</span></td>
<td>${esc(o.domain?.name || "")}<br><span class="muted small">${o.domain?.mode === "own" ? "Their domain" : "We register"}</span></td>
<td>${o.plan === "once" ? "$200 once" : "$49/mo"}<br><span class="muted small">${esc(o.style)}</span></td>
<td><span class="${cls}"><strong>${esc(label)}</strong></span>${o.approved && o.status !== "live" ? '<br><span class="small muted">Approved, goes live when domain is ready</span>' : ""}${last ? `<br><span class="small muted">${esc(last.note)}</span>` : ""}</td>
<td class="acts">${actions}</td></tr>`;
    })
    .join("");

  const body = `<main class="wide">
<h1>Orders</h1>
<p class="lede">Approve a site once you've checked it. It goes live as soon as its domain is ready, and the customer gets an email.</p>
${flash ? `<p class="card ok"><strong>${esc(flash)}</strong></p>` : ""}
<div class="card table"><table>
<thead><tr><th>Business</th><th>Domain</th><th>Plan</th><th>Status</th><th>Actions</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5" class="muted">No orders yet. They will show up here after the first checkout.</td></tr>'}</tbody>
</table></div>
</main>
<style>.table{overflow-x:auto;padding:8px}table{border-collapse:collapse;width:100%;font-size:14px;min-width:760px}
th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:10px}td{padding:12px 10px;border-top:1px solid var(--line);vertical-align:top}
.acts{display:flex;gap:6px;flex-wrap:wrap}.acts form{margin:0}</style>`;
  return page({ title: "Orders", body });
}
