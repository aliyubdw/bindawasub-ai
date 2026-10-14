// A phone number sent on its own, with no open request that needs a recipient.
//
// Before this it went to Gemini, which answered with a generic help message. The backend now asks
// what the number is for and shows how to say it. It is stateless on purpose: nothing is remembered,
// so the customer's next request must include the number (or a saved contact) itself.
//
// It never fires while a request is open that could be waiting for a number: an airtime request, a
// plan list, a pending purchase, a bill (smartcard / meter numbers look like phone numbers), or a
// funding request.
import { normalizeNigerianPhone, parsePhone } from "../purchase/request.ts";

type PhoneOnlyContext = {
  supabase: any;
  userId: string;
  conversationId: string | null;
  conversationContext: any;
  originalMessage: string;
  corsHeaders: Record<string, string>;
};

// Only digits, spaces, hyphens and an optional leading + count as "a number on its own".
const DIGITS_ONLY = /^\+?[\d\s-]{9,20}$/;

function respond(corsHeaders: Record<string, string>, intent: string, answer: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ success: true, intent, answer, ai_powered: false, ...extra }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function flowIsOpen(context: any): boolean {
  if (!context) return false;
  if (context.pending_selection) return true;
  const service = String(context.service_type || "").toLowerCase();
  if (service && service !== "data") return true;                          // airtime, a bill, ...
  const last = String(context.last_intent || "").toLowerCase();
  if (["service_enquiry", "airtime_purchase", "fund_wallet"].includes(last)) return true;
  return false;
}

export async function handlePhoneOnly(ctx: PhoneOnlyContext): Promise<Response | null> {
  const text = String(ctx.originalMessage || "").trim();
  if (!DIGITS_ONLY.test(text)) return null;
  if (flowIsOpen(ctx.conversationContext)) return null;

  // A purchase waiting for YES is stored in dedicated columns, not in the conversation context.
  if (ctx.conversationId) {
    const { data } = await ctx.supabase.from("ai_conversations")
      .select("pending_product_id, pending_airtime_amount")
      .eq("id", ctx.conversationId).eq("user_id", ctx.userId).maybeSingle();
    if (data?.pending_product_id || data?.pending_airtime_amount) return null;
  }

  const digits = text.replace(/[\s-]/g, "").replace(/^\+/, "");
  const looksLikePhone = /^(?:0|234)\d{8,12}$/.test(digits);
  if (!looksLikePhone) return null; // some other number (an amount, a reference): not ours to interpret

  const phone = parsePhone(text).phone ?? normalizeNigerianPhone(text);
  if (!phone) {
    return respond(ctx.corsHeaders, "phone_invalid",
      "That phone number doesn't look valid. Please send it again (for example 08012345678).");
  }
  return respond(ctx.corsHeaders, "phone_only",
    `I got the number ${phone}. What would you like to do with it? For example: "Buy 500 airtime for ${phone}" or "Buy 1GB for ${phone}".`,
    { phone_number: phone });
}
