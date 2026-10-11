// Gemini must not state a price that is not in the catalog. Mock-only.
import { boot, send } from "./harness/harness.ts";
import type { ModelFn } from "./harness/harness.ts";
import { replyPricesMatchCatalog } from "../ai/price-guard.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }

const priceModel = (reply: string): ModelFn => (m) => /how much again|kuma nawa/i.test(m)
  ? { intent: "product_price", service_type: "data", network: "mtn", volume: "1GB", product_id: "p-mtn-sme-1gb", reply }
  : { intent: "unknown" };

Deno.test("a wrong price from Gemini is replaced by the catalog price", async () => {
  await boot(priceModel("MTN 1GB costs only ₦300 today!"));
  const r = await send({ message: "how much again for that one" });
  assert(!r.json.answer.includes("300"), `wrong price shown: ${r.json.answer}`);
  assert(r.json.answer.includes("430"), `catalog price missing: ${r.json.answer}`);
});

Deno.test("a correct price keeps Gemini's wording, including Hausa", async () => {
  const hausa = "Farashin MTN 1GB shi ne ₦430.";
  await boot(priceModel(hausa));
  const r = await send({ message: "kuma nawa ne wannan" });
  assert(r.json.answer === hausa, `wording changed: ${r.json.answer}`);
});

Deno.test("price guard: only catalog prices pass", () => {
  const products = [{ selling_price: "430.00" }, { selling_price: 1600 }];
  assert(replyPricesMatchCatalog("It is ₦430 or ₦1,600.", products), "catalog prices accepted");
  assert(replyPricesMatchCatalog("Farashin shi ne 430 naira", products), "naira suffix accepted");
  assert(!replyPricesMatchCatalog("It is ₦300.", products), "unknown price rejected");
  assert(replyPricesMatchCatalog("No numbers here, just friendly words.", products), "no amounts is fine");
});
