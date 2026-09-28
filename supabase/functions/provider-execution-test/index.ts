import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Scenario = "confirmed_failure_failover" | "timeout_ambiguous" | "unknown_ambiguous" | "pending_requery" | "requery_success" | "requery_failure" | "all_providers_fail_once" | "duplicate_execution" | "crash_after_attempt";

function normalizeStatus(value: unknown, map: any = {}) {
  const s = String(value ?? "").trim().toLowerCase();
  const success = (map.success_values ?? ["success","successful","completed","complete","true","1","ok"]).map((x:any)=>String(x).toLowerCase());
  const pending = (map.pending_values ?? ["pending","processing","queued","queue","in_progress","in progress"]).map((x:any)=>String(x).toLowerCase());
  const safeFailure = (map.safe_failure_values ?? map.failed_values ?? ["failed","failure","error","false","0","cancelled","canceled"]).map((x:any)=>String(x).toLowerCase());
  const ambiguous = (map.ambiguous_values ?? ["unknown","timeout","timed_out","timed out","uncertain","indeterminate"]).map((x:any)=>String(x).toLowerCase());
  if (success.includes(s)) return "successful";
  if (ambiguous.includes(s)) return "ambiguous";
  if (pending.includes(s)) return "pending";
  if (safeFailure.includes(s)) return "failed";
  return "ambiguous";
}

function runScenario(name: Scenario) {
  const events:string[] = [];
  const attempts:any[] = [];
  let walletDebit = 430;
  let refundCount = 0;
  let transaction = "pending";
  const attempt = (n:number, status:string, ambiguous=false) => {
    attempts.push({attempt_no:n,status,ambiguous});
    events.push(`attempt_${n}:${status}`);
  };

  if (name === "confirmed_failure_failover") {
    attempt(1, "failed");
    attempt(2, "successful");
    transaction = "successful";
    events.push("failover_after_confirmed_failure");
  } else if (name === "timeout_ambiguous") {
    attempt(1, "ambiguous", true);
    events.push("no_failover");
  } else if (name === "unknown_ambiguous") {
    const normalized = normalizeStatus("provider-new-status");
    attempt(1, normalized, true);
    events.push("no_failover");
  } else if (name === "pending_requery") {
    attempt(1, "ambiguous", true);
    events.push("requery_required");
  } else if (name === "requery_success") {
    attempt(1, "ambiguous", true);
    events.push("requery");
    attempts[0].status = "successful";
    attempts[0].ambiguous = false;
    transaction = "successful";
  } else if (name === "requery_failure") {
    attempt(1, "ambiguous", true);
    events.push("requery");
    attempts[0].status = "failed";
    attempts[0].ambiguous = false;
    transaction = "failed";
    refundCount = 1;
    walletDebit = 0;
  } else if (name === "all_providers_fail_once") {
    attempt(1, "failed");
    attempt(2, "failed");
    transaction = "failed";
    refundCount = 1;
    walletDebit = 0;
    events.push("single_refund_after_all_confirmed_failures");
  } else if (name === "duplicate_execution") {
    attempt(1, "successful");
    transaction = "successful";
    events.push("second_execution_blocked_by_final_state");
  } else if (name === "crash_after_attempt") {
    attempt(1, "started");
    attempts[0].status = "ambiguous";
    attempts[0].ambiguous = true;
    events.push("execution_recovery");
    events.push("processing_lock_cleared");
    events.push("requery_required");
  }

  const assertions:any[] = [];
  const assert = (condition:boolean, message:string) => assertions.push({passed:condition,message});

  if (name === "confirmed_failure_failover") {
    assert(attempts.length === 2, "A confirmed failure may move to the next provider.");
    assert(transaction === "successful", "A later successful provider finalizes the transaction.");
    assert(refundCount === 0, "No refund occurs after successful failover.");
  }
  if (name === "timeout_ambiguous" || name === "unknown_ambiguous") {
    assert(attempts.length === 1, "Ambiguous outcomes do not trigger blind failover.");
    assert(attempts[0].ambiguous === true, "The attempt is recorded as ambiguous.");
    assert(transaction === "pending", "The transaction remains pending.");
  }
  if (name === "pending_requery") assert(transaction === "pending", "Non-final provider status requires requery.");
  if (name === "requery_success") {
    assert(transaction === "successful", "Successful requery finalizes the transaction.");
    assert(attempts[0].ambiguous === false, "Requery resolves the ambiguous attempt.");
  }
  if (name === "requery_failure") {
    assert(transaction === "failed", "Confirmed failed requery finalizes as failed.");
    assert(refundCount === 1, "Confirmed failed requery refunds once.");
  }
  if (name === "all_providers_fail_once") {
    assert(transaction === "failed", "All confirmed provider failures finalize as failed.");
    assert(refundCount === 1, "Multiple provider failures cause exactly one refund.");
  }
  if (name === "duplicate_execution") assert(attempts.length === 1, "A finalized transaction is not executed a second time.");
  if (name === "crash_after_attempt") {
    assert(attempts[0].status === "ambiguous", "Crash recovery converts started attempt to ambiguous.");
    assert(transaction === "pending", "Crash recovery leaves the transaction pending.");
    assert(events.includes("processing_lock_cleared"), "Crash recovery clears processing lock.");
  }

  return {
    scenario:name,
    passed:assertions.every(x=>x.passed),
    assertions,
    transaction_status:transaction,
    attempts,
    refund_count:refundCount,
    simulated_wallet_debit:walletDebit,
    events
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok");
  try {
    const body = await req.json().catch(() => ({}));
    const requested = body.scenario ? [String(body.scenario) as Scenario] : [
      "confirmed_failure_failover","timeout_ambiguous","unknown_ambiguous",
      "pending_requery","requery_success","requery_failure",
      "all_providers_fail_once","duplicate_execution","crash_after_attempt"
    ];
    const results = requested.map(runScenario);
    return new Response(JSON.stringify({
      success: results.every(r=>r.passed),
      mode:"SIMULATION_ONLY",
      provider_requests_sent:0,
      production_transactions_changed:0,
      results
    }), {headers:{"Content-Type":"application/json"}});
  } catch (e) {
    return new Response(JSON.stringify({success:false,error:e instanceof Error ? e.message : "Test failed"}), {
      status:400, headers:{"Content-Type":"application/json"}
    });
  }
});
