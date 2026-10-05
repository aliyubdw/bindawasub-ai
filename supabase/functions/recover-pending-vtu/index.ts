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
    body: JSON.stringify({
      action: "requery_transaction",
      transaction_id: transactionId,
    }),
  });
  const raw = await res.text();
  let data: any;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!res.ok) throw new Error(data?.error || "Provider execution requery failed.");
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bindawasub-recovery-secret",
      },
    });
  }

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await authorizeRecovery(req, db);

    // Only re-query pending purchases that already reached the provider and
    // therefore have a provider reference. Never send a new purchase.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: queue, error } = await db
      .from("transactions")
      .select("id,status,provider,provider_reference,created_at")
      .eq("status", "pending")
      .not("provider_reference", "is", null)
      .gt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) throw error;

    const results: any[] = [];
    for (const tx of queue || []) {
      try {
        const result = await callProviderExecution(String(tx.id));
        results.push({
          transaction_id: tx.id,
          previous_status: tx.status,
          status: result?.status || "unknown",
          success: result?.success !== false,
          message: result?.message || null,
        });
      } catch (e) {
        results.push({
          transaction_id: tx.id,
          previous_status: tx.status,
          status: "pending",
          success: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      checked: results.length,
      results,
      message: "Pending VTU recovery completed. No new purchases were sent.",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      success: false,
      error: e instanceof Error ? e.message : "Recovery failed.",
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});