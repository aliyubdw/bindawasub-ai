import { getWalletBalance } from "./balance.ts";

export async function handleWalletBalance(
  supabase: any,
  userId: string,
  corsHeaders: Record<string, string>,
  conversationId: string | null,
  persistAssistantMessage?: (...args: any[]) => Promise<void>,
) {
  const wallet = await getWalletBalance(supabase, userId);
  const answer = `Your wallet balance is ₦${wallet.balance.toLocaleString()}.`;
  if (persistAssistantMessage && conversationId) {
    await persistAssistantMessage(
      supabase,
      conversationId,
      answer,
      "wallet_balance",
      "backend",
    );
  }
  return new Response(
    JSON.stringify({
      success: true,
      intent: "wallet_balance",
      balance: wallet.balance,
      currency: wallet.currency,
      answer,
      ai_powered: false,
      quick_action: true,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
