// Bindawasub Admin — products

async function loadProducts(){try{const d=await admin({action:"list_products"});products=d.products||[];refreshMappingProductOptions();renderProducts()}catch(e){msg($("productMsg"),e.message,"error")}}

function renderProducts(){const networkFilter=$("dataPlanNetworkFilter")?.value||"";const visibleProducts=products.filter(p=>{const networkService=isNetworkService({code:p.service_type,name:p.service_type});if(productsCatalogMode==="network"&&!networkService)return false;if(productsCatalogMode==="other"&&networkService)return false;if(productsCatalogMode==="network"&&String(p.service_type||"").toLowerCase()!=="data")return false;if(networkFilter&&p.network_id!==networkFilter)return false;return true;});$("productRows").innerHTML=visibleProducts.map(p=>{const network=p.service_networks||{};const variant=p.service_variants||{};const validity=[p.validity_value,p.validity_unit].filter(Boolean).join(" ")||"—";return '<tr><td><strong>'+escapeHtml(p.product_name)+'</strong><br><span class="muted">'+escapeHtml(p.sku||"")+'</span></td><td>'+escapeHtml(network.name||"—")+'</td><td><code>'+escapeHtml(network.id||p.network_id||"—")+'</code></td><td>'+escapeHtml(variant.name||"—")+'</td><td><code>'+escapeHtml(p.id||"—")+'</code></td><td>'+escapeHtml(p.volume||"—")+'</td><td>'+escapeHtml(validity)+'</td><td>'+money(p.selling_price)+'</td><td>'+money(p.cost_price)+'</td><td><span class="badge '+(p.active?"on":"off")+'">'+(p.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editProduct(\''+p.id+'\')">Edit</button></td></tr>';}).join("")||'<tr><td colspan="11" class="muted">No data plans configured for this network.</td></tr>';}
function refreshDataPlanNetworkOptions(){const select=$("dataPlanNetworkFilter");if(!select)return;const dataService=services.find(s=>String(s.code||"").toLowerCase()==="data"||String(s.name||"").toLowerCase()==="data");const dataNetworks=networks.filter(n=>!dataService||n.service_id===dataService.id);const current=select.value;select.innerHTML='<option value="">All networks</option>'+dataNetworks.map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+' — '+escapeHtml(n.id)+'</option>').join("");if(dataNetworks.some(n=>n.id===current))select.value=current;}

async function openProduct(p){
  const opts=providers.map(x=>'<option value="'+x.id+'" '+(p?.provider_id===x.id?"selected":"")+'>'+escapeHtml(x.name)+'</option>').join("");
  $("modalTitle").textContent=p?"Edit Product / Plan":"Add Product / Plan";
  $("modalBody").innerHTML='<div class="grid2"><div class="field"><label>Product name</label><input id="xName"></div><div class="field"><label>SKU</label><input id="xSku"></div></div><div class="grid2"><div class="field"><label>Service type</label><select id="xService">'+services.map(s=>'<option value="'+s.code+'">'+escapeHtml(s.name)+'</option>').join("")+'</select></div><div class="field"><label>Network</label><select id="xNetwork"><option value="">— none —</option></select></div></div><div class="grid2"><div class="field"><label>Data Type</label><select id="xVariant"><option value="">— select data type —</option></select></div><div class="field"><label>Volume / amount</label><input id="xVolume" placeholder="e.g. 1 GB or ₦1000"></div></div><div class="grid2"><div class="field"><label>Validity type</label><select id="xValidityType"><option value="fixed">Fixed</option><option value="none">Not applicable</option><option value="unlimited">Unlimited</option><option value="dynamic">Dynamic</option></select></div><div class="field"><label>Validity value</label><input id="xValidityValue" type="number" min="0" step="0.01" placeholder="e.g. 30"></div></div><div class="field"><label>Validity unit</label><input id="xValidityUnit" placeholder="days, hours, months, years"></div><div class="grid2"><div class="field"><label>Display order</label><input id="xOrder" type="number"></div><div></div></div><div class="grid2"><div class="field"><label>Selling price (₦)</label><input id="xSell" type="number" min="0" step=".01"></div><div class="field"><label>Cost price (₦)</label><input id="xCost" type="number" min="0" step=".01"></div></div><div class="field"><label><input id="xActive" type="checkbox" style="width:auto"> Active</label></div><button id="saveProduct">Save Product / Plan</button>';
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
  $("xVariant").innerHTML='<option value="">— select data type —</option>'+vs.map(v=>'<option value="'+v.id+'">'+escapeHtml(v.name)+'</option>').join("");
  $("xVariant").value=variantId||"";
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
  $("variantRows").innerHTML=rows.map(v=>'<tr><td><strong>'+escapeHtml(v.name)+'</strong></td><td>'+escapeHtml(v.code)+'</td><td>'+escapeHtml(v.service_networks?.name||"All networks")+'</td><td>'+escapeHtml(v.service_definitions?.name||"—")+'</td><td><span class="badge '+(v.active?"on":"off")+'">'+(v.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editVariant(\''+v.id+'\')">Edit</button></td></tr>').join("")||'<tr><td colspan="6" class="muted">No variants configured.</td></tr>';
}

async function openNetwork(n){
  $("modalTitle").textContent=n?"Edit Network":"Add Network";
  $("modalBody").innerHTML='<div class="field"><label>Service *</label><select id="nService">'+services.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join("")+'</select></div><div class="grid2"><div class="field"><label>Network name *</label><input id="nName" placeholder="MTN"></div><div class="field"><label>Code *</label><input id="nCode" placeholder="mtn"></div></div><div class="field"><label><input id="nActive" type="checkbox" style="width:auto"> Active</label></div><button id="saveNetwork">Save Network</button>';
  $("nService").value=n?.service_id||services[0]?.id||"";$("nName").value=n?.name||"";$("nCode").value=n?.code||"";$("nActive").checked=n?.active!==false;$("modal").classList.remove("hidden");
  $("saveNetwork").onclick=async()=>{try{await admin({action:"save_service_network",id:n?.id,service_id:$("nService").value,name:$("nName").value,code:$("nCode").value,active:$("nActive").checked});$("modal").classList.add("hidden");await loadCatalogDimensions()}catch(e){msg($("modalMsg"),e.message,"error")}};
}

async function openVariant(v){
  $("modalTitle").textContent=v?"Edit Variant / Channel":"Add Variant / Channel";
  $("modalBody").innerHTML='<div class="field"><label>Service *</label><select id="vService">'+services.map(s=>'<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>').join("")+'</select></div><div class="field"><label>Network</label><select id="vNetwork"><option value="">All networks for this service</option></select></div><div class="grid2"><div class="field"><label>Data Type / Variant name *</label><input id="vName" placeholder="SME Data"></div><div class="field"><label>Code *</label><input id="vCode" placeholder="sme"></div></div><div class="field"><label>Description</label><textarea id="vDescription"></textarea></div><div class="field"><label><input id="vActive" type="checkbox" style="width:auto"> Active</label></div><button id="saveVariant">Save Variant</button>';
  $("vService").value=v?.service_id||services[0]?.id||"";
  const fill=()=>{$("vNetwork").innerHTML='<option value="">All networks for this service</option>'+networks.filter(n=>n.service_id===$("vService").value).map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+'</option>').join("");$("vNetwork").value=v?.network_id||""};
  fill();$("vService").onchange=fill;
  $("vName").value=v?.name||"";$("vCode").value=v?.code||"";$("vDescription").value=v?.description||"";$("vActive").checked=v?.active!==false;$("modal").classList.remove("hidden");
  $("saveVariant").onclick=async()=>{try{await admin({action:"save_service_variant",id:v?.id,service_id:$("vService").value,network_id:$("vNetwork").value||null,name:$("vName").value,code:$("vCode").value,description:$("vDescription").value,active:$("vActive").checked});$("modal").classList.add("hidden");await loadCatalogDimensions()}catch(e){msg($("modalMsg"),e.message,"error")}};
}
