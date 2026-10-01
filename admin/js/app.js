// Bindawasub Admin — app

async function loadAll(){
  const loaders=[
    ["overview",loadOverview],
    ["ai",loadAiManagement],
    ["providers",loadProviders],
    ["services",loadServices],
    ["products",loadProducts],
    ["endpoints",loadEndpoints],
    ["mappings",loadMappings],
    ["transactions",loadTransactions],
    ["analytics",loadAnalytics],
    ["funding settings",loadManualFundingSettings],
    ["funding requests",loadManualFundingRequests]
  ];

  // Run independent modules together. One slow/broken module must never
  // prevent the dashboard overview from rendering.
  await Promise.allSettled(loaders.map(([name,fn])=>
    Promise.resolve()
      .then(()=>fn())
      .catch(error=>{
        console.error("Admin module failed:",name,error);
      })
  ));
}

// Explicitly expose the loader because the admin auth module starts the
// dashboard after restoring the session.
window.loadAll=loadAll;

let fundingPollTimer=null;

function startFundingPolling(){
  if(fundingPollTimer)clearInterval(fundingPollTimer);
  fundingPollTimer=setInterval(()=>{
    if(document.hidden)return;
    loadManualFundingRequests().catch(error=>console.error("Funding polling failed:",error));
  },15000);
}

document.addEventListener("DOMContentLoaded",()=>{
  const toggle=document.getElementById("sidebarToggle");
  const sidebar=document.getElementById("adminSidebar");
  const backdrop=document.getElementById("sidebarBackdrop");
  const closeSidebar=()=>{
    sidebar?.classList.remove("open");
    backdrop?.classList.remove("show");
  };
  toggle?.addEventListener("click",()=>{
    sidebar?.classList.toggle("open");
    backdrop?.classList.toggle("show");
  });
  backdrop?.addEventListener("click",closeSidebar);
  document.querySelectorAll(".sidebar-nav button[data-tab]").forEach(btn=>{
    btn.addEventListener("click",closeSidebar);
  });

  document.getElementById("refreshManualFunding")?.addEventListener("click",()=>{
    loadManualFundingRequests();
  });

  startFundingPolling();

  // Catalog management actions
  // These handlers were missing, so the Add buttons opened nothing and the
  // inline Edit actions could not resolve their functions.
  document.getElementById("newService")?.addEventListener("click",()=>openService());
  document.getElementById("newNetwork")?.addEventListener("click",()=>openNetwork());
  document.getElementById("newVariant")?.addEventListener("click",()=>openVariant());
  document.getElementById("newProduct")?.addEventListener("click",()=>openProduct());

  document.getElementById("networkService")?.addEventListener("change",()=>renderNetworks());
  document.getElementById("variantService")?.addEventListener("change",()=>{
    const serviceId=document.getElementById("variantService")?.value||"";
    const select=document.getElementById("variantNetwork");
    if(!select)return;
    const ns=networks.filter(n=>!serviceId||n.service_id===serviceId);
    select.innerHTML='<option value="">All networks</option>'+ns.map(n=>'<option value="'+n.id+'">'+escapeHtml(n.name)+'</option>').join("");
    renderVariants();
  });
  document.getElementById("variantNetwork")?.addEventListener("change",()=>renderVariants());
});

// Keep the legacy inline Edit buttons working.
window.editService=(id)=>{
  const item=services.find(x=>x.id===id);
  if(item) return openService(item);
};
window.editNetwork=(id)=>{
  const item=networks.find(x=>x.id===id);
  if(item) return openNetwork(item);
};
window.editVariant=(id)=>{
  const item=variants.find(x=>x.id===id);
  if(item) return openVariant(item);
};
window.editProduct=(id)=>{
  const item=products.find(x=>x.id===id);
  if(item) return openProduct(item);
};
