// Bindawasub Admin — persistent admin session management
(function(){
  function showApp(){
    const login=document.getElementById("loginView");
    const app=document.getElementById("app");
    login?.classList.add("hidden");
    login?.setAttribute("aria-hidden","true");
    app?.classList.remove("hidden");
    app?.setAttribute("aria-hidden","false");
  }
  function showLogin(){
    const login=document.getElementById("loginView");
    const app=document.getElementById("app");
    login?.classList.remove("hidden");
    login?.setAttribute("aria-hidden","false");
    app?.classList.add("hidden");
    app?.setAttribute("aria-hidden","true");
  }
  async function verify(session){
    const r=await fetch(ADMIN_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "apikey":KEY,
        "Authorization":"Bearer "+session.access_token
      },
      body:JSON.stringify({action:"dashboard_summary"})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.success===false)throw Error(d.error||"Admin verification failed.");
  }
  async function login(e){
    e?.preventDefault();e?.stopPropagation();
    const email=document.getElementById("email")?.value.trim();
    const password=document.getElementById("password")?.value||"";
    const btn=document.getElementById("loginBtn");
    const box=document.getElementById("loginMsg");
    if(!email||!password){
      box.innerHTML='<div class="msg error">Email and password are required.</div>';
      return false;
    }
    loginInProgress=true;
    btn.disabled=true;
    btn.textContent="Signing in…";
    box.innerHTML='<div class="msg info">Authenticating…</div>';
    try{
      const {data,error}=await sb.auth.signInWithPassword({email,password});
      if(error)throw error;
      if(!data.session)throw Error("No session was created.");
      box.innerHTML='<div class="msg info">Verifying admin access…</div>';
      await verify(data.session);
      showApp();
      box.innerHTML="";
      if(window.loadAll) await window.loadAll();
    }catch(err){
      console.error("ADMIN_LOGIN_ERROR",err);
      box.innerHTML='<div class="msg error">'+escapeHtml(err.message||"Login failed.")+'</div>';
    }finally{
      loginInProgress=false;
      btn.disabled=false;
      btn.textContent="Login";
    }
    return false;
  }
  async function logout(e){
    e?.preventDefault();e?.stopImmediatePropagation();
    const btn=document.getElementById("logout");
    if(btn){btn.disabled=true;btn.textContent="Logging out…";}
    try{await sb.auth.signOut({scope:"local"});}catch(err){console.error("Admin logout failed:",err);}
    window.location.replace("../");
  }
  let restoring=false;
  let loginInProgress=false;
  async function restore(){
    if(restoring||loginInProgress)return;
    restoring=true;
    try{
      if(loginInProgress)return;
      const {data,error}=await sb.auth.getSession();
      if(error)throw error;
      if(!data.session){
        showLogin();
        return;
      }
      try{
        await verify(data.session);
      }catch(err){
        console.error("ADMIN_RESTORE_VERIFY_ERROR",err);
        showLogin();
        const box=document.getElementById("loginMsg");
        if(box) box.innerHTML='<div class="msg error">'+escapeHtml(err.message||"Admin verification failed.")+'</div>';
        return;
      }
      showApp();
      if(window.loadAll)await window.loadAll();
    }catch(err){
      console.error("Admin session restore:",err);
      await sb.auth.signOut({scope:"local"}).catch(()=>{});
      showLogin();
    }finally{
      restoring=false;
    }
  }
  function bind(){
    const form=document.getElementById("loginForm");
    const btn=document.getElementById("loginBtn");
    const logoutBtn=document.getElementById("logout");
    form?.addEventListener("submit",login,true);
    logoutBtn?.addEventListener("click",logout,true);
    document.querySelectorAll(".nav button[data-tab]").forEach(b=>b.addEventListener("click",function(){
      document.querySelectorAll(".nav button[data-tab]").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById(b.dataset.tab)?.classList.add("active");
    },true));
  }
  window.addEventListener("error",e=>console.error("ADMIN_RUNTIME_ERROR",e.error||e.message));
  window.addEventListener("unhandledrejection",e=>console.error("ADMIN_UNHANDLED_REJECTION",e.reason));
  window.BindawasubAuth={login,logout,restore};
  document.addEventListener("DOMContentLoaded",()=>{
    bind();
    restore();
  });
})();