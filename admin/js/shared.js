// Bindawasub Admin — shared

// Bindawasub Admin — shared dashboard state and helpers

let selectedCustomer=null;
let services=[];
let providerServiceOperations=[];

const $=id=>document.getElementById(id);
const money=n=>"₦"+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});

function msg(el,text,type="info"){el.innerHTML=text?'<div class="msg '+type+'">'+escapeHtml(text)+'</div>':""}

function escapeHtml(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
