// Bindawasub AI — page event wiring and bootstrap

// Dynamic Quick Access selectors
async function loadQuickAccessServices() {
  const airtimeButton = document.querySelector('[data-action-message="I want to buy airtime"]');
  const billsButton = document.querySelector('[data-action-message="I want to pay a bill"]');

  async function showServiceSelector(title, subtitle, items, onSelect) {
    const welcome = document.getElementById("welcomeCard");
    if (welcome) welcome.remove();
    const messages = document.getElementById("messages");
    if (!messages) return;

    const wrapper = document.createElement("div");
    wrapper.className = "message bot";
    wrapper.innerHTML =
      '<div style="font-weight:800;margin-bottom:8px;">' + title + '</div>' +
      '<div style="margin-bottom:10px;">' + subtitle + '</div>' +
      '<div class="quick-service-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;"></div>';

    const grid = wrapper.querySelector(".quick-service-grid");
    items.forEach(function(item) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.name;
      button.style.cssText = "padding:11px;border:1px solid #d8e3de;border-radius:10px;background:#f4faf7;color:#087f5b;font-weight:800;cursor:pointer;";
      button.addEventListener("click", function() {
        grid.querySelectorAll("button").forEach(function(b) { b.disabled = true; });
        addMessage(item.name, "user");
        onSelect(item);
      });
      grid.appendChild(button);
    });

    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;
  }

  // These are the active Bindawasub catalog entries. The selector UI is
  // intentionally independent of PostgREST/RLS so it cannot disappear
  // because a browser session has not finished initializing.
  const airtimeNetworks = [
    { name: "MTN", code: "mtn" },
    { name: "Airtel", code: "airtel" },
    { name: "Glo", code: "glo" },
    { name: "9mobile (T2)", code: "9mobile" }
  ];

  // Load every active bill/service from the live service catalog.
  // This keeps the Bills selector automatically in sync when a new bill
  // service is added in Supabase.
  let billServices = [];
  try {
    if (window.supabaseClient) {
      const { data, error } = await window.supabaseClient
        .from("service_definitions")
        .select("code,name,category,description")
        .eq("active", true)
        .neq("category", "telecom")
        .order("name", { ascending: true });

      if (!error && Array.isArray(data)) {
        billServices = data.map(function(service) {
          return {
            name: service.name,
            code: service.code,
            category: service.category,
            description: service.description
          };
        });
      }
    }
  } catch (error) {
    console.error("Bills catalog load failed:", error);
  }

  // Safe fallback for the currently configured bill services.
  if (!billServices.length) {
    billServices = [
      { name: "Electricity", code: "electricity" },
      { name: "NECO PIN", code: "neco" },
      { name: "TV Subscription", code: "tv" },
      { name: "WAEC PIN", code: "waec" }
    ];
  }

  if (airtimeButton) {
    airtimeButton.addEventListener("click", async function() {
      await showServiceSelector(
        "📱 Airtime",
        "Select the network you want to buy airtime for.",
        airtimeNetworks,
        function(network) {
          // Start Airtime through a deterministic backend action so Gemini
          // cannot interpret the selected network as a Data request.
          sendMessage("Airtime on " + network.code, "start_airtime");
        }
      );
    });
  }

  if (billsButton) {
    billsButton.addEventListener("click", async function() {
      await showServiceSelector(
        "🧾 Bills",
        "Select the bill or service you want to pay.",
        billServices,
        function(service) {
          // Include the service code so the backend can deterministically
          // route the request to the selected bill service.
          sendMessage("I want to pay for " + service.name + " (" + service.code + ")");
        }
      );
    });
  }
}

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
  ["MTN","Airtel","Glo","9mobile (T2)"].forEach(function(network) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = network;
    button.style.cssText = "padding:10px;border:1px solid #d8e3de;border-radius:10px;background:#f4faf7;color:#087f5b;font-weight:800;cursor:pointer;";
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

const servicesToggle = document.getElementById("servicesToggle");
const headerServicesMenu = document.getElementById("headerServicesMenu");

if (servicesToggle && headerServicesMenu) {
  servicesToggle.addEventListener("click", function(event) {
    event.stopPropagation();
    const isOpen = !headerServicesMenu.hasAttribute("hidden");
    if (isOpen) {
      headerServicesMenu.setAttribute("hidden", "");
      servicesToggle.setAttribute("aria-expanded", "false");
    } else {
      headerServicesMenu.removeAttribute("hidden");
      servicesToggle.setAttribute("aria-expanded", "true");
    }
  });

  document.addEventListener("click", function(event) {
    if (!headerServicesMenu.contains(event.target) && !servicesToggle.contains(event.target)) {
      headerServicesMenu.setAttribute("hidden", "");
      servicesToggle.setAttribute("aria-expanded", "false");
    }
  });
}

document.getElementById("loginButton").addEventListener("click", loginUser);
document.getElementById("googleButton").addEventListener("click", loginWithGoogle);
document.getElementById("registerButton").addEventListener("click", registerUser);
document.getElementById("showRegisterButton").addEventListener("click", showRegisterForm);
document.getElementById("showLoginButton").addEventListener("click", showLoginForm);

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

document.getElementById("completeProfileButton").addEventListener("click", completeProfile);
document.getElementById("profileBackButton").addEventListener("click", showLoginForm);
document.getElementById("logoutButton").addEventListener("click", logoutUser);

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

document.getElementById("newChatButton").addEventListener("click", startNewConversation);
document.getElementById("chatHistoryButton").addEventListener("click", toggleConversationHistory);
document.getElementById("conversationHistoryRefresh").addEventListener("click", loadConversationList);
document.getElementById("telegramLinkButton").addEventListener("click", createTelegramLinkCode);
document.getElementById("adminSearchButton").addEventListener("click", searchAdminCustomers);
document.getElementById("adminCustomerSearch").addEventListener("keydown", function(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    searchAdminCustomers();
  }
});
document.getElementById("adminFundButton").addEventListener("click", fundAdminCustomer);
document.getElementById("adminResetButton").addEventListener("click", resetAdminCustomerPassword);
document.getElementById("manualFundingSettingsSave").addEventListener("click", saveManualFundingSettings);
document.getElementById("manualFundingRefresh").addEventListener("click", loadManualFundingRequests);
document.getElementById("loginPassword").addEventListener("keydown", function(event) {
  if (event.key === "Enter") loginUser();
});

document.querySelectorAll("[data-action-message]").forEach(function(button) {
  if (button.getAttribute("data-action-message") === "I want to buy airtime" || button.getAttribute("data-action-message") === "I want to pay a bill") return;
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

document.getElementById("messageInput").addEventListener("keydown", function(event) {
  if (event.key === "Enter") sendMessage();
});

loadQuickAccessServices();
resetCustomerOrderState();
BindawasubCustomerState.activeConversationId = null;
BindawasubCustomerState.historyOpen = false;
initAuth();
