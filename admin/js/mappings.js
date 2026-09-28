// Bindawasub Admin — mappings

async function loadMappings(){try{
  const pid=$("mappingProduct").value;
  const d=await admin({action:"list_mappings",product_id:pid||null});
  const rows=d.mappings||[]; window._mappings=rows;
  $("mappingRows").innerHTML=rows.map(m=>'<tr><td>'+escapeHtml(m.products?.product_name||"—")+'<br><span class="muted">'+escapeHtml(m.products?.sku||"")+'</span></td><td>'+escapeHtml(m.api_providers?.name||"—")+'</td><td><strong>'+escapeHtml(m.provider_plan_id)+'</strong></td><td>'+escapeHtml(m.api_endpoints?.operation||"Auto")+'</td><td>'+money(m.provider_cost)+'</td><td>'+m.priority+'</td><td>'+escapeHtml(m.provider_status)+'</td><td><span class="badge '+(m.active?"on":"off")+'">'+(m.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editMapping(\''+m.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="9" class="muted">No provider Plan IDs configured.</td></tr>';
}catch(e){msg($("mappingMsg"),e.message,"error")}}

function refreshMappingProductOptions(){
  $("mappingProduct").innerHTML='<option value="">All products</option>'+products.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.product_name)+' — '+escapeHtml(p.network||"")+'</option>').join("");
}

async function openMapping(m){
  $("modalTitle").textContent=m?"Edit Provider Plan Mapping":"Add Provider Plan ID";
  const providerId=m?.provider_id||providers[0]?.id||"";
  const endpointData=await admin({action:"list_endpoints",provider_id:providerId});
  const purchaseEndpoints=(endpointData.endpoints||[]).filter(e=>e.active&&e.operation==="purchase");
  const endpointOptions='<option value="">Automatic: use active purchase endpoint</option>'+purchaseEndpoints.map(e=>'<option value="'+e.id+'">'+escapeHtml(e.service_type||"service")+' • '+escapeHtml(e.method||"")+' '+escapeHtml(e.path||"")+'</option>').join("");
  $("modalBody").innerHTML='<div class="grid2"><div class="field"><label>Bindawasub internal plan</label><select id="mProduct">'+products.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.product_name)+' — '+escapeHtml(p.network||"")+'</option>').join("")+'</select></div><div class="field"><label>Provider</label><select id="mProvider">'+providers.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join("")+'</select></div></div><div class="field"><label>Purchase endpoint <span class="muted">(optional)</span></label><select id="mEndpoint">'+endpointOptions+'</select><div class="muted">Leave automatic unless this product must use a specific provider purchase endpoint.</div></div><div class="grid2"><div class="field"><label>Provider Plan ID *</label><input id="mPlanId" placeholder="Exact ID supplied by provider"></div><div class="field"><label>Provider Plan Name</label><input id="mPlanName"></div></div><div class="grid2"><div class="field"><label>Provider Cost (₦)</label><input id="mCost" type="number" min="0" step=".01"></div><div class="field"><label>Priority</label><input id="mPriority" type="number" min="0" value="100"></div></div><div class="grid2"><div class="field"><label>Provider status</label><input id="mStatus" value="active"></div><div class="field"><label><input id="mActive" type="checkbox" style="width:auto" checked> Active</label></div></div><div class="field"><label>Metadata (JSON)</label><textarea id="mMeta">{}</textarea></div><button id="saveMapping">Save Provider Plan ID</button>';
  $("mProduct").value=m?.product_id||products[0]?.id||""; $("mProvider").value=providerId; $("mEndpoint").value=m?.endpoint_id||""; $("mProvider").onchange=async()=>{try{const d=await admin({action:"list_endpoints",provider_id:$("mProvider").value});const eps=(d.endpoints||[]).filter(e=>e.active&&e.operation==="purchase");$("mEndpoint").innerHTML='<option value="">Automatic: use active purchase endpoint</option>'+eps.map(e=>'<option value="'+e.id+'">'+escapeHtml(e.service_type||"service")+' • '+escapeHtml(e.method||"")+' '+escapeHtml(e.path||"")+'</option>').join("");}catch(e){msg($("modalMsg"),e.message,"error")}}; $("mPlanId").value=m?.provider_plan_id||""; $("mPlanName").value=m?.provider_plan_name||""; $("mCost").value=m?.provider_cost??""; $("mPriority").value=m?.priority??100; $("mStatus").value=m?.provider_status||"active"; $("mActive").checked=m?.active!==false; $("mMeta").value=JSON.stringify(m?.metadata||{},null,2);
  $("modal").classList.remove("hidden");
  $("saveMapping").onclick=async()=>{try{
    let meta={}; try{meta=JSON.parse($("mMeta").value||"{}")}catch{throw Error("Invalid mapping metadata JSON.")};
    await admin({action:"save_mapping",id:m?.id,product_id:$("mProduct").value,provider_id:$("mProvider").value,endpoint_id:$("mEndpoint").value||null,provider_plan_id:$("mPlanId").value,provider_plan_name:$("mPlanName").value,provider_cost:$("mCost").value,priority:$("mPriority").value,provider_status:$("mStatus").value,active:$("mActive").checked,metadata:meta});
    $("modal").classList.add("hidden"); await loadMappings();
  }catch(err){msg($("modalMsg"),err.message,"error")}};
}
