// Bindawasub Admin — persistent Supabase session and authenticated API

const SUPABASE_URL="https://fuktxjweuanatmurlzpg.supabase.co";
const KEY="sb_publishable_S1iARs058S3_XAUP1S_0Lw_oEnJuFe2";
const ADMIN_URL=SUPABASE_URL+"/functions/v1/bindawasub-admin";
const AI_URL=SUPABASE_URL+"/functions/v1/bindawasub-ai";
const RESET_URL=SUPABASE_URL+"/functions/v1/admin-reset-password";
const EXECUTION_URL=SUPABASE_URL+"/functions/v1/provider-execution";
const RELIABILITY_TEST_URL=SUPABASE_URL+"/functions/v1/provider-execution-test";
const CRM_URL=SUPABASE_URL+"/functions/v1/bindawasub-crm";

const sb=window.supabase.createClient(SUPABASE_URL,KEY,{
  auth:{
    persistSession:true,
    autoRefreshToken:true,
    detectSessionInUrl:false,
    storage:window.localStorage,
    storageKey:"bindawasub-admin-auth"
  }
});

async function token(forceRefresh=false){
  const current=await sb.auth.getSession();
  if(current.error)throw Error(current.error.message||"Unable to read session.");
  if(!forceRefresh&&current.data?.session?.access_token)return current.data.session.access_token;
  const refreshed=await sb.auth.refreshSession();
  if(refreshed.error||!refreshed.data?.session)throw Error("Session expired. Please log in again.");
  return refreshed.data.session.access_token;
}

async function requestWithSession(url,payload){
  let accessToken=await token(false);
  let r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","apikey":KEY,"Authorization":"Bearer "+accessToken},body:JSON.stringify(payload)});
  let d=await r.json().catch(()=>({}));
  const authFailure=!r.ok&&(r.status===401||r.status===403||/session|token|authentication|authorized|expired/i.test(String(d.error||"")));
  if(authFailure){
    accessToken=await token(true);
    r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","apikey":KEY,"Authorization":"Bearer "+accessToken},body:JSON.stringify(payload)});
    d=await r.json().catch(()=>({}));
  }
  if(!r.ok||d.success===false)throw Error(d.error||"Request failed.");
  return d;
}
async function admin(payload){return requestWithSession(ADMIN_URL,payload)}
async function aiAdmin(payload){return requestWithSession(AI_URL,payload)}
async function crmAdmin(payload){return requestWithSession(CRM_URL,payload)}
