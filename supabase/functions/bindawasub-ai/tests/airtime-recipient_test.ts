// Airtime recipients come only from the current message or a saved contact, never from
// Gemini or from earlier turns such as a data purchase. Mock-only.
import { boot, send, db, purchaseRpcs } from "./harness/harness.ts";
import type { ModelFn } from "./harness/harness.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const PHONE = "08067436727";
const INFERRED = "08099999999";

// Simulates Gemini filling the recipient from earlier chat (the behaviour seen in production).
// A bare number during an airtime chat is also answered as airtime, as the real model does from history.
const inferringModel: ModelFn = (m) => /airtime|recharge|^\s*0\d{10}\s*$/i.test(m)
  ? { intent: "airtime_purchase", service_type: "airtime", network: "mtn", amount: 500, phone_number: INFERRED }
  : { intent: "unknown" };
const networks = { service_networks: [{ id: "an1", service_id: "svc-airtime", code: "MTN", name: "MTN", active: true }] };

Deno.test("a fresh airtime request after a data purchase asks for the number instead of reusing one", async () => {
  await boot(inferringModel, networks);
  await send({ message: `Buy 1GB for ${PHONE}` });
  const r = await send({ message: "Buy 500 airtime" });
  assert(/recipient phone number/i.test(r.json.answer), `expected a request for the number, got: ${r.json.answer}`);
  assert(!r.json.answer.includes(INFERRED) && !r.json.answer.includes(PHONE), "no number invented or reused");
  eq(db.tables.ai_conversations[0].pending_phone_number ?? null, null, "nothing pending");
  eq(purchaseRpcs().length, 0, "no purchase");
});

Deno.test("a number written in the message is used; the model's guess is ignored", async () => {
  await boot(inferringModel, networks);
  const r = await send({ message: `Buy 500 airtime for ${PHONE}` });
  assert(r.json.answer.includes(PHONE) && !r.json.answer.includes(INFERRED), `got: ${r.json.answer}`);
  eq(db.tables.ai_conversations[0].pending_phone_number, PHONE, "pending recipient is the typed number");
});

Deno.test("a saved contact named in the message is used", async () => {
  await boot(inferringModel, networks);
  const r = await send({ message: "Buy 500 airtime for Mom" });
  assert(r.json.answer.includes("08031234567") && !r.json.answer.includes(INFERRED), `got: ${r.json.answer}`);
});

Deno.test("a differently worded airtime request is covered too", async () => {
  await boot(inferringModel, networks);
  await send({ message: `Buy 1GB for ${PHONE}` });
  const r = await send({ message: "recharge 500" });
  assert(!r.json.answer.includes(INFERRED) && !r.json.answer.includes(PHONE), `reused a number: ${r.json.answer}`);
  eq(db.tables.ai_conversations[0].pending_phone_number ?? null, null, "nothing pending");
});

Deno.test("airtime flow still completes: ask, then the number, then confirmation", async () => {
  await boot(inferringModel, networks);
  await send({ message: "Buy 500 airtime" });
  const r = await send({ message: PHONE });
  assert(r.json.answer.includes(PHONE) && /confirm/i.test(r.json.answer), `got: ${r.json.answer}`);
  eq(db.tables.ai_conversations[0].pending_phone_number, PHONE, "recipient is the number just typed");
  eq(purchaseRpcs().length, 0, "still nothing bought");
});
