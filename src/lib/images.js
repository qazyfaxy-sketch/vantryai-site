// AI photos from OpenAI's image API (turns on when the OPENAI_API_KEY secret is set).
//   1. Category photos: 2 per business category (top + about), used until the owner uploads their own.
//      Stored as stock:<category>:<n>, served at /stock/<category>-<n>.jpg.
//   2. A unique top photo for each paying customer, made right after checkout.
// Images take 20-60 seconds each, so they're made by the 10-minute job, a few at a time.
import { getSite, putSite, getJson, putJson } from "./store.js";
import { randomId, rateLimit } from "./util.js";
import { PLAYBOOKS, categoryOf } from "../prompt.js";

export const CATEGORIES = [...Object.keys(PLAYBOOKS), "general"];
const PER_RUN = 3; // images per 10-minute run
const DEFAULT_DAILY_CAP = 60; // hard ceiling on image spend per day

// Art direction per category, matching the feel of the site designs.
const SCENES = {
  landscaping: ["a beautifully landscaped modern home at golden hour, lush garden beds, stone steps and warm lit windows", "a landscaper's hands planting flowers in rich soil, soft morning light"],
  homeServices: ["a bright, freshly renovated modern kitchen with warm wood and natural light", "a tradesperson's tidy toolbox and work gloves on a clean workbench, soft light"],
  cleaning: ["a calm, spotless sunlit living room with plants and a cream sofa", "fresh folded white towels and natural cleaning supplies on a bright counter"],
  beauty: ["a serene close-up beauty portrait with glowing skin and soft warm light", "a stylish modern salon interior with warm wood, mirrors and plants"],
  food: ["a beautifully plated pasta dish on a dark table with a glass of red wine, moody warm light", "a cozy restaurant dining room with warm lights at dusk"],
  health: ["a calm woman enjoying sunlight among green leaves, peaceful wellness mood", "a bright, welcoming modern treatment room with natural wood and plants"],
  fitness: ["an athlete mid-workout in a dark modern gym with dramatic rim light", "a group fitness class in an industrial gym, energetic motion blur"],
  professional: ["a modern office lobby with tall concrete columns and soft daylight", "a tidy desk with a notebook, laptop and coffee in a calm bright office"],
  creative: ["a moody portrait of a creative professional with bold blue studio light", "a photographer's studio with lights and a backdrop, editorial feel"],
  retail: ["elegant skincare bottles and jars with soft flowers on a warm peach background", "a charming boutique shop interior with curated shelves and warm light"],
  education: ["a smiling student learning at a bright modern table with books", "a cheerful classroom with sunlight and colorful learning materials"],
  pets: ["a happy golden retriever portrait with warm autumn tones", "a groomed small dog relaxing on a soft blanket in a bright room"],
  realEstate: ["a modern cliffside home overlooking the ocean at sunset", "a bright, beautifully staged living room with large windows"],
  events: ["an elegant wedding reception table with candles, flowers and soft champagne tones", "a romantic outdoor event venue with string lights at dusk"],
  auto: ["a sleek dark sports car in a moody studio with dramatic reflections", "a clean modern auto repair garage with a car on a lift, cinematic light"],
  travel: ["an aerial view of a turquoise beach and a resort pool with palm trees", "a cozy boutique hotel room with a view, morning light"],
  tech: ["an abstract glowing blue and violet 3D ribbon shape on a dark navy background", "a modern workspace with screens glowing softly in a dark office"],
  industrial: ["a precision metal part being machined with sparks, dramatic dark lighting", "a clean modern workshop floor with machinery and warm work lights"],
  agriculture: ["a lush green farm field at golden hour with a rustic barn", "fresh vegetables in a wooden crate at a farm stand, warm sunlight"],
  family: ["a warm hug between a mother and young child in soft window light", "a caregiver and senior laughing together in a bright cozy home"],
  nonprofit: ["volunteers smiling while planting a community garden on a sunny day", "people of different ages working together at a neighborhood event"],
  entertainment: ["a singer performing on a dark stage with dramatic red light", "a crowd at a small live music venue with warm stage lights"],
  personal: ["a stylish woman in warm neutral tones in a sunlit room, editorial portrait", "a calm, organized closet with neutral clothing and soft light"],
  repair: ["skilled hands repairing a vintage watch with fine tools, warm workshop light", "a tidy repair workbench with tools and parts, cinematic light"],
  science: ["a macro shot of water droplets on a green leaf, fresh and clean", "a bright modern laboratory with glassware and soft daylight"],
  general: ["a bright modern storefront on a friendly main street, morning light", "a welcoming small business interior with warm light and plants"],
};

const STYLE = "Professional editorial photograph for a business website hero banner. Natural light, rich but realistic colors, shallow depth of field, high detail. Calm empty space on the left side for a headline. No text, no letters, no logos, no watermarks, no signage.";

export const imagesOn = (env) => !!env.OPENAI_API_KEY;

export async function generateImage(env, prompt) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.IMAGE_MODEL || "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: env.IMAGE_QUALITY || "medium",
      output_format: "jpeg",
      output_compression: 82,
      n: 1,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Image API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  const b64 = d.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image API returned no image");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Which categories have photos ready (cached for a few minutes per Worker).
let cache = { at: 0, set: new Set() };
export async function stockReady(env) {
  if (Date.now() - cache.at < 300000) return cache.set;
  const list = (await getJson(env, "stock:index")) || [];
  cache = { at: Date.now(), set: new Set(list) };
  return cache.set;
}

export async function serveStock(env, cat, n) {
  const { value } = await env.PREVIEWS.getWithMetadata(`stock:${cat}:${n}`, "arrayBuffer");
  if (!value) return null;
  return new Response(value, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800", "Access-Control-Allow-Origin": "*" } });
}

// Called after checkout: queue a custom top photo for this customer's site.
export const queueSitePhoto = (env, siteId) => env.PREVIEWS.put(`photojob:${siteId}`, "1");

function sitePrompt(site) {
  const cat = categoryOf(site.input?.trade);
  const what = String(site.input?.trade || "small local business").slice(0, 120);
  const services = (site.copy?.services || []).slice(0, 3).map((s) => s.name).join(", ");
  const city = String(site.input?.city || "").split(",")[0];
  return `${STYLE}\nSubject: a scene that represents a ${what}${services ? ` offering ${services}` : ""}${city ? `, with the feel of ${city}` : ""}. Mood reference: ${SCENES[cat]?.[0] || SCENES.general[0]}.`;
}

// Runs every 10 minutes: customer photos first, then missing category photos.
export async function runImageJobs(env) {
  if (!imagesOn(env)) return 0;
  let made = 0;
  const cap = parseInt(env.IMAGE_DAILY_CAP || DEFAULT_DAILY_CAP, 10);
  const allowed = () => rateLimit(env, "images-day", "all", cap, 86400);

  const jobs = await env.PREVIEWS.list({ prefix: "photojob:" });
  for (const k of jobs.keys) {
    if (made >= PER_RUN) return made;
    const siteId = k.name.slice("photojob:".length);
    const site = await getSite(env, siteId);
    if (!site) { await env.PREVIEWS.delete(k.name); continue; }
    if (!(await allowed())) return made;
    try {
      const bytes = await generateImage(env, sitePrompt(site));
      const id = randomId(16);
      await env.PREVIEWS.put(`img:${siteId}:${id}`, bytes, { metadata: { type: "image/jpeg", ai: true } });
      const fresh = (await getSite(env, siteId)) || site;
      fresh.uploads = [...(fresh.uploads || []), id];
      if (!fresh.heroPhoto) {
        fresh.photos = [id, ...(fresh.photos || [])].slice(0, 12);
        fresh.heroPhoto = id;
      }
      fresh.aiPhoto = id;
      await putSite(env, fresh);
      await env.PREVIEWS.delete(k.name);
      made++;
    } catch (e) {
      console.log("Site photo failed", siteId, e.message);
      return made;
    }
  }

  const ready = new Set((await getJson(env, "stock:index")) || []);
  for (const cat of CATEGORIES) {
    for (const n of [1, 2]) {
      if (made >= PER_RUN) return made;
      if (await env.PREVIEWS.get(`stock:${cat}:${n}`, "arrayBuffer").then((v) => !!v)) continue;
      if (!(await allowed())) return made;
      try {
        const bytes = await generateImage(env, `${STYLE}\nScene: ${SCENES[cat][n - 1]}.`);
        await env.PREVIEWS.put(`stock:${cat}:${n}`, bytes, { metadata: { type: "image/jpeg" } });
        made++;
      } catch (e) {
        console.log("Stock photo failed", cat, n, e.message);
        return made;
      }
    }
    if (!ready.has(cat)) {
      ready.add(cat);
      await putJson(env, "stock:index", [...ready]);
      cache.at = 0;
    }
  }
  return made;
}
