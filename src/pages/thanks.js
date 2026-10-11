import { esc } from "../lib/util.js";
import { page } from "./shell.js";

const STEPS = {
  checkout: "Waiting for your payment to finish. This page updates on its own.",
  paid: "Payment received. We're setting things up.",
  domain_registering: "Payment received. We're registering your domain.",
  domain_problem: "Payment received. We hit a snag with your domain and we're on it. We'll email you.",
  waiting_dns: "Payment received. Next, connect your domain using the steps we emailed you.",
  needs_review: "Payment received. A real person is checking your site now.",
  live: "Your website is live.",
  canceled: "This order was canceled.",
};

export function thanksPage(order, site) {
  const done = order.status === "live";
  const body = `<main>
<h1>${done ? "You're live." : "Thank you. We're on it."}</h1>
<p class="lede" id="status">${esc(STEPS[order.status] || STEPS.paid)}</p>
<section class="card">
  <h2>What happens next</h2>
  <ol>
    <li>${order.domain.mode === "new" ? `We register <strong>${esc(order.domain.name)}</strong> for you.` : `You connect <strong>${esc(order.domain.name)}</strong> with the two settings we emailed you.`}</li>
    <li>A real person checks your ${esc(site?.businessName || "")} site.</li>
    <li>We email ${esc(order.email)} as soon as it's live, usually within 2 business days.</li>
  </ol>
  ${done ? `<p><a class="jelly" href="https://www.${esc(order.domain.name)}">Visit my website</a></p>` : ""}
  <p class="muted small">Changed your mind? You get a full refund any time before your site goes live. Just reply to our email.</p>
</section>
</main>`;
  const script = order.status === "checkout" ? `setTimeout(function(){location.reload()},4000);` : "";
  return page({ title: "Thank you", body, script });
}
