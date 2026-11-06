(function(){
var $=function(i){return document.getElementById(i)};
var next=encodeURIComponent(location.pathname);
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function fmt(iso){try{return new Date(iso).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}catch(e){return""}}
function api(path,body){return fetch("/api/auth/"+path,{method:body?"POST":"GET",credentials:"same-origin",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().then(function(d){return{ok:r.ok,s:r.status,d:d}})})}
function gate(r){if(r.s===401){location.href="/login.html?next="+next;return false}return true}
var page=document.body.getAttribute("data-page");

if(page==="account"){
  api("me").then(function(r){var u=r.d&&r.d.user;if(!u){location.href="/login.html?next="+next;return}
    $("nm").textContent=(u.firstName+" "+(u.lastName||"")).trim();$("mail").textContent=u.email;$("created").textContent=fmt(u.createdAt);
    $("jt").value=u.jobTitle;$("cc").value=u.currentCompany;$("pc").value=u.previousCompany;$("form").hidden=false});
  $("form").onsubmit=function(e){e.preventDefault();$("err").textContent="";$("okm").textContent="";var b=$("go");b.disabled=true;
    api("profile",{jobTitle:$("jt").value,currentCompany:$("cc").value,previousCompany:$("pc").value}).then(function(r){b.disabled=false;if(!gate(r))return;
      if(!r.ok)return $("err").textContent=r.d.error||"Something went wrong. Please try again.";$("okm").textContent="Saved."}).catch(function(){b.disabled=false;$("err").textContent="Something went wrong. Please try again."})};
}

if(page==="saved"||page==="applied"){
  var L={saved:[],applied:[]};
  var svg='<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>';
  function has(l,u){return l.some(function(x){return x.url===u})}
  function draw(){
    var list=L[page];$("cnt").textContent=list.length+(page==="saved"?" saved":" applied");
    if(!list.length){$("list").innerHTML='<div class="empty">'+(page==="saved"?"No saved jobs yet. Tap the bookmark icon on any job to save it.":"No applications yet. Tick Applied on any job to track it here.")+'</div>';return}
    $("list").innerHTML=list.map(function(j){var ap=has(L.applied,j.url);
      return '<div class="ji" data-u="'+esc(j.url)+'"><div class="m"><a href="'+esc(j.url)+'" target="_blank" rel="noopener noreferrer">'+esc(j.title||"Job")+'</a><div>'+esc(j.company)+(j.location?" · "+esc(j.location):"")+(j.department?" · "+esc(j.department):"")+'</div></div>'
      +'<span class="d">'+(page==="saved"?"Saved ":"Applied ")+fmt(j.at)+'</span>'
      +(page==="saved"?'<button type="button" class="sv" data-a="unsave" aria-label="Remove from saved" title="Remove from saved">'+svg+'</button>':'')
      +'<button type="button" class="ap'+(ap?" on":"")+'" data-a="'+(ap?"unapply":"apply")+'" role="checkbox" aria-checked="'+ap+'"><span class="bx"></span>Applied</button></div>'}).join("")}
  api("jobs").then(function(r){if(!gate(r))return;L=r.d;draw()});
  $("list").addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;var row=b.closest(".ji"),u=row.getAttribute("data-u"),op=b.getAttribute("data-a");
    var src=L.saved.concat(L.applied).filter(function(x){return x.url===u})[0];if(!src)return;
    var snap=JSON.stringify(L);
    if(op==="unsave")L.saved=L.saved.filter(function(x){return x.url!==u});
    if(op==="unapply")L.applied=L.applied.filter(function(x){return x.url!==u});
    if(op==="apply")L.applied.unshift({url:u,title:src.title,company:src.company,location:src.location,department:src.department,at:new Date().toISOString()});
    draw();
    api("job",{op:op,job:src}).then(function(r){if(!r.ok){L=JSON.parse(snap);draw();gate(r)}}).catch(function(){L=JSON.parse(snap);draw()})});
}
})();
