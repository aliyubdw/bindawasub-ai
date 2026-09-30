// Bindawasub AI — conversations and AI chat

async function startNewConversation() {
  const button = document.getElementById("newChatButton");
  if (button) button.disabled = true;

  try {
    const response = await callEdgeFunction({
      action: "new_conversation",
      channel: getCustomerChannel()
    });

    const data = await response.json();

    if (!response.ok || data.success !== true || !data.conversation_id) {
      throw new Error(data.error || "Failed to start a new conversation.");
    }

    BindawasubCustomerState.activeConversationId = data.conversation_id;
    BindawasubCustomerState.historyOpen = false;

    const historyPanel = document.getElementById("conversationHistoryPanel");
    if (historyPanel) historyPanel.hidden = true;

    resetCustomerOrderState();
    resetCustomerFundingState();

    const messages = document.getElementById("messages");
    messages.innerHTML = "";

    addMessage("Hello! A new conversation has started. How can I help you today?", "bot");

    const input = document.getElementById("messageInput");
    input.value = "";
    input.placeholder = "Rubuta saƙonka...";
    input.focus();

    await loadConversationList();
  } catch (error) {
    console.error("New conversation failed:", error);
    addMessage("❌ An kasa fara sabuwar hira. Sake gwadawa.", "bot");
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadConversationMessages(conversationId) {
  const id = String(conversationId || "").trim();
  if (!id) return;

  const messages = document.getElementById("messages");
  if (!messages) return;

  try {
    const response = await callEdgeFunction({
      action: "conversation_history",
      channel: getCustomerChannel(),
      conversation_id: id
    });

    const data = await response.json();

    if (!response.ok || data.success !== true) {
      throw new Error(data.error || "Failed to load conversation.");
    }

    BindawasubCustomerState.activeConversationId = data.conversation_id;
    resetCustomerOrderState();
    resetCustomerFundingState();
    messages.innerHTML = "";

    if (Array.isArray(data.messages) && data.messages.length > 0) {
      data.messages.forEach(item => {
        const role = item.role === "user" ? "user" : "bot";
        addMessage(item.message || "", role);
      });
    } else {
      addMessage("This conversation is empty. Send a message to continue.", "bot");
    }

    messages.scrollTop = messages.scrollHeight;
    document.getElementById("messageInput")?.focus();
  } catch (error) {
    console.error("Conversation load failed:", error);
    addMessage("❌ Ba a iya bude wannan hirar ba. Sake gwadawa.", "bot");
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

    BindawasubCustomerState.activeConversationId = data.conversation_id || null;

    // Keep the welcome card when there are no saved messages.
    // The welcome card contains the Services menu.
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      messages.innerHTML = "";
      data.messages.forEach(item => {
        const role = item.role === "user" ? "user" : "bot";
        addMessage(item.message || "", role);
      });
      messages.scrollTop = messages.scrollHeight;
    }
  } catch (error) {
    console.error("Conversation history load failed:", error);
  }
}

function formatConversationDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toggleConversationHistory() {
  const panel = document.getElementById("conversationHistoryPanel");
  if (!panel) return;

  BindawasubCustomerState.historyOpen = !BindawasubCustomerState.historyOpen;
  panel.hidden = !BindawasubCustomerState.historyOpen;

  if (BindawasubCustomerState.historyOpen) {
    loadConversationList();
  }
}

async function loadConversationList() {
  if (isAdminUser) return;

  const panel = document.getElementById("conversationHistoryPanel");
  const list = document.getElementById("conversationHistoryList");
  if (!panel || !list) return;

  list.innerHTML = '<div class="conversation-history-loading">Loading conversations…</div>';

  try {
    const response = await callEdgeFunction({
      action: "conversation_list",
      channel: getCustomerChannel()
    });

    const data = await response.json();

    if (!response.ok || data.success !== true) {
      throw new Error(data.error || "Failed to load conversations.");
    }

    const conversations = Array.isArray(data.conversations) ? data.conversations : [];

    if (!conversations.length) {
      list.innerHTML = '<div class="conversation-history-empty">No saved conversations yet.</div>';
      return;
    }

    list.innerHTML = "";

    conversations.forEach(conversation => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "conversation-history-item" +
        (conversation.id === BindawasubCustomerState.activeConversationId ? " active" : "");

      const title = document.createElement("div");
      title.className = "conversation-history-title";
      title.textContent = conversation.title || "Conversation";

      const meta = document.createElement("div");
      meta.className = "conversation-history-meta";
      meta.textContent = String(formatConversationDate(conversation.last_message_at || conversation.started_at)) +
        " • " + String(Number(conversation.message_count || 0)) + " messages";

      const preview = document.createElement("div");
      preview.className = "conversation-history-preview";
      preview.textContent = conversation.preview || "";

      item.appendChild(title);
      item.appendChild(meta);
      if (conversation.preview) item.appendChild(preview);

      item.addEventListener("click", async () => {
        await loadConversationMessages(conversation.id);
        BindawasubCustomerState.historyOpen = false;
        panel.hidden = true;
        await loadConversationList();
      });

      list.appendChild(item);
    });
  } catch (error) {
    console.error("Conversation list load failed:", error);
    list.innerHTML = '<div class="conversation-history-empty">❌ Unable to load saved conversations.</div>';
  }
}
async function showChatScreen() {
  // Show the customer interface immediately. Conversation history loads
  // in the background so a slow history request cannot delay login.
  const loginScreen = document.getElementById("loginScreen");
  const chatScreen = document.getElementById("chatScreen");

  if (loginScreen) loginScreen.style.display = "none";
  if (chatScreen) chatScreen.style.display = "flex";

  if (isAdminUser) return;

  loadConversationHistory().catch(error => {
    console.error("Initial conversation history load failed:", error);
  });

  try {
    startFundingStatusNotifications();
  } catch (error) {
    console.error("Funding notification startup failed:", error);
  }

  const input = document.getElementById("messageInput");
  if (input) input.focus();
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

const pendingTransactionWatchers = new Map();

async function watchTransactionStatus(transactionId) {
  const id = String(transactionId || "").trim();
  if (!id || pendingTransactionWatchers.has(id)) return;

  let attempts = 0;
  const maxAttempts = 18;
  pendingTransactionWatchers.set(id, true);

  try {
    while (attempts < maxAttempts) {
      attempts += 1;

      if (attempts === 1) {
        await new Promise(resolve => setTimeout(resolve, 2500));
      } else {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      try {
        const response = await callEdgeFunction({
          action: "requery_pending_purchase",
          transaction_id: id
        });
        const data = await response.json().catch(() => null);

        if (!response.ok || data?.success !== true) continue;

        const status = String(data.status || "").toLowerCase();

        if (status === "successful") {
          addMessage("✅ Your purchase has now been confirmed successfully.", "bot");
          break;
        }

        if (status === "failed" || status === "reversed") {
          addMessage(
            status === "failed"
              ? "❌ Your purchase was confirmed as failed and the wallet refund has been handled."
              : "↩️ Your purchase was reversed and the wallet adjustment has been handled.",
            "bot"
          );
          break;
        }
      } catch (error) {
        console.error("Pending transaction requery failed:", error);
      }
    }
  } finally {
    pendingTransactionWatchers.delete(id);
  }
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
      ...(requestAmount ? { amount: requestAmount } : {}),
      ...(BindawasubCustomerState.activeConversationId
        ? { conversation_id: BindawasubCustomerState.activeConversationId }
        : {})
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
        if (
          String(data.purchase.status || "").toLowerCase() === "pending" &&
          data.purchase.transaction_id
        ) {
          watchTransactionStatus(data.purchase.transaction_id);
        }
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
