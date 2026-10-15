// The number a customer types is remembered for 10 minutes, shown in every confirmation, and forgotten on cancel.
// A price question never starts a purchase. Mock-only.
import { boot, send, db, geminiCalls, purchaseRpcs } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";
import type { ModelFn } from "./harness/harness.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const PHONE = "08011112222";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60000).toISOString();
const ctxOf = () => db.tables.ai_conversations[0]?.conversation_context ?? {};
const airtimeNets = { service_networks: [{ id: "a1", service_id: "svc-airtime", code: "MTN", name: "MTN", active: true }] };
const inferring: ModelFn = (m) => /airtime/i.test(m)
  ? { intent: "airtime_purchase", service_type: "airtime", network: "mtn", amount: 500, phone_number: "08099999999" } : { intent: "unknown" };

Deno.test("a number sent alone is remembered and the reply says so", async () => {
  await boot(honestModel);
  const r = await send({ message: PHONE });
  assert(/next 10 minutes/.test(r.json.answer) && r.json.answer.includes(PHONE), `reply: ${r.json.answer}`);
  eq(ctxOf().typed_phone?.phone, PHONE, "stored");
  eq(geminiCalls.length, 0, "Gemini not consulted");
});

Deno.test("the next data request needs no number: plans are listed for it and the confirmation shows it", async () => {
  await boot(honestModel);
  await send({ message: PHONE });
  const list = await send({ message: "Buy 1GB" });
  eq(list.json.phone_number, PHONE, "list is for the remembered number");
  assert(list.json.answer.includes(`Using ${PHONE}, the number you sent`), `says where the number came from: ${list.json.answer}`);
  const pick = await send({ message: "mtn" });
  eq(pick.json.requires_confirmation, true, "summary asks for confirmation");
  assert(pick.json.answer.includes(PHONE), `the confirmation shows the number: ${pick.json.answer}`);
  eq(purchaseRpcs().length, 0, "nothing bought without YES");
});

Deno.test("the next airtime request needs no number either, and the model's guess is ignored", async () => {
  await boot(inferring, airtimeNets as any);
  await send({ message: PHONE });
  const r = await send({ message: "Buy 500 airtime" });
  assert(r.json.answer.includes(PHONE) && !r.json.answer.includes("08099999999"), `confirmation: ${r.json.answer}`);
  eq(purchaseRpcs().length, 0, "nothing bought without YES");
});

Deno.test("an expired number is not used", async () => {
  await boot(honestModel, { ai_conversations: [{ id: "c1", user_id: "user-1", channel: "web", status: "active", language: "english", last_message_at: minutesAgo(0),
    conversation_context: { typed_phone: { phone: PHONE, at: minutesAgo(11) } }, pending_product_id: null }] } as any);
  const r = await send({ message: "Buy 1GB", conversation_id: "c1" });
  eq(r.json.missing_fields, ["phone"], "asks for the number again after 10 minutes");
  assert(r.json.phone_number == null, "no number is assumed");
});

Deno.test("a number or contact in the new message always wins over the remembered one", async () => {
  await boot(honestModel);
  await send({ message: PHONE });
  const typed = await send({ message: "Buy 1GB for 08033334444" });
  eq(typed.json.phone_number, "08033334444", "typed number wins");
  const contact = await send({ message: "Buy 1GB for Mom" });
  eq(contact.json.phone_number, "08031234567", "saved contact wins");
});

Deno.test("sending a different number replaces it, and 'Cancel' forgets it", async () => {
  await boot(honestModel);
  await send({ message: PHONE });
  await send({ message: "0803 333 4444" });
  eq(ctxOf().typed_phone?.phone, "08033334444", "replaced");
  await send({ message: "Cancel" });
  eq(ctxOf().typed_phone ?? null, null, "forgotten on cancel");
  const r = await send({ message: "Buy 1GB" });
  eq(r.json.missing_fields, ["phone"], "asks for a number again");
});

Deno.test("a price question never starts a purchase, even if the model calls it one", async () => {
  const misclassify: ModelFn = (m) => /how much again/i.test(m)
    ? { intent: "purchase_intent", service_type: "data", network: "airtel", volume: "2GB", product_id: "p-airtel-gift-2gb", phone_number: PHONE, customer_input: { phone: PHONE }, reply: "" }
    : { intent: "unknown" };
  await boot(misclassify);
  await send({ message: PHONE });
  const r = await send({ message: "how much again for that one" });
  assert(r.json.intent !== "purchase_intent", `price question became a purchase: ${r.json.intent}`);
  assert(!/please confirm this purchase/i.test(r.json.answer), `confirmation opened: ${r.json.answer}`);
  eq(db.tables.ai_conversations[0].pending_product_id ?? null, null, "nothing pending");
});
