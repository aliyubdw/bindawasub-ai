import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-execution-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(data: unknown, status=200) {
  return new Response(JSON.stringify(data), {status, headers:{...corsHeaders,"Content-Type":"application/json"}});
}
function getPath(obj:any, path:string) {
  if (!path) return undefined;
  return path.split(".").reduce((v,k)=>v == null ? undefined : v[k], obj);
}

function resolveProviderNetworkId(networkCode:any, mapping:any, customerInput:any, provider:any) {
  const explicit=mapping?.metadata?.provider_network_id ?? customerInput?.provider_network_id;
  if(explicit!==undefined && explicit!==null && String(explicit)!=="") return String(explicit);
  const code=String(networkCode||"").trim().toLowerCase();
  if(String(provider?.code||"").toLowerCase()==="smeplug") {
    const ids:any={mtn:"1",airtel:"2",glo:"3","9mobile":"4"};
    return ids[code]||"";
  }
  return "";
}

function deepRender(value:any, ctx:any):any {
  if (typeof value === "string") return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m,key)=>{
    const v=getPath(ctx,key.trim()); return v === undefined || v === null ? "" : String(v);
  });
  if (Array.isArray(value)) return value.map(v=>deepRender(v,ctx));
  if (value && typeof value === "object") { const out:any={}; for (const [k,v] of Object.entries(value)) out[k]=deepRender(v,ctx); return out; }
  return value;
}
function normalizeStatus(v:any, map:any) {
  const s=String(v ?? "").trim().toLowerCase();
  const success=(map.success_values||["success","successful","completed","complete","true","1","ok"]).map((x:any)=>String(x).toLowerCase());
  const pending=(map.pending_values||["pending","processing","queued","queue","in_progress","in progress"]).map((x:any)=>String(x).toLowerCase());
  // safe_failure_values explicitly means the provider has confirmed the purchase was NOT processed.
  // failed_values remains supported for backward compatibility and is treated as safe failure.
  const safeFailure=(map.safe_failure_values||map.failed_values||["failed","failure","error","false","0","cancelled","canceled"]).map((x:any)=>String(x).toLowerCase());
  const ambiguous=(map.ambiguous_values||["unknown","timeout","timed_out","timed out","uncertain","indeterminate"]).map((x:any)=>String(x).toLowerCase());
  if(success.includes(s)) return "successful";
  if(ambiguous.includes(s)) return "ambiguous";
  if(pending.includes(s)) return "pending";
  if(safeFailure.includes(s)) return "failed";
  return "ambiguous";
}
async function authorize(req:Request, internalOnly=false) {
  const bearer=req.headers.get("Authorization")||"";
  if (!bearer.startsWith("Bearer ")) throw new Error("Authentication required.");
  const token=bearer.slice(7);
  if (token === SERVICE_ROLE_KEY) return {internal:true};
  if (internalOnly) throw new Error("Internal service authorization required.");
  const {data,error}=await db.auth.getUser(token);
  if(error || !data.user) throw new Error("Invalid or expired session.");
  const {data:user}=await db.from("users").select("id,role").eq("auth_user_id",data.user.id).maybeSingle();
  if(!user || user.role!=="admin") throw new Error("Admin access required.");
  return {internal:false,user};
}
async function getServiceOperationRoutes(serviceType:string, operation:string, providerId?:string) {
  const q= db.from("provider_services")
    .select("id,provider_id,priority,metadata,api_providers!inner(id,name,code,base_url,status)")
    .eq("service_type",serviceType)
    .eq("enabled",true)
    .eq("api_providers.status","active")
    .order("priority",{ascending:true});
  if(providerId) q.eq("provider_id",providerId);
  const {data:services,error}=await q;
  if(error) throw new Error("Provider service lookup failed: "+error.message);
  const routes:any[]=[];
  for(const service of (services||[])){
    const {data:ops,error:oError}=await db.from("provider_service_operations")
      .select("id,operation,endpoint_id,active,priority,metadata,api_endpoints!inner(id,provider_id,service_type,operation,method,path,headers_template,request_template,response_mapping,timeout_ms,active)")
      .eq("provider_service_id",service.id)
      .eq("operation",operation)
      .eq("active",true)
      .eq("api_endpoints.active",true)
      .eq("api_endpoints.provider_id",service.provider_id)
      .eq("api_endpoints.service_type",serviceType)
      .eq("api_endpoints.operation",operation)
      .order("priority",{ascending:true});
    if(oError) throw new Error("Provider service operation lookup failed: "+oError.message);
    for(const op of (ops||[])) routes.push({service,operation:op,provider:service.api_providers,endpoint:op.api_endpoints});
  }
  return routes;
}

async function getCredentials(providerId:string) {
  const {data:credential,error:credentialError}=await db
    .from("provider_credentials")
    .select("secret_name")
    .eq("provider_id",providerId)
    .limit(1)
    .maybeSingle();

  if(credentialError) throw new Error("Provider credential configuration unavailable: "+credentialError.message);
  if(credential?.secret_name){
    const secretName=String(credential.secret_name).trim();
    if(secretName){
      const envKey=(Deno.env.get(secretName)||"").trim();
      if(envKey) return {api_key:envKey,source:"edge_secret",secret_name:secretName};
    }
  }

  const {data,error}=await db.rpc("get_provider_credentials",{p_provider_id:providerId});
  if(error) throw new Error("Provider credentials unavailable: "+error.message);
  if(!data) throw new Error("Provider credentials are not configured.");
  try { return JSON.parse(data); } catch { return {api_key:String(data),source:"vault"}; }
}

async function finalizeAndVerify(transactionId:string, providerStatus:"successful"|"failed", providerReference:string|null, providerMessage:string, providerResponse:any) {
  const result=await db.rpc("finalize_vtu_transaction",{
    p_transaction_id:transactionId,
    p_provider_status:providerStatus,
    p_provider_reference:providerReference,
    p_provider_message:providerMessage,
    p_provider_response:providerResponse,
  });
  if(result.error) throw new Error((providerStatus==="failed"?"Refund/finalization failed: ":"Finalization failed: ")+result.error.message);
  const row=Array.isArray(result.data)?result.data[0]:result.data;
  if(!row || row.final_status!==providerStatus) {
    throw new Error("Finalization returned an unexpected transaction status.");
  }
  if(providerStatus==="failed") {
    const {data:tx,error:txError}=await db.from("transactions").select("id,provider_reference").eq("id",transactionId).single();
    if(txError || !tx) throw new Error("Refund verification failed: transaction could not be reloaded.");
    const refundReference="REFUND-"+String(tx.provider_reference||providerReference||transactionId);
    const {data:refund,error:refundError}=await db.from("wallet_transactions").select("reference,status,amount").eq("reference",refundReference).maybeSingle();
    if(refundError) throw new Error("Refund verification failed: "+refundError.message);
    if(!refund || refund.status!=="successful") throw new Error("Confirmed provider failure was recorded, but the wallet refund could not be verified.");
  }
  return row;
}

async function dryRunPurchase(req:Request, body:any) {
  await authorize(req,false);
  const txId=String(body.transaction_id||""); if(!txId) throw new Error("transaction_id is required.");
  const {data:tx,error:txError}=await db.from("transactions").select("id,user_id,product_id,phone_number,amount,cost,profit,status,provider,provider_reference,service_type,customer_input").eq("id",txId).single();
  if(txError || !tx) throw new Error("Transaction not found.");
  if(["successful","failed","reversed"].includes(tx.status)) return {success:false,status:tx.status,transaction_id:tx.id,already_finalized:true};
  const customerInput=(tx.customer_input&&typeof tx.customer_input==="object")?tx.customer_input:{};
  let product:any=null;
  if(tx.product_id){
    const {data:p,error:pError}=await db.from("products").select("id,product_name,service_type,volume,validity_value,validity_unit,validity_type,selling_price,cost_price,active,network_id,variant_id,service_networks(code,name),service_variants(code,name)").eq("id",tx.product_id).single();
    if(pError || !p) throw new Error("Product not found.");
    if(!p.active) throw new Error("Product is inactive."); product=p;
  }
  const serviceType=tx.service_type||product?.service_type; if(!serviceType) throw new Error("Transaction service type is missing.");
  let provider:any=null; let mapping:any=null;
  if(product?.id){
    const {data:mappings,error:mError}=await db.from("provider_plan_mappings").select("id,provider_id,endpoint_id,provider_plan_id,provider_plan_name,provider_cost,provider_status,priority,metadata,failure_count,last_failure_at,cooldown_until,last_success_at,api_providers!inner(id,name,code,base_url,status)").eq("product_id",product.id).eq("active",true).eq("api_providers.status","active").or("cooldown_until.is.null,cooldown_until.lte."+new Date().toISOString()).order("priority",{ascending:true});
    if(mError) throw new Error("Provider mapping lookup failed: "+mError.message);
    mapping=(mappings||[]).find((m:any)=>m.provider_status==="active"); if(!mapping) throw new Error("No active provider plan mapping is available for this product."); provider=mapping.api_providers;
  } else {
    const routes=await getServiceOperationRoutes(serviceType,"purchase");
    const route=routes[0]; if(!route) throw new Error("No active provider purchase capability is configured for "+serviceType+".");
    provider=route.provider;
  }
  let endpoint:any=null; let eError:any=null;
  if(mapping?.endpoint_id){
    const r=await db.from("api_endpoints").select("*").eq("id",mapping.endpoint_id).eq("provider_id",provider.id).eq("service_type",serviceType).eq("operation","purchase").eq("active",true).maybeSingle();
    endpoint=r.data; eError=r.error;
  } else {
    const route=await getServiceOperationRoutes(serviceType,"purchase",provider.id);
    endpoint=route[0]?.endpoint||null;
  }
  if(eError || !endpoint) throw new Error("No active purchase endpoint is configured for "+provider.name+".");
  const credentials=await getCredentials(provider.id);
  const reference="BW-"+tx.id;
  const ctx={...customerInput,customer_input:customerInput,service_type:serviceType,phone:customerInput.phone||tx.phone_number,phone_number:customerInput.phone||tx.phone_number,amount:tx.amount,network:product?.service_networks?.code||customerInput.network||"",network_name:product?.service_networks?.name||customerInput.network_name||"",provider_network_id:resolveProviderNetworkId(product?.service_networks?.code||customerInput.network, mapping, customerInput, provider),network_id:resolveProviderNetworkId(product?.service_networks?.code||customerInput.network, mapping, customerInput, provider),volume:product?.volume||customerInput.volume||"",duration:product?.validity_type==="fixed"&&product?.validity_value!=null&&product?.validity_unit?`${product.validity_value} ${product.validity_unit}`:(customerInput.duration||""),validity_value:product?.validity_value??customerInput.validity_value??"",validity_unit:product?.validity_unit||customerInput.validity_unit||"",validity_type:product?.validity_type||customerInput.validity_type||"",provider_plan_id:mapping?.provider_plan_id||"",provider_plan_name:mapping?.provider_plan_name||"",product_id:product?.id||"",transaction_id:tx.id,user_id:tx.user_id,reference,credential:credentials,credentials};
  const headers=deepRender(endpoint.headers_template||{},ctx); if(!headers["Content-Type"]&&!headers["content-type"]) headers["Content-Type"]="application/json";
  const renderedPath=deepRender(endpoint.path,ctx); const url=new URL(renderedPath,provider.base_url).toString(); const method=endpoint.method.toUpperCase(); const request=deepRender(endpoint.request_template||{},ctx);
  const redact=(value:any):any=>{if(Array.isArray(value))return value.map(redact);if(value&&typeof value==="object"){const out:any={};for(const [k,v] of Object.entries(value)){if(/authorization|api[_-]?key|secret|token|credential/i.test(k))out[k]="[REDACTED]";else out[k]=redact(v)}return out}return value};
  return {success:true,dry_run:true,provider:provider.name,provider_code:provider.code,transaction_id:tx.id,endpoint:{method:String(method||endpoint.method||""),url:String(url||""),headers:redact(headers||{}),request:redact(request||{})},endpoint_config:{service_type:String(endpoint.service_type||""),operation:String(endpoint.operation||""),method:String(endpoint.method||""),path:String(endpoint.path||"")},mapping:{provider_plan_id:mapping.provider_plan_id,provider_plan_name:mapping.provider_plan_name,provider_cost:mapping.provider_cost},note:"DRY RUN ONLY. No provider request was sent and no transaction or wallet state was changed."};
}

async function executePurchase(req:Request, body:any) {
  await authorize(req,false);
  const txId=String(body.transaction_id||""); if(!txId) throw new Error("transaction_id is required.");
  const {data:tx,error:txError}=await db.from("transactions").select("id,user_id,product_id,phone_number,amount,cost,profit,status,provider,provider_reference,service_type,customer_input").eq("id",txId).single();
  if(txError || !tx) throw new Error("Transaction not found.");
  if(["successful","failed","reversed"].includes(tx.status)) return {success:true,status:tx.status,transaction_id:tx.id,already_finalized:true};
  if(tx.provider_reference) return {success:false,status:"pending",transaction_id:tx.id,requires_requery:true,message:"This transaction already has a provider reference and must be re-queried before any retry."};

  const claim=await db.rpc("claim_vtu_transaction",{p_transaction_id:tx.id});
  if(claim.error) throw new Error("Transaction lock failed: "+claim.error.message);
  if(!claim.data?.claimed) return {success:false,status:"pending",transaction_id:tx.id,locked:true,message:"Transaction is already being processed or requires provider requery."};

  const customerInput=(tx.customer_input&&typeof tx.customer_input==="object")?tx.customer_input:{};
  let product:any=null;
  if(tx.product_id){
    const {data:p,error:pError}=await db.from("products").select("id,product_name,service_type,volume,validity_value,validity_unit,validity_type,selling_price,cost_price,active,network_id,variant_id,service_networks(code,name),service_variants(code,name)").eq("id",tx.product_id).single();
    if(pError||!p) throw new Error("Product not found.");
    if(!p.active) throw new Error("Product is inactive.");
    product=p;
  }
  const serviceType=tx.service_type||product?.service_type;
  if(!serviceType) throw new Error("Transaction service type is missing.");

  let candidates:any[]=[];
  if(product?.id){
    const {data,error}=await db.from("provider_plan_mappings")
      .select("id,provider_id,endpoint_id,provider_plan_id,provider_plan_name,provider_cost,provider_status,priority,metadata,failure_count,last_failure_at,cooldown_until,last_success_at,api_providers!inner(id,name,code,base_url,status)")
      .eq("product_id",product.id).eq("active",true).eq("api_providers.status","active")
      .or("cooldown_until.is.null,cooldown_until.lte."+new Date().toISOString()).order("priority",{ascending:true});
    if(error) throw new Error("Provider mapping lookup failed: "+error.message);
    candidates=(data||[]).filter((m:any)=>m.provider_status==="active").map((m:any)=>({mapping:m,service:null,provider:m.api_providers}));
  } else {
    const routes=await getServiceOperationRoutes(serviceType,"purchase");
    candidates=routes.map((r:any)=>({mapping:null,service:r.service,operation:r.operation,provider:r.provider,endpoint:r.endpoint}));
  }
  if(!candidates.length){
    await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
    throw new Error("No active provider is available for this transaction.");
  }

  let lastFailure:any=null;
  for(let i=0;i<candidates.length;i++){
    const {mapping,service,provider}=candidates[i];
    let endpoint:any=service?.endpoint ? service.endpoint : null;
    if(mapping?.endpoint_id){
      const r=await db.from("api_endpoints").select("*").eq("id",mapping.endpoint_id).eq("provider_id",provider.id).eq("service_type",serviceType).eq("operation","purchase").eq("active",true).maybeSingle();
      if(r.error) throw new Error("Purchase endpoint lookup failed: "+r.error.message);
      endpoint=r.data;
    }

    const attemptNo=i+1;
    if(!endpoint){
      lastFailure={provider:provider.name,message:"No active purchase endpoint is configured for "+provider.name,attempt_no:attemptNo};
      if(mapping?.id){
        const failures=Number(mapping.failure_count||0)+1;
        const cooldown=Math.min(900,60*Math.pow(2,Math.min(failures-1,4)));
        await db.from("provider_plan_mappings").update({failure_count:failures,last_failure_at:new Date().toISOString(),cooldown_until:new Date(Date.now()+cooldown*1000).toISOString()}).eq("id",mapping.id);
      }
      continue;
    }

    const {data:attempt,error:attemptError}=await db.from("transaction_provider_attempts").insert({
      transaction_id:tx.id,attempt_no:attemptNo,mapping_id:mapping?.id||null,provider_service_id:service?.id||null,
      provider_id:provider.id,endpoint_id:endpoint.id,status:"started",started_at:new Date().toISOString()
    }).select("id").single();
    if(attemptError) throw new Error("Provider attempt record failed: "+attemptError.message);

    const credentials=await getCredentials(provider.id);
    const reference="BW-"+tx.id+"-"+attemptNo;
    const ctx={...customerInput,customer_input:customerInput,service_type:serviceType,phone:customerInput.phone||tx.phone_number,phone_number:customerInput.phone||tx.phone_number,
      amount:tx.amount,network:product?.service_networks?.code||customerInput.network||"",network_name:product?.service_networks?.name||customerInput.network_name||"",provider_network_id:resolveProviderNetworkId(product?.service_networks?.code||customerInput.network, mapping, customerInput, provider),network_id:resolveProviderNetworkId(product?.service_networks?.code||customerInput.network, mapping, customerInput, provider),volume:product?.volume||customerInput.volume||"",duration:product?.validity_type==="fixed"&&product?.validity_value!=null&&product?.validity_unit?`${product.validity_value} ${product.validity_unit}`:(customerInput.duration||""),validity_value:product?.validity_value??customerInput.validity_value??"",validity_unit:product?.validity_unit||customerInput.validity_unit||"",validity_type:product?.validity_type||customerInput.validity_type||"",
      provider_plan_id:mapping?.provider_plan_id||"",provider_plan_name:mapping?.provider_plan_name||"",product_id:product?.id||"",transaction_id:tx.id,user_id:tx.user_id,reference,credential:credentials,credentials};

    const headers=deepRender(endpoint.headers_template||{},ctx);
    if(!headers["Content-Type"]&&!headers["content-type"]) headers["Content-Type"]="application/json";
    const renderedPath=deepRender(endpoint.path,ctx);
    const url=new URL(renderedPath,provider.base_url).toString();
    const method=endpoint.method.toUpperCase();
    const renderedRequest=deepRender(endpoint.request_template||{},ctx);
    let requestUrl=url; const options:any={method,headers};
    if(method==="GET"||method==="DELETE") for(const [k,v] of Object.entries(renderedRequest||{})) requestUrl+=(requestUrl.includes("?")?"&":"?")+encodeURIComponent(k)+"="+encodeURIComponent(String(v??""));
    else options.body=JSON.stringify(renderedRequest);

    await db.from("transactions").update({provider:provider.name,cost:mapping?.provider_cost??tx.cost,profit:tx.amount-Number(mapping?.provider_cost??tx.cost??0)}).eq("id",tx.id);
    await db.rpc("record_transaction_event",{p_transaction_id:tx.id,p_event_type:"provider_request",p_title:"Provider request sent",p_description:provider.name+" purchase request was sent (attempt "+attemptNo+").",p_status:tx.status,p_actor_type:"system",p_provider:provider.name,p_provider_reference:reference,p_amount:tx.amount,p_metadata:{method,url:requestUrl,operation:"purchase",attempt_no:attemptNo}});

    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),Math.min(Math.max(Number(endpoint.timeout_ms)||15000,1000),60000));
    let response:Response; let raw="";
    try { response=await fetch(requestUrl,{...options,signal:controller.signal}); raw=await response.text(); }
    catch(e) {
      clearTimeout(timer);
      const message=e instanceof Error&&e.name==="AbortError"?"Provider request timed out.":"Provider request failed.";
      await db.from("transaction_provider_attempts").update({status:"ambiguous",ambiguous:true,error_code:"NETWORK_OR_TIMEOUT",error_message:message,completed_at:new Date().toISOString()}).eq("id",attempt.id);
      await db.from("transactions").update({provider:provider.name,provider_reference:reference,processing_at:null}).eq("id",tx.id);
      return {success:false,status:"pending",transaction_id:tx.id,requires_requery:true,provider:provider.name,provider_reference:reference,attempt_no:attemptNo,message:"Provider outcome is unknown. Transaction remains pending and no failover was attempted."};
    }
    clearTimeout(timer);

    let parsed:any; try{parsed=JSON.parse(raw);}catch{parsed={raw};}
    const rm=endpoint.response_mapping||{};
    const statusValue=getPath(parsed,rm.status_path||"status")??getPath(parsed,"data.status")??(response.ok?"success":"failed");
    const providerStatus=normalizeStatus(statusValue,rm);
    const providerRef=getPath(parsed,rm.reference_path||"reference")??getPath(parsed,"data.reference")??getPath(parsed,"data.transaction_id")??null;
    const providerMessage=getPath(parsed,rm.message_path||"message")??getPath(parsed,"data.message")??raw.slice(0,500);

    if(providerStatus==="successful"){
      await db.from("transaction_provider_attempts").update({status:"successful",provider_status:String(statusValue??""),provider_reference:providerRef||reference,response:parsed,completed_at:new Date().toISOString(),ambiguous:false}).eq("id",attempt.id);
      await finalizeAndVerify(tx.id,"successful",providerRef||reference,String(providerMessage||""),parsed);
      if(mapping?.id) await db.from("provider_plan_mappings").update({failure_count:0,last_failure_at:null,cooldown_until:null,last_success_at:new Date().toISOString()}).eq("id",mapping.id);
      await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
      return {success:true,status:"successful",transaction_id:tx.id,provider:provider.name,provider_reference:providerRef||reference,attempt_no:attemptNo,message:String(providerMessage||"")};
    }

    if(providerStatus==="failed"){
      await db.from("transaction_provider_attempts").update({status:"failed",provider_status:String(statusValue??""),provider_reference:providerRef||reference,response:parsed,completed_at:new Date().toISOString(),ambiguous:false,error_code:"PROVIDER_CONFIRMED_FAILURE",error_message:String(providerMessage||"")}).eq("id",attempt.id);
      if(mapping?.id){
        const failures=Number(mapping.failure_count||0)+1;
        const cooldown=Math.min(900,60*Math.pow(2,Math.min(failures-1,4)));
        await db.from("provider_plan_mappings").update({failure_count:failures,last_failure_at:new Date().toISOString(),cooldown_until:new Date(Date.now()+cooldown*1000).toISOString()}).eq("id",mapping.id);
      }
      lastFailure={provider:provider.name,provider_reference:providerRef||reference,message:String(providerMessage||"Provider purchase failed."),attempt_no:attemptNo};
      continue;
    }

    await db.from("transaction_provider_attempts").update({status:"ambiguous",ambiguous:true,provider_status:String(statusValue??""),provider_reference:providerRef||null,response:parsed,completed_at:new Date().toISOString(),error_code:"NON_FINAL_PROVIDER_STATUS",error_message:String(providerMessage||"")}).eq("id",attempt.id);
    await db.from("transactions").update({provider:provider.name,provider_reference:providerRef||reference,processing_at:null}).eq("id",tx.id);
    return {success:false,status:"pending",transaction_id:tx.id,requires_requery:true,provider:provider.name,provider_reference:providerRef||reference,attempt_no:attemptNo,message:"Provider returned a non-final status. Transaction remains pending and no failover was attempted."};
  }

  const finalMessage="All eligible providers returned a confirmed failure. Your wallet has been refunded.";
  await finalizeAndVerify(tx.id,"failed",lastFailure?.provider_reference||null,finalMessage,{failover:true,last_failure:lastFailure});
  await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
  return {success:false,status:"failed",transaction_id:tx.id,message:finalMessage,failover_exhausted:true,last_failure:lastFailure};
}

async function requeryTransaction(req:Request, body:any) {
  await authorize(req,false);
  const txId=String(body.transaction_id||""); if(!txId) throw new Error("transaction_id is required.");
  const {data:tx,error:txError}=await db.from("transactions").select("id,user_id,product_id,phone_number,amount,cost,profit,status,provider,provider_reference,service_type,customer_input").eq("id",txId).single();
  if(txError||!tx) throw new Error("Transaction not found.");
  if(["successful","failed","reversed"].includes(tx.status)) return {success:true,status:tx.status,transaction_id:tx.id,already_finalized:true};
  if(tx.status!=="pending") throw new Error("Only pending transactions can be re-queried.");

  const {data:attempt,error:attemptError}=await db.from("transaction_provider_attempts")
    .select("id,attempt_no,provider_id,endpoint_id,provider_reference,status,ambiguous,api_providers!inner(id,name,code,base_url,status),api_endpoints!inner(id,service_type,operation,method,path,headers_template,request_template,response_mapping,timeout_ms,active)")
    .eq("transaction_id",tx.id).eq("ambiguous",true).order("attempt_no",{ascending:false}).limit(1).maybeSingle();
  if(attemptError) throw new Error("Provider attempt lookup failed: "+attemptError.message);
  if(!attempt) return {success:false,status:"pending",transaction_id:tx.id,requires_manual_review:true,message:"No ambiguous provider attempt is recorded for this transaction."};

  const provider=attempt.api_providers;
  if(!provider || provider.status!=="active") throw new Error("The provider used by the pending attempt is not active.");
  const {data:txService}=await db.from("transactions").select("service_type").eq("id",tx.id).single();
  const statusRoutes=await getServiceOperationRoutes(String(txService?.service_type||""),"status",provider.id);
  const endpoint=statusRoutes[0]?.endpoint||null;
  if(!endpoint) throw new Error("No active status capability is configured for the provider used by this transaction.");
  const reference=String(attempt.provider_reference||tx.provider_reference||"");
  if(!reference) return {success:false,status:"pending",transaction_id:tx.id,requires_manual_review:true,message:"The ambiguous provider attempt has no reference to re-query."};

  const customerInput=(tx.customer_input&&typeof tx.customer_input==="object")?tx.customer_input:{};
  const credentials=await getCredentials(provider.id);
  const ctx={...customerInput,customer_input:customerInput,service_type:tx.service_type||"",
    reference,transaction_id:tx.id,user_id:tx.user_id,phone:customerInput.phone||tx.phone_number,phone_number:customerInput.phone||tx.phone_number,
    credential:credentials,credentials};

  const headers=deepRender(endpoint.headers_template||{},ctx);
  const renderedPath=deepRender(endpoint.path,ctx);
  const url=new URL(renderedPath,provider.base_url).toString();
  const method=endpoint.method.toUpperCase();
  const request=deepRender(endpoint.request_template||{},ctx);
  let requestUrl=url; const options:any={method,headers};
  if(method==="GET"||method==="DELETE") for(const [k,v] of Object.entries(request||{})) requestUrl+=(requestUrl.includes("?")?"&":"?")+encodeURIComponent(k)+"="+encodeURIComponent(String(v??""));
  else options.body=JSON.stringify(request);

  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),Math.min(Math.max(Number(endpoint.timeout_ms)||15000,1000),60000));
  let response:Response; let raw="";
  try { response=await fetch(requestUrl,{...options,signal:controller.signal}); raw=await response.text(); }
  catch(err) {
    clearTimeout(timer);
    return {success:false,status:"pending",transaction_id:tx.id,provider:provider.name,provider_reference:reference,requires_requery:true,message:err instanceof Error&&err.name==="AbortError"?"Provider status request timed out.":"Provider status request failed."};
  }
  clearTimeout(timer);

  let parsed:any; try{parsed=JSON.parse(raw);}catch{parsed={raw};}
  const rm=endpoint.response_mapping||{};
  const statusValue=getPath(parsed,"data.current_status")??getPath(parsed,"transaction.status")??getPath(parsed,rm.status_path||"status");
  const providerStatus=normalizeStatus(statusValue,rm);
  const providerRef=getPath(parsed,"data.reference")??getPath(parsed,"transaction.reference")??getPath(parsed,rm.reference_path||"reference")??reference;
  const providerMessage=getPath(parsed,"data.msg")??getPath(parsed,"transaction.response")??getPath(parsed,rm.message_path||"response")??getPath(parsed,"message")??raw.slice(0,500);

  if(providerStatus==="successful"){
    await db.from("transaction_provider_attempts").update({status:"successful",provider_status:String(statusValue??""),provider_reference:String(providerRef),response:parsed,completed_at:new Date().toISOString(),ambiguous:false}).eq("id",attempt.id);
    await finalizeAndVerify(tx.id,"successful",String(providerRef),String(providerMessage||""),parsed);
    await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
    return {success:true,status:"successful",transaction_id:tx.id,provider:provider.name,provider_reference:String(providerRef),attempt_no:attempt.attempt_no,message:String(providerMessage||"")};
  }

  if(providerStatus==="failed"){
    await db.from("transaction_provider_attempts").update({status:"failed",provider_status:String(statusValue??""),provider_reference:String(providerRef),response:parsed,completed_at:new Date().toISOString(),ambiguous:false,error_code:"REQUERY_CONFIRMED_FAILURE",error_message:String(providerMessage||"")}).eq("id",attempt.id);
    await finalizeAndVerify(tx.id,"failed",String(providerRef),String(providerMessage||"Provider confirmed the transaction failed."),parsed);
    await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
    return {success:false,status:"failed",transaction_id:tx.id,provider:provider.name,provider_reference:String(providerRef),attempt_no:attempt.attempt_no,message:String(providerMessage||"")};
  }

  await db.from("transactions").update({provider:provider.name,provider_reference:reference,processing_at:null,api_response:parsed}).eq("id",tx.id);
  return {success:false,status:"pending",transaction_id:tx.id,provider:provider.name,provider_reference:reference,attempt_no:attempt.attempt_no,requires_requery:true,message:"Provider has not returned a final status. Transaction remains pending.",diagnostic:{http_status:response.status,detected_status:String(statusValue??""),normalized_status:providerStatus,response:parsed}};
}

async function testProvider(req:Request, body:any) {
  await authorize(req,false);
  const providerId=String(body.provider_id||"");if(!providerId)throw new Error("provider_id is required.");
  const {data:provider,error}=await db.from("api_providers").select("*").eq("id",providerId).single();if(error||!provider)throw new Error("Provider not found.");
  const operation=String(body.operation||"balance");
  const requestedServiceType=body.service_type?String(body.service_type):null;
  let routes:any[]=[];
  if(requestedServiceType) routes=await getServiceOperationRoutes(requestedServiceType,operation,providerId);
  else {
    const {data:services,error:sError}=await db.from("provider_services").select("service_type").eq("provider_id",providerId).eq("enabled",true);
    if(sError) throw new Error("Provider service lookup failed: "+sError.message);
    for(const s of (services||[])) routes.push(...await getServiceOperationRoutes(String(s.service_type),operation,providerId));
  }
  const route=routes[0];
  const endpoint=route?.endpoint||null;
  if(!endpoint)throw new Error("No active configured endpoint for provider operation "+operation+".");
  const credentials=await getCredentials(providerId);const ctx={credential:credentials,credentials,reference:"TEST-"+crypto.randomUUID(),amount:0,phone:body.phone||"08000000000",network:body.network||"MTN"};
  const headers=deepRender(endpoint.headers_template||{},ctx);if(!headers["Content-Type"]&&!headers["content-type"])headers["Content-Type"]="application/json";
  const path=deepRender(endpoint.path,ctx);const url=new URL(path,provider.base_url).toString();const method=endpoint.method.toUpperCase();const request=deepRender(endpoint.request_template||{},ctx);
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.min(Math.max(Number(endpoint.timeout_ms)||15000,1000),60000));
  try{const res=await fetch(url,{method,headers,body:(method==="GET"||method==="DELETE")?undefined:JSON.stringify(request),signal:controller.signal});const textBody=await res.text();let data;try{data=JSON.parse(textBody)}catch{data=textBody}return {success:res.ok,http_status:res.status,response:data};}finally{clearTimeout(timer);}
}
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});try{const body=await req.json();const action=String(body.action||"");if(action==="dry_run_purchase")return json(await dryRunPurchase(req,body));if(action==="execute_purchase")return json(await executePurchase(req,body));if(action==="requery_transaction")return json(await requeryTransaction(req,body));if(action==="test_provider")return json(await testProvider(req,body));throw new Error("Unknown execution action.");}catch(e){return json({success:false,error:e instanceof Error?e.message:"Execution failed."},400);}});
