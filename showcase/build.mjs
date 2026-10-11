// Builds the homepage showcase: real sites from the engine, for made-up Ohio businesses.
import { renderSite } from "../src/render.js";
import { writeFileSync, mkdirSync } from "node:fs";
const S = (name, d) => ({ name, description: d });
const biz = [
  ["Maple & Moss Landscaping","Cleveland","(216) 555-0118","editorial","forest","Gardens that make the neighbors look twice","Landscape design, planting and seasonal care for homes across Cleveland's east side.","Free estimates"],
  ["Buckeye Lawn Pros","Columbus","(614) 555-0143","modern","navy","Mowed, edged and done by Friday","Weekly lawn care for busy Columbus homeowners. Same crew, same day, every week.","Get a free quote"],
  ["Riverbend Tree Care","Dayton","(937) 555-0161","minimal","earth","Safe tree work, clean yard after","Trimming, removal and storm cleanup for Dayton and the Miami Valley.","Request an estimate"],
  ["Northcoast Snow & Lawn","Toledo","(419) 555-0127","modern","charcoal","Lawns all summer. Clear drives all winter.","One local crew for mowing, cleanups and snow removal across Toledo.","Book your season"],
  ["Stonegate Patios","Akron","(330) 555-0174","editorial","sage","A backyard you'll actually use","Paver patios, retaining walls and fire pits built to last Ohio winters.","Plan my patio"],
  ["Hollow Creek Gardens","Cincinnati","(513) 555-0139","minimal","teal","Beds, borders and blooms, handled","Garden installs and upkeep for Cincinnati homes that want color all season.","Get a free quote"],
  ["Clearcut Mowing Co.","Canton","(330) 555-0152","modern","forest","Sharp stripes. Fair prices.","Residential mowing, trimming and leaf cleanup across Stark County.","See my price"],
  ["Fieldstone Hardscapes","Mentor","(440) 555-0186","minimal","charcoal","Stone work done right the first time","Walkways, steps and walls for Lake County homeowners.","Request a quote"],
  ["Bluegrass Yard Care","Lancaster","(740) 555-0133","editorial","navy","Your weekends back, your lawn in shape","Mowing, aeration and overseeding for Fairfield County lawns.","Get a free quote"],
  ["Green Acre Irrigation","Mason","(513) 555-0191","modern","teal","Green grass without the guesswork","Sprinkler installs, repairs and winterizing in Mason and West Chester.","Schedule service"],
  ["Cedar Line Yard Works","Youngstown","(330) 555-0108","editorial","earth","Cleanups, mulch and edges that pop","Spring and fall cleanups, mulching and bed edging across the Mahoning Valley.","Book a cleanup"],
  ["Prairie Roots Landscapes","Westerville","(614) 555-0165","minimal","sage","Native plants, low upkeep, big curb appeal","Landscape design with native Ohio plants for Westerville homes.","Start my design"],
];
const out = new URL("./sites/", import.meta.url); mkdirSync(out, { recursive: true });
const list = biz.map(([businessName, city, phone, style, palette, headline, subheadline, ctaText], i) => {
  const copy = { headline, subheadline, ctaText,
    services: [S("Lawn & garden care","Regular care that keeps your property looking sharp."),S("Seasonal cleanups","Leaves, branches and beds cleared each spring and fall."),S("Mulch & edging","Fresh mulch and crisp edges for a finished look.")],
    about: `${businessName} is a local crew serving ${city}.`, serviceAreas: [city], faqs: [], seoTitle: businessName, seoDescription: subheadline };
  const file = `site-${String(i + 1).padStart(2, "0")}.html`;
  writeFileSync(new URL(file, out), renderSite({ copy, input: { businessName, city, phone }, style, palette }));
  return { file, businessName, city, style };
});
writeFileSync(new URL("./sites/list.json", import.meta.url), JSON.stringify(list, null, 1));
console.log(list.length, "sites");
