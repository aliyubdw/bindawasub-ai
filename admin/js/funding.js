// Bindawasub Admin — funding

async function loadManualFundingSettings(){
  const d=await aiAdmin({action:"manual_funding_settings_get"});
  const s=d.settings||{};
  $("mfBankName").value=s.bank_name||"";
  $("mfAccountName").value=s.account_name||"";
  $("mfAccountNumber").value=s.account_number||"";
  $("mfInstructions").value=s.instructions||"";
  $("mfActive").value=s.active===false?"false":"true";
}

async function loadManualFundingRequests(){
  const box=document.getElementById("manualFundingRows");
  try{
    if(box) box.innerHTML='<tr><td colspan="9" class="muted">Checking for funding requests…</td></tr>';

    // One authenticated admin request is enough. "all" prevents a request from
    // disappearing because it moved from pending -> submitted or another state.
    const d=await admin({action:"manual_funding_requests",status:"all"});
    const rows=(d.requests||[]).slice().sort((a,b)=>{
      const da=new Date(a.submitted_at||a.created_at||0).getTime();
      const db=new Date(b.submitted_at||b.created_at||0).getTime();
      return db-da;
    });

    $("manualFundingRows").innerHTML=rows.map(r=>{
      const u=r.users||r.user||{};
      const customer=u.name||u.phone||r.user_id||"—";
      const submitted=r.submitted_at?r.submitted_at.replace("T"," ").replace("Z",""):(r.created_at?r.created_at.replace("T"," ").replace("Z",""):"—");
      const status=r.status||"—";
      const statusClass=status==="approved"?"on":status==="rejected"?"off":"";
      const reason=r.note||r.rejection_reason||"—";
      const reviewed=r.reviewed_at?r.reviewed_at.replace("T"," ").replace("Z",""):"—";
      const action=(status==="pending"||status==="submitted")
        ? '<div class="funding-actions"><button type="button" class="approve-funding" data-id="'+escapeHtml(r.id)+'">Approve</button><button type="button" class="danger reject-funding" data-id="'+escapeHtml(r.id)+'">Reject</button></div>'
        : '<span class="muted">Reviewed</span>';
      return '<tr><td><strong>'+escapeHtml(customer)+'</strong><br><span class="muted">'+escapeHtml(u.phone||u.email||"")+'</span></td><td>'+action+'</td><td>'+money(r.amount)+'</td><td><code>'+escapeHtml(r.reference||"—")+'</code></td><td><code>'+escapeHtml(r.payment_reference||"—")+'</code></td><td>'+escapeHtml(submitted)+'</td><td><span class="badge '+statusClass+'">'+escapeHtml(status)+'</span></td><td>'+escapeHtml(reason)+'</td><td>'+escapeHtml(reviewed)+'</td></tr>';
    }).join("")||'<tr><td colspan="9" class="muted">No funding history found.</td></tr>';

    const fundingRows=document.getElementById("manualFundingRows");
    if(fundingRows && !fundingRows.dataset.actionsBound){
      fundingRows.addEventListener("click",event=>{
        const approve=event.target.closest(".approve-funding");
        if(approve){
          approveManualFunding(approve.dataset.id);
          return;
        }
        const reject=event.target.closest(".reject-funding");
        if(reject) rejectManualFunding(reject.dataset.id);
      });
      fundingRows.dataset.actionsBound="true";
    }

    const submittedCount=rows.filter(r=>r.status==="submitted"||r.status==="pending").length;
    msg($("manualFundingMsg"),submittedCount+" funding request(s) awaiting admin review.",submittedCount?"info":"success");
  }catch(e){
    console.error("Manual funding load failed:",e);
    msg($("manualFundingMsg"),e.message||"Unable to load funding requests.","error");
    $("manualFundingRows").innerHTML='<tr><td colspan="9" class="muted">Unable to load funding requests. Use Refresh Requests.</td></tr>';
  }
}

async function approveManualFunding(id){
  if(!confirm("Approve this funding request and credit the customer's wallet?"))return;
  try{
    const d=await admin({action:"manual_funding_approve",request_id:id});
    msg($("manualFundingMsg"),d.answer||"Funding approved and wallet credited.","success");
    await loadManualFundingRequests(); await loadOverview();
  }catch(e){msg($("manualFundingMsg"),e.message,"error")}
}

async function rejectManualFunding(id){
  const note=prompt("Reason for rejection:","");
  if(note===null)return;
  try{
    const d=await admin({action:"manual_funding_reject",request_id:id,note});
    msg($("manualFundingMsg"),d.answer||"Funding request rejected.","success");
    await loadManualFundingRequests();
  }catch(e){msg($("manualFundingMsg"),e.message,"error")}
}
