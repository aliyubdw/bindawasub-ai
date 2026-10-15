// A message about airtime must never be answered with data plans. Mock-only.
import { boot, send, geminiCalls, purchaseRpcs } from "./harness/harness.ts";
import type { ModelFn } from "./harness/harness.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const PHONE = "08011112222";
const airtimeNets = { service_networks: [
  { id: "a1", service_id: "svc-airtime", code: "MTN", name: "MTN", active: true },
  { id: "a2", service_id: "svc-airtime", code: "AIRTEL", name: "Airtel", active: true } ] };
// Gemini recognises airtime (as it does in production); the backend must not intercept first.
const airtimeModel: ModelFn = (m) => /airtime|recharge|talktime/i.test(m)
  ? { intent: "airtime_purchase", service_type: "airtime", network: /airtel/i.test(m) ? "airtel" : "mtn", amount: 500, phone_number: null }
  : { intent: "unknown" };

const PHRASES = ["airtime 500 mtn", "MTN airtime 500", "mtn 500 airtime", "Recharge 500 on MTN", "recharge mtn 500", "Buy MTN airtime", "Airtel airtime 500", "mtn talktime 500", "500 mtn airtime please"];

Deno.test("airtime requests that name a network are not answered with data plans", async () => {
  const wrong: string[] = [];
  for (const phrase of PHRASES) {
    await boot(airtimeModel, airtimeNets as any);
    const r = await send({ message: phrase });
    const answer = String(r.json.answer || "");
    if (/data plans/i.test(answer) || (Array.isArray(r.json.products) && r.json.products.length)) wrong.push(`${phrase} → ${answer.slice(0, 70)}`);
    if (geminiCalls.length === 0) wrong.push(`${phrase} → request never reached the airtime flow`);
    if (purchaseRpcs().length) wrong.push(`${phrase} → a purchase ran`);
  }
  assert(wrong.length === 0, "wrong answers:\n  " + wrong.join("\n  "));
});

Deno.test("genuine data-plan questions and data purchases are unaffected", async () => {
  await boot(airtimeModel, airtimeNets as any);
  const plans = await send({ message: "Show MTN data plans" });
  assert(/data plans/i.test(plans.json.answer) || (plans.json.products || []).length > 0, `plans: ${plans.json.answer}`);
  await boot(airtimeModel, airtimeNets as any);
  const data = await send({ message: `Buy 1GB MTN for ${PHONE}` });
  assert((data.json.products || []).length > 0, "data purchase list unaffected");
});
