import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { formatCatalogProduct, productSpecification } from "./catalog/format.ts";
import { normalizeLookup, resolveCatalogProduct, filterCatalogBySpecification } from "./catalog/lookup.ts";
import { maskTransactionPhone, formatTransactionForAI } from "./transactions/format.ts";
import { getWalletBalance } from "./wallet/balance.ts";
import { createManualFundingRequest } from "./wallet/funding.ts";
import { getCustomerTransactions } from "./transactions/handler.ts";
import { handleAirtimePurchase, handleDataPurchase } from "./purchase/handler.ts";
import { classifyIntent } from "./ai/intent.ts";
import { isInternalTelegramRequest as isInternalTelegramRequestCheck } from "./telegram/handler.ts";
import { authenticateRequest } from "./auth/authenticate.ts";
import { handleNewConversation, handleConversationList, handleConversationHistory } from "./conversation/handler.ts";
import { loadOrCreateConversation, touchConversation, logAiMessage, persistAssistantMessage, logAiActivity } from "./conversation/state.ts";
import { handleAiSummary, handleAiSettings, handleAiCustomerWallet, handleAdminStatus, handleCustomerSearch } from "./admin/handler.ts";
import { handleCheckWallet, handleTransactionActions, handlePendingRequery, handleManualFunding } from "./account/handler.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    // ==========================================
    // SUPABASE SERVER CLIENT
    // ==========================================

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_" + "SERVICE_ROLE_KEY")!
    );

    // ==========================================
    // REQUEST BODY + AUTHENTICATION
    // ==========================================

    const body = await req.json();

    const authorization = req.headers.get("Authorization") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const isInternalTelegramRequest = isInternalTelegramRequestCheck(
      authorization,
      serviceRoleKey,
      req.headers.get("X-Bindawasub-Channel"),
      body?.user_id
    );

    const authResult = await authenticateRequest(
      req,
      supabase,
      isInternalTelegramRequest
    );

    if (authResult instanceof Response) return authResult;

    const authUser = authResult.authUser;

    // ==========================================
    // FIND BINDWASUB USER
    // ==========================================

    let bindawasubUser: any = null;
    let userError: any = null;

    if (isInternalTelegramRequest) {
      const result = await supabase
        .from("users")
        .select("id, auth_user_id, phone, name, role, language")
        .eq("id", body.user_id)
        .maybeSingle();

      bindawasubUser = result.data;
      userError = result.error;
    } else {
      const result = await supabase
        .from("users")
        .select("id, auth_user_id, phone, name, role, language")
        .eq("auth_user_id", authUser.id)
        .maybeSingle();

      bindawasubUser = result.data;
      userError = result.error;

    }

    if (userError || !bindawasubUser) {
      console.error("Bindawasub user lookup error:", userError);

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Your account is authenticated but is not linked to a Bindawasub customer account.",
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // This is the existing Bindawasub users.id.
    // It remains separate from the Supabase Auth UUID.
    const userId = bindawasubUser.id;

    // ==========================================
// ADMIN ACCESS CHECK
// ==========================================

    const isAdmin = bindawasubUser.role === "admin";

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
      return await handleAiSettings({ supabase, isAdmin, corsHeaders }, body.action, body.settings);
    }

    if (body.action === "ai_customer_wallet") {
      return await handleAiCustomerWallet({ supabase, isAdmin, corsHeaders }, String(body.user_id || "").trim());
    }

    if (body.action === "admin_status") {
      return await handleAdminStatus({ supabase, isAdmin, corsHeaders }, bindawasubUser);
    }

    const originalMessage = body.message || "";
    const message = originalMessage.toLowerCase();

    // Initialize conversation state before quick actions, because quick actions
    // can persist messages and update the selected conversation immediately.
    let conversationId: string | null = String(body.conversation_id || "").trim() || null;
    let conversationContext: any = {};
    let existingConversation: any = null;

    // Explicit Airtime selector start: bypass Gemini completely.
    if (body.action === "start_airtime") {
      let requestedNetwork = String(body.network || "").trim().toLowerCase();
      if (!requestedNetwork) {
        const messageNetworkMatch = String(originalMessage || "").match(
          /\b(mtn|airtel|glo|9mobile|t2)\b/i
        );
        if (messageNetworkMatch) {
          requestedNetwork = messageNetworkMatch[1].toLowerCase();
        }
      }

      const normalizedNetwork =
        requestedNetwork === "t2" || requestedNetwork.startsWith("9mobile")
          ? "9mobile"
          : requestedNetwork;

      if (!["mtn", "airtel", "glo", "9mobile"].includes(normalizedNetwork)) {
        return new Response(JSON.stringify({
          success: false,
          error: "Unsupported airtime network."
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const networkNames:any = {
        mtn: "MTN",
        airtel: "Airtel",
        glo: "Glo",
        "9mobile": "9mobile (T2)"
      };
      const networkName = networkNames[normalizedNetwork];

      if (conversationId) {
        // SECURITY: never trust a client-supplied conversation UUID.
        // Verify ownership and channel before changing conversation state.
        const { data: ownedConversation, error: ownedConversationError } = await supabase
          .from("ai_conversations")
          .select("id, conversation_context")
          .eq("id", conversationId)
          .eq("user_id", userId)
          .eq("channel", channel)
          .maybeSingle();

        if (ownedConversationError) throw ownedConversationError;

        if (!ownedConversation) {
          return new Response(JSON.stringify({
            success: false,
            error: "Conversation not found."
          }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        conversationContext = ownedConversation.conversation_context &&
          typeof ownedConversation.conversation_context === "object"
          ? ownedConversation.conversation_context
          : {};

        const nextContext = {
          ...conversationContext,
          last_intent: "airtime_purchase",
          service_type: "airtime",
          network: normalizedNetwork,
          volume: null,
          product_id: null,
          product_name: null,
          updated_at: new Date().toISOString()
        };

        const { error: updateConversationError } = await supabase
          .from("ai_conversations")
          .update({
            conversation_context: nextContext,
            last_message_at: new Date().toISOString()
          })
          .eq("id", conversationId)
          .eq("user_id", userId)
          .eq("channel", channel);

        if (updateConversationError) throw updateConversationError;
      }

      const answer = `You selected ${networkName} airtime. How much airtime do you want to buy?`;
      await persistAssistantMessage(supabase, conversationId, answer, "airtime_purchase", "backend");

      return new Response(JSON.stringify({
        success: true,
        intent: "airtime_purchase",
        service_type: "airtime",
        network: normalizedNetwork,
        answer,
        ai_powered: false,
        quick_action: true
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ==========================================
    // CONVERSATION + PENDING PURCHASE STATE
    // ==========================================

    const channel = isInternalTelegramRequest
      ? "telegram"
      : String(body.channel || "web").toLowerCase();

    // Load live AI controls before processing customer requests.
    const { data: aiConfig, error: aiConfigError } = await supabase
      .from("ai_settings")
      .select("enabled, gemini_enabled, require_purchase_confirmation, max_purchase_amount, default_language, allowed_channels, fallback_message")
      .limit(1)
      .maybeSingle();
    if (aiConfigError) throw aiConfigError;

    if (aiConfig && aiConfig.enabled === false) {
      return new Response(JSON.stringify({
        success: true,
        intent: "other",
        answer: aiConfig.fallback_message || "Bindawasub AI is temporarily unavailable.",
        ai_powered: false,
        disabled: true
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const allowedChannels = Array.isArray(aiConfig?.allowed_channels) ? aiConfig.allowed_channels.map((x:any)=>String(x).toLowerCase()) : ["web","app","whatsapp","telegram"];
    if (!allowedChannels.includes(channel)) {
      return new Response(JSON.stringify({
        success: false,
        error: "This AI channel is currently disabled."
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    {
      const requestedConversationId = String(body.conversation_id || "").trim();
      const state = await loadOrCreateConversation(
        { supabase, userId, channel },
        requestedConversationId || null,
        aiConfig?.default_language || "english"
      );

      if (state.error) {
        return new Response(JSON.stringify({
          success: false,
          error: state.error
        }), {
          status: state.status || 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      conversationId = state.conversationId || null;
      conversationContext = state.conversationContext || {};
      existingConversation = state.existingConversation || null;

      if (conversationId) {
        await touchConversation(supabase, conversationId, userId, channel);
        await logAiMessage(supabase, conversationId, "user", originalMessage);
        await logAiActivity(
          supabase,
          userId,
          conversationId,
          channel,
          "ai_request",
          null,
          originalMessage,
          null,
          true,
          null,
          null,
          { source: "bindawasub-ai" }
        );
      }
    }

    // ==========================================
    // RECOVER MANUAL FUNDING AMOUNT FROM CHAT CONTEXT
    // ==========================================
    // This keeps the funding flow working even if an older frontend
    // does not send the explicit manual_funding_request action.
    if (conversationId) {
      const amountMatch = String(originalMessage).trim().match(
        /^(?:₦\\s*|NGN\\s*|naira\\s*)?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*$/i
      );

      if (amountMatch) {
        const parsedAmount = Number(
          String(amountMatch[1]).replace(/,/g, "")
        );

        if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
          // The fund_wallet action returns before an assistant message is logged,
          // so the previous assistant message may not exist here. Check the
          // immediately previous user message as the durable conversation signal.
          const { data: previousUserMessages } = await supabase
            .from("ai_messages")
            .select("message, created_at")
            .eq("conversation_id", conversationId)
            .eq("role", "user")
            .order("created_at", { ascending: false })
            .limit(2);

          const previousUserMessage = String(
            previousUserMessages?.[1]?.message || ""
          ).toLowerCase().trim();

          if (
            /fund.*wallet|wallet.*fund|funding.*wallet|add.*money|add.*amount|fund my wallet/.test(
              previousUserMessage
            )
          ) {
            body.action = "manual_funding_request";
            body.amount = parsedAmount;
          }
        }
      }
    }



    if (body.action === "fund_wallet" || body.action === "manual_funding_request") {
      return await handleManualFunding({ supabase, userId, corsHeaders }, body);
    }

    async function executeViaProviderExecution(transactionId: string) {
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
            action: "execute_purchase",
            transaction_id: transactionId,
          }),
        }
      );

      const raw = await response.text();
      let result: any;
      try { result = JSON.parse(raw); } catch { result = { success: false, error: raw }; }

      if (!response.ok) {
        throw new Error(result?.error || "Provider execution failed.");
      }
      return result;
    }

    async function loadCustomerTransaction(transactionId: string) {
      const { data, error } = await supabase.from("transactions").select(`
        id, created_at, phone_number, amount, status, provider, provider_reference,
        description, service_type, product_id,
        products (product_name, volume, validity_type, validity_value, validity_unit,
          service_networks(code,name), service_variants(code,name))
      `).eq("id", transactionId).eq("user_id", userId).maybeSingle();
      if (error) { console.error("Customer transaction readback error:", error); return null; }
      return data || null;
    }

    function buildPurchaseConfirmation(tx: any, fallbackPurchase: any, execution: any) {
      const product=Array.isArray(tx?.products)?tx.products[0]:tx?.products;
      const networkInfo=Array.isArray(product?.service_networks)?product.service_networks[0]:product?.service_networks;
      const variantInfo=Array.isArray(product?.service_variants)?product.service_variants[0]:product?.service_variants;
      const reference=tx?.provider_reference||execution?.provider_reference||fallbackPurchase?.provider_reference||null;
      const description=tx?.description||fallbackPurchase?.description||product?.product_name||"Purchase";
      const productName=product?.product_name||fallbackPurchase?.product_name||description;
      const phoneNumber=tx?.phone_number||fallbackPurchase?.phone_number||fallbackPurchase?.customer_input?.phone||null;
      const amount=Number(tx?.amount??fallbackPurchase?.amount??0);
      const status=tx?.status||execution?.status||fallbackPurchase?.status||"pending";
      const provider=tx?.provider||execution?.provider||fallbackPurchase?.provider||null;
      return {
        transaction_id:tx?.id||fallbackPurchase?.id||fallbackPurchase?.transaction_id||execution?.transaction_id||null,
        date:tx?.created_at||fallbackPurchase?.created_at||null, description, product_name:productName,
        service_type:tx?.service_type||fallbackPurchase?.service_type||null,
        network:networkInfo?.code||networkInfo?.name||fallbackPurchase?.network||null,
        variant:variantInfo?.code||variantInfo?.name||fallbackPurchase?.variant||null,
        volume:product?.volume||fallbackPurchase?.volume||null, phone_number:phoneNumber, amount, status, provider,
        reference, provider_reference:reference, provider_message:execution?.message||null
      };
    }

// ==========================================
// ADMIN CUSTOMER SEARCH
// ==========================================

if (body.action === "customer_search") {
      return await handleCustomerSearch({ supabase, isAdmin, corsHeaders }, body.search);
    }


    if (body.action === "check_wallet") {
      return await handleCheckWallet({ supabase, userId, corsHeaders }, body.amount);
    }

    if (body.action === "requery_pending_purchase") {
      return await handlePendingRequery(
        { supabase, userId, corsHeaders, executePendingRequery: async (transactionId: string) => {
          const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          if (!serviceRoleKey || !supabaseUrl) throw new Error("Supabase server configuration is incomplete.");
          const response = await fetch(`${supabaseUrl}/functions/v1/provider-execution`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}`, "apikey": serviceRoleKey },
            body: JSON.stringify({ action: "requery_transaction", transaction_id: transactionId })
          });
          const raw = await response.text();
          let result: any;
          try { result = JSON.parse(raw); } catch { result = { success: false, error: raw }; }
          if (!response.ok) throw new Error(result?.error || "Provider requery failed.");
          return result;
        }},
        body.transaction_id
      );
    }

    if (body.action === "transaction_history" || body.action === "last_transaction" || body.action === "transaction_status") {
      return await handleTransactionActions({ supabase, userId, corsHeaders }, body);
    }

    const originalMessage = body.message || "";
    const message = originalMessage.toLowerCase();

    // Initialize conversation state before quick actions, because quick actions
    // can persist messages and update the selected conversation immediately.
    let conversationId: string | null = String(body.conversation_id || "").trim() || null;
    let conversationContext: any = {};
    let existingConversation: any = null;

    // Explicit Airtime selector start: bypass Gemini completely.
    if (body.action === "start_airtime") {
      let requestedNetwork = String(body.network || "").trim().toLowerCase();
      if (!requestedNetwork) {
        const messageNetworkMatch = String(originalMessage || "").match(
          /\b(mtn|airtel|glo|9mobile|t2)\b/i
        );
        if (messageNetworkMatch) {
          requestedNetwork = messageNetworkMatch[1].toLowerCase();
        }
      }

      const normalizedNetwork =
        requestedNetwork === "t2" || requestedNetwork.startsWith("9mobile")
          ? "9mobile"
          : requestedNetwork;

      if (!["mtn", "airtel", "glo", "9mobile"].includes(normalizedNetwork)) {
        return new Response(JSON.stringify({
          success: false,
          error: "Unsupported airtime network."
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const networkNames:any = {
        mtn: "MTN",
        airtel: "Airtel",
        glo: "Glo",
        "9mobile": "9mobile (T2)"
      };
      const networkName = networkNames[normalizedNetwork];

      if (conversationId) {
        // SECURITY: never trust a client-supplied conversation UUID.
        // Verify ownership and channel before changing conversation state.
        const { data: ownedConversation, error: ownedConversationError } = await supabase
          .from("ai_conversations")
          .select("id, conversation_context")
          .eq("id", conversationId)
          .eq("user_id", userId)
          .eq("channel", channel)
          .maybeSingle();

        if (ownedConversationError) throw ownedConversationError;

        if (!ownedConversation) {
          return new Response(JSON.stringify({
            success: false,
            error: "Conversation not found."
          }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        conversationContext = ownedConversation.conversation_context &&
          typeof ownedConversation.conversation_context === "object"
          ? ownedConversation.conversation_context
          : {};

        const nextContext = {
          ...conversationContext,
          last_intent: "airtime_purchase",
          service_type: "airtime",
          network: normalizedNetwork,
          volume: null,
          product_id: null,
          product_name: null,
          updated_at: new Date().toISOString()
        };

        const { error: updateConversationError } = await supabase
          .from("ai_conversations")
          .update({
            conversation_context: nextContext,
            last_message_at: new Date().toISOString()
          })
          .eq("id", conversationId)
          .eq("user_id", userId)
          .eq("channel", channel);

        if (updateConversationError) throw updateConversationError;
      }

      const answer = `You selected ${networkName} airtime. How much airtime do you want to buy?`;
      await persistAssistantMessage(supabase, conversationId, answer, "airtime_purchase", "backend");

      return new Response(JSON.stringify({
        success: true,
        intent: "airtime_purchase",
        service_type: "airtime",
        network: normalizedNetwork,
        answer,
        ai_powered: false,
        quick_action: true
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ==========================================
    // CONVERSATION + PENDING PURCHASE STATE
    // ==========================================

    const channel = isInternalTelegramRequest
      ? "telegram"
      : String(body.channel || "web").toLowerCase();

    // Load live AI controls before processing customer requests.
    const { data: aiConfig, error: aiConfigError } = await supabase
      .from("ai_settings")
      .select("enabled, gemini_enabled, require_purchase_confirmation, max_purchase_amount, default_language, allowed_channels, fallback_message")
      .limit(1)
      .maybeSingle();
    if (aiConfigError) throw aiConfigError;

    if (aiConfig && aiConfig.enabled === false) {
      return new Response(JSON.stringify({
        success: true,
        intent: "other",
        answer: aiConfig.fallback_message || "Bindawasub AI is temporarily unavailable.",
        ai_powered: false,
        disabled: true
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const allowedChannels = Array.isArray(aiConfig?.allowed_channels) ? aiConfig.allowed_channels.map((x:any)=>String(x).toLowerCase()) : ["web","app","whatsapp","telegram"];
    if (!allowedChannels.includes(channel)) {
      return new Response(JSON.stringify({
        success: false,
        error: "This AI channel is currently disabled."
      }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    {
      const requestedConversationId = String(body.conversation_id || "").trim();
      const state = await loadOrCreateConversation(
        { supabase, userId, channel },
        requestedConversationId || null,
        aiConfig?.default_language || "english"
      );

      if (state.error) {
        return new Response(JSON.stringify({
          success: false,
          error: state.error
        }), {
          status: state.status || 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      conversationId = state.conversationId || null;
      conversationContext = state.conversationContext || {};
      existingConversation = state.existingConversation || null;

      if (conversationId) {
        await touchConversation(supabase, conversationId, userId, channel);
        await logAiMessage(supabase, conversationId, "user", originalMessage);
        await logAiActivity(
          supabase,
          userId,
          conversationId,
          channel,
          "ai_request",
          null,
          originalMessage,
          null,
          true,
          null,
          null,
          { source: "bindawasub-ai" }
        );
      }
    }

    // ==========================================
    // RECOVER MANUAL FUNDING AMOUNT FROM CHAT CONTEXT
    // ==========================================
    // This keeps the funding flow working even if an older frontend
    // does not send the explicit manual_funding_request action.
    if (conversationId) {
      const amountMatch = String(originalMessage).trim().match(
        /^(?:₦\\s*|NGN\\s*|naira\\s*)?([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*$/i
      );

      if (amountMatch) {
        const parsedAmount = Number(
          String(amountMatch[1]).replace(/,/g, "")
        );

        if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
          // The fund_wallet action returns before an assistant message is logged,
          // so the previous assistant message may not exist here. Check the
          // immediately previous user message as the durable conversation signal.
          const { data: previousUserMessages } = await supabase
            .from("ai_messages")
            .select("message, created_at")
            .eq("conversation_id", conversationId)
            .eq("role", "user")
            .order("created_at", { ascending: false })
            .limit(2);

          const previousUserMessage = String(
            previousUserMessages?.[1]?.message || ""
          ).toLowerCase().trim();

          if (
            /fund.*wallet|wallet.*fund|funding.*wallet|add.*money|add.*amount|fund my wallet/.test(
              previousUserMessage
            )
          ) {
            body.action = "manual_funding_request";
            body.amount = parsedAmount;
          }
        }
      }
    }



    async function executeViaProviderExecution(transactionId: string) {
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
            action: "execute_purchase",
            transaction_id: transactionId,
          }),
        }
      );

      const raw = await response.text();
      let result: any;
      try { result = JSON.parse(raw); } catch { result = { success: false, error: raw }; }

      if (!response.ok) {
        throw new Error(result?.error || "Provider execution failed.");
      }
      return result;
    }

    async function loadCustomerTransaction(transactionId: string) {
      const { data, error } = await supabase.from("transactions").select(`
        id, created_at, phone_number, amount, status, provider, provider_reference,
        description, service_type, product_id,
        products (product_name, volume, validity_type, validity_value, validity_unit,
          service_networks(code,name), service_variants(code,name))
      `).eq("id", transactionId).eq("user_id", userId).maybeSingle();
      if (error) { console.error("Customer transaction readback error:", error); return null; }
      return data || null;
    }

    function buildPurchaseConfirmation(tx: any, fallbackPurchase: any, execution: any) {
      const product=Array.isArray(tx?.products)?tx.products[0]:tx?.products;
      const networkInfo=Array.isArray(product?.service_networks)?product.service_networks[0]:product?.service_networks;
      const variantInfo=Array.isArray(product?.service_variants)?product.service_variants[0]:product?.service_variants;
      const reference=tx?.provider_reference||execution?.provider_reference||fallbackPurchase?.provider_reference||null;
      const description=tx?.description||fallbackPurchase?.description||product?.product_name||"Purchase";
      const productName=product?.product_name||fallbackPurchase?.product_name||description;
      const phoneNumber=tx?.phone_number||fallbackPurchase?.phone_number||fallbackPurchase?.customer_input?.phone||null;
      const amount=Number(tx?.amount??fallbackPurchase?.amount??0);
      const status=tx?.status||execution?.status||fallbackPurchase?.status||"pending";
      const provider=tx?.provider||execution?.provider||fallbackPurchase?.provider||null;
      return {
        transaction_id:tx?.id||fallbackPurchase?.id||fallbackPurchase?.transaction_id||execution?.transaction_id||null,
        date:tx?.created_at||fallbackPurchase?.created_at||null, description, product_name:productName,
        service_type:tx?.service_type||fallbackPurchase?.service_type||null,
        network:networkInfo?.code||networkInfo?.name||fallbackPurchase?.network||null,
        variant:variantInfo?.code||variantInfo?.name||fallbackPurchase?.variant||null,
        volume:product?.volume||fallbackPurchase?.volume||null, phone_number:phoneNumber, amount, status, provider,
        reference, provider_reference:reference, provider_message:execution?.message||null
      };
    }

// ==========================================
// ADMIN CUSTOMER SEARCH
// ==========================================

if (body.action === "customer_search") {
      return await handleCustomerSearch({ supabase, isAdmin, corsHeaders }, body.search);
    }


    if (body.action === "check_wallet") {
      return await handleCheckWallet({ supabase, userId, corsHeaders }, body.amount);
    }

    if (body.action === "requery_pending_purchase") {
      return await handlePendingRequery(
        { supabase, userId, corsHeaders, executePendingRequery: async (transactionId: string) => {
          const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
          const supabaseUrl = Deno.env.get("SUPABASE_URL");
          if (!serviceRoleKey || !supabaseUrl) throw new Error("Supabase server configuration is incomplete.");
          const response = await fetch(`${supabaseUrl}/functions/v1/provider-execution`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}`, "apikey": serviceRoleKey },
            body: JSON.stringify({ action: "requery_transaction", transaction_id: transactionId })
          });
          const raw = await response.text();
          let result: any;
          try { result = JSON.parse(raw); } catch { result = { success: false, error: raw }; }
          if (!response.ok) throw new Error(result?.error || "Provider requery failed.");
          return result;
        }},
        body.transaction_id
      );
    }

    if (body.action === "transaction_history" || body.action === "last_transaction" || body.action === "transaction_status") {
      return await handleTransactionActions({ supabase, userId, corsHeaders }, body);
    }

;