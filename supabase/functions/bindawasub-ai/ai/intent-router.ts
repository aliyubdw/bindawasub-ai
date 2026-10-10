import { describePlan, formatCatalogProduct, productSpecification } from "../catalog/format.ts";
import { resolveCatalogProduct, filterCatalogBySpecification } from "../catalog/lookup.ts";
import { getWalletBalance } from "../wallet/balance.ts";
import { getCustomerTransactions } from "../transactions/handler.ts";
import { createManualFundingRequest } from "../wallet/funding.ts";

export type AiIntentRouterContext = {
  ai: any;
  aiProducts: any[];
  purchaseCatalog: any[];
  variantFilteredProducts: any[];
  networkFilteredProducts: any[];
  requestedNetworkToken: string;
  requestedVariantText: string;
  availableDataTypes: any[];
  serviceCatalog: any[];
  supabase: any;
  userId: string;
  conversationId: string | null;
  conversationContext: any;
  channel: string;
  originalMessage: string;
  corsHeaders: Record<string,string>;
  persistAssistantMessage: (...args:any[]) => Promise<void>;
};

export async function routeAiIntent(ctx: AiIntentRouterContext): Promise<Response | null> {
  let {
    ai, aiProducts, purchaseCatalog, variantFilteredProducts,
    networkFilteredProducts, requestedNetworkToken, requestedVariantText,
    availableDataTypes, serviceCatalog, supabase, userId,
    conversationId, conversationContext, channel, originalMessage,
    corsHeaders, persistAssistantMessage
  } = ctx;

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
            products: (aiProducts || []).map(formatCatalogProduct),
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
        // A fresh request such as "buy 1GB for Mom" must show every matching
        // active network plan. Do not let a model-inferred network or product ID
        // silently choose one when the customer did not name a network.
        const explicitNetworkInMessage =
          /\bmtn\b/i.test(originalMessage) ||
          /\bairtel\b/i.test(originalMessage) ||
          /\bglo\b/i.test(originalMessage) ||
          /\b(?:9mobile|t2)\b/i.test(originalMessage);
        const requestedSize = String(originalMessage.match(/\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb)\b/i)?.[0] || ai?.volume || "").trim();
        const unscopedSizePurchase =
          !explicitNetworkInMessage &&
          /\b(?:buy|purchase|send|get|give|need|want|order|activate|subscribe|saya|sayi|siyo|siya|oda|aika|kunna)\b/i.test(originalMessage) &&
          /\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb)\b/i.test(originalMessage);
        const literalVariant = /\bsme\b/i.test(originalMessage) ? "smedata"
          : /\bsocial\b/i.test(originalMessage) ? "social"
          : /\bgifting\b/i.test(originalMessage) ? "gifting"
          : /\bawoop\b/i.test(originalMessage) ? "awoop"
          : null;
        const purchaseCatalog = unscopedSizePurchase
          ? (literalVariant
              ? networkFilteredProducts.filter((p:any) => {
                  const variant = Array.isArray(p.service_variants) ? p.service_variants[0] : p.service_variants;
                  const normalize = (v:any) => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                  return normalize(variant?.code) === normalize(literalVariant) || normalize(variant?.name) === normalize(literalVariant);
                })
              : networkFilteredProducts)
          : (requestedVariantText ? variantFilteredProducts : networkFilteredProducts);
        const purchaseAi = unscopedSizePurchase
          ? { ...ai, service_type: "data", network: null, product_id: null, product_name: null, variant: literalVariant, volume: requestedSize || ai.volume }
          : ai;

        // Product specification is resolved only against the live catalog.
        // For unscoped data-size requests, the candidate list intentionally spans networks.
        const specificationCandidates = filterCatalogBySpecification(purchaseAi, purchaseCatalog);
        const matchedById = !unscopedSizePurchase && String(ai?.product_id||"").trim()
          ? specificationCandidates.find((p:any)=>p.id===String(ai.product_id).trim())
          : null;
        const matchedProduct = matchedById || (
          !unscopedSizePurchase && specificationCandidates.length === 1
            ? specificationCandidates[0]
            : null
        );

        const serviceType = String((unscopedSizePurchase ? "data" : ai.service_type) || matchedProduct?.service_type || "").trim().toLowerCase();
        const catalogService = serviceCatalog.find((s:any) => s.code === serviceType);
        const customerInput = {
          ...(ai.customer_input && typeof ai.customer_input === "object" ? ai.customer_input : {})
        };

        if (ai.phone_number && !customerInput.phone) customerInput.phone = ai.phone_number;
        if (unscopedSizePurchase) {
          delete customerInput.network;
        } else if (ai.network && !customerInput.network) {
          customerInput.network = ai.network;
        }
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
          if (specificationCandidates.length > 1 || (unscopedSizePurchase && specificationCandidates.length > 0)) {
            const choices = specificationCandidates.map(productSpecification);
            return new Response(JSON.stringify({
              success:true,
              intent:"purchase_intent",
              service_type:serviceType || null,
              product:null,
              products:choices,
              customer_input:customerInput,
              phone_number: ai.phone_number || customerInput.phone || null,
              missing_fields:missingFields,
              answer: unscopedSizePurchase
                ? (String(ai.language || "").toLowerCase() === "hausa"
                    ? "Na samu data plans masu girman da ka nema a networks daban-daban. Zaɓi network da plan ɗin da kake so."
                    : "I found matching data plans across available networks. Compare the network, validity and price, then choose your preferred plan.")
                : (ai.reply || "I found more than one matching product. Please choose the network, data type, amount, or validity you want."),
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
            answer:"That product is not currently available. Please choose an available product from the catalog.",
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
          answer:String(serviceType)==="data"
            ? `Please confirm this purchase: ${describePlan(matchedProduct)} for ${ai.phone_number || customerInput.phone}. Reply YES to confirm or NO to cancel.`
            : (ai.reply || `You selected ${matchedProduct.product_name} for ₦${price.toLocaleString("en-NG")}. Please confirm before purchase.`),
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

        await persistAssistantMessage(supabase, conversationId, answer, accountAction, "backend");
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

  return null;
}
