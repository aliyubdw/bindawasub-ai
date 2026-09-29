// Bindawasub AI — page event wiring and bootstrap

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
