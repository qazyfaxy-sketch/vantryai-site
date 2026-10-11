// Domain name helpers: clean up what people type and suggest good names.

// Endings we sell. All are cheap, widely trusted and registrable through the API.
export const SELL_TLDS = ["com", "net", "co", "org"];
// We include the domain in the $200 price only if it costs no more than this per year.
export const MAX_INCLUDED_DOMAIN_COST = 15;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// "https://www.Green-Ridge.com/about" -> "green-ridge.com"
export function cleanDomain(raw = "") {
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  d = d.split(/[/?#\s]/)[0].replace(/\.$/, "");
  return d;
}

export function isValidDomain(d) {
  if (!d || d.length > 253) return false;
  const parts = d.split(".");
  if (parts.length < 2) return false;
  if (!/^[a-z]{2,24}$/.test(parts[parts.length - 1])) return false;
  return parts.every((p) => LABEL.test(p));
}

export const tldOf = (d) => d.split(".").pop();

// Turns a search like "green ridge lawn" into "greenridgelawn.com".
export function searchToDomain(q) {
  const raw = String(q || "").trim().toLowerCase();
  if (raw.includes(".")) return cleanDomain(raw);
  const label = raw.replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  return label ? `${label}.com` : "";
}

const slug = (s) => String(s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const STOP = new Set(["llc", "inc", "co", "company", "ltd", "corp"]);

// Ideas based on the business name and city, best first.
export function suggestDomains(businessName = "", city = "") {
  const words = String(businessName).toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
  const core = words.filter((w) => !STOP.has(w));
  const full = slug(core.join(""));
  const cityS = slug(String(city).split(",")[0]);
  const trade = ["landscaping", "lawncare", "lawn", "landscapes", "yardcare"];
  const base = core.filter((w) => !["landscaping", "lawn", "care", "landscape", "landscapes", "services", "service"].includes(w)).join("");

  const short = slug(core.filter((w) => w !== "and" && w !== "the").join(""));
  const ideas = [
    full && `${full}.com`,
    short && short !== full && `${short}.com`,
    base && base !== full && `${base}${trade[0]}.com`,
    base && `${base}${trade[1]}.com`,
    full && cityS && `${full}${cityS}.com`,
    full && `${full}oh.com`,
    full && `${full}ohio.com`,
    full && `get${full}.com`,
    full && `${full}.co`,
    full && `${full}.net`,
  ].filter(Boolean);

  return [...new Set(ideas)].filter((d) => isValidDomain(d) && d.split(".")[0].length <= 40).slice(0, 8);
}
