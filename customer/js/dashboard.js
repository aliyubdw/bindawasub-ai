// Bindawasub AI customer dashboard. Read-only: no wallet mutations or purchase calls.
(function () {
  const $ = (id) => document.getElementById(id);
  const naira = (value) => "₦" + Number(value || 0).toLocaleString("en-NG", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dateText = (value) => {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString("en-NG", {dateStyle:"medium",timeStyle:"short"});
  };
  const initials = (name) => String(name || "B").trim().split(/\s+/).filter(Boolean).slice(0,2).map((p)=>p[0]).join("").toUpperCase() || "B";

  function setMessage(text) { $("dashboardMessage").textContent = text || ""; }

  async function ensureSession() {
    const session = await readCurrentSession();
    if (!session) {
      window.location.replace("./index.html");
      return null;
    }
    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (error || !user) {
      window.location.replace("./index.html");
      return null;
    }
    return user;
  }

  async function loadProfile() {
    const data = await getProfileStatus();
    if (!data || !data.user) {
      throw new Error("We could not find your Bindawasub profile. Please return to the chat and complete your profile.");
    }
    const user = data.user;
    if (user.role === "admin") {
      window.location.replace("./admin/");
      return;
    }
    $("welcomeTitle").textContent = "Welcome back, " + (user.name || "there");
    $("avatarInitials").textContent = initials(user.name);
    $("walletBalance").textContent = naira(user.wallet_balance);
    $("walletCurrency").textContent = "Currency: " + (user.wallet_currency || "NGN");
    $("transactionCount").textContent = Number(user.transaction_count || 0).toLocaleString("en-NG");
    $("successfulCount").textContent = Number(user.successful_transaction_count || 0).toLocaleString("en-NG");
    $("totalSpent").textContent = naira(user.total_spent);
    $("profileName").textContent = user.name || "—";
    $("profileEmail").textContent = user.email || "—";
    $("profilePhone").textContent = user.phone || "—";
    $("profileLanguage").textContent = ({english:"English",hausa:"Hausa",mixed:"English + Hausa"})[user.language] || user.language || "—";
    return user;
  }

  function renderTransactions(items) {
    const container = $("transactionList");
    if (!Array.isArray(items) || !items.length) {
      container.innerHTML = '<div class="empty-state">No purchases found yet. When you make a purchase, your recent activity will appear here.</div>';
      return;
    }
    container.innerHTML = items.map((tx) => {
      const status = String(tx.status || "unknown").toLowerCase();
      const product = [tx.network_name || (tx.network ? String(tx.network).toUpperCase() : ""), tx.product_name || "Purchase", tx.volume || ""].filter(Boolean).join(" · ");
      const amount = Number(tx.amount || 0);
      return '<div class="transaction-row"><div class="tx-main"><span class="tx-icon">▤</span><div><div class="tx-title">' + safe(product) + '</div><div class="tx-date">' + safe(dateText(tx.date)) + (tx.phone_number ? " · " + safe(tx.phone_number) : "") + '</div></div></div><div class="tx-side"><div class="tx-amount">' + safe(naira(amount)) + '</div><span class="status ' + safe(status) + '">' + safe(status) + '</span></div></div>';
    }).join("");
  }

  async function loadTransactions() {
    const container = $("transactionList");
    container.innerHTML = '<div class="loading-state">Loading your transactions…</div>';
    try {
      const response = await callEdgeFunction({action:"transaction_history",message:"Show my recent transactions"});
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || "Unable to load transactions.");
      renderTransactions(data.transactions || (data.transaction ? [data.transaction] : []));
    } catch (error) {
      console.error("Dashboard transaction history failed:", error);
      container.innerHTML = '<div class="empty-state">We could not load your recent transactions right now. Your account and wallet have not been changed.</div>';
    }
  }

  async function start() {
    try {
      const authUser = await ensureSession();
      if (!authUser) return;
      await loadProfile();
      await loadTransactions();
    } catch (error) {
      console.error("Dashboard initialization failed:", error);
      setMessage(error?.message || "Unable to load your account. Please try again.");
      $("transactionList").innerHTML = '<div class="empty-state">Unable to load your account information.</div>';
    }
  }

  $("refreshTransactions").addEventListener("click", loadTransactions);
  $("logoutButton").addEventListener("click", async function () {
    this.disabled = true;
    this.textContent = "Logging out…";
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      this.disabled = false;
      this.textContent = "Log out";
      setMessage("Unable to log out right now. Please try again.");
      return;
    }
    window.location.replace("./index.html");
  });
  start();
})();