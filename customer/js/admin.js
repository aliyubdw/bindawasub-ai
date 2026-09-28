// Bindawasub AI — embedded admin mode tools

const RESET_PASSWORD_FUNCTION_URL =
  "https://fuktxjweuanatmurlzpg.supabase.co/functions/v1/admin-reset-password";

let isAdminUser = false;
let adminSelectedCustomer = null;

async function verifyAdminMode() {
  try {
    const response = await callEdgeFunction({ action: "admin_status" });
    const data = await response.json();

    if (!response.ok || data.success !== true) {
      throw new Error(data.error || "Admin status check failed.");
    }

    isAdminUser = data.is_admin === true && data.role === "admin";

    if (isAdminUser) {
      document.getElementById("chatScreen").classList.add("admin-mode");
      document.getElementById("customerInterface").classList.add("admin-hidden");
      document.getElementById("adminBadge").style.display = "inline-block";
      document.getElementById("adminPanel").style.display = "block";
      document.getElementById("headerSubtitle").textContent =
        "Admin mode — customer tools are available below.";
      startEmbeddedFundingPolling();
      document.getElementById("adminStatus").textContent =
        "Logged in as " + (data.user?.name || "Admin");
      loadManualFundingSettings();
      loadManualFundingRequests();
    }

    return isAdminUser;
  } catch (error) {
    console.error("Admin mode check failed:", error);
    return false;
  }
}

async function adminCall(payload) {
  if (!isAdminUser) throw new Error("Admin access required.");
  const response = await callEdgeFunction(payload);
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Admin request failed.");
  }
  return data;
}

function showAdminMessage(message, isError = false) {
  const box = document.getElementById("adminActionMessage");
  box.textContent = message || "";
  box.className = "admin-status " + (isError ? "admin-error" : "admin-success");
}

function selectAdminCustomer(customer) {
  adminSelectedCustomer = customer;
  const wallet = Array.isArray(customer.wallets) ? customer.wallets[0] : customer.wallets;
  const balance = Number(wallet?.balance || 0);

  const box = document.getElementById("adminSelectedCustomer");
  box.style.display = "block";
  box.textContent =
    (customer.name || "Unnamed customer") +
    " • " +
    (customer.phone || "No phone") +
    " • Balance: ₦" +
    balance.toLocaleString();

  document.getElementById("adminFundButton").disabled = false;
}

async function searchAdminCustomers() {
  const query = document.getElementById("adminCustomerSearch").value.trim();
  const results = document.getElementById("adminCustomerResults");

  results.innerHTML = "";
  showAdminMessage("");

  if (!query) {
    showAdminMessage("Enter a customer name or phone number.", true);
    return;
  }

  const button = document.getElementById("adminSearchButton");
  button.disabled = true;
  button.textContent = "Searching...";

  try {
    const data = await adminCall({
      action: "customer_search",
      search: query
    });

    const customers = data.customers || [];

    if (!customers.length) {
      results.textContent = "No customer found.";
      return;
    }

    customers.forEach(customer => {
      const item = document.createElement("div");
      item.className = "admin-customer";

      const wallet = Array.isArray(customer.wallets)
        ? customer.wallets[0]
        : customer.wallets;

      item.textContent =
        (customer.name || "Unnamed customer") +
        " — " +
        (customer.phone || "No phone") +
        " — ₦" +
        Number(wallet?.balance || 0).toLocaleString();

      item.onclick = () => selectAdminCustomer(customer);
      results.appendChild(item);
    });
  } catch (error) {
    showAdminMessage(error.message || "Customer search failed.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Search Customer";
  }
}

async function fundAdminCustomer() {
  if (!adminSelectedCustomer) {
    showAdminMessage("Select a customer first.", true);
    return;
  }

  const amount = Number(document.getElementById("adminFundAmount").value);
  const note = document.getElementById("adminFundNote").value.trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    showAdminMessage("Enter a valid funding amount.", true);
    return;
  }

  const customerName = adminSelectedCustomer.name || adminSelectedCustomer.phone || "customer";
  if (!window.confirm(
    "Fund " + customerName + "'s wallet with ₦" +
    amount.toLocaleString() + "?"
  )) return;

  const button = document.getElementById("adminFundButton");
  button.disabled = true;
  button.textContent = "Funding...";

  try {
    const reference =
      "FUND-" +
      new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14) +
      "-" +
      Math.random().toString(36).substring(2, 8).toUpperCase();

    const data = await adminCall({
      action: "manual_fund",
      customer_user_id: adminSelectedCustomer.id,
      amount,
      reference,
      note: note || null
    });

    const balanceAfter = Number(data.funding?.balance_after || 0);
    document.getElementById("adminSelectedCustomer").textContent =
      (adminSelectedCustomer.name || "Unnamed customer") +
      " • " +
      (adminSelectedCustomer.phone || "No phone") +
      " • Balance: ₦" +
      balanceAfter.toLocaleString();

    document.getElementById("adminFundAmount").value = "";
    document.getElementById("adminFundNote").value = "";

    showAdminMessage(
      "Wallet funded successfully. New balance: ₦" +
      balanceAfter.toLocaleString()
    );
  } catch (error) {
    showAdminMessage(error.message || "Wallet funding failed.", true);
  } finally {
    button.disabled = !adminSelectedCustomer;
    button.textContent = "Fund Customer Wallet";
  }
}

let embeddedFundingPollTimer=null;

function startEmbeddedFundingPolling(){
  if(embeddedFundingPollTimer)clearInterval(embeddedFundingPollTimer);
  embeddedFundingPollTimer=setInterval(()=>{
    if(isAdminUser && !document.hidden){
      loadManualFundingRequests().catch(error=>console.error("Embedded funding polling failed:",error));
    }
  },15000);
}

async function loadManualFundingSettings() {
  try {
    const data = await adminCall({ action: "manual_funding_settings_get" });
    const s = data.settings || {};
    document.getElementById("manualBankName").value = s.bank_name || "";
    document.getElementById("manualAccountName").value = s.account_name || "";
    document.getElementById("manualAccountNumber").value = s.account_number || "";
    document.getElementById("manualFundingInstructions").value = s.instructions || "";
  } catch (error) {
    showAdminMessage(error.message || "Unable to load funding settings.", true);
  }
}

async function saveManualFundingSettings() {
  const button = document.getElementById("manualFundingSettingsSave");
  button.disabled = true;
  try {
    await adminCall({
      action: "manual_funding_settings_save",
      settings: {
        active: true,
        bank_name: document.getElementById("manualBankName").value.trim(),
        account_name: document.getElementById("manualAccountName").value.trim(),
        account_number: document.getElementById("manualAccountNumber").value.trim(),
        instructions: document.getElementById("manualFundingInstructions").value.trim()
      }
    });
    showAdminMessage("Manual funding details saved.");
  } catch (error) {
    showAdminMessage(error.message || "Unable to save funding details.", true);
  } finally {
    button.disabled = false;
  }
}

async function loadManualFundingRequests() {
  const box = document.getElementById("manualFundingRequests");
  box.textContent = "Loading...";
  try {
    const data = await adminCall({ action: "manual_funding_requests", status: "all" });
    const requests = data.requests || [];

    if (!requests.length) {
      box.textContent = "No submitted funding requests.";
      return;
    }

    box.innerHTML = "";
    requests.forEach(request => {
      const user = Array.isArray(request.users) ? request.users[0] : request.users;
      const item = document.createElement("div");
      item.className = "admin-customer";
      item.style.marginTop = "8px";

      const info = document.createElement("div");
      info.textContent =
        (user?.name || "Customer") + " • " +
        (user?.phone || "No phone") + " • ₦" +
        Number(request.amount || 0).toLocaleString() +
        " • " + request.reference +
        (request.payment_reference ? " • Payment: " + request.payment_reference : "");

      const approve = document.createElement("button");
      approve.type = "button";
      approve.textContent = "Approve";
      approve.style.marginTop = "6px";
      approve.onclick = async () => {
        if (!window.confirm("Approve and credit ₦" + Number(request.amount || 0).toLocaleString() + " to this customer?")) return;
        approve.disabled = true;
        try {
          const result = await adminCall({ action:"manual_funding_approve", request_id:request.id });
          showAdminMessage(result.answer || "Funding approved.");
          await loadManualFundingRequests();
        } catch (error) {
          showAdminMessage(error.message || "Funding approval failed.", true);
          approve.disabled = false;
        }
      };

      const reject = document.createElement("button");
      reject.type = "button";
      reject.textContent = "Reject";
      reject.style.marginTop = "6px";
      reject.style.marginLeft = "6px";
      reject.onclick = async () => {
        const note = window.prompt("Reason for rejection:", "");
        if (note === null) return;
        reject.disabled = true;
        try {
          await adminCall({ action:"manual_funding_reject", request_id:request.id, note });
          showAdminMessage("Funding request rejected.");
          await loadManualFundingRequests();
        } catch (error) {
          showAdminMessage(error.message || "Funding rejection failed.", true);
          reject.disabled = false;
        }
      };

      item.appendChild(info);
      item.appendChild(approve);
      item.appendChild(reject);
      box.appendChild(item);
    });
  } catch (error) {
    box.textContent = error.message || "Unable to load funding requests.";
  }
}

async function resetAdminCustomerPassword() {
  const email = document.getElementById("adminResetEmail").value.trim();
  const password = document.getElementById("adminResetPassword").value;

  if (!email || password.length < 8) {
    showAdminMessage("Enter a customer email and a password of at least 8 characters.", true);
    return;
  }

  if (!window.confirm("Reset the password for " + email + "?")) return;

  const button = document.getElementById("adminResetButton");
  button.disabled = true;
  button.textContent = "Resetting...";

  try {
    const token = await getAccessToken();
    const response = await fetch(RESET_PASSWORD_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Password reset failed.");
    }

    document.getElementById("adminResetPassword").value = "";
    showAdminMessage("Password reset successfully for " + email + ".");
  } catch (error) {
    showAdminMessage(error.message || "Password reset failed.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Reset Customer Password";
  }
}

function hideAdminMode() {
  isAdminUser = false;
  adminSelectedCustomer = null;
  document.getElementById("chatScreen").classList.remove("admin-mode");
  document.getElementById("customerInterface").classList.remove("admin-hidden");
  document.getElementById("adminBadge").style.display = "none";
  document.getElementById("adminPanel").style.display = "none";
  document.getElementById("headerSubtitle").textContent =
    "Sannu! Ta yaya zan taimaka maka?";
}
