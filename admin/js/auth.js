// Bindawasub Admin — single source of truth for the admin session gate.
//
// Flow:  main login ("../")  ->  /admin/  ->  getSession  ->  verify role=admin  ->  dashboard
//
// This page has NO login form of its own. Anyone who is signed out, or signed in
// without the admin role, is sent back to the one login at "../". A failure while
// loading dashboard data never signs the admin out and never shows a login screen.
(function(){
  const LOGIN_URL="../";
  let view="booting";          // booting | dashboard | leaving
  let started=false;

  class GateError extends Error{ constructor(kind,message){ super(message); this.kind=kind; } }

  const app=()=>document.getElementById("app");

  function hideBanner(){ document.getElementById("adminGateBanner")?.remove(); }
  function showBanner(text){
    hideBanner();
    const box=document.createElement("div");
    box.id="adminGateBanner";
    box.setAttribute("role","alert");
    box.style.cssText="position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;max-width:92vw;background:#fff;border:1px solid #e0b4b4;border-radius:10px;padding:12px 16px;box-shadow:0 6px 24px rgba(0,0,0,.15);font:14px/1.4 system-ui,sans-serif;color:#222;display:flex;gap:10px;align-items:center;flex-wrap:wrap";
    const span=document.createElement("span"); span.textContent=text;
    const retry=document.createElement("button"); retry.type="button"; retry.textContent="Retry";
    retry.onclick=()=>{ hideBanner(); started=false; start(); };
    const back=document.createElement("a"); back.href=LOGIN_URL; back.textContent="Back to login";
    box.append(span,retry,back);
    document.body.appendChild(box);
  }

  function showDashboard(){
    if(view==="leaving") return;
    view="dashboard";
    hideBanner();
    app()?.classList.remove("hidden");
  }
  function leave(){
    if(view==="leaving") return;
    view="leaving";
    app()?.classList.add("hidden");
    window.location.replace(LOGIN_URL);
  }

  // Returns normally only for a verified admin. Throws GateError otherwise:
  //   not_admin -> signed in, but not an admin (e.g. a customer)
  //   auth      -> session invalid/expired and could not be refreshed
  //   network / server -> could not decide; the session must be kept
  async function verifyAdmin(session){
    let accessToken=session.access_token;
    for(let attempt=0; attempt<2; attempt++){
      let r,d;
      try{
        r=await fetch(ADMIN_URL,{
          method:"POST",
          headers:{"Content-Type":"application/json","apikey":KEY,"Authorization":"Bearer "+accessToken},
          body:JSON.stringify({action:"dashboard_summary"})
        });
        d=await r.json().catch(()=>({}));
      }catch(e){
        throw new GateError("network","Network problem while verifying admin access.");
      }
      if(r.ok && d.success!==false) return;
      const msg=String(d.error||"");
      if(/admin access required/i.test(msg)) throw new GateError("not_admin",msg);
      if(r.status>=500 || !/session|token|authentication|expired|invalid|unauthor/i.test(msg))
        throw new GateError("server",msg||"The server could not verify admin access.");
      if(attempt===0){                      // looks like an expired access token: refresh once
        const {data,error}=await sb.auth.refreshSession();
        if(error||!data?.session) throw new GateError("auth","Session expired.");
        accessToken=data.session.access_token;
        continue;
      }
      throw new GateError("auth",msg||"Admin verification failed.");
    }
  }

  async function start(){
    if(started) return;
    started=true;
    try{
      const {data,error}=await sb.auth.getSession();
      if(error) throw new GateError("server",error.message||"Unable to read session.");
      if(!data.session){ leave(); return; }             // signed out -> the one login
      await verifyAdmin(data.session);
    }catch(err){
      const kind=err?.kind;
      if(kind==="not_admin"){ leave(); return; }        // keep their (customer) session
      if(kind==="auth"){ await sb.auth.signOut({scope:"local"}).catch(()=>{}); leave(); return; }
      console.error("Admin gate could not verify access:",err);
      showBanner((err?.message||"Could not verify admin access.")+" Your session was kept.");
      return;
    }

    showDashboard();                                    // verified admin -> dashboard, immediately
    try{
      if(window.loadAll) await window.loadAll();
    }catch(err){
      // Never sign out or show a login screen because a dashboard module failed.
      console.error("Admin dashboard load failed:",err);
      showBanner("Some dashboard sections failed to load. Refresh to retry.");
    }
  }

  async function logout(e){
    e?.preventDefault(); e?.stopImmediatePropagation();
    const btn=document.getElementById("logout");
    if(btn){ btn.disabled=true; btn.textContent="Logging out…"; }
    try{ await sb.auth.signOut({scope:"local"}); }catch(err){ console.error("Admin logout failed:",err); }
    leave();
  }

  function bind(){
    document.getElementById("logout")?.addEventListener("click",logout,true);
    document.querySelectorAll(".nav button[data-tab]").forEach(b=>b.addEventListener("click",function(){
      document.querySelectorAll(".nav button[data-tab]").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById(b.dataset.tab)?.classList.add("active");
    },true));
  }

  window.addEventListener("error",e=>console.error("ADMIN_RUNTIME_ERROR",e.error||e.message));
  window.addEventListener("unhandledrejection",e=>console.error("ADMIN_UNHANDLED_REJECTION",e.reason));
  window.BindawasubAuth={logout,restore:start};

  document.addEventListener("DOMContentLoaded",()=>{
    bind();
    // Signing out anywhere (this tab or another) returns to the single login.
    sb.auth.onAuthStateChange(event=>{ if(event==="SIGNED_OUT") leave(); });
    start();
  });
})();
