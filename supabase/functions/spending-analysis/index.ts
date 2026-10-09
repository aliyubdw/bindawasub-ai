import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};

function scopeFromMessage(message:any){
  const m=String(message||"").toLowerCase().replace(/[’']/g,"'");
  let period="all";
  if(/\b(today|today's)\b/.test(m)||/\byau\b/.test(m)) period="today";
  else if(/\b(this week|this week's|week so far)\b/.test(m)||/(wannan mako|makon nan)/.test(m)) period="this_week";
  else if(/\b(this month|this month's|current month|so far this month)\b/.test(m)||/(wannan watan|watan nan|wannan wata)/.test(m)) period="this_month";
  else if(/\b(last month|previous month|past month|month before)\b/.test(m)||/(watan da ya wuce|watan baya)/.test(m)) period="last_month";
  let service_type:any=null;
  if(/\b(data|gb|gig|gigabytes|internet data|data plans|mobile data)\b/.test(m)) service_type="data";
  else if(/\b(airtime|recharge|credit)\b/.test(m)) service_type="airtime";
  else if(/\b(bill|bills|electricity|ekedc|ikedc|aedc|nepa|cable|tv|dstv|gotv|startimes|waec|neco)\b/.test(m)) service_type="bill";
  return {period,service_type};
}

function lagosBounds(period:string){
  const now=new Date();
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const y=Number(parts.find(p=>p.type==="year")?.value);
  const mo=Number(parts.find(p=>p.type==="month")?.value);
  const day=Number(parts.find(p=>p.type==="day")?.value);
  // Africa/Lagos is UTC+1 year-round: local midnight is 23:00 UTC on the previous day.
  const utcStart=(yy:number,mm:number,dd:number)=>new Date(Date.UTC(yy,mm-1,dd)-60*60*1000);
  if(period==="all") return {start:null,end:null,label:"all time"};
  if(period==="today"){
    const start=utcStart(y,mo,day);
    const end=new Date(start); end.setUTCDate(end.getUTCDate()+1);
    return {start:start.toISOString(),end:end.toISOString(),label:"today"};
  }
  if(period==="this_week"){
    const lagosDate=new Date(Date.UTC(y,mo-1,day));
    const weekday=lagosDate.getUTCDay();
    const start=new Date(lagosDate); start.setUTCDate(start.getUTCDate()-(weekday===0?6:weekday-1));
    const end=new Date(start); end.setUTCDate(end.getUTCDate()+7);
    return {start:start.toISOString(),end:end.toISOString(),label:"this week"};
  }
  const startMonth=period==="this_month"?mo:mo-1;
  const startYear=startMonth<1?y-1:y;
  const normalized=((startMonth-1+12)%12)+1;
  const endMonth=normalized===12?1:normalized+1;
  const endYear=normalized===12?startYear+1:startYear;
  return {start:utcStart(startYear,normalized,1).toISOString(),end:utcStart(endYear,endMonth,1).toISOString(),label:period==="this_month"?"this month":"last month"};
}

function money(n:number){return "₦"+Number(n||0).toLocaleString("en-NG",{minimumFractionDigits:2,maximumFractionDigits:2});}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return new Response(JSON.stringify({success:false,error:"POST required"}),{status:405,headers:{...corsHeaders,"Content-Type":"application/json"}});
  const serviceRoleKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // This endpoint uses the service-role client and accepts user_id in the body.
  // Restrict it to trusted server-to-server callers; never accept a caller-supplied user_id from public clients.
  if(!serviceRoleKey || req.headers.get("authorization") !== "Bearer "+serviceRoleKey) {
    return new Response(JSON.stringify({success:false,error:"Unauthorized"}),{status:401,headers:{...corsHeaders,"Content-Type":"application/json"}});
  }
  try{
    const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body=await req.json();
    const userId=String(body.user_id||"").trim();
    if(!userId) throw new Error("user_id is required");
    const scope=scopeFromMessage(body.message);
    const bounds=lagosBounds(scope.period);
    let q:any=db.from("transactions").select("id,created_at,amount,status,service_type,description,products(product_name,volume,service_type,service_networks(code,name))").eq("user_id",userId).eq("status","successful");
    if(bounds.start) q=q.gte("created_at",bounds.start);
    if(bounds.end) q=q.lt("created_at",bounds.end);
    if(scope.service_type) q=q.eq("service_type",scope.service_type);

    const rows:any[]=[];
    for(let from=0;;from+=1000){
      const {data,error}=await q.order("created_at",{ascending:false}).range(from,from+999);
      if(error) throw error;
      const page=data||[];
      rows.push(...page);
      // Continue until a short page proves that all matching rows have been fetched.
      if(page.length<1000) break;
    }

    const total=rows.reduce((s,r)=>s+Number(r.amount||0),0);
    const average=rows.length?total/rows.length:0;
    const byNetwork:any={}, byService:any={}, byDay:any={};
    let highest:any=null;
    for(const r of rows){
      const amount=Number(r.amount||0);
      const p=Array.isArray(r.products)?r.products[0]:r.products;
      const n=Array.isArray(p?.service_networks)?p.service_networks[0]:p?.service_networks;
      const network=String(n?.code||n?.name||"Other");
      byNetwork[network]=(byNetwork[network]||0)+amount;
      const service=String(r.service_type||p?.service_type||"other");
      byService[service]=(byService[service]||0)+amount;
      const day=new Date(r.created_at).toLocaleDateString("en-NG",{timeZone:"Africa/Lagos",day:"2-digit",month:"short"});
      byDay[day]=(byDay[day]||0)+amount;
      if(!highest||amount>Number(highest.amount||0)) highest=r;
    }
    const top=Object.entries(byNetwork).sort((a:any,b:any)=>Number(b[1])-Number(a[1]))[0]||null;
    const serviceLabel=scope.service_type==="data"?" on data":scope.service_type==="airtime"?" on airtime":scope.service_type==="bill"?" on bills":"";
    let answer="";
    if(!rows.length){
      answer="You have no successful purchases"+serviceLabel+" for "+bounds.label+".";
    }else{
      answer="You spent "+money(total)+serviceLabel+" "+bounds.label+" across "+rows.length+" successful purchase"+(rows.length===1?"":"s")+".";
      if(top) answer+=" Your top network was "+String(top[0])+" at "+money(Number(top[1]))+".";
      answer+=" Average purchase: "+money(average)+".";
      if(highest) answer+=" Highest single purchase: "+money(Number(highest.amount||0))+".";
    }
    return new Response(JSON.stringify({
      success:true,
      total_spent:total,
      purchase_count:rows.length,
      average_purchase:average,
      highest_purchase:highest?{amount:Number(highest.amount||0),created_at:highest.created_at,description:highest.description||null}:null,
      top_network:top?{network:String(top[0]),amount:Number(top[1])}:null,
      network_breakdown:Object.entries(byNetwork).sort((a:any,b:any)=>Number(b[1])-Number(a[1])).map(([network,amount])=>({network,amount:Number(amount)})),
      service_breakdown:Object.entries(byService).sort((a:any,b:any)=>Number(b[1])-Number(a[1])).map(([service,amount])=>({service,amount:Number(amount)})),
      daily_breakdown:Object.entries(byDay).reverse().map(([date,amount])=>({date,amount:Number(amount)})),
      scope:{period:scope.period,service_type:scope.service_type,label:bounds.label,start:bounds.start,end:bounds.end},
      answer,read_only:true
    }),{headers:{...corsHeaders,"Content-Type":"application/json"}});
  }catch(e){
    return new Response(JSON.stringify({success:false,error:e instanceof Error?e.message:String(e)}),{status:400,headers:{...corsHeaders,"Content-Type":"application/json"}});
  }
});