// Bindawasub AI — customer profile UI

let currentCustomerProfile = null;

function formatNaira(value) {
  return "₦" + Number(value || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function profileInitials(name) {
  const parts = String(name || "B").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map(p => p[0]).join("") || "B").toUpperCase();
}

function profileEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openCustomerProfile() {
  const modal = document.getElementById("profileModal");
  if (!modal) return;
  modal.hidden = false;
  loadCustomerProfile();
}

function closeCustomerProfile() {
  const modal = document.getElementById("profileModal");
  if (modal) modal.hidden = true;
}

async function loadCustomerProfile() {
  const body = document.getElementById("profileModalBody");
  if (!body) return;

  body.innerHTML = '<div class="profile-loading">Loading your profile…</div>';

  try {
    const data = await getProfileStatus();
    if (!data.user) throw new Error("Your Bindawasub profile could not be found.");

    currentCustomerProfile = data.user;
    renderCustomerProfile(data.user);
  } catch (error) {
    console.error("Profile load failed:", error);
    body.innerHTML =
      '<div class="profile-error">' +
      profileEscape(error?.message || "Unable to load your profile.") +
      '</div>';
  }
}

function renderCustomerProfile(profile) {
  const body = document.getElementById("profileModalBody");
  if (!body) return;

  const roleLabel = profile.role === "reseller" ? "Reseller" : "Customer";
  const language = profile.language || "english";

  body.innerHTML = `
    <div class="profile-hero">
      <div class="profile-avatar">${profileEscape(profileInitials(profile.name))}</div>
      <div class="profile-identity">
        <h3>${profileEscape(profile.name || "Bindawasub customer")}</h3>
        <span>${profileEscape(roleLabel)}</span>
      </div>
      <button id="profileEditButton" class="profile-edit-button" type="button">Edit</button>
    </div>

    <div class="profile-section">
      <div class="profile-section-title">Account</div>
      <div class="profile-info-grid">
        <div><span>Email</span><strong>${profileEscape(profile.email || "—")}</strong></div>
        <div><span>Phone</span><strong>${profileEscape(profile.phone || "—")}</strong></div>
        <div><span>Customer ID</span><strong>#${profileEscape(String(profile.id || "").slice(0, 8))}</strong></div>
        <div><span>Member since</span><strong>${profileEscape(formatDate(profile.created_at))}</strong></div>
        <div><span>Language</span><strong>${profileEscape(language.charAt(0).toUpperCase() + language.slice(1))}</strong></div>
        <div><span>State</span><strong>${profileEscape(profile.state || "—")}</strong></div>
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-title">Wallet</div>
      <div class="profile-wallet-card">
        <span>Available balance</span>
        <strong>${formatNaira(profile.wallet_balance)}</strong>
      </div>
      <div class="profile-stats-grid">
        <div><strong>${Number(profile.transaction_count || 0).toLocaleString()}</strong><span>Transactions</span></div>
        <div><strong>${Number(profile.successful_transaction_count || 0).toLocaleString()}</strong><span>Successful</span></div>
        <div><strong>${formatNaira(profile.total_spent)}</strong><span>Total spent</span></div>
        <div><strong>${Number(profile.conversation_count || 0).toLocaleString()}</strong><span>Saved chats</span></div>
      </div>
    </div>

    <div id="profileEditPanel" class="profile-edit-panel" hidden>
      <div class="profile-section-title">Edit profile</div>
      <label>Full name</label>
      <input id="profileEditName" type="text" value="${profileEscape(profile.name || "")}" autocomplete="name">
      <label>Phone number</label>
      <input id="profileEditPhone" type="tel" value="${profileEscape(profile.phone || "")}" autocomplete="tel">
      <label>Preferred language</label>
      <select id="profileEditLanguage">
        <option value="english" ${language === "english" ? "selected" : ""}>English</option>
        <option value="hausa" ${language === "hausa" ? "selected" : ""}>Hausa</option>
        <option value="mixed" ${language === "mixed" ? "selected" : ""}>Mixed</option>
      </select>
      <div id="profileEditMessage" class="profile-edit-message"></div>
      <div class="profile-edit-actions">
        <button id="profileSaveButton" type="button">Save changes</button>
        <button id="profileCancelEditButton" type="button" class="profile-cancel-button">Cancel</button>
      </div>
    </div>

    <div class="profile-section profile-funding-section">
      <div class="profile-section-title">Funding history</div>
      <div id="profileFundingHistory" class="profile-history-list"><div class="profile-loading">Loading funding history…</div></div>
    </div>

    <div class="profile-section profile-telegram-section">
      <div class="profile-section-title">Telegram</div>
      <div id="profileTelegramStatus" class="profile-telegram-status">Checking connection…</div>
    </div>

    <div class="profile-section profile-password-section">
      <div class="profile-section-title">Security</div>
      <button id="profileChangePasswordButton" type="button" class="profile-secondary-button">Change password</button>
      <div id="profilePasswordPanel" class="profile-edit-panel" hidden>
        <label>New password</label>
        <input id="profileNewPassword" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters">
        <label>Confirm new password</label>
        <input id="profileConfirmPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Repeat your password">
        <div id="profilePasswordMessage" class="profile-edit-message"></div>
        <button id="profileSavePasswordButton" type="button">Update password</button>
      </div>
    </div>

    <div class="profile-security-note">
      <strong>Security</strong>
      <span>Your email and password are managed securely by Supabase Authentication.</span>
    </div>
  `;

  document.getElementById("profileEditButton").addEventListener("click", function() {
    document.getElementById("profileEditPanel").hidden = false;
    this.style.display = "none";
  });

  document.getElementById("profileCancelEditButton").addEventListener("click", function() {
    document.getElementById("profileEditPanel").hidden = true;
    document.getElementById("profileEditButton").style.display = "";
  });

  document.getElementById("profileSaveButton").addEventListener("click", saveCustomerProfile);
  document.getElementById("profileChangePasswordButton").addEventListener("click", function() {
    document.getElementById("profilePasswordPanel").hidden = false;
    this.hidden = true;
  });
  document.getElementById("profileSavePasswordButton").addEventListener("click", changeCustomerPassword);
  loadProfileFundingHistory();
  loadProfileTelegramStatus();
}

async function saveCustomerProfile() {
  const button = document.getElementById("profileSaveButton");
  const message = document.getElementById("profileEditMessage");

  const name = document.getElementById("profileEditName").value.trim();
  const phone = document.getElementById("profileEditPhone").value.trim();
  const language = document.getElementById("profileEditLanguage").value;

  message.textContent = "";
  button.disabled = true;
  button.textContent = "Saving…";

  try {
    const data = await callProfileFunction({
      action: "update_profile",
      name,
      phone,
      language
    });

    currentCustomerProfile = data.user;
    renderCustomerProfile(data.user);
  } catch (error) {
    console.error("Profile update failed:", error);
    message.textContent = error?.message || "Unable to update your profile.";
    message.className = "profile-edit-message error";
  } finally {
    button.disabled = false;
    button.textContent = "Save changes";
  }
}

window.openCustomerProfile = openCustomerProfile;
window.closeCustomerProfile = closeCustomerProfile;


async function loadProfileFundingHistory() {
  const el = document.getElementById("profileFundingHistory");
  if (!el) return;
  try {
    const data = await callProfileFunction({ action: "funding_history", limit: 10 });
    if (!data.items?.length) {
      el.innerHTML = '<div class="profile-empty">No wallet funding records yet.</div>';
      return;
    }
    el.innerHTML = data.items.map(item => `
      <div class="profile-history-row">
        <div><strong>${formatNaira(item.amount)}</strong><span>${profileEscape(item.payment_method || "Wallet funding")} · ${profileEscape(formatDate(item.created_at))}</span></div>
        <span class="profile-status-badge ${profileEscape(item.status)}">${profileEscape(item.status || "pending")}</span>
      </div>`).join("");
  } catch (error) {
    el.innerHTML = '<div class="profile-error">Unable to load funding history.</div>';
  }
}

async function loadProfileTelegramStatus() {
  const el = document.getElementById("profileTelegramStatus");
  if (!el) return;
  try {
    const data = await callProfileFunction({ action: "telegram_status" });
    if (data.connected) {
      el.innerHTML = `<strong>Connected</strong><span>@${profileEscape(data.telegram_username || "Telegram account")}</span>`;
    } else {
      el.innerHTML = '<span>Not connected</span><small>Use “Connect Telegram” from the customer toolbar.</small>';
    }
  } catch (error) {
    el.textContent = "Telegram status unavailable.";
  }
}

async function changeCustomerPassword() {
  const message = document.getElementById("profilePasswordMessage");
  const button = document.getElementById("profileSavePasswordButton");
  const password = document.getElementById("profileNewPassword").value;
  const confirmation = document.getElementById("profileConfirmPassword").value;
  message.className = "profile-edit-message";
  message.textContent = "";

  if (password.length < 8) {
    message.className = "profile-edit-message error";
    message.textContent = "Password must be at least 8 characters.";
    return;
  }
  if (password !== confirmation) {
    message.className = "profile-edit-message error";
    message.textContent = "Passwords do not match.";
    return;
  }

  button.disabled = true;
  button.textContent = "Updating…";
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    document.getElementById("profileNewPassword").value = "";
    document.getElementById("profileConfirmPassword").value = "";
    message.textContent = "Password updated successfully.";
  } catch (error) {
    message.className = "profile-edit-message error";
    message.textContent = error?.message || "Unable to update password.";
  } finally {
    button.disabled = false;
    button.textContent = "Update password";
  }
}
