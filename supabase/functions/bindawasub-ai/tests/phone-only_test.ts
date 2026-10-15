// A phone number sent alone: ask what it is for, and never interrupt an open request. Mock-only.
import { boot, send, db, geminiCalls, purchaseRpcs } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";
import type { ModelFn } from "./harness/harness.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const PHONE = "08011112222";
const now = () => new Date().toISOString();
const conv = (ctx: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: "c1", user_id: "user-1", channel: "web", status: "active", language: "english", last_message_at: now(), conversation_context: ctx, pending_product_id: null, ...extra });
const withConv = (ctx: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ai_conversations: [conv(ctx, extra)] });

Deno.test("a lone phone number gets a 'what is it for?' prompt from the backend, in any common spelling", async () => {
  for (const typed of [PHONE, "0801 111 2222", "0801-111-2222", "+2348011112222", "2348011112222"]) {
    await boot(honestModel);
    const r = await send({ message: typed });
    eq(r.json.intent, "phone_only", `'${typed}': intent`);
    assert(r.json.answer.includes(PHONE) && /Buy 500 airtime/.test(r.json.answer) && /Buy 1GB/.test(r.json.answer) && /10 minutes/.test(r.json.answer), `'${typed}': ${r.json.answer}`);
    eq(geminiCalls.length, 0, `'${typed}': Gemini not consulted`);
    eq(purchaseRpcs().length, 0, `'${typed}': nothing bought`);
  }
});

// Remembering the number for 10 minutes (and forgetting it on cancel) is covered in remember_test.ts.

Deno.test("a number that is not a valid phone number is called out; other numbers are left alone", async () => {
  await boot(honestModel);
  const bad = await send({ message: "0806743672" });
  eq(bad.json.intent, "phone_invalid", "10 digits is not a phone number");
  for (const other of ["500", "1000", "12345", "585658536"]) {
    await boot(honestModel);
    const r = await send({ message: other });
    assert(r.json.intent !== "phone_only" && r.json.intent !== "phone_invalid", `'${other}' must not be treated as a phone number`);
  }
});

Deno.test("it never interrupts a request that may be waiting for a number", async () => {
  const airtimeNets = { service_networks: [{ id: "a1", service_id: "svc-airtime", code: "MTN", name: "MTN", active: true }] };
  // airtime in progress: the existing follow-up takes the number
  await boot(honestModel, { ...airtimeNets, ...withConv({ service_type: "airtime", network: "mtn", airtime_amount: 500, last_intent: "airtime_purchase" }) } as any);
  const air = await send({ message: PHONE, conversation_id: "c1" });
  assert(air.json.intent !== "phone_only", `airtime flow was interrupted: ${air.json.intent}`);
  assert(/airtime/i.test(air.json.answer) && air.json.answer.includes(PHONE), `airtime confirmation: ${air.json.answer}`);
  // a bill (smartcard / meter numbers look like phone numbers)
  await boot(honestModel, withConv({ service_type: "dstv", last_intent: "service_enquiry" }) as any);
  const bill = await send({ message: "08123456789", conversation_id: "c1" });
  assert(bill.json.intent !== "phone_only", "a bill reference was mistaken for a phone number");
  // a pending purchase waiting for YES
  await boot(honestModel, withConv({ service_type: "data" }, { pending_product_id: "p-mtn-sme-1gb", pending_phone_number: PHONE, pending_at: now(), pending_service_type: "data" }) as any);
  const pend = await send({ message: PHONE, conversation_id: "c1" });
  assert(pend.json.intent !== "phone_only", "a pending purchase was interrupted");
  // an open plan list keeps its own handling
  await boot(honestModel);
  await send({ message: "Buy 1GB" });
  const list = await send({ message: PHONE });
  assert(list.json.intent !== "phone_only" && /choose which plan/i.test(list.json.answer), `plan list flow: ${list.json.answer}`);
});

Deno.test("a lone number still leads somewhere useful with the examples it offers", async () => {
  await boot(honestModel);
  await send({ message: PHONE });
  const next = await send({ message: `Buy 1GB for ${PHONE}` });
  assert(Array.isArray(next.json.products) && next.json.products.length > 0, "the example request works");
  eq(purchaseRpcs().length, 0, "still nothing bought");
});
