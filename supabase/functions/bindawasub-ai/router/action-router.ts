import {
  handleNewConversation,
  handleConversationList,
  handleConversationHistory,
} from "../conversation/handler.ts";
import {
  handleAiSummary,
  handleAiSettings,
  handleAiCustomerWallet,
  handleAdminStatus,
  handleCustomerSearch,
} from "../admin/handler.ts";
import { handleCheckWallet, handleTransactionActions, handlePendingRequery } from "../account/handler.ts";
import { handleStartAirtime, handleFundingActions } from "../funding/handler.ts";
import { handleFundingHistory } from "../funding/history-handler.ts";
import { handleWalletBalance } from "../wallet/balance-handler.ts";
import { detectTransactionAction } from "../transactions/intent.ts";
import { isPurchaseConfirmationMessage } from "./confirmation.ts";

export type ActionRouterContext = {
  supabase: any;
  userId: string;
  isAdmin: boolean;
  corsHeaders: Record<string, string>;
  bindawasubUser: any;
  originalMessage: string;
  conversationId: string | null;
  channel: string;
  persistAssistantMessage?: (...args: any[]) => Promise<void>;
};

export async function routeExplicitAction(
  context: ActionRouterContext,
  body: any,
  phase: "early" | "normal" = "normal",
): Promise<Response | null> {
  const {
    supabase,
    userId,
    isAdmin,
    corsHeaders,
    bindawasubUser,
    originalMessage,
    conversationId,
    channel,
    persistAssistantMessage,
  } = context;

  if (phase === "early") {
    if (body.action === "new_conversation") {
      return await handleNewConversation({ supabase, userId, corsHeaders }, body);
    }
    if (body.action === "conversation_list") {
      return await handleConversationList({ supabase, userId, corsHeaders }, body);
    }
    if (body.action === "conversation_history") {
      return await handleConversationHistory({ supabase, userId, corsHeaders }, body);
    }
    if (body.action === "ai_summary") {
      return await handleAiSummary({ supabase, isAdmin, corsHeaders });
    }
    if (body.action === "ai_settings_get" || body.action === "ai_settings_save") {
      return await handleAiSettings(
        { supabase, isAdmin, corsHeaders },
        body.action,
        body.settings,
      );
    }
    if (body.action === "ai_customer_wallet") {
      return await handleAiCustomerWallet(
        { supabase, isAdmin, corsHeaders },
        String(body.user_id || "").trim(),
      );
    }
    if (body.action === "admin_status") {
      return await handleAdminStatus(
        { supabase, isAdmin, corsHeaders },
        bindawasubUser,
      );
    }
    if (body.action === "customer_search") {
      return await handleCustomerSearch(
        { supabase, isAdmin, corsHeaders },
        body.search,
      );
    }
    return null;
  }

  // Confirmations must reach the pending-purchase handler in index.ts.
  if (isPurchaseConfirmationMessage(originalMessage)) {
    return null;
  }

  // Deterministic natural-language wallet balance detection.
  // Balance is account data and must never depend on Gemini intent classification.
  const balanceMessage = String(originalMessage || "").trim().toLowerCase();
  const asksForBalance = /^(?:what(?:'s| is)\s+(?:my\s+)?balance|check\s+(?:my\s+)?balance|show\s+(?:my\s+)?balance|my\s+balance|how\s+much\s+(?:do\s+)?i\s+have|nawa\s+ne\s+(?:kudin|money)\s+(?:na|a)\s+wallet(?:\s+ta)?|duba\s+balance)$/i.test(balanceMessage);

  if (body.action === "wallet_balance" || asksForBalance) {
    return await handleWalletBalance(
      supabase,
      userId,
      corsHeaders,
      conversationId,
      persistAssistantMessage,
    );
  }
  const transactionAction = detectTransactionAction(originalMessage);
  if (transactionAction) {
    return await handleTransactionActions(
      { supabase, userId, corsHeaders },
      { ...body, action: transactionAction },
    );
  }

  const fundingMessage = String(originalMessage || "").trim().toLowerCase();
  const asksHowToFund = /^(?:how\s+(?:do|can)\s+i\s+fund(?:\s+my)?\s+wallet|how\s+do\s+i\s+add\s+money(?:\s+to\s+my\s+wallet)?|how\s+can\s+i\s+add\s+money(?:\s+to\s+my\s+wallet)?|fund(?:\s+my)?\s+wallet|i\s+want\s+to\s+fund(?:\s+my)?\s+wallet|i\s+want\s+to\s+add\s+money(?:\s+to\s+my\s+wallet)?|ta\s+yaya\s+zan\s+yi\s+funding|yaya\s+zan\s+kara\s+kudi(?:\s+a\s+wallet)?|ina\s+son\s+na\s+sa\s+kudi(?:\s+a\s+wallet)?)$/i.test(fundingMessage);
  if (asksHowToFund) {
    return await handleFundingActions(
      { supabase, userId, isAdmin, corsHeaders, persistAssistantMessage },
      { ...body, action: "fund_wallet" },
    );
  }

  if (body.action === "start_airtime") {
    return await handleStartAirtime(
      {
        supabase,
        userId,
        corsHeaders,
        originalMessage,
        conversationId,
        channel,
      },
      body,
    );
  }
  if (body.action === "customer_search") {
    return await handleCustomerSearch(
      { supabase, isAdmin, corsHeaders },
      body.search,
    );
  }
  if (body.action === "funding_history") {
    return await handleFundingHistory(
      supabase,
      userId,
      corsHeaders,
      body.limit,
    );
  }
  if (body.action === "check_wallet") {
    return await handleCheckWallet(
      { supabase, userId, corsHeaders },
      body.amount,
    );
  }
  if (body.action === "requery_pending_purchase") {
    return await handlePendingRequery(
      {
        supabase,
        userId,
        corsHeaders,
        executePendingRequery: async (transactionId: string) => {
          const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          if (!serviceRoleKey || !supabaseUrl) {
            throw new Error("Supabase server configuration is incomplete.");
          }
          const response = await fetch(
            `${supabaseUrl}/functions/v1/provider-execution`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceRoleKey}`,
                "apikey": serviceRoleKey,
              },
              body: JSON.stringify({
                action: "requery_transaction",
                transaction_id: transactionId,
              }),
            },
          );
          const raw = await response.text();
          let result: any;
          try {
            result = JSON.parse(raw);
          } catch {
            result = { success: false, error: raw };
          }
          if (!response.ok) {
            throw new Error(result?.error || "Provider requery failed.");
          }
          return result;
        },
      },
      body.transaction_id,
    );
  }
  if (
    body.action === "transaction_history" ||
    body.action === "last_transaction" ||
    body.action === "transaction_status"
  ) {
    return await handleTransactionActions(
      { supabase, userId, corsHeaders },
      body,
    );
  }
  if (
    [
      "fund_wallet",
      "manual_funding_request",
      "manual_funding_submit",
      "manual_funding_history",
      "manual_funding_requests",
      "manual_funding_approve",
      "manual_funding_reject",
      "manual_funding_settings_get",
      "manual_funding_settings_save",
      "manual_fund",
    ].includes(body.action)
  ) {
    return await handleFundingActions(
      { supabase, userId, isAdmin, corsHeaders, persistAssistantMessage },
      body,
    );
  }

  return null;
}
