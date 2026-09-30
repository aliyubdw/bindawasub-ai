// Bindawasub AI — page event wiring and bootstrap
// Web Buy Data network selector
function showWebNetworkSelector() {
  const welcome = document.getElementById("welcomeCard");
  if (welcome) welcome.remove();
  const messages = document.getElementById("messages");
  if (!messages) return;
  const wrapper = document.createElement("div");
  wrapper.className = "message bot";
  wrapper.innerHTML = "<div style=\"font-weight:800;margin-bottom:8px;\">📦 Buy Data</div><div style=\"margin-bottom:10px;\">Which network do you want?</div><div class=\"web-network-grid\" style=\"display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;\"></div>";
  const grid = wrapper.querySelector(".web-network-grid");
  ["MTN","Airtel","Glo","T2"].forEach(function(network) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = network;
    button.style.cssText = "padding:10px;border:1px solid #d8e3de;border-radius:10px;background:#f4faf7;font-weight:800;cursor:pointer;";
    button.addEventListener("click", function() {
      grid.querySelectorAll("button").forEach(function(item) { item.disabled = true; });
      addMessage(network, "user");
      sendMessage("Show " + network + " data plans");
    });
    grid.appendChild(button);
  });
  messages.appendChild(wrapper);
  messages.scrollTop = messages.scrollHeight;
}

document
  .getElementById("loginButton")
  .addEventListener("click", loginUser);
document
  .getElementById("googleButton")
  .addEventListener("click", loginWithGoogle);

document
  .getElementById("registerButton")
  .addEventListener("click", registerUser);

document
  .getElementById("showRegisterButton")
  .addEventListener("click", showRegisterForm);

document
  .getElementById("showLoginButton")
  .addEventListener("click", showLoginForm);

const registerForm = document.getElementById("registerForm");
if (registerForm && !document.getElementById("googleRegisterButton")) {
  const googleRegisterButton = document.createElement("button");
  googleRegisterButton.id = "googleRegisterButton";
  googleRegisterButton.type = "button";
  googleRegisterButton.textContent = "Create account with Google";
  googleRegisterButton.style.cssText = "margin-top:8px;background:#fff;color:#333;border:1px solid #d8dedb;width:100%;cursor:pointer;";
  googleRegisterButton.addEventListener("click", loginWithGoogle);
  const backButton = document.getElementById("showLoginButton");
  registerForm.insertBefore(googleRegisterButton, backButton);
}

document
  .getElementById("completeProfileButton")
  .addEventListener("click", completeProfile);

document
  .getElementById("profileBackButton")
  .addEventListener("click", showLoginForm);

document
  .getElementById("logoutButton")
  .addEventListener("click", logoutUser);

// Customer profile drawer
const profileButton = document.getElementById("profileButton");
const profileCloseButton = document.getElementById("profileCloseButton");
const profileModal = document.getElementById("profileModal");
if (profileButton) profileButton.addEventListener("click", openCustomerProfile);
if (profileCloseButton) profileCloseButton.addEventListener("click", closeCustomerProfile);
if (profileModal) {
  profileModal.addEventListener("click", function(event) {
    if (event.target === profileModal) closeCustomerProfile();
  });
}

document
  .getElementById("newChatButton")
  .addEventListener("click", startNewConversation);

document
  .getElementById("chatHistoryButton")
  .addEventListener("click", toggleConversationHistory);

document
  .getElementById("conversationHistoryRefresh")
  .addEventListener("click", loadConversationList);

document
  .getElementById("telegramLinkButton")
  .addEventListener("click", createTelegramLinkCode);

document
  .getElementById("adminSearchButton")
  .addEventListener("click", searchAdminCustomers);

document
  .getElementById("adminCustomerSearch")
  .addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      searchAdminCustomers();
    }
  });

document
  .getElementById("adminFundButton")
  .addEventListener("click", fundAdminCustomer);

document
  .getElementById("adminResetButton")
  .addEventListener("click", resetAdminCustomerPassword);

document
  .getElementById("manualFundingSettingsSave")
  .addEventListener("click", saveManualFundingSettings);

document
  .getElementById("manualFundingRefresh")
  .addEventListener("click", loadManualFundingRequests);

document
  .getElementById("loginPassword")
  .addEventListener("keydown", function(event) {
    if (event.key === "Enter") loginUser();
  });

document.querySelectorAll("[data-action-message]").forEach(function(button) {
  button.addEventListener("click", function() {
    const message = button.getAttribute("data-action-message");
    const action = button.getAttribute("data-action-action");
    const welcome = document.getElementById("welcomeCard");
    if (welcome) welcome.remove();

    if (String(message || "").toLowerCase().includes("buy data")) {
      showWebNetworkSelector();
      return;
    }

    sendMessage(message, action);
  });
});

document
  .getElementById("messageInput")
  .addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
      sendMessage();
    }
  });

resetCustomerOrderState();
BindawasubCustomerState.activeConversationId = null;
BindawasubCustomerState.historyOpen = false;
initAuth();
