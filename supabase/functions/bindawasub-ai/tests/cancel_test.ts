// "Cancel" must only claim what actually happened. Mock-only.
import { boot, send, db, geminiCalls, purchaseRpcs } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";
import { isExplicitCancel } from "../account/cancel-handler.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const minutesAgo = (n: number) => new Date(Date.now() - n * 60000).toISOString();
const conversation = () => ({ id: "c1", user_id: "user-1", channel: "web", status: "active", language: "english", last_message_at: minutesAgo(0),
  conversation_context: { service_type: "airtime", network: "mtn", phone_number: "08011112222" }, pending_product_id: null });
const assistantReply = (intent: string, ago = 1) => ({ id: "m1", conversation_id: "c1", role: "assistant", message: "…", intent, tool_called: "backend", created_at: minutesAgo(ago) });
const request = (id: string, ref: string, amount: number, extra: Record<string, unknown> = {}) =>
  ({ id, user_id: "user-1", reference: ref, amount, status: "pending", payment_reference: null, created_at: minutesAgo(2), ...extra });

const run = (extra: Record<string, unknown[]>) => boot(honestModel, { ai_conversations: [conversation()], ...extra } as any);
const cancel = (message = "Cancel") => send({ message, conversation_id: "c1" });
const status = (id: string) => db.tables.manual_funding_requests.find((r: any) => r.id === id)?.status;

Deno.test("cancel right after a funding reply really cancels the customer's latest pending request", async () => {
  await run({ ai_messages: [assistantReply("fund_wallet")], manual_funding_requests: [request("r1", "MFR-A", 500, { created_at: minutesAgo(4) }), request("r2", "MFR-B", 1000)] });
  const r = await cancel();
  eq([status("r2"), status("r1")], ["cancelled", "pending"], "only the latest request is cancelled");
  assert(/MFR-B/.test(r.json.answer) && /1,000/.test(r.json.answer) && /cancelled/.test(r.json.answer), `answer: ${r.json.answer}`);
  assert(/1 other pending funding request/.test(r.json.answer), `the other pending request is mentioned: ${r.json.answer}`);
  assert(/No money was added/.test(r.json.answer), "says no money moved");
  eq(geminiCalls.length, 0, "Gemini is not consulted");
  eq(purchaseRpcs().length, 0, "no purchase or wallet RPC");
});

Deno.test("cancel never touches a submitted, old, or someone else's request", async () => {
  await run({ ai_messages: [assistantReply("fund_wallet")], manual_funding_requests: [
    request("submitted", "MFR-S", 300, { payment_reference: "BANK-REF-1", status: "pending" }),
    request("old", "MFR-O", 400, { created_at: minutesAgo(45) }),
    request("theirs", "MFR-T", 600, { user_id: "someone-else" }),
  ] });
  const r = await cancel();
  eq([status("submitted"), status("old"), status("theirs")], ["pending", "pending", "pending"], "nothing was cancelled");
  assert(/nothing was pending/i.test(r.json.answer) && !/MFR-/.test(r.json.answer), `honest answer: ${r.json.answer}`);
});

Deno.test("cancel when the last reply was not about funding leaves funding requests alone and says so honestly", async () => {
  await run({ ai_messages: [assistantReply("transaction_history")], manual_funding_requests: [request("r1", "MFR-A", 500)] });
  const r = await cancel("cancel it");
  eq(status("r1"), "pending", "funding request untouched");
  assert(/nothing was pending/i.test(r.json.answer) && !/transaction cancelled/i.test(r.json.answer), `answer: ${r.json.answer}`);
  eq(db.tables.ai_conversations[0].conversation_context.service_type, null, "the open flow is cleared");
});

Deno.test("a bare 'no' or 'stop' never cancels a funding request", async () => {
  for (const word of ["No", "stop", "Nope"]) {
    await run({ ai_messages: [assistantReply("fund_wallet")], manual_funding_requests: [request("r1", "MFR-A", 500)] });
    await cancel(word);
    eq(status("r1"), "pending", `'${word}' must not cancel`);
  }
});

Deno.test("explicit cancel phrases are recognised; other messages are not", () => {
  for (const m of ["Cancel", "cancel", "Cancel it", "cancel the funding request", "Cancel please!", "cancel my request"]) assert(isExplicitCancel(m), `should match: ${m}`);
  for (const m of ["No", "stop", "cancel my order for 2gb", "Can I cancel later?", "don't cancel", "buy 1gb", "cancelled?"]) assert(!isExplicitCancel(m), `must not match: ${m}`);
});

Deno.test("an open data plan list keeps its own cancel handling", async () => {
  await boot(honestModel);
  await send({ message: "Buy 1GB for 08067436727" });
  const r = await send({ message: "cancel" });
  assert(/cancelled that request/i.test(r.json.answer), `plan-list cancel unchanged: ${r.json.answer}`);
});
