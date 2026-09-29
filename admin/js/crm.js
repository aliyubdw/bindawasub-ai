// Bindawasub Admin — Customer CRM
let crmSelectedCustomerId = null;
let crmTagsCache = [];

function crmDate(value){
  if(!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
}
function crmInitials(name){
  return String(name||"Customer").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase() || "C";
}
function crmRenderTags(tags){
  return (tags||[]).map(t=>'<span class="crm-tag">'+escapeHtml(t.name)+'</span>').join("") || '<span class="muted">No tags</span>';
}

async function loadCrmTags(){
  try{
    const d=await crmAdmin({action:"list_tags"});
    crmTagsCache=d.tags||[];
    $("crmTags").innerHTML=crmTagsCache.map(t=>'<span class="crm-tag">'+escapeHtml(t.name)+'</span>').join("") || '<span class="muted">No tags yet.</span>';
  }catch(e){ msg($("crmTagMsg"),e.message,"error"); }
}

async function loadCrmCustomers(){
  const list=$("crmCustomerList");
  list.innerHTML='<div class="crm-empty">Loading customers…</div>';
  try{
    const d=await crmAdmin({action:"customer_directory",search:$("crmSearch").value.trim(),limit:100});
    const customers=d.customers||[];
    if(!customers.length){ list.innerHTML='<div class="crm-empty">No customers found.</div>'; return; }
    list.innerHTML=customers.map(c=>{
      const s=c.crm||{}, w=c.wallet||{};
      return '<div class="crm-customer-item '+(c.id===crmSelectedCustomerId?'active':'')+'" data-customer-id="'+escapeHtml(c.id)+'">'+
        '<strong>'+escapeHtml(c.name||"Unnamed customer")+'</strong>'+
        '<div class="crm-customer-meta"><span>'+escapeHtml(c.phone||"No phone")+'</span><span>₦'+Number(w.balance||0).toLocaleString()+'</span><span>'+Number(s.successful||0)+' purchases</span></div>'+
        '<div class="crm-customer-meta"><span>'+escapeHtml(c.email||"No email")+'</span><span>Last: '+escapeHtml(crmDate(s.last_activity))+'</span></div>'+
        '<div class="crm-tags" style="margin-top:6px">'+crmRenderTags(s.tags)+'</div></div>';
    }).join("");
    list.querySelectorAll("[data-customer-id]").forEach(el=>el.addEventListener("click",()=>openCrmCustomer(el.dataset.customerId)));
  }catch(e){
    list.innerHTML="";
    msg($("crmMsg"),e.message,"error");
  }
}

function crmTimeline(customer){
  const events=[];
  (customer.transactions||[]).forEach(t=>events.push({date:t.created_at,title:"Transaction — "+(t.product?.product_name||t.description||t.service_type||"Purchase"),detail:(t.status||"").toUpperCase()+" • ₦"+Number(t.amount||0).toLocaleString()+" • "+(t.provider||"—"),kind:"transaction"}));
  (customer.funding||[]).forEach(f=>events.push({date:f.created_at,title:"Wallet funding",detail:(f.status||"").toUpperCase()+" • ₦"+Number(f.amount||0).toLocaleString()+" • "+(f.reference||""),kind:"funding"}));
  (customer.notes||[]).forEach(n=>events.push({date:n.created_at,title:"CRM note",detail:n.note,kind:"note"}));
  (customer.conversations||[]).forEach(c=>events.push({date:c.last_message_at||c.created_at,title:"AI conversation",detail:c.title||c.channel||"Conversation",kind:"chat"}));
  return events.sort((a,b)=>new Date(b.date)-new Date(a.date));
}

async function openCrmCustomer(id){
  crmSelectedCustomerId=id;
  const profile=$("crmProfile");
  profile.innerHTML='<div class="crm-empty">Loading customer profile…</div>';
  try{
    const d=await crmAdmin({action:"customer_profile",customer_id:id});
    const c=d.customer;
    const s=c.stats||{}, w=c.wallet||{};
    profile.innerHTML=
      '<div class="crm-profile-head"><div class="crm-head-main"><div class="crm-avatar">'+crmInitials(c.name)+'</div><div><h2 style="margin:0 0 4px">'+escapeHtml(c.name||"Unnamed customer")+'</h2><div class="muted">'+escapeHtml(c.phone||"No phone")+' • '+escapeHtml(c.email||"No email")+'</div><div class="muted">Joined '+escapeHtml(crmDate(c.created_at))+'</div></div></div><button id="crmFundFromProfile" class="secondary">Open Funding</button></div>'+
      '<div class="crm-tags">'+crmRenderTags(c.tags)+'</div>'+
      '<div class="crm-stats">'+
      '<div class="crm-stat"><small>Wallet</small><strong>'+money(w.balance)+'</strong></div>'+
      '<div class="crm-stat"><small>Purchases</small><strong>'+s.successful+'</strong></div>'+
      '<div class="crm-stat"><small>Total spent</small><strong>'+money(s.spent)+'</strong></div>'+
      '<div class="crm-stat"><small>Profit</small><strong>'+money(s.profit)+'</strong></div></div>'+
      '<div class="crm-section"><h3>Customer information</h3><div class="grid2"><div><strong>Status</strong><div class="muted">'+escapeHtml(c.role||"customer")+'</div></div><div><strong>Language</strong><div class="muted">'+escapeHtml(c.language||"—")+'</div></div><div><strong>Telegram</strong><div class="muted">'+(c.telegram?.active?"Connected":"Not connected")+'</div></div><div><strong>Funding</strong><div class="muted">'+money(s.funding)+'</div></div></div></div>'+
      '<div class="crm-section"><h3>Customer tags</h3><div id="crmProfileTags" class="crm-tag-list"></div><button id="crmSaveTags">Save Tags</button></div>'+
      '<div class="crm-section"><h3>Add CRM note</h3><textarea id="crmNewNote" placeholder="Private note for the admin team…"></textarea><button id="crmAddNote">Add Note</button></div>'+
      '<div class="crm-section"><h3>Activity timeline</h3><div class="crm-timeline" id="crmTimeline"></div></div>'+
      '<div class="crm-section"><h3>Recent transactions</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Amount</th><th>Status</th><th>Provider</th></tr></thead><tbody id="crmTxRows"></tbody></table></div></div>'+
      '<div class="crm-section"><h3>CRM notes</h3><div id="crmNotes"></div></div>';

    const tagBox=$("crmProfileTags");
    tagBox.innerHTML=crmTagsCache.map(t=>'<button type="button" class="crm-tag-option '+((c.tags||[]).some(x=>x.id===t.id)?'selected':'')+'" data-tag-id="'+t.id+'">'+escapeHtml(t.name)+'</button>').join("")||'<span class="muted">Create tags below first.</span>';
    tagBox.querySelectorAll(".crm-tag-option").forEach(b=>b.onclick=()=>b.classList.toggle("selected"));
    $("crmSaveTags").onclick=async()=>{
      const tag_ids=[...tagBox.querySelectorAll(".crm-tag-option.selected")].map(x=>x.dataset.tagId);
      try{await crmAdmin({action:"set_tags",customer_id:id,tag_ids});msg($("crmMsg"),"Customer tags updated.","success");await openCrmCustomer(id);await loadCrmCustomers();}catch(e){msg($("crmMsg"),e.message,"error");}
    };
    $("crmAddNote").onclick=async()=>{
      const note=$("crmNewNote").value.trim();
      if(!note){msg($("crmMsg"),"Enter a note first.","error");return;}
      try{await crmAdmin({action:"add_note",customer_id:id,note});msg($("crmMsg"),"CRM note added.","success");await openCrmCustomer(id);await loadCrmCustomers();}catch(e){msg($("crmMsg"),e.message,"error");}
    };
    $("crmFundFromProfile").onclick=()=>{document.querySelector('[data-tab="funding"]')?.click();};
    
    $("crmTxRows").innerHTML=(c.transactions||[]).slice(0,30).map(t=>'<tr><td>'+escapeHtml(crmDate(t.created_at))+'</td><td>'+escapeHtml(t.product?.product_name||t.description||t.service_type||"—")+'</td><td>'+money(t.amount)+'</td><td>'+escapeHtml(t.status||"—")+'</td><td>'+escapeHtml(t.provider||"—")+'</td></tr>').join("")||'<tr><td colspan="5" class="muted">No transactions.</td></tr>';
    $("crmNotes").innerHTML=(c.notes||[]).map(n=>'<div class="crm-note"><div>'+escapeHtml(n.note)+'</div><small>'+escapeHtml(n.admin?.name||"Admin")+' • '+escapeHtml(crmDate(n.created_at))+'</small><button type="button" class="danger" style="float:right;padding:5px 8px;min-height:32px" data-delete-note="'+n.id+'">Delete</button><div style="clear:both"></div></div>').join("")||'<div class="muted">No CRM notes yet.</div>';
    $("crmNotes").querySelectorAll("[data-delete-note]").forEach(b=>b.onclick=async()=>{
      if(!confirm("Delete this CRM note?"))return;
      try{await crmAdmin({action:"delete_note",note_id:b.dataset.deleteNote});await openCrmCustomer(id);await loadCrmCustomers();}catch(e){msg($("crmMsg"),e.message,"error");}
    });
    $("crmTimeline").innerHTML=crmTimeline(c).slice(0,60).map(e=>'<div class="crm-activity"><strong>'+escapeHtml(e.title)+'</strong><div class="muted">'+escapeHtml(e.detail)+'</div><small>'+escapeHtml(crmDate(e.date))+'</small></div>').join("")||'<div class="muted">No activity yet.</div>';
  }catch(e){profile.innerHTML='<div class="crm-empty">'+escapeHtml(e.message||"Unable to load customer.")+'</div>';msg($("crmMsg"),e.message,"error");}
}

async function crmAddTag(){
  const name=prompt("Tag name:");
  if(!name?.trim())return;
  try{await crmAdmin({action:"save_tag",name:name.trim()});msg($("crmTagMsg"),"Tag created.","success");await loadCrmTags();if(crmSelectedCustomerId)await openCrmCustomer(crmSelectedCustomerId);}catch(e){msg($("crmTagMsg"),e.message,"error");}
}

async function loadCrm(){
  await loadCrmTags();
  await loadCrmCustomers();
}

document.addEventListener("DOMContentLoaded",()=>{
  $("crmSearchButton")?.addEventListener("click",loadCrmCustomers);
  $("crmRefreshButton")?.addEventListener("click",loadCrm);
  $("crmSearch")?.addEventListener("keydown",e=>{if(e.key==="Enter")loadCrmCustomers();});
  $("crmAddTagButton")?.addEventListener("click",crmAddTag);
  const crmNav=document.querySelector('[data-tab="crm"]');
  crmNav?.addEventListener("click",()=>loadCrm(),true);
});
