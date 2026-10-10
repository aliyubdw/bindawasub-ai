// Mock-only Telegram end-to-end tests: webhook -> real bindawasub-ai handler (in-process)
// -> fake Supabase. Telegram API calls are captured, never sent. No real purchases.
import { bootTelegram, tgSend, tgState, db, purchaseRpcs, externalCalls } from "./harness/harness.ts";
import { hallucinatingModel } from "./harness/models.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const PHONE = "08067436727";

Deno.test("Telegram: 'Buy 1GB for number' lists every eligible plan, no purchase", async () => {
  await bootTelegram(hallucinatingModel);
  const r = await tgSend(`Buy 1GB for ${PHONE}`);
  const text = r.texts.join("\n");
  eq(tgState().state, "awaiting_natural_language_product_selection", "waits for a plan choice");
  eq(tgState().context.products.length, 4, "four options stored");
  for (const expected of ["MTN • SME Data • 1 week", "Airtel • Gifting • 1 day", "Airtel • SME Data • 7 days", "Airtel • Social data • 3 days", "₦430", "₦550", "₦800", "₦350"]) {
    assert(text.includes(expected), `list shows "${expected}"`);
  }
  assert(!/about to buy/i.test(text), "no Gemini confirmation wording");
  eq(purchaseRpcs().length, 0, "no purchase");
});

Deno.test("Telegram: choose -> summary -> explicit confirm -> exactly one purchase; duplicate confirm ignored", async () => {
  await bootTelegram(hallucinatingModel);
  await tgSend(`Buy 1GB for ${PHONE}`);
  const options = tgState().context.products;
  const index = options.findIndex((p: any) => p.id === "p-mtn-sme-1gb") + 1;
  const pick = await tgSend(String(index));
  eq(tgState().state, "awaiting_data_confirmation", "summary awaiting confirmation");
  const summary = pick.texts.join("\n");
  for (const expected of ["Network: MTN", "Data type: SME Data", "Plan: 1 GB", "Validity: 1 week", "Price: ₦430", "0806****727"]) {
    assert(summary.includes(expected), `summary shows "${expected}"`);
  }
  eq(purchaseRpcs().length, 0, "choosing a plan never purchases");
  await tgSend("✅ Confirm Purchase");
  eq(purchaseRpcs().length, 1, "exactly one purchase after explicit confirmation");
  const call = purchaseRpcs()[0].args;
  eq([call.p_product_id, call.p_customer_input.phone], ["p-mtn-sme-1gb", PHONE], "confirmed plan and number");
  assert(/^TG-user-1-/.test(call.p_idempotency_key), "per-confirmation idempotency key");
  await tgSend("✅ Confirm Purchase");
  eq(purchaseRpcs().length, 1, "second confirm cannot buy again");
  eq(externalCalls.filter((c) => c.url.includes("smeplug")).length, 0, "no direct provider call");
});

Deno.test("Telegram: cancellation at either stage never purchases", async () => {
  await bootTelegram(hallucinatingModel);
  await tgSend(`Buy 1GB for ${PHONE}`);
  await tgSend("❌ Cancel");
  eq(tgState().state, "idle", "cancelled at list");
  await tgSend("✅ Confirm Purchase");
  await tgSend(`Buy 1GB for ${PHONE}`);
  await tgSend("1");
  eq(tgState().state, "awaiting_data_confirmation", "at confirmation");
  await tgSend("❌ Cancel");
  eq(tgState().state, "idle", "cancelled at confirmation");
  await tgSend("✅ Confirm Purchase");
  eq(purchaseRpcs().length, 0, "nothing was bought");
});

Deno.test("Telegram: explicit network shows only that network; invalid choice re-prompts; no recipient asks for one", async () => {
  await bootTelegram(hallucinatingModel);
  await tgSend(`buy 1gb airtel for ${PHONE}`);
  eq(tgState().context.products.map((p: any) => p.network_name), ["Airtel", "Airtel", "Airtel"], "Airtel only");
  const bad = await tgSend("9");
  assert(/valid plan number/i.test(bad.texts.join(" ")), "re-prompts");
  eq(tgState().state, "awaiting_natural_language_product_selection", "still waiting");
  await bootTelegram(hallucinatingModel);
  await tgSend("buy 1GB");
  const pick = await tgSend("1");
  eq(tgState().state, "awaiting_data_recipient", "asks who receives it");
  assert(/Data type:/.test(pick.texts.join("\n")), "shows data type while asking");
  eq(purchaseRpcs().length, 0, "no purchase");
});

Deno.test("Telegram: a single matching plan is still shown for the customer to choose", async () => {
  await bootTelegram(hallucinatingModel);
  await tgSend(`buy 5GB for ${PHONE}`);
  eq(tgState().state, "awaiting_natural_language_product_selection", "single plan still needs a choice");
  eq(tgState().context.products.length, 1, "one plan");
  eq(purchaseRpcs().length, 0, "no purchase");
});
