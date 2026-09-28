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
  try{
    // Load the complete manual-funding history for admin, not only submitted requests.
    const statuses=["pending","submitted","approved","rejected"];
    const results=await Promise.all(statuses.map(status=>admin({action:"manual_funding_requests",status})));
    const byId=new Map();
    results.forEach(d=>(d.requests||[]).forEach(r=>byId.set(r.id,r)));
    const rows=Array.from(byId.values()).sort((a,b)=>{
      const da=new Date(a.created_at||a.submitted_at||0).getTime();
      const db=new Date(b.created_at||b.submitted_at||0).getTime();
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
        ? '<button onclick="approveManualFunding(\''+r.id+'\')">Approve</button> <button class="danger" onclick="rejectManualFunding(\''+r.id+'\')">Reject</button>'
        : '<span class="muted">Reviewed</span>';
      return '<tr><td><strong>'+escapeHtml(customer)+'</strong><br><span class="muted">'+escapeHtml(u.phone||u.email||"")+'</span></td><td>'+money(r.amount)+'</td><td><code>'+escapeHtml(r.reference||"—")+'</code></td><td><code>'+escapeHtml(r.payment_reference||"—")+'</code></td><td>'+escapeHtml(submitted)+'</td><td><span class="badge '+statusClass+'">'+escapeHtml(status)+'</span></td><td>'+escapeHtml(reason)+'</td><td>'+escapeHtml(reviewed)+'</td><td>'+action+'</td></tr>';
    }).join("")||'<tr><td colspan="9" class="muted">No funding history found.</td></tr>';
    msg($("manualFundingMsg"),rows.length+" funding request(s) in history.","success");
  }catch(e){msg($("manualFundingMsg"),e.message,"error")}
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
