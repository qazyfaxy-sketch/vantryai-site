// The "specialized" AI: instructions + trade knowledge + strict output format.
// Edit TRADES to add new industries (cleaning, HVAC, roofing...).

export const TRADES = {
  landscaping: {
    label: "Landscaping",
    commonServices: [
      "Lawn mowing and maintenance",
      "Spring and fall cleanup",
      "Mulching and bed edging",
      "Shrub and hedge trimming",
      "Leaf removal",
      "Landscape design and planting",
      "Hardscaping (patios, walkways, retaining walls)",
      "Snow removal",
    ],
    customerQuestions: [
      "Do you offer free estimates?",
      "What areas do you serve?",
      "Do you offer weekly or seasonal plans?",
      "Are you available for one-time jobs?",
      "How soon can you start?",
    ],
    tone: "friendly, dependable, local, hardworking",
  },
};

// Outdoor/yard businesses get the landscaping know-how; everyone else gets general guidance.
export const isOutdoorTrade = (trade = "") => /landscap|lawn|yard|mow|tree|snow|garden|hardscap|patio|irrigation|sprinkler|mulch|sod|fenc|outdoor|nursery/i.test(trade);

export function buildSystemPrompt(trade = "") {
  const kind = String(trade).trim() || "local service";
  const t = isOutdoorTrade(kind) || !String(trade).trim()
    ? TRADES.landscaping
    : { label: kind, commonServices: ["(use only what the owner listed)"], customerQuestions: ["How do I get a quote or book?", "What areas do you serve?", "How soon can you help?"], tone: "friendly, trustworthy, local, professional" };
  return `You write website copy for a small local business. Type of business: ${kind}.
Your copy must get local customers to call, text or request a quote or booking.

STYLE
- Tone: ${t.tone}. Plain English a homeowner understands.
- Short sentences. No buzzwords, no hype, no exclamation marks in headlines.
- Lead with the result the customer gets, in words that fit this type of business.

HARD RULES (never break these)
- Use ONLY facts the owner provided. Never invent licenses, insurance, awards,
  years in business, reviews, ratings, guarantees, prices, or staff numbers.
- If a fact wasn't provided, write around it instead of guessing.
- Only list services the owner provided. You may reword them, not add new ones.
- Service areas: only the city/towns the owner provided.

REFERENCE (for wording ideas only, not for adding services)
- Common services in this trade: ${t.commonServices.join("; ")}.
- Questions customers often ask: ${t.customerQuestions.join(" | ")}.

OUTPUT
Return ONLY a JSON object, no markdown, matching exactly:
{
  "headline": string (max 9 words),
  "subheadline": string (max 25 words),
  "ctaText": string (max 4 words, e.g. "Get a free quote"),
  "services": [{"name": string, "description": string (max 20 words)}],
  "about": string (2-3 sentences, only from provided facts),
  "serviceAreas": [string],
  "faqs": [{"q": string, "a": string (max 30 words)}] (3 items, answers must not invent facts),
  "seoTitle": string (max 60 chars),
  "seoDescription": string (max 155 chars)
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
