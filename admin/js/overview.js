// Bindawasub Admin — reference dashboard overview
function overviewStatus(status){
  return '<span class="badge '+(status==="successful"?"on":status==="failed"?"off":"")+'">'+escapeHtml(status||"pending")+'</span>';
}
async function loadOverview(){
  try{
    const d=await admin({action:"dashboard_summary"});
    const s=d.summary||{};
    $("mCustomers").textContent=s.customers??"0";
    $("mProducts").textContent=s.products??"0";
    $("mProviders").textContent=s.providers??"0";
    $("mWallet").textContent=money(s.wallet_liability||0);
    $("mSales").textContent=money(s.sales||0);
    $("mProfit").textContent=money(s.profit||0);
    $("mSuccess").textContent=s.successful_transactions??"0";
    $("mPending").textContent=s.pending_transactions??"0";

    const analytics=await admin({action:"analytics",days:7});
    const series=analytics.series||[];
    const values=series.map(x=>Number(x.sales)||0);
    const max=Math.max(...values,1);
    const chart=$("overviewChart");
    if(chart){
      chart.innerHTML=values.map((v,i)=>{
        const date=series[i]?.date||"";
        return '<div class="overview-bar" title="'+escapeHtml(date)+' — '+escapeHtml(money(v))+'" style="height:'+Math.max(5,Math.round((v/max)*175))+'px"><span>'+escapeHtml(String(date).slice(5))+'</span></div>';
      }).join("")||'<span class="muted">No sales activity in the last 7 days.</span>';
    }

    const tx=await admin({action:"list_transactions",status:"",search:"",limit:6});
    const rows=tx.transactions||[];
    const body=$("overviewTransactionRows");
    if(body){
      body.innerHTML=rows.map(t=>{
        const u=t.users||{}, p=t.products||{};
        const time=t.created_at?new Date(t.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"—";
        return '<tr><td><strong>#'+escapeHtml(String(t.id||"").slice(0,8).toUpperCase())+'</strong></td><td>'+escapeHtml(u.name||u.phone||"—")+'</td><td>'+escapeHtml(p.product_name||t.description||"—")+'</td><td>'+escapeHtml(t.provider||"—")+'</td><td><strong>'+money(t.amount||0)+'</strong></td><td>'+overviewStatus(t.status)+'</td><td>'+escapeHtml(time)+'</td></tr>';
      }).join("")||'<tr><td colspan="7" class="muted">No recent transactions.</td></tr>';
    }
    $("dashboardTransactionsButton")?.addEventListener("click",()=>document.querySelector('[data-tab="transactions"]')?.click());
    document.querySelector('[data-tab-jump="reliability"]')?.addEventListener("click",()=>document.querySelector('[data-tab="reliability"]')?.click());
    msg($("overviewMsg"),"Dashboard refreshed.","success");
  }catch(e){
    console.error("Overview failed:",e);
    msg($("overviewMsg"),e.message,"error");
  }
}