// Airtime is offered only while the airtime service is switched on (service_definitions.active) and at
// least one airtime network is active. When it is off, EVERY way into an airtime purchase (a typed request,
// the Airtime button, a follow-up number or amount, or a pending confirmation) gets one clear answer
// and no wallet is debited. Admins switch it back on from the same service toggle, with no code change.
import { classifyConfirmation } from "../purchase/request.ts";

const AIRTIME_WORDS = /\b(?:airtime|talk\s?time|recharge)\b/i;
export const AIRTIME_UNAVAILABLE_ANSWER =
  "Airtime isn't available right now, and nothing was charged. You can still buy data, pay bills or fund your wallet.";

export async function airtimeIsAvailable(supabase: any): Promise<boolean> {
  const { data: service } = await supabase.from("service_definitions").select("id, active").eq("code", "airtime").maybeSingle();
  if (!service || service.active === false) return false;
  const { data: networks } = await supabase.from("service_networks").select("id").eq("service_id", service.id).eq("active", true).limit(1);
  return (networks || []).length > 0;
}

type GateContext = {
  supabase: any;
  userId: string;
  conversationId: string | null;
  conversationContext: any;
  body: any;
  originalMessage: string;
  corsHeaders: Record<string, string>;
};

// Returns a response when the request is an airtime request and airtime is off; otherwise null.
export async function airtimeGate(ctx: GateContext): Promise<Response | null> {
  const action = String(ctx.body?.action || "");
  const message = String(ctx.originalMessage || "");
  const looksAirtime =
    action === "start_airtime" || action === "airtime_purchase" ||
    AIRTIME_WORDS.test(message) ||
    String(ctx.conversationContext?.service_type || "").toLowerCase() === "airtime";

  let pendingAirtime = false;
  if (!looksAirtime && ctx.conversationId && classifyConfirmation(message) !== null) {
    const { data } = await ctx.supabase.from("ai_conversations")
      .select("pending_airtime_amount").eq("id", ctx.conversationId).eq("user_id", ctx.userId).maybeSingle();
    pendingAirtime = !!data?.pending_airtime_amount;
  }
  if (!looksAirtime && !pendingAirtime) return null;
  if (await airtimeIsAvailable(ctx.supabase)) return null;

  // Close anything airtime left open so the customer is not walked back into it.
  if (ctx.conversationId) {
    await ctx.supabase.from("ai_conversations").update({
      conversation_context: { ...(ctx.conversationContext || {}), service_type: null, network: null, airtime_amount: null, phone_number: null, last_intent: "airtime_unavailable" },
      pending_airtime_amount: null, pending_network: null, pending_service_type: null,
      pending_phone_number: null, pending_at: null, pending_idempotency_key: null, pending_customer_input: {},
    }).eq("id", ctx.conversationId).eq("user_id", ctx.userId);
  }
  return new Response(JSON.stringify({ success: true, intent: "airtime_unavailable", answer: AIRTIME_UNAVAILABLE_ANSWER, ai_powered: false }), {
    status: 200, headers: { ...ctx.corsHeaders, "Content-Type": "application/json" },
  });
}
