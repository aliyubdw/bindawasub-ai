// Bindawasub AI — conversations and AI chat

async function startNewConversation() {
  const button = document.getElementById("newChatButton");
  if (button) button.disabled = true;
  try {
    const response = await callEdgeFunction({ action: "new_conversation", channel: getCustomerChannel() });
    const data = await response.json();
    if (!response.ok || data.success !== true) throw new Error(data.error || "Failed to start a new conversation.");
    BindawasubCustomerState.selectedProduct = null;
    BindawasubCustomerState.recipientPhone = null;
    BindawasubCustomerState.waitingForPhone = false;
    BindawasubCustomerState.waitingForConfirmation = false;
    const messages = document.getElementById("messages");
    messages.innerHTML = "";
    addMessage("Hello! A new conversation has started. How can I help you today?", "bot");
    const input = document.getElementById("messageInput");
    input.value = "";
    input.placeholder = "Rubuta saƙonka...";
    input.focus();
  } catch (error) {
    console.error("New conversation failed:", error);
    addMessage("❌ An kasa fara sabuwar hira. Sake gwadawa.", "bot");
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadConversationHistory() {
  if (isAdminUser) return;

  const messages = document.getElementById("messages");
  if (!messages) return;

  try {
    const response = await callEdgeFunction({
      action: "conversation_history",
      channel: getCustomerChannel()
    });

    const data = await response.json();

    if (!response.ok || data.success !== true) {
      throw new Error(data.error || "Failed to load conversation history.");
    }

    messages.innerHTML = "";

    if (Array.isArray(data.messages) && data.messages.length > 0) {
      data.messages.forEach(item => {
        const role = item.role === "user" ? "user" : "bot";
        addMessage(item.message || "", role);
      });
    } else {
      addMessage(
        "Hello! Welcome to Bindawasub. How can I help you today?",
        "bot"
      );
    }

    messages.scrollTop = messages.scrollHeight;
  } catch (error) {
    console.error("Conversation history load failed:", error);

    if (!messages.children.length) {
      addMessage(
        "Sannu! Barka da zuwa Bindawasub. Ta yaya zan taimaka maka yau?",
        "bot"
      );
    }
  }
}

async function showChatScreen() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("chatScreen").style.display = "flex";

  if (!isAdminUser) {
    await loadConversationHistory();
    startFundingStatusNotifications();
    document.getElementById("messageInput").focus();
  }
}

function addMessage(text, type) {

  const welcome = document.getElementById("welcomeCard");
  if (welcome) welcome.remove();

  const messages =
    document.getElementById("messages");

  const message =
    document.createElement("div");

  message.className =
    "message " + type;

  message.textContent =
    text;

  messages.appendChild(message);

  messages.scrollTop =
    messages.scrollHeight;
}

async function sendMessage(customMessage = null, customAction = null) {

  const input =
    document.getElementById("messageInput");

  const button =
    document.getElementById("sendButton");


  const message =
    customMessage ||
    input.value.trim();


  if (!message) return;


  /* =========================================
     PHONE NUMBER STAGE
  ========================================= */

  if (
    BindawasubCustomerState.waitingForPhone &&
    !customMessage
  ) {

    const phone =
      validatePhone(message);


    addMessage(
      message,
      "user"
    );


    input.value = "";


    if (!phone) {

      addMessage(
        `Lambar wayar ba ta dace ba.

Ka shigar da lambar Najeriya mai lamba 11.

Misali: 08012345678`,
        "bot"
      );


      input.focus();

      return;

    }


    BindawasubCustomerState.recipientPhone =
      phone;


    BindawasubCustomerState.waitingForPhone =
      false;


    showConfirmation();


    input.placeholder =
      "Rubuta saƙonka...";


    input.focus();

    return;

  }


  /* =========================================
     NORMAL MESSAGE
  ========================================= */

  if (!customMessage) {

    addMessage(
      message,
      "user"
    );

    input.value = "";

  }


  button.disabled = true;


  /* =========================================
     LOADING
  ========================================= */

  const messages =
    document.getElementById("messages");

  const loading =
    document.createElement("div");

  loading.className =
    "message bot";

  loading.textContent =
    "Ana tunani...";


  messages.appendChild(loading);

  messages.scrollTop =
    messages.scrollHeight;


  try {

    /* =========================================
       SEND TO SUPABASE
    ========================================= */

    let requestAction = customAction;
    let requestAmount = null;

    if (!requestAction && BindawasubCustomerState.waitingForFundingAmount) {
      const amountText = String(message || "").trim();
      const amountMatch = amountText.match(
        /^(?:₦\s*|NGN\s*|naira\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/i
      );

      if (amountMatch) {
        const parsedAmount = Number(
          String(amountMatch[1]).replace(/,/g, "")
        );

        if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
          requestAction = "manual_funding_request";
          requestAmount = parsedAmount;
        }
      }
    }

    const response = await callEdgeFunction({
      message: message,
      ...(requestAction ? { action: requestAction } : {}),
      ...(requestAmount ? { amount: requestAmount } : {})
    });

    /* Read the raw response first so we never
       lose the real backend error. */
    const rawText = await response.text();

    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch (parseError) {
      data = {
        error: "Backend returned a non-JSON response.",
        raw_response: rawText
      };
    }

    loading.remove();

    /* =========================================
       SHOW ACTUAL BACKEND RESPONSE / ERROR
    ========================================= */

    if (!response.ok) {

      const backendMessage =
        data?.error ||
        data?.message ||
        data?.answer ||
        data?.raw_response ||
        "No error message was returned by the backend.";

      addMessage(
        "❌ Backend error (HTTP " +
        response.status +
        "):\\n" +
        backendMessage,
        "bot"
      );

      console.error("Bindawasub AI backend error:", {
        status: response.status,
        statusText: response.statusText,
        response: data
      });

      return;
    }

    if (data?.answer) {

      addMessage(
        data.answer,
        "bot"
      );

      if (
        data?.purchase &&
        (data?.intent === "purchase" || data?.intent === "airtime_purchase")
      ) {
        showPurchaseConfirmation(data.purchase);
      }

    } else if (data?.error) {

      addMessage(
        "⚠️ Backend response: " +
        data.error,
        "bot"
      );

      console.error("Bindawasub AI backend response error:", data);

    } else if (data) {

      addMessage(
        "Backend response received:\\n" +
        JSON.stringify(
          data,
          null,
          2
        ),
        "bot"
      );

      console.log("Bindawasub AI backend response:", data);

    } else {

      addMessage(
        "⚠️ Backend returned an empty response.",
        "bot"
      );

      console.error(
        "Bindawasub AI returned an empty response."
      );

    }

    if (data?.intent === "fund_wallet" && data?.requires_amount) {
      BindawasubCustomerState.waitingForFundingAmount = true;
    }

    if (data?.intent === "fund_wallet" && data?.requires_payment && data?.request) {
      showManualFunding(data);
    }

    /* =========================================
       SHOW TRANSACTION HISTORY
    ========================================= */

    if (
      data?.transactions &&
      Array.isArray(data.transactions) &&
      data.transactions.length > 0
    ) {
      showTransactionHistory(data.transactions);
    }

    /* =========================================
       SHOW FUNDING HISTORY
    ========================================= */

    if (
      data?.funding &&
      Array.isArray(data.funding) &&
      data.funding.length > 0
    ) {
      showFundingHistory(data.funding);
    }

    /* =========================================
       SHOW PACKAGES
    ========================================= */

    if (
      data?.products &&
      data.products.length > 0
    ) {

      showProducts(
        data.products
      );

    }

  } catch (error) {

    loading.remove();

    const errorMessage =
      error?.message ||
      String(error) ||
      "Unknown frontend error.";

    addMessage(
      "❌ Frontend error:\\n" +
      errorMessage,
      "bot"
    );

    console.error(
      "Bindawasub AI frontend error:",
      error
    );

  }

  button.disabled = false;

  input.focus();

  messages.scrollTop =
    messages.scrollHeight;

}
