// A plain "cancel" that no pending purchase claimed.
//
// Before this, such a message went to Gemini, which replied "Transaction cancelled" even though
// nothing had been cancelled (a funding request created a moment earlier stayed pending).
// Now the backend decides, and only says what actually happened:
//   - if the bot's previous reply was a funding reply, the customer's latest still-pending,
//     unsubmitted funding request (created in the last 30 minutes) is marked cancelled;
//   - otherwise the open flow is cleared and the customer is told nothing was pending.
// Only an explicit "cancel" counts. A bare "no" or "stop" never cancels a funding request.
import { looksHausa } from "../router/language.ts";

const WINDOW_MS = 30 * 60 * 1000;

const CANCEL_RE =
  /^(?:cancel|cancel (?:it|that|this|request|the request|my request|funding|the funding|the funding request|my funding request|payment|the payment|the transaction|my transaction)|(?:a )?soke(?: shi| wannan)?|a'a ba yanzu ba|ba yanzu ba)$/;

export function isExplicitCancel(message: string): boolean {
  const text = String(message || "")
    .toLowerCase()
    .replace(/[^a-z' ]+/g, " ")
    .replace(/\b(?:please|pls|plz|abeg|kindly|just)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return CANCEL_RE.test(text);
}

type CancelContext = {
  supabase: any;
  userId: string;
  conversationId: string;
  conversationContext: any;
  originalMessage: string;
  corsHeaders: Record<string, string>;
};

function reply(corsHeaders: Record<string, string>, intent: string, answer: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ success: true, intent, answer, ai_powered: false, ...extra }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleCancelRequest(ctx: CancelContext): Promise<Response | null> {
  const { supabase, userId, conversationId, corsHeaders } = ctx;
  if (!isExplicitCancel(ctx.originalMessage)) return null;
  // An open plan list has its own cancel handling.
  const selection = ctx.conversationContext?.pending_selection;
  const selectionAge = Date.now() - new Date(selection?.created_at || 0).getTime();
  if (selection && Number.isFinite(selectionAge) && selectionAge <= 15 * 60 * 1000) return null;

  const { data: lastReply } = await supabase
    .from("ai_messages")
    .select("intent, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1);
  const last = (lastReply || [])[0];
  const lastWasFunding = last?.intent === "fund_wallet" && Date.now() - new Date(last.created_at).getTime() < WINDOW_MS;

  if (lastWasFunding) {
    const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data: pending } = await supabase
      .from("manual_funding_requests")
      .select("id, reference, amount")
      .eq("user_id", userId)
      .eq("status", "pending")
      .is("payment_reference", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);
    const request = (pending || [])[0];
    if (request) {
      const { data: updated } = await supabase
        .from("manual_funding_requests")
        .update({ status: "cancelled", note: "Cancelled by customer in chat" })
        .eq("id", request.id)
        .eq("user_id", userId)
        .eq("status", "pending") // never overwrite a request that moved on in the meantime
        .select("id");
      if ((updated || []).length) {
        if (ctx.conversationContext?.pending_selection) {
          await supabase.from("ai_conversations")
            .update({ conversation_context: { ...ctx.conversationContext, pending_selection: null, typed_phone: null } })
            .eq("id", conversationId).eq("user_id", userId);
        }
        const { data: others } = await supabase
          .from("manual_funding_requests").select("id").eq("user_id", userId).eq("status", "pending");
        const n = (others || []).length;
        return reply(corsHeaders, "funding_cancelled",
          `Your funding request ${request.reference} for ₦${Number(request.amount).toLocaleString("en-NG")} has been cancelled. No money was added to your wallet.` +
          (n ? ` You still have ${n} other pending funding request${n === 1 ? "" : "s"} waiting for payment.` : ""),
          { cancelled_reference: request.reference });
      }
    }
  }

  // Nothing to cancel: reset the open flow so it does not linger, and say so plainly.
  await supabase.from("ai_conversations").update({
    conversation_context: {
      ...(ctx.conversationContext || {}), pending_selection: null, typed_phone: null, service_type: null, network: null,
      phone_number: null, airtime_amount: null, last_intent: "cancelled",
    },
    pending_product_id: null, pending_phone_number: null, pending_at: null, pending_service_type: null,
    pending_airtime_amount: null, pending_network: null, pending_idempotency_key: null, pending_customer_input: {},
  }).eq("id", conversationId).eq("user_id", userId);
  return reply(corsHeaders, "nothing_to_cancel", looksHausa(ctx.originalMessage)
    ? "To, an soke. Babu abin da ke jiran aiki kuma ba a cire kuɗi ba."
    : "Okay, cancelled. Nothing was pending and nothing was charged.");
}
