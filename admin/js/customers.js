// Bindawasub Admin — customers

async function searchCustomers(){try{const d=await aiAdmin({action:"customer_search",search:$("customerSearch").value.trim()});const rows=d.customers||[];$("customerRows").innerHTML=rows.map(c=>'<div class="card" style="padding:11px;margin:8px 0;cursor:pointer" onclick="selectCustomer('+escapeHtml(JSON.stringify(c))+')"><strong>'+escapeHtml(c.name||"Unnamed")+'</strong><br><span class="muted">'+escapeHtml(c.phone||"")+'</span></div>').join("")||'<p class="muted">No customer found.</p>'}catch(e){msg($("searchMsg"),e.message,"error")}}
