// Bindawasub Admin — products

let providerMappings=[];

async function loadProducts(){try{
  const [d,m]=await Promise.all([
    admin({action:"list_products"}),
    admin({action:"list_mappings"})
  ]);
  products=d.products||[];
  providerMappings=m.mappings||[];
  refreshMappingProductOptions();
  renderProducts();
}catch(e){msg($("productMsg"),e.message,"error")}}

function renderProducts(){
  const networkFilter=$("dataPlanNetworkFilter")?.value||"";
  const visibleProducts=products.filter(p=>{
    const networkService=isNetworkService({code:p.service_type,name:p.service_type});
    if(productsCatalogMode==="network"&&!networkService)return false;
    if(productsCatalogMode==="other"&&networkService)return false;
    if(productsCatalogMode==="network"&&String(p.service_type||"").toLowerCase()!=="data")return false;
    if(networkFilter&&p.network_id!==networkFilter)return false;
    return true;
  });
  $("productRows").innerHTML=visibleProducts.map(p=>{
    const network=p.service_networks||{};
    const variant=p.service_variants||{};
    const validity=[p.validity_value,p.validity_unit].filter(Boolean).join(" ")||"—";
    const mappings=providerMappings.filter(m=>m.product_id===p.id&&m.active);
    const providerText=mappings.length
      ? mappings.map(m=>escapeHtml((m.api_providers?.name||m.api_providers?.code||"Provider")+": "+(m.provider_plan_id||"—"))).join("<br>")
      : '<span class="muted">Not mapped</span>';
    return '<tr><td><strong>'+escapeHtml(p.product_name)+'</strong><br><span class="muted">'+escapeHtml(p.sku||"")+'</span></td><td>'+escapeHtml(network.name||"—")+'</td><td><code>'+escapeHtml(network.id||p.network_id||"—")+'</code></td><td>'+escapeHtml(variant.name||"—")+'</td><td><code>'+escapeHtml(p.id||"—")+'</code></td><td>'+escapeHtml(p.volume||"—")+'</td><td>'+escapeHtml(validity)+'</td><td>'+providerText+'</td><td>'+money(p.selling_price)+'</td><td>'+money(p.cost_price)+'</td><td><span class="badge '+(p.active?"on":"off")+'">'+(p.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editProduct(\''+p.id+'\')">Edit</button></td></tr>';
  }).join("")||'<tr><td colspan="12" class="muted">No data plans configured for this network.</td></tr>';
}

function refreshDataPlanNetworkOptions(){const select=$("dataPlanNetworkFilter");if(!select)return;const dataService=services.find(s=>String(s.code||"").toLowerCase()==="data"||String(s.name||"").toLowerCase()==="data");const dataNetworks=networks.filter(n=>!dataService||n.service_id===dataService.id);const current=select.value;select.innerHTML='<option value="">All networks</option>'+dataNetworks.map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+' — '+escapeHtml(n.id)+'</option>').join("");if(dataNetworks.some(n=>n.id===current))select.value=current;}

async function openProduct(p){
  $("modalTitle").textContent=p?"Edit Data Plan":"Add Data Plan";
  $("modalBody").innerHTML=`
    <div class="grid2">
      <div class="field"><label>Network *</label><select id="xNetwork"><option value="">— select network —</option></select></div>
      <div class="field"><label>Data Type *</label><select id="xVariant"><option value="">— select data type —</option></select></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Plan Size *</label><input id="xPlanSize" type="number" min="0" step="0.01" placeholder="e.g. 1"></div>
      <div class="field"><label>Plan Volume *</label><select id="xPlanVolume"><option value="MB">MB</option><option value="GB">GB</option></select></div>
    </div>
    <div class="grid2">
      <div class="field"><label>Plan Validity *</label><input id="xValidity" placeholder="e.g. 30 Days"></div>
      <div class="field"><label>Amount (Price) ₦ *</label><input id="xSell" type="number" min="0" step=".01"></div>
    </div>
    <div class="field"><label>Purchase Price ₦ *</label><input id="xCost" type="number" min="0" step=".01"></div>
    <div id="providerMappingSection" class="field" style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px">
        <div><strong>Providers</strong><div class="muted">Select a connected provider and enter its exact Data Plan ID.</div></div>
        <button type="button" id="addProviderMapping" class="secondary">+ Add Provider</button>
      </div>
      <div id="providerMappingRows"></div>
      <div id="providerMappingMsg" class="muted"></div>
    </div>
    <div class="field"><label><input id="xActive" type="checkbox" style="width:auto"> Active</label></div>
    <button id="saveProduct">Save Data Plan</button>
  `;

  const dataService=services.find(s=>String(s.code||"").toLowerCase()==="data"||String(s.name||"").toLowerCase()==="data");
  const dataNetworks=networks.filter(n=>!dataService||n.service_id===dataService.id);
  const existingSize=p?.product_name ? String(p.product_name).match(/^\s*([\d.]+)/)?.[1] : "";
  const existingUnit=String(p?.volume||"").match(/(MB|GB)\b/i)?.[1]?.toUpperCase() || String(p?.product_name||"").match(/(MB|GB)\b/i)?.[1]?.toUpperCase() || "GB";
  const existingValidity=[p?.validity_value,p?.validity_unit].filter(Boolean).join(" ");

  $("xNetwork").innerHTML='<option value="">— select network —</option>'+dataNetworks.map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+'</option>').join("");
  $("xNetwork").value=p?.network_id||"";
  $("xPlanSize").value=existingSize||"";
  $("xPlanVolume").value=existingUnit;
  $("xValidity").value=existingValidity;
  $("xSell").value=p?.selling_price??"";
  $("xCost").value=p?.cost_price??"";
  $("xActive").checked=p?.active!==false;

  let providerCatalog=[];
  async function loadProviderCatalog(){
    try{
      const d=await admin({action:"list_providers"});
      providerCatalog=(d.providers||[]).filter(provider=>provider.status==="active");
    }catch{
      providerCatalog=providers.filter(provider=>provider.status==="active");
    }
  }
  await loadProviderCatalog();

  function providerOptions(selected=""){
    return '<option value="">— select provider —</option>'+
      providerCatalog.map(provider=>'<option value="'+provider.id+'" '+(selected===provider.id?"selected":"")+'>'+escapeHtml(provider.name)+' ('+escapeHtml(provider.code||"") +')</option>').join("");
  }

  function addProviderMappingRow(mapping=null){
    const row=document.createElement("div");
    row.className="provider-mapping-row";
    row.style.cssText="display:grid;grid-template-columns:minmax(160px,1fr) minmax(160px,1fr) 34px;gap:8px;align-items:end;margin-bottom:8px";
    row.dataset.mappingId=mapping?.id||"";
    row.innerHTML=`
      <div class="field"><label>Provider</label><select class="pm-provider">${providerOptions(mapping?.provider_id||"")}</select></div>
      <div class="field"><label>Plan ID</label><input class="pm-plan-id" placeholder="e.g. 424" value="${escapeHtml(mapping?.provider_plan_id||"")}"></div>
      <button type="button" class="secondary pm-remove" aria-label="Remove provider">×</button>
    `;
    row.querySelector(".pm-remove").onclick=()=>{
      if(row.dataset.mappingId){ row.dataset.removed="true"; row.style.display="none"; }
      else row.remove();
    };
    $("providerMappingRows").appendChild(row);
  }

  if(p?.id){
    try{
      const d=await admin({action:"list_mappings",product_id:p.id});
      const mappings=(d.mappings||[]).filter(m=>m.active);
      mappings.forEach(m=>addProviderMappingRow(m));
      if(!mappings.length) addProviderMappingRow();
    }catch{
      addProviderMappingRow();
      $("providerMappingMsg").textContent="Existing provider mappings could not be loaded.";
    }
  }else addProviderMappingRow();

  $("addProviderMapping").onclick=()=>addProviderMappingRow();
  await populateProductVariants(dataService?.id||"",$("xNetwork").value,p?.variant_id||"");
  $("xNetwork").onchange=()=>populateProductVariants(dataService?.id||"",$("xNetwork").value,"");
  $("modal").classList.remove("hidden");

  $("saveProduct").onclick=async()=>{
    try{
      const size=String($("xPlanSize").value||"").trim();
      const unit=String($("xPlanVolume").value||"").trim().toUpperCase();
      const validity=String($("xValidity").value||"").trim();
      const validityMatch=validity.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/);
      if(!size||!Number.isFinite(Number(size))||Number(size)<0) throw new Error("Plan Size is required and must be a number.");
      if(!["MB","GB"].includes(unit)) throw new Error("Plan Volume must be MB or GB.");
      if(!validityMatch) throw new Error("Plan Validity must be entered like 30 Days.");
      if(!$("xNetwork").value) throw new Error("Network is required.");
      if(!$("xVariant").value) throw new Error("Data Type is required.");

      const planName=size+" "+unit;
      const networkName=String($("xNetwork").selectedOptions[0]?.textContent||"NETWORK").split(" — ")[0];
      const sku="DATA-"+networkName.replace(/[^A-Za-z0-9]+/g,"-").toUpperCase()+"-"+size+"-"+unit;

      const saved=await admin({
        action:"save_product",id:p?.id,product_name:planName,sku,service_type:"data",
        network_id:$("xNetwork").value,variant_id:$("xVariant").value,volume:unit,
        validity_type:"fixed",validity_value:validityMatch[1],validity_unit:validityMatch[2].toLowerCase(),
        selling_price:$("xSell").value,cost_price:$("xCost").value,display_order:p?.display_order??100,active:$("xActive").checked
      });

      const productId=saved?.product?.id||p?.id;
      if(productId){
        const rows=Array.from(document.querySelectorAll("#providerMappingRows .provider-mapping-row"));
        for(const row of rows){
          const providerId=row.querySelector(".pm-provider")?.value||"";
          const planId=row.querySelector(".pm-plan-id")?.value.trim()||"";
          if(row.dataset.removed==="true"){
            if(row.dataset.mappingId) await admin({action:"save_mapping",id:row.dataset.mappingId,product_id:productId,provider_id:providerId,provider_plan_id:planId||"removed",provider_plan_name:planName,provider_cost:$("xCost").value||"",priority:100,provider_status:"inactive",active:false,metadata:{source:"data_plan_catalog"}});
            continue;
          }
          if(!providerId&&!planId) continue;
          if(!providerId||!planId) throw new Error("Each provider entry needs a provider and its Plan ID.");
          await admin({action:"save_mapping",id:row.dataset.mappingId||undefined,product_id:productId,provider_id:providerId,endpoint_id:null,provider_plan_id:planId,provider_plan_name:planName,provider_cost:$("xCost").value||"",priority:100,provider_status:"active",active:true,metadata:{source:"data_plan_catalog"}});
        }
      }
      $("modal").classList.add("hidden");
      await loadProducts();
    }catch(e){msg($("modalMsg"),e.message,"error")}
  };
}
async function populateProductDimensions(networkId="",variantId=""){
  const sid=$("xService").value;
  const ns=networks.filter(n=>n.service_id===sid);
  $("xNetwork").innerHTML='<option value="">— none —</option>'+ns.map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+'</option>').join("");
  $("xNetwork").value=networkId||"";
  await populateProductVariants(sid,$("xNetwork").value,variantId);
}

async function populateProductVariants(serviceId,networkId="",variantId=""){
  const select=$("xVariant");
  if(!select)return;

  const normalizedServiceId=String(serviceId||"");
  const normalizedNetworkId=String(networkId||"");

  // Data Types are catalog variants. Prefer variants assigned to the
  // selected network, but also allow service-level variants (network_id
  // is null) so a valid Data Type can always be selected when configured
  // at service level.
  const selectedVariant=variants.find(v=>String(v.id)===String(variantId||""));

  const vs=variants.filter(v=>{
    if(v.active===false)return false;
    if(String(v.service_id||"")!==normalizedServiceId)return false;

    const variantNetworkId=String(v.network_id||"");
    return !variantNetworkId
      ? Boolean(normalizedNetworkId)
      : variantNetworkId===normalizedNetworkId;
  });

  select.innerHTML='<option value="">— select data type —</option>'+
    vs.map(v=>'<option value="'+v.id+'">'+escapeHtml(v.name)+'</option>').join("");

  const validSelected=selectedVariant && vs.some(v=>String(v.id)===String(selectedVariant.id));
  select.value=validSelected ? selectedVariant.id : "";

  // Keep the field usable and make the reason visible when no type is
  // configured for the selected network.
  select.disabled=!normalizedNetworkId;
  if(!normalizedNetworkId){
    select.innerHTML='<option value="">— select network first —</option>';
  }else if(!vs.length){
    select.innerHTML='<option value="">— no data types configured —</option>';
  }
}

async function loadCatalogDimensions(){
  try{
    const n=await admin({action:"list_service_networks"}); networks=n.networks||[];
    const v=await admin({action:"list_service_variants"}); variants=v.variants||[];
    refreshCatalogServiceOptions();
    refreshDataPlanNetworkOptions();
    renderNetworks();
    renderVariants();
  }catch(e){msg($("networkMsg"),e.message,"error");msg($("variantMsg"),e.message,"error")}
}

document.getElementById("dataPlanNetworkFilter")?.addEventListener("change",renderProducts);

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
  $("variantRows").innerHTML=rows.map(v=>'<tr><td><strong>'+escapeHtml(v.name)+'</strong></td><td>'+escapeHtml(v.code)+'</td><td>'+escapeHtml(v.service_networks?.name||"All networks")+'</td><td>'+escapeHtml(v.service_definitions?.name||"—")+'</td><td><span class="badge '+(v.active?"on":"off")+'">'+(v.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editVariant(\''+v.id+'\')">Edit</button> <button class="secondary" onclick="toggleDataType(\''+v.id+'\','+(v.active?"false":"true")+')">'+(v.active?"Disable":"Enable")+'</button></td></tr>').join("")||'<tr><td colspan="6" class="muted">No data types configured.</td></tr>';
}

async function openNetwork(n){
  $("modalTitle").textContent=n?"Edit Network":"Add Network";
  $("modalBody").innerHTML='<div class="field"><label>Service *</label><select id="nService">'+services.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join("")+'</select></div><div class="grid2"><div class="field"><label>Network name *</label><input id="nName" placeholder="MTN"></div><div class="field"><label>Code *</label><input id="nCode" placeholder="mtn"></div></div><div class="field"><label><input id="nActive" type="checkbox" style="width:auto"> Active</label></div><button id="saveNetwork">Save Network</button>';
  $("nService").value=n?.service_id||services[0]?.id||"";$("nName").value=n?.name||"";$("nCode").value=n?.code||"";$("nActive").checked=n?.active!==false;$("modal").classList.remove("hidden");
  $("saveNetwork").onclick=async()=>{try{await admin({action:"save_service_network",id:n?.id,service_id:$("nService").value,name:$("nName").value,code:$("nCode").value,active:$("nActive").checked});$("modal").classList.add("hidden");await loadCatalogDimensions()}catch(e){msg($("modalMsg"),e.message,"error")}};
}

window.toggleDataType=async function(id,active){try{const v=variants.find(x=>x.id===id);if(!v)return;await admin({action:"save_service_variant",id:v.id,service_id:v.service_id,network_id:v.network_id||null,name:v.name,code:v.code,description:v.description||"",active:Boolean(active)});await loadCatalogDimensions();}catch(e){msg($("variantMsg"),e.message,"error")}};

async function openVariant(v){
  $("modalTitle").textContent=v?"Edit Data Type":"Add Data Type";
  $("modalBody").innerHTML='<div class="field"><label>Service *</label><select id="vService">'+services.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join("")+'</select></div><div class="field"><label>Network</label><select id="vNetwork"><option value="">All networks for this service</option></select></div><div class="grid2"><div class="field"><label>Data Type name *</label><input id="vName" placeholder="SME Data"></div><div class="field"><label>Code *</label><input id="vCode" placeholder="sme"></div></div><div class="field"><label>Description</label><textarea id="vDescription"></textarea></div><div class="field"><label><input id="vActive" type="checkbox" style="width:auto"> Active</label></div><button id="saveVariant">Save Data Type</button>';
  $("vService").value=v?.service_id||services[0]?.id||"";
  const fill=()=>{$("vNetwork").innerHTML='<option value="">All networks for this service</option>'+networks.filter(n=>n.service_id===$("vService").value).map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+'</option>').join("");$("vNetwork").value=v?.network_id||""};
  fill();$("vService").onchange=fill;
  $("vName").value=v?.name||"";$("vCode").value=v?.code||"";$("vDescription").value=v?.description||"";$("vActive").checked=v?.active!==false;$("modal").classList.remove("hidden");
  $("saveVariant").onclick=async()=>{try{await admin({action:"save_service_variant",id:v?.id,service_id:$("vService").value,network_id:$("vNetwork").value||null,name:$("vName").value,code:$("vCode").value,description:$("vDescription").value,active:$("vActive").checked});$("modal").classList.add("hidden");await loadCatalogDimensions()}catch(e){msg($("modalMsg"),e.message,"error")}};
}
