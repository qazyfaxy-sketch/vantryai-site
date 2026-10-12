// The "specialized" AI: a playbook per type of business, a worked example of great copy,
// strict rules, and a quality check (qualityIssues) that sends bad drafts back for a fix.
// To add a business type: add an entry to PLAYBOOKS with a `match` pattern.

export const PLAYBOOKS = {
  landscaping: {
    match: /landscap|lawn|yard|mow|tree|snow|garden|hardscap|patio|irrigation|sprinkler|mulch|sod|fenc|outdoor|nursery/i,
    label: "Landscaping and lawn care",
    services: ["Lawn mowing and maintenance", "Spring and fall cleanup", "Mulching and bed edging", "Shrub and hedge trimming", "Leaf removal", "Landscape design and planting", "Hardscaping (patios, walkways, retaining walls)", "Snow removal"],
    questions: ["Do you offer free estimates?", "What areas do you serve?", "Do you offer weekly or seasonal plans?", "How soon can you start?"],
    tone: "friendly, dependable, local, hardworking",
    cta: ["Get a free quote", "Get my free estimate"],
    angle: "a yard they're proud of, without spending their weekends on it",
  },
  homeServices: {
    match: /plumb|electric|hvac|heat|cool|air cond|roof|paint|handyman|contractor|remodel|construct|carpent|floor|drywall|gutter|window|garage door|pest|exterminat|locksmith|appliance|solar|concrete|masonry|pressure wash|power wash|junk|moving|mover/i,
    label: "Home services and trades",
    services: [],
    questions: ["Do you offer free estimates?", "What areas do you serve?", "How soon can you come out?", "Do you handle emergencies?"],
    tone: "trustworthy, straightforward, prompt, local",
    cta: ["Get a free quote", "Request service"],
    angle: "the job done right the first time, by someone who shows up when they say",
  },
  cleaning: {
    match: /clean|maid|janitor|carpet|detail(ing)?|laundry|dry clean/i,
    label: "Cleaning",
    services: [],
    questions: ["What's included in a cleaning?", "Do I need to be home?", "Do you bring your own supplies?", "What areas do you serve?"],
    tone: "warm, reliable, detail-minded",
    cta: ["Get a free quote", "Book a cleaning"],
    angle: "coming home to a clean space without lifting a finger",
  },
  beauty: {
    match: /barber|salon|hair|nail|lash|brow|spa|beauty|makeup|wax|tattoo|pierc|esthetic|skin/i,
    label: "Beauty, hair and barbers",
    services: [],
    questions: ["Do you take walk-ins?", "How do I book?", "How long does an appointment take?", "Where are you located?"],
    tone: "stylish, welcoming, confident, personal",
    cta: ["Book now", "Book an appointment"],
    angle: "leaving looking and feeling their best",
  },
  food: {
    match: /restaurant|cafe|café|coffee|bakery|bake|food|truck|catering|cater|pizza|grill|bbq|barbecue|deli|bar\b|brew|kitchen|diner|taco|sushi|dessert|ice cream|juice/i,
    label: "Food and drink",
    services: [],
    questions: ["What are your hours?", "Do you take orders for pickup?", "Do you cater events?", "Where are you located?"],
    tone: "warm, inviting, flavorful, neighborly",
    cta: ["See the menu", "Order now", "Call to order"],
    angle: "a great meal and a place they want to come back to",
  },
  health: {
    match: /dent|chiro|therap|physio|massage|clinic|doctor|medical|wellness|acupunct|counsel|optom|vet|pharm|nutrition|dietit|mental/i,
    label: "Health and wellness",
    services: [],
    questions: ["How do I book an appointment?", "Are you taking new clients?", "Where are you located?", "What should I bring to my first visit?"],
    tone: "calm, caring, professional, reassuring",
    cta: ["Book an appointment", "Request a visit"],
    angle: "feeling better, with care they can trust",
  },
  fitness: {
    match: /gym|fitness|personal train|trainer|yoga|pilates|crossfit|martial|karate|boxing|dance|swim|coach/i,
    label: "Fitness and classes",
    services: [],
    questions: ["Do you offer a free trial or first class?", "Is this good for beginners?", "What's the schedule?", "Where are you located?"],
    tone: "encouraging, energetic, welcoming to beginners",
    cta: ["Book a class", "Try a free class", "Get started"],
    angle: "getting stronger with people who make it fun to show up",
  },
  auto: {
    match: /auto|car\b|cars|mechanic|tire|tow|body shop|collision|oil change|transmission|brake|truck repair|motorcycle/i,
    label: "Auto services",
    services: [],
    questions: ["Do I need an appointment?", "How long will it take?", "Do you give estimates first?", "Where are you located?"],
    tone: "honest, no-nonsense, dependable",
    cta: ["Get a quote", "Book service"],
    angle: "honest work and getting back on the road fast",
  },
  pets: {
    match: /pet|dog|cat\b|groom|kennel|boarding|walker|sitting|sitter/i,
    label: "Pet care",
    services: [],
    questions: ["What do you need before the first visit?", "How do I book?", "What areas do you serve?", "Can I see where my pet will stay?"],
    tone: "caring, playful, trustworthy",
    cta: ["Book now", "Request a spot"],
    angle: "a happy pet and total peace of mind",
  },
  professional: {
    match: /account|tax|bookkeep|law|legal|attorney|insurance|real estate|realtor|mortgage|financ|consult|marketing|agency|design|architect|notary|tutor|education|it support|computer repair|photograph|video|event|wedding|dj|print/i,
    label: "Professional and creative services",
    services: [],
    questions: ["How does it work?", "How do we get started?", "What do you need from me?", "How soon can you help?"],
    tone: "clear, confident, approachable, expert without jargon",
    cta: ["Book a free call", "Get in touch", "Request a quote"],
    angle: "an expert who makes the hard part simple",
  },
  retail: {
    match: /shop|store|boutique|retail|florist|flower|gift|jewel|clothing|apparel|furniture|thrift|book|record|hardware|market/i,
    label: "Shops and retail",
    services: [],
    questions: ["What are your hours?", "Where are you located?", "Do you offer pickup or delivery?", "Can I call to check if something is in stock?"],
    tone: "friendly, local, inviting, a little personal",
    cta: ["Visit us", "Call the shop", "Get directions"],
    angle: "finding something they love, from people who care",
  },
};

const GENERAL = {
  label: "Local business",
  services: [],
  questions: ["How do I get a quote or book?", "What areas do you serve?", "How soon can you help?"],
  tone: "friendly, trustworthy, local, professional",
  cta: ["Get in touch", "Get a free quote"],
  angle: "the result they're looking for, from a local business that cares",
};

export function playbookFor(trade = "") {
  const t = String(trade).trim();
  if (!t) return PLAYBOOKS.landscaping; // older surveys didn't ask the type of business
  for (const p of Object.values(PLAYBOOKS)) if (p.match.test(t)) return p;
  return GENERAL;
}

// Outdoor/yard businesses get the landscape picture; everyone else gets soft shapes.
export const isOutdoorTrade = (trade = "") => PLAYBOOKS.landscaping.match.test(trade);

// Words that make a site sound generic or fake. The quality check rejects them.
export const BANNED = [
  "elevate", "unparalleled", "seamless", "top-notch", "top notch", "one-stop", "one stop shop", "look no further",
  "second to none", "world-class", "world class", "cutting-edge", "state-of-the-art", "unmatched", "unrivaled",
  "we pride ourselves", "passionate about", "your satisfaction is our", "best in town", "best in the business",
  "#1", "number one", "premier", "leading provider", "solutions", "synergy", "game-changer", "game changer",
  "in today's", "whether you're", "nestled", "boasts", "a testament", "delve", "embark", "unlock", "tailored to your unique",
];

const EXAMPLE = `Example of the quality we want (a barbershop; never copy its words or facts):
{
  "headline": "Sharp cuts without the long wait",
  "subheadline": "Fades, beard trims and hot-towel shaves on High Street. Walk in, or book a chair in a minute.",
  "ctaText": "Book a cut",
  "services": [
    {"name": "Fades and tapers", "description": "Skin, low, mid or high, blended clean and finished with a sharp line-up."},
    {"name": "Beard trims", "description": "Shaped, lined and trimmed to suit your face."},
    {"name": "Hot-towel shave", "description": "An old-school straight-razor shave with hot towels."}
  ],
  "about": "Fade Factory is a neighborhood barbershop on High Street in Columbus. We keep it simple: good cuts, fair prices and a chair that's ready when you are.",
  "serviceAreas": ["Columbus"],
  "faqs": [
    {"q": "Do you take walk-ins?", "a": "Yes, whenever a chair is open. Book ahead to skip the wait."},
    {"q": "How do I book?", "a": "Call or text us, or send a request with the form below."},
    {"q": "Where are you?", "a": "On High Street in Columbus. Call or text us for directions."}
  ],
  "seoTitle": "Fade Factory | Barbershop in Columbus, OH",
  "seoDescription": "Fades, beard trims and hot-towel shaves on High Street in Columbus. Walk in or book a chair."
}`;

export function buildSystemPrompt(trade = "") {
  const kind = String(trade).trim() || "local service";
  const p = playbookFor(trade);
  return `You are Vantry's website writer. You write the words for one-page websites for small businesses whose owners aren't tech people.
Every site must read like a skilled local copywriter wrote it for THIS business. Type of business: ${kind} (${p.label}).

THE GOAL
Get visitors to call, text, book or ask for a quote. The page should make the main promise clear in 3 seconds: ${p.angle}.

HOW GREAT COPY SOUNDS
- Tone: ${p.tone}. Plain English a busy customer understands at a glance.
- Short sentences. Concrete words (what they get, where, how to reach you), not adjectives.
- The headline is a benefit the customer wants, not the business name and not hype. 4 to 9 words. No exclamation marks.
- The subheadline says what you do, for whom, and where, in one or two short sentences (max 25 words).
- Service descriptions say what the customer actually gets, 8 to 20 words each. Every one different, no repeated openings.
- The about text sounds human and specific to the owner's details. 2 or 3 sentences.
- FAQ answers are honest and useful, using only the owner's facts. If you don't know a detail, say how to find out ("Call or text us and we'll tell you").
- Button text is 2 to 4 words, a clear action that fits this business, like: ${p.cta.join(", ")}.
- SEO title: "Business Name | What they do in City", max 60 characters. SEO description: max 155 characters.

NEVER (these get the site rejected)
- Never invent licenses, insurance, awards, years in business, reviews, ratings, guarantees, prices, staff numbers or statistics. Never write a number the owner didn't give.
- Never add services the owner didn't list. You may reword and split them.
- Never list service areas the owner didn't give.
- Never use these words or phrases: ${BANNED.join(", ")}.
- No emojis. No ALL CAPS. No exclamation marks in the headline.

REFERENCE (wording ideas only, never for adding services or facts)
${p.services.length ? `- Common services in this field: ${p.services.join("; ")}.\n` : ""}- Questions customers often ask: ${p.questions.join(" | ")}.

${EXAMPLE}

OUTPUT
Return ONLY a JSON object, no markdown, matching exactly:
{
  "headline": string,
  "subheadline": string,
  "ctaText": string,
  "services": [{"name": string, "description": string}],
  "about": string,
  "serviceAreas": [string],
  "faqs": [{"q": string, "a": string}] (exactly 3),
  "seoTitle": string,
  "seoDescription": string
}`;
}

export function buildUserPrompt(input) {
  return `Business info from the owner:
- Type of business: ${input.trade || "local service"}
- Business name: ${input.businessName}
- City / service area: ${input.city}${input.serviceAreas ? ", " + input.serviceAreas : ""}
- Services: ${input.services}
- Anything else they told us: ${input.notes || "(nothing)"}

Write the website copy now.`;
}

// Checks a draft against the rules. Returns a list of problems in plain words (empty = good).
export function qualityIssues(copy, input) {
  const issues = [];
  const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
  const all = [copy.headline, copy.subheadline, copy.ctaText, copy.about, ...(copy.services || []).flatMap((s) => [s.name, s.description]), ...(copy.faqs || []).flatMap((f) => [f.q, f.a])].join(" \n ");
  const lower = all.toLowerCase();

  const hw = words(copy.headline);
  if (hw < 3 || hw > 10) issues.push(`The headline has ${hw} words. Use 4 to 9.`);
  if (/!/.test(copy.headline || "")) issues.push("Remove the exclamation mark from the headline.");
  if (String(copy.headline || "").trim().toLowerCase() === String(input.businessName || "").trim().toLowerCase()) issues.push("The headline can't just be the business name. Make it a benefit.");
  if (words(copy.subheadline) > 32) issues.push("The subheadline is too long. Keep it under 25 words.");
  if (words(copy.ctaText) > 5) issues.push("The button text is too long. Use 2 to 4 words.");
  if ((copy.services || []).length < 1) issues.push("List the owner's services.");
  for (const s of copy.services || []) if (words(s.description) > 26) issues.push(`The description for "${s.name}" is too long.`);
  const openings = (copy.services || []).map((s) => String(s.description || "").split(/\s+/).slice(0, 2).join(" ").toLowerCase()).filter(Boolean);
  if (openings.length >= 3 && new Set(openings).size < openings.length - 1) issues.push("Service descriptions start the same way. Vary them.");

  const hits = BANNED.filter((b) => lower.includes(b));
  if (hits.length) issues.push(`Remove these generic phrases: ${hits.join(", ")}.`);
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all)) issues.push("Remove the emojis.");
  if (/\b[A-Z]{5,}\b/.test(all.replace(/\b(HVAC|LLC|USA|ASAP)\b/g, ""))) issues.push("Don't write words in ALL CAPS.");

  // Numbers the owner never gave (years, ratings, prices, counts) are made up.
  const given = `${input.businessName} ${input.city} ${input.serviceAreas} ${input.services} ${input.notes} ${input.phone}`;
  const givenNums = new Set(given.match(/\d+/g) || []);
  const invented = [...new Set((all.match(/\d+/g) || []).filter((n) => !givenNums.has(n)))];
  if (invented.length) issues.push(`These numbers weren't given by the owner, so remove them: ${invented.join(", ")}.`);
  const claims = [...new Set((all.match(/\b(licensed|insured|bonded|certified|award-winning|awards?|guarantee[ds]?|warranty|years of experience|five-star|5-star|top-rated)\b/gi) || []).map((x) => x.toLowerCase()))];
  const fake = claims.filter((c) => !new RegExp(c.slice(0, 6), "i").test(given));
  if (fake.length) issues.push(`Don't claim ${fake.map((c) => `"${c}"`).join(", ")}. The owner didn't mention it.`);
  return issues;
}
