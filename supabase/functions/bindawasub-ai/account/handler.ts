export type AccountActionContext = {
  supabase: any;
  userId: string;
  corsHeaders: Record<string,string>;
  conversationId?: string | null;
  channel?: string;
  persistAssistantMessage?: (...args: any[]) => Promise<void>;
  executePendingRequery?: (transactionId: string) => Promise<any>;
};

function response(data: any, status: number, corsHeaders: Record<string,string>) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export async function handleCheckWallet(ctx: AccountActionContext, amountValue: unknown) {
  const amount = Number(amountValue || 0);
  const { data, error } = await ctx.supabase.rpc("get_my_balance", { p_user_id: ctx.userId });
  if (error) throw error;
  const wallet = data?.[0];
  if (!wallet) return response({ success: false, error: "Wallet not found" }, 404, ctx.corsHeaders);
  const sufficient = Number(wallet.balance) >= amount;
  return response({
    success: true,
    balance: wallet.balance,
    currency: wallet.currency,
    sufficient,
    answer: sufficient
      ? `Your wallet balance is ₦${Number(wallet.balance).toLocaleString()}.`
      : `Your wallet balance is ₦${Number(wallet.balance).toLocaleString()}, but ₦${amount.toLocaleString()} is required.`
  }, 200, ctx.corsHeaders);
}

export async function handleTransactionActions(ctx: AccountActionContext, body: any) {
  const requestedLimit = Math.min(Math.max(Number(body.limit || 5), 1), 10);
  let transactionQuery = ctx.supabase
    .from("transactions")
    .select(`
      id, created_at, phone_number, amount, status, provider, provider_reference, product_id,
      products (product_name, volume, validity_type, validity_value, validity_unit, service_networks(code,name))
    `)
    .eq("user_id", ctx.userId);

  if (body.action === "transaction_status" && body.transaction_id) {
    transactionQuery = transactionQuery.eq("id", String(body.transaction_id).trim()).limit(1);
  } else {
    transactionQuery = transactionQuery
      .order("created_at", { ascending: false })
      .limit(body.action === "last_transaction" || body.action === "transaction_status" ? 1 : requestedLimit);
  }

  const { data: recentTransactions, error: transactionError } = await transactionQuery;
  if (transactionError) {
    console.error("Transaction history error:", transactionError);
    throw transactionError;
  }

  const rows = recentTransactions || [];
  const maskPhone = (phone: string | null) => {
    if (!phone) return "—";
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) return phone;
    return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
  };
  const normalizeProduct = (product: any) => Array.isArray(product) ? product[0] : product;
  const formatted = rows.map((tx: any) => {
    const product = normalizeProduct(tx.products);
    const network = Array.isArray(product?.service_networks) ? product.service_networks[0] : product?.service_networks;
    return {
      id: tx.id,
      date: tx.created_at,
      product_name: product?.product_name || "Purchase",
      network: network?.code || null,
      volume: product?.volume || null,
      duration: product?.validity_type === "fixed" && product?.validity_value != null && product?.validity_unit
        ? `${product.validity_value} ${product.validity_unit}`
        : (product?.validity_type === "unlimited" ? "Unlimited" : null),
      phone_number: maskPhone(tx.phone_number),
      amount: Number(tx.amount || 0),
      status: tx.status,
      provider: tx.provider,
      provider_reference: tx.provider_reference
    };
  });

  if (body.action === "transaction_history") {
    const answer = formatted.length === 0
      ? "You do not have any purchases yet."
      : `Here are your latest ${formatted.length} purchase${formatted.length === 1 ? "" : "s"}.`;
    return response({ success: true, intent: "transaction_history", transactions: formatted, answer }, 200, ctx.corsHeaders);
  }

  if (formatted.length === 0) {
    return response({ success: true, intent: body.action, transaction: null, answer: "You do not have any purchases yet." }, 200, ctx.corsHeaders);
  }

  const latest = formatted[0];
  let answer = `Your latest purchase is ${latest.product_name} for ₦${latest.amount.toLocaleString()} to ${latest.phone_number}. Status: ${latest.status}.`;
  if (body.action === "transaction_status") {
    if (latest.status === "successful") answer = `Yes. Your latest purchase, ${latest.product_name}, was successful.`;
    else if (latest.status === "failed") answer = `Your latest purchase, ${latest.product_name}, failed.`;
    else answer = `Your latest purchase, ${latest.product_name}, is currently ${latest.status}.`;
  }

  return response({ success: true, intent: body.action, transaction: latest, answer }, 200, ctx.corsHeaders);
}

export async function handlePendingRequery(ctx: AccountActionContext, transactionIdValue: unknown) {
  const transactionId = String(transactionIdValue || "").trim();
  if (!transactionId) return response({ success: false, error: "transaction_id is required." }, 400, ctx.corsHeaders);

  const { data: pendingTx, error } = await ctx.supabase
    .from("transactions")
    .select("id,user_id,status,provider_reference")
    .eq("id", transactionId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw error;
  if (!pendingTx) return response({ success: false, error: "Transaction not found." }, 404, ctx.corsHeaders);

  if (["successful", "failed", "reversed"].includes(String(pendingTx.status || "").toLowerCase())) {
    return response({ success: true, intent: "requery_pending_purchase", transaction_id: transactionId, status: pendingTx.status, already_final: true }, 200, ctx.corsHeaders);
  }

  if (!pendingTx.provider_reference) {
    return response({ success: false, error: "Transaction has no provider reference to requery." }, 400, ctx.corsHeaders);
  }

  if (!ctx.executePendingRequery) throw new Error("Pending requery handler is not configured.");
  const result = await ctx.executePendingRequery(transactionId);
  return response({ success: true, intent: "requery_pending_purchase", ...result }, 200, ctx.corsHeaders);
}

export async function handleManualFunding(ctx: AccountActionContext, body: any) {
  const { data: settings, error: settingsError } = await ctx.supabase
    .from("manual_funding_settings")
    .select("active, bank_name, account_name, account_number, instructions")
    .eq("id", 1)
    .maybeSingle();
  if (settingsError) throw settingsError;

  if (!settings?.active) {
    return response({ success: false, intent: "fund_wallet", error: "Manual wallet funding is temporarily unavailable." }, 400, ctx.corsHeaders);
  }

  const requestedAmount = Number(body.amount || 0);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return response({
      success: true, intent: "fund_wallet", funding_mode: "manual", requires_amount: true,
      bank_account: settings?.account_number ? { bank_name: settings.bank_name, account_name: settings.account_name, account_number: settings.account_number } : null,
      instructions: settings?.instructions || "Enter the amount you want to fund, then transfer the exact amount using the payment details provided.",
      answer: settings?.account_number
        ? "You can fund your wallet by bank transfer. Please enter the amount you want to add."
        : "Manual funding is ready. Please enter the amount you want to add. The bank transfer details will be shown once configured."
    }, 200, ctx.corsHeaders);
  }

  const reference = `MFR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const { data: request, error: requestError } = await ctx.supabase
    .from("manual_funding_requests")
    .insert({ user_id: ctx.userId, amount: requestedAmount, reference, status: "pending" })
    .select("id, amount, reference, status, created_at")
    .single();
  if (requestError) throw requestError;

  return response({
    success: true, intent: "fund_wallet", funding_mode: "manual", requires_payment: true, request,
    bank_account: settings?.account_number ? { bank_name: settings.bank_name, account_name: settings.account_name, account_number: settings.account_number } : null,
    instructions: settings?.instructions || "Transfer the exact amount to the configured Bindawasub bank account, then submit your transfer reference.",
    answer: "Funding request created. Please make the bank transfer using the details provided."
  }, 200, ctx.corsHeaders);
}

export function handleStartAirtime(ctx: AccountActionContext, body: any, originalMessage: string) {
  const requestedNetwork = String(body.network || "").trim().toLowerCase();
  const match = !requestedNetwork ? String(originalMessage || "").match(/\b(mtn|airtel|glo|9mobile|t2)\b/i) : null;
  const normalized = (requestedNetwork || match?.[1] || "").toLowerCase();
  const network = normalized === "t2" || normalized.startsWith("9mobile") ? "9mobile" : normalized;
  if (!["mtn", "airtel", "glo", "9mobile"].includes(network)) {
    return response({ success: false, error: "Unsupported airtime network." }, 400, ctx.corsHeaders);
  }
  const names: any = { mtn: "MTN", airtel: "Airtel", glo: "Glo", "9mobile": "9mobile (T2)" };
  const answer = `You selected ${names[network]} airtime. How much airtime do you want to buy?`;
  if (ctx.persistAssistantMessage) {
    // Preserve the existing quick-action message persistence.
    return ctx.persistAssistantMessage(ctx.supabase, ctx.conversationId || null, answer, "airtime_purchase", "backend")
      .then(() => response({ success: true, intent: "airtime_purchase", service_type: "airtime", network, answer, ai_powered: false, quick_action: true }, 200, ctx.corsHeaders));
  }
  return response({ success: true, intent: "airtime_purchase", service_type: "airtime", network, answer, ai_powered: false, quick_action: true }, 200, ctx.corsHeaders);
}
