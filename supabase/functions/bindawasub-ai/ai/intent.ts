import { generateGeminiResponse, GeminiRequest } from "./gemini.ts";

export const VALID_INTENTS = [
  "greeting",
  "help",
  "product_enquiry",
  "product_price",
  "service_enquiry",
  "network_enquiry",
  "purchase_intent",
  "airtime_purchase",
  "wallet_balance",
  "fund_wallet",
  "funding_history",
  "transaction_history",
  "last_transaction",
  "transaction_status",
  "registration",
  "account_help",
  "unknown",
] as const;

export type IntentName = typeof VALID_INTENTS[number];

export function normalizeIntentResult(result: any) {
  const normalized = { ...result };
  const rawIntent = String(result?.intent || "").trim().toLowerCase();
  normalized.intent = (VALID_INTENTS as readonly string[]).includes(rawIntent)
    ? rawIntent
    : "unknown";
  normalized.customer_input =
    result?.customer_input && typeof result.customer_input === "object"
      ? result.customer_input
      : {};
  normalized.language =
    String(result?.language || "").toLowerCase() === "hausa"
      ? "hausa"
      : "english";
  return normalized;
}

export async function classifyIntent(request: GeminiRequest) {
  const result = await generateGeminiResponse(request);
  return normalizeIntentResult(result);
}
