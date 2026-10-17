# Vantry engine

The whole back end for vantryai.com, in one Cloudflare Worker.

## What it does

1. **Preview.** A visitor fills in the form on vantryai.com. One AI call writes their site's words, and they get it in 3 styles.
2. **Pick a domain.** "Make it live – $200" opens a page where they choose a style, pick a free web address (we suggest names from their business name and check which are available), or use a domain they already own.
3. **Pay.** Stripe's secure checkout: **$200 today, then $50/year**, or **$49/month for 12 months, then $50/year**. Renewals are automatic.
4. **Set up.** After payment the engine automatically:
   - registers the domain (Cloudflare Registrar, about $10/year at cost) using the customer's contact details
   - points it at their site, with free HTTPS
   - or, for their own domain, emails them the two settings to change
   - emails them a receipt and next steps, and emails you a "new order" note
5. **Review.** You open your dashboard, look at the site and press **Approve**. It goes live and the customer gets a "You're live" email.
6. **Leads.** The quote form on every live site emails the business owner. They can reply straight from their inbox.
7. **Cancellations.** If a plan ends in Stripe, the site switches to an "offline" page. The domain stays theirs.

Problems (for example, a domain that fails to register) email you, and the dashboard has a **Retry setup** button.

## Your dashboard

`https://api.vantryai.com/admin?token=YOUR_ADMIN_TOKEN`

Bookmark it. Don't share it.

## Protection against AI bills and spam

- 2 free previews per email, 6 per connection per hour, and a daily ceiling (`DAILY_PREVIEW_CAP`, default 300)
- Hidden "honeypot" fields catch most bots
- Optional Cloudflare Turnstile check (`TURNSTILE_SECRET`)
- Every Stripe event is signature-checked, so nobody can fake a payment

## One-time setup

You'll need accounts at **Cloudflare** (vantryai.com must use Cloudflare for its DNS), **Stripe** (done), **Resend** (free) and an AI API account.

1. **Cloudflare billing.** Add a payment method (Billing) and accept the Domain Registration Agreement under Domain Registration. That card pays about $10 per domain you register, which your $200 covers.
2. **Storage.** Run `npx wrangler kv namespace create PREVIEWS` and paste the id into `wrangler.toml`.
3. **IDs.** Paste your Cloudflare account ID and the vantryai.com zone ID into `wrangler.toml`.
4. **Customer-owned domains.** In Cloudflare, go to vantryai.com, then SSL/TLS, then Custom Hostnames. Turn on Cloudflare for SaaS (the first 100 hostnames are free). Add a DNS record `sites` (AAAA `100::`, proxied) and set `sites.vantryai.com` as the fallback origin.
5. **Email.** In Resend, add the domain `send.vantryai.com`, then copy the DNS records it shows into Cloudflare. This won't affect your Zoho inbox.
6. **Stripe webhook.** In Stripe, go to Developers, then Webhooks, and add the endpoint `https://api.vantryai.com/api/stripe/webhook`. Choose these events:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
7. **Secrets.** For each of these, run `npx wrangler secret put NAME`:
   - `ANTHROPIC_API_KEY`
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `CF_API_TOKEN`
   - `RESEND_API_KEY`
   - `ADMIN_TOKEN` (make up a long random password)

   The Cloudflare token needs these permissions:
   - Account: Registrar (Edit)
   - Zone: Zone (Edit), DNS (Edit), Workers Routes (Edit), SSL and Certificates (Edit)
8. **Deploy.** Run `npx wrangler deploy`.
9. **Test with Stripe test keys first.** Use the card `4242 4242 4242 4242` with any future date. A domain registration is a real purchase, so test with your own domain mode ("I already own one") until you're ready.

## AI visibility ("Get recommended by ChatGPT")

Code: `src/ai.js`, `src/lib/aiscan.js`, `src/pages/report.js`.

1. **Free report.** The form on vantryai.com/ai sends a business's name, website, what it sells and an email. We write 3 buyer questions, ask each AI engine (ChatGPT, Perplexity, Gemini, Claude: whichever have keys) with web search on, and check who gets named. They get a report link by email, and so do you.
2. **Report page** (`/r/:id`): how many answers named them, per AI, who was named instead, which sites the AI cited, and every answer. It says plainly how and when it was checked and never promises a ranking.
3. **Plans:** Starter $149, Growth $497, Pro $997 a month, through Stripe checkout, month to month.
4. **After payment:** a welcome email with the onboarding link (`/start/:id`, no call), the timeline, the 60-day promise and the refund promise. You get an email too.
5. **Renewal reminder:** Stripe sends `invoice.upcoming` before each renewal and we email the client the date, the amount and how to cancel.
6. **Delivery (automatic, on the 10-minute timer):** after onboarding we track the client's own questions plus AI-written ones (Starter 10, Growth 25, Pro 50), run a starting report within a few hours, then a fresh report every 30 days compared with last month. Each report email includes a fix list from a real check of their website (AI crawlers allowed in robots.txt, structured data, llms.txt, pricing and comparison pages, FAQ markup) and the sites AI cited that they're missing from. For Growth and Pro, you also get it as your to-do list. `DELIVERY_BUDGET` (default 12) caps AI calls per timer run.
7. **60-day promise:** at day 60, if no answer names them that didn't at the start, a one-time 100% Stripe discount is added to their subscription and both of you get an email.
8. **Cancel:** set `STRIPE_PORTAL_LINK` for one-click cancel; without it the email says "reply and we'll cancel it the same day".

**Your tools:** `https://api.vantryai.com/admin/audits?token=YOUR_ADMIN_TOKEN` runs a report by hand and lists reports and clients.

**Outreach reports in bulk:** `POST /api/audit/batch` with `Authorization: Bearer YOUR_ADMIN_TOKEN` and `{"companies":[{"name","website","category","audience"}],"questionCount":3,"engines":["openai","perplexity"]}`. Each row returns the report link, the score, the first question, which AI answered it and who it named instead: everything an outreach email needs. Batches are sized to Cloudflare's per-request limit.

**Setup for AI visibility:**
- Add at least one engine key with `npx wrangler secret put`: `OPENAI_API_KEY` (ChatGPT), and optionally `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`. `ANTHROPIC_API_KEY` (already set) adds Claude and writes the questions.
- In the Stripe webhook, also add the events `invoice.upcoming`. In Stripe > Settings > Billing > Subscriptions and emails, set upcoming renewal events to **3 days** before.
- Turn on the Stripe customer portal and paste its login link into `STRIPE_PORTAL_LINK` in `wrangler.toml`.
- `AUDIT_DAILY_CAP` (default 20) limits free reports per day so AI costs can't run away.
- Refunds for the first-month promise: Stripe > Payments > the payment > Refund.

## Deploys

Cloudflare builds and deploys automatically on every push to the `engine` branch.

## Test

`npm test` runs every end-to-end check with fake AI, Stripe, Cloudflare and email (`test/run.mjs` for websites and Plus, `test/ai.mjs` for AI visibility).

## Files

- `src/worker.js`: routes every request
- `src/fulfill.js`: what happens after payment, step by step
- `src/render.js`: builds the websites (3 styles, 6 color schemes)
- `src/prompt.js`: what the AI is told (never invent licenses, reviews or prices)
- `src/lib/`: Stripe, Cloudflare, email, domains, storage
- `src/pages/`: domain picker, thank-you page, dashboard
- `showcase/`: builds the example sites on the homepage

## Not built yet

- **Customer self-editing ("Editor login")**: for now, customers reply to their emails and you make the change.
- **Site Care billing ($29/month)**: sell it with a Stripe Payment Link for now.
- **Domain renewals** happen automatically in Cloudflare (auto-renew is on) and are paid by your card. Each $50/year renewal covers that.
