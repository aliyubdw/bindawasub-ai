export async function recoverFundingAmountFromConversation({
  supabase,
  conversationId,
  originalMessage,
  body,
}: {
  supabase: any;
  conversationId: string | null;
  originalMessage: string;
  body: any;
}) {
  if (!conversationId) return;

  const amountMatch = String(originalMessage).trim().match(
    /^(?:₦\s*|NGN\s*|naira\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/i,
  );
  if (!amountMatch) return;

  const parsedAmount = Number(String(amountMatch[1]).replace(/,/g, ""));
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return;

  const { data: previousUserMessages } = await supabase
    .from("ai_messages")
    .select("message, created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(2);

  const previousUserMessage = String(
    previousUserMessages?.[1]?.message || "",
  ).toLowerCase().trim();

  if (
    /fund.*wallet|wallet.*fund|funding.*wallet|add.*money|add.*amount|fund my wallet/.test(
      previousUserMessage,
    )
  ) {
    body.action = "manual_funding_request";
    body.amount = parsedAmount;
  }
}
