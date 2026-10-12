// Gemini may phrase an answer (including in Hausa), but it must never state a price that is not
// in the catalog. Every amount in the reply must equal a real selling price of a product being
// discussed; otherwise the catalog-built fallback is used instead.
const AMOUNT_RE = /(?:₦|NGN|\bN)\s*([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:naira|₦)/gi;

export function replyPricesMatchCatalog(reply: unknown, products: any[]): boolean {
  const text = String(reply ?? "");
  const allowed = new Set((products || []).map((p: any) => Number(p?.selling_price)).filter((n) => Number.isFinite(n)));
  for (const match of text.matchAll(AMOUNT_RE)) {
    const amount = Number(String(match[1] ?? match[2]).replace(/,/g, ""));
    if (Number.isFinite(amount) && !allowed.has(amount)) return false;
  }
  return true;
}

// Gemini's wording when its prices check out; otherwise the deterministic fallback.
export function answerWithCatalogPrices(reply: unknown, products: any[], fallback: string): string {
  const text = String(reply ?? "").trim();
  return text && replyPricesMatchCatalog(text, products) ? text : fallback;
}
