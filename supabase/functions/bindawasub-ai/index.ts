import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { formatCatalogProduct } from "./catalog/format.ts";
import { normalizeCatalogToken } from "./catalog/list.ts";
import { handleProductEnquiry } from "./catalog/handler.ts";
import { handleDeterministicDataPriceQuery } from "./catalog/price.ts";
import { formatTransactionForAI } from "./transactions/format.ts";
import { executeViaProviderExecution } from "./purchase/execution.ts";
import { buildPurchaseConfirmation } from "./purchase/confirmation-format.ts";
import { loadCustomerTransaction } from "./transactions/lookup.ts";
import { routeExplicitAction } from "./router/action-router.ts";
import { recoverFundingAmountFromConversation } from "./funding/context.ts";
import { handleAirtimePurchase, handleDataPurchase } from "./purchase/handler.ts";
import { classifyIntent } from "./ai/intent.ts";
import { loadAiConfig, isChannelAllowed } from "./ai/config.ts";
import { jsonResponse } from "./ai/response.ts";
import { routeAiIntent } from "./ai/intent-router.ts";
import { isInternalTelegramRequest as isInternalTelegramRequestCheck, resolveRequestChannel } from "./telegram/handler.ts";
import { authenticateRequest } from "./auth/authenticate.ts";
import { loadOrCreateConversation, touchConversation, logAiMessage, persistAssistantMessage, logAiActivity } from "./conversation/state.ts";


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

    const originalMessage = body.message || "";
    const message = originalMessage.toLowerCase();

    // Initialize conversation state before quick actions, because quick actions
    // can persist messages and update the selected conversation immediately.
    let conversationId: string | null = String(body.conversation_id || "").trim() || null;
    let conversationContext: any = {};
    let existingConversation: any = null;

    // ==========================================
    // CONVERSATION + PENDING PURCHASE STATE
    // ==========================================

    const channel = resolveRequestChannel(
      isInternalTelegramRequest,
      body.channel
    );


    const earlyAction = await routeExplicitAction(
      {
        supabase,
        userId,
        isAdmin,
        corsHeaders,
        bindawasubUser,
        originalMessage,
        conversationId,
        channel,
        persistAssistantMessage,
      },
      body,
      "early",
    );
    if (earlyAction) return earlyAction;

    // Load live AI controls before processing customer requests.
    const aiConfig = await loadAiConfig(supabase);


    if (aiConfig && aiConfig.enabled === false) {
      return new Response(JSON.stringify({
        success: true,
        intent: "other",
        answer: aiConfig.fallback_message || "Bindawasub AI is temporarily unavailable.",
        ai_powered: false,
        disabled: true
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!isChannelAllowed(aiConfig, channel)) {
      return jsonResponse(
        { success: false, error: "This AI channel is currently disabled." },
        corsHeaders,
        403,
      );
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

    // Recover a numeric funding amount from the previous funding request.
    await recoverFundingAmountFromConversation({
      supabase,
      conversationId,
      originalMessage,
      body,
    });



    // Explicit actions that depend on conversation/AI state.
    const routedAction = await routeExplicitAction(
      {
        supabase,
        userId,
        isAdmin,
        corsHeaders,
        bindawasubUser,
        originalMessage,
        conversationId,
        channel,
        persistAssistantMessage,
      },
      body,
      "normal",
    );
    if (routedAction) return routedAction;

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

      const pendingIsProductPurchase=!!pendingConversation?.pending_product_id && !!pendingConversation?.pending_phone_number;

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
        await persistAssistantMessage(supabase, conversationId, pendingIsFresh ? "Okay, I cancelled the pending purchase. No money was deducted." : "There is no active purchase waiting for confirmation.", "purchase_cancelled", "backend");
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
        await clearPending();
        await persistAssistantMessage(supabase, conversationId, "That purchase confirmation has expired. Please start the purchase again.", "purchase_confirmation_expired", "backend");
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
          loadCustomerTransaction: (transactionId: string) => loadCustomerTransaction(supabase, userId, transactionId),
          buildPurchaseConfirmation,
          persistAssistantMessage: (answer: any, intent: string | null, toolCalled: string | null = null) =>
            persistAssistantMessage(supabase, conversationId, answer, intent, toolCalled),
          logAiActivity: (...args: any[]) =>
            (logAiActivity as any)(supabase, userId, conversationId, channel, ...args),
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
          loadCustomerTransaction: (transactionId: string) => loadCustomerTransaction(supabase, userId, transactionId),
          buildPurchaseConfirmation,
          persistAssistantMessage: (answer: any, intent: string | null, toolCalled: string | null = null) =>
            persistAssistantMessage(supabase, conversationId, answer, intent, toolCalled),
          logAiActivity: (...args: any[]) =>
            (logAiActivity as any)(supabase, userId, conversationId, channel, ...args),
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

    const productEnquiry = await handleProductEnquiry({
      supabase,
      originalMessage,
      message,
      conversationContext,
      corsHeaders,
      shouldUseGeminiFirst,
    });
    if (productEnquiry) return productEnquiry;

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

    // Deterministic account actions are routed through the action router above.

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
        await persistAssistantMessage(supabase, conversationId, answer, "airtime_purchase", "backend");
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

      await persistAssistantMessage(supabase, conversationId, answer, "airtime_purchase", "backend");
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
      await persistAssistantMessage(supabase, conversationId, disabledAnswer, "other", "gemini_disabled");
      await logAiActivity(supabase, userId, conversationId, channel,
          
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

      // Exact data-price requests are resolved from the live catalog before Gemini.
      // This prevents AI wording from inventing or selecting the wrong price.
      const deterministicPrice = handleDeterministicDataPriceQuery(
        originalMessage,
        activeProducts,
      );
      if (deterministicPrice) {
        await persistAssistantMessage(
          supabase,
          conversationId,
          deterministicPrice.answer,
          "product_price",
          "backend",
        );
        return new Response(JSON.stringify({
          success: true,
          intent: "product_price",
          service_type: "data",
          product: deterministicPrice.product || null,
          products: deterministicPrice.products || undefined,
          answer: deterministicPrice.answer,
          ai_powered: false,
          quick_action: true,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const ai = await classifyIntent({
        userMessage: originalMessage,
        availableProducts: activeProducts.map(formatCatalogProduct),
        serviceCatalog,
        conversationHistory,
        defaultLanguage:
          String(aiConfig?.default_language || "english").toLowerCase() === "hausa"
            ? "hausa"
            : "english",
        conversationContext,
        recentTransactions: recentTransactionsForAI,
      });

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
      const explicitDataPurchase = /\b(?:buy|purchase|get|order|send|activate|subscribe|saya|sayi|siyo|siya|oda|aika|kunna)\b/i.test(String(originalMessage || "")) && /\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb)\b/i.test(String(originalMessage || ""));
      if (explicitDataPurchase) {
        ai.intent = "purchase_intent";
        ai.service_type = "data";
        ai.product_id = null;
        ai.product_name = null;
        ai.amount = undefined;
        ai.volume = ai.volume || (String(originalMessage || "").match(/\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb)\b/i)?.[0] || null);
        const dataNetworkMatch = String(originalMessage || "").match(/\b(mtn|airtel|glo|9mobile|t2)\b/i);
        if (dataNetworkMatch) ai.network = dataNetworkMatch[1].toLowerCase() === "t2" ? "9mobile" : dataNetworkMatch[1].toLowerCase();
        const dataPhoneMatch = String(originalMessage || "").match(/(?:\+234|234|0)\d{10}\b/);
        if (dataPhoneMatch) ai.phone_number = dataPhoneMatch[0];
      } else if (activeAirtimeContext && !/\\bdata\\b/i.test(String(originalMessage || ""))) {
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
        supabase,
        conversationId,
        "assistant",
        String(ai.reply || ""),
        String(ai.intent || "other"),
        "gemini"
      );
      await logAiActivity(supabase, userId, conversationId, channel,
          
        "ai_response",
        String(ai.intent || "other"),
        originalMessage,
        String(ai.reply || ""),
        true,
        null,
        null,
        { ai_powered: true }
      );

      const aiIntentResponse = await routeAiIntent({
        ai,
        aiProducts: aiProducts || [],
        purchaseCatalog: requestedVariantText ? variantFilteredProducts : networkFilteredProducts,
        variantFilteredProducts,
        networkFilteredProducts,
        requestedNetworkToken,
        requestedVariantText,
        availableDataTypes,
        serviceCatalog,
        supabase,
        userId,
        conversationId,
        conversationContext,
        channel,
        originalMessage,
        corsHeaders,
        persistAssistantMessage,
      });
      if (aiIntentResponse) return aiIntentResponse;
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

      await persistAssistantMessage(supabase, conversationId, fallbackAnswer, "unknown", "fallback");
      await logAiActivity(supabase, userId, conversationId, channel,
          
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