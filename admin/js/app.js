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

  // Keep independent dashboard modules from blocking the funding module.
  await Promise.allSettled(loaders.map(([name,fn])=>Promise.resolve().then(()=>fn()).catch(error=>{
    console.error("Admin module failed:",name,error);
  })));
}

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

  // Funding requests refresh automatically while the admin console is open.
  startFundingPolling();
});
