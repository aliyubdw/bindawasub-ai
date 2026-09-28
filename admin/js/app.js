// Bindawasub Admin — app

async function loadAll(){await loadOverview();await loadAiManagement();await loadProviders();await loadServices();await loadProducts();await loadEndpoints();await loadMappings();await loadTransactions();await loadAnalytics();await loadManualFundingSettings();await loadManualFundingRequests();}

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
});
