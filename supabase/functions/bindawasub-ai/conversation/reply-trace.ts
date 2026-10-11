// Saves the reply the customer actually received.
//
// Before this, only some code paths saved their reply, and the Gemini path saved Gemini's
// DRAFT before the backend routed the request, so saved conversations could differ from
// what the customer saw. Every JSON response now passes through recordFinalReply(): if the
// final answer was not already saved during this request, it is saved here.
import { logAiMessage } from "./state.ts";

export type ReplyTrace = { supabase: any; conversationId: string | null; startedAt: string };

export function createReplyTrace(): ReplyTrace {
  return { supabase: null, conversationId: null, startedAt: new Date(Date.now() - 1000).toISOString() };
}

export async function recordFinalReply(response: Response, trace: ReplyTrace): Promise<void> {
  try {
    if (!trace.supabase || !trace.conversationId) return;
    if (!String(response.headers.get("Content-Type") || "").includes("application/json")) return;
    const body = await response.clone().json().catch(() => null);
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    if (!answer) return;

    const { data } = await trace.supabase
      .from("ai_messages")
      .select("message")
      .eq("conversation_id", trace.conversationId)
      .eq("role", "assistant")
      .gte("created_at", trace.startedAt)
      .limit(20);
    if ((data || []).some((row: any) => String(row.message || "").trim() === answer)) return; // already saved

    await logAiMessage(trace.supabase, trace.conversationId, "assistant", answer,
      typeof body?.intent === "string" ? body.intent : null, body?.ai_powered ? "gemini" : "backend");
  } catch (error) {
    console.error("recordFinalReply failed:", error); // never break a reply because logging failed
  }
}
