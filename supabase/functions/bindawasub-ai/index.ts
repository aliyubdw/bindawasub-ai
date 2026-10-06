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

    // AI MANAGEMENT: admin-only dashboard summary
    if (body.action === "ai_summary") {
      if (!isAdmin) return new Response(JSON.stringify({ success:false, error:"Admin access required." }), { status:403, headers:{...corsHeaders,"Content-Type":"application/json"} });
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [conversations, messages, activities, successful, failed, pending] = await Promise.all([
        supabase.from("ai_conversations").select("id", { count:"exact", head:true }).gte("last_message_at", since),
        supabase.from("ai_messages").select("id", { count:"exact", head:true }).gte("created_at", since),
        supabase.from("ai_activity_log").select("id", { count:"exact", head:true }).gte("created_at", since),
        supabase.from("transactions").select("id", { count:"exact", head:true }).eq("status","successful").gte("created_at", since),
        supabase.from("transactions").select("id", { count:"exact", head:true }).eq("status","failed").gte("created_at", since),
        supabase.from("transactions").select("id", { count:"exact", head:true }).eq("status","pending").gte("created_at", since)
      ]);
      const errors = [conversations,messages,activities,successful,failed,pending].find((q:any)=>q.error);
      if (errors?.error) throw errors.error;
      return new Response(JSON.stringify({ success:true, period_days:7, summary:{ conversations:conversations.count||0, messages:messages.count||0, activity_events:activities.count||0, successful_purchases:successful.count||0, failed_purchases:failed.count||0, pending_purchases:pending.count||0 } }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
    }

    // AI MANAGEMENT: admin-only settings read/write
    if (body.action === "ai_settings_get" || body.action === "ai_settings_save") {
      if (!isAdmin) return new Response(JSON.stringify({ success:false, error:"Admin access required." }), { status:403, headers:{...corsHeaders,"Content-Type":"application/json"} });
      if (body.action === "ai_settings_get") {
        const { data, error } = await supabase.from("ai_settings").select("*").limit(1).maybeSingle();
        if (error) throw error;
        return new Response(JSON.stringify({success:true, settings:data}), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }
      const patch:any = {};
      for (const key of ["enabled","gemini_enabled","require_purchase_confirmation","max_purchase_amount","default_language","allowed_channels","fallback_message"]) if (body.settings?.[key] !== undefined) patch[key]=body.settings[key];
      patch.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from("ai_settings").update(patch).not("id","is",null).select("*").limit(1).single();
      if (error) throw error;
      return new Response(JSON.stringify({success:true,settings:data}), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
    }

    // AI MANAGEMENT: admin-only customer wallet history
    if (body.action === "ai_customer_wallet") {
      if (!isAdmin) return new Response(JSON.stringify({ success:false, error:"Admin access required." }), { status:403, headers:{...corsHeaders,"Content-Type":"application/json"} });
      const customerId = String(body.user_id || "").trim();
      if (!customerId) return new Response(JSON.stringify({ success:false, error:"Customer user_id is required." }), { status:400, headers:{...corsHeaders,"Content-Type":"application/json"} });
      const [wallet, walletTx] = await Promise.all([
        supabase.from("wallets").select("id,user_id,balance,currency,updated_at").eq("user_id",customerId).maybeSingle(),
        supabase.from("wallet_transactions").select("id,type,amount,reference,balance_before,balance_after,status,created_at").eq("user_id",customerId).order("created_at",{ascending:false}).limit(50)
      ]);
      if (wallet.error) throw wallet.error;
      if (walletTx.error) throw walletTx.error;
      return new Response(JSON.stringify({success:true,wallet:wallet.data||null,transactions:walletTx.data||[]}), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
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
      await persistAssistantMessage(answer, "airtime_purchase", "backend");

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
    // ADMIN STATUS
    // ==========================================

    if (body.action === "admin_status") {
      return new Response(
        JSON.stringify({
          success: true,
          authenticated: true,
          is_admin: isAdmin,
          role: bindawasubUser.role,
          user: {
            id: bindawasubUser.id,
            name: bindawasubUser.name,
            phone: bindawasubUser.phone,
          },
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
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

      let conversationLookupError:any = null;

      if (requestedConversationId) {
        const result = await supabase
          .from("ai_conversations")
          .select("id, conversation_context, pending_product_id, pending_phone_number, pending_at, pending_service_type, pending_airtime_amount, pending_network, pending_customer_input")
          .eq("id", requestedConversationId)
          .eq("user_id", userId)
          .eq("channel", channel)
          .maybeSingle();

        existingConversation = result.data;
        conversationLookupError = result.error;

        if (conversationLookupError) {
          throw conversationLookupError;
        }

        if (!existingConversation) {
          return new Response(JSON.stringify({
            success: false,
            error: "Conversation not found."
          }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } else {
        const result = await supabase
          .from("ai_conversations")
          .select("id, conversation_context, pending_product_id, pending_phone_number, pending_at, pending_service_type, pending_airtime_amount, pending_network, pending_customer_input")
          .eq("user_id", userId)
          .eq("channel", channel)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        existingConversation = result.data;
        conversationLookupError = result.error;

        if (conversationLookupError) {
          console.error("Conversation lookup error:", conversationLookupError);
        }
      }

      if (existingConversation) {
        conversationId = existingConversation.id;
        conversationContext = existingConversation.conversation_context && typeof existingConversation.conversation_context === "object"
          ? existingConversation.conversation_context
          : {};
      } else {
        const { data: newConversation, error: conversationCreateError } =
          await supabase
            .from("ai_conversations")
            .insert({
              user_id: userId,
              channel,
              language: aiConfig?.default_language || "english",
              started_at: new Date().toISOString(),
              last_message_at: new Date().toISOString(),
            })
            .select("id")
            .single();

        if (conversationCreateError) {
          console.error("Conversation create error:", conversationCreateError);
        } else {
          conversationId = newConversation.id;
        }
      }

      if (conversationId) {
        await supabase
          .from("ai_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conversationId)
        .eq("user_id", userId)
        .eq("channel", channel);

        await logAiMessage("user", originalMessage);
        await logAiActivity(
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

    // ==========================================
    // AI MANAGEMENT LOGGING
    // ==========================================
    async function logAiMessage(
      role: "user" | "assistant",
      text: string,
      intent: string | null = null,
      toolCalled: string | null = null,
    ) {
      if (!conversationId || !text) return;
      try {
        await supabase.from("ai_messages").insert({
          conversation_id: conversationId,
          role,
          message: text,
          intent,
          tool_called: toolCalled,
        });
      } catch (e) {
        console.error("AI message logging error:", e);
      }
    }

    async function persistAssistantMessage(answer: any, intent: string | null, toolCalled: string | null = null) {
      const textValue = typeof answer === "string" ? answer : "";
      if (!textValue) return;
      await logAiMessage("assistant", textValue, intent, toolCalled);
    }

    async function logAiActivity(
      eventType: string,
      intent: string | null,
      userMessage: string | null,
      aiResponse: string | null,
      success: boolean,
      errorMessage: string | null = null,
      transactionId: string | null = null,
      metadata: Record<string, unknown> = {},
    ) {
      try {
        await supabase.from("ai_activity_log").insert({
          user_id: userId,
          conversation_id: conversationId,
          transaction_id: transactionId,
          channel,
          event_type: eventType,
          intent,
          user_message: userMessage,
          ai_response: aiResponse,
          success,
          error_message: errorMessage,
          metadata,
        });
      } catch (e) {
        console.error("AI activity logging error:", e);
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
  if (!isAdmin) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Admin access required.",
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

  const search = String(body.search || "").trim();

  if (!search) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Search name or phone number.",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  const { data: customers, error: searchError } =
    await supabase
      .from("users")
      .select(`
        id,
        name,
        phone,
        role,
        wallets (
          balance
        )
      `)
      .or(
        `name.ilike.%${search}%,phone.ilike.%${search}%`
      )
      .order("name", { ascending: true })
      .limit(20);

  if (searchError) {
    console.error(
      "Customer search error:",
      searchError
    );

    return new Response(
      JSON.stringify({
        success: false,
        error: searchError.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  // Normalize the wallet relation so the frontend
  // always receives wallets as an array.
  const normalizedCustomers = (customers || []).map(
    (customer) => {
      const wallet = Array.isArray(customer.wallets)
        ? customer.wallets[0]
        : customer.wallets;

      const balance = Number(wallet?.balance ?? 0);

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        role: customer.role,

        wallets: [
          {
            balance: Number.isFinite(balance)
              ? balance
              : 0,
          },
        ],
      };
    }
  );

  return new Response(
    JSON.stringify({
      success: true,
      intent: "customer_search",
      customers: normalizedCustomers,
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
}


    // ==========================================
    // CHECK WALLET
    // ==========================================

    if (body.action === "check_wallet") {
      const amount = Number(body.amount || 0);

      const { data, error } = await supabase.rpc(
        "get_my_balance",
        {
          p_user_id: userId,
        }
      );

      if (error) {
        throw error;
      }

      const wallet = data?.[0];

      if (!wallet) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Wallet not found",
          }),
          {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }

      const sufficient =
        Number(wallet.balance) >= amount;

      return new Response(
        JSON.stringify({
          success: true,
          balance: wallet.balance,
          currency: wallet.currency,
          sufficient,
          answer: sufficient
            ? `Your wallet balance is ₦${Number(
                wallet.balance
              ).toLocaleString()}.`
            : `Your wallet balance is ₦${Number(
                wallet.balance
              ).toLocaleString()}, but ₦${amount.toLocaleString()} is required.`,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }



    // ==========================================
    // CUSTOMER FAST REQUERY FOR PENDING PURCHASE
    // ==========================================

    if (body.action === "requery_pending_purchase") {
      const transactionId = String(body.transaction_id || "").trim();

      if (!transactionId) {
        return new Response(
          JSON.stringify({ success:false, error:"transaction_id is required." }),
          { status:400, headers:{...corsHeaders,"Content-Type":"application/json"} }
        );
      }

      const { data: pendingTx, error: pendingTxError } = await supabase
        .from("transactions")
        .select("id,user_id,status,provider_reference")
        .eq("id", transactionId)
        .eq("user_id", userId)
        .maybeSingle();

      if (pendingTxError) throw pendingTxError;
      if (!pendingTx) {
        return new Response(
          JSON.stringify({ success:false, error:"Transaction not found." }),
          { status:404, headers:{...corsHeaders,"Content-Type":"application/json"} }
        );
      }

      if (["successful","failed","reversed"].includes(String(pendingTx.status || "").toLowerCase())) {
        return new Response(
          JSON.stringify({
            success:true,
            intent:"requery_pending_purchase",
            transaction_id:pendingTx.id,
            status:pendingTx.status,
            finalized:true
          }),
          { status:200, headers:{...corsHeaders,"Content-Type":"application/json"} }
        );
      }

      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      if (!serviceRoleKey || !supabaseUrl) {
        throw new Error("Supabase server configuration is incomplete.");
      }

      const response = await fetch(
        `${supabaseUrl}/functions/v1/provider-execution`,
        {
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Authorization":`Bearer ${serviceRoleKey}`,
            "apikey":serviceRoleKey
          },
          body:JSON.stringify({
            action:"requery_transaction",
            transaction_id:transactionId
          })
        }
      );

      const raw = await response.text();
      let result:any;
      try { result = JSON.parse(raw); } catch { result = { success:false, error:raw }; }

      if (!response.ok) {
        throw new Error(result?.error || "Provider requery failed.");
      }

      return new Response(
        JSON.stringify({
          success:true,
          intent:"requery_pending_purchase",
          ...result
        }),
        { status:200, headers:{...corsHeaders,"Content-Type":"application/json"} }
      );
    }

    // ==========================================
    // CUSTOMER TRANSACTION HISTORY / STATUS
    // ==========================================

    if (
      body.action === "transaction_history" ||
      body.action === "last_transaction" ||
      body.action === "transaction_status"
    ) {
      const requestedLimit =
        Math.min(Math.max(Number(body.limit || 5), 1), 10);

      let transactionQuery = supabase
        .from("transactions")
        .select(`
          id,
          created_at,
          phone_number,
          amount,
          status,
          provider,
          provider_reference,
          product_id,
          products (
            product_name,
            volume,
            validity_type,
            validity_value,
            validity_unit,
            service_networks(code,name)
          )
        `)
        .eq("user_id", userId);

      if (body.action === "transaction_status" && body.transaction_id) {
        transactionQuery = transactionQuery
          .eq("id", String(body.transaction_id).trim())
          .limit(1);
      } else {
        transactionQuery = transactionQuery
          .order("created_at", { ascending: false })
          .limit(
            body.action === "last_transaction" ||
            body.action === "transaction_status"
              ? 1
              : requestedLimit
          );
      }

      const { data: recentTransactions, error: transactionError } =
        await transactionQuery;

      if (transactionError) {
        console.error("Transaction history error:", transactionError);
        throw transactionError;
      }

      const rows = recentTransactions || [];

      const maskPhone = (phone: string | null) => {
        if (!phone) return "—";
        const digits = phone.replace(/\\D/g, "");
        if (digits.length < 7) return phone;
        return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
      };

      const normalizeProduct = (product: any) =>
        Array.isArray(product) ? product[0] : product;

      const formatted = rows.map((tx: any) => {
        const product = normalizeProduct(tx.products);
        return {
          id: tx.id,
          date: tx.created_at,
          product_name: product?.product_name || "Purchase",
          network: (Array.isArray(product?.service_networks)?product.service_networks[0]:product?.service_networks)?.code || null,
          volume: product?.volume || null,
          duration: product?.validity_type==="fixed"&&product?.validity_value!=null&&product?.validity_unit?`${product.validity_value} ${product.validity_unit}`:(product?.validity_type==="unlimited"?"Unlimited":null),
          phone_number: maskPhone(tx.phone_number),
          amount: Number(tx.amount || 0),
          status: tx.status,
          provider: tx.provider,
          provider_reference: tx.provider_reference || null,
        };
      });

      if (body.action === "transaction_history") {
        const answer =
          formatted.length === 0
            ? "You do not have any purchases yet."
            : `Here are your latest ${formatted.length} purchase${formatted.length === 1 ? "" : "s"}.`;

        return new Response(
          JSON.stringify({
            success: true,
            intent: "transaction_history",
            transactions: formatted,
            answer,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (formatted.length === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            intent: body.action,
            transaction: null,
            answer: "You do not have any purchases yet.",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const latest = formatted[0];

      let answer = `Your latest purchase is ${latest.product_name} for ₦${latest.amount.toLocaleString()} to ${latest.phone_number}. Status: ${latest.status}.`;

      if (body.action === "transaction_status") {
        if (latest.status === "successful") {
          answer = `Yes. Your latest purchase, ${latest.product_name}, was successful.`;
        } else if (latest.status === "failed") {
          answer = `Your latest purchase, ${latest.product_name}, failed.`;
        } else {
          answer = `Your latest purchase, ${latest.product_name}, is currently ${latest.status}.`;
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          intent: body.action,
          transaction: latest,
          answer,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ==========================================
// ==========================================
// FUND WALLET — MANUAL BANK TRANSFER (CURRENT MODE)
// ==========================================

if (body.action === "fund_wallet" || body.action === "manual_funding_request") {
  const { data: settings, error: settingsError } = await supabase
    .from("manual_funding_settings")
    .select("active, bank_name, account_name, account_number, instructions")
    .eq("id", 1)
    .maybeSingle();

  if (settingsError) throw settingsError;

  if (!settings?.active) {
    return new Response(JSON.stringify({
      success: false,
      intent: "fund_wallet",
      error: "Manual wallet funding is temporarily unavailable."
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const requestedAmount = Number(body.amount || 0);

  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return new Response(JSON.stringify({
      success: true,
      intent: "fund_wallet",
      funding_mode: "manual",
      requires_amount: true,
      bank_account: settings?.account_number ? {
        bank_name: settings.bank_name,
        account_name: settings.account_name,
        account_number: settings.account_number
      } : null,
      instructions: settings?.instructions || "Enter the amount you want to fund, then transfer the exact amount using the payment details provided.",
      answer: settings?.account_number
        ? "You can fund your wallet by bank transfer. Please enter the amount you want to add."
        : "Manual funding is ready. Please enter the amount you want to add. The bank transfer details will be shown once configured."
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const reference = `MFR-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;

  const { data: request, error: requestError } = await supabase
    .from("manual_funding_requests")
    .insert({
      user_id: userId,
      amount: requestedAmount,
      reference,
      status: "pending"
    })
    .select("id, amount, reference, status, created_at")
    .single();

  if (requestError) throw requestError;

  return new Response(JSON.stringify({
    success: true,
    intent: "fund_wallet",
    funding_mode: "manual",
    requires_payment: true,
    request,
    bank_account: settings?.account_number ? {
      bank_name: settings.bank_name,
      account_name: settings.account_name,
      account_number: settings.account_number
    } : null,
    instructions: settings?.instructions || "Transfer the exact amount to the configured Bindawasub bank account, then submit your transfer reference.",
    answer: settings?.account_number
      ? `Funding request created for ₦${requestedAmount.toLocaleString("en-NG")}. Transfer the exact amount to the account below, then send your transfer reference.`
      : `Funding request ${reference} created for ₦${requestedAmount.toLocaleString("en-NG")}. Bank transfer details have not been configured yet.`
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ==========================================
// SUBMIT MANUAL FUNDING PAYMENT REFERENCE
// ==========================================

if (body.action === "manual_funding_submit") {
  const requestId = String(body.request_id || "").trim();
  const paymentReference = String(body.payment_reference || "").trim();

  if (!requestId || !paymentReference) {
    return new Response(JSON.stringify({
      success: false,
      error: "Funding request ID and payment reference are required."
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: request, error: requestError } = await supabase
    .from("manual_funding_requests")
    .select("id, amount, reference, status, payment_reference")
    .eq("id", requestId)
    .eq("user_id", userId)
    .maybeSingle();

  if (requestError) throw requestError;
  if (!request) {
    return new Response(JSON.stringify({ success:false, error:"Funding request not found." }), { status:404, headers:{...corsHeaders,"Content-Type":"application/json"} });
  }

  if (!["pending","submitted"].includes(request.status)) {
    return new Response(JSON.stringify({ success:false, error:`This funding request is already ${request.status}.` }), { status:400, headers:{...corsHeaders,"Content-Type":"application/json"} });
  }

  const { data: updated, error: updateError } = await supabase
    .from("manual_funding_requests")
    .update({
      payment_reference: paymentReference,
      status: "submitted",
      submitted_at: new Date().toISOString()
    })
    .eq("id", request.id)
    .eq("user_id", userId)
    .select("id, amount, reference, payment_reference, status, submitted_at")
    .single();

  if (updateError) throw updateError;

  return new Response(JSON.stringify({
    success:true,
    intent:"manual_funding_submit",
    request:updated,
    answer:"Payment reference submitted. Your funding request is now waiting for admin verification. Your wallet will be credited after the transfer is verified."
  }), { status:200, headers:{...corsHeaders,"Content-Type":"application/json"} });
}

// ==========================================
// MANUAL FUNDING HISTORY — CUSTOMER
// ==========================================

if (body.action === "manual_funding_history") {
  const { data: requests, error: historyError } = await supabase
    .from("manual_funding_requests")
    .select("id, amount, reference, payment_reference, status, note, created_at, submitted_at, reviewed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending:false })
    .limit(20);

  if (historyError) throw historyError;

  return new Response(JSON.stringify({
    success:true,
    intent:"manual_funding_history",
    requests:requests || [],
    answer: requests?.length ? `Here are your latest ${requests.length} funding requests.` : "You have no manual funding requests yet."
  }), { status:200, headers:{...corsHeaders,"Content-Type":"application/json"} });
}

// ==========================================
// MANUAL FUNDING REQUESTS — ADMIN
// ==========================================

if (body.action === "manual_funding_requests") {
  if (!isAdmin) return new Response(JSON.stringify({success:false,error:"Admin access required."}),{status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});

  const statusFilter = String(body.status || "submitted").toLowerCase();
  const allowedStatuses = new Set(["pending","submitted","approved","rejected","cancelled","all"]);
  const status = allowedStatuses.has(statusFilter) ? statusFilter : "submitted";

  let query = supabase
    .from("manual_funding_requests")
    .select("id, user_id, amount, reference, payment_reference, status, note, created_at, submitted_at, reviewed_at, reviewed_by, users(name, phone, email)")
    .order("created_at", {ascending:false})
    .limit(100);

  if (status !== "all") query = query.eq("status", status);

  const { data: requests, error } = await query;
  if (error) throw error;

  return new Response(JSON.stringify({success:true,intent:"manual_funding_requests",requests:requests||[]}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
}

if (body.action === "manual_funding_approve") {
  if (!isAdmin) return new Response(JSON.stringify({success:false,error:"Admin access required."}),{status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});

  const requestId = String(body.request_id || "").trim();
  if (!requestId) return new Response(JSON.stringify({success:false,error:"Funding request ID is required."}),{status:400,headers:{...corsHeaders,"Content-Type":"application/json"}});

  const { data, error } = await supabase.rpc("approve_manual_funding", {
    p_request_id: requestId,
    p_admin_user_id: userId
  });
  if (error) throw error;

  const result = data?.[0];
  return new Response(JSON.stringify({
    success:!!result?.success,
    intent:"manual_funding_approve",
    funding:result || null,
    answer:result?.message || "Funding approval completed."
  }),{status:result?.success?200:400,headers:{...corsHeaders,"Content-Type":"application/json"}});
}

if (body.action === "manual_funding_reject") {
  if (!isAdmin) return new Response(JSON.stringify({success:false,error:"Admin access required."}),{status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});

  const requestId = String(body.request_id || "").trim();
  const note = body.note ? String(body.note).trim() : null;
  if (!requestId) return new Response(JSON.stringify({success:false,error:"Funding request ID is required."}),{status:400,headers:{...corsHeaders,"Content-Type":"application/json"}});

  const { data, error } = await supabase.rpc("reject_manual_funding", {
    p_request_id: requestId,
    p_admin_user_id: userId,
    p_reason: note
  });
  if (error) throw error;

  const result = data?.[0];

  return new Response(JSON.stringify({
    success:!!result?.success,
    intent:"manual_funding_reject",
    request:result || null,
    answer:result?.message || "Funding rejection completed."
  }),{status:result?.success?200:400,headers:{...corsHeaders,"Content-Type":"application/json"}});
}

if (body.action === "manual_funding_settings_get") {
  if (!isAdmin) return new Response(JSON.stringify({success:false,error:"Admin access required."}),{status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});
  const { data, error } = await supabase.from("manual_funding_settings").select("*").eq("id",1).maybeSingle();
  if (error) throw error;
  return new Response(JSON.stringify({success:true,settings:data}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
}

if (body.action === "manual_funding_settings_save") {
  if (!isAdmin) return new Response(JSON.stringify({success:false,error:"Admin access required."}),{status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});
  const settings = body.settings || {};
  const { data, error } = await supabase
    .from("manual_funding_settings")
    .upsert({
      id:1,
      active: settings.active !== false,
      bank_name: settings.bank_name ? String(settings.bank_name).trim() : null,
      account_name: settings.account_name ? String(settings.account_name).trim() : null,
      account_number: settings.account_number ? String(settings.account_number).trim() : null,
      instructions: settings.instructions ? String(settings.instructions).trim() : null,
      updated_at:new Date().toISOString()
    }, {onConflict:"id"})
    .select("*")
    .single();
  if (error) throw error;
  return new Response(JSON.stringify({success:true,settings:data}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
}

// MANUAL WALLET FUNDING — ADMIN ONLY
// ==========================================

if (body.action === "manual_fund") {

  if (!isAdmin) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Admin access required.",
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

  const customerUserId =
    String(body.customer_user_id || "").trim();

  const amount =
    Number(body.amount || 0);

  const reference =
    String(body.reference || "").trim();

  const note =
    body.note
      ? String(body.note).trim()
      : null;

  if (!customerUserId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Customer user ID is required.",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  if (!amount || amount <= 0) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Funding amount must be greater than zero.",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  if (!reference) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "Payment reference is required.",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  const { data: fundingResult, error: fundingError } =
    await supabase.rpc(
      "manual_fund_wallet",
      {
        p_user_id: customerUserId,
        p_amount: amount,
        p_reference: reference,
        p_note: note,
      }
    );

  if (fundingError) {
    console.error(
      "Manual funding error:",
      fundingError
    );

    return new Response(
      JSON.stringify({
        success: false,
        error: fundingError.message,
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  const result = fundingResult?.[0];

  if (!result) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "No funding result returned.",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }

  return new Response(
    JSON.stringify({
      success: result.success,
      intent: "manual_fund",
      funding: result,
      answer: result.success
        ? `Wallet funded successfully. New balance: ₦${Number(
            result.balance_after
          ).toLocaleString()}.`
        : result.message,
    }),
    {
      status: result.success ? 200 : 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
}
    // ==========================================
    // CONFIRMATION OF A PENDING PURCHASE
    // ==========================================

    const affirmativeConfirmation=/^(yes|yeah|yep|ok|okay|confirm|confirmed|proceed|go ahead|do it|eh|e|naam|toh)/i.test(originalMessage.trim());
    const negativeConfirmation=/^(no|nope|cancel|stop|a'a|ba na so|kar a|kar a yi)/i.test(originalMessage.trim());

    if (conversationId && (affirmativeConfirmation || negativeConfirmation)) {
      const {data:pendingConversation,error:pendingError}=await supabase
        .from("ai_conversations")
        .select("pending_product_id,pending_phone_number,pending_at,pending_service_type,pending_airtime_amount,pending_network,pending_idempotency_key,pending_customer_input")
        .eq("id",conversationId)
        .eq("user_id",userId)
        .eq("channel",channel)
        .maybeSingle();

      if(pendingError) console.error("Pending purchase lookup error:",pendingError);

      const pendingInput=pendingConversation?.pending_customer_input && typeof pendingConversation.pending_customer_input==="object"
        ? pendingConversation.pending_customer_input : {};

      const pendingIsAirtime=pendingConversation?.pending_service_type==="airtime" &&
        !!pendingConversation?.pending_airtime_amount && !!pendingConversation?.pending_network && !!pendingConversation?.pending_phone_number;

      const pendingIsProductPurchase=!!pendingConversation?.pending_product_id && Object.keys(pendingInput).length>0;

      const hasPendingPurchase = pendingIsProductPurchase || pendingIsAirtime;
      const pendingIsFresh=!!pendingConversation?.pending_at &&
        Date.now()-new Date(pendingConversation.pending_at).getTime()<=15*60*1000 &&
        hasPendingPurchase;

      if (hasPendingPurchase) {
        const clearPending=async()=>{await supabase.from("ai_conversations").update({
        pending_product_id:null,pending_phone_number:null,pending_at:null,pending_service_type:null,
        pending_airtime_amount:null,pending_network:null,pending_idempotency_key:null,pending_customer_input:{}
      }).eq("id",conversationId)
        .eq("user_id",userId)
        .eq("channel",channel);};

      if(negativeConfirmation){
        if(pendingIsFresh) await clearPending();
        await persistAssistantMessage(pendingIsFresh ? "Okay, I cancelled the pending purchase. No money was deducted." : "There is no active purchase waiting for confirmation.", "purchase_cancelled", "backend");
        return new Response(JSON.stringify({
          success:true,intent:"purchase_cancelled",
          answer:pendingIsFresh ? "Okay, I cancelled the pending purchase. No money was deducted." : "There is no active purchase waiting for confirmation."
        }),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      if(affirmativeConfirmation && pendingIsFresh){
        const purchaseReference=`BW-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        const pendingIdempotencyKey=String(pendingConversation?.pending_idempotency_key || `AI-${conversationId}-${pendingConversation?.pending_at || Date.now()}`);
        await clearPending();

        if(pendingIsAirtime){
          body.action="airtime_purchase";
          body.network=pendingConversation.pending_network;
          body.amount=Number(pendingConversation.pending_airtime_amount);
          body.phone_number=pendingConversation.pending_phone_number;
          body.reference=purchaseReference;
          body.idempotency_key=pendingIdempotencyKey;
        }else{
          body.action="purchase";
          body.product_id=pendingConversation.pending_product_id;
          body.phone_number=pendingConversation.pending_phone_number || pendingInput.phone || null;
          body.customer_input=pendingInput;
          body.reference=purchaseReference;
          body.idempotency_key=pendingIdempotencyKey;
        }
      }else if(affirmativeConfirmation){
        await persistAssistantMessage("That purchase confirmation has expired. Please start the purchase again.", "purchase_confirmation_expired", "backend");
        return new Response(JSON.stringify({
          success:true,intent:"purchase_confirmation_expired",
          answer:"That purchase confirmation has expired. Please start the purchase again."
        }),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }
      }
    }

    // ==========================================
    // AIRTIME PURCHASE
    // ==========================================

    if (body.action === "airtime_purchase") {
      return await handleAirtimePurchase({
          body,
          supabase,
          userId,
          channel,
          conversationId,
          aiConfig,
          originalMessage,
          corsHeaders,
          executeViaProviderExecution,
          loadCustomerTransaction,
          buildPurchaseConfirmation,
          persistAssistantMessage,
          logAiActivity,
        });
    }

    // ==========================================
    // PURCHASE
    // ==========================================

    if (body.action === "purchase") {
      return await handleDataPurchase({
          body,
          supabase,
          userId,
          channel,
          conversationId,
          aiConfig,
          originalMessage,
          corsHeaders,
          executeViaProviderExecution,
          loadCustomerTransaction,
          buildPurchaseConfirmation,
          persistAssistantMessage,
          logAiActivity,
        });
    }

    // ==========================================
    // DETERMINISTIC CUSTOMER ACCOUNT INTENTS
    // Keep account-history requests out of Gemini.
    // ==========================================

    const normalizedFundingMessage = originalMessage.trim().toLowerCase();

    const wantsFundingHistory =
      normalizedFundingMessage.includes("funding history") ||
      normalizedFundingMessage.includes("funding histories") ||
      normalizedFundingMessage.includes("show my funding") ||
      normalizedFundingMessage.includes("my funding") ||
      normalizedFundingMessage.includes("wallet funding") ||
      normalizedFundingMessage.includes("funding transactions") ||
      normalizedFundingMessage.includes("deposit history") ||
      normalizedFundingMessage.includes("deposit histories") ||
      normalizedFundingMessage.includes("show my deposits") ||
      normalizedFundingMessage.includes("my deposits") ||
      normalizedFundingMessage.includes("how did i fund my wallet") ||
      normalizedFundingMessage.includes("how did i fund") ||
      normalizedFundingMessage.includes("tarihin funding") ||
      normalizedFundingMessage.includes("tarihin kudin wallet") ||
      normalizedFundingMessage.includes("yadda na saka kudi") ||
      normalizedFundingMessage.includes("kudin da na saka") ||
      normalizedFundingMessage.includes("yadda na cika wallet") ||
      normalizedFundingMessage.includes("cikawa wallet");

    const wantsTransactionHistory =
      /\b(transaction history|transaction histories|show my transactions|show my transaction|my transactions|my transaction history|purchase history|purchase histories|show my purchases|my purchases|show transactions|history)\b/i.test(originalMessage) ||
      /\b(taarihin ciniki|tarihin ciniki|tarihin sayayya|abubuwan da na saya|abinda na saya)\b/i.test(originalMessage);

    const wantsLastTransaction =
      /\b(last transaction|latest transaction|last purchase|latest purchase|most recent purchase|most recent transaction)\b/i.test(originalMessage) ||
      /\b(sayayyata ta karshe|sayan da na yi na karshe|ciniki na karshe)\b/i.test(originalMessage);

    const wantsTransactionStatus =
      /\b(transaction status|purchase status|did my last purchase go through|was my last purchase successful|is my purchase successful|is my transaction successful)\b/i.test(originalMessage) ||
      /\b(sayayyata ta yi nasara|sayayyata ta samu|ciniki na yi nasara)\b/i.test(originalMessage);

    if (!wantsFundingHistory && (wantsTransactionHistory || wantsLastTransaction || wantsTransactionStatus)) {
      const accountAction = wantsTransactionHistory
        ? "transaction_history"
        : wantsLastTransaction
          ? "last_transaction"
          : "transaction_status";

      const { data: recentTransactions, error: transactionError } =
        await supabase
          .from("transactions")
          .select(`
            id, created_at, phone_number, amount, status, provider, provider_reference,
            product_id, products (product_name, volume, validity_type, validity_value, validity_unit, service_networks(code,name))
          `)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(accountAction === "transaction_history" ? 5 : 1);

      if (transactionError) {
        console.error("Deterministic transaction history error:", transactionError);
        throw transactionError;
      }

      const rows = recentTransactions || [];
      const maskPhone = (phone: string | null) => {
        if (!phone) return "—";
        const digits = phone.replace(/\D/g, "");
        if (digits.length < 7) return phone;
        return digits.slice(0, 4) + "****" + digits.slice(-3);
      };

      const normalizeProduct = (product: any) =>
        Array.isArray(product) ? product[0] : product;

      const formatted = rows.map((tx: any) => {
        const product = normalizeProduct(tx.products);
        return {
          id: tx.id,
          date: tx.created_at,
          product_name: product?.product_name || "Purchase",
          network: product?.network || null,
          volume: product?.volume || null,
          duration: product?.duration || null,
          phone_number: maskPhone(tx.phone_number),
          amount: Number(tx.amount || 0),
          status: tx.status,
          provider: tx.provider,
          provider_reference: tx.provider_reference || null,
        };
      });

      if (formatted.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          intent: accountAction,
          transactions: accountAction === "transaction_history" ? [] : undefined,
          transaction: accountAction === "transaction_history" ? undefined : null,
          answer: "You do not have any purchases yet.",
          ai_powered: false,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (accountAction === "transaction_history") {
        return new Response(JSON.stringify({
          success: true,
          intent: "transaction_history",
          transactions: formatted,
          answer: "Here are your latest " + formatted.length + " purchase" + (formatted.length === 1 ? "" : "s") + ".",
          ai_powered: false,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const latest = formatted[0];
      let answer =
        "Your latest purchase is " + latest.product_name +
        " for ₦" + latest.amount.toLocaleString() +
        " to " + latest.phone_number +
        ". Status: " + latest.status + ".";

      if (accountAction === "transaction_status") {
        if (latest.status === "successful") {
          answer = "Yes. Your latest purchase, " + latest.product_name + ", was successful.";
        } else if (latest.status === "failed") {
          answer = "Your latest purchase, " + latest.product_name + ", failed.";
        } else {
          answer = "Your latest purchase, " + latest.product_name + ", is currently " + latest.status + ".";
        }
      }

      return new Response(JSON.stringify({
        success: true,
        intent: accountAction,
        transaction: latest,
        answer,
        ai_powered: false,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ==========================================
    // CUSTOMER FUNDING HISTORY
    // Keep funding-history requests deterministic so Gemini cannot invent deposits.
    // ==========================================



    if (wantsFundingHistory) {
      const requestedLimit = Math.min(Math.max(Number(body.limit || 5), 1), 10);

      const { data: fundingRows, error: fundingError } = await supabase
        .from("wallet_funding")
        .select("id, amount, reference, billstack_reference, status, payment_method, created_at, completed_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(requestedLimit);

      if (fundingError) {
        console.error("Funding history error:", fundingError);
        throw fundingError;
      }

      const formattedFunding = (fundingRows || []).map((funding: any) => ({
        id: funding.id,
        amount: Number(funding.amount || 0),
        reference: funding.reference || null,
        billstack_reference: funding.billstack_reference || null,
        status: funding.status || "unknown",
        payment_method: funding.payment_method || null,
        date: funding.completed_at || funding.created_at,
      }));

      return new Response(JSON.stringify({
        success: true,
        intent: "funding_history",
        funding: formattedFunding,
        answer: formattedFunding.length > 0
          ? `Here are your latest ${formattedFunding.length} wallet funding transaction${formattedFunding.length === 1 ? "" : "s"}.`
          : "You do not have any wallet funding records yet.",
        ai_powered: false,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ==========================================
    // GREETINGS
    // ==========================================

    if (
      message.includes("hello") ||
      message.includes("hi") ||
      message.includes("hey") ||
      message.includes("sannu")
    ) {
      return new Response(
        JSON.stringify({
          success: true,
          intent: "greeting",
          answer:
            "Hello! Welcome to Bindawasub. How can I help you today?",
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    // ==========================================
    // DETECT NATURAL PURCHASE REQUESTS
    // Send purchase-like messages to Gemini FIRST
    // before the product-enquiry keyword rules.
    // ==========================================

    const hasPhoneNumber =
      /(?:\+234|234|0)\d{10}\b/.test(originalMessage);

    const hasPurchaseLanguage =
      /\b(buy|purchase|get|order|send|activate|subscribe)\b/i.test(
        originalMessage
      ) ||
      /\b(saya|sayi|siyo|siya|oda|aika|kunna)\b/i.test(
        originalMessage
      ) ||
      message.includes("ina son saya") ||
      message.includes("ina son siye") ||
      message.includes("zan saya") ||
      message.includes("zan siye") ||
      message.includes("ina so in saya") ||
      message.includes("ina so in siye");

    const shouldUseGeminiFirst =
      hasPhoneNumber && hasPurchaseLanguage;

    // ==========================================
    // PRODUCT ENQUIRY
    // Product specification is resolved deterministically from the live
    // catalog: network -> data type -> plans.
    // ==========================================

    if (
      !shouldUseGeminiFirst &&
      (
        message.includes("data") ||
        message.includes("package") ||
        message.includes("plan") ||
        /\b(mtn|airtel|glo|9mobile|t2)\b/i.test(message)
      )
    ) {
      const normalizeCatalogToken = (value:any) =>
        String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

      const requestedNetwork =
        /\bmtn\b/i.test(originalMessage) ? "mtn" :
        /\bairtel\b/i.test(originalMessage) ? "airtel" :
        /\bglo\b/i.test(originalMessage) ? "glo" :
        /\b(?:9mobile|t2)\b/i.test(originalMessage) ? "9mobile" :
        normalizeCatalogToken(conversationContext?.network) || null;

      const requestedVariant =
        /\b(?:sme|sme data|normal data)\b/i.test(originalMessage) ? "smedata" :
        /\b(?:social|social data)\b/i.test(originalMessage) ? "social" :
        /\b(?:gifting|gift|gift data)\b/i.test(originalMessage) ? "gifting" :
        /\bawoop\b/i.test(originalMessage) ? "awoop" :
        normalizeCatalogToken(conversationContext?.variant) || null;

      const { data: catalogProducts, error: catalogError } =
        await supabase
          .from("products")
          .select(
            "id, sku, service_type, product_name, volume, selling_price, validity_type, validity_value, validity_unit, network_id, variant_id, service_networks(code,name), service_variants(code,name), metadata"
          )
          .eq("active", true)
          .eq("service_type", "data")
          .order("selling_price", { ascending: true });

      if (catalogError) throw catalogError;

      const activeDataProducts = catalogProducts || [];

      const networkProducts = requestedNetwork
        ? activeDataProducts.filter((product:any) => {
            const network = Array.isArray(product.service_networks)
              ? product.service_networks[0]
              : product.service_networks;
            return normalizeCatalogToken(network?.code) === requestedNetwork ||
              normalizeCatalogToken(network?.name) === requestedNetwork;
          })
        : activeDataProducts;

      const variantProducts = requestedVariant
        ? networkProducts.filter((product:any) => {
            const variant = Array.isArray(product.service_variants)
              ? product.service_variants[0]
              : product.service_variants;
            return normalizeCatalogToken(variant?.code) === requestedVariant ||
              normalizeCatalogToken(variant?.name) === requestedVariant;
          })
        : networkProducts;

      const networkLabel = requestedNetwork === "9mobile"
        ? "9mobile (T2)"
        : requestedNetwork
          ? requestedNetwork.toUpperCase()
          : null;

      if (requestedNetwork && networkProducts.length === 0) {
        return new Response(JSON.stringify({
          success:true,
          intent:"product_enquiry",
          service_type:"data",
          network:requestedNetwork,
          products:[],
          available:false,
          answer:"There are currently no active data plans for " + networkLabel + "."
        }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      // Network selected without a specific data type:
      // return ALL active plans for that network. The customer UI groups them
      // under each Data Type heading, so the customer can compare packages
      // across SME, Social, Gifting, Awoop, etc. without another step.
      if (requestedNetwork && !requestedVariant) {
        const groupedTypes = Array.from(
          new Map(
            networkProducts.map((product:any) => {
              const variant = Array.isArray(product.service_variants)
                ? product.service_variants[0]
                : product.service_variants;
              const key = normalizeCatalogToken(variant?.code || variant?.name) || "data";
              return [key, {
                code: variant?.code || null,
                name: variant?.name || variant?.code || "Data",
                plan_count: 0
              }];
            })
          ).values()
        ).map((type:any) => ({
          ...type,
          plan_count: networkProducts.filter((product:any) => {
            const variant = Array.isArray(product.service_variants)
              ? product.service_variants[0]
              : product.service_variants;
            return normalizeCatalogToken(variant?.code || variant?.name) ===
              normalizeCatalogToken(type.code || type.name);
          }).length
        }));

        return new Response(JSON.stringify({
          success:true,
          intent:"product_enquiry",
          service_type:"data",
          network:requestedNetwork,
          network_name:networkLabel,
          data_types:groupedTypes,
          products:networkProducts,
          grouped_by:"data_type",
          answer:"Here are all available " + networkLabel + " data plans, grouped by data type."
        }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      if (requestedNetwork && requestedVariant && variantProducts.length === 0) {
        const variantLabel =
          requestedVariant === "smedata" ? "SME Data" :
          requestedVariant === "social" ? "Social Data" :
          requestedVariant === "gifting" ? "Gifting" :
          requestedVariant;

        return new Response(JSON.stringify({
          success:true,
          intent:"product_enquiry",
          service_type:"data",
          network:requestedNetwork,
          network_name:networkLabel,
          variant:requestedVariant,
          products:[],
          available:false,
          answer:variantLabel + " is currently not available on " + networkLabel + "."
        }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      return new Response(JSON.stringify({
        success:true,
        intent:"product_enquiry",
        service_type:"data",
        network:requestedNetwork,
        network_name:networkLabel,
        variant:requestedVariant,
        products:variantProducts,
        answer:requestedVariant
          ? "Here are the available " + (requestedVariant === "smedata" ? "SME Data" : requestedVariant === "social" ? "Social Data" : requestedVariant === "gifting" ? "Gifting" : requestedVariant) + " plans on " + networkLabel + "."
          : "Here are the available Bindawasub data plans."
      }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
    }

    // ==========================================
    // UNIVERSAL SERVICE CATALOG
    // ==========================================
    const { data: serviceDefinitions, error: serviceDefinitionError } =
      await supabase
        .from("service_definitions")
        .select("id, code, name, description, category, metadata")
        .eq("active", true)
        .order("code", { ascending: true });

    if (serviceDefinitionError) throw serviceDefinitionError;

    const serviceIds = (serviceDefinitions || []).map((s:any) => s.id);

    const { data: serviceFields, error: serviceFieldError } =
      serviceIds.length
        ? await supabase
            .from("service_fields")
            .select("service_id, field_key, label, data_type, required, sensitive, validation, display_order, metadata")
            .in("service_id", serviceIds)
            .eq("active", true)
            .order("display_order", { ascending: true })
        : { data: [], error: null };

    if (serviceFieldError) throw serviceFieldError;

    const serviceCatalog = (serviceDefinitions || []).map((service:any) => ({
      code: service.code,
      name: service.name,
      description: service.description,
      category: service.category,
      metadata: service.metadata || {},
      fields: (serviceFields || [])
        .filter((field:any) => field.service_id === service.id)
        .map((field:any) => ({
          key: field.field_key,
          label: field.label,
          data_type: field.data_type,
          required: field.required,
          sensitive: field.sensitive,
          validation: field.validation || {},
          metadata: field.metadata || {},
        })),
    }));

    // Load recent conversation turns so Gemini can resolve short follow-ups.
    let conversationHistory:any[] = [];
    if (conversationId) {
      const { data: historyRows, error: historyError } = await supabase
        .from("ai_messages")
        .select("role,message,intent,created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(13);
      if (historyError) {
        console.error("Conversation history lookup error:", historyError);
      } else {
        conversationHistory = (historyRows || []).reverse();
        const lastHistoryMessage = conversationHistory[conversationHistory.length - 1];
        if (
          lastHistoryMessage?.role === "user" &&
          String(lastHistoryMessage?.message || "") === String(originalMessage || "")
        ) {
          conversationHistory.pop();
        }
      }
    }

    // ==========================================
        // CUSTOMER QUICK ACTIONS: deterministic account data, no Gemini needed.
    if (body.action === "wallet_balance") {
      const { data: walletData, error: walletError } = await supabase.rpc("get_my_balance", { p_user_id: userId });
      if (walletError) throw walletError;
      const wallet = walletData?.[0];
      await persistAssistantMessage(`Your wallet balance is ₦${Number(wallet?.balance ?? 0).toLocaleString()}.`, "wallet_balance", "backend");
      return new Response(JSON.stringify({ success:true, intent:"wallet_balance", balance:wallet?.balance ?? 0, currency:wallet?.currency ?? "NGN", answer:`Your wallet balance is ₦${Number(wallet?.balance ?? 0).toLocaleString()}.`, ai_powered:false, quick_action:true }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
    }

    if (body.action === "transaction_history") {
      const { data: rows, error } = await supabase.from("transactions").select(`id,created_at,phone_number,amount,status,provider,provider_reference,products(product_name,volume,validity_value,validity_unit,validity_type,service_networks(code,name))`).eq("user_id",userId).order("created_at",{ascending:false}).limit(5);
      if (error) throw error;
      const transactions=(rows||[]).map((tx:any)=>{ const p=Array.isArray(tx.products)?tx.products[0]:tx.products; const n=Array.isArray(p?.service_networks)?p.service_networks[0]:p?.service_networks; const d=p?.validity_type==="fixed"&&p?.validity_value!=null&&p?.validity_unit?String(p.validity_value)+" "+String(p.validity_unit):(p?.validity_type==="unlimited"?"Unlimited":""); const digits=String(tx.phone_number||"").replace(/\\D/g,""); return {id:tx.id,date:tx.created_at,product_name:p?.product_name||"Purchase",network:n?.code||null,network_name:n?.name||null,volume:p?.volume||null,duration:d,phone_number:digits.length>=7?`${digits.slice(0,4)}****${digits.slice(-3)}`:"—",amount:Number(tx.amount||0),status:tx.status,provider:tx.provider,provider_reference:tx.provider_reference||null}; });
      await persistAssistantMessage(transactions.length ? `Here are your latest ${transactions.length} purchases.` : "You do not have any purchases yet.", "transaction_history", "backend");
      return new Response(JSON.stringify({success:true,intent:"transaction_history",transactions,answer:transactions.length?`Here are your latest ${transactions.length} purchases.`:"You do not have any purchases yet.",ai_powered:false,quick_action:true}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
    }

// Deterministic Airtime amount follow-up.
    // At this point conversationContext has already been loaded.
    const preAirtime = String(conversationContext?.service_type || "").toLowerCase() === "airtime";
    const preAirtimeNetwork = String(conversationContext?.network || "").trim().toLowerCase();
    const rawAirtimeFollowUp = String(originalMessage || "").trim();
    // An 11-digit Nigerian phone number is a recipient, never an Airtime amount.
    const looksLikeNigerianPhone = /^(?:0\d{10}|234\d{10})$/.test(rawAirtimeFollowUp.replace(/[\s-]/g, ""));
    const preNumericAmount = !looksLikeNigerianPhone
      ? rawAirtimeFollowUp.match(/^(?:₦\s*|NGN\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)$/i)
      : null;
    if (preAirtime && preNumericAmount && ["mtn","airtel","glo","9mobile"].includes(preAirtimeNetwork)) {
      const amount = Number(preNumericAmount[1].replace(/,/g, ""));
      if (Number.isFinite(amount) && amount > 0) {
        const nextContext = {
          ...(conversationContext || {}),
          service_type: "airtime",
          last_intent: "airtime_purchase",
          network: preAirtimeNetwork,
          airtime_amount: amount,
          updated_at: new Date().toISOString()
        };
        conversationContext = nextContext;
        await supabase.from("ai_conversations").update({
          conversation_context: nextContext,
          last_message_at: new Date().toISOString(),
          pending_service_type: "airtime",
          pending_airtime_amount: amount,
          pending_network: preAirtimeNetwork
        }).eq("id", conversationId)
          .eq("user_id", userId)
          .eq("channel", channel);

        const names:any = {mtn:"MTN",airtel:"Airtel",glo:"Glo","9mobile":"9mobile (T2)"};
        const answer = `You selected ${names[preAirtimeNetwork]} airtime worth ₦${amount.toLocaleString("en-NG")}. Please provide the recipient phone number.`;
        await persistAssistantMessage(answer, "airtime_purchase", "backend");
        return new Response(JSON.stringify({
          success:true,
          intent:"airtime_purchase",
          service_type:"airtime",
          network:preAirtimeNetwork,
          amount,
          answer,
          ai_powered:false,
          quick_action:true
        }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }
    }

    // Deterministic Airtime recipient follow-up. Once network + amount are stored,
    // a Nigerian phone number must complete the Airtime flow without Gemini.
    const airtimeContextActive =
      String(conversationContext?.service_type || existingConversation?.pending_service_type || "").toLowerCase() === "airtime";
    const storedAirtimeNetwork = String(
      conversationContext?.network || existingConversation?.pending_network || ""
    ).trim().toLowerCase();
    const storedAirtimeAmount = Number(
      conversationContext?.airtime_amount ?? existingConversation?.pending_airtime_amount ?? 0
    );
    const rawRecipient = String(originalMessage || "").trim().replace(/[\\s-]/g, "");
    const phoneMatch = rawRecipient.match(/^(?:0\d{10}|234\d{10})$/);

    if (
      airtimeContextActive &&
      phoneMatch &&
      ["mtn", "airtel", "glo", "9mobile"].includes(storedAirtimeNetwork) &&
      Number.isFinite(storedAirtimeAmount) &&
      storedAirtimeAmount > 0 &&
      conversationId
    ) {
      const phoneNumber = rawRecipient.startsWith("234")
        ? "0" + rawRecipient.slice(3)
        : rawRecipient;
      const nextContext = {
        ...(conversationContext || {}),
        last_intent: "airtime_purchase",
        service_type: "airtime",
        network: storedAirtimeNetwork,
        airtime_amount: storedAirtimeAmount,
        phone_number: phoneNumber,
        updated_at: new Date().toISOString()
      };

      conversationContext = nextContext;
      const pendingIdempotencyKey =
        `AI-${conversationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      await supabase.from("ai_conversations").update({
        conversation_context: nextContext,
        last_message_at: new Date().toISOString(),
        pending_product_id: null,
        pending_phone_number: phoneNumber,
        pending_at: new Date().toISOString(),
        pending_service_type: "airtime",
        pending_airtime_amount: storedAirtimeAmount,
        pending_network: storedAirtimeNetwork,
        pending_idempotency_key: pendingIdempotencyKey
      }).eq("id", conversationId)
        .eq("user_id", userId)
        .eq("channel", channel);

      const networkNames:any = {
        mtn: "MTN",
        airtel: "Airtel",
        glo: "Glo",
        "9mobile": "9mobile (T2)"
      };
      const networkName = networkNames[storedAirtimeNetwork] || storedAirtimeNetwork;
      const answer = `You want to buy ${networkName} airtime worth ₦${storedAirtimeAmount.toLocaleString("en-NG")} for ${phoneNumber}. Please confirm to proceed with your purchase.`;

      await persistAssistantMessage(answer, "airtime_purchase", "backend");
      return new Response(JSON.stringify({
        success: true,
        intent: "airtime_purchase",
        service_type: "airtime",
        network: storedAirtimeNetwork,
        amount: storedAirtimeAmount,
        phone_number: phoneNumber,
        answer,
        ai_powered: false,
        requires_confirmation: true,
        airtime: {
          network: storedAirtimeNetwork,
          amount: storedAirtimeAmount,
          phone_number: phoneNumber
        }
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    // GEMINI AI FALLBACK
    // Natural English, Hausa, and mixed-language understanding.
    // Gemini never performs money-moving actions.
    // ==========================================


    if (aiConfig?.gemini_enabled === false) {
      const disabledAnswer = aiConfig.fallback_message || "I can help with Bindawasub services, wallet balance, funding, and purchases.";
      await persistAssistantMessage(disabledAnswer, "other", "gemini_disabled");
      await logAiActivity(
        "ai_disabled_response",
        "other",
        originalMessage,
        disabledAnswer,
        true,
        null,
        null,
        { ai_powered: false, gemini_disabled: true }
      );
      return new Response(JSON.stringify({
        success: true,
        intent: "other",
        answer: disabledAnswer,
        ai_powered: false,
        gemini_disabled: true
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.action !== "fund_wallet") {
    try {
      const { data: aiProducts, error: aiProductsError } =
        await supabase
          .from("products")
          .select(
            "id, sku, service_type, product_name, volume, validity_value, validity_unit, validity_type, selling_price, display_order, metadata, network_id, variant_id, service_networks(code,name), service_variants(code,name)"
          )
          .eq("active", true)
          .order("selling_price", { ascending: true });

      if (aiProductsError) throw aiProductsError;

      const activeProducts = aiProducts || [];
      const aiDataProducts = activeProducts.filter((product:any) => String(product.service_type || "").toLowerCase() === "data");
      const activeServiceTypes = new Set(activeProducts.map((product:any) => String(product.service_type || "").trim().toLowerCase()).filter(Boolean));

      // Data catalog filtering is deterministic. The AI must never receive
      // plans from another network or another data type once those choices
      // have been resolved in the current conversation.
      const normalizeCatalogToken = (value:any) =>
        String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

      const messageForCatalog = String(originalMessage || "");
      const contextNetwork = normalizeCatalogToken(conversationContext?.network);
      const contextVariant = normalizeCatalogToken(conversationContext?.variant);

      const explicitNetwork =
        /\bmtn\b/i.test(messageForCatalog) ? "mtn" :
        /\bairtel\b/i.test(messageForCatalog) ? "airtel" :
        /\bglo\b/i.test(messageForCatalog) ? "glo" :
        /\b(?:9mobile|t2)\b/i.test(messageForCatalog) ? "9mobile" :
        "";

      const requestedNetworkToken = explicitNetwork || contextNetwork;

      const explicitVariant =
        /\b(?:sme|sme data|normal data)\b/i.test(messageForCatalog) ? "smedata" :
        /\b(?:social|social data)\b/i.test(messageForCatalog) ? "social" :
        /\b(?:gifting|gift|gift data)\b/i.test(messageForCatalog) ? "gifting" :
        /\b(?:awoop)\b/i.test(messageForCatalog) ? "awoop" :
        "";

      // Selecting a network explicitly resets any older Data Type context so
      // the customer sees the complete catalog for that network.
      const requestedVariantText = explicitVariant || (explicitNetwork ? "" : contextVariant);

      const networkFilteredProducts = aiDataProducts.filter((product:any) => {
        if (!requestedNetworkToken) return true;
        const network = Array.isArray(product.service_networks)
          ? product.service_networks[0]
          : product.service_networks;
        return normalizeCatalogToken(network?.code) === requestedNetworkToken ||
          normalizeCatalogToken(network?.name) === requestedNetworkToken;
      });

      const variantFilteredProducts = networkFilteredProducts.filter((product:any) => {
        if (!requestedVariantText) return true;
        const variant = Array.isArray(product.service_variants)
          ? product.service_variants[0]
          : product.service_variants;
        return normalizeCatalogToken(variant?.code) === requestedVariantText ||
          normalizeCatalogToken(variant?.name) === requestedVariantText;
      });

      const catalogProductsForAI = requestedVariantText
        ? variantFilteredProducts
        : networkFilteredProducts;

      const aiProductsForAI = catalogProductsForAI.map(formatCatalogProduct);

      const availableDataTypes = Array.from(
        new Map(
          networkFilteredProducts.map((product:any) => {
            const variant = Array.isArray(product.service_variants)
              ? product.service_variants[0]
              : product.service_variants;
            return [
              normalizeCatalogToken(variant?.code || variant?.name),
              {
                code: variant?.code || null,
                name: variant?.name || variant?.code || "Data",
                plan_count: 1
              }
            ];
          })
        ).values()
      ).map((item:any) => ({
        ...item,
        plan_count: networkFilteredProducts.filter((product:any) => {
          const variant = Array.isArray(product.service_variants)
            ? product.service_variants[0]
            : product.service_variants;
          return normalizeCatalogToken(variant?.code || variant?.name) ===
            normalizeCatalogToken(item.code || item.name);
        }).length
      }));

      const { data: recentTransactionRows, error: recentTransactionError } = await supabase
        .from("transactions")
        .select("id, created_at, phone_number, amount, status, service_type, description, products(product_name, service_type, volume, validity_type, validity_value, validity_unit, service_networks(code,name), service_variants(code,name))")
        .eq("user_id", userId)
        .order("created_at", { ascending:false })
        .limit(12);

      if (recentTransactionError) console.error("Recent transaction context lookup error:", recentTransactionError);

      const recentTransactionsForAI = (recentTransactionRows || []).map(formatTransactionForAI);

      const ai = await classifyIntent(
        originalMessage,
        activeProducts.map(formatCatalogProduct),
        serviceCatalog,
        conversationHistory,
        String(aiConfig?.default_language || "english").toLowerCase() === "hausa" ? "hausa" : "english",
        conversationContext,
        recentTransactionsForAI
      );

      // If a requested data network or data type has no active plans, say so explicitly.
      const dataAvailabilityIntent = new Set(["product_enquiry","product_price","purchase_intent"]);
      if (dataAvailabilityIntent.has(String(ai.intent || "").toLowerCase()) &&
          (String(ai.service_type || "").toLowerCase() === "data" || requestedNetworkToken || requestedVariantText) &&
          requestedNetworkToken && networkFilteredProducts.length === 0) {
        const networkLabel = requestedNetworkToken === "9mobile" ? "9mobile" : requestedNetworkToken.toUpperCase();
        const unavailableAnswer = ai.language === "hausa"
          ? "A halin yanzu babu active data plans na " + networkLabel + ". Zan sanar da kai idan sun samu."
          : "There are currently no active data plans for " + networkLabel + ". I will let you know when they become available.";
        return new Response(JSON.stringify({ success:true, intent:ai.intent, service_type:"data", network:requestedNetworkToken, products:[], available:false, answer:unavailableAnswer, ai_powered:true }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      if (dataAvailabilityIntent.has(String(ai.intent || "").toLowerCase()) && requestedNetworkToken && requestedVariantText && variantFilteredProducts.length === 0) {
        const networkLabel = requestedNetworkToken === "9mobile" ? "9mobile" : requestedNetworkToken.toUpperCase();
        const unavailableAnswer = ai.language === "hausa"
          ? requestedVariantText + " ba ya samuwa a halin yanzu a " + networkLabel + ". Zan sanar da kai idan ya samu."
          : requestedVariantText + " is currently not available on " + networkLabel + ". I will let you know when it becomes available.";
        return new Response(JSON.stringify({ success:true, intent:ai.intent, service_type:"data", network:requestedNetworkToken, variant:requestedVariantText, products:[], available:false, answer:unavailableAnswer, ai_powered:true }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }
      // Never let the AI imply that an inactive/unconfigured service is available.
      const requestedServiceType = String(ai.service_type || "").trim().toLowerCase();
      const availabilityCheckedIntents = new Set(["product_enquiry","product_price","purchase_intent","service_enquiry"]);
      if (requestedServiceType && availabilityCheckedIntents.has(String(ai.intent || "").toLowerCase()) && requestedServiceType !== "airtime" && !activeServiceTypes.has(requestedServiceType)) {
        const serviceLabel = requestedServiceType.replace(/[_-]+/g, " ").replace(/\b\w/g, (m:string) => m.toUpperCase());
        const unavailableAnswer = ai.language === "hausa"
          ? serviceLabel + " ba ya samuwa a halin yanzu. Zan sanar da kai idan ya dawo."
          : serviceLabel + " is currently not available. I will let you know when it becomes available.";
        return new Response(JSON.stringify({ success:true, intent:ai.intent, service_type:requestedServiceType, products:[], available:false, answer:unavailableAnswer, ai_powered:true }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      // Deterministic routing for Airtime. Once an Airtime task has started,
      // keep numeric/phone follow-ups in the Airtime flow instead of Data.
      const activeAirtimeContext = String(conversationContext?.service_type || "").toLowerCase() === "airtime";
      const explicitAirtimeRequest = /\bairtime\b|\btalktime\b/i.test(String(originalMessage || ""));
      if (activeAirtimeContext && !/\\bdata\\b/i.test(String(originalMessage || ""))) {
        ai.intent = "airtime_purchase";
        ai.service_type = "airtime";
        ai.network = ai.network || conversationContext?.network || null;
        ai.product_id = null;
        ai.product_name = null;
        ai.volume = null;

        const numericAmount = String(originalMessage || "").trim().match(/^(?:₦\s*|NGN\s*)?([0-9][0-9,]*(?:\.\d+)?)$/i);
        if (numericAmount) {
          const parsedAmount = Number(numericAmount[1].replace(/,/g, ""));
          if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
            ai.amount = parsedAmount;
          }
        }
      } else if (explicitAirtimeRequest) {
        const airtimeNetworkMatch = String(originalMessage || "").match(/\\b(mtn|airtel|glo|9mobile|9mobile\\s*\\(\\s*t2\\s*\\)|t2)\\b/i);
        if (airtimeNetworkMatch) {
          const rawNetwork = airtimeNetworkMatch[1].toLowerCase().replace(/\\s+/g, "");
          ai.network = rawNetwork === "t2" || rawNetwork.startsWith("9mobile") ? "9mobile" : rawNetwork;
        }
        ai.intent = "airtime_purchase";
        ai.service_type = "airtime";
        ai.product_id = null;
        ai.product_name = null;
        ai.volume = null;
      } else {
        ai.intent = String(ai.intent || "unknown").trim().toLowerCase();

        // Deterministic routing for an explicitly selected bill/service.
        // The Bills selector sends the live service code in parentheses, so
        // adding a new active bill service automatically gets its own route.
        const explicitBillMatch = String(originalMessage || "").match(
          /(?:pay for|pay|buy)\\s+(.+?)\\s*\\(([^)]+)\\)/i
        );
        if (explicitBillMatch) {
          const requestedServiceCode = String(explicitBillMatch[2] || "").trim().toLowerCase();
          const selectedService = serviceCatalog.find((service:any) =>
            String(service.code || "").trim().toLowerCase() === requestedServiceCode &&
            String(service.category || "").trim().toLowerCase() !== "telecom"
          );

          if (selectedService) {
            ai.intent = "service_enquiry";
            ai.service_type = selectedService.code;
            ai.product_id = null;
            ai.product_name = null;
            ai.volume = null;
            ai.customer_input = {};

            const requiredFields = (selectedService.fields || [])
              .filter((field:any) => field.required)
              .map((field:any) => field.label || field.key);

            ai.reply = requiredFields.length
              ? "You selected " + selectedService.name + ". Please provide: " + requiredFields.join(", ") + "."
              : "You selected " + selectedService.name + ". Tell me the details you want to pay for.";
          }
        }
      }
      ai.language = String(ai.language || "english").trim().toLowerCase();
      if (!["english", "hausa"].includes(ai.language)) ai.language = "english";
      if (conversationId) {
        await supabase
          .from("ai_conversations")
          .update({ language: ai.language, last_message_at: new Date().toISOString() })
          .eq("id", conversationId)
        .eq("user_id", userId)
        .eq("channel", channel);
      }
      if (conversationId) {
        const nextContext = {
          ...(conversationContext || {}),
          last_intent: ai.intent,
          language: ai.language,
          service_type: ai.service_type || conversationContext?.service_type || null,
          network: ai.network || conversationContext?.network || null,
          volume: ai.volume || conversationContext?.volume || null,
          phone_number: ai.phone_number || conversationContext?.phone_number || null,
          product_id: ai.product_id || conversationContext?.product_id || null,
          transaction_id: ai.transaction_id || conversationContext?.transaction_id || null,
          last_transaction_id: ai.transaction_id || conversationContext?.last_transaction_id || null,
          last_user_message: String(originalMessage || "").slice(0, 1000),
          updated_at: new Date().toISOString()
        };

        conversationContext = nextContext;

        await supabase
          .from("ai_conversations")
          .update({
            language: ai.language,
            conversation_context: nextContext,
            last_message_at: new Date().toISOString()
          })
          .eq("id", conversationId)
        .eq("user_id", userId)
        .eq("channel", channel);
      }

      const supportedIntents = new Set([
        "greeting","help","product_enquiry","product_price","service_enquiry",
        "network_enquiry","purchase_intent","airtime_purchase","wallet_balance",
        "fund_wallet","funding_history","transaction_history","last_transaction",
        "transaction_status","registration","account_help","unknown","other"
      ]);
      if (!supportedIntents.has(ai.intent)) ai.intent = "unknown";

      await logAiMessage(
        "assistant",
        String(ai.reply || ""),
        String(ai.intent || "other"),
        "gemini"
      );
      await logAiActivity(
        "ai_response",
        String(ai.intent || "other"),
        originalMessage,
        String(ai.reply || ""),
        true,
        null,
        null,
        { ai_powered: true }
      );

      if (ai.intent === "product_price") {
        const matchedProduct = resolveCatalogProduct(ai, aiProducts || []);
        if (matchedProduct) {
          const price = Number(matchedProduct.selling_price || 0);
          return new Response(JSON.stringify({
            success:true,
            intent:"product_price",
            product:formatCatalogProduct(matchedProduct),
            answer:ai.reply || `${matchedProduct.product_name} is ₦${price.toLocaleString("en-NG")}.`,
            ai_powered:true
          }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
        }
        return new Response(JSON.stringify({
          success:true,
          intent:"product_price",
          products:(aiProducts || []).map(formatCatalogProduct),
          answer:ai.reply || "Tell me the network and package you want the price for.",
          ai_powered:true
        }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      if (ai.intent === "product_enquiry") {
        const networkLabel = requestedNetworkToken
          ? (requestedNetworkToken === "9mobile" ? "9mobile" : requestedNetworkToken.toUpperCase())
          : null;

        // Once a network is selected, show ALL active plans on that network.
        // The customer UI groups these plans under their Data Type headings.
        if (requestedNetworkToken) {
          const networkPlans = networkFilteredProducts.map(formatCatalogProduct);

          return new Response(
            JSON.stringify({
              success: true,
              intent: "product_enquiry",
              network: requestedNetworkToken,
              network_name: networkLabel,
              data_types: availableDataTypes,
              products: networkPlans,
              answer: networkPlans.length
                ? `Here are the available ${networkLabel} data plans, grouped by Data Type.`
                : `There are currently no active data plans for ${networkLabel}.`,
              ai_powered: true,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            intent: "product_enquiry",
            network: requestedNetworkToken || null,
            variant: requestedVariantText || null,
            products: (aiProductsForAI || []).map(formatCatalogProduct),
            answer: ai.reply || "Here are the available plans.",
            ai_powered: true,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (ai.intent === "purchase_intent") {
        // Resolve purchases only against the already network/data-type-filtered catalog.
        const purchaseCatalog = requestedVariantText
          ? variantFilteredProducts
          : networkFilteredProducts;

        // Product specification is resolved from the live catalog, never from Gemini's
        // product identity alone. An exact product ID is accepted only if it belongs to
        // the already-filtered catalog.
        const specificationCandidates = filterCatalogBySpecification(ai, purchaseCatalog);
        const matchedById = String(ai?.product_id||"").trim()
          ? specificationCandidates.find((p:any)=>p.id===String(ai.product_id).trim())
          : null;
        const matchedProduct = matchedById || (
          specificationCandidates.length === 1
            ? specificationCandidates[0]
            : null
        );

        const serviceType = String(ai.service_type || matchedProduct?.service_type || "").trim().toLowerCase();
        const catalogService = serviceCatalog.find((s:any) => s.code === serviceType);
        const customerInput = {
          ...(ai.customer_input && typeof ai.customer_input === "object" ? ai.customer_input : {})
        };

        if (ai.phone_number && !customerInput.phone) customerInput.phone = ai.phone_number;
        if (ai.network && !customerInput.network) customerInput.network = ai.network;
        if (ai.amount && Number(ai.amount) > 0 && !customerInput.amount) customerInput.amount = Number(ai.amount);

        const requiredFields = (catalogService?.fields || [])
          .filter((field:any) => field.required)
          .map((field:any) => field.key);
        const missingFields = requiredFields.filter((key:string) =>
          customerInput[key] === undefined ||
          customerInput[key] === null ||
          String(customerInput[key]).trim() === ""
        );

        if (!matchedProduct) {
          if (specificationCandidates.length > 1) {
            const choices = specificationCandidates.slice(0, 12).map(productSpecification);
            return new Response(JSON.stringify({
              success:true,
              intent:"purchase_intent",
              service_type:serviceType || null,
              product:null,
              products:choices,
              customer_input:customerInput,
              missing_fields:missingFields,
              answer:ai.reply || "I found more than one matching product. Please choose the network, data type, amount, or validity you want.",
              requires_confirmation:false,
              ai_powered:true
            }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
          }

          return new Response(JSON.stringify({
            success:true,
            intent:"purchase_intent",
            service_type:serviceType || null,
            product:null,
            products:[],
            customer_input:customerInput,
            missing_fields:missingFields,
            answer:ai.reply || "That product is not currently available. Please choose an available product from the catalog.",
            requires_confirmation:false,
            ai_powered:true
          }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
        }

        const price=Number(matchedProduct.selling_price||0);
        if (missingFields.length>0) {
          return new Response(JSON.stringify({
            success:true,
            intent:"purchase_intent",
            service_type:serviceType,
            product:matchedProduct,
            customer_input:customerInput,
            missing_fields:missingFields,
            answer:ai.reply || `I found ${matchedProduct.product_name} for ₦${price.toLocaleString("en-NG")}. Please provide: ${missingFields.join(", ")}.`,
            requires_confirmation:false,
            ai_powered:true
          }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
        }

        if (conversationId) {
          conversationContext = {
            ...(conversationContext || {}),
            last_intent: "purchase_intent",
            service_type: serviceType || matchedProduct.service_type || null,
            product_id: matchedProduct.id,
            phone_number: ai.phone_number || customerInput.phone || conversationContext?.phone_number || null,
            network: ai.network || customerInput.network || conversationContext?.network || null,
            volume: ai.volume || matchedProduct.volume || conversationContext?.volume || null,
            language: ai.language || conversationContext?.language || "english",
            updated_at: new Date().toISOString()
          };

          const newPendingIdempotencyKey=`AI-${conversationId}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
          await supabase.from("ai_conversations").update({
            pending_product_id:matchedProduct.id,
            pending_phone_number:ai.phone_number || customerInput.phone || null,
            pending_at:new Date().toISOString(),
            last_message_at:new Date().toISOString(),
            pending_service_type:serviceType || matchedProduct.service_type || null,
            pending_airtime_amount:null,
            pending_network:ai.network || customerInput.network || null,
            pending_idempotency_key:newPendingIdempotencyKey,
            pending_customer_input:customerInput,
            conversation_context:conversationContext,
            language:ai.language || conversationContext.language || "english"
          }).eq("id",conversationId);
        }

        return new Response(JSON.stringify({
          success:true,
          intent:"purchase_intent",
          service_type:serviceType,
          product:matchedProduct,
          customer_input:customerInput,
          phone_number:ai.phone_number || customerInput.phone || null,
          network:ai.network || customerInput.network || null,
          volume:ai.volume || null,
          answer:ai.reply || `You selected ${matchedProduct.product_name} for ₦${price.toLocaleString("en-NG")}. Please confirm before purchase.`,
          requires_confirmation:true,
          ai_powered:true
        }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      if (ai.intent === "airtime_purchase") {
        const network = String(ai.network || "").trim().toUpperCase();
        const amount = Number(ai.amount);
        const phoneNumber = ai.phone_number;

        const { data: airtimeService } = await supabase
          .from("service_definitions")
          .select("id")
          .eq("code", "airtime")
          .eq("active", true)
          .maybeSingle();
        const { data: airtimeNetworks } = airtimeService
          ? await supabase.from("service_networks").select("code,name").eq("service_id", airtimeService.id).eq("active", true)
          : { data: [] };
        const networkConfigured = (airtimeNetworks || []).some((n:any) =>
          String(n.code || "").trim().toUpperCase() === network ||
          String(n.name || "").trim().toUpperCase() === network
        );

        if (!networkConfigured || !Number.isFinite(amount) || amount <= 0 || !phoneNumber) {
          return new Response(JSON.stringify({
            success: true,
            intent: "airtime_purchase",
            answer: "Sure. Please provide the network, airtime amount, and recipient phone number.",
            ai_powered: true
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (conversationId) {
          const newPendingIdempotencyKey = `AI-${conversationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await supabase.from("ai_conversations").update({
            pending_product_id: null,
            pending_phone_number: phoneNumber,
            pending_at: new Date().toISOString(),
            pending_service_type: "airtime",
            pending_airtime_amount: amount,
            pending_network: network,
            pending_idempotency_key: newPendingIdempotencyKey,
          }).eq("id", conversationId)
          .eq("user_id", userId)
          .eq("channel", channel);
        }

        return new Response(JSON.stringify({
          success: true,
          intent: "airtime_purchase",
          answer: `You want to buy ${network} airtime worth ₦${amount.toLocaleString("en-NG")} for ${phoneNumber}. Please confirm to proceed with your purchase.`,
          ai_powered: true,
          requires_confirmation: true,
          airtime: { network, amount, phone_number: phoneNumber }
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (ai.intent === "wallet_balance") {
        const wallet = await getWalletBalance(supabase, userId);
        return new Response(JSON.stringify({
          success: true,
          intent: "wallet_balance",
          balance: wallet.balance,
          currency: wallet.currency,
          answer: `Your wallet balance is ₦${wallet.balance.toLocaleString()}.`,
          ai_powered: true,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (
        ai.intent === "transaction_history" ||
        ai.intent === "last_transaction" ||
        ai.intent === "transaction_status"
      ) {
        const accountAction = ai.intent;

        const recentTransactions = await getCustomerTransactions(supabase, userId, ai.transaction_id || null, accountAction);
        const rows = recentTransactions || [];

        const maskPhone = (phone: string | null) => {
          if (!phone) return "—";
          const digits = phone.replace(/\\D/g, "");
          if (digits.length < 7) return phone;
          return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
        };

        const normalizeProduct = (product: any) =>
          Array.isArray(product) ? product[0] : product;

        const formatted = rows.map((tx: any) => {
          const product = normalizeProduct(tx.products);
          const networkInfo = Array.isArray(product?.service_networks) ? product.service_networks[0] : product?.service_networks;
          const duration = product?.validity_type === "fixed" && product?.validity_value != null && product?.validity_unit
            ? String(product.validity_value) + " " + String(product.validity_unit)
            : (product?.validity_type === "unlimited" ? "Unlimited" : "");
          return {
            id: tx.id,
            date: tx.created_at,
            product_name: product?.product_name || "Purchase",
            network: networkInfo?.code || null,
            network_name: networkInfo?.name || null,
            volume: product?.volume || null,
            duration,
            phone_number: maskPhone(tx.phone_number),
            amount: Number(tx.amount || 0),
            status: tx.status,
            provider: tx.provider,
            provider_reference: tx.provider_reference || null,
          };
        });

        if (formatted.length === 0) {
          return new Response(
            JSON.stringify({
              success: true,
              intent: accountAction,
              transactions: accountAction === "transaction_history" ? [] : undefined,
              transaction: accountAction === "transaction_history" ? undefined : null,
              answer: "You do not have any purchases yet.",
              ai_powered: true,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        if (accountAction === "transaction_history") {
          return new Response(
            JSON.stringify({
              success: true,
              intent: "transaction_history",
              transactions: formatted,
              answer: `Here are your latest ${formatted.length} purchase${formatted.length === 1 ? "" : "s"}.`,
              ai_powered: true,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        let latest = formatted[0];

        // A status request on a pending transaction should perform one safe
        // provider requery before reporting the state. Requery never creates
        // a new purchase and provider-execution is responsible for exactly-once
        // finalization/refund behavior.
        if (accountAction === "transaction_status" && latest.status === "pending" && latest.id) {
          try {
            const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            const supabaseUrl = Deno.env.get("SUPABASE_URL");
            if (serviceRoleKey && supabaseUrl) {
              const requeryResponse = await fetch(
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
                    transaction_id: latest.id,
                  }),
                }
              );

              if (requeryResponse.ok) {
                const requeryRaw = await requeryResponse.text();
                let requeryResult: any = null;
                try { requeryResult = JSON.parse(requeryRaw); } catch {}

                const refreshed = await getCustomerTransactions(
                  supabase,
                  userId,
                  latest.id,
                  "transaction_status"
                );
                if (refreshed?.length) {
                  const refreshedTx = refreshed[0];
                  const refreshedProduct = normalizeProduct(refreshedTx.products);
                  const refreshedNetwork = Array.isArray(refreshedProduct?.service_networks)
                    ? refreshedProduct.service_networks[0]
                    : refreshedProduct?.service_networks;
                  latest = {
                    ...latest,
                    status: refreshedTx.status,
                    provider: refreshedTx.provider,
                    provider_reference: refreshedTx.provider_reference || latest.provider_reference,
                    product_name: refreshedProduct?.product_name || latest.product_name,
                    network: refreshedNetwork?.code || latest.network,
                    network_name: refreshedNetwork?.name || latest.network_name,
                    volume: refreshedProduct?.volume || latest.volume,
                  };
                } else if (requeryResult?.status) {
                  latest = { ...latest, status: requeryResult.status };
                }
              }
            }
          } catch (requeryError) {
            console.error("Customer transaction status requery error:", requeryError);
            // Do not turn a provider requery error into a false failure.
            // The transaction remains pending and the normal status response
            // below tells the customer the current known state.
          }
        }

        if (conversationId) {
          const txContext = {
            ...(conversationContext || {}),
            last_transaction_id: latest.id,
            last_transaction_status: latest.status,
            last_transaction_product: latest.product_name,
            last_transaction_amount: latest.amount,
            last_transaction_network: latest.network,
            updated_at: new Date().toISOString()
          };
          conversationContext = txContext;
          await supabase.from("ai_conversations")
            .update({ conversation_context: txContext, last_message_at: new Date().toISOString() })
            .eq("id", conversationId)
        .eq("user_id", userId)
        .eq("channel", channel);
        }

        let answer =
          `Your latest purchase is ${latest.product_name} for ₦${latest.amount.toLocaleString()} to ${latest.phone_number}. Status: ${latest.status}.`;

        if (accountAction === "transaction_status") {
          if (latest.status === "successful") {
            answer = `Yes. Your latest purchase, ${latest.product_name}, was successful.`;
          } else if (latest.status === "failed") {
            answer = `Your latest purchase, ${latest.product_name}, failed.`;
          } else {
            answer = `Your latest purchase, ${latest.product_name}, is currently ${latest.status}.`;
          }
        }

        await persistAssistantMessage(answer, accountAction, "backend");
        return new Response(
          JSON.stringify({
            success: true,
            intent: accountAction,
            transaction: latest,
            answer,
            ai_powered: true,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (ai.intent === "fund_wallet") {
        const { data: currentWallet, error: currentWalletError } = await supabase
          .from("wallets")
          .select("balance, currency")
          .eq("user_id", userId)
          .maybeSingle();

        if (currentWalletError) throw currentWalletError;

        const currentBalance = Number(currentWallet?.balance ?? 0);
        const currentCurrency = currentWallet?.currency || "NGN";

        const amountMatch = String(originalMessage || "").match(/(?:₦|ngn|naira|fund(?:\s+my)?(?:\s+wallet)?\s*(?:with|by|of)?\s*)([0-9,]+(?:\.\d+)?)/i);
        const parsedAmount = amountMatch ? Number(String(amountMatch[1]).replace(/,/g, "")) : 0;

        if (parsedAmount > 0) {
          const funding = await createManualFundingRequest(supabase, userId, parsedAmount);

          if (!funding.success) {
            return new Response(JSON.stringify({
              success:false,
              intent:"fund_wallet",
              error:funding.error
            }), { status:400, headers:{...corsHeaders,"Content-Type":"application/json"} });
          }

          return new Response(JSON.stringify({
            success:true,
            intent:"fund_wallet",
            funding_mode:"manual",
            requires_payment:true,
            request:funding.request,
            bank_account:funding.bank_account,
            instructions:funding.instructions,
            answer:funding.bank_account
              ? `Funding request created for ₦${parsedAmount.toLocaleString("en-NG")}. Your current wallet balance is ${currentCurrency === "NGN" ? "₦" : currentCurrency + " "}${currentBalance.toLocaleString("en-NG")}. If approved, your balance will become ${currentCurrency === "NGN" ? "₦" : currentCurrency + " "}${(currentBalance + parsedAmount).toLocaleString("en-NG")}. Transfer the exact amount to the account shown, then send your transfer reference.`
              : `Funding request ${funding.request.reference} created for ₦${parsedAmount.toLocaleString("en-NG")}. Your current wallet balance is ${currentCurrency === "NGN" ? "₦" : currentCurrency + " "}${currentBalance.toLocaleString("en-NG")}. Bank transfer details are not configured yet.`,
            ai_powered:true
          }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
        }

        return new Response(JSON.stringify({
          success:true,
          intent:"fund_wallet",
          funding_mode:"manual",
          requires_amount:true,
          answer:`Sure. Your current wallet balance is ${currentCurrency === "NGN" ? "₦" : currentCurrency + " "}${currentBalance.toLocaleString("en-NG")}. How much would you like to add to your wallet? For example: Fund my wallet with ₦5,000.`,
          ai_powered:true
        }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      return new Response(
        JSON.stringify({
          success: true,
          intent: ai.intent || "other",
          answer:
            ai.reply ||
            "I can help with Bindawasub services, wallet balance, funding, and purchases.",
          ai_powered: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (aiError) {
      console.error("Gemini fallback error:", aiError);

      const fallbackAnswer =
        "I can help you check available services, prices, wallet balance, and make purchases.";

      await persistAssistantMessage(fallbackAnswer, "unknown", "fallback");
      await logAiActivity(
        "ai_fallback_response",
        "unknown",
        originalMessage,
        fallbackAnswer,
        false,
        aiError instanceof Error ? aiError.message : String(aiError),
        null,
        { ai_powered: false }
      );

      return new Response(
        JSON.stringify({
          success: true,
          intent: "unknown",
          answer: fallbackAnswer,
          ai_powered: false,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    } else {
      // BillStack fund_wallet handler below.
    }

  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong"
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});