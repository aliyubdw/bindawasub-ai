// The saved assistant reply must be exactly what the customer received, on every route.
import { boot, send, db } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";
import type { ModelFn } from "./harness/harness.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const assistantMessages = () => db.tables.ai_messages.filter((m) => m.role === "assistant");
const PHONE = "08067436727";

Deno.test("a greeting is saved (it used to be dropped)", async () => {
  await boot(honestModel);
  const r = await send({ message: "hi" });
  eq(assistantMessages().map((m) => m.message), [r.json.answer], "greeting saved exactly once");
});

Deno.test("a backend-routed reply is saved once, not twice", async () => {
  await boot(honestModel);
  const r = await send({ message: `Buy 1GB for ${PHONE}` });
  eq(assistantMessages().length, 1, "one saved reply");
  eq(assistantMessages()[0].message, r.json.answer, "saved reply equals what the customer received");
});

Deno.test("Gemini's draft is never saved when the backend writes the real answer", async () => {
  const draftModel: ModelFn = (m) => /mtn sme plan/i.test(m)
    ? { intent: "purchase_intent", service_type: "data", network: "mtn", product_id: "p-mtn-sme-1gb", phone_number: PHONE,
        customer_input: { phone: PHONE }, reply: "DRAFT: you will get 50GB free" }
    : { intent: "unknown" };
  await boot(draftModel);
  const r = await send({ message: "I want the MTN SME plan" });
  const saved = assistantMessages().map((m) => m.message);
  assert(!saved.some((m) => m.includes("DRAFT")), `Gemini draft was saved: ${JSON.stringify(saved)}`);
  assert(saved.includes(r.json.answer), "the reply the customer received is what was saved");
});

Deno.test("a plain Gemini answer is saved once and marked as Gemini", async () => {
  const chat: ModelFn = () => ({ intent: "other", reply: "Happy to help with data, airtime and bills." });
  await boot(chat);
  const r = await send({ message: "what can you do" });
  eq(assistantMessages().length, 1, "saved once");
  eq([assistantMessages()[0].message, assistantMessages()[0].tool_called], [r.json.answer, "gemini"], "text and route");
});

Deno.test("errors and rejected requests do not save an assistant reply", async () => {
  await boot(honestModel);
  const bad = await send({ message: "hi" }, { token: "expired" });
  eq(bad.status, 401, "rejected");
  eq(assistantMessages().length, 0, "nothing saved for a rejected request");
});

Deno.test("an action this function no longer handles returns a JSON error, not nothing", async () => {
  await boot(honestModel);
  const r = await send({ action: "fund_wallet" });
  eq([r.status, r.json.success], [400, false], "clear error instead of a failed request");
});
