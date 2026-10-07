export function detectTransactionAction(message: string): "transaction_history" | "last_transaction" | "transaction_status" | null {
  const text = String(message || "");

  const wantsTransactionHistory =
    /\b(transaction history|transaction histories|show my transactions|show my transaction|my transactions|my transaction history|purchase history|purchase histories|show my purchases|my purchases|show transactions|history)\b/i.test(text) ||
    /\b(taarihin ciniki|tarihin ciniki|tarihin sayayya|abubuwan da na saya|abinda na saya)\b/i.test(text);

  const wantsLastTransaction =
    /\b(last transaction|latest transaction|last purchase|latest purchase|most recent purchase|most recent transaction)\b/i.test(text) ||
    /\b(sayayyata ta karshe|sayan da na yi na karshe|ciniki na karshe)\b/i.test(text);

  const wantsTransactionStatus =
    /\b(transaction status|purchase status|did my last purchase go through|was my last purchase successful|is my purchase successful|is my transaction successful)\b/i.test(text) ||
    /\b(sayayyata ta yi nasara|sayayyata ta samu|ciniki na yi nasara)\b/i.test(text);

  if (wantsTransactionHistory) return "transaction_history";
  if (wantsLastTransaction) return "last_transaction";
  if (wantsTransactionStatus) return "transaction_status";
  return null;
}
