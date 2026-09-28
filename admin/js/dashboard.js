let selectedCustomer=null, providers=[], products=[], networks=[], variants=[];

const $=id=>document.getElementById(id);
const money=n=>"₦"+Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});
function msg(el,text,type="info"){el.innerHTML=text?'<div class="msg '+type+'">'+escapeHtml(text)+'</div>':""}
function escapeHtml(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
async function loadOverview(){try{const d=await admin({action:"dashboard_summary"});const s=d.summary;$("mCustomers").textContent=s.customers;$("mProducts").textContent=s.products;$("mProviders").textContent=s.providers;$("mWallet").textContent=money(s.wallet_liability);$("mSales").textContent=money(s.sales);$("mProfit").textContent=money(s.profit);$("mSuccess").textContent=s.successful_transactions;$("mPending").textContent=s.pending_transactions;msg($("overviewMsg"),"Dashboard refreshed.","success")}catch(e){msg($("overviewMsg"),e.message,"error")}}

let services=[], providerServices=[];
async function loadServices(){
  try{
    const d=await admin({action:"list_services"}); services=d.services||[];
    $("serviceRows").innerHTML=services.map(s=>'<tr><td><strong>'+escapeHtml(s.name)+'</strong></td><td>'+escapeHtml(s.code)+'</td><td>'+escapeHtml(s.category||"—")+'</td><td><span class="badge '+(s.active?"on":"off")+'">'+(s.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editService(\''+s.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="5" class="muted">No services configured.</td></tr>';
    refreshServiceFieldServiceOptions();
    await loadProviderServices();
    await loadProviderServiceOperations();
    await loadServiceFields();
    await loadCatalogDimensions();
  }catch(e){msg($("serviceMsg"),e.message,"error")}
}
window.editService=id=>openService(services.find(s=>s.id===id)||null);
$("newService").onclick=()=>openService(null);
async function openService(s){
  $("modalTitle").textContent=s?"Edit Service":"Add Service";
  $("modalBody").innerHTML='<div class="grid2"><div class="field"><label>Service name *</label><input id="sName"></div><div class="field"><label>Service code *</label><input id="sCode" placeholder="e.g. electricity"></div><div class="field"><label>Category</label><input id="sCategory" placeholder="telecom, utilities, education"></div><div class="field"><label><input id="sActive" type="checkbox" style="width:auto" checked> Active</label></div></div><div class="field"><label>Description</label><textarea id="sDescription"></textarea></div><div class="field"><label>Metadata (JSON)</label><textarea id="sMetadata">{}</textarea></div><button id="saveService">Save Service</button>';
  $("sName").value=s?.name||"";$("sCode").value=s?.code||"";$("sCategory").value=s?.category||"";$("sDescription").value=s?.description||"";$("sActive").checked=s?.active!==false;$("sMetadata").value=JSON.stringify(s?.metadata||{},null,2);$("modal").classList.remove("hidden");
  $("saveService").onclick=async()=>{try{let metadata={};try{metadata=JSON.parse($("sMetadata").value||"{}")}catch{throw Error("Invalid service metadata JSON.")}await admin({action:"save_service",id:s?.id,name:$("sName").value,code:$("sCode").value,category:$("sCategory").value,description:$("sDescription").value,active:$("sActive").checked,metadata});$("modal").classList.add("hidden");await loadServices()}catch(e){msg($("modalMsg"),e.message,"error")}};
}
async function loadProviderServices(){
  const d=await admin({action:"list_provider_services"}); providerServices=d.provider_services||[];
  $("providerServiceRows").innerHTML=providerServices.map(x=>'<tr><td>'+escapeHtml(x.api_providers?.name||x.api_providers?.code||"—")+'</td><td>'+escapeHtml(x.service_type)+'</td><td>'+escapeHtml(x.priority)+'</td><td><span class="badge '+(x.enabled?"on":"off")+'">'+(x.enabled?"Enabled":"Disabled")+'</span></td><td><button class="secondary" onclick="editProviderService(\''+x.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="6" class="muted">No provider-service mappings.</td></tr>';
}
window.editProviderService=id=>openProviderService(providerServices.find(x=>x.id===id)||null);
let providerServiceOperations=[];
async function loadProviderServiceOperations(){
  providerServiceOperations=[];
  for(const ps of providerServices){
    try{
      const d=await admin({action:"list_provider_service_operations",provider_service_id:ps.id});
      for(const op of (d.operations||[])) providerServiceOperations.push({...op,provider_service:ps});
    }catch(e){msg($("providerServiceOperationMsg"),e.message,"error");}
  }
  $("providerServiceOperationRows").innerHTML=providerServiceOperations.map(x=>{
    const ep=x.api_endpoints||{};
    return '<tr><td>'+escapeHtml(x.provider_service?.api_providers?.name||"—")+'</td><td>'+escapeHtml(x.provider_service?.service_type||"—")+'</td><td><strong>'+escapeHtml(x.operation)+'</strong></td><td>'+escapeHtml((ep.method||"")+" "+(ep.path||""))+'</td><td>'+escapeHtml(x.priority)+'</td><td><span class="badge '+(x.active&&ep.active?"on":"off")+'">'+(x.active&&ep.active?"Active":"Disabled")+'</span></td><td><button class="secondary" onclick="editProviderServiceOperation(\''+x.id+'\')">Edit</button></td></tr>';
  }).join("")||'<tr><td colspan="7" class="muted">No provider service capabilities configured.</td></tr>';
}
window.editProviderServiceOperation=id=>openProviderServiceOperation(providerServiceOperations.find(x=>x.id===id)||null);
$("newProviderServiceOperation").onclick=()=>openProviderServiceOperation(null);
async function openProviderServiceOperation(x){
  $("modalTitle").textContent=x?"Edit Provider Service Capability":"Add Provider Service Capability";
  $("modalBody").innerHTML='<div class="grid2"><div class="field"><label>Provider Service *</label><select id="psoService"></select></div><div class="field"><label>Operation *</label><input id="psoOperation" placeholder="e.g. balance, status, catalog"></div><div class="field"><label>Endpoint *</label><select id="psoEndpoint"></select><div class="muted">Only endpoints for the selected provider/service and operation are shown.</div></div><div class="field"><label>Priority</label><input id="psoPriority" type="number" min="0" value="10"></div><div class="field"><label><input id="psoActive" type="checkbox" style="width:auto" checked> Active</label></div></div><div class="field"><label>Metadata (JSON)</label><textarea id="psoMetadata">{}</textarea></div><button id="saveProviderServiceOperation">Save Capability</button>';
  $("psoService").innerHTML=providerServices.map(ps=>'<option value="'+ps.id+'">'+escapeHtml(ps.api_providers?.name||ps.api_providers?.code||"—")+' → '+escapeHtml(ps.service_type)+'</option>').join("");
  $("psoService").value=x?.provider_service_id||providerServices[0]?.id||"";
  $("psoOperation").value=x?.operation||"";
  $("psoPriority").value=x?.priority??10;
  $("psoActive").checked=x?.active!==false;
  $("psoMetadata").value=JSON.stringify(x?.metadata||{},null,2);
  async function loadCapabilityEndpoints(){
    const ps=providerServices.find(v=>v.id===$("psoService").value);
    if(!ps){$("psoEndpoint").innerHTML='<option value="">No provider service</option>';return;}
    const d=await admin({action:"list_endpoints",provider_id:ps.provider_id});
    const op=$("psoOperation").value.trim().toLowerCase();
    const eps=(d.endpoints||[]).filter(e=>e.service_type===ps.service_type && e.operation===op);
    $("psoEndpoint").innerHTML='<option value="">Select endpoint...</option>'+eps.map(e=>'<option value="'+e.id+'">'+escapeHtml((e.method||"")+" "+(e.path||""))+(e.active?"":" (inactive)")+'</option>').join("");
    $("psoEndpoint").value=x?.endpoint_id||"";
  }
  $("psoService").onchange=loadCapabilityEndpoints;
  $("psoOperation").oninput=loadCapabilityEndpoints;
  $("modal").classList.remove("hidden"); await loadCapabilityEndpoints();
  $("saveProviderServiceOperation").onclick=async()=>{
    try{
      let metadata={};try{metadata=JSON.parse($("psoMetadata").value||"{}")}catch{throw Error("Invalid capability metadata JSON.")}
      await admin({action:"save_provider_service_operation",id:x?.id,provider_service_id:$("psoService").value,operation:$("psoOperation").value,endpoint_id:$("psoEndpoint").value,priority:$("psoPriority").value,active:$("psoActive").checked,metadata});
      $("modal").classList.add("hidden");await loadProviderServiceOperations();
    }catch(e){msg($("modalMsg"),e.message,"error")}
  };
}
$("newProviderService").onclick=()=>openProviderService(null);
async function openProviderService(x){
  $("modalTitle").textContent=x?"Edit Provider Service":"Add Provider Service";
  $("modalBody").innerHTML='<div class="grid2"><div class="field"><label>Provider</label><select id="psProvider">'+providers.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join("")+'</select></div><div class="field"><label>Service</label><select id="psService">'+services.map(s=>'<option value="'+s.code+'">'+escapeHtml(s.name)+' ('+escapeHtml(s.code)+')</option>').join("")+'</select></div><div class="field"><label>Purchase endpoint</label><select id="psEndpoint"><option value="">Automatic: first active purchase endpoint</option></select><div class="muted">Optional. Use this when a provider has multiple purchase endpoints for the same service.</div></div><div class="field"><label>Priority</label><input id="psPriority" type="number" min="0" value="100"></div><div class="field"><label><input id="psEnabled" type="checkbox" style="width:auto" checked> Enabled</label></div></div><div class="field"><label>Metadata (JSON)</label><textarea id="psMetadata">{}</textarea></div><button id="saveProviderService">Save Provider Service</button>';
  $("psProvider").value=x?.provider_id||providers[0]?.id||"";$("psService").value=x?.service_type||services[0]?.code||"";$("psPriority").value=x?.priority??100;$("psEnabled").checked=x?.enabled!==false;$("psMetadata").value=JSON.stringify(x?.metadata||{},null,2);
  async function loadProviderPurchaseEndpoints(){
    try{
      const d=await admin({action:"list_endpoints",provider_id:$("psProvider").value});
      const eps=(d.endpoints||[]).filter(e=>e.active&&e.operation==="purchase"&&e.service_type===$("psService").value);
      $("psEndpoint").innerHTML='<option value="">Automatic: first active purchase endpoint</option>'+eps.map(e=>'<option value="'+e.id+'">'+escapeHtml(e.method||"")+' '+escapeHtml(e.path||"")+'</option>').join("");
      $("psEndpoint").value=x?.endpoint_id||"";
    }catch(e){msg($("modalMsg"),e.message,"error")}
  }
  $("psProvider").onchange=loadProviderPurchaseEndpoints;$("psService").onchange=loadProviderPurchaseEndpoints;
  $("modal").classList.remove("hidden"); await loadProviderPurchaseEndpoints();
  $("saveProviderService").onclick=async()=>{try{let metadata={};try{metadata=JSON.parse($("psMetadata").value||"{}")}catch{throw Error("Invalid routing metadata JSON.")}await admin({action:"save_provider_service",id:x?.id,provider_id:$("psProvider").value,service_type:$("psService").value,endpoint_id:$("psEndpoint").value||null,priority:$("psPriority").value,enabled:$("psEnabled").checked,metadata});$("modal").classList.add("hidden");await loadProviderServices();await loadProviderServiceOperations()}catch(e){msg($("modalMsg"),e.message,"error")}};
}
async function loadServiceFields(){
  const serviceId=$("serviceFieldService").value;
  if(!serviceId){
    $("serviceFieldRows").innerHTML='<tr><td colspan="7" class="muted">Select a service first.</td></tr>';
    return;
  }
  try{
    const d=await admin({action:"list_service_fields",service_id:serviceId});
    serviceFields=d.fields||[];
    $("serviceFieldRows").innerHTML=serviceFields.map(f=>'<tr><td><code>'+escapeHtml(f.field_key)+'</code></td><td>'+escapeHtml(f.label)+'</td><td>'+escapeHtml(f.data_type)+'</td><td>'+(f.required?"Yes":"No")+'</td><td>'+(f.sensitive?"Yes":"No")+'</td><td><span class="badge '+(f.active?"on":"off")+'">'+(f.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editServiceField(\''+f.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="7" class="muted">No fields configured for this service.</td></tr>';
    msg($("serviceFieldMsg"),serviceFields.length+" field(s) loaded.","success");
  }catch(e){msg($("serviceFieldMsg"),e.message,"error")}
}
function refreshServiceFieldServiceOptions(){
  $("serviceFieldService").innerHTML='<option value="">Select service...</option>'+services.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+' ('+escapeHtml(s.code)+')</option>').join("");
}
$("serviceFieldService").onchange=loadServiceFields;
$("newServiceField").onclick=()=>openServiceField(null);
window.editServiceField=id=>openServiceField(serviceFields.find(f=>f.id===id)||null);
async function openServiceField(f){
  $("modalTitle").textContent=f?"Edit Service Field":"Add Service Field";
  $("modalBody").innerHTML='<div class="grid2"><div class="field"><label>Service *</label><select id="sfService"></select></div><div class="field"><label>Field key *</label><input id="sfKey" placeholder="e.g. meter_number"></div><div class="field"><label>Label *</label><input id="sfLabel" placeholder="e.g. Meter Number"></div><div class="field"><label>Type</label><select id="sfType"><option>text</option><option>number</option><option>phone</option><option>select</option><option>boolean</option><option>date</option></select></div><div class="field"><label>Display order</label><input id="sfOrder" type="number" min="0" value="100"></div><div class="field"><label><input id="sfRequired" type="checkbox" style="width:auto" checked> Required</label></div><div class="field"><label><input id="sfSensitive" type="checkbox" style="width:auto"> Sensitive</label></div><div class="field"><label><input id="sfActive" type="checkbox" style="width:auto" checked> Active</label></div></div><div class="field"><label>Validation (JSON)</label><textarea id="sfValidation">{}</textarea></div><div class="field"><label>Metadata / options (JSON)</label><textarea id="sfMetadata">{}</textarea></div><button id="saveServiceField">Save Service Field</button>';
  refreshServiceFieldServiceOptions();
  $("sfService").value=f?.service_id||$("serviceFieldService").value||"";
  $("sfKey").value=f?.field_key||"";$("sfLabel").value=f?.label||"";$("sfType").value=f?.data_type||"text";$("sfOrder").value=f?.display_order??100;$("sfRequired").checked=f?.required!==false;$("sfSensitive").checked=f?.sensitive===true;$("sfActive").checked=f?.active!==false;$("sfValidation").value=JSON.stringify(f?.validation||{},null,2);$("sfMetadata").value=JSON.stringify(f?.metadata||{},null,2);
  $("modal").classList.remove("hidden");
  $("saveServiceField").onclick=async()=>{try{
    let validation={},metadata={};try{validation=JSON.parse($("sfValidation").value||"{}");metadata=JSON.parse($("sfMetadata").value||"{}")}catch{throw Error("Invalid field JSON.")}
    await admin({action:"save_service_field",id:f?.id,service_id:$("sfService").value,field_key:$("sfKey").value,label:$("sfLabel").value,data_type:$("sfType").value,display_order:$("sfOrder").value,required:$("sfRequired").checked,sensitive:$("sfSensitive").checked,active:$("sfActive").checked,validation,metadata});
    $("modal").classList.add("hidden");refreshServiceFieldServiceOptions();await loadServiceFields();
  }catch(e){msg($("modalMsg"),e.message,"error")}};
}
async function loadProviders(){try{const d=await admin({action:"list_providers"});providers=d.providers||[];refreshEndpointProviderOptions();refreshMappingProductOptions();renderProviders();}catch(e){msg($("providerMsg"),e.message,"error")}}
function renderProviders(){ $("providerRows").innerHTML=providers.map(p=>'<tr><td><strong>'+escapeHtml(p.name)+'</strong></td><td>'+escapeHtml(p.code)+'</td><td>'+escapeHtml(p.base_url||"—")+'</td><td><span class="badge '+(p.status==="active"?"on":"off")+'">'+escapeHtml(p.status)+'</span></td><td>'+ (p.supports_webhook?"Yes":"No") +'</td><td>'+escapeHtml(p.api_secret_name||"—")+'<br><span class="muted">'+(p.credential_configured?"Vault configured":"Not configured")+'</span></td><td><button class="secondary" onclick="editProvider(\''+p.id+'\')">Edit</button> <button class="secondary" onclick="testProvider(\''+p.id+'\')">Test</button></td></tr>').join("")||'<tr><td colspan="7" class="muted">No providers added yet.</td></tr>'}
window.editProvider=id=>openProvider(providers.find(p=>p.id===id));
window.testProvider=async id=>{try{const r=await fetch(ADMIN_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await token()},body:JSON.stringify({action:"test_provider",provider_id:id})});const d=await r.json().catch(()=>({}));if(!r.ok){throw Error("HTTP "+r.status+": "+(d.error||d.message||JSON.stringify(d)||"Empty response"));}if(d.success===false){alert("Provider test: HTTP "+(d.http_status??"—")+"\n\n"+(d.error||d.message||JSON.stringify(d.response??d,null,2)));return;}alert("Provider test: HTTP "+(d.http_status??"—")+"\n\n"+JSON.stringify(d.response??d,null,2))}catch(e){alert("Provider test failed: "+e.message)}};
$("newProvider").onclick=()=>openProvider(null);
function openProvider(p){$("modalTitle").textContent=p?"Edit API Provider":"Add API Provider";$("modalBody").innerHTML='<div class="field"><label>Name</label><input id="pName" value="'+escapeHtml(p?.name||"")+'"></div><div class="grid2"><div class="field"><label>Code</label><input id="pCode" value="'+escapeHtml(p?.code||"")+'"></div><div class="field"><label>Status</label><select id="pStatus"><option>active</option><option>inactive</option><option>maintenance</option></select></div></div><div class="field"><label>Base URL</label><input id="pUrl" value="'+escapeHtml(p?.base_url||"")+'"></div><div class="grid2"><div class="field"><label>Credential name</label><input id="pSecret" value="'+escapeHtml(p?.api_secret_name||"provider_api_credentials")+'" placeholder="e.g. api_key"></div><div class="field"><label>Webhook secret name</label><input id="pWebhookSecret" value="'+escapeHtml(p?.webhook_secret_name||"")+'"></div></div><div class="field"><label>API key</label><div style="display:flex;gap:8px"><input id="pCredential" type="text" autocomplete="off" value="'+escapeHtml(p?.credential_mask||"")+'" placeholder="Paste provider API key"><button type="button" id="toggleCredential" class="secondary">Show</button></div><p class="muted">For an existing provider, this box shows a safe partial preview of the saved key. Leave it unchanged to keep the current Vault key, or paste a new key to replace it. It is stored encrypted in Supabase Vault. You do not need to enter JSON.</p></div><div class="field"><label><input id="pWebhook" type="checkbox" style="width:auto" '+(p?.supports_webhook?"checked":"")+'> Supports webhook</label></div><div class="field"><label>Notes</label><textarea id="pNotes">'+escapeHtml(p?.notes||"")+'</textarea></div><p class="muted">Credentials are stored encrypted in Supabase Vault. They are never returned to the dashboard after saving. Leave the credentials box empty when editing if you do not want to replace them.</p><button id="saveProvider">Save Provider</button>';$("pStatus").value=p?.status||"inactive";$("modal").classList.remove("hidden");$("toggleCredential").onclick=()=>{const i=$("pCredential");i.type=i.type==="password"?"text":"password";$("toggleCredential").textContent=i.type==="password"?"Show":"Hide"};$("saveProvider").onclick=async()=>{try{const enteredCredential=$("pCredential").value.trim();const savedMask=p?.credential_mask||"";const apiKey=(p?.id&&savedMask&&enteredCredential===savedMask)?"":enteredCredential;await admin({action:"save_provider",id:p?.id,name:$("pName").value,code:$("pCode").value,base_url:$("pUrl").value,status:$("pStatus").value,api_secret_name:$("pSecret").value,webhook_secret_name:$("pWebhookSecret").value,supports_webhook:$("pWebhook").checked,notes:$("pNotes").value,secret_value:apiKey||null});$("modal").classList.add("hidden");await loadProviders();await loadOverview()}catch(e){msg($("modalMsg"),e.message,"error")}}}

async function loadProducts(){try{const d=await admin({action:"list_products"});products=d.products||[];refreshMappingProductOptions();renderProducts()}catch(e){msg($("productMsg"),e.message,"error")}}
function renderProducts(){$("productRows").innerHTML=products.map(p=>'<tr><td><strong>'+escapeHtml(p.product_name)+'</strong><br><span class="muted">'+escapeHtml(p.sku||"")+'</span></td><td>'+escapeHtml(p.service_type)+'</td><td>'+escapeHtml(p.service_networks?.name||"—")+(p.service_variants?.name?' / '+escapeHtml(p.service_variants.name):"")+'</td><td>'+money(p.selling_price)+'</td><td>'+money(p.cost_price)+'</td><td>'+"Configured in mappings"+'</td><td><span class="badge '+(p.active?"on":"off")+'">'+(p.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editProduct(\''+p.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="8" class="muted">No products/plans.</td></tr>'}
window.editProduct=id=>openProduct(products.find(p=>p.id===id));$("newProduct").onclick=()=>openProduct(null);
async function openProduct(p){
  const opts=providers.map(x=>'<option value="'+x.id+'" '+(p?.provider_id===x.id?"selected":"")+'>'+escapeHtml(x.name)+'</option>').join("");
  $("modalTitle").textContent=p?"Edit Product / Plan":"Add Product / Plan";
  $("modalBody").innerHTML='<div class="grid2"><div class="field"><label>Product name</label><input id="xName"></div><div class="field"><label>SKU</label><input id="xSku"></div></div><div class="grid2"><div class="field"><label>Service type</label><select id="xService">'+services.map(s=>'<option value="'+s.code+'">'+escapeHtml(s.name)+'</option>').join("")+'</select></div><div class="field"><label>Network</label><select id="xNetwork"><option value="">— none —</option></select></div></div><div class="grid2"><div class="field"><label>Variant / channel</label><select id="xVariant"><option value="">— none —</option></select></div><div class="field"><label>Volume / amount</label><input id="xVolume" placeholder="e.g. 1 GB or ₦1000"></div></div><div class="grid2"><div class="field"><label>Validity type</label><select id="xValidityType"><option value="fixed">Fixed</option><option value="none">Not applicable</option><option value="unlimited">Unlimited</option><option value="dynamic">Dynamic</option></select></div><div class="field"><label>Validity value</label><input id="xValidityValue" type="number" min="0" step="0.01" placeholder="e.g. 30"></div></div><div class="field"><label>Validity unit</label><input id="xValidityUnit" placeholder="days, hours, months, years"></div><div class="grid2"><div class="field"><label>Display order</label><input id="xOrder" type="number"></div><div></div></div><div class="grid2"><div class="field"><label>Selling price (₦)</label><input id="xSell" type="number" min="0" step=".01"></div><div class="field"><label>Cost price (₦)</label><input id="xCost" type="number" min="0" step=".01"></div></div><div class="field"><label><input id="xActive" type="checkbox" style="width:auto"> Active</label></div><button id="saveProduct">Save Product / Plan</button>';
  $("xName").value=p?.product_name||"";$("xSku").value=p?.sku||"";$("xService").value=p?.service_type||services[0]?.code||"";$("xVolume").value=p?.volume||"";$("xValidityType").value=p?.validity_type||"fixed";$("xValidityValue").value=p?.validity_value??"";$("xValidityUnit").value=p?.validity_unit||"";$("xSell").value=p?.selling_price??"";$("xCost").value=p?.cost_price??"";$("xOrder").value=p?.display_order??100;$("xActive").checked=p?.active!==false;
  await populateProductDimensions(p?.network_id||"",p?.variant_id||"");
  $("xService").onchange=()=>populateProductDimensions("","");
  $("xNetwork").onchange=()=>populateProductVariants($("xService").value,$("xNetwork").value,"");
  $("modal").classList.remove("hidden");
  $("saveProduct").onclick=async()=>{try{await admin({action:"save_product",id:p?.id,product_name:$("xName").value,sku:$("xSku").value,service_type:$("xService").value,network_id:$("xNetwork").value||null,variant_id:$("xVariant").value||null,volume:$("xVolume").value,validity_type:$("xValidityType").value,validity_value:$("xValidityValue").value,validity_unit:$("xValidityUnit").value,selling_price:$("xSell").value,cost_price:$("xCost").value,display_order:$("xOrder").value,active:$("xActive").checked});$("modal").classList.add("hidden");await loadProducts()}catch(e){msg($("modalMsg"),e.message,"error")}};
}
async function populateProductDimensions(networkId="",variantId=""){
  const sid=$("xService").value;
  const ns=networks.filter(n=>n.service_id===sid);
  $("xNetwork").innerHTML='<option value="">— none —</option>'+ns.map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+'</option>').join("");
  $("xNetwork").value=networkId||"";
  await populateProductVariants(sid,$("xNetwork").value,variantId);
}
async function populateProductVariants(serviceId,networkId="",variantId=""){
  const vs=variants.filter(v=>v.service_id===serviceId && (!networkId||v.network_id===networkId));
  $("xVariant").innerHTML='<option value="">— none —</option>'+vs.map(v=>'<option value="'+v.id+'">'+escapeHtml(v.name)+'</option>').join("");
  $("xVariant").value=variantId||"";
}

async function loadCatalogDimensions(){
  try{
    const n=await admin({action:"list_service_networks"}); networks=n.networks||[];
    const v=await admin({action:"list_service_variants"}); variants=v.variants||[];
    refreshCatalogServiceOptions();
    renderNetworks();
    renderVariants();
  }catch(e){msg($("networkMsg"),e.message,"error");msg($("variantMsg"),e.message,"error")}
}
function refreshCatalogServiceOptions(){
  const opts='<option value="">All services</option>'+services.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join("");
  $("networkService").innerHTML=opts;
  $("variantService").innerHTML='<option value="">Select service</option>'+services.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join("");
  $("variantNetwork").innerHTML='<option value="">All networks</option>';
}
function renderNetworks(){
  const sid=$("networkService").value;
  const rows=networks.filter(n=>!sid||n.service_id===sid);
  $("networkRows").innerHTML=rows.map(n=>'<tr><td><strong>'+escapeHtml(n.name)+'</strong></td><td>'+escapeHtml(n.code)+'</td><td>'+escapeHtml(n.service_definitions?.name||"—")+'</td><td><span class="badge '+(n.active?"on":"off")+'">'+(n.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editNetwork(\''+n.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="5" class="muted">No networks configured.</td></tr>';
}
function renderVariants(){
  const sid=$("variantService").value, nid=$("variantNetwork").value;
  const rows=variants.filter(v=>(!sid||v.service_id===sid)&&(!nid||v.network_id===nid));
  $("variantRows").innerHTML=rows.map(v=>'<tr><td><strong>'+escapeHtml(v.name)+'</strong></td><td>'+escapeHtml(v.code)+'</td><td>'+escapeHtml(v.service_networks?.name||"All networks")+'</td><td>'+escapeHtml(v.service_definitions?.name||"—")+'</td><td><span class="badge '+(v.active?"on":"off")+'">'+(v.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editVariant(\''+v.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="6" class="muted">No variants configured.</td></tr>';
}
$("networkService").onchange=renderNetworks;
$("variantService").onchange=async()=>{const sid=$("variantService").value;$("variantNetwork").innerHTML='<option value="">All networks</option>'+networks.filter(n=>!sid||n.service_id===sid).map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+'</option>').join("");renderVariants()};
$("variantNetwork").onchange=renderVariants;
$("newNetwork").onclick=()=>openNetwork(null);
$("newVariant").onclick=()=>openVariant(null);
window.editNetwork=id=>openNetwork(networks.find(n=>n.id===id)||null);
window.editVariant=id=>openVariant(variants.find(v=>v.id===id)||null);
async function openNetwork(n){
  $("modalTitle").textContent=n?"Edit Network":"Add Network";
  $("modalBody").innerHTML='<div class="field"><label>Service *</label><select id="nService">'+services.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join("")+'</select></div><div class="grid2"><div class="field"><label>Network name *</label><input id="nName" placeholder="MTN"></div><div class="field"><label>Code *</label><input id="nCode" placeholder="mtn"></div></div><div class="field"><label><input id="nActive" type="checkbox" style="width:auto"> Active</label></div><button id="saveNetwork">Save Network</button>';
  $("nService").value=n?.service_id||services[0]?.id||"";$("nName").value=n?.name||"";$("nCode").value=n?.code||"";$("nActive").checked=n?.active!==false;$("modal").classList.remove("hidden");
  $("saveNetwork").onclick=async()=>{try{await admin({action:"save_service_network",id:n?.id,service_id:$("nService").value,name:$("nName").value,code:$("nCode").value,active:$("nActive").checked});$("modal").classList.add("hidden");await loadCatalogDimensions()}catch(e){msg($("modalMsg"),e.message,"error")}};
}
async function openVariant(v){
  $("modalTitle").textContent=v?"Edit Variant / Channel":"Add Variant / Channel";
  $("modalBody").innerHTML='<div class="field"><label>Service *</label><select id="vService">'+services.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join("")+'</select></div><div class="field"><label>Network</label><select id="vNetwork"><option value="">All networks for this service</option></select></div><div class="grid2"><div class="field"><label>Variant name *</label><input id="vName" placeholder="SME"></div><div class="field"><label>Code *</label><input id="vCode" placeholder="sme"></div></div><div class="field"><label>Description</label><textarea id="vDescription"></textarea></div><div class="field"><label><input id="vActive" type="checkbox" style="width:auto"> Active</label></div><button id="saveVariant">Save Variant</button>';
  $("vService").value=v?.service_id||services[0]?.id||"";
  const fill=()=>{$("vNetwork").innerHTML='<option value="">All networks for this service</option>'+networks.filter(n=>n.service_id===$("vService").value).map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+'</option>').join("");$("vNetwork").value=v?.network_id||""};
  fill();$("vService").onchange=fill;
  $("vName").value=v?.name||"";$("vCode").value=v?.code||"";$("vDescription").value=v?.description||"";$("vActive").checked=v?.active!==false;$("modal").classList.remove("hidden");
  $("saveVariant").onclick=async()=>{try{await admin({action:"save_service_variant",id:v?.id,service_id:$("vService").value,network_id:$("vNetwork").value||null,name:$("vName").value,code:$("vCode").value,description:$("vDescription").value,active:$("vActive").checked});$("modal").classList.add("hidden");await loadCatalogDimensions()}catch(e){msg($("modalMsg"),e.message,"error")}};
}

async function loadEndpoints(){try{
  const pid=$("endpointProvider").value;
  const d=await admin({action:"list_endpoints",provider_id:pid||null});
  const rows=d.endpoints||[]; window._endpoints=rows;
  $("endpointRows").innerHTML=rows.map(e=>'<tr><td>'+escapeHtml(e.service_type)+'</td><td>'+escapeHtml(e.operation)+'</td><td>'+escapeHtml(e.method)+'</td><td>'+escapeHtml(e.path)+'</td><td>'+e.timeout_ms+'ms</td><td>'+e.retry_count+'</td><td><span class="badge '+(e.active?"on":"off")+'">'+(e.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editEndpoint(\''+e.id+'\')">Edit</button><button class="secondary" onclick="previewEndpointAdmin(\''+e.id+'\')">Preview</button><button class="secondary" '+(e.operation==="purchase"||e.operation==="webhook"?"disabled":"")+' onclick="testEndpointAdmin(\''+e.id+'\')">Test</button><button class="secondary" onclick="validateMappingAdmin(\''+e.id+'\')">Validate</button></td></tr>').join("")||'<tr><td colspan="8" class="muted">No endpoints configured.</td></tr>';
}catch(e){msg($("endpointMsg"),e.message,"error")}}
function refreshEndpointProviderOptions(){
  $("endpointProvider").innerHTML='<option value="">All providers</option>'+providers.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join("");
}
window.editEndpoint=id=>openEndpoint(window._endpoints?.find(e=>e.id===id)||null);
$("newEndpoint").onclick=()=>openEndpoint(null);
$("endpointProvider").onchange=loadEndpoints;
async function openEndpoint(e){
  if(!$("endpointProvider").value && e) $("endpointProvider").value=e.provider_id;
  if(!e){window._endpoints=(await admin({action:"list_endpoints",provider_id:$("endpointProvider").value||null})).endpoints||[];}
  else window._endpoints=(await admin({action:"list_endpoints",provider_id:e.provider_id})).endpoints||[];
  e=e||null;
  $("modalTitle").textContent=e?"Edit API Endpoint":"Add API Endpoint";
  $("modalBody").innerHTML='<div class="grid2"><div class="field"><label>Provider</label><select id="eProvider">'+providers.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join("")+'</select></div><div class="field"><label>Service type</label><select id="eService">'+services.map(s=>'<option value="'+s.code+'">'+escapeHtml(s.name)+'</option>').join("")+'</select></div></div><div class="grid2"><div class="field"><label>Operation</label><select id="eOperation"><option value="purchase">Purchase</option><option value="status">Status</option><option value="balance">Balance</option><option value="catalog">Catalog</option><option value="webhook">Webhook</option><option value="other">Other</option></select></div><div class="field"><label>HTTP method</label><select id="eMethod"><option>POST</option><option>GET</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></div></div><div class="field"><label>Path</label><input id="ePath" placeholder="/api/v1/data"></div><div class="grid2"><div class="field"><label>Timeout (ms)</label><input id="eTimeout" type="number" min="1000" max="60000" value="15000"></div><div class="field"><label>Retries</label><input id="eRetry" type="number" min="0" max="5" value="0"></div></div><div class="field"><label>Headers template (JSON)</label><textarea id="eHeaders">{}</textarea></div><div class="field"><label>Request template (JSON)</label><textarea id="eRequest">{}</textarea></div><div class="field"><label>Response mapping (JSON)</label><textarea id="eResponse">{}</textarea></div><p class="muted">Failure routing: use <code>safe_failure_values</code> only for statuses that confirm the provider did not process the purchase; use <code>ambiguous_values</code> for unknown/uncertain outcomes. Unknown statuses are treated as ambiguous and will never trigger failover.</p><div class="field"><label><input id="eActive" type="checkbox" style="width:auto" checked> Active</label></div><button id="saveEndpoint">Save Endpoint</button><p class="muted">Use controlled placeholders such as <code>{{phone}}</code>, <code>{{provider_plan_id}}</code>, <code>{{amount}}</code> in the request template. The execution engine will interpret these mappings later.</p>';
  $("eProvider").value=e?.provider_id||$("endpointProvider").value||"";
  $("eService").value=e?.service_type||services[0]?.code||""; $("eOperation").value=e?.operation||"purchase"; $("eMethod").value=e?.method||"POST";
  $("ePath").value=e?.path||""; $("eTimeout").value=e?.timeout_ms??15000; $("eRetry").value=e?.retry_count??0;
  $("eHeaders").value=JSON.stringify(e?.headers_template||{},null,2); $("eRequest").value=JSON.stringify(e?.request_template||{},null,2); $("eResponse").value=JSON.stringify(e?.response_mapping||{},null,2); $("eActive").checked=e?.active!==false;
  $("modal").classList.remove("hidden");
  $("saveEndpoint").onclick=async()=>{try{
    const parseJson=id=>{try{return JSON.parse($(id).value||"{}")}catch{throw Error("Invalid JSON in "+id)}};
    await admin({action:"save_endpoint",id:e?.id,provider_id:$("eProvider").value,service_type:$("eService").value,operation:$("eOperation").value,method:$("eMethod").value,path:$("ePath").value,timeout_ms:$("eTimeout").value,retry_count:$("eRetry").value,headers_template:parseJson("eHeaders"),request_template:parseJson("eRequest"),response_mapping:parseJson("eResponse"),active:$("eActive").checked});
    $("modal").classList.add("hidden"); await loadEndpoints();
  }catch(err){msg($("modalMsg"),err.message,"error")}};
}


async function endpointToolCall(action,id){
  try{
    const d=await admin({action,endpoint_id:id});
    $("modalTitle").textContent=action==="preview_endpoint"?"Endpoint Preview":action==="test_endpoint"?"Endpoint Test":"Response Mapping Validation";
    const pretty=v=>escapeHtml(JSON.stringify(v??{},null,2));
    let html="";
    if(action==="validate_response_mapping"){
      html='<div class="msg '+(d.valid?"success":"error")+'">'+(d.valid?"Mapping is valid.":"Mapping needs attention.")+'</div>';
      if((d.errors||[]).length) html+='<p><strong>Errors</strong></p><ul>'+d.errors.map(x=>'<li>'+escapeHtml(x)+'</li>').join("")+'</ul>';
      if((d.warnings||[]).length) html+='<p><strong>Warnings</strong></p><ul>'+d.warnings.map(x=>'<li>'+escapeHtml(x)+'</li>').join("")+'</ul>';
    }else if(action==="preview_endpoint"){
      html='<div class="msg info">PREVIEW ONLY — no provider request was sent.</div><p><strong>Provider:</strong> '+escapeHtml(d.provider?.name||"—")+'</p><p><strong>Endpoint:</strong> '+escapeHtml((d.endpoint?.method||"")+" "+(d.endpoint?.url||""))+'</p><p><strong>Headers</strong></p><pre>'+pretty(d.headers)+'</pre><p><strong>Request</strong></p><pre>'+pretty(d.request)+'</pre><p><strong>Response mapping</strong></p><pre>'+pretty(d.response_mapping)+'</pre>';
    }else{
      html='<div class="msg success">LIVE NON-PURCHASE TEST — no purchase request was sent.</div><p><strong>Provider:</strong> '+escapeHtml(d.provider?.name||"—")+'</p><p><strong>Operation:</strong> '+escapeHtml(d.operation||"—")+'</p><p><strong>HTTP:</strong> '+escapeHtml(String(d.http?.status??"—"))+' · '+escapeHtml(String(d.http?.response_time_ms??"—"))+' ms</p><p><strong>Auth:</strong> '+escapeHtml(d.auth?.masked||"not present")+'</p><p><strong>Response</strong></p><pre>'+pretty(d.response)+'</pre><p><strong>Response mapping</strong></p><pre>'+pretty(d.response_mapping)+'</pre>';
    }
    $("modalBody").innerHTML=html;
    $("modal").classList.remove("hidden");
  }catch(e){msg($("endpointMsg"),e.message,"error")}
}
window.previewEndpointAdmin=id=>endpointToolCall("preview_endpoint",id);
window.testEndpointAdmin=id=>endpointToolCall("test_endpoint",id);
window.validateMappingAdmin=id=>endpointToolCall("validate_response_mapping",id);

async function loadMappings(){try{
  const pid=$("mappingProduct").value;
  const d=await admin({action:"list_mappings",product_id:pid||null});
  const rows=d.mappings||[]; window._mappings=rows;
  $("mappingRows").innerHTML=rows.map(m=>'<tr><td>'+escapeHtml(m.products?.product_name||"—")+'<br><span class="muted">'+escapeHtml(m.products?.sku||"")+'</span></td><td>'+escapeHtml(m.api_providers?.name||"—")+'</td><td><strong>'+escapeHtml(m.provider_plan_id)+'</strong></td><td>'+escapeHtml(m.api_endpoints?.operation||"Auto")+'</td><td>'+money(m.provider_cost)+'</td><td>'+m.priority+'</td><td>'+escapeHtml(m.provider_status)+'</td><td><span class="badge '+(m.active?"on":"off")+'">'+(m.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editMapping(\''+m.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="9" class="muted">No provider Plan IDs configured.</td></tr>';
}catch(e){msg($("mappingMsg"),e.message,"error")}}
function refreshMappingProductOptions(){
  $("mappingProduct").innerHTML='<option value="">All products</option>'+products.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.product_name)+' — '+escapeHtml(p.network||"")+'</option>').join("");
}
$("mappingProduct").onchange=loadMappings;
$("newMapping").onclick=()=>openMapping(null);
window.editMapping=id=>openMapping(window._mappings?.find(m=>m.id===id)||null);
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


async function executeTransaction(id){
  if(!confirm("Execute this pending transaction with the configured provider?\n\nThis will send the purchase request. It will NOT debit the wallet again."))return;
  try{
    const r=await fetch(ADMIN_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await token()},body:JSON.stringify({action:"execute_purchase",transaction_id:id})});
    const raw=await r.text(); let d={}; try{d=raw?JSON.parse(raw):{}}catch{}
    if(!r.ok||d.success===false&&d.status!=="pending")throw Error("HTTP "+r.status+": "+(d.error||d.message||raw||"Empty response"));
    const text=d.status==="successful"?"Provider confirmed the purchase successfully.":d.status==="failed"?"Provider reported failure. The transaction was finalized and the wallet was refunded.":d.message||"Transaction remains pending; no duplicate purchase will be sent automatically.";
    msg($("transactionMsg"),text,d.status==="failed"?"error":"success"); await loadTransactions(); await loadOverview();
  }catch(e){msg($("transactionMsg"),"Execute failed: "+(e?.message||String(e)),"error")}
}
window.executeTransaction=executeTransaction;

async function requeryTransaction(id){
  if(!confirm("Re-query this pending transaction with the provider? No purchase/retry request will be sent."))return;
  try{
    const r=await fetch(EXECUTION_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await token()},body:JSON.stringify({action:"requery_transaction",transaction_id:id})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.success===false&&d.status!=="pending")throw Error(d.error||d.message||"Requery failed.");
    msg($("transactionMsg"),d.status==="successful"?"Provider confirmed delivery and the transaction was finalized.":d.status==="failed"?"Provider reported failure and the transaction was finalized/refunded.":d.message||"Transaction remains pending.","success");
    await loadTransactions();
    await loadOverview();
    if(d.status==="successful"||d.status==="failed"){
      $("modal").classList.add("hidden");
    }
  }catch(e){msg($("transactionMsg"),e.message,"error")}
}

async function dryRunTransaction(id){
  try{
    const r=await fetch(EXECUTION_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await token()},body:JSON.stringify({action:"dry_run_purchase",transaction_id:id})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.success===false)throw Error(d.error||d.message||"Dry run failed.");
    const ep=d.endpoint||{};
    $("modalTitle").textContent="🧪 Provider Dry Run";
    $("modalBody").innerHTML='<div class="msg info">DRY RUN ONLY — no provider request was sent and no transaction or wallet state was changed.</div>'+
      '<div class="card" style="background:#f7faf8">'+
      '<p><strong>Provider</strong><br>'+escapeHtml(d.provider||"—")+'</p>'+
      '<p><strong>Endpoint</strong><br>'+escapeHtml((ep.method||"")+" "+(ep.url||""))+'</p>'+
      '<p><strong>Headers</strong></p><pre style="white-space:pre-wrap;word-break:break-word">'+escapeHtml(JSON.stringify(ep.headers||{},null,2))+'</pre>'+
      '<p><strong>Request body</strong></p><pre style="white-space:pre-wrap;word-break:break-word">'+escapeHtml(JSON.stringify(ep.request||{},null,2))+'</pre>'+
      '<p><strong>Provider plan</strong><br>'+escapeHtml((d.mapping&&d.mapping.provider_plan_id)||"—")+'</p>'+
      '</div>';
    $("modal").classList.remove("hidden");
  }catch(e){msg($("transactionMsg"),"Dry run failed: "+e.message,"error")}
}
window.dryRunTransaction=dryRunTransaction;

async function runReliabilityTest(){
  const btn=$("runReliabilityTest");
  try{
    btn.disabled=true;
    btn.textContent="Running…";
    msg($("reliabilityMsg"),"Running synthetic database concurrency tests…","info");
    const r=await fetch(RELIABILITY_TEST_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer "+await token()
      },
      body:JSON.stringify({})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.success===false) throw Error(d.error||d.message||("HTTP "+r.status));
    const tests=d.tests||{};
    const claim=tests.claim||tests.concurrent_claim||{};
    const idem=tests.idempotency||tests.duplicate_idempotency||{};
    const passed=d.success===true;
    $("reliabilityResult").innerHTML=
      '<div class="msg '+(passed?"success":"error")+'"><strong>'+(passed?"ALL REPORTED TESTS PASSED":"TESTS NEED ATTENTION")+'</strong></div>'+
      '<div class="grid2">'+
      '<div class="card" style="background:#f7faf8"><strong>Concurrent claim</strong><p class="muted">'+escapeHtml(JSON.stringify(claim,null,2))+'</p></div>'+
      '<div class="card" style="background:#f7faf8"><strong>Idempotency</strong><p class="muted">'+escapeHtml(JSON.stringify(idem,null,2))+'</p></div>'+
      '</div>'+
      '<div class="card" style="background:#f7faf8"><strong>Safety checks</strong><p>Provider requests sent: <strong>'+escapeHtml(String(d.provider_requests_sent??0))+'</strong><br>Wallet debits: <strong>'+escapeHtml(String(d.wallet_debits??0))+'</strong><br>Real customer transactions changed: <strong>'+escapeHtml(String(d.real_customer_transactions_changed??0))+'</strong></p></div>'+
      '<details><summary>Full test result</summary><pre style="white-space:pre-wrap;word-break:break-word">'+escapeHtml(JSON.stringify(d,null,2))+'</pre></details>';
    msg($("reliabilityMsg"),"Reliability test completed. Review the results below.","success");
  }catch(e){
    $("reliabilityResult").innerHTML='<div class="msg error">'+escapeHtml(e.message)+'</div>';
    msg($("reliabilityMsg"),"Reliability test failed to run.","error");
  }finally{
    btn.disabled=false;
    btn.textContent="Run Test";
  }
}
$("runReliabilityTest").onclick=runReliabilityTest;

window.requeryTransaction=requeryTransaction;
async function loadTransactions(){
  try{
    const d=await admin({action:"list_transactions",status:$("transactionStatus").value,search:$("transactionSearch").value.trim(),limit:100});
    const rows=d.transactions||[];
    $("transactionRows").innerHTML=rows.map(t=>{
      const product=t.products?.product_name||"—";
      const customer=t.users?.name||t.users?.phone||"—";
      const status=t.status||"pending";
      return '<tr><td><code>'+escapeHtml(t.id)+'</code></td><td><span class="badge">'+escapeHtml(t.source||"web")+'</span></td><td><strong>'+escapeHtml(t.users?.name||"—")+'</strong><br><span class="muted">'+escapeHtml(t.users?.phone||t.phone_number||"—")+'</span></td><td>'+money(t.amount)+'</td><td title="'+escapeHtml(t.description||"")+'">'+escapeHtml(t.description||"—")+'</td><td><span class="badge '+(status==="successful"?"on":status==="failed"||status==="reversed"?"off":"")+'">'+escapeHtml(status)+'</span></td><td>'+money(t.balance_before)+'</td><td>'+money(t.balance_after)+'</td><td><button class="secondary" onclick="viewTransaction(\''+t.id+'\')">View</button> '+(status==="pending"&&t.provider_reference?'<button onclick="requeryTransaction(\''+t.id+'\')">Requery</button>':"")+(status==="pending"?' '+(!t.provider_reference?'<button onclick="executeTransaction(\''+t.id+'\')">Execute</button>': '<button onclick="requeryTransaction(\''+t.id+'\')">Requery</button>')+'<button onclick="manualTransactionUpdate(\''+t.id+'\',\'successful\')">Success</button><button class="danger" onclick="manualTransactionUpdate(\''+t.id+'\',\'failed\')">Failed</button><button class="secondary" onclick="manualTransactionUpdate(\''+t.id+'\',\'refunded\')">Refund</button><button class="secondary" onclick="dryRunTransaction(\''+t.id+'\')">🧪 Dry Run</button>':"")+'</td></tr>';
    }).join("")||'<tr><td colspan="9" class="muted">No transactions found.</td></tr>';
    window._transactions=rows;
    msg($("transactionMsg"),rows.length+" transaction(s) loaded.","success");
  }catch(e){msg($("transactionMsg"),e.message,"error")}
}
async function manualTransactionUpdate(id,action){
  const labels={successful:"Success",failed:"Failed",refunded:"Refund"};
  const label=labels[action]||action;
  const defaultText=action==="refunded"?"Transaction manually refunded by admin.":action==="failed"?"Transaction manually marked failed by admin. Wallet refunded.":"Transaction manually marked successful by admin.";
  const description=prompt("Transaction description:",defaultText);
  if(description===null)return;
  if(!confirm("Mark this pending transaction as "+label+"?"+(action==="failed"||action==="refunded"?"\\n\\nThe customer wallet will be refunded.":"")))return;
  try{
    const d=await admin({action:"manual_transaction_update",transaction_id:id,manual_action:action,description});
    if(!d.success)throw Error(d.error||"Manual update failed.");
    msg($("transactionMsg"),"Transaction updated: "+label+(d.refund_reference?" — "+d.refund_reference:""),"success");
    await loadTransactions(); await loadOverview();
  }catch(e){msg($("transactionMsg"),e.message,"error")}
}
window.manualTransactionUpdate=manualTransactionUpdate;
async function viewTransaction(id){
  const t=(window._transactions||[]).find(x=>x.id===id);
  if(!t)return;
  const p=t.products||{}, u=t.users||{};
  $("modalTitle").textContent="Transaction Details";
  $("modalBody").innerHTML='<div class="grid2"><div><p><strong>Transaction ID</strong><br><code>'+escapeHtml(t.id)+'</code></p><p><strong>Source</strong><br><span class="badge">'+escapeHtml(t.source||"web")+'</span></p><p><strong>Status</strong><br>'+escapeHtml(t.status)+'</p><p><strong>User</strong><br>'+escapeHtml(u.name||"—")+'<br>'+escapeHtml(u.phone||t.phone_number||"—")+'<br>'+escapeHtml(u.email||"")+'</p></div><div><p><strong>Product</strong><br>'+escapeHtml(p.product_name||"—")+'</p><p><strong>Amount</strong><br>'+money(t.amount)+'</p><p><strong>Cost / Profit</strong><br>'+money(t.cost)+" / "+money(t.profit)+'</p><p><strong>Balance Before</strong><br>'+money(t.balance_before)+'</p><p><strong>Balance After</strong><br>'+money(t.balance_after)+'</p></div></div><div class="card" style="background:#f7faf8"><p><strong>Provider</strong><br>'+escapeHtml(t.provider||"—")+'<br>'+escapeHtml(t.provider_reference||"No provider reference")+'</p><p><strong>Description</strong><br>'+escapeHtml(t.description||"—")+'</p><p><strong>Recipient</strong><br>'+escapeHtml(t.phone_number||"—")+'</p></div><div class="card" style="background:#f7faf8"><p><strong>Current API Response</strong></p><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:12px">'+escapeHtml(t.api_response?JSON.stringify(t.api_response,null,2):"No API response saved.")+'</pre></div><div class="card" style="background:#f7faf8"><p><strong>Timeline / Audit Trail</strong></p><div id="transactionTimeline"><span class="muted">Loading timeline…</span></div></div><div class="card" style="background:#f7faf8"><p><strong>Created:</strong> '+escapeHtml(new Date(t.created_at).toLocaleString())+'</p><p><strong>Completed:</strong> '+escapeHtml(t.completed_at?new Date(t.completed_at).toLocaleString():"Not completed")+'</p></div>';
  $("modal").classList.remove("hidden");
  try{
    const d=await admin({action:"transaction_events",transaction_id:id});
    const events=d.events||[];
    $("transactionTimeline").innerHTML=events.length?'<div class="timeline">'+events.map(ev=>{
      const actor=ev.actor_type==="admin"?"Admin":ev.actor_type==="provider"?"Provider":"System";
      const meta=[actor,ev.provider,ev.provider_reference].filter(Boolean).join(" • ");
      const response=ev.api_response?'<details><summary>API response</summary><pre>'+escapeHtml(JSON.stringify(ev.api_response,null,2))+'</pre></details>':"";
      const balances=(ev.balance_before!=null||ev.balance_after!=null)?'<div class="muted">Balance: '+money(ev.balance_before)+' → '+money(ev.balance_after)+'</div>':"";
      return '<div class="event"><h4>'+escapeHtml(ev.title)+'</h4><small>'+escapeHtml(new Date(ev.created_at).toLocaleString())+' • '+escapeHtml(meta)+'</small><p>'+escapeHtml(ev.description||"")+'</p>'+balances+response+'</div>';
    }).join("")+'</div>':'<p class="muted">No persisted audit events yet. New transactions will record their lifecycle here.</p>';
  }catch(e){
    $("transactionTimeline").innerHTML='<div class="msg error">'+escapeHtml(e.message)+'</div>';
  }
}
window.viewTransaction=viewTransaction;
$("transactionStatus").onchange=loadTransactions;
$("refreshTransactions").onclick=loadTransactions;
$("transactionSearch").addEventListener("keydown",e=>{if(e.key==="Enter")loadTransactions()});

async function loadAnalytics(){try{const d=await admin({action:"analytics",days:$("analyticsDays").value});const rows=d.series||[];$("analyticsRows").innerHTML=rows.slice().reverse().map(x=>'<tr><td>'+escapeHtml(x.date)+'</td><td>'+money(x.sales)+'</td><td>'+money(x.profit)+'</td><td>'+x.transactions+'</td><td>'+x.successful+'</td><td>'+x.failed+'</td><td>'+money(x.funding)+'</td><td>'+x.new_customers+'</td></tr>').join("")||'<tr><td colspan="8" class="muted">No activity in this period.</td></tr>';drawChart("salesChart",rows.map(x=>x.sales));drawChart("profitChart",rows.map(x=>x.profit));msg($("analyticsMsg"),"Analytics refreshed.","success")}catch(e){msg($("analyticsMsg"),e.message,"error")}}
function drawChart(id,values){const max=Math.max(...values,1);$(id).innerHTML=values.slice(-60).map((v,i)=>'<div class="bar" title="'+money(v)+'" style="height:'+Math.max(3,(Number(v)/max)*160)+'px"><span>'+((i+1)%5===0?i+1:"")+'</span></div>').join("")||'<span class="muted">No data</span>'}

async function searchCustomers(){try{const d=await aiAdmin({action:"customer_search",search:$("customerSearch").value.trim()});const rows=d.customers||[];$("customerRows").innerHTML=rows.map(c=>'<div class="card" style="padding:11px;margin:8px 0;cursor:pointer" onclick="selectCustomer('+escapeHtml(JSON.stringify(c))+')"><strong>'+escapeHtml(c.name||"Unnamed")+'</strong><br><span class="muted">'+escapeHtml(c.phone||"")+'</span></div>').join("")||'<p class="muted">No customer found.</p>'}catch(e){msg($("searchMsg"),e.message,"error")}}
window.selectCustomer=c=>{selectedCustomer=c;$("selectedCustomer").value=(c.name||"Unnamed")+" — "+(c.phone||"");$("fundWallet").disabled=false};
$("searchCustomer").onclick=searchCustomers;
$("fundWallet").onclick=async()=>{try{if(!selectedCustomer)throw Error("Select a customer first.");const amount=Number($("fundAmount").value);if(!(amount>0))throw Error("Enter a valid amount.");const reference="FUND-"+Date.now()+"-"+Math.random().toString(36).slice(2,8).toUpperCase();if(!confirm("Fund "+(selectedCustomer.name||"customer")+" with "+money(amount)+"?"))return;await aiAdmin({action:"manual_fund",customer_user_id:selectedCustomer.id,amount,reference,note:$("fundNote").value.trim()||null});msg($("fundMsg"),"Wallet funded successfully. Reference: "+reference,"success");$("fundAmount").value="";$("fundNote").value=""}catch(e){msg($("fundMsg"),e.message,"error")}};
$("resetBtn").onclick=async()=>{try{const email=$("resetEmail").value.trim(),password=$("resetPassword").value;if(password.length<8)throw Error("Password must be at least 8 characters.");if(!confirm("Reset this customer's password?"))return;const r=await fetch(RESET_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await token()},body:JSON.stringify({email,password})});const d=await r.json();if(!r.ok||d.success===false)throw Error(d.error||"Reset failed.");msg($("resetMsg"),"Password reset successfully.","success");$("resetPassword").value=""}catch(e){msg($("resetMsg"),e.message,"error")}};

$("refreshOverview").onclick=loadOverview;$("refreshAnalytics").onclick=loadAnalytics;$("analyticsDays").onchange=loadAnalytics;$("closeModal").onclick=()=>$("modal").classList.add("hidden");$("modal").addEventListener("click",e=>{if(e.target===$("modal"))$("modal").classList.add("hidden")});

async function loadAiManagement(){try{const s=await aiAdmin({action:"ai_summary"});const x=s.summary||{};$("aiConversations").textContent=x.conversations??0;$("aiMessages").textContent=x.messages??0;$("aiActivity").textContent=x.activity_events??0;$("aiSuccess").textContent=x.successful_purchases??0;$("aiFailed").textContent=x.failed_purchases??0;$("aiPending").textContent=x.pending_purchases??0;const d=await aiAdmin({action:"ai_settings_get"});const a=d.settings||{};$("aiEnabled").checked=!!a.enabled;$("aiGemini").checked=!!a.gemini_enabled;$("aiConfirm").checked=!!a.require_purchase_confirmation;$("aiMaxPurchase").value=a.max_purchase_amount??10000;$("aiLanguage").value=a.default_language||"english";$("aiChannels").value=Array.isArray(a.allowed_channels)?a.allowed_channels.join(", "):"";$("aiFallback").value=a.fallback_message||"";msg($("aiMsg"),"AI management refreshed.","success")}catch(e){msg($("aiMsg"),e.message,"error")}}
$("refreshAi").onclick=loadAiManagement;
$("saveAiSettings").onclick=async()=>{try{const channels=$("aiChannels").value.split(",").map(x=>x.trim()).filter(Boolean);const d=await aiAdmin({action:"ai_settings_save",settings:{enabled:$("aiEnabled").checked,gemini_enabled:$("aiGemini").checked,require_purchase_confirmation:$("aiConfirm").checked,max_purchase_amount:Number($("aiMaxPurchase").value),default_language:$("aiLanguage").value,allowed_channels:channels,fallback_message:$("aiFallback").value}});msg($("aiSettingsMsg"),d.success?"AI settings saved successfully.":"Save failed.",d.success?"success":"error")}catch(e){msg($("aiSettingsMsg"),e.message,"error")}};
async function loadManualFundingSettings(){
  const d=await aiAdmin({action:"manual_funding_settings_get"});
  const s=d.settings||{};
  $("mfBankName").value=s.bank_name||"";
  $("mfAccountName").value=s.account_name||"";
  $("mfAccountNumber").value=s.account_number||"";
  $("mfInstructions").value=s.instructions||"";
  $("mfActive").value=s.active===false?"false":"true";
}
async function loadManualFundingRequests(){
  try{
    // Load the complete manual-funding history for admin, not only submitted requests.
    const statuses=["pending","submitted","approved","rejected"];
    const results=await Promise.all(statuses.map(status=>admin({action:"manual_funding_requests",status})));
    const byId=new Map();
    results.forEach(d=>(d.requests||[]).forEach(r=>byId.set(r.id,r)));
    const rows=Array.from(byId.values()).sort((a,b)=>{
      const da=new Date(a.created_at||a.submitted_at||0).getTime();
      const db=new Date(b.created_at||b.submitted_at||0).getTime();
      return db-da;
    });
    $("manualFundingRows").innerHTML=rows.map(r=>{
      const u=r.users||r.user||{};
      const customer=u.name||u.phone||r.user_id||"—";
      const submitted=r.submitted_at?r.submitted_at.replace("T"," ").replace("Z",""):(r.created_at?r.created_at.replace("T"," ").replace("Z",""):"—");
      const status=r.status||"—";
      const statusClass=status==="approved"?"on":status==="rejected"?"off":"";
      const reason=r.note||r.rejection_reason||"—";
      const reviewed=r.reviewed_at?r.reviewed_at.replace("T"," ").replace("Z",""):"—";
      const action=(status==="pending"||status==="submitted")
        ? '<button onclick="approveManualFunding(\''+r.id+'\')">Approve</button> <button class="danger" onclick="rejectManualFunding(\''+r.id+'\')">Reject</button>'
        : '<span class="muted">Reviewed</span>';
      return '<tr><td><strong>'+escapeHtml(customer)+'</strong><br><span class="muted">'+escapeHtml(u.phone||u.email||"")+'</span></td><td>'+money(r.amount)+'</td><td><code>'+escapeHtml(r.reference||"—")+'</code></td><td><code>'+escapeHtml(r.payment_reference||"—")+'</code></td><td>'+escapeHtml(submitted)+'</td><td><span class="badge '+statusClass+'">'+escapeHtml(status)+'</span></td><td>'+escapeHtml(reason)+'</td><td>'+escapeHtml(reviewed)+'</td><td>'+action+'</td></tr>';
    }).join("")||'<tr><td colspan="9" class="muted">No funding history found.</td></tr>';
    msg($("manualFundingMsg"),rows.length+" funding request(s) in history.","success");
  }catch(e){msg($("manualFundingMsg"),e.message,"error")}
}
async function approveManualFunding(id){
  if(!confirm("Approve this funding request and credit the customer's wallet?"))return;
  try{
    const d=await admin({action:"manual_funding_approve",request_id:id});
    msg($("manualFundingMsg"),d.answer||"Funding approved and wallet credited.","success");
    await loadManualFundingRequests(); await loadOverview();
  }catch(e){msg($("manualFundingMsg"),e.message,"error")}
}
async function rejectManualFunding(id){
  const note=prompt("Reason for rejection:","");
  if(note===null)return;
  try{
    const d=await admin({action:"manual_funding_reject",request_id:id,note});
    msg($("manualFundingMsg"),d.answer||"Funding request rejected.","success");
    await loadManualFundingRequests();
  }catch(e){msg($("manualFundingMsg"),e.message,"error")}
}
$("refreshManualFunding").onclick=async()=>{await loadManualFundingRequests()};
$("saveManualFunding").onclick=async()=>{
  try{
    const d=await aiAdmin({action:"manual_funding_settings_save",settings:{active:$("mfActive").value==="true",bank_name:$("mfBankName").value.trim(),account_name:$("mfAccountName").value.trim(),account_number:$("mfAccountNumber").value.trim(),instructions:$("mfInstructions").value.trim()}});
    msg($("manualFundingMsg"),d.answer||"Funding details saved.","success");
  }catch(e){msg($("manualFundingMsg"),e.message,"error")}
};
