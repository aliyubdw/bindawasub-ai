// An open plan list (conversation_context.pending_selection) must not outlive the purchase it led to.
// Telegram confirms a purchase through its own buttons, so the backend never saw a "yes" and the
// list stayed open; hours later it answered an unrelated "Cancel" with "cancelled that request".
// Best effort: clearing is housekeeping and must never block a purchase.
export async function clearPendingSelection(supabase: any, userId: string, channel: string, conversationId: string | null): Promise<void> {
  try {
    let query = supabase.from("ai_conversations").select("id, conversation_context").eq("user_id", userId).eq("channel", channel);
    query = conversationId ? query.eq("id", conversationId) : query.order("last_message_at", { ascending: false }).limit(1);
    const { data } = await query;
    const conversation = (data || [])[0];
    if (!conversation?.conversation_context?.pending_selection) return;
    await supabase.from("ai_conversations")
      .update({ conversation_context: { ...conversation.conversation_context, pending_selection: null } })
      .eq("id", conversation.id).eq("user_id", userId);
  } catch (error) {
    console.error("clearPendingSelection failed:", error);
  }
}
