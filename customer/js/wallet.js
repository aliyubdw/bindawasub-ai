// Bindawasub AI — wallet and manual funding

let waitingForFundingAmount = false;
let activeFundingRequestId = null;

const fundingStatusState = new Map();
let fundingStatusTimer = null;

function showManualFunding(data) {
  const messages = document.getElementById("messages");
  if (!messages) return;

  const card = document.createElement("div");
  card.className = "message bot";
  card.style.whiteSpace = "normal";

  const request = data?.request || {};
  activeFundingRequestId = request.id || null;
  waitingForFundingAmount = false;

  const bank = data?.bank_account;

  card.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;">Manual Wallet Funding</div>
    <div style="margin-bottom:10px;">Request: <strong>${request.reference || "—"}</strong></div>
    <div style="margin-bottom:10px;">Amount: <strong>₦${Number(request.amount || 0).toLocaleString("en-NG")}</strong></div>
    ${bank ? `
      <div style="padding:10px;border:1px solid rgba(0,0,0,.12);border-radius:10px;margin-bottom:10px;">
        <div><strong>Bank:</strong> ${bank.bank_name || "—"}</div>
        <div><strong>Account name:</strong> ${bank.account_name || "—"}</div>
        <div><strong>Account number:</strong> ${bank.account_number || "—"}</div>
      </div>` : `
      <div style="margin-bottom:10px;">Bank details have not been configured yet.</div>`}
    <div style="margin-bottom:10px;">${data?.instructions || "Transfer the exact amount, then submit your transfer reference."}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <input id="manualFundingPaymentRef" type="text" placeholder="Transfer reference" style="flex:1;min-width:180px;padding:10px;border:1px solid #ccc;border-radius:9px;">
      <button id="manualFundingSubmitBtn" type="button" style="padding:10px 14px;border:0;border-radius:9px;cursor:pointer;">I have paid</button>
    </div>
  `;

  messages.appendChild(card);
  messages.scrollTop = messages.scrollHeight;

  const submitBtn = card.querySelector("#manualFundingSubmitBtn");
  const refInput = card.querySelector("#manualFundingPaymentRef");

  submitBtn?.addEventListener("click", async () => {
    const paymentReference = String(refInput?.value || "").trim();

    if (!activeFundingRequestId) {
      addMessage("No active funding request was found.", "bot");
      return;
    }

    if (!paymentReference) {
      addMessage("Please enter your bank transfer reference first.", "bot");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      const response = await callEdgeFunction({
        action: "manual_funding_submit",
        request_id: activeFundingRequestId,
        payment_reference: paymentReference
      });

      const result = await response.json();

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Unable to submit the payment reference.");
      }

      activeFundingRequestId = null;
      addMessage(result.answer || "Payment reference submitted. Waiting for admin verification.", "bot");
    } catch (error) {
      addMessage(error?.message || "Unable to submit the payment reference.", "bot");
      submitBtn.disabled = false;
      submitBtn.textContent = "I have paid";
    }
  });
}

async function syncManualFundingStatus(initial = false) {
  if (isAdminUser) return;

  try {
    const response = await callEdgeFunction({
      action: "manual_funding_history"
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.success !== true) return;

    const requests = Array.isArray(data.requests) ? data.requests : [];

    for (const request of requests) {
      const id = String(request.id || "");
      const status = String(request.status || "").toLowerCase();

      if (!id) continue;

      const previousStatus = fundingStatusState.get(id);

      if (
        !initial &&
        previousStatus &&
        previousStatus !== status &&
        (status === "approved" || status === "rejected") &&
        (previousStatus === "pending" || previousStatus === "submitted")
      ) {
        const amount = Number(request.amount || 0).toLocaleString("en-NG");
        const reference = request.reference || "—";

        if (status === "approved") {
          addMessage(
            `✅ Your wallet funding has been approved.

Amount: ₦${amount}
Reference: ${reference}

The ₦${amount} has been credited to your Bindawasub wallet.`,
            "bot"
          );
        } else {
          const reason = request.note ? `\nReason: ${request.note}` : "";

          addMessage(
            `❌ Your wallet funding request was rejected.

Amount: ₦${amount}
Reference: ${reference}${reason}

If you believe this was a mistake, please contact Bindawasub support.`,
            "bot"
          );
        }

        if (activeFundingRequestId === id) {
          activeFundingRequestId = null;
        }
      }

      fundingStatusState.set(id, status);
    }
  } catch (error) {
    console.debug("Funding status check skipped:", error);
  }
}

function startFundingStatusNotifications() {
  if (fundingStatusTimer) {
    clearInterval(fundingStatusTimer);
  }

  syncManualFundingStatus(true);

  fundingStatusTimer = setInterval(() => {
    syncManualFundingStatus(false);
  }, 5000);
}

function stopFundingStatusNotifications() {
  if (fundingStatusTimer) {
    clearInterval(fundingStatusTimer);
    fundingStatusTimer = null;
  }
}
