// provider-execution against a fake SMEPlug: airtime must reach the provider with the right request,
// and every existing safeguard (no double sends, refunds only on a confirmed failure) must still hold.
// Mock-only: no network, no real provider, no real money.
import { boot, db, loadProviderExecution, callProviderExecution, providerCalls, setProviderReply } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

Deno.env.set("SMEPLUG_API_KEY", "mock-provider-key");
const PHONE = "08011112222";
const provider = { id: "prov-1", name: "SMEPlug", code: "SMEPLUG", base_url: "https://smeplug.ng", status: "active" };
// Mirrors the real airtime endpoint configuration in production.
const airtimeEndpoint = { id: "e-air", provider_id: "prov-1", service_type: "airtime", operation: "purchase", method: "POST", path: "/api/v1/airtime/purchase", active: true, timeout_ms: 15000,
  headers_template: { "Content-Type": "application/json", Authorization: "Bearer {{credential.api_key}}" },
  request_template: { phone: "{{phone}}", amount: "{{amount}}", network_id: "{{network_id}}", customer_reference: "{{reference}}" },
  response_mapping: { status_path: "status", message_path: "data.msg", reference_path: "data.reference", success_values: [true, "true", "success", "successful"], failed_values: [false, "false", "failed", "failure"], pending_values: ["pending", "processing", "queued"] } };
const dataEndpoint = { ...airtimeEndpoint, id: "e-data", service_type: "data", path: "/api/v1/data/purchase",
  request_template: { phone: "{{phone}}", plan_id: "{{provider_plan_id}}", network_id: "{{network_id}}", customer_reference: "{{reference}}" } };

const airtimeTx = (network = "MTN", extra: Record<string, unknown> = {}) => ({ id: "tx1", user_id: "user-1", product_id: null, phone_number: PHONE, amount: 500, cost: 0, profit: 0,
  status: "pending", provider: null, provider_reference: null, service_type: "airtime", customer_input: { phone: PHONE, network, amount: 500 }, processing_at: null, ...extra });

const base = (extra: Record<string, unknown> = {}) => ({
  api_providers: [provider], provider_credentials: [{ provider_id: "prov-1", secret_name: "SMEPLUG_API_KEY" }],
  provider_services: [{ id: "ps1", provider_id: "prov-1", service_type: "airtime", enabled: true, priority: 1, metadata: {}, api_providers: provider }],
  provider_service_operations: [{ id: "o1", provider_service_id: "ps1", operation: "purchase", endpoint_id: "e-air", active: true, priority: 1, metadata: {}, api_endpoints: airtimeEndpoint }],
  api_endpoints: [airtimeEndpoint, dataEndpoint], transactions: [airtimeTx()], transaction_provider_attempts: [], wallet_transactions: [], ...extra,
});

async function setup(extra: Record<string, unknown> = {}, finalStatus = "successful") {
  await boot(honestModel, base(extra) as any); await loadProviderExecution();
  db.rpcHandlers["claim_vtu_transaction"] = () => ({ data: { claimed: true }, error: null });
  db.rpcHandlers["record_transaction_event"] = () => ({ data: null, error: null });
  db.rpcHandlers["finalize_vtu_transaction"] = (a: any) => ({ data: [{ final_status: a.p_provider_status }], error: null });
  void finalStatus;
}
const rpcs = (name: string) => db.rpcCalls.filter((c) => c.name === name);

Deno.test("airtime now reaches SMEPlug with the right request and is finalised as successful", async () => {
  await setup();
  const r = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
  eq([r.status, r.json.success, r.json.status], [200, true, "successful"], "execution result");
  eq(providerCalls.length, 1, "exactly one provider call");
  const call = providerCalls[0];
  eq([call.url, call.method], ["https://smeplug.ng/api/v1/airtime/purchase", "POST"], "endpoint");
  eq(call.headers.Authorization, "Bearer mock-provider-key", "provider credential used");
  eq([call.body.phone, call.body.amount, call.body.network_id], [PHONE, "500", "1"], "request body (MTN is network 1)");
  assert(String(call.body.customer_reference).startsWith("BW-tx1-"), `customer reference: ${call.body.customer_reference}`);
  eq(rpcs("finalize_vtu_transaction").map((c) => c.args.p_provider_status), ["successful"], "finalised once, as successful");
});

Deno.test("each network maps to SMEPlug's id", async () => {
  for (const [network, id] of [["MTN", "1"], ["Airtel", "2"], ["Glo", "3"], ["9mobile", "4"]]) {
    await setup({ transactions: [airtimeTx(network)] });
    await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
    eq(providerCalls[0]?.body.network_id, id, `${network}`);
  }
});

Deno.test("a provider-confirmed failure refunds; the refund is verified before reporting it", async () => {
  await setup({ wallet_transactions: [{ reference: "REFUND-BW-tx1-1", status: "successful", amount: 500 }] });
  setProviderReply(() => new Response(JSON.stringify({ status: false, data: { msg: "Insufficient provider balance" } }), { status: 200 }));
  const r = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
  eq([r.json.success, r.json.status], [false, "failed"], "reported as failed");
  eq(rpcs("finalize_vtu_transaction").map((c) => c.args.p_provider_status), ["failed"], "finalised once, as failed");
});

Deno.test("a confirmed failure whose refund cannot be verified is reported as an error, never as a clean failure", async () => {
  await setup(); // no refund row in the wallet ledger
  setProviderReply(() => new Response(JSON.stringify({ status: false, data: { msg: "Rejected" } }), { status: 200 }));
  const r = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
  assert(r.status === 400 && /refund could not be verified/.test(r.json.error), `got ${r.status} ${JSON.stringify(r.json)}`);
});

Deno.test("an unknown outcome stays pending for requery and is never refunded or resent", async () => {
  await setup();
  setProviderReply(() => { throw new Error("network down"); });
  const r = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
  eq([r.json.success, r.json.status, r.json.requires_requery], [false, "pending", true], "pending for requery");
  eq(providerCalls.length, 1, "one attempt only");
  eq(rpcs("finalize_vtu_transaction").length, 0, "nothing finalised or refunded on an unknown outcome");
});

Deno.test("guards: a finished, already-referenced or locked transaction is never sent to the provider", async () => {
  await setup({ transactions: [airtimeTx("MTN", { status: "successful" })] });
  const done = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
  eq([done.json.already_finalized, providerCalls.length], [true, 0], "already successful");
  await setup({ transactions: [airtimeTx("MTN", { provider_reference: "SME-OLD" })] });
  const ref = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
  eq([ref.json.requires_requery, providerCalls.length], [true, 0], "already has a provider reference");
  await setup();
  db.rpcHandlers["claim_vtu_transaction"] = () => ({ data: { claimed: false }, error: null });
  const locked = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
  eq([locked.json.locked, providerCalls.length], [true, 0], "claimed elsewhere");
  await setup();
  const anon = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" }, "not-a-valid-token");
  eq([anon.status, providerCalls.length], [400, 0], "unauthenticated caller refused");
});

Deno.test("with no enabled airtime route the transaction is not sent anywhere", async () => {
  await setup({ provider_services: [{ id: "ps1", provider_id: "prov-1", service_type: "airtime", enabled: false, priority: 1, metadata: {}, api_providers: provider }] });
  const r = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
  eq([r.status, providerCalls.length], [400, 0], "refused, provider untouched");
  assert(/No active provider/.test(r.json.error), `error: ${r.json.error}`);
});

Deno.test("data purchases (plan mappings) still work as before", async () => {
  const mapping = { id: "m1", product_id: "p-mtn-sme-1gb", provider_id: "prov-1", endpoint_id: "e-data", provider_plan_id: "424", provider_plan_name: "MTN 1GB", provider_cost: 349.7,
    provider_status: "active", priority: 1, metadata: {}, failure_count: 0, cooldown_until: null, active: true, api_providers: provider };
  await setup({ transactions: [{ ...airtimeTx("MTN"), product_id: "p-mtn-sme-1gb", service_type: "data", amount: 430, customer_input: { phone: PHONE } }], provider_plan_mappings: [mapping] });
  const r = await callProviderExecution({ action: "execute_purchase", transaction_id: "tx1" });
  eq([r.json.success, r.json.status], [true, "successful"], "data purchase result");
  eq([providerCalls[0]?.url, providerCalls[0]?.body.plan_id, providerCalls[0]?.body.network_id], ["https://smeplug.ng/api/v1/data/purchase", "424", "1"], "data request unchanged");
});
