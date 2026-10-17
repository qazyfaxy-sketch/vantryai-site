import http from "node:http";
const R = "${process.env.ENGINE_SRC || new URL('../../src', import.meta.url).pathname}";
const worker = (await import(`${R}/worker.js`)).default;
const { saveClient, getClient } = await import(`${R}/ai.js`);
const { saveAudit } = await import(`${R}/lib/aiscan.js`);
const { execFileSync } = await import("node:child_process");
const realFetch = globalThis.fetch;
const emails = [];
const PAGE = { title: "Online booking for a small dental office: how Slotly works", slug: "dental-online-booking", metaDescription: "How Slotly handles online booking and reminders for small dental offices.", intro: "Slotly is online booking for small dental offices. Patients book, reschedule and get text reminders.", sections: [{ h2: "What to look for", paragraphs: ["Look for text reminders and a booking page you control."], bullets: ["Text reminders", "Calendar sync"] }, { h2: "How Slotly handles it", paragraphs: ["Reminders go out 2 days and 2 hours before each visit."], bullets: [] }], faq: [{ q: "Does Slotly send reminders?", a: "Yes, by text, 2 days and 2 hours before each visit." }] };
const FACTS = { description: "Online booking for small dental offices.", audience: "small dental offices", category: "dental scheduling software", isSoftware: true, features: ["Online booking", "Text reminders"], pricing: [{ plan: "Solo", price: "$59", period: "per month" }], trial: "14 days free", integrations: ["Google Calendar"], pages: {} };
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.host === "127.0.0.1:8088") { const t0 = Date.now(); const r = await realFetch(input, opts); console.log("   wp", opts.method || "GET", url.pathname, r.status, Date.now() - t0, "ms"); return r; }
  if (url.host === "slotly.example") return new Response('<html><body><h1>Slotly: online booking for small dental offices</h1><p>Patients book online and get text reminders 2 days and 2 hours before each visit. Solo plan $59 per month.</p></body></html>');
  if (url.host === "api.anthropic.com") {
    const b = JSON.parse(opts.body);
    const out = b.system.includes("extract facts") ? FACTS : PAGE;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(out) }] }));
  }
  if (url.host === "api.resend.com") { emails.push(JSON.parse(opts.body)); return new Response('{"id":"x"}'); }
  throw new Error("unexpected " + url);
};
const store = new Map();
const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k), list: async () => ({ keys: [], list_complete: true }) };
const env = { ANTHROPIC_API_KEY: "a", RESEND_API_KEY: "r", ADMIN_TOKEN: "admintoken", OWNER_EMAIL: "booking@vantryai.com", PUBLIC_API: "http://127.0.0.1:8787", API_HOST: "127.0.0.1", SITE_ORIGIN: "https://vantryai.com", DEV_ALLOW_HTTP: "true", PREVIEWS: kv };
const ctx = { waitUntil() {} };
const server = http.createServer(async (req, res) => {
  const t0 = Date.now(); res.on("finish", () => console.log("   api", req.method, req.url, res.statusCode, Date.now() - t0, "ms"));
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request(`http://127.0.0.1:8787${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), env, ctx);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787);
let ok = true; const check = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) ok = false; };

await saveAudit(env, { id: "aaudit000001", createdAt: Date.now(), company: { name: "Slotly", website: "slotly.example" }, origin: "client", questions: ["best online booking for a small dental office?"], engines: ["openai"], results: [{ q: "best online booking for a small dental office?", engine: "openai", mentioned: false, named: ["Weave"], sources: [] }], summary: { mentioned: 0, total: 1, competitors: [], sources: [] } });
await saveClient(env, { id: "cslotly00001", plan: "growth", status: "active", email: "o@slotly.example", onboardedAt: Date.now(), audits: [{ id: "aaudit000001", at: Date.now() }], questions: ["best online booking for a small dental office?"], onboarding: { business: "Slotly", website: "slotly.example", sell: "dental scheduling software", reportEmail: "o@slotly.example" } });

// 1. client opens their Vantry page and copies the code
const pg = await (await realFetch("http://127.0.0.1:8787/site/cslotly00001")).text();
const code = pg.match(/cslotly00001\.[a-z0-9]{32}/)[0];
check(!!code, "client page shows a connect code");
// 2. they paste it into WordPress (Settings > Vantry), as the admin
const php = `<?php $_SERVER['HTTP_HOST']='127.0.0.1:8088'; $_SERVER['REQUEST_URI']='/wp-admin/options-general.php?page=vantry-connect'; define('WP_ADMIN', true);
require '${process.cwd()}/wp/wp-load.php'; require_once ABSPATH.'wp-admin/includes/admin.php'; wp_set_current_user(1);
$_POST['vantry_code']='${code}'; $_POST['_wpnonce']=wp_create_nonce('vantry_connect'); $_REQUEST['_wpnonce']=$_POST['_wpnonce'];
ob_start(); vantry_settings_page(); $o=ob_get_clean(); preg_match('/notice-info"><p>(.*?)<\\/p>/s',$o,$m); echo $m[1] ?? 'no message';`;
const fs = await import("node:fs"); fs.writeFileSync("connect.php", php);
const { promisify } = await import("node:util"); const { execFile } = await import("node:child_process"); const out = (await promisify(execFile)("php", ["connect.php"])).stdout;
console.log("   WordPress said:", out.trim());
check(out.includes("Connected"), "WordPress connects with the code");
let c = await getClient(env, "cslotly00001");
check(c.site.method === "wordpress" && c.foundation?.schema, "engine marks WordPress connected and sets the foundation");
// 3. homepage schema, llms.txt, robots.txt
const home = await (await realFetch("http://127.0.0.1:8088/")).text();
check(home.includes('application/ld+json') && home.includes('"SoftwareApplication"') && home.includes('"price":"59"'), "homepage now has structured data (with the $59 price from their site)");
const llms = await (await realFetch("http://127.0.0.1:8088/llms.txt")).text();
check(llms.startsWith("# Slotly") && llms.includes("Text reminders"), "/llms.txt is served");
const robots = await (await realFetch("http://127.0.0.1:8088/robots.txt")).text();
check(robots.includes("User-agent: GPTBot\nAllow: /"), "robots.txt lets AI crawlers in");
// 4. a page gets written, approved, published
const { makePage, reviewUrl } = await import(`${R}/lib/sitefix.js`);
const p = await makePage(env, c, saveClient);
const rv = new URL(await reviewUrl(env, p.id));
const ap = await (await realFetch(`http://127.0.0.1:8787${rv.pathname}`, { method: "POST", body: new URLSearchParams({ k: rv.searchParams.get("k"), action: "approve" }) })).text();
check(ap.includes("Published"), "approving publishes the page"); if (!ap.includes("Published")) console.log("   page said:", (ap.match(/<p class="card"><strong>(.*?)<\/strong>/s)||[])[1]);
c = await getClient(env, "cslotly00001");
const row = c.pages[0];
console.log("   live at:", row.url);
const live = await realFetch(row.url);
const lh = await live.text();
check(live.status === 200 && lh.includes("How Slotly handles it") && lh.includes('"FAQPage"'), "the page is live on their WordPress with FAQ structured data");
check(lh.includes('name="description" content="How Slotly handles'), "the page has its meta description");
check(emails.some((e) => e.to[0] === "o@slotly.example" && e.subject.startsWith("New page live")), "client gets told the page is live");
const llms2 = await (await realFetch("http://127.0.0.1:8088/llms.txt")).text();
check(llms2.includes("dental-online-booking"), "llms.txt now lists the new page");
// 5. remove it
const rm = await (await realFetch(`http://127.0.0.1:8787${rv.pathname}`, { method: "POST", body: new URLSearchParams({ k: rv.searchParams.get("k"), action: "remove" }) })).text();
check(rm.includes("Removed"), "Remove takes it down");
check((await realFetch(row.url)).status === 404, "the page is gone from their site (in the Trash)");
server.close();
console.log(ok ? "\nALL E2E CHECKS PASSED" : "\nSOME FAILED");
process.exit(ok ? 0 : 1);
