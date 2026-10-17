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

9. **YouTube videos (Growth: 2 a month, Pro: 4).** Code: `src/lib/video.js` (planning, scripts, review) and `video/render.py` (making the video, run by GitHub Actions for free). The cron picks a buyer question AI isn't naming the client for, reads their website, writes a script from it, then a second AI pass removes anything their website doesn't back up. GitHub renders it like an edited YouTube video: their real pages in a browser window, with the camera gliding and zooming into the part being talked about and a highlight box around it, animated title cards, chapter labels, smooth transitions between shots, word-by-word captions, an ElevenLabs voice, chapters and a thumbnail. Optional background music: put royalty-free .mp3 files (e.g. from YouTube's free Audio Library) in `video/music/` and it's mixed in quietly, dipping under the voice. Then it uploads to YouTube as **private**, marked as a paid promotion, with "This video is sponsored by..." spoken first and written first in the description. You get an email: **Approve** (it goes public and the client gets the link), **Redo** (with a note) or **Skip**. The admin page has **Make a video now**.

10. **Website pages and fixes (Growth: 3 pages a month, Pro: 6).** Code: `src/lib/sitefix.js`, `src/pages/hub.js`, `wordpress/vantry-connect/`. The AI writes pages that answer buyer questions AI isn't naming the client for, and every third page is a fair comparison with a competitor whose website they listed. It also adds the homepage structured data (schema), `/llms.txt` and AI-crawler access. Facts come only from the websites, a second pass removes anything unsupported, and a final filter drops any sentence that still says "best" or "guaranteed". You approve each page by email (`SITE_AUTO_PUBLISH="true"` skips that). It publishes in one of three ways:
    - **WordPress:** the client installs the Vantry Connect plugin (vantryai.com/downloads/vantry-connect.zip) and pastes a code. Pages publish themselves; removed pages go to their Trash. This is tested against a real WordPress 6.6 (`wordpress/e2e/`).
    - **Any other platform:** the client adds one DNS record for a subdomain like `answers.theirsite.com`. We host their pages there with schema, llms.txt and a sitemap, using the same Cloudflare for SaaS setup as customer domains (step 4 of the setup).
    - **Not connected:** everything is ready to copy from their page, `/site/:clientId`.
    After onboarding, Growth and Pro clients get an email with the connect link.

**Your tools:** `https://api.vantryai.com/admin/audits?token=YOUR_ADMIN_TOKEN` runs a report by hand and lists reports and clients.

**Outreach reports in bulk:** `POST /api/audit/batch` with `Authorization: Bearer YOUR_ADMIN_TOKEN` and `{"companies":[{"name","website","category","audience"}],"questionCount":3,"engines":["openai","perplexity"]}`. Each row returns the report link, the score, the first question, which AI answered it and who it named instead: everything an outreach email needs. Batches are sized to Cloudflare's per-request limit.

**Setup for AI visibility:**
- Add at least one engine key with `npx wrangler secret put`: `OPENAI_API_KEY` (ChatGPT), and optionally `PERPLEXITY_API_KEY`, `GEMINI_API_KEY`. `ANTHROPIC_API_KEY` (already set) adds Claude and writes the questions.
- In the Stripe webhook, also add the events `invoice.upcoming`. In Stripe > Settings > Billing > Subscriptions and emails, set upcoming renewal events to **3 days** before.
- Turn on the Stripe customer portal and paste its login link into `STRIPE_PORTAL_LINK` in `wrangler.toml`.
- `AUDIT_DAILY_CAP` (default 20) limits free reports per day so AI costs can't run away.
- Refunds for the first-month promise: Stripe > Payments > the payment > Refund.

## Listings (no setup needed)

For Growth (4 sites a month) and Pro (8) clients. AI repeats what a few directories and review sites say, and every report already records which sites AI cited. The engine turns that list into a to-do:

1. Takes the cited sites from the client's latest report, drops their own site, their competitors and social sites.
2. AI labels each one (directory, review site, marketplace, article...) and whether a company like theirs can list there.
3. Loads each candidate's homepage and looks for a real "add your product / claim your profile" link. Blocked sites stay on the list as "find it yourself". No link is ever invented.
4. Writes one profile kit from their website only, fact-checks it, strips "best" and guarantees.
5. Emails you a review page (approve, redo, skip), then emails the client their page at `/listings/<clientId>`.
6. The client submits (CAPTCHAs and work-email checks need a person), pastes their profile link, and we load it to confirm their name is on it.

Never: makes accounts, solves CAPTCHAs, writes or requests reviews, or promises placement. Runs on the 10-minute timer in small steps (Cloudflare caps outside calls per run). Reminders go to the client after 7 days, to you after 21.

Settings in `wrangler.toml`: `LISTINGS_AUTO_PUBLISH` ("true" skips your review), `LISTINGS_BUDGET`, and `LISTINGS_OFF="true"` to stop it. Test: `node test/listings.mjs`.

## Article outreach (sending stays off until you set it up)

For Growth (up to 3 notes a month) and Pro (up to 6) clients. AI often repeats a "best X" article, so this finds those articles and writes one short, honest note to the writer.

1. Takes the articles from the sites AI cited (the listings engine labels them, so it needs a listings search first).
2. Loads the article and looks for the writer's name and an email the site itself shows (a mailto link on the article, author page or contact page, on the same site). **It never guesses an email.** No email found means "manual": you get the contact page link and send it by hand.
3. Writes the note from the client's website only, fact-checks it, strips overclaims, and throws it away if it mentions money, payment, commission or free items.
4. Emails you a review page (approve, redo with a note, skip). **Nothing is ever sent without your approval.**
5. Sends only if all three are set: `OUTREACH_FROM` on a separate domain (never vantryai.com, the engine refuses), `MAILING_ADDRESS`, and the email key. Every email has your mailing address, a one-click opt-out link and unsubscribe headers. Opted-out addresses are never emailed again. Up to `OUTREACH_DAILY` emails a day (default 5, raise slowly while the new domain warms up).
6. One follow-up a week later, also approved by you. "Got a reply" stops it.

If sending isn't set up, an approved note is shown for you to copy and send yourself. Replies go to `OUTREACH_REPLY_TO` or your owner email. Settings in `wrangler.toml`; `OUTREACH_OFF="true"` stops it. Test: `node test/outreach.mjs`.

## Reddit helper (no setup needed)

For Growth (up to 2 answers a month) and Pro (up to 4) clients. Reddit is the most-cited source across AI engines in the studies we found, but it bans fake accounts and hidden promotion, so this only drafts honest answers that the client posts themselves.

1. Takes the Reddit threads AI cited in the client's latest report (the report already stores the links). You can also paste a thread link on your admin page. No Reddit key is needed.
2. Loads the thread and the subreddit rules (best effort). Locked, archived and adults-only threads and subreddits that ban promotion are skipped. If Reddit blocks the check, the draft is flagged "check before posting".
3. AI first judges whether the client honestly answers the question, then writes 60 to 140 words from their website only. The first sentence is always a disclosure ("I work with ..."). A second pass fact-checks it. Answers with links, "best", "DM me", money or upvote requests are thrown away.
4. You approve, redo with a note, or skip. Then the client is emailed the thread and the text and posts it from their own account, then pastes the link to their comment.

It never posts, never uses accounts, never asks for upvotes, and drafts at most one answer per subreddit every 30 days. Settings: `REDDIT_BUDGET`, `REDDIT_OFF="true"`. Test: `node test/reddit.mjs`.

## Client dashboard (no setup needed)

Every report email now links the client's private dashboard at `/d/<clientId>?k=...` (a signed link, no password to forget). It shows the score by report, a question-by-question "then and now" from the saved answers (newly named, no longer named, never estimated), and what we did: live pages, live videos, listings, Reddit answers posted and notes sent. It says plainly that AI answers vary and nothing is promised. You can open any client's dashboard from the admin page. Test: `node test/dashboard.mjs`.

## Review requests (no setup needed)

For Growth and Pro clients. Honest reviews from real customers make a profile worth trusting, but reviews can't be faked, bought, gated or written for people. So the engine only gives the client a kit, and the **client sends the requests from their own email**:

- Once a review-site or directory profile from the listings engine is live, the client gets one email with a link to `/reviews/<clientId>`.
- The page shows where customers can review them (their live profiles, plus a review link they add, such as a Google review link), the four safety rules, and three fixed wordings (never AI-written) that ask for an honest review, "good or bad", the same way for every customer.
- They paste the customers they want to ask. The page builds one ready-to-send `mailto:` email per person **in the browser**. We never see or store customer names or emails.

Never: writes or posts reviews, sends to customers for the client, offers incentives, or asks only happy customers. `REVIEWS_OFF="true"` stops the kit emails. Test: `node test/reviews.mjs`.

## Prospects (the customer machine)

Paste companies at `/admin/prospects?token=...` (`Company, website, email, first name, what they sell`; the last two are optional). The timer checks 2 at a time (cap `PROSPECT_AUDITS_PER_DAY`, default 20): drops bad emails (role addresses, no mail server), runs a free AI visibility check, skips companies already named in every answer, and builds one plain email from the real result with fixed wording (no AI free text). Nothing sends until you press **Send**; `PROSPECT_AUTO_SEND="true"` turns on timer sending (off by default). Needs `OUTREACH_FROM` on a separate domain, `RESEND_API_KEY`, `MAILING_ADDRESS`. New domains warm up (5/day, then 10, 20, 40, then `PROSPECT_DAILY`, default 50). One follow-up after 5 days to non-repliers (press the button). Opt-outs and bounces are permanent. Set `RESEND_WEBHOOK_SECRET` and point a Resend webhook (email.bounced, email.complained) at `/api/email/events`; sending pauses by itself above 2% bounces or 0.3% spam complaints and emails you. `PROSPECTS_OFF="true"` stops it.

## Shorts (vertical videos)

Next to the long videos, each Growth client gets 4 Shorts a month (Pro 8), made by the same timer, reviewed and approved the same way. A Short is 25 to 40 seconds, 1080x1920: the buyer's question as the hook in the first 2 seconds, one idea per sentence, a new camera framing every ~2.4 seconds, big word-by-word captions, the client's real page on screen, "Paid promotion" on screen the whole time, a spoken "Sponsored by" at the end, and a last frame that returns to the hook so it loops. The script has the same fact-check pass and overclaim filter as the long videos. `SHORTS_OFF="true"` stops them. "Make a Short now" is on the admin page.

Local check of the renderer (silent, no keys): serve any page (`python3 -m http.server 8765` in a folder with an index.html), write a job file with `"script": {"format": "short", "segments": [...]}` and run `python video/render.py --job job.json --out out --dry`.

## Setup check

`/admin/check?token=...` (also linked from your admin page) lists every setting that's in or missing, in plain words, never showing a secret. "Test my keys" makes one tiny real call to Anthropic, OpenAI, Gemini, Resend, Stripe, GitHub and YouTube, shows whether Stripe is in test or live mode, checks the 10-minute timer is running, and looks up (never changes) the MX, SPF and DMARC records on your outreach domain. "Email myself a test" sends one email from your outreach address to your own inbox to prove sending works.

## Finding contacts and sorting replies

On `/admin/prospects`, "Find contacts for me" takes company websites and reads only each company's own public pages (homepage, contact page, about page; skips sites whose robots.txt says no) for an email on the company's own domain. It never guesses an address; generic ones like info@ are used only if nothing better is published. Replies: add an inbound route in Resend (event `email.received`, same webhook URL) or paste a reply into the page. Replies are sorted (interested, question, no, opt-out, automatic); opt-outs and "no thanks" go on the never-email list, follow-ups stop, and you're emailed about the interested ones. Nothing is ever answered for you.

## LinkedIn posts

Growth clients get up to 2 posts a month (Pro 4), at least a week apart. For each, the timer picks a buyer question AI isn't naming them for (then the questions they told us), writes a 90-170 word post from their own website only, fact-checks it (no links, no "best", no engagement requests, at most 2 hashtags), and emails you a review link (`/ik/...`). On approval the client gets `/linkedin/:clientId` with the text, posts it from their own profile or company page, and pastes the post link (only real linkedin.com/posts, /feed/update or /pulse links are accepted). We never post, never use accounts, never ask for likes or engagement groups. `LINKEDIN_OFF="true"` stops it; `LINKEDIN_BUDGET` is clients per timer run (default 1).

## Videos: one-time setup (about 30 minutes)

1. **A YouTube channel for Vantry.** In YouTube, create a channel for your first category, e.g. "Dental Software Guide". Verify it with your phone (youtube.com/verify) so custom thumbnails work.
2. **Google Cloud** (console.cloud.google.com, free): create a project, then turn on **YouTube Data API v3**.
   - Under **Google Auth Platform**, set it up as External, then set the publishing status to **In production**. In "Testing" mode, Google signs you out every 7 days.
   - Create an **OAuth client**, type **Web application**, with the redirect URL `https://api.vantryai.com/youtube/callback`.
   - Run `npx wrangler secret put YT_CLIENT_ID`, then `npx wrangler secret put YT_CLIENT_SECRET`, pasting each value when it asks.
3. **Apply for YouTube's API audit right away** (free, a few weeks): the "YouTube API Services - Audit and Quota Extension Form". Until YouTube approves it, videos uploaded through the API stay locked as private. Meanwhile, each review email links the finished file, and you upload it in YouTube Studio (about 2 minutes) and paste the link back.
4. **A shared password for the renderer.** Make up a long random one. Save it with `npx wrangler secret put VIDEO_SECRET`, and also in GitHub: the repo's Settings, then Secrets and variables, then Actions, then **New secret**, named `VIDEO_SECRET`.
5. **ElevenLabs.** In the same GitHub page, add a secret named `ELEVENLABS_API_KEY`.
6. **Let the engine start GitHub.** In GitHub, go to Settings (your account), then Developer settings, then Fine-grained tokens. Make a token for only this repo with **Contents: Read and write**. Save it with `npx wrangler secret put GH_DISPATCH_TOKEN`.
7. **Connect the channel.** Open `https://api.vantryai.com/admin/audits?token=YOUR_ADMIN_TOKEN`, then press **Connect YouTube** in the Videos card and sign in with the channel's Google account.

Limits to know:
- YouTube's free API allowance is about 4 to 5 uploads a day. Ask for more on the same audit form.
- GitHub Actions is free for this public repo, so the render logs and files are visible to logged-in GitHub users. They hold the same public website content the video shows.

## Deploys

Cloudflare builds and deploys automatically on every push to the `engine` branch.

## Test

`npm test` runs every end-to-end check with fake AI, Stripe, Cloudflare, Google and email (`test/run.mjs` for websites and Plus, `test/ai.mjs` for AI visibility, `test/video.mjs` for videos). `python video/render.py --job sample.json --out out --dry` makes a silent test video on your computer.

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
