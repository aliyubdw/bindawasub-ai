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
function deepRender(value:any, ctx:any):any {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m,key)=>{
      const v=getPath(ctx,key.trim());
      return v === undefined || v === null ? "" : String(v);
    });
  }
  if (Array.isArray(value)) return value.map(v=>deepRender(v,ctx));
  if (value && typeof value === "object") {
    const out:any={}; for (const [k,v] of Object.entries(value)) out[k]=deepRender(v,ctx); return out;
  }
  return value;
}
function normalizeStatus(v:any, map:any) {
  const s=String(v ?? "").trim().toLowerCase();
  const success=(map.success_values||["success","successful","completed","complete","true","1","ok"]).map((x:any)=>String(x).toLowerCase());
  const pending=(map.pending_values||["pending","processing","queued","queue","in_progress","in progress"]).map((x:any)=>String(x).toLowerCase());
  const failed=(map.failed_values||["failed","failure","error","false","0","cancelled","canceled"]).map((x:any)=>String(x).toLowerCase());
  if(success.includes(s)) return "successful";
  if(pending.includes(s)) return "pending";
  if(failed.includes(s)) return "failed";
  return "pending";
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
async function getCredentials(providerId:string) {
  const {data,error}=await db.rpc("get_provider_credentials",{p_provider_id:providerId});
  if(error) throw new Error("Provider credentials unavailable: "+error.message);
  if(!data) throw new Error("Provider credentials are not configured.");
  try { return JSON.parse(data); } catch { return {api_key:String(data)}; }
}
async function executePurchase(req:Request, body:any) {
  await authorize(req,false);
  const txId=String(body.transaction_id||"");
  if(!txId) throw new Error("transaction_id is required.");

  const {data:tx,error:txError}=await db.from("transactions")
    .select("id,user_id,product_id,phone_number,amount,cost,profit,status,provider,provider_reference")
    .eq("id",txId).single();
  if(txError || !tx) throw new Error("Transaction not found.");
  if(["successful","failed","reversed"].includes(tx.status)) return {success:true,status:tx.status,transaction_id:tx.id,already_finalized:true};
  if(tx.provider_reference) return {success:false,status:"pending",transaction_id:tx.id,requires_requery:true,message:"This transaction already has a provider reference and must be re-queried before any retry."};

  const claim=await db.rpc("claim_vtu_transaction",{p_transaction_id:tx.id});
  if(claim.error) throw new Error("Transaction lock failed: "+claim.error.message);
  if(!claim.data?.claimed) return {success:false,status:"pending",transaction_id:tx.id,locked:true,message:"Transaction is already being processed or requires provider requery."};

  const {data:product,error:pError}=await db.from("products").select("id,product_name,network,service_type,volume,duration,selling_price,cost_price,active").eq("id",tx.product_id).single();
  if(pError || !product) throw new Error("Product not found.");
  if(!product.active) throw new Error("Product is inactive.");

  const {data:mappings,error:mError}=await db.from("provider_plan_mappings")
    .select("id,provider_id,provider_plan_id,provider_plan_name,provider_cost,provider_status,priority,metadata,api_providers!inner(id,name,code,base_url,status)")
    .eq("product_id",product.id).eq("active",true).eq("api_providers.status","active")
    .order("priority",{ascending:true});
  if(mError) throw new Error("Provider mapping lookup failed: "+mError.message);
  const mapping=(mappings||[]).find((m:any)=>m.provider_status==="active");
  if(!mapping) throw new Error("No active provider Plan ID mapping is available for this product.");

  const provider=mapping.api_providers;
  const {data:endpoint,error:eError}=await db.from("api_endpoints").select("*")
    .eq("provider_id",provider.id).eq("service_type",product.service_type).eq("operation","purchase").eq("active",true).maybeSingle();
  if(eError || !endpoint) throw new Error("No active purchase endpoint is configured for "+provider.name+".");

  const credentials=await getCredentials(provider.id);
  const reference="BW-"+tx.id;
  const ctx={
    phone:tx.phone_number, phone_number:tx.phone_number, amount:tx.amount,
    network:product.network, volume:product.volume, duration:product.duration,
    provider_plan_id:mapping.provider_plan_id, provider_plan_name:mapping.provider_plan_name,
    product_id:product.id, transaction_id:tx.id, user_id:tx.user_id, reference,
    credential:credentials, credentials
  };

  const headers=deepRender(endpoint.headers_template||{},ctx);
  if(!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"]="application/json";
  const renderedPath=deepRender(endpoint.path,ctx);
  const url=new URL(renderedPath,provider.base_url).toString();
  const method=endpoint.method.toUpperCase();
  const renderedRequest=deepRender(endpoint.request_template||{},ctx);
  let requestUrl=url;
  const options:any={method,headers};
  if(method==="GET" || method==="DELETE"){
    for(const [k,v] of Object.entries(renderedRequest||{})) requestUrl+=(requestUrl.includes("?")?"&":"?")+encodeURIComponent(k)+"="+encodeURIComponent(String(v??""));
  } else {
    options.body=JSON.stringify(renderedRequest);
  }

  await db.from("transactions").update({
    provider:provider.name,
    cost:mapping.provider_cost ?? tx.cost,
    profit:tx.amount - Number(mapping.provider_cost ?? tx.cost ?? 0)
  }).eq("id",tx.id);

  await db.rpc("record_transaction_event", {
    p_transaction_id: tx.id,
    p_event_type: "provider_request",
    p_title: "Provider request sent",
    p_description: provider.name + " purchase request was sent.",
    p_status: tx.status,
    p_actor_type: "system",
    p_provider: provider.name,
    p_provider_reference: reference,
    p_amount: tx.amount,
    p_metadata: { method, url: requestUrl, operation: "purchase" }
  });


  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.min(Math.max(Number(endpoint.timeout_ms)||15000,1000),60000));
  let response:Response;
  let raw="";
  try {
    response=await fetch(requestUrl,{...options,signal:controller.signal});
    raw=await response.text();
  } catch(e) {
    clearTimeout(timer);
    const message=e instanceof Error && e.name==="AbortError" ? "Provider request timed out." : "Provider request failed.";
    await db.from("transactions").update({provider_reference:reference,processing_at:null}).eq("id",tx.id);
    return {success:false,status:"pending",transaction_id:tx.id,requires_requery:true,message};
  }
  clearTimeout(timer);

  let parsed:any; try { parsed=JSON.parse(raw); } catch { parsed={raw}; }
  const rm=endpoint.response_mapping||{};
  const statusValue=getPath(parsed,rm.status_path||"status") ?? getPath(parsed,"data.status") ?? (response.ok ? "success" : "failed");
  const providerStatus=normalizeStatus(statusValue,rm);
  const providerRef=getPath(parsed,rm.reference_path||"reference") ?? getPath(parsed,"data.reference") ?? getPath(parsed,"data.transaction_id") ?? null;
  const providerMessage=getPath(parsed,rm.message_path||"message") ?? getPath(parsed,"data.message") ?? raw.slice(0,500);

  if(providerStatus==="successful"){
    const result=await db.rpc("finalize_vtu_transaction",{p_transaction_id:tx.id,p_provider_status:"successful",p_provider_reference:providerRef||reference,p_provider_message:String(providerMessage||""),p_provider_response:parsed});
    if(result.error) throw new Error("Finalization failed: "+result.error.message);
    await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
  } else if(providerStatus==="failed"){
    const result=await db.rpc("finalize_vtu_transaction",{p_transaction_id:tx.id,p_provider_status:"failed",p_provider_reference:providerRef||reference,p_provider_message:String(providerMessage||""),p_provider_response:parsed});
    if(result.error) throw new Error("Refund/finalization failed: "+result.error.message);
    await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
  } else {
    await db.from("transactions").update({provider_reference:providerRef||reference,processing_at:null}).eq("id",tx.id);
  }
  return {success:providerStatus==="successful",status:providerStatus,transaction_id:tx.id,provider:provider.name,provider_reference:providerRef||reference,message:String(providerMessage||"")};
}
async function requeryTransaction(req:Request, body:any) {
  await authorize(req,false);
  const txId=String(body.transaction_id||"");
  if(!txId) throw new Error("transaction_id is required.");

  const {data:tx,error:txError}=await db.from("transactions")
    .select("id,user_id,product_id,phone_number,amount,cost,profit,status,provider,provider_reference")
    .eq("id",txId).single();
  if(txError || !tx) throw new Error("Transaction not found.");
  if(["successful","failed","reversed"].includes(tx.status))
    return {success:true,status:tx.status,transaction_id:tx.id,already_finalized:true};
  if(tx.status!=="pending") throw new Error("Only pending transactions can be re-queried.");
  if(!tx.provider_reference)
    return {success:false,status:"pending",transaction_id:tx.id,requires_manual_review:true,message:"No provider/customer reference is saved for this transaction. No purchase request was sent by requery."};

  const {data:product,error:pError}=await db.from("products")
    .select("id,service_type")
    .eq("id",tx.product_id).single();
  if(pError || !product) throw new Error("Product not found.");

  const {data:mappings,error:mError}=await db.from("provider_plan_mappings")
    .select("id,provider_id,api_providers!inner(id,name,code,base_url,status)")
    .eq("product_id",product.id).eq("active",true).eq("api_providers.status","active")
    .order("priority",{ascending:true});
  if(mError) throw new Error("Provider mapping lookup failed: "+mError.message);
  const mapping=(mappings||[])[0];
  if(!mapping) throw new Error("No active provider mapping is available for this product.");
  const provider=mapping.api_providers;

  const {data:endpoint,error:eError}=await db.from("api_endpoints").select("*")
    .eq("provider_id",provider.id)
    .eq("service_type",product.service_type)
    .eq("operation","status")
    .eq("active",true).maybeSingle();
  if(eError || !endpoint) throw new Error("No active status/requery endpoint is configured for "+provider.name+".");

  const credentials=await getCredentials(provider.id);
  const ctx={
    reference:tx.provider_reference,
    transaction_id:tx.id,
    user_id:tx.user_id,
    phone:tx.phone_number,
    phone_number:tx.phone_number,
    credential:credentials,
    credentials
  };

  const headers=deepRender(endpoint.headers_template||{},ctx);
  const renderedPath=deepRender(endpoint.path,ctx);
  const url=new URL(renderedPath,provider.base_url).toString();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.min(Math.max(Number(endpoint.timeout_ms)||15000,1000),60000));

  let response:Response;
  let raw="";
  try {
    response=await fetch(url,{method:endpoint.method.toUpperCase(),headers,signal:controller.signal});
    raw=await response.text();
  } catch(e) {
    clearTimeout(timer);
    return {success:false,status:"pending",transaction_id:tx.id,requires_requery:true,message:e instanceof Error && e.name==="AbortError" ? "Provider status request timed out." : "Provider status request failed."};
  }
  clearTimeout(timer);

  let parsed:any;
  try { parsed=JSON.parse(raw); } catch { parsed={raw}; }
  const rm=endpoint.response_mapping||{};
  // SMEPlug may return either:
  // {status:"success", reference:"..."} OR
  // {status:true, data:{current_status:"success", reference:"...", msg:"..."}}
  // OR a transaction wrapper. Prefer the actual transaction status over the API-level boolean.
  const statusValue =
    getPath(parsed,"data.current_status") ??
    getPath(parsed,"transaction.status") ??
    getPath(parsed,rm.status_path||"status");
  const providerStatus=normalizeStatus(statusValue,rm);
  const providerRef =
    getPath(parsed,"data.reference") ??
    getPath(parsed,"transaction.reference") ??
    getPath(parsed,rm.reference_path||"reference") ??
    tx.provider_reference;
  const providerMessage =
    getPath(parsed,"data.msg") ??
    getPath(parsed,"transaction.response") ??
    getPath(parsed,rm.message_path||"response") ??
    getPath(parsed,"message") ??
    raw.slice(0,500);

  if(providerStatus==="successful"){
    const result=await db.rpc("finalize_vtu_transaction",{
      p_transaction_id:tx.id,
      p_provider_status:"successful",
      p_provider_reference:String(providerRef||tx.provider_reference),
      p_provider_message:String(providerMessage||""),
      p_provider_response:parsed
    });
    if(result.error) throw new Error("Finalization failed: "+result.error.message);
    await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
    return {success:true,status:"successful",transaction_id:tx.id,provider:provider.name,provider_reference:String(providerRef||tx.provider_reference),message:String(providerMessage||"")};
  }

  if(providerStatus==="failed"){
    const result=await db.rpc("finalize_vtu_transaction",{
      p_transaction_id:tx.id,
      p_provider_status:"failed",
      p_provider_reference:String(providerRef||tx.provider_reference),
      p_provider_message:String(providerMessage||""),
      p_provider_response:parsed
    });
    if(result.error) throw new Error("Refund/finalization failed: "+result.error.message);
    await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
    return {success:false,status:"failed",transaction_id:tx.id,provider:provider.name,provider_reference:String(providerRef||tx.provider_reference),message:String(providerMessage||"")};
  }

  await db.from("transactions").update({processing_at:null}).eq("id",tx.id);
  return {
    success:false,
    status:"pending",
    transaction_id:tx.id,
    provider:provider.name,
    provider_reference:tx.provider_reference,
    requires_requery:true,
    message:"Provider has not returned a final status. Transaction remains pending.",
    diagnostic:{
      http_status:response.status,
      detected_status:String(statusValue ?? ""),
      normalized_status:providerStatus,
      response:parsed
    }
  };
}

async function testProvider(req:Request, body:any) {
  await authorize(req,false);
  const providerId=String(body.provider_id||"");
  if(!providerId) throw new Error("provider_id is required.");
  const {data:provider,error}=await db.from("api_providers").select("*").eq("id",providerId).single();
  if(error||!provider) throw new Error("Provider not found.");
  const {data:endpoint,error:eError}=await db.from("api_endpoints").select("*").eq("provider_id",providerId).eq("operation",body.operation||"balance").eq("active",true).maybeSingle();
  if(eError||!endpoint) throw new Error("No active test endpoint configured for this operation.");
  const credentials=await getCredentials(providerId);
  const ctx={credential:credentials,credentials,reference:"TEST-"+crypto.randomUUID(),amount:0,phone:body.phone||"08000000000",network:body.network||"MTN"};
  const headers=deepRender(endpoint.headers_template||{},ctx);
  if(!headers["Content-Type"]&&!headers["content-type"]) headers["Content-Type"]="application/json";
  const path=deepRender(endpoint.path,ctx);
  const url=new URL(path,provider.base_url).toString();
  const method=endpoint.method.toUpperCase();
  const request=deepRender(endpoint.request_template||{},ctx);
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),Math.min(Math.max(Number(endpoint.timeout_ms)||15000,1000),60000));
  try{
    const res=await fetch(url,{method,headers,body:(method==="GET"||method==="DELETE")?undefined:JSON.stringify(request),signal:controller.signal});
    const textBody=await res.text(); let data; try{data=JSON.parse(textBody)}catch{data=textBody}
    return {success:res.ok,http_status:res.status,response:data};
  }finally{clearTimeout(timer);}
}
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  try{
    const body=await req.json(); const action=String(body.action||"");
    if(action==="execute_purchase") return json(await executePurchase(req,body));
    if(action==="requery_transaction") return json(await requeryTransaction(req,body));
    if(action==="test_provider") return json(await testProvider(req,body));
    throw new Error("Unknown execution action.");
  }catch(e){return json({success:false,error:e instanceof Error?e.message:"Execution failed."},400);}
});