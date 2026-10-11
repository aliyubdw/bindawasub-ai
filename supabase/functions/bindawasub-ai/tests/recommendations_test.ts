// Mock-only tests for recommend-products and the Telegram recommendation flow.
import { boot, bootTelegram, loadRecommend, callRecommend, tgSend, tgState, db, purchaseRpcs } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const ids = (r: any) => r.json.recommendations.map((x: any) => x.product_id).sort();

Deno.test("recommend-products only accepts the service-role key", async () => {
  await boot(honestModel); await loadRecommend();
  eq((await callRecommend({ message: "best data for 1000", wallet_balance: 5000 }, "a-user-token")).status, 401, "customer token refused");
  eq((await callRecommend({ message: "best data for 1000", wallet_balance: 5000 })).status, 200, "service key accepted");
});

Deno.test("recommendations exclude plans that cannot be bought right now", async () => {
  // Airtel Gifting 1GB loses its provider mapping, Airtel Social 1GB's network-type is switched off.
  const mappings = [
    { id: "m1", product_id: "p-mtn-sme-1gb", provider_id: "prov-1", active: true, provider_status: "active" },
    { id: "m2", product_id: "p-airtel-sme-1gb", provider_id: "prov-1", active: true, provider_status: "active" },
    { id: "m3", product_id: "p-airtel-social-1gb", provider_id: "prov-1", active: true, provider_status: "active" },
  ];
  await boot(honestModel, { provider_plan_mappings: mappings }); await loadRecommend();
  for (const p of db.tables.products) if (p.id === "p-airtel-social-1gb") p.service_variants.active = false;
  const r = await callRecommend({ message: "cheapest data plans", wallet_balance: 5000 });
  const offered = r.json.recommendations.map((x: any) => x.product_id);
  assert(!offered.includes("p-airtel-gift-1gb"), "plan without a provider mapping was recommended");
  assert(!offered.includes("p-airtel-social-1gb"), "plan with an inactive data type was recommended");
  assert(!offered.includes("p-mtn-gift-1gb-inactive"), "inactive plan was recommended");
  assert(offered.length > 0, "something eligible is still recommended");
});

Deno.test("recommendations carry network, data type and a clean validity label", async () => {
  await boot(honestModel); await loadRecommend();
  const r = await callRecommend({ message: "mtn best data for 1000", wallet_balance: 5000 });
  const first = r.json.recommendations[0];
  eq([first.network_name, first.variant_name, typeof first.validity], ["MTN", "SME Data", "string"], "network, type, validity present");
  assert(!/\b1 (weeks|days|months)\b/.test(first.validity), `validity wording: ${first.validity}`);
});

Deno.test("Telegram: recommendation list and selection show data type, validity and real line breaks", async () => {
  await bootTelegram(honestModel); await loadRecommend();
  db.tables.wallets = [{ user_id: "user-1", balance: 5000 }];
  const list = await tgSend("best data for 1000");
  const text = list.texts.join("\n");
  eq(tgState().state, "awaiting_recommendation_selection", "waiting for a choice");
  assert(/SME Data|Gifting|Social data/.test(text), "data type shown in the list");
  assert(!/•\s*GB\s*•/.test(text), "unit-only volume 'GB' no longer used as a label");
  const pick = await tgSend("1");
  const reply = pick.texts.join("\n");
  eq(tgState().state, "awaiting_data_recipient", "asks for the recipient");
  assert(!reply.includes("\\n"), `literal backslash-n shown to the customer: ${reply}`);
  assert(/Who should receive it/.test(reply), "asks who receives it");
  assert(String(tgState().context.variant_name || "").length > 0, "data type carried into the purchase context");
  eq(purchaseRpcs().length, 0, "no purchase");
});

Deno.test("Telegram: choosing a recommendation then giving a number still needs an explicit confirm", async () => {
  await bootTelegram(honestModel); await loadRecommend();
  db.tables.wallets = [{ user_id: "user-1", balance: 5000 }];
  await tgSend("best data for 1000");
  await tgSend("1");
  const summary = await tgSend("08067436727");
  assert(/Data type:/.test(summary.texts.join("\n")) && !/Data type: —/.test(summary.texts.join("\n")), "summary shows the data type");
  eq(tgState().state, "awaiting_data_confirmation", "waiting for confirmation");
  eq(purchaseRpcs().length, 0, "nothing bought until Confirm");
  await tgSend("❌ Cancel");
  await tgSend("✅ Confirm Purchase");
  eq(purchaseRpcs().length, 0, "cancel then confirm buys nothing");
  void ids;
});
