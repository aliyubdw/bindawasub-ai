// Mock-only regression tests for natural-language data purchases (web/app chat backend).
// Runs the REAL Edge Function handler against fake Supabase + scripted Gemini. No network,
// no provider calls, no real purchases.
import { boot, send, db, purchaseRpcs, mockPurchaseRpc, geminiCalls, externalCalls } from "./harness/harness.ts";
import { hallucinatingModel, honestModel } from "./harness/models.ts";
import { parseDataSize, productSize } from "../catalog/size.ts";
import { classifyConfirmation, parsePhone } from "../purchase/request.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const label = (p: any) => `${p.network_name}|${p.variant_name}|${p.product_name}|${p.selling_price}`;
const conv = () => db.tables.ai_conversations[0];
const PHONE = "08067436727";

for (const [name, model] of [["hallucinating model", hallucinatingModel], ["honest model", honestModel]] as const) {
  Deno.test(`exact failure: "Buy 1GB for ${PHONE}" lists every eligible network plan (${name})`, async () => {
    await boot(model);
    const r = await send({ message: `Buy 1GB for ${PHONE}` });
    eq(r.json.requires_confirmation, false, "must not ask for confirmation yet");
    eq(r.json.products.map(label).sort(), [
      "Airtel|Gifting|1 GB|550", "Airtel|SME Data|1 GB|800", "Airtel|Social data|1 GB|350", "MTN|SME Data|1 GB|430",
    ].sort(), "all eligible 1GB plans across networks (inactive plan excluded)");
    eq(r.json.phone_number, PHONE, "recipient comes from the message");
    assert(!/about to buy|MTN 1 GB \(SME/i.test(r.json.answer), "Gemini wording must not reach the customer");
    eq(conv().pending_product_id ?? null, null, "nothing pending");
    eq(purchaseRpcs().length, 0, "no purchase RPC");
    eq(geminiCalls.length, 0, "Gemini is not consulted for sized data requests");
    eq(externalCalls.length, 0, "no provider calls");
  });
}

Deno.test("previous conversation context cannot narrow or override a fresh request", async () => {
  await boot(hallucinatingModel);
  await send({ message: "buy 1GB mtn for 08099999999" });
  const r = await send({ message: `buy 2GB for ${PHONE}` });
  eq(r.json.products.map(label).sort(), ["Airtel|Gifting|2 GB|1100", "MTN|SME Data|2 GB|850"].sort(), "2GB across networks");
  eq(r.json.phone_number, PHONE, "new recipient, not the earlier one");
});

Deno.test("explicit network is respected, but nothing is auto-selected", async () => {
  await boot(hallucinatingModel);
  const a = await send({ message: `buy 1GB airtel for ${PHONE}` });
  eq(a.json.products.map((p: any) => p.network_name), ["Airtel", "Airtel", "Airtel"], "Airtel only");
  const m = await send({ message: `buy 1gb MTN for ${PHONE}` });
  eq(m.json.products.map(label), ["MTN|SME Data|1 GB|430"], "single MTN plan shown as a choice");
  eq(m.json.requires_confirmation, false, "still needs the customer's choice");
  eq(purchaseRpcs().length, 0, "no purchase");
});

Deno.test("explicit data type is respected; unavailable combinations are reported, not substituted", async () => {
  await boot(honestModel);
  const g = await send({ message: `buy 1GB gifting for ${PHONE}` });
  eq(g.json.products.map(label), ["Airtel|Gifting|1 GB|550"], "gifting only");
  const none = await send({ message: `buy 1GB glo for ${PHONE}` });
  eq(none.json.products, [], "no Glo plan");
  assert(/no active 1 GB glo plan/i.test(none.json.answer) && /did not pick a different/i.test(none.json.answer), "explains instead of switching network");
  const big = await send({ message: `buy 3GB for ${PHONE}` });
  eq(big.json.products, [], "no 3GB plan");
  assert(/Available sizes: 500 MB, 1 GB, 2 GB, 5 GB/.test(big.json.answer), "lists real sizes");
});

Deno.test("missing, invalid and saved-contact recipients", async () => {
  await boot(hallucinatingModel);
  const none = await send({ message: "buy 1GB" });
  eq(none.json.missing_fields, ["phone"], "asks for a number later");
  eq(none.json.phone_number ?? null, null, "no invented number");
  const mom = await send({ message: "buy 1GB for Mom" });
  eq(mom.json.phone_number, "08031234567", "saved contact resolved");
  const chidi = await send({ message: "buy 1GB for Chidi" });
  eq(chidi.json.phone_number, "08055555555", "'Chidi' is not mistaken for a greeting");
  const musa = await send({ message: "buy 1GB for Musa" });
  eq(musa.json.products, [], "ambiguous contact: no guessing");
  assert(/more than one saved contact named Musa/i.test(musa.json.answer), "asks for the number");
  const bad = await send({ message: "buy 1GB for 0806743672" });
  assert(/doesn't look valid/i.test(bad.json.answer), "invalid number rejected");
});

Deno.test("pick a plan -> exact confirmation summary -> explicit YES -> exactly one purchase", async () => {
  await boot(honestModel); mockPurchaseRpc();
  await send({ message: `Buy 1GB for ${PHONE}` });
  const pick = await send({ message: "airtel gifting" });
  eq(pick.json.requires_confirmation, true, "summary asks for confirmation");
  assert(/Airtel • Gifting • 1 GB/.test(pick.json.answer) && /valid 1 day/.test(pick.json.answer) && /₦550/.test(pick.json.answer) && pick.json.answer.includes(PHONE), "exact plan, price, recipient");
  eq(conv().pending_product_id, "p-airtel-gift-1gb", "pending is the chosen product");
  eq(purchaseRpcs().length, 0, "selecting never purchases");
  const yes = await send({ message: "yes" });
  eq(purchaseRpcs().length, 1, "one purchase RPC after YES");
  const call = purchaseRpcs()[0].args;
  eq([call.p_product_id, call.p_customer_input.phone], ["p-airtel-gift-1gb", PHONE], "RPC carries exactly the confirmed plan and number");
  assert(String(call.p_idempotency_key).startsWith("AI-"), "idempotency key supplied");
  void yes;
  await send({ message: "yes" });
  eq(purchaseRpcs().length, 1, "retrying YES cannot buy twice");
});

Deno.test("selection by option number, and ambiguous words re-list instead of choosing", async () => {
  await boot(honestModel); mockPurchaseRpc();
  await send({ message: `Buy 1GB for ${PHONE}` });
  const narrowed = await send({ message: "airtel" });
  eq(narrowed.json.products.length, 3, "three Airtel plans remain");
  eq(narrowed.json.requires_confirmation ?? false, false, "no auto-selection");
  const pick = await send({ message: "1" });
  eq(pick.json.requires_confirmation, true, "numbered choice leads to confirmation");
  eq(purchaseRpcs().length, 0, "still no purchase");
});

Deno.test("cancellation never purchases", async () => {
  await boot(honestModel); mockPurchaseRpc();
  await send({ message: `Buy 1GB for ${PHONE}` });
  await send({ message: "mtn" });
  const no = await send({ message: "no" });
  assert(/cancelled/i.test(no.json.answer), "cancelled");
  eq(conv().pending_product_id ?? null, null, "pending cleared");
  await send({ message: "yes" });
  eq(purchaseRpcs().length, 0, "YES after cancel buys nothing");
  // cancel while only a list is open
  await send({ message: `Buy 1GB for ${PHONE}` });
  await send({ message: "cancel" });
  await send({ message: "yes" });
  eq(purchaseRpcs().length, 0, "cancel at the list stage buys nothing");
});

Deno.test("a message that merely starts with 'e'/'ok' is not a confirmation", async () => {
  await boot(honestModel); mockPurchaseRpc();
  await send({ message: `Buy 1GB mtn for ${PHONE}` });
  await send({ message: "mtn" });
  eq(conv().pending_product_id, "p-mtn-sme-1gb", "MTN pending");
  const r = await send({ message: `easy, buy 2GB airtel for ${PHONE}` });
  eq(purchaseRpcs().length, 0, "no purchase from a lookalike");
  eq(r.json.products.map((p: any) => p.network_name), ["Airtel"], "treated as a new request");
  eq(conv().pending_product_id ?? null, null, "old pending superseded");
});

Deno.test("stale pending confirmation (>15 min) cannot be confirmed", async () => {
  await boot(honestModel); mockPurchaseRpc();
  await send({ message: `Buy 1GB for ${PHONE}` });
  await send({ message: "mtn" });
  conv().pending_at = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  const r = await send({ message: "yes" });
  assert(/expired/i.test(r.json.answer), "expired");
  eq(purchaseRpcs().length, 0, "nothing bought");
});

Deno.test("plans without an active provider mapping are not offered", async () => {
  await boot(honestModel, { provider_plan_mappings: [{ id: "m1", product_id: "p-mtn-sme-1gb", provider_id: "prov-1", active: true }] });
  const r = await send({ message: `Buy 1GB for ${PHONE}` });
  eq(r.json.products.map(label), ["MTN|SME Data|1 GB|430"], "only the executable plan");
  await boot(honestModel, { api_providers: [{ id: "prov-1", code: "SMEPLUG", status: "inactive" }] });
  const none = await send({ message: `Buy 1GB for ${PHONE}` });
  eq(none.json.products, [], "inactive provider: nothing offered");
});

Deno.test("existing safeguards: auth required, inactive product refused, greeting still works", async () => {
  await boot(honestModel); mockPurchaseRpc();
  const unauth = await send({ message: "buy 1GB" }, { token: "bad" });
  eq(unauth.status, 401, "authentication still enforced");
  const inactive = await send({ action: "purchase", product_id: "p-mtn-gift-1gb-inactive", phone_number: PHONE, reference: "BW-1" });
  eq(inactive.status, 400, "inactive product refused");
  eq(purchaseRpcs().length, 0, "no RPC for inactive product");
  const hi = await send({ message: "hi" });
  eq(hi.json.intent, "greeting", "greeting preserved");
});

Deno.test("size, phone and confirmation parsers", () => {
  eq(productSize({ product_name: "1 GB", volume: "GB" })?.mb, 1024, "name + unit-only volume");
  eq(productSize({ product_name: "500 MB", volume: "MB" })?.mb, 500, "MB");
  assert(parseDataSize("1gb")!.mb === parseDataSize("1 GB")!.mb && parseDataSize("1.5GB")!.mb === 1536, "spacing/decimals");
  eq(parsePhone("buy 1gb for +2348067436727").phone, PHONE, "+234 normalised");
  eq(classifyConfirmation("Yes please!"), "confirm", "polite yes");
  eq(classifyConfirmation("easy, buy 2GB"), null, "lookalike");
  eq(classifyConfirmation("no, buy 2GB airtel"), null, "'no' + new request is not a cancel");
  eq(classifyConfirmation("No"), "cancel", "plain no");
});
