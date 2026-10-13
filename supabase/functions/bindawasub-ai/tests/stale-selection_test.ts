// A stale plan list must not answer "Cancel", and a purchase must close the list that led to it. Mock-only.
import { boot, send, db, purchaseRpcs, mockPurchaseRpc } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const minutesAgo = (n: number) => new Date(Date.now() - n * 60000).toISOString();
const selection = (ageMin: number) => ({ size_mb: 1024, product_ids: ["p-mtn-sme-1gb"], phone: "08067436727", created_at: minutesAgo(ageMin) });
const conversation = (ageMin: number) => ({ id: "c1", user_id: "user-1", channel: "web", status: "active", language: "english", last_message_at: minutesAgo(0),
  conversation_context: { service_type: "data", pending_selection: selection(ageMin) }, pending_product_id: null });
const fundingReply = { id: "m1", conversation_id: "c1", role: "assistant", message: "…", intent: "fund_wallet", tool_called: "backend", created_at: minutesAgo(1) };
const fundingRequest = { id: "r1", user_id: "user-1", reference: "MFR-X", amount: 500, status: "pending", payment_reference: null, created_at: minutesAgo(1) };

Deno.test("a plan list from hours ago does not answer 'Cancel'; the funding request is cancelled instead", async () => {
  await boot(honestModel, { ai_conversations: [conversation(160)], ai_messages: [fundingReply], manual_funding_requests: [fundingRequest] } as any);
  const r = await send({ message: "Cancel", conversation_id: "c1" });
  assert(!/cancelled that request/i.test(r.json.answer), `stale list answered: ${r.json.answer}`);
  assert(/MFR-X/.test(r.json.answer) && /cancelled/.test(r.json.answer), `answer: ${r.json.answer}`);
  eq(db.tables.manual_funding_requests[0].status, "cancelled", "the funding request is really cancelled");
  eq(db.tables.ai_conversations[0].conversation_context.pending_selection ?? null, null, "the stale list is gone");
});

Deno.test("a fresh plan list still handles its own 'Cancel'", async () => {
  await boot(honestModel, { ai_conversations: [conversation(2)], ai_messages: [fundingReply], manual_funding_requests: [fundingRequest] } as any);
  const r = await send({ message: "Cancel", conversation_id: "c1" });
  assert(/cancelled that request/i.test(r.json.answer), `fresh list cancel: ${r.json.answer}`);
  eq(db.tables.manual_funding_requests[0].status, "pending", "funding request untouched while a plan list is open");
});

Deno.test("a purchase closes the plan list that led to it", async () => {
  await boot(honestModel, { ai_conversations: [conversation(1)] } as any);
  mockPurchaseRpc();
  await send({ action: "purchase", product_id: "p-mtn-sme-1gb", phone_number: "08067436727", reference: "BW-1", conversation_id: "c1" });
  eq(purchaseRpcs().length, 1, "the purchase itself still runs once");
  eq(db.tables.ai_conversations[0].conversation_context.pending_selection ?? null, null, "plan list closed by the purchase");
});
