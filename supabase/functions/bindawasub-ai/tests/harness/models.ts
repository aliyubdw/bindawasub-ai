// Scripted stand-ins for Gemini. Production logs show the live model silently
// picking MTN for "buy 1GB for <number>", so the first model reproduces that.
import type { ModelFn } from "./harness.ts";

const sizeOf = (m: string) => m.match(/\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb)\b/i)?.[0].replace(/\s+/g, "").toUpperCase() ?? null;
const phoneOf = (m: string) => m.match(/(?:\+234|234|0)\d{10}\b/)?.[0] ?? null;
const networkOf = (m: string) => (m.match(/\b(mtn|airtel|glo|9mobile|t2)\b/i)?.[1] ?? "").toLowerCase() || null;
const isPurchase = (m: string) => /\b(buy|purchase|send|get|give|need|want|order|saya)\b/i.test(m) && !!sizeOf(m);

// Mimics the production failure: invents MTN + a product id when no network was named.
export const hallucinatingModel: ModelFn = (message, { products }) => {
  if (!isPurchase(message)) return { intent: "unknown", reply: "ok" };
  const size = sizeOf(message)!;
  const network = networkOf(message) ?? "mtn";
  const pick = products.find((p) => p.active && p.service_networks.code === network &&
    String(p.product_name).replace(/\s+/g, "").toUpperCase() === size);
  const phone = phoneOf(message);
  return {
    intent: "purchase_intent", service_type: "data", network, volume: size, phone_number: phone,
    product_id: pick?.id ?? null, product_name: pick?.product_name ?? null,
    variant: pick?.service_variants.code ?? null,
    customer_input: phone ? { phone, network } : { network },
    reply: pick ? `You are about to buy ${pick.service_networks.name} ${pick.product_name} (${pick.service_variants.name}) for ₦${Number(pick.selling_price).toLocaleString("en-NG")} for the number ${phone}. Please confirm this purchase.` : "",
  };
};

// A well-behaved model: reports only what the customer actually said.
export const honestModel: ModelFn = (message) => {
  if (!isPurchase(message)) return { intent: "unknown", reply: "ok" };
  const phone = phoneOf(message);
  return { intent: "purchase_intent", service_type: "data", network: networkOf(message), volume: sizeOf(message),
    phone_number: phone, customer_input: phone ? { phone } : {}, reply: "" };
};
