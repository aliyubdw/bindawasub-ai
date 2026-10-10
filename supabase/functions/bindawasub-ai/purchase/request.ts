// Deterministic parsing of the CURRENT customer message for data purchases.
// Values here come only from the message text (or a saved contact resolved from it).
// They are never taken from Gemini output or earlier conversation context.
import { parseDataSize, type DataSize } from "../catalog/size.ts";

export const PURCHASE_VERB =
  /\b(?:buy|purchase|send|get|give|need|want|order|activate|subscribe|saya|sayi|siyo|siya|oda|aika|kunna)\b/i;
const DATA_SIZE = /\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb)\b/i;

export type DataPurchaseRequest = {
  isDataPurchase: boolean;
  size: DataSize | null;
  network: string | null;     // only when the customer named one: mtn | airtel | glo | 9mobile
  variant: string | null;     // only when the customer named one: smedata | social | gifting | awoop
  phone: string | null;       // 0XXXXXXXXXX, only when a valid number is written in the message
  phoneInvalid: boolean;      // a number-like string was written but is not a valid recipient
};

export function parseNetwork(message: string): string | null {
  if (/\bmtn\b/i.test(message)) return "mtn";
  if (/\bairtel\b/i.test(message)) return "airtel";
  if (/\bglo\b/i.test(message)) return "glo";
  if (/\b(?:9mobile|t2)\b/i.test(message)) return "9mobile";
  return null;
}

export function parseVariant(message: string): string | null {
  if (/\b(?:sme|sme data|normal data)\b/i.test(message)) return "smedata";
  if (/\b(?:social|social data)\b/i.test(message)) return "social";
  if (/\b(?:gifting|gift|gift data)\b/i.test(message)) return "gifting";
  if (/\bawoop\b/i.test(message)) return "awoop";
  return null;
}

export function normalizeNigerianPhone(raw: string): string | null {
  const digits = String(raw || "").replace(/[\s-]/g, "").replace(/^\+/, "");
  const local = /^234\d{10}$/.test(digits) ? "0" + digits.slice(3) : digits;
  return /^0[789]\d{9}$/.test(local) ? local : null;
}

export function parsePhone(message: string): { phone: string | null; invalid: boolean } {
  // A phone-like run: optional +234/234/0 followed by digits, not embedded in a longer number.
  const runs = String(message || "").match(/(?<![\d])(?:\+?234|0)[\d\s-]{9,14}(?!\d)/g) || [];
  for (const run of runs) {
    const phone = normalizeNigerianPhone(run);
    if (phone) return { phone, invalid: false };
  }
  const looksLikeNumber = /(?<!\d)\d{10,13}(?!\d)/.test(String(message || "").replace(/[\s-]/g, ""));
  return { phone: null, invalid: looksLikeNumber && runs.length > 0 };
}

export function parseDataPurchaseRequest(message: string): DataPurchaseRequest {
  const text = String(message || "");
  const size = parseDataSize(text);
  const isDataPurchase = PURCHASE_VERB.test(text) && DATA_SIZE.test(text);
  const { phone, invalid } = parsePhone(text);
  return { isDataPurchase, size, network: parseNetwork(text), variant: parseVariant(text), phone, phoneInvalid: invalid };
}

// Whole-message confirmation / cancellation. A message that merely STARTS with "e", "ok" or
// "no" (for example "easy, buy 2GB Airtel") is a new request, never a confirmation.
const CONFIRM_RE =
  /^(?:yes|yeah|yep|ok|okay|confirm|confirmed|proceed|go ahead|do it|eh|e|naam|toh|tabbatar)(?:[\s,.!]+(?:please|pls|now|abeg|confirm|confirmed|yes))?[\s.!]*$/i;
const CANCEL_RE =
  /^(?:no|nope|nah|cancel|stop|a'a|ba na so|kar a yi|kar a)(?![a-z0-9])/i;

export function classifyConfirmation(text: string): "confirm" | "cancel" | null {
  const value = String(text || "").trim();
  if (!value) return null;
  if (CONFIRM_RE.test(value)) return "confirm";
  if (CANCEL_RE.test(value) && !DATA_SIZE.test(value) && !PURCHASE_VERB.test(value)) return "cancel";
  return null;
}
