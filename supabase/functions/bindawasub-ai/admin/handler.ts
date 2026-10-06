export type AdminContext = {
  supabase: any;
  isAdmin: boolean;
  corsHeaders: Record<string,string>;
};

function response(data: any, status: number, corsHeaders: Record<string,string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function requireAdmin(ctx: AdminContext) {
  if (!ctx.isAdmin) return response({ success: false, error: "Admin access required." }, 403, ctx.corsHeaders);
  return null;
}

export async function handleAiSummary(ctx: AdminContext) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [conversations, messages, activities, successful, failed, pending] = await Promise.all([
    ctx.supabase.from("ai_conversations").select("id", { count: "exact", head: true }).gte("last_message_at", since),
    ctx.supabase.from("ai_messages").select("id", { count: "exact", head: true }).gte("created_at", since),
    ctx.supabase.from("ai_activity_log").select("id", { count: "exact", head: true }).gte("created_at", since),
    ctx.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("status", "successful").gte("created_at", since),
    ctx.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
    ctx.supabase.from("transactions").select("id", { count: "exact", head: true }).eq("status", "pending").gte("created_at", since)
  ]);

  const errorResult = [conversations, messages, activities, successful, failed, pending].find((q: any) => q.error);
  if (errorResult?.error) throw errorResult.error;

  return response({
    success: true,
    period_days: 7,
    summary: {
      conversations: conversations.count || 0,
      messages: messages.count || 0,
      activity_events: activities.count || 0,
      successful_purchases: successful.count || 0,
      failed_purchases: failed.count || 0,
      pending_purchases: pending.count || 0
    }
  }, 200, ctx.corsHeaders);
}

export async function handleAiSettings(ctx: AdminContext, action: string, settings: any) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  if (action === "ai_settings_get") {
    const { data, error } = await ctx.supabase.from("ai_settings").select("*").limit(1).maybeSingle();
    if (error) throw error;
    return response({ success: true, settings: data }, 200, ctx.corsHeaders);
  }

  const patch: any = {};
  for (const key of ["enabled", "gemini_enabled", "require_purchase_confirmation", "max_purchase_amount", "default_language", "allowed_channels", "fallback_message"]) {
    if (settings?.[key] !== undefined) patch[key] = settings[key];
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await ctx.supabase
    .from("ai_settings")
    .update(patch)
    .not("id", "is", null)
    .select("*")
    .limit(1)
    .single();

  if (error) throw error;
  return response({ success: true, settings: data }, 200, ctx.corsHeaders);
}

export async function handleAiCustomerWallet(ctx: AdminContext, customerId: string) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;
  if (!customerId) return response({ success: false, error: "Customer user_id is required." }, 400, ctx.corsHeaders);

  const [wallet, walletTx] = await Promise.all([
    ctx.supabase.from("wallets").select("id,user_id,balance,currency,updated_at").eq("user_id", customerId).maybeSingle(),
    ctx.supabase.from("wallet_transactions").select("id,type,amount,reference,balance_before,balance_after,status,created_at").eq("user_id", customerId).order("created_at", { ascending: false }).limit(50)
  ]);

  if (wallet.error) throw wallet.error;
  if (walletTx.error) throw walletTx.error;

  return response({ success: true, wallet: wallet.data || null, transactions: walletTx.data || [] }, 200, ctx.corsHeaders);
}

export async function handleAdminStatus(ctx: AdminContext, bindawasubUser: any) {
  return response({
    success: true,
    authenticated: true,
    is_admin: ctx.isAdmin,
    role: bindawasubUser.role,
    user: {
      id: bindawasubUser.id,
      name: bindawasubUser.name,
      phone: bindawasubUser.phone
    }
  }, 200, ctx.corsHeaders);
}

export async function handleCustomerSearch(ctx: AdminContext, searchValue: string) {
  const denied = requireAdmin(ctx);
  if (denied) return denied;

  const search = String(searchValue || "").trim();
  if (!search) return response({ success: false, error: "Search name or phone number." }, 400, ctx.corsHeaders);

  const { data: customers, error } = await ctx.supabase
    .from("users")
    .select("id,name,phone,role,wallets(balance)")
    .or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
    .order("name", { ascending: true })
    .limit(20);

  if (error) {
    console.error("Customer search error:", error);
    return response({ success: false, error: error.message }, 400, ctx.corsHeaders);
  }

  const normalizedCustomers = (customers || []).map((customer: any) => {
    const wallet = Array.isArray(customer.wallets) ? customer.wallets[0] : customer.wallets;
    const balance = Number(wallet?.balance ?? 0);
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      role: customer.role,
      wallets: [{ balance: Number.isFinite(balance) ? balance : 0 }]
    };
  });

  return response({ success: true, intent: "customer_search", customers: normalizedCustomers }, 200, ctx.corsHeaders);
}
