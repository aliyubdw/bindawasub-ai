// Bindawasub Admin — services

async function loadServices(){
  try{
    const d=await admin({action:"list_services"}); services=d.services||[];
    $("serviceRows").innerHTML=services.filter(s=>catalogMode==="network"?isNetworkService(s):!isNetworkService(s)).map(s=>'<tr><td><strong>'+escapeHtml(s.name)+'</strong></td><td>'+escapeHtml(s.code)+'</td><td>'+escapeHtml(s.category||"—")+'</td><td><span class="badge '+(s.active?"on":"off")+'">'+(s.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editService(\''+s.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="5" class="muted">No services configured.</td></tr>';
    refreshServiceFieldServiceOptions();
    await loadProviderServices();
    await loadProviderServiceOperations();
    await loadServiceFields();
    await loadCatalogDimensions();
    setCatalogMode(catalogMode);
  }catch(e){msg($("serviceMsg"),e.message,"error")}
}

function isNetworkService(service){
  const code=String(service?.code||"").trim().toLowerCase();
  const name=String(service?.name||"").trim().toLowerCase();
  return code==="data" || code==="airtime" || name==="data" || name==="airtime" || code.includes("data") || code.includes("airtime");
}

function setCatalogMode(mode){
  catalogMode=mode==="other"?"other":"network";
  document.querySelectorAll("[data-catalog-mode]").forEach(button=>{
    const active=button.dataset.catalogMode===catalogMode;
    button.classList.toggle("active",active);
    button.setAttribute("aria-selected",active?"true":"false");
  });
  document.querySelectorAll("#services .card").forEach(card=>{
    const heading=card.querySelector(".section-title h2")?.textContent?.trim()||"";
    const networkOnly=heading==="Networks" || heading==="Service Variants / Channels";
    const routingCard=heading==="Provider Service Routing" || heading==="Provider Service Capabilities";
    card.style.display=(catalogMode==="other" && networkOnly)?"none":"";
    if(routingCard){
      const tableBody=card.querySelector("tbody");
      if(tableBody){
        const rows=Array.from(tableBody.querySelectorAll("tr"));
        rows.forEach(row=>{
          const serviceText=(row.children[1]?.textContent||"").trim().toLowerCase();
          const show=catalogMode==="network"
            ? (serviceText==="data"||serviceText==="airtime")
            : (serviceText!== "data" && serviceText!=="airtime");
          row.style.display=show?"":"none";
        });
      }
    }
  });
  renderServicesForCatalog();
  if(typeof renderProducts==="function") renderProducts();
}

function renderServicesForCatalog(){
  const rows=services.filter(s=>catalogMode==="network"?isNetworkService(s):!isNetworkService(s));
  $("serviceRows").innerHTML=rows.map(s=>`<tr><td><strong>${escapeHtml(s.name)}</strong></td><td>${escapeHtml(s.code)}</td><td>${escapeHtml(s.category||"—")}</td><td><span class="badge ${s.active?"on":"off"}">${s.active?"Active":"Inactive"}</span></td><td><button class="secondary" data-edit-service="${s.id}">Edit</button></td></tr>`).join("")||`<tr><td colspan="5" class="muted">No ${catalogMode==="network"?"network":"other"} services configured.</td></tr>`;
  document.querySelectorAll("[data-edit-service]").forEach(button=>{
    button.addEventListener("click",()=>window.editService(button.dataset.editService));
  });
}

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

async function loadCapabilityEndpoints(){
    const ps=providerServices.find(v=>v.id===$("psoService").value);
    if(!ps){$("psoEndpoint").innerHTML='<option value="">No provider service</option>';return;}
    const d=await admin({action:"list_endpoints",provider_id:ps.provider_id});
    const op=$("psoOperation").value.trim().toLowerCase();
    const eps=(d.endpoints||[]).filter(e=>e.service_type===ps.service_type && e.operation===op);
    $("psoEndpoint").innerHTML='<option value="">Select endpoint...</option>'+eps.map(e=>'<option value="'+e.id+'">'+escapeHtml((e.method||"")+" "+(e.path||""))+(e.active?"":" (inactive)")+'</option>').join("");
    $("psoEndpoint").value=x?.endpoint_id||"";
  }

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

async function loadProviderPurchaseEndpoints(){
    try{
      const d=await admin({action:"list_endpoints",provider_id:$("psProvider").value});
      const eps=(d.endpoints||[]).filter(e=>e.active&&e.operation==="purchase"&&e.service_type===$("psService").value);
      $("psEndpoint").innerHTML='<option value="">Automatic: first active purchase endpoint</option>'+eps.map(e=>'<option value="'+e.id+'">'+escapeHtml(e.method||"")+' '+escapeHtml(e.path||"")+'</option>').join("");
      $("psEndpoint").value=x?.endpoint_id||"";
    }catch(e){msg($("modalMsg"),e.message,"error")}
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
