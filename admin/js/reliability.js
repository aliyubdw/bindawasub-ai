// Bindawasub Admin — reliability

async function runReliabilityTest(){
  const btn=$("runReliabilityTest");
  try{
    btn.disabled=true;
    btn.textContent="Running…";
    msg($("reliabilityMsg"),"Running synthetic database concurrency tests…","info");
    const r=await fetch(RELIABILITY_TEST_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer "+await token()
      },
      body:JSON.stringify({})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.success===false) throw Error(d.error||d.message||("HTTP "+r.status));
    const tests=d.tests||{};
    const claim=tests.claim||tests.concurrent_claim||{};
    const idem=tests.idempotency||tests.duplicate_idempotency||{};
    const passed=d.success===true;
    $("reliabilityResult").innerHTML=
      '<div class="msg '+(passed?"success":"error")+'"><strong>'+(passed?"ALL REPORTED TESTS PASSED":"TESTS NEED ATTENTION")+'</strong></div>'+
      '<div class="grid2">'+
      '<div class="card" style="background:#f7faf8"><strong>Concurrent claim</strong><p class="muted">'+escapeHtml(JSON.stringify(claim,null,2))+'</p></div>'+
      '<div class="card" style="background:#f7faf8"><strong>Idempotency</strong><p class="muted">'+escapeHtml(JSON.stringify(idem,null,2))+'</p></div>'+
      '</div>'+
      '<div class="card" style="background:#f7faf8"><strong>Safety checks</strong><p>Provider requests sent: <strong>'+escapeHtml(String(d.provider_requests_sent??0))+'</strong><br>Wallet debits: <strong>'+escapeHtml(String(d.wallet_debits??0))+'</strong><br>Real customer transactions changed: <strong>'+escapeHtml(String(d.real_customer_transactions_changed??0))+'</strong></p></div>'+
      '<details><summary>Full test result</summary><pre style="white-space:pre-wrap;word-break:break-word">'+escapeHtml(JSON.stringify(d,null,2))+'</pre></details>';
    msg($("reliabilityMsg"),"Reliability test completed. Review the results below.","success");
  }catch(e){
    $("reliabilityResult").innerHTML='<div class="msg error">'+escapeHtml(e.message)+'</div>';
    msg($("reliabilityMsg"),"Reliability test failed to run.","error");
  }finally{
    btn.disabled=false;
    btn.textContent="Run Test";
  }
}
