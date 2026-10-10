// Phase 3 purchase handlers. These remain inside the same public Edge Function.
// Provider execution remains delegated to provider-execution.

export type PurchaseContext = {
  body: any;
  supabase: any;
  userId: string;
  channel: string;
  conversationId: string | null;
  aiConfig: any;
  originalMessage: string;
  corsHeaders: Record<string,string>;
  executeViaProviderExecution: (transactionId: string) => Promise<any>;
  loadCustomerTransaction: (transactionId: string) => Promise<any>;
  buildPurchaseConfirmation: (tx: any, fallbackPurchase: any, execution: any) => any;
  persistAssistantMessage: (answer: any, intent: string | null, toolCalled?: string | null) => Promise<void>;
  logAiActivity: (...args: any[]) => Promise<void>;
};

function response(ctx: PurchaseContext, payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...ctx.corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleAirtimePurchase(ctx: PurchaseContext): Promise<Response> {
  const { body, supabase, userId, channel, conversationId, aiConfig, originalMessage, corsHeaders, executeViaProviderExecution, loadCustomerTransaction, buildPurchaseConfirmation, persistAssistantMessage, logAiActivity } = ctx;

const network = String(body.network || "").trim().toUpperCase();
      const amount = Number(body.amount);
      const phoneNumber = body.phone_number;
      const reference = body.reference;

      const { data: airtimeService } = await supabase
        .from("service_definitions")
        .select("id")
        .eq("code", "airtime")
        .eq("active", true)
        .maybeSingle();
      const { data: airtimeNetworks } = airtimeService
        ? await supabase.from("service_networks").select("code,name").eq("service_id", airtimeService.id).eq("active", true)
        : { data: [] };
      const configuredNetwork = (airtimeNetworks || []).find((n:any) =>
        String(n.code || "").trim().toUpperCase() === network ||
        String(n.name || "").trim().toUpperCase() === network
      );

      if (!configuredNetwork) {
        return new Response(JSON.stringify({
          success: false,
          error: "The requested airtime network is not currently configured."
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        return new Response(JSON.stringify({
          success: false,
          error: "A valid airtime amount is required."
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const providerNetwork = String(configuredNetwork.code || configuredNetwork.name || network).trim().toLowerCase();

      if (!phoneNumber || !reference) {
        return new Response(JSON.stringify({
          success: false,
          error: "Phone number and transaction reference are required."
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const configuredMax = Number(aiConfig?.max_purchase_amount ?? 10000);
      if (Number.isFinite(configuredMax) && amount > configuredMax) {
        return new Response(JSON.stringify({
          success: false,
          error: "This airtime purchase exceeds the current AI purchase limit of ₦" + configuredMax.toLocaleString("en-NG") + "."
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: airtimePurchaseData, error: airtimePurchaseError } =
        await supabase.rpc("process_ai_airtime_purchase", {
          p_user_id: userId,
          p_network: providerNetwork,
          p_amount: amount,
          p_phone_number: phoneNumber,
          p_reference: reference,
          p_source: channel,
          p_idempotency_key: String(body.idempotency_key || `AI-${conversationId || userId}-${reference}`),
        });

      if (airtimePurchaseError) {
        return new Response(JSON.stringify({
          success: false,
          error: airtimePurchaseError.message
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const airtimePurchaseResult = airtimePurchaseData;
      const airtimePurchase = airtimePurchaseResult?.transaction || airtimePurchaseResult?.[0];

      if (airtimePurchaseResult?.idempotent_replay) {
        return new Response(JSON.stringify({ success:true, intent:"airtime_purchase", answer: airtimePurchase?.status === "successful" ? "This airtime purchase was already completed successfully." : airtimePurchase?.status === "failed" ? "This airtime purchase was already processed and failed; any wallet refund has already been handled." : "This airtime purchase request was already received and is still pending. No second airtime purchase was sent.", purchase:airtimePurchase||null, idempotent_replay:true }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      // process_ai_airtime_purchase returns success at the RPC-result level;
      // the created transaction is nested under "transaction".
      if (!airtimePurchaseResult?.success || !airtimePurchaseResult?.transaction_id) {
        return new Response(JSON.stringify({
          success: false,
          error: airtimePurchaseResult?.message || "Unable to process airtime purchase"
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Provider execution is the single provider purchase engine.
      await supabase.from("transactions")
        .update({ provider_reference: null, processing_at: null })
        .eq("id", airtimePurchase.transaction_id)
        .eq("status", "pending")
        .eq("provider_reference", reference);

      try {
                const execution = await executeViaProviderExecution(airtimePurchase.transaction_id);
        const executionStatus = execution?.status || "pending";
        const finalizedTransaction = await loadCustomerTransaction(airtimePurchase.transaction_id);
        const confirmation = buildPurchaseConfirmation(finalizedTransaction, airtimePurchase, execution);
        const customerAnswer =
          confirmation.status === "successful"
            ? "✅ Airtime purchase successful!\\n\\n" +
              confirmation.description +
              (confirmation.phone_number ? "\\nRecipient: " + confirmation.phone_number : "") +
              "\\nAmount: ₦" + Number(confirmation.amount || 0).toLocaleString("en-NG") +
              "\\nStatus: Successful" +
              (confirmation.reference ? "\\nReference: " + confirmation.reference : "\\nReference: Pending")
            : confirmation.status === "failed"
              ? "❌ The airtime purchase failed. Your wallet has been refunded automatically." +
                (confirmation.reference ? "\\nReference: " + confirmation.reference : "")
              : "⏳ Your airtime purchase is still being processed. No second purchase will be sent while the provider result is being checked." +
                (confirmation.reference ? "\\nReference: " + confirmation.reference : "");

        await persistAssistantMessage(customerAnswer, "airtime_purchase", "backend");
        return new Response(JSON.stringify({
          success: true,
          intent: "airtime_purchase",
          answer: customerAnswer,
          transaction_id: confirmation.transaction_id,
          description: confirmation.description,
          reference: confirmation.reference,
          purchase: {
            ...airtimePurchase,
            ...confirmation,
            status: executionStatus,
          },
          provider_execution: execution,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });      } catch (executionError) {
        await logAiActivity(
          "provider_execution_error",
          "airtime_purchase",
          originalMessage,
          null,
          false,
          executionError instanceof Error ? executionError.message : String(executionError),
          airtimePurchase.transaction_id
        );
        return new Response(JSON.stringify({
          success: true,
          intent: "airtime_purchase",
          answer: "⏳ Your airtime purchase is recorded and remains pending. The provider has not been retried; it can be safely checked through requery.",
          purchase: { ...airtimePurchase, status: "pending" },
          recovery_required: true,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
}

export async function handleDataPurchase(ctx: PurchaseContext): Promise<Response> {
  const { body, supabase, userId, channel, conversationId, aiConfig, originalMessage, executeViaProviderExecution, loadCustomerTransaction, buildPurchaseConfirmation, persistAssistantMessage, logAiActivity } = ctx;

const productId = body.product_id;
      const phoneNumber = body.phone_number;
      const reference = body.reference;
      const idempotencyKey = String(body.idempotency_key || `AI-${conversationId || userId}-${reference}`);

      if (!productId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Product ID is required",
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

      const customerInput =
        body.customer_input && typeof body.customer_input === "object"
          ? body.customer_input
          : (phoneNumber ? { phone: phoneNumber } : {});

      if (!Object.keys(customerInput).length) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Customer information is required",
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
            error: "Transaction reference is required",
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

      // --------------------------------
      // Get product from database
      // --------------------------------

      const { data: product, error: productError } =
        await supabase
          .from("products")
          .select("id,product_name,service_type,volume,selling_price,cost_price,active,network_id,variant_id,validity_type,validity_value,validity_unit,service_networks(code,name),service_variants(code,name),metadata")
          .eq("id", productId)
          .eq("active", true)
          .single();

      if (productError || !product) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Product not found or inactive",
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

      // --------------------------------
      // Enforce the admin-configured purchase limit before debiting the wallet.
      // --------------------------------
      const configuredMax = Number(aiConfig?.max_purchase_amount ?? 10000);
      if (Number.isFinite(configuredMax) && Number(product.selling_price) > configuredMax) {
        return new Response(JSON.stringify({
          success: false,
          error: "This purchase exceeds the current AI purchase limit of ₦" + configuredMax.toLocaleString("en-NG") + "."
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // --------------------------------
      // Debit Bindawasub wallet
      // --------------------------------

      const { data: purchaseData, error: purchaseError } =
        await supabase.rpc(
          "process_service_purchase",
          {
            p_user_id: userId,
            p_product_id: productId,
            p_customer_input: customerInput,
            p_reference: reference,
            p_source: channel,
            p_idempotency_key: idempotencyKey,
          }
        );

      if (purchaseError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: purchaseError.message,
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

      const purchaseResult = purchaseData;
      const purchase = purchaseResult?.transaction || purchaseResult?.[0];

      if (purchaseResult?.idempotent_replay) {
        return new Response(JSON.stringify({ success:true, intent:"purchase", answer: purchase?.status === "successful" ? "This purchase was already completed successfully." : purchase?.status === "failed" ? "This purchase was already processed and failed; any wallet refund has already been handled." : "This purchase request was already received and is still pending. No second purchase was sent.", purchase:purchase||null, idempotent_replay:true }), {status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
      }

      // process_ai_data_purchase returns success at the RPC-result level
      // and the created transaction inside `transaction`.
      // Do not check purchase.success here: that property is not on the transaction row.
      if (!purchaseResult?.success || !purchaseResult?.transaction_id) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              purchaseResult?.message ||
              "Unable to process wallet purchase",
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

      // Provider execution is the single provider purchase engine.
      // The AI-created reference is local; provider-execution creates the stable
      // customer reference from the transaction ID and owns provider/requery logic.
      await supabase.from("transactions")
        .update({ provider_reference: null, processing_at: null })
        .eq("id", purchaseResult.transaction_id)
        .eq("status", "pending")
        .eq("provider_reference", reference);

      try {
                const execution = await executeViaProviderExecution(purchaseResult.transaction_id);
        const executionStatus = execution?.status || "pending";
        const finalizedTransaction = await loadCustomerTransaction(purchaseResult.transaction_id);
        const confirmation = buildPurchaseConfirmation(finalizedTransaction, purchase, execution);
        const customerAnswer =
          confirmation.status === "successful"
            ? "✅ Purchase successful!\\n\\n" +
              confirmation.description +
              (confirmation.phone_number ? "\\nRecipient: " + confirmation.phone_number : "") +
              "\\nAmount: ₦" + Number(confirmation.amount || 0).toLocaleString("en-NG") +
              "\\nStatus: Successful" +
              (confirmation.reference ? "\\nReference: " + confirmation.reference : "\\nReference: Pending")
            : confirmation.status === "failed"
              ? "❌ The purchase failed. Your wallet has been refunded automatically." +
                (confirmation.reference ? "\\nReference: " + confirmation.reference : "")
              : "⏳ Your purchase is still being processed. No second purchase will be sent while the provider result is being checked." +
                (confirmation.reference ? "\\nReference: " + confirmation.reference : "");

        await persistAssistantMessage(customerAnswer, "purchase", "backend");
        return new Response(JSON.stringify({
          success: true,
          intent: "purchase",
          answer: customerAnswer,
          transaction_id: confirmation.transaction_id,
          description: confirmation.description,
          reference: confirmation.reference,
          purchase: {
            ...purchase,
            ...confirmation,
            status: executionStatus,
          },
          provider_execution: execution,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });      } catch (executionError) {
        await logAiActivity(
          "provider_execution_error",
          "purchase",
          originalMessage,
          null,
          false,
          executionError instanceof Error ? executionError.message : String(executionError),
          purchaseResult.transaction_id
        );
        return new Response(JSON.stringify({
          success: true,
          intent: "purchase",
          answer: "⏳ Your purchase is recorded and remains pending. The provider has not been retried; it can be safely checked through requery.",
          purchase: { ...purchase, status: "pending" },
          recovery_required: true,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
}
