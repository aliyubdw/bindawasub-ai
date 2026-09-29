// Bindawasub AI — shared customer runtime state
//
// This is intentionally UI-channel agnostic. Web uses channel="web" now;
// the future Telegram adapter can set channel="telegram" without changing
// the core chatbot, wallet, product, or transaction logic.

const BindawasubCustomerState = {
  channel: "web",
  activeConversationId: null,
  historyOpen: false,
  waitingForFundingAmount: false,
  activeFundingRequestId: null,
  selectedProduct: null,
  recipientPhone: null,
  waitingForPhone: false,
  waitingForConfirmation: false,
  fundingStatusState: new Map(),
  fundingStatusTimer: null
};

function getCustomerChannel() {
  return BindawasubCustomerState.channel || "web";
}

function resetCustomerOrderState() {
  BindawasubCustomerState.selectedProduct = null;
  BindawasubCustomerState.recipientPhone = null;
  BindawasubCustomerState.waitingForPhone = false;
  BindawasubCustomerState.waitingForConfirmation = false;
}

function resetCustomerFundingState() {
  BindawasubCustomerState.waitingForFundingAmount = false;
  BindawasubCustomerState.activeFundingRequestId = null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
