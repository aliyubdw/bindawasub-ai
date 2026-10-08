import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function authorizeRecovery(req: Request, db: any) {
  const supplied = req.headers.get("X-Bindawasub-Recovery-Secret") || "";
  if (!supplied) throw new Error("Recovery authorization required.");
  const { data: secretRow, error } = await db
    .from("bindawasub_internal_tokens")
    .select("value")
    .eq("name", "recovery")
    .maybeSingle();
  if (error || !secretRow?.value || supplied !== secretRow.value) {
    throw new Error("Invalid recovery authorization.");
  }
}

async function callProviderExecution(transactionId: string) {
  const url = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/provider-execution";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + serviceRole,
      "apikey": serviceRole,
    },
    body: JSON.stringify({ action: "requery_transaction", transaction_id: transactionId }),
  });
  const raw = await res.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!res.ok) throw new Error(data?.error || "Provider execution requery failed.");
  return data;
}

function maskPhone(v: string) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(0, 4) + "****" + d.slice(-3) : "-";
}

async function claimNotification(db: any, transactionId: string) {
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: current, error: readError } = await db
    .from("transactions")
    .select("notification_attempts")
    .eq("id", transactionId)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) return null;

  const nextAttempts = Number(current.notification_attempts || 0) + 1;
  const { data, error } = await db
    .from("transactions")
    .update({
      notification_claimed_at: new Date().toISOString(),
      notification_attempts: nextAttempts,
    })
    .eq("id", transactionId)
    .in("status", ["successful", "failed", "reversed"])
    .is("customer_notified_at", null)
    .eq("notification_attempts", Number(current.notification_attempts || 0))
    .or("notification_claimed_at.is.null,notification_claimed_at.lt." + stale)
    .select("notification_attempts")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { attempts: Number(data.notification_attempts || nextAttempts) };
}

async function notifyCustomer(db: any, transactionId: string) {
  const claim = await claimNotification(db, transactionId);
  if (!claim) return { sent: false, skipped: true, reason: "notification_already_claimed_or_sent" };

  try {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) throw new Error("Telegram bot token is not configured.");

    const { data: tx, error: txError } = await db
      .from("transactions")
      .select("id,user_id,amount,phone_number,description,service_type,provider_reference,status,completed_at,products(product_name,volume,service_networks(code,name))")
      .eq("id", transactionId)
      .maybeSingle();
    if (txError) throw txError;
    if (!tx?.user_id) throw new Error("Transaction user not found.");

    const { data: acct, error: acctError } = await db
      .from("telegram_accounts")
      .select("telegram_chat_id")
      .eq("user_id", tx.user_id)
      .eq("active", true)
      .maybeSingle();
    if (acctError) throw acctError;
    if (!acct?.telegram_chat_id) {
      await db.from("transactions").update({
        notification_claimed_at: null,
        last_notification_error: "No active Telegram account.",
      }).eq("id", transactionId);
      return { sent: false, skipped: true, reason: "no_telegram_account" };
    }

    const { data: wallet } = await db.rpc("get_my_balance", { p_user_id: tx.user_id });
    const balance = Number(wallet?.[0]?.balance ?? 0);
    const p = Array.isArray(tx.products) ? tx.products[0] : tx.products;
    const n = Array.isArray(p?.service_networks) ? p.service_networks[0] : p?.service_networks;
    const plan = String(p?.product_name || tx.description || "Purchase");
    const network = String(n?.name || n?.code || tx.service_type || "-");
    const amount = "₦" + Number(tx.amount || 0).toLocaleString("en-NG");
    const bal = "₦" + balance.toLocaleString("en-NG");
    const when = new Date(tx.completed_at || Date.now()).toLocaleString("en-NG", {
      timeZone: "Africa/Lagos",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true
    });
    const ref = String(tx.provider_reference || tx.id);

    const ok = tx.status === "successful";
    const msg = ok
      ? [
          "🧾 Transaction Receipt", "",
          "✅ Status: Successful", "",
          "Plan: " + plan,
          "Network: " + network,
          "Recipient: " + maskPhone(String(tx.phone_number || "")),
          "Amount paid: " + amount,
          "Wallet balance: " + bal,
          "Reference: " + ref,
          "Date: " + when
        ].join("\n")
      : [
          tx.status === "reversed" ? "↩️ Transaction Reversed" : "❌ Transaction Failed", "",
          "Plan: " + plan,
          "Network: " + network,
          "Recipient: " + maskPhone(String(tx.phone_number || "")),
          "Amount: " + amount,
          "",
          "Any wallet refund is handled automatically. Wallet balance: " + bal,
          "Reference: " + ref
        ].join("\n");

    const payload: any = {
      chat_id: acct.telegram_chat_id,
      text: msg,
      disable_web_page_preview: true,
    };
    if (ok) {
      payload.reply_markup = {
        inline_keyboard: [[{ text: "🔄 Buy Again", callback_data: "receipt_buy_again" }]]
      };
    }

    const res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const raw = await res.text();
      throw new Error("Telegram send failed: " + raw.slice(0, 300));
    }

    await db.from("transactions").update({
      customer_notified_at: new Date().toISOString(),
      notification_claimed_at: null,
      last_notification_error: null,
    }).eq("id", transactionId);

    return { sent: true, attempts: claim.attempts };
  } catch (e) {
    await db.from("transactions").update({
      notification_claimed_at: null,
      last_notification_error: e instanceof Error ? e.message : String(e),
    }).eq("id", transactionId);
    return { sent: false, reason: "send_failed" };
  }
}

async function hasHistoricalProviderEvidence(db: any, transactionId: string) {
  const { data, error } = await db
    .from("transaction_events")
    .select("id")
    .eq("transaction_id", transactionId)
    .not("provider_reference", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function refundPreProvider(db: any, transactionId: string) {
  const historicalProviderEvidence = await hasHistoricalProviderEvidence(db, transactionId);
  if (historicalProviderEvidence) {
    return {
      status: "pending",
      skipped: true,
      reason: "historical_provider_reference_exists",
    };
  }

  const { data: tx, error } = await db
    .from("transactions")
    .select("id,status,amount,provider_reference,execution_attempts,processing_at,created_at")
    .eq("id", transactionId)
    .maybeSingle();
  if (error) throw error;
  if (!tx || tx.status !== "pending") return { status: tx?.status || "missing", skipped: true };
  if (tx.provider_reference || Number(tx.execution_attempts || 0) > 0 || tx.processing_at) {
    return { status: "pending", skipped: true, reason: "provider_execution_may_have_started" };
  }

  const result = await db.rpc("finalize_vtu_transaction", {
    p_transaction_id: transactionId,
    p_provider_status: "failed",
    p_provider_reference: null,
    p_provider_message: "Transaction expired before provider execution. Your wallet has been refunded.",
    p_provider_response: { recovery: true, reason: "pre_provider_timeout" },
  });
  if (result.error) throw result.error;
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row || row.final_status !== "failed") throw new Error("Pre-provider refund did not finalize the transaction.");
  return { status: "failed", refunded: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bindawasub-recovery-secret",
      }
    });
  }

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await authorizeRecovery(req, db);

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const preProviderCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const { data: pending, error: pendingError } = await db
      .from("transactions")
      .select("id,status,provider,provider_reference,execution_attempts,processing_at,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);
    if (pendingError) throw pendingError;

    const results: any[] = [];

    for (const tx of pending || []) {
      try {
        if (tx.provider_reference && tx.created_at > cutoff) {
          const result = await callProviderExecution(String(tx.id));
          let notification = null;
          if (!result?.already_finalized && ["successful", "failed", "reversed"].includes(String(result?.status))) {
            notification = await notifyCustomer(db, String(tx.id));
          }
          results.push({
            transaction_id: tx.id,
            action: "provider_requery",
            status: result?.status || "unknown",
            success: result?.success !== false,
            message: result?.message || null,
            customer_notified: notification?.sent ?? null,
          });
          continue;
        }

        if (!tx.provider_reference &&
            Number(tx.execution_attempts || 0) === 0 &&
            !tx.processing_at &&
            tx.created_at < preProviderCutoff) {
          const result = await refundPreProvider(db, String(tx.id));
          let notification = null;
          if (result.refunded) notification = await notifyCustomer(db, String(tx.id));
          results.push({
            transaction_id: tx.id,
            action: "pre_provider_refund",
            status: result.status,
            refunded: result.refunded === true,
            customer_notified: notification?.sent ?? null,
          });
          continue;
        }

        results.push({
          transaction_id: tx.id,
          action: "manual_review",
          status: "pending",
          reason: tx.provider_reference
            ? "Provider reference exists but the transaction is outside the automatic requery window."
            : "Provider execution state is not safe for automatic refund/retry.",
        });
      } catch (e) {
        results.push({
          transaction_id: tx.id,
          action: "recovery_error",
          status: "pending",
          success: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Retry recent finalized transactions whose Telegram receipt has not been delivered.
    const { data: notifications, error: notificationError } = await db
      .from("transactions")
      .select("id,status,completed_at")
      .in("status", ["successful", "failed", "reversed"])
      .is("customer_notified_at", null)
      .gt("completed_at", cutoff)
      .order("completed_at", { ascending: true })
      .limit(20);
    if (notificationError) throw notificationError;

    for (const tx of notifications || []) {
      try {
        const notification = await notifyCustomer(db, String(tx.id));
        results.push({
          transaction_id: tx.id,
          action: "notification_retry",
          status: tx.status,
          customer_notified: notification.sent === true,
          skipped: notification.skipped === true,
        });
      } catch (e) {
        results.push({
          transaction_id: tx.id,
          action: "notification_error",
          status: tx.status,
          customer_notified: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      checked: results.length,
      results,
      message: "Pending VTU recovery completed. It never retries a purchase when provider execution may have started."
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      success: false,
      error: e instanceof Error ? e.message : "Recovery failed."
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
});