// Bindawasub Admin — reference dashboard overview
function overviewStatus(status){
  return '<span class="badge '+(status==="successful"?"on":status==="failed"?"off":"")+'">'+escapeHtml(status||"pending")+'</span>';
}

function renderOverviewChart(series){
  const chart=$("overviewChart");
  if(!chart)return;
  const rows=Array.isArray(series)?series:[];
  const values=rows.map(x=>Number(x.sales)||0);
  if(!values.length){
    chart.innerHTML='<span class="muted">No sales activity in the last 7 days.</span>';
    return;
  }
  const max=Math.max(...values,1);
  chart.innerHTML=rows.map((x,i)=>{
    const date=String(x?.date||"");
    const value=values[i];
    return '<div class="overview-bar" title="'+escapeHtml(date)+' — '+escapeHtml(money(value))+'" style="height:'+Math.max(5,Math.round((value/max)*175))+'px"><span>'+escapeHtml(date.slice(5))+'</span></div>';
  }).join("");
}

function renderOverviewTransactions(rows){
  const body=$("overviewTransactionRows");
  if(!body)return;
  const list=Array.isArray(rows)?rows:[];
  body.innerHTML=list.map(t=>{
    const u=t.users||{}, p=t.products||{};
    const time=t.created_at
      ?new Date(t.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})
      :"—";
    return '<tr><td><strong>#'+escapeHtml(String(t.id||"").slice(0,8).toUpperCase())+
      '</strong></td><td>'+escapeHtml(u.name||u.phone||"—")+
      '</td><td>'+escapeHtml(p.product_name||t.description||"—")+
      '</td><td>'+escapeHtml(t.provider||"—")+
      '</td><td><strong>'+money(t.amount||0)+
      '</strong></td><td>'+overviewStatus(t.status)+
      '</td><td>'+escapeHtml(time)+'</td></tr>';
  }).join("")||'<tr><td colspan="7" class="muted">No recent transactions.</td></tr>';
}

async function loadOverview(){
  const chart=$("overviewChart");
  const body=$("overviewTransactionRows");
  try{
    // Keep the KPI call independent, then load the two visual panels in
    // parallel so one query cannot leave both panels stuck on "Loading…".
    const summaryPromise=admin({action:"dashboard_summary"});
    const analyticsPromise=admin({action:"analytics",days:7});
    const transactionsPromise=admin({action:"list_transactions",status:"",search:"",limit:6});

    const d=await summaryPromise;
    const s=d.summary||{};
    $("mCustomers").textContent=s.customers??"0";
    $("mProducts").textContent=s.products??"0";
    $("mProviders").textContent=s.providers??"0";
    $("mWallet").textContent=money(s.wallet_liability||0);
    $("mSales").textContent=money(s.sales||0);
    $("mProfit").textContent=money(s.profit||0);
    $("mSuccess").textContent=s.successful_transactions??"0";
    $("mPending").textContent=s.pending_transactions??"0";

    try{
      const analytics=await analyticsPromise;
      renderOverviewChart(analytics.series||[]);
    }catch(error){
      console.error("Overview analytics failed:",error);
      if(chart)chart.innerHTML='<span class="muted">Unable to load transaction overview.</span>';
    }

    try{
      const tx=await transactionsPromise;
      renderOverviewTransactions(tx.transactions||[]);
    }catch(error){
      console.error("Recent transactions failed:",error);
      if(body)body.innerHTML='<tr><td colspan="7" class="muted">Unable to load recent transactions.</td></tr>';
    }

    $("dashboardTransactionsButton")?.addEventListener("click",()=>{
      document.querySelector('[data-tab="transactions"]')?.click();
    });
    document.querySelector('[data-tab-jump="reliability"]')?.addEventListener("click",()=>{
      document.querySelector('[data-tab="reliability"]')?.click();
    });
    msg($("overviewMsg"),"Dashboard refreshed.","success");
  }catch(e){
    console.error("Overview failed:",e);
    if(chart)chart.innerHTML='<span class="muted">Unable to load transaction overview.</span>';
    if(body)body.innerHTML='<tr><td colspan="7" class="muted">Unable to load recent transactions.</td></tr>';
    msg($("overviewMsg"),e.message||"Dashboard could not be loaded.","error");
  }
}

window.loadOverview=loadOverview;
