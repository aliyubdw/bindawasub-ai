// Bindawasub Admin — transactions

async function executeTransaction(id){
  if(!confirm("Execute this pending transaction with the configured provider?\n\nThis will send the purchase request. It will NOT debit the wallet again."))return;
  try{
    const r=await fetch(ADMIN_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await token()},body:JSON.stringify({action:"execute_purchase",transaction_id:id})});
    const raw=await r.text(); let d={}; try{d=raw?JSON.parse(raw):{}}catch{}
    if(!r.ok||d.success===false&&d.status!=="pending")throw Error("HTTP "+r.status+": "+(d.error||d.message||raw||"Empty response"));
    const text=d.status==="successful"?"Provider confirmed the purchase successfully.":d.status==="failed"?"Provider reported failure. The transaction was finalized and the wallet was refunded.":d.message||"Transaction remains pending; no duplicate purchase will be sent automatically.";
    msg($("transactionMsg"),text,d.status==="failed"?"error":"success"); await loadTransactions(); await loadOverview();
  }catch(e){msg($("transactionMsg"),"Execute failed: "+(e?.message||String(e)),"error")}
}

async function requeryTransaction(id){
  if(!confirm("Re-query this pending transaction with the provider? No purchase/retry request will be sent."))return;
  try{
    const r=await fetch(EXECUTION_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await token()},body:JSON.stringify({action:"requery_transaction",transaction_id:id})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.success===false&&d.status!=="pending")throw Error(d.error||d.message||"Requery failed.");
    msg($("transactionMsg"),d.status==="successful"?"Provider confirmed delivery and the transaction was finalized.":d.status==="failed"?"Provider reported failure and the transaction was finalized/refunded.":d.message||"Transaction remains pending.","success");
    await loadTransactions();
    await loadOverview();
    if(d.status==="successful"||d.status==="failed"){
      $("modal").classList.add("hidden");
    }
  }catch(e){msg($("transactionMsg"),e.message,"error")}
}

async function dryRunTransaction(id){
  try{
    const r=await fetch(EXECUTION_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await token()},body:JSON.stringify({action:"dry_run_purchase",transaction_id:id})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.success===false)throw Error(d.error||d.message||"Dry run failed.");
    const ep=d.endpoint||{};
    $("modalTitle").textContent="🧪 Provider Dry Run";
    $("modalBody").innerHTML='<div class="msg info">DRY RUN ONLY — no provider request was sent and no transaction or wallet state was changed.</div>'+
      '<div class="card" style="background:#f7faf8">'+
      '<p><strong>Provider</strong><br>'+escapeHtml(d.provider||"—")+'</p>'+
      '<p><strong>Endpoint</strong><br>'+escapeHtml((ep.method||"")+" "+(ep.url||""))+'</p>'+
      '<p><strong>Headers</strong></p><pre style="white-space:pre-wrap;word-break:break-word">'+escapeHtml(JSON.stringify(ep.headers||{},null,2))+'</pre>'+
      '<p><strong>Request body</strong></p><pre style="white-space:pre-wrap;word-break:break-word">'+escapeHtml(JSON.stringify(ep.request||{},null,2))+'</pre>'+
      '<p><strong>Provider plan</strong><br>'+escapeHtml((d.mapping&&d.mapping.provider_plan_id)||"—")+'</p>'+
      '</div>';
    $("modal").classList.remove("hidden");
  }catch(e){msg($("transactionMsg"),"Dry run failed: "+e.message,"error")}
}

async function loadTransactions(){
  try{
    const d=await admin({action:"list_transactions",status:$("transactionStatus").value,search:$("transactionSearch").value.trim(),limit:100});
    const rows=d.transactions||[];
    $("transactionRows").innerHTML=rows.map(t=>{
      const product=t.products?.product_name||"—";
      const customer=t.users?.name||t.users?.phone||"—";
      const status=t.status||"pending";
      return '<tr><td><code>'+escapeHtml(t.id)+'</code></td><td><span class="badge">'+escapeHtml(t.source||"web")+'</span></td><td><strong>'+escapeHtml(t.users?.name||"—")+'</strong><br><span class="muted">'+escapeHtml(t.users?.phone||t.phone_number||"—")+'</span></td><td>'+money(t.amount)+'</td><td title="'+escapeHtml(t.description||"")+'">'+escapeHtml(t.description||"—")+'</td><td><span class="badge '+(status==="successful"?"on":status==="failed"||status==="reversed"?"off":"")+'">'+escapeHtml(status)+'</span></td><td>'+money(t.balance_before)+'</td><td>'+money(t.balance_after)+'</td><td><button class="secondary" onclick="viewTransaction(\''+t.id+'\')">View</button> '+(status==="pending"&&t.provider_reference?'<button onclick="requeryTransaction(\''+t.id+'\')">Requery</button>':"")+(status==="pending"?' '+(!t.provider_reference?'<button onclick="executeTransaction(\''+t.id+'\')">Execute</button>': '<button onclick="requeryTransaction(\''+t.id+'\')">Requery</button>')+'<button onclick="manualTransactionUpdate(\''+t.id+'\',\'successful\')">Success</button><button class="danger" onclick="manualTransactionUpdate(\''+t.id+'\',\'failed\')">Failed</button><button class="secondary" onclick="manualTransactionUpdate(\''+t.id+'\',\'refunded\')">Refund</button><button class="secondary" onclick="dryRunTransaction(\''+t.id+'\')">🧪 Dry Run</button>':"")+'</td></tr>';
    }).join("")||'<tr><td colspan="9" class="muted">No transactions found.</td></tr>';
    window._transactions=rows;
    msg($("transactionMsg"),rows.length+" transaction(s) loaded.","success");
  }catch(e){msg($("transactionMsg"),e.message,"error")}
}

async function manualTransactionUpdate(id,action){
  const labels={successful:"Success",failed:"Failed",refunded:"Refund"};
  const label=labels[action]||action;
  const defaultText=action==="refunded"?"Transaction manually refunded by admin.":action==="failed"?"Transaction manually marked failed by admin. Wallet refunded.":"Transaction manually marked successful by admin.";
  const description=prompt("Transaction description:",defaultText);
  if(description===null)return;
  if(!confirm("Mark this pending transaction as "+label+"?"+(action==="failed"||action==="refunded"?"\\n\\nThe customer wallet will be refunded.":"")))return;
  try{
    const d=await admin({action:"manual_transaction_update",transaction_id:id,manual_action:action,description});
    if(!d.success)throw Error(d.error||"Manual update failed.");
    msg($("transactionMsg"),"Transaction updated: "+label+(d.refund_reference?" — "+d.refund_reference:""),"success");
    await loadTransactions(); await loadOverview();
  }catch(e){msg($("transactionMsg"),e.message,"error")}
}

async function viewTransaction(id){
  const t=(window._transactions||[]).find(x=>x.id===id);
  if(!t)return;
  const p=t.products||{}, u=t.users||{};
  $("modalTitle").textContent="Transaction Details";
  $("modalBody").innerHTML='<div class="grid2"><div><p><strong>Transaction ID</strong><br><code>'+escapeHtml(t.id)+'</code></p><p><strong>Source</strong><br><span class="badge">'+escapeHtml(t.source||"web")+'</span></p><p><strong>Status</strong><br>'+escapeHtml(t.status)+'</p><p><strong>User</strong><br>'+escapeHtml(u.name||"—")+'<br>'+escapeHtml(u.phone||t.phone_number||"—")+'<br>'+escapeHtml(u.email||"")+'</p></div><div><p><strong>Product</strong><br>'+escapeHtml(p.product_name||"—")+'</p><p><strong>Amount</strong><br>'+money(t.amount)+'</p><p><strong>Cost / Profit</strong><br>'+money(t.cost)+" / "+money(t.profit)+'</p><p><strong>Balance Before</strong><br>'+money(t.balance_before)+'</p><p><strong>Balance After</strong><br>'+money(t.balance_after)+'</p></div></div><div class="card" style="background:#f7faf8"><p><strong>Provider</strong><br>'+escapeHtml(t.provider||"—")+'<br>'+escapeHtml(t.provider_reference||"No provider reference")+'</p><p><strong>Description</strong><br>'+escapeHtml(t.description||"—")+'</p><p><strong>Recipient</strong><br>'+escapeHtml(t.phone_number||"—")+'</p></div><div class="card" style="background:#f7faf8"><p><strong>Current API Response</strong></p><pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:12px">'+escapeHtml(t.api_response?JSON.stringify(t.api_response,null,2):"No API response saved.")+'</pre></div><div class="card" style="background:#f7faf8"><p><strong>Timeline / Audit Trail</strong></p><div id="transactionTimeline"><span class="muted">Loading timeline…</span></div></div><div class="card" style="background:#f7faf8"><p><strong>Created:</strong> '+escapeHtml(new Date(t.created_at).toLocaleString())+'</p><p><strong>Completed:</strong> '+escapeHtml(t.completed_at?new Date(t.completed_at).toLocaleString():"Not completed")+'</p></div>';
  $("modal").classList.remove("hidden");
  try{
    const d=await admin({action:"transaction_events",transaction_id:id});
    const events=d.events||[];
    $("transactionTimeline").innerHTML=events.length?'<div class="timeline">'+events.map(ev=>{
      const actor=ev.actor_type==="admin"?"Admin":ev.actor_type==="provider"?"Provider":"System";
      const meta=[actor,ev.provider,ev.provider_reference].filter(Boolean).join(" • ");
      const response=ev.api_response?'<details><summary>API response</summary><pre>'+escapeHtml(JSON.stringify(ev.api_response,null,2))+'</pre></details>':"";
      const balances=(ev.balance_before!=null||ev.balance_after!=null)?'<div class="muted">Balance: '+money(ev.balance_before)+' → '+money(ev.balance_after)+'</div>':"";
      return '<div class="event"><h4>'+escapeHtml(ev.title)+'</h4><small>'+escapeHtml(new Date(ev.created_at).toLocaleString())+' • '+escapeHtml(meta)+'</small><p>'+escapeHtml(ev.description||"")+'</p>'+balances+response+'</div>';
    }).join("")+'</div>':'<p class="muted">No persisted audit events yet. New transactions will record their lifecycle here.</p>';
  }catch(e){
    $("transactionTimeline").innerHTML='<div class="msg error">'+escapeHtml(e.message)+'</div>';
  }
}
