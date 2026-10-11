// The step between "I like this preview" and payment: pick a style, a web address and a plan.
import { esc } from "../lib/util.js";
import { page } from "./shell.js";

const STYLES = [
  ["modern", "Modern"],
  ["editorial", "Editorial"],
  ["minimal", "Minimal"],
];

export function goPage({ previewId, style, businessName, suggestions }) {
  const styleOpts = STYLES.map(
    ([k, label]) => `<label class="opt"><input type="radio" name="style" value="${k}"${k === style ? " checked" : ""}><span><strong>${label}</strong><a href="/p/${esc(previewId)}?style=${k}" target="_blank" rel="noopener">View</a></span></label>`
  ).join("");

  const body = `<main>
<h1>Pick your web address</h1>
<p class="lede">A new domain is included in your price. Already have one? You can use that instead.</p>

<form id="go" novalidate>
<section class="card" aria-labelledby="s1"><h2 id="s1">Your style</h2><p class="muted small">You can switch if you liked another one better.</p><div class="opts">${styleOpts}</div></section>

<section class="card" aria-labelledby="s2"><h2 id="s2">Your web address</h2>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" class="tab" id="tab-new" aria-selected="true" aria-controls="pane-new">Get a new domain</button>
    <button type="button" role="tab" class="tab" id="tab-own" aria-selected="false" aria-controls="pane-own">I already own one</button>
  </div>
  <div id="pane-new" role="tabpanel" aria-labelledby="tab-new">
    <div id="results" class="results" aria-live="polite"><p class="muted small">Checking which names are free…</p></div>
    <div class="search"><label for="q" class="small"><strong>Search for a different name</strong></label>
      <div class="row"><input id="q" type="search" inputmode="url" autocomplete="off" placeholder="e.g. greenridgelawn" maxlength="63"><button type="button" class="ghost" id="search">Search</button></div></div>
  </div>
  <div id="pane-own" role="tabpanel" aria-labelledby="tab-own" hidden>
    <label for="own" class="small"><strong>Your domain</strong></label>
    <input id="own" type="text" inputmode="url" autocomplete="off" placeholder="yourbusiness.com" maxlength="253">
    <p class="muted small">After checkout, we'll email you two simple settings to connect it. Reply with where you bought it and we'll walk you through it.</p>
  </div>
</section>

<section class="card" aria-labelledby="s3"><h2 id="s3">How you'd like to pay</h2>
  <div class="plans">
    <label class="plan"><input type="radio" name="plan" value="once" checked><span><em>Best value</em><strong>$200 once</strong><small>Then $50/year from year two</small></span></label>
    <label class="plan"><input type="radio" name="plan" value="monthly"><span><strong>$49/month</strong><small>$0 down, 12-month minimum, then $50/year</small></span></label>
  </div>
</section>

<div id="err" class="alert" role="alert" hidden></div>
<button class="jelly block" id="pay" type="submit">Continue to secure checkout</button>
<p class="muted small center">Full refund if you change your mind before your site goes live. You'll pay on Stripe's secure page.</p>
</form>
</main>
<style>
.opts{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.opt{position:relative}.opt input,.plan input{position:absolute;opacity:0}
.opt span{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:999px;padding:9px 16px;cursor:pointer;background:#fff}
.opt span a{font-size:13px}
.opt input:checked+span,.plan input:checked+span,.dom input:checked+span{border-color:var(--indigo);box-shadow:0 0 0 2px var(--indigo) inset;background:var(--pale)}
.opt input:focus-visible+span,.plan input:focus-visible+span,.dom input:focus-visible+span{outline:3px solid var(--indigo);outline-offset:2px}
.tabs{display:flex;gap:6px;background:var(--pale);padding:5px;border-radius:999px;margin:14px 0 18px;width:max-content;max-width:100%}
.tab{border:0;background:none;border-radius:999px;padding:9px 16px;font:600 14px var(--sans);color:var(--muted);cursor:pointer}
.tab[aria-selected=true]{background:#fff;color:var(--ink);box-shadow:0 2px 8px #39235B14}
.results{display:grid;gap:8px;margin-bottom:18px}
.dom{position:relative}.dom input{position:absolute;opacity:0}
.dom span{display:flex;justify-content:space-between;gap:12px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:13px 16px;cursor:pointer;background:#fff;overflow-wrap:anywhere}
.dom strong{font-weight:600}.dom small{color:var(--ok);font-weight:600;white-space:nowrap}
.dom.off span{cursor:default;color:var(--muted);background:#FAFAFC}.dom.off small{color:var(--muted);font-weight:500}
.row{display:flex;gap:8px;margin-top:6px}.row input{flex:1}
#pane-own input{margin:6px 0 8px}
.plans{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
.plan span{display:flex;flex-direction:column;gap:2px;border:1px solid var(--line);border-radius:16px;padding:16px;cursor:pointer;height:100%;background:#fff}
.plan em{font-style:normal;font-size:12px;font-weight:600;color:var(--indigo)}
.plan strong{font-family:var(--serif);font-weight:500;font-size:24px}.plan small{color:var(--muted)}
#err{margin-bottom:14px}.center{text-align:center}
@media(max-width:560px){.plans{grid-template-columns:1fr}.tabs{width:100%}.tab{flex:1;padding:9px 8px}.dom span{flex-direction:column;align-items:flex-start;gap:2px}.dom strong{overflow-wrap:anywhere}}
</style>`;

  const script = `
var PREVIEW=${JSON.stringify(previewId)},SUGGEST=${JSON.stringify(suggestions)};
var f=document.getElementById('go'),res=document.getElementById('results'),err=document.getElementById('err'),pay=document.getElementById('pay');
var mode='new',seen={};
function showErr(m){err.textContent=m;err.hidden=!m;}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function render(list,prepend){
  var html=list.map(function(d){
    if(seen[d.name])return '';seen[d.name]=1;
    if(d.available&&d.included)return '<label class="dom"><input type="radio" name="domain" value="'+esc(d.name)+'"><span><strong>'+esc(d.name)+'</strong><small>Available, included</small></span></label>';
    var why=d.available?'Premium name, not included':'Taken';
    return '<div class="dom off"><span><strong>'+esc(d.name)+'</strong><small>'+why+'</small></span></div>';
  }).join('');
  if(res.querySelector('p'))res.innerHTML='';
  res.insertAdjacentHTML(prepend?'afterbegin':'beforeend',html);
  var firstNew=list.filter(function(d){return d.available&&d.included;})[0];
  var pick=(prepend&&firstNew&&res.querySelector('input[name=domain][value="'+firstNew.name+'"]'))||res.querySelector('input[name=domain]:checked')||res.querySelector('input[name=domain]');
  if(pick)pick.checked=true;
  if(!res.querySelector('input[name=domain]')&&!res.querySelector('.dom'))res.innerHTML='<p class="muted small">None of our ideas are free. Try a search below.</p>';
}
function check(params,prepend){
  return fetch('/api/domains/check?id='+encodeURIComponent(PREVIEW)+'&'+params).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error);return j;});})
  .then(function(j){render(j.results,prepend);}).catch(function(e){showErr(e.message||'We could not check domains right now. Please try again.');});
}
check('names='+encodeURIComponent(SUGGEST.join(',')));
document.getElementById('search').addEventListener('click',function(){
  var q=document.getElementById('q').value.trim();if(!q)return;showErr('');
  this.disabled=true;var b=this;check('q='+encodeURIComponent(q),true).finally(function(){b.disabled=false;});
});
document.getElementById('q').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();document.getElementById('search').click();}});
['new','own'].forEach(function(m){document.getElementById('tab-'+m).addEventListener('click',function(){
  mode=m;['new','own'].forEach(function(x){document.getElementById('tab-'+x).setAttribute('aria-selected',x===m);document.getElementById('pane-'+x).hidden=x!==m;});
});});
f.addEventListener('submit',function(e){
  e.preventDefault();showErr('');
  var domain=mode==='new'?((f.querySelector('input[name=domain]:checked')||{}).value||''):document.getElementById('own').value.trim();
  if(!domain){showErr(mode==='new'?'Pick a web address first.':'Type the domain you own, like yourbusiness.com.');return;}
  pay.disabled=true;pay.textContent='Opening secure checkout…';
  fetch('/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({previewId:PREVIEW,style:f.elements['style'].value,plan:f.elements['plan'].value,domainMode:mode,domain:domain})})
  .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error);return j;});})
  .then(function(j){location.href=j.url;})
  .catch(function(e){showErr(e.message||'Something went wrong. Please try again.');pay.disabled=false;pay.textContent='Continue to secure checkout';});
});`;

  return page({ title: `Pick your web address for ${businessName}`, body, script });
}
