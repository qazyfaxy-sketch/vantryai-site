// The "specialized" AI: a playbook per type of business, a worked example of great copy,
// strict rules, and a quality check (qualityIssues) that sends bad drafts back for a fix.
// To add a business type: add its survey name to a playbook's `niches`, or a new playbook.

// Playbooks: one per business category in the survey (plus landscaping for yard work).
// `niches` are the exact names people tap in the survey; `match` catches anything they type themselves.
export const PLAYBOOKS = {
  landscaping: {
    label: "Landscaping and lawn care",
    niches: ["Landscaping", "Lawn care", "Tree care", "Snow removal", "Irrigation", "Fencing", "Pool care"],
    match: /landscap|lawn|yard|mow|tree (care|service|removal|trim)|snow|hardscap|patio|irrigation|sprinkler|mulch|sod\b|fenc|pool/i,
    services: ["Lawn mowing and maintenance", "Spring and fall cleanup", "Mulching and bed edging", "Shrub and hedge trimming", "Leaf removal", "Landscape design and planting", "Hardscaping (patios, walkways, retaining walls)", "Snow removal"],
    questions: ["Do you offer free estimates?", "What areas do you serve?", "Do you offer weekly or seasonal plans?", "How soon can you start?"],
    tone: "friendly, dependable, local, hardworking",
    cta: ["Get a free quote", "Get my free estimate"],
    angle: "a yard they're proud of, without spending their weekends on it",
  },
  homeServices: {
    label: "Home and property services",
    niches: ["House cleaning", "Commercial cleaning", "HVAC", "Plumbing", "Electrical", "Roofing", "Painting", "General contracting", "Remodeling", "Handyman", "Pest control", "Pressure washing", "Junk removal", "Moving", "Home inspection", "Garage doors", "Flooring", "Windows & doors", "Solar installation", "Security installation", "Restoration", "Home & property services"],
    match: /plumb|electric|hvac|heat|furnace|air cond|roof|paint|handyman|contractor|remodel|construct|carpent|floor|drywall|siding|garage door|pest|exterminat|solar|concrete|masonry|pressure wash|power wash|junk|moving|mover|home inspect|restoration|water damage|security (system|install)|window|door install|kitchen|bath(room)? remodel|deck/i,
    questions: ["Do you offer free estimates?", "What areas do you serve?", "How soon can you come out?", "Do you handle emergencies?"],
    tone: "trustworthy, straightforward, prompt, local",
    cta: ["Get a free quote", "Request service"],
    angle: "the job done right the first time, by someone who shows up when they say",
  },
  cleaning: {
    label: "Cleaning and specialty care",
    niches: ["Carpet cleaning", "Window cleaning", "Upholstery cleaning", "Dry cleaning", "Laundry service", "Chimney sweeping", "Gutter cleaning", "Duct cleaning", "Sanitation", "Biohazard cleanup", "Cleaning & specialty care"],
    match: /clean|maid|janitor|carpet|upholster|laundry|chimney|gutter|duct|sanitiz|sanitation|biohazard|disinfect/i,
    questions: ["What's included?", "Do I need to be home?", "How long does it take?", "What areas do you serve?"],
    tone: "warm, reliable, detail-minded",
    cta: ["Get a free quote", "Book a cleaning"],
    angle: "a spotless result without lifting a finger",
  },
  beauty: {
    label: "Beauty and personal care",
    niches: ["Hair salon", "Barbershop", "Nail salon", "Lashes & brows", "Esthetician", "Skincare studio", "Makeup artist", "Waxing", "Tanning", "Tattoo studio", "Piercing studio", "Med spa", "Beauty supply", "Beauty & personal care"],
    match: /barber|salon|hair|nail|lash|brow|\bspa\b|med ?spa|beauty|makeup|wax|tann|tattoo|pierc|esthetic|skin ?care|facial|braid|loc(k)?s\b/i,
    questions: ["Do you take walk-ins?", "How do I book?", "How long does an appointment take?", "Where are you located?"],
    tone: "stylish, welcoming, confident, personal",
    cta: ["Book now", "Book an appointment"],
    angle: "leaving looking and feeling their best",
  },
  food: {
    label: "Food and drink",
    niches: ["Restaurant", "Cafe", "Coffee shop", "Bakery", "Catering", "Food truck", "Private chef", "Meal prep", "Bar", "Brewery", "Juice bar", "Dessert shop", "Specialty food", "Farm-to-table", "Food & drink"],
    match: /restaurant|cafe|café|coffee|bakery|bake|food|truck|cater|chef|meal prep|pizza|grill|bbq|barbecue|deli\b|\bbar\b|brew|winery|distill|kitchen|diner|taco|sushi|dessert|ice cream|juice|smoothie|donut|cake/i,
    questions: ["What are your hours?", "Do you take orders for pickup?", "Do you cater events?", "Where are you located?"],
    tone: "warm, inviting, flavorful, neighborly",
    cta: ["See the menu", "Order now", "Call to order"],
    angle: "a great meal and a place they want to come back to",
  },
  health: {
    label: "Health and wellness",
    niches: ["Dental practice", "Medical practice", "Therapy & counseling", "Physical therapy", "Chiropractic", "Massage therapy", "Nutrition & dietetics", "Acupuncture", "Occupational therapy", "Optometry", "Home health", "Wellness studio", "Pharmacy", "Speech therapy", "Health & wellness"],
    match: /dent|chiro|therap|physio|massage|clinic|doctor|medical|wellness|acupunct|counsel|optom|pharm|nutrition|dietit|mental health|home health|nurs(e|ing)/i,
    questions: ["How do I book an appointment?", "Are you taking new clients?", "Where are you located?", "What should I bring to my first visit?"],
    tone: "calm, caring, professional, reassuring",
    cta: ["Book an appointment", "Request a visit"],
    angle: "feeling better, with care they can trust",
  },
  fitness: {
    label: "Fitness and sports",
    niches: ["Personal trainer", "Gym", "Yoga studio", "Pilates studio", "Dance studio", "Martial arts", "Sports coach", "Running coach", "Swimming lessons", "Sports club", "Outdoor fitness", "Recreation center", "Fitness & sports"],
    match: /gym|fitness|personal train|trainer|yoga|pilates|crossfit|martial|karate|jiu|boxing|dance|swim|coach(ing)? (for )?(sport|run)|sports|recreation|bootcamp/i,
    questions: ["Do you offer a first class or trial?", "Is this good for beginners?", "What's the schedule?", "Where are you located?"],
    tone: "encouraging, energetic, welcoming to beginners",
    cta: ["Book a class", "Get started"],
    angle: "getting stronger with people who make it fun to show up",
  },
  professional: {
    label: "Professional services",
    niches: ["Accounting", "Bookkeeping", "Tax preparation", "Law firm", "Consulting", "Virtual assistant", "Business coaching", "Recruiting", "HR consulting", "Insurance agency", "Financial planning", "Notary", "Translation", "Research services", "Administrative services", "Professional services"],
    match: /account|tax|bookkeep|\blaw\b|legal|attorney|lawyer|insurance|financ|consult|virtual assist|recruit|staffing|\bhr\b|notary|translat|admin(istrative)? serv/i,
    questions: ["How does it work?", "How do we get started?", "What do you need from me?", "How soon can you help?"],
    tone: "clear, confident, approachable, expert without jargon",
    cta: ["Book a free call", "Get in touch"],
    angle: "an expert who makes the hard part simple",
  },
  creative: {
    label: "Creative and media",
    niches: ["Photographer", "Videographer", "Graphic designer", "Web designer", "Brand designer", "Copywriter", "Marketing agency", "Social media manager", "Illustrator", "Artist", "Music producer", "Recording studio", "Animator", "Interior designer", "Architecture", "Public relations", "Creative & media"],
    match: /photograph|video|film|graphic|design|brand|copywrit|marketing|social media|illustrat|artist|music produc|recording|animat|architect|public relations|\bpr\b|agency|studio/i,
    questions: ["How does working together look?", "Can I see more of your work?", "How far ahead should I book?", "How do we get started?"],
    tone: "confident, visual, original, a little personal",
    cta: ["See my work", "Start a project", "Get in touch"],
    angle: "work that makes them look as good as they really are",
  },
  retail: {
    label: "Shops and products",
    niches: ["Clothing boutique", "Jewelry", "Home goods", "Furniture", "Electronics", "Books", "Flowers", "Gift shop", "Crafts & handmade", "Skincare products", "Beauty products", "Food products", "Sporting goods", "Vintage & resale", "Digital products", "General store", "Retail & products"],
    match: /shop|store|boutique|retail|florist|flower|gift|jewel|clothing|apparel|furniture|thrift|vintage|resale|book(s|store)|record|hardware|market|handmade|craft|candle|products?\b/i,
    questions: ["What are your hours?", "Where are you located?", "Do you offer pickup or shipping?", "Can I call to check if something's in stock?"],
    tone: "friendly, inviting, a little personal",
    cta: ["Visit us", "Shop now", "Call the shop"],
    angle: "finding something they love, from people who care",
  },
  education: {
    label: "Education and training",
    niches: ["Tutor", "Language teacher", "Music lessons", "Art classes", "Driving school", "Test preparation", "Trade training", "Online courses", "School", "Learning center", "Career coaching", "Corporate training", "Coding classes", "Education & training"],
    match: /tutor|teach|lesson|class(es)?\b|school|course|test prep|sat\b|act\b|learning|training|career coach|academy|instruct/i,
    questions: ["Who is this for?", "How do lessons work?", "Where and when do you teach?", "How do I sign up?"],
    tone: "patient, encouraging, clear, trustworthy",
    cta: ["Book a lesson", "Sign up", "Get started"],
    angle: "real progress, with a teacher who makes it click",
  },
  pets: {
    label: "Pets and animals",
    niches: ["Pet grooming", "Dog walking", "Pet sitting", "Dog training", "Veterinary clinic", "Pet boarding", "Pet store", "Animal rescue", "Equestrian services", "Pet photography", "Pets & animals"],
    match: /\bpets?\b|dog|\bcats?\b|puppy|groom|kennel|boarding|walker|sitter|\bvet(erinar)?|animal|equestrian|horse/i,
    questions: ["What do you need before the first visit?", "How do I book?", "What areas do you serve?", "Can I see where my pet will stay?"],
    tone: "caring, playful, trustworthy",
    cta: ["Book now", "Request a spot"],
    angle: "a happy pet and total peace of mind",
  },
  realEstate: {
    label: "Real estate",
    niches: ["Real estate agent", "Brokerage", "Property management", "Vacation rentals", "Commercial real estate", "Home staging", "Real estate photography", "Appraisal", "Real estate investing", "Apartment community", "Real estate"],
    match: /real estate|realtor|realty|broker|property manag|rental|apartment|staging|apprais|landlord|homes for sale/i,
    questions: ["How do we get started?", "What areas do you cover?", "What does it cost to work with you?", "How quickly can you help?"],
    tone: "knowledgeable, local, reassuring, responsive",
    cta: ["Get in touch", "Book a free consult"],
    angle: "a smooth move, with someone who knows the local market",
  },
  events: {
    label: "Events and weddings",
    niches: ["Wedding planner", "Event planner", "Event venue", "DJ", "Live band", "Party rentals", "Photo booth", "Wedding florist", "Wedding photography", "Balloon decor", "Event catering", "Entertainer", "Events & weddings"],
    match: /wedding|event|venue|\bdj\b|band\b|party|rental|photo booth|balloon|decor|entertain|planner|bridal/i,
    questions: ["Is my date available?", "How far ahead should I book?", "What areas do you travel to?", "How do we get started?"],
    tone: "warm, celebratory, calm under pressure",
    cta: ["Check my date", "Get a quote"],
    angle: "a day that goes off without a hitch, so they can enjoy it",
  },
  auto: {
    label: "Automotive and transport",
    niches: ["Auto repair", "Mobile mechanic", "Auto detailing", "Car wash", "Body shop", "Tire shop", "Towing", "Vehicle dealership", "Car rental", "Chauffeur", "Courier", "Trucking", "Logistics", "Bicycle repair", "Motorcycle repair", "Automotive & transport"],
    match: /auto|\bcar\b|cars|mechanic|tire|tow(ing)?\b|body shop|collision|oil change|transmission|brake|detail(ing)?|car wash|dealer|chauffeur|limo|courier|delivery|truck(ing)?|logistic|bike|bicycle|motorcycle/i,
    questions: ["Do I need an appointment?", "How long will it take?", "Do you give estimates first?", "Where are you located?"],
    tone: "honest, no-nonsense, dependable",
    cta: ["Get a quote", "Book service"],
    angle: "honest work and getting back on the road fast",
  },
  travel: {
    label: "Travel and hospitality",
    niches: ["Hotel", "Bed & breakfast", "Travel advisor", "Tour guide", "Tour operator", "Campground", "Glamping", "Retreat venue", "Vacation planning", "Boat charters", "Local experiences", "Travel & hospitality"],
    match: /hotel|motel|inn\b|b&b|bed (and|&) breakfast|travel|tour|camp(ground|ing)|glamp|retreat|vacation|charter|lodg|cabin|resort|experience/i,
    questions: ["How do I book?", "What's included?", "When is the best time to visit?", "How do I get there?"],
    tone: "inviting, vivid, relaxed, helpful",
    cta: ["Check availability", "Book your stay", "Plan my trip"],
    angle: "a trip they'll talk about for years",
  },
  tech: {
    label: "Technology and software",
    niches: ["Software company", "App developer", "IT support", "Cybersecurity", "Managed IT", "AI consulting", "Automation services", "Computer repair", "SaaS product", "Data services", "Cloud consulting", "Game studio", "Technology & software"],
    match: /software|\bapp\b|developer|\bit\b support|tech support|cyber|managed it|\bai\b|automation|computer|saas|data|cloud|game|web dev|network/i,
    questions: ["How does it work?", "Who is this for?", "How do we get started?", "How fast can you help?"],
    tone: "clear, capable, plain-spoken, no jargon",
    cta: ["Book a free call", "Get started"],
    angle: "technology that just works, explained in plain English",
  },
  industrial: {
    label: "Manufacturing and industrial",
    niches: ["Manufacturer", "Machine shop", "Metal fabrication", "Woodworking", "Printing", "Packaging", "Industrial maintenance", "Equipment supplier", "Wholesale distributor", "Engineering firm", "Product design", "Manufacturing & industrial"],
    match: /manufactur|machin|fabricat|metal|weld|woodwork|print(ing)?\b|packag|industrial|equipment|wholesale|distribut|engineer|cnc|product design/i,
    questions: ["What can you make?", "Do you do small runs?", "How long does an order take?", "How do I get a quote?"],
    tone: "precise, capable, reliable, straight to the point",
    cta: ["Request a quote", "Get in touch"],
    angle: "parts and work done to spec, on time",
  },
  agriculture: {
    label: "Agriculture and outdoors",
    niches: ["Farm", "Nursery", "Garden center", "Farm stand", "Beekeeping", "Agricultural services", "Outdoor guide", "Fishing guide", "Hunting outfitter", "Forestry", "Land management", "Agriculture & outdoors"],
    match: /farm|nursery|garden|orchard|produce|honey|bee|ranch|livestock|agricult|fishing|hunting|outfitter|guide service|forestry|land manag|timber|hay/i,
    questions: ["What's in season?", "When are you open?", "Where are you located?", "How do I order or book?"],
    tone: "down-to-earth, honest, rooted in place",
    cta: ["Visit the farm", "Book a trip", "Get in touch"],
    angle: "real, local, and done the right way",
  },
  family: {
    label: "Family and care",
    niches: ["Childcare", "Nanny services", "Senior care", "Companion care", "Doula", "Parent coaching", "Family support", "Day camp", "Disability support", "Family & care"],
    match: /child ?care|daycare|nanny|babysit|senior|elder|companion|doula|midwife|parent|family|camp\b|disabilit|caregiv|in-home care/i,
    questions: ["Do you have openings?", "What does a typical day look like?", "What areas do you serve?", "How do we get started?"],
    tone: "gentle, warm, trustworthy, reassuring",
    cta: ["Ask about openings", "Get in touch"],
    angle: "peace of mind that the people they love are in good hands",
  },
  nonprofit: {
    label: "Nonprofits and community",
    niches: ["Charity", "Community group", "Religious organization", "Foundation", "Advocacy group", "Volunteer organization", "Neighborhood association", "Membership organization", "Fundraising project", "Nonprofits & community"],
    match: /charit|nonprofit|non-profit|community|church|ministry|mosque|temple|synagogue|religio|faith|foundation|advoca|volunteer|neighborhood|association|club\b|fundrais|donat/i,
    questions: ["How can I help?", "How do I get involved?", "Where does my donation go?", "When do you meet?"],
    tone: "sincere, hopeful, welcoming, community-minded",
    cta: ["Get involved", "Donate", "Join us"],
    angle: "a clear way to be part of something that matters",
  },
  entertainment: {
    label: "Entertainment and creators",
    niches: ["Content creator", "YouTuber", "Podcaster", "Musician", "Actor", "Comedian", "Streamer", "Author", "Newsletter", "Escape room", "Arcade", "Theater", "Museum", "Entertainment & creators"],
    match: /creator|youtub|podcast|musician|singer|rapper|band|actor|actress|comedian|stream|author|writer|newsletter|escape room|arcade|theat|museum|gallery|influencer/i,
    questions: ["Where can I find more?", "How do I book you?", "When is the next show or release?", "How do I get tickets?"],
    tone: "personal, lively, true to their voice",
    cta: ["Book now", "Get tickets", "Follow along"],
    angle: "a reason to come back for more",
  },
  personal: {
    label: "Personal and lifestyle",
    niches: ["Personal brand", "Portfolio", "Life coach", "Professional organizer", "Personal stylist", "Personal shopper", "Concierge", "Matchmaking", "Resume services", "Public speaker", "Personal & lifestyle"],
    match: /personal brand|portfolio|life coach|coach|organiz(er|ing)|stylist|shopper|concierge|matchmak|resume|speaker|mentor|errand/i,
    questions: ["How does it work?", "Who do you work with?", "What does a first session look like?", "How do we get started?"],
    tone: "personal, warm, confident, encouraging",
    cta: ["Book a free call", "Get started"],
    angle: "real change, with someone in their corner",
  },
  repair: {
    label: "Repair and technical trades",
    niches: ["Appliance repair", "Phone repair", "Watch repair", "Shoe repair", "Tailoring", "Locksmith", "Small engine repair", "Furniture restoration", "Instrument repair", "Welding", "Repair & technical trades"],
    match: /repair|fix|appliance|phone|watch|shoe|cobbler|tailor|alteration|locksmith|small engine|mower repair|restor|instrument|upholster|weld/i,
    questions: ["Can you fix my item?", "How long does a repair take?", "Do you give a price first?", "Where do I drop it off?"],
    tone: "skilled, honest, practical",
    cta: ["Get a repair quote", "Get in touch"],
    angle: "getting the thing they rely on working again",
  },
  science: {
    label: "Science and environment",
    niches: ["Environmental consulting", "Sustainability consulting", "Laboratory", "Scientific consulting", "Recycling", "Waste management", "Energy auditing", "Water testing", "Science & environment"],
    match: /environment|sustainab|laborator|\blab\b|scien|recycl|waste|energy audit|water test|soil test|green energy|compost/i,
    questions: ["What do you test or check?", "How long do results take?", "Who do you work with?", "How do we get started?"],
    tone: "precise, trustworthy, clear, plain-spoken",
    cta: ["Request a quote", "Get in touch"],
    angle: "clear answers they can act on",
  },
};

const GENERAL = {
  label: "Business",
  questions: ["How do I get started?", "Where are you located or what areas do you serve?", "How soon can you help?"],
  tone: "friendly, trustworthy, clear, professional",
  cta: ["Get in touch", "Get started"],
  angle: "the result they're looking for, from people who care",
};

// Exact survey picks first (in the order they chose them), then anything they typed.
const BY_NICHE = new Map();
for (const p of Object.values(PLAYBOOKS)) for (const n of p.niches) BY_NICHE.set(n.toLowerCase(), p);

export function playbookFor(trade = "") {
  const t = String(trade).trim();
  if (!t) return PLAYBOOKS.landscaping; // older surveys didn't ask the type of business
  const parts = t.split(/\s*,\s*/).filter(Boolean);
  for (const part of parts) {
    const hit = BY_NICHE.get(part.toLowerCase());
    if (hit) return hit;
  }
  for (const part of parts) for (const p of Object.values(PLAYBOOKS)) if (p.match.test(part)) return p;
  return GENERAL;
}

// Yard businesses get the landscape picture; everyone else gets soft shapes.
export const isOutdoorTrade = (trade = "") => playbookFor(trade) === PLAYBOOKS.landscaping && !!String(trade).trim();

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
${p.services?.length ? `- Common services in this field: ${p.services.join("; ")}.\n` : ""}- Questions customers often ask: ${p.questions.join(" | ")}.

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
