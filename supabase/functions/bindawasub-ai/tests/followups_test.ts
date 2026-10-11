// Mock-only tests for the follow-up fixes: web receipt text, dormant airtime/bill routing,
// CORS headers on authentication failures, and the Telegram amount / option parsers.
import { boot, bootTelegram, send, tgSend, tgState, db, purchaseRpcs, mockPurchaseRpc } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";
import type { ModelFn } from "./harness/harness.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const PHONE = "08067436727";

const airtimeConversation = () => ({
  id: "c-air", user_id: "user-1", channel: "web", status: "active", language: "english",
  last_message_at: new Date().toISOString(),
  conversation_context: { service_type: "airtime", network: "mtn", airtime_amount: 500, last_intent: "airtime_purchase" },
  pending_product_id: null, pending_phone_number: null, pending_at: null, pending_service_type: null,
  pending_airtime_amount: null, pending_network: null, pending_idempotency_key: null, pending_customer_input: {},
});

Deno.test("web receipts use real line breaks, never a literal backslash-n", async () => {
  const source = await Deno.readTextFile(new URL("../purchase/handler.ts", import.meta.url));
  assert(!/\\\\n/.test(source), "no escaped backslash-n left in purchase/handler.ts");
});

Deno.test("auth failures carry CORS headers so browsers see a 401, not 'Failed to fetch'", async () => {
  await boot(honestModel);
  const res = await (async () => {
    const out = await send({ message: "hi" }, { token: "expired-token" });
    return out;
  })();
  eq(res.status, 401, "still rejected");
  // send() hides headers, so call the handler path directly through a fresh request
  const { authenticateRequest } = await import("../auth/authenticate.ts");
  const noToken = await authenticateRequest(new Request("https://x.test"), { auth: { getUser: () => ({ data: { user: null }, error: {} }) } }, false, { "Access-Control-Allow-Origin": "*" });
  assert(noToken instanceof Response && noToken.headers.get("Access-Control-Allow-Origin") === "*", "missing-token 401 has CORS");
  const bad = await authenticateRequest(new Request("https://x.test", { headers: { Authorization: "Bearer nope" } }), { auth: { getUser: () => ({ data: { user: null }, error: {} }) } }, false, { "Access-Control-Allow-Origin": "*" });
  assert(bad instanceof Response && bad.headers.get("Access-Control-Allow-Origin") === "*", "expired-token 401 has CORS");
});

Deno.test("airtime follow-up accepts a number written with spaces or hyphens", async () => {
  await boot(honestModel, { ai_conversations: [airtimeConversation()] });
  const r = await send({ message: "0806 743-6727", conversation_id: "c-air" });
  eq(r.json.requires_confirmation, true, "asks for confirmation");
  eq(db.tables.ai_conversations[0].pending_phone_number, PHONE, "number normalised");
  eq(purchaseRpcs().length, 0, "nothing bought yet");
});

Deno.test("a message about data inside an airtime conversation is not forced into airtime", async () => {
  const model: ModelFn = () => ({ intent: "product_enquiry", service_type: "data", reply: "Here are data plans." });
  await boot(model, { ai_conversations: [airtimeConversation()] });
  const r = await send({ message: "show me data plans", conversation_id: "c-air" });
  assert(r.json.intent !== "airtime_purchase", `intent was ${r.json.intent}`);
});

Deno.test("explicit airtime request names the network from the message, not from the model", async () => {
  const wrongNetwork: ModelFn = () => ({ intent: "airtime_purchase", service_type: "airtime", network: "mtn", amount: 500, phone_number: PHONE });
  await boot(wrongNetwork, { service_networks: [
    { id: "an1", service_id: "svc-airtime", code: "MTN", name: "MTN", active: true },
    { id: "an2", service_id: "svc-airtime", code: "AIRTEL", name: "Airtel", active: true },
  ] });
  const r = await send({ message: `buy 500 airtime airtel for ${PHONE}` });
  const text = JSON.stringify(r.json).toLowerCase();
  assert(text.includes("airtel") && !text.includes("mtn"), `expected Airtel, got ${text.slice(0, 200)}`);
  eq(purchaseRpcs().length, 0, "nothing bought");
});

Deno.test("bill selector message routes to the chosen bill service by its code", async () => {
  await boot(honestModel, {
    service_definitions: [
      { id: "svc-data", code: "data", name: "Data", description: "", category: "telecom", metadata: {}, active: true },
      { id: "svc-dstv", code: "dstv", name: "DStv", description: "", category: "bills", metadata: {}, active: true },
    ],
    service_fields: [{ service_id: "svc-dstv", field_key: "smartcard", label: "Smartcard number", data_type: "text", required: true, sensitive: false, validation: {}, display_order: 1, metadata: {}, active: true }],
  });
  const r = await send({ message: "Pay for DStv (dstv)" });
  assert(/You selected DStv\. Please provide: Smartcard number/.test(r.json.answer), `answer was ${r.json.answer}`);
});

Deno.test("Telegram: amount with a currency prefix and commas is accepted", async () => {
  await bootTelegram(honestModel);
  db.tables.telegram_conversation_states.push({ id: "s1", telegram_user_id: 111, chat_id: 111, state: "awaiting_funding_amount", context: {}, updated_at: new Date().toISOString() });
  const r = await tgSend("₦5,000");
  assert(!/valid amount/i.test(r.texts.join(" ")), `rejected a valid amount: ${r.texts.join(" | ")}`);
  void tgState; void mockPurchaseRpc;
});
