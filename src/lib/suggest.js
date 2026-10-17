// "Finish my sentence": type-ahead for the fields people have to fill in.
// complete() is plain and offline (no AI call, no cost, nothing sent anywhere). The page script
// below is built from the same function, so the tests check exactly what runs in the browser.
// Tap a suggestion (or press the right arrow at the end of the text) to accept it.

export function complete(kind, line, ctx) {
  ctx = ctx || {};
  const SELL = ["scheduling software for ", "project management software for ", "accounting software for ", "CRM software for ", "invoicing software for ", "payroll and HR software for ", "analytics software for ", "customer support software for ", "email marketing software for ", "inventory software for ", "online booking software for ", "cybersecurity software for ", "e-signature software for ", "field service software for ", "training software for "];
  const WHO = ["dental offices", "law firms", "small accounting firms", "real estate agencies", "restaurants", "online stores", "construction companies", "health clinics", "marketing agencies", "nonprofits", "small businesses", "startups", "schools", "property managers", "freelancers", "salons and spas", "fitness studios", "home service companies", "manufacturers", "IT teams"];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const low = (s) => String(s || "").toLowerCase();
  const l = String(line || "");
  const q = low(l).trim();
  const starts = (list, from) => list.filter((x) => low(x).startsWith(low(from)) && low(x) !== low(from));
  let out = [];
  if (kind === "sell") {
    const m = l.match(/^(.*\bfor\s+)(.*)$/i);
    if (m) out = starts(WHO, m[2]).map((w) => m[1] + w);
    else out = starts(SELL, l);
    if (!out.length && q.length > 2 && !/\bfor\s*$/i.test(l)) out = [l.replace(/\s+$/, "") + " for "];
  } else if (kind === "buyers") {
    const bank = WHO.map((w) => cap(w) + " with 5 to 50 employees").concat(WHO.map(cap));
    out = starts(bank, l);
  } else if (kind === "website") {
    const t = q.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const tlds = [".com", ".io", ".co", ".ai", ".app", ".net"];
    if (t && !t.includes(".")) out = tlds.map((x) => t + x);
    else if (t) {
      const dot = t.lastIndexOf(".");
      const stem = t.slice(0, dot), tail = t.slice(dot);
      out = tlds.filter((x) => x.startsWith(tail) && x !== tail).map((x) => stem + x);
    } else if (ctx.business) out = tlds.slice(0, 3).map((x) => low(ctx.business).replace(/[^a-z0-9]+/g, "") + x);
  } else if (kind === "email") {
    const at = l.indexOf("@");
    const site = low(ctx.site).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
    const doms = (site.includes(".") ? [site] : []).concat(["gmail.com", "outlook.com", "yahoo.com", "icloud.com"]);
    if (at < 0 && l.trim()) out = doms.slice(0, 4).map((d) => l.trim() + "@" + d);
    else if (at > 0) out = doms.filter((d) => d.startsWith(low(l.slice(at + 1))) && l.slice(at + 1) !== d).map((d) => l.slice(0, at + 1) + d);
  } else if (kind === "questions") {
    const s = low(ctx.sell || "").trim() || "software for my business";
    const bank = [`What is the best ${s}?`, `Which ${s} works for a small team?`, `How much does ${s} cost?`, `What should I look for in ${s}?`, `What is the easiest ${s} to set up?`, `Is there a free ${s}?`, `Which ${s} do you recommend, and why?`, `${cap(s)} vs spreadsheets: which is better?`];
    out = q ? bank.filter((x) => low(x).startsWith(q) && low(x) !== q) : bank;
    if (!out.length && q.length > 3) out = bank.filter((x) => low(x).includes(q)).slice(0, 4);
  } else if (kind === "avoid") {
    const bank = ["Don't promise results or guarantees", "Don't call us the best or number one", "Don't mention our pricing", "Don't compare us to competitors by name", "Don't say we are cheap", "Don't mention our old product name"];
    out = q ? starts(bank, l) : bank;
  }
  return out.slice(0, 6);
}

// The page script. Fields opt in with data-suggest="sell|buyers|website|email|questions|avoid".
export function suggestScript() {
  return `<style>.sg{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px;min-height:0}.sg button{border:1px solid #B9C3D1;background:#F4F7FB;border-radius:999px;padding:6px 12px;font:14px var(--sans);cursor:pointer;color:inherit;text-align:left}.sg button:hover,.sg button:focus{background:#E4ECF7}</style>
<script>(function(){
var complete=${complete.toString()};
function val(n){var e=document.querySelector('[name="'+n+'"]');return e?e.value:""}
document.querySelectorAll("[data-suggest]").forEach(function(el){
  var box=document.createElement("div");box.className="sg";box.setAttribute("aria-label","Suggestions");
  var host=el.closest("label")||el;host.parentNode.insertBefore(box,host.nextSibling);
  var first="";
  function ctx(){return{sell:val("sell")||val("category"),site:val("website"),business:val("business")||val("name")}}
  function lineInfo(){var v=el.value,c=el.selectionStart==null?v.length:el.selectionStart,s=v.lastIndexOf("\\n",c-1)+1;return{v:v,c:c,s:s,line:v.slice(s,c)}}
  function show(){var i=lineInfo();var list=complete(el.getAttribute("data-suggest"),i.line,ctx());first=list[0]||"";box.innerHTML="";
    list.forEach(function(t){var b=document.createElement("button");b.type="button";b.textContent=t;b.onclick=function(){take(t)};box.appendChild(b)})}
  function take(t){var i=lineInfo();el.value=i.v.slice(0,i.s)+t+i.v.slice(i.c);var p=i.s+t.length;el.focus();try{el.setSelectionRange(p,p)}catch(e){}show()}
  el.addEventListener("input",show);el.addEventListener("focus",show);el.addEventListener("click",show);
  el.addEventListener("keydown",function(e){var i=lineInfo();if(e.key==="ArrowRight"&&first&&i.c===el.value.length&&el.selectionEnd===el.value.length){e.preventDefault();take(first)}});
});
})();</script>`;
}
