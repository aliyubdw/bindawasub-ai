import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");

  try {
    const auth = req.headers.get("Authorization") || "";
    if (auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
      return json({ success: false, error: "Internal service authorization required." }, 401);
    }

    // Prevent overlapping recovery runs.
    const { data: lockRows, error: lockError } = await db.rpc("pg_try_advisory_lock", { key: 8242026 });
    if (lockError) {
      console.error("Recovery lock unavailable:", lockError.message);
    }

    const { data: pending, error } = await db
      .from("transactions")
      .select("id,status,provider_reference,created_at")
      .eq("status", "pending")
      .not("provider_reference", "is", null)
      .gt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: true })
      .limit(10);

    if (error) throw new Error("Pending transaction lookup failed: " + error.message);

    const results: any[] = [];
    for (const tx of pending || []) {
      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/provider-execution`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
            "apikey": SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({
            action: "requery_transaction",
            transaction_id: tx.id,
          }),
        });

        const raw = await response.text();
        let result: any;
        try { result = JSON.parse(raw); } catch { result = { success: false, error: raw }; }

        results.push({
          transaction_id: tx.id,
          status: result?.status || "unknown",
          success: response.ok && result?.success !== false,
          message: result?.message || result?.error || null,
        });
      } catch (e) {
        results.push({
          transaction_id: tx.id,
          status: "pending",
          success: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return json({
      success: true,
      checked: results.length,
      results,
      note: "Only pending transactions with an existing provider reference are re-queried. No new purchase is sent.",
    });
  } catch (e) {
    console.error("Transaction recovery error:", e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});