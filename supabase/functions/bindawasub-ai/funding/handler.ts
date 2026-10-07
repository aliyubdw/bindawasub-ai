export type FundingAirtimeContext = {
  supabase: any;
  userId: string;
  isAdmin: boolean;
  corsHeaders: Record<string,string>;
  originalMessage?: string;
  conversationId?: string | null;
  channel?: string;
  persistAssistantMessage?: (...args: any[]) => Promise<void>;
};

export async function handleStartAirtime(ctx: FundingAirtimeContext, body: any) {
  const { supabase, userId, corsHeaders, originalMessage, conversationId, channel } = ctx;
  
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

        let conversationContext = ownedConversation.conversation_context &&
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
      if (ctx.persistAssistantMessage) {
        await ctx.persistAssistantMessage(supabase, conversationId, answer, "airtime_purchase", "backend");
      }

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

export async function handleFundingActions(ctx: FundingAirtimeContext, body: any) {
  const { supabase, userId, isAdmin, corsHeaders } = ctx;

  // CUSTOMER WALLET FUNDING REQUEST
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

}