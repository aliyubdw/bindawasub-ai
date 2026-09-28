// Bindawasub Admin — endpoints

async function loadEndpoints(){try{
  const pid=$("endpointProvider").value;
  const d=await admin({action:"list_endpoints",provider_id:pid||null});
  const rows=d.endpoints||[]; window._endpoints=rows;
  $("endpointRows").innerHTML=rows.map(e=>'<tr><td>'+escapeHtml(e.service_type)+'</td><td>'+escapeHtml(e.operation)+'</td><td>'+escapeHtml(e.method)+'</td><td>'+escapeHtml(e.path)+'</td><td>'+e.timeout_ms+'ms</td><td>'+e.retry_count+'</td><td><span class="badge '+(e.active?"on":"off")+'">'+(e.active?"Active":"Inactive")+'</span></td><td><button class="secondary" onclick="editEndpoint(\''+e.id+'\')">Edit</button><button class="secondary" onclick="previewEndpointAdmin(\''+e.id+'\')">Preview</button><button class="secondary" '+(e.operation==="purchase"||e.operation==="webhook"?"disabled":"")+' onclick="testEndpointAdmin(\''+e.id+'\')">Test</button><button class="secondary" onclick="validateMappingAdmin(\''+e.id+'\')">Validate</button></td></tr>').join("")||'<tr><td colspan="8" class="muted">No endpoints configured.</td></tr>';
}catch(e){msg($("endpointMsg"),e.message,"error")}}

function refreshEndpointProviderOptions(){
  $("endpointProvider").innerHTML='<option value="">All providers</option>'+providers.map(p=>'<option value="'+p.id+'">'+escapeHtml(p.name)+'</option>').join("");
}

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
