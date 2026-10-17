// With airtime switched off, every way into an airtime purchase gets one clear answer and no wallet is debited.
// Also: the button text "❌ Cancel" is a cancel. Mock-only.
import { boot, send, db, geminiCalls, purchaseRpcs, mockPurchaseRpc } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";
import type { ModelFn } from "./harness/harness.ts";
import { classifyConfirmation } from "../purchase/request.ts";
import { AIRTIME_UNAVAILABLE_ANSWER } from "../airtime/availability.ts";
import { seed } from "./harness/fixtures.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const PHONE = "08011112222";
const now = () => new Date().toISOString();
const airtimeModel: ModelFn = (m) => /airtime|recharge/i.test(m)
  ? { intent: "airtime_purchase", service_type: "airtime", network: "mtn", amount: 500, phone_number: PHONE } : { intent: "unknown" };
const conv = (ctx: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: "c1", user_id: "user-1", channel: "web", status: "active", language: "english", last_message_at: now(), conversation_context: ctx, pending_product_id: null, ...extra });
const defs = (airtimeActive: boolean) => seed().service_definitions.map((d: any) => d.code === "airtime" ? { ...d, active: airtimeActive } : d);
const off = (extra: Record<string, unknown> = {}) => ({ service_definitions: defs(false), ...extra });

const ENTRY_POINTS: [string, Record<string, unknown>, Record<string, unknown>][] = [
  ["typed request with a number", { message: `Buy 500 airtime for ${PHONE}` }, {}],
  ["typed request naming a network", { message: "MTN airtime 500" }, {}],
  ["recharge wording", { message: "Recharge 500 on MTN" }, {}],
  ["the Airtime button", { message: "Airtime on MTN", action: "start_airtime" }, {}],
  ["a direct airtime action", { action: "airtime_purchase", network: "mtn", amount: 500, phone_number: PHONE }, {}],
  ["a follow-up number in an airtime chat", { message: PHONE, conversation_id: "c1" },
    { ai_conversations: [conv({ service_type: "airtime", network: "mtn", airtime_amount: 500, last_intent: "airtime_purchase" })] }],
  ["YES to a pending airtime confirmation", { message: "Yes", conversation_id: "c1" },
    { ai_conversations: [conv({ service_type: "airtime" }, { pending_airtime_amount: 500, pending_network: "mtn", pending_phone_number: PHONE, pending_service_type: "airtime", pending_at: now(), pending_idempotency_key: "k1", pending_customer_input: { phone: PHONE, amount: 500, network: "MTN" } })] }],
];

Deno.test("airtime switched off: every entry point answers once, clearly, and takes no money", async () => {
  for (const [label, payload, extra] of ENTRY_POINTS) {
    await boot(airtimeModel, off(extra) as any); mockPurchaseRpc();
    const r = await send(payload);
    eq([r.status, r.json.intent, r.json.answer], [200, "airtime_unavailable", AIRTIME_UNAVAILABLE_ANSWER], `${label}`);
    eq(purchaseRpcs().length, 0, `${label}: no wallet or purchase RPC`);
    eq(geminiCalls.length, 0, `${label}: Gemini not consulted`);
    const c = db.tables.ai_conversations[0];
    if (c) eq([c.pending_airtime_amount ?? null, c.conversation_context?.service_type ?? null], [null, null], `${label}: nothing left open`);
  }
});

Deno.test("airtime networks all inactive counts as off too", async () => {
  await boot(airtimeModel, { service_networks: seed().service_networks.map((n: any) => ({ ...n, active: false })) } as any);
  const r = await send({ message: `Buy 500 airtime for ${PHONE}` });
  eq(r.json.intent, "airtime_unavailable", "no active airtime network");
});

Deno.test("airtime on: nothing changes", async () => {
  await boot(airtimeModel);
  const r = await send({ message: `Buy 500 airtime for ${PHONE}` });
  assert(r.json.intent !== "airtime_unavailable", `airtime wrongly blocked: ${r.json.answer}`);
  assert(/airtime/i.test(r.json.answer) && r.json.answer.includes(PHONE), `confirmation expected: ${r.json.answer}`);
});

Deno.test("airtime off: data, wallet and pending data purchases are untouched", async () => {
  await boot(honestModel, off() as any); mockPurchaseRpc();
  const list = await send({ message: `Buy 1GB for ${PHONE}` });
  assert((list.json.products || []).length > 0, "data plan list still works");
  await boot(honestModel, off({ ai_conversations: [conv({ service_type: "data" }, { pending_product_id: "p-mtn-sme-1gb", pending_phone_number: PHONE, pending_at: now(), pending_service_type: "data", pending_idempotency_key: "AI-c1-1", pending_customer_input: { phone: PHONE } })] }) as any); mockPurchaseRpc();
  await send({ message: "Yes", conversation_id: "c1" });
  eq(purchaseRpcs().length, 1, "a pending DATA purchase still completes on YES");
});

Deno.test("the button text '❌ Cancel' is a cancel, and forgets the open plan list and the remembered number", async () => {
  eq(classifyConfirmation("❌ Cancel"), "cancel", "emoji cancel");
  eq(classifyConfirmation("✅ Yes"), "confirm", "emoji confirm");
  eq(classifyConfirmation("❌ buy 2gb"), null, "an emoji does not turn a request into a cancel");
  await boot(honestModel);
  await send({ message: PHONE });
  await send({ message: "Buy 1GB" });
  const r = await send({ message: "❌ Cancel" });
  assert(/cancelled that request/i.test(r.json.answer), `reply: ${r.json.answer}`);
  eq(db.tables.ai_conversations[0].conversation_context.typed_phone ?? null, null, "remembered number forgotten");
  eq(db.tables.ai_conversations[0].conversation_context.pending_selection ?? null, null, "plan list closed");
});
