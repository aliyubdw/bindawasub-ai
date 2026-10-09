import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = process.cwd();
const read = (path) => readFile(new URL(path, `file://${root}/`), "utf8");

const intentPath = "supabase/functions/bindawasub-ai/ai/intent-router.ts";
const indexPath = "supabase/functions/bindawasub-ai/index.ts";
const catalogPath = "supabase/functions/bindawasub-ai/catalog/handler.ts";
const telegramPath = "supabase/functions/telegram-webhook/index.ts";

const unscopedVerbs = /\b(?:buy|purchase|send|get|give|need|want|order|activate|subscribe|saya|sayi|siyo|siya|oda|aika|kunna)\b/i;
const dataSize = /\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb)\b/i;
const networkToken = /\b(?:mtn|airtel|glo|9mobile|t2)\b/i;

function unscopedRequest(message) {
  return unscopedVerbs.test(message) && dataSize.test(message) && !networkToken.test(message);
}

test("unscoped size requests are detected in English and Hausa examples", () => {
  assert.equal(unscopedRequest("buy 1GB for Mom"), true);
  assert.equal(unscopedRequest("ina son saya 2gb"), true);
  assert.equal(unscopedRequest("buy 1GB data"), true);
  assert.equal(unscopedRequest("buy 1GB MTN"), false);
});

test("intent router clears inferred network and product IDs for unscoped requests", async () => {
  const source = await read(intentPath);
  assert.match(source, /const unscopedSizePurchase\s*=([\s\S]{0,500})sme\/social\/gifting\/awoop/i);
  assert.match(source, /network:\s*null/);
  assert.match(source, /product_id:\s*null/);
  assert.match(source, /product_name:\s*null/);
  assert.match(source, /delete customerInput\.network/);
  assert.match(source, /!unscopedSizePurchase && specificationCandidates\.length === 1/);
  assert.match(source, /unscopedSizePurchase && specificationCandidates\.length > 0/);
});

test("request pre-processing discards inherited network when request is unscoped", async () => {
  const source = await read(indexPath);
  assert.match(source, /const naturalLanguageUnscopedDataPurchase\s*=([\s\S]{0,400})\(kb\|mb\|gb\|tb\)/i);
  assert.match(source, /const requestedNetworkToken\s*=\s*explicitNetwork\s*\|\|\s*\(naturalLanguageUnscopedDataPurchase\s*\?\s*""\s*:\s*contextNetwork\)/);
  assert.match(source, /if\s*\(explicitNetwork\)\s*\{[\s\S]{0,300}ai\.network\s*=\s*null/);
});

test("catalog enquiry handler defers unscoped purchase requests to purchase router", async () => {
  const source = await read(catalogPath);
  assert.match(source, /if\s*\(hasPurchaseVerbAndDataSize\s*&&\s*!namesNetwork\)\s*return null/);
});

test("Telegram selection stage stores confirmation state without vending immediately", async () => {
  const source = await read(telegramPath);
  assert.match(source, /awaiting_natural_language_product_selection/);
  assert.match(source, /awaiting_data_confirmation/);
  assert.match(source, /idempotency_key:\s*"TG-"\+acct\.user_id\+\s*"-"\+crypto\.randomUUID\(\)/);
  assert.match(source, /if\s*\(!confirmed\)\s*\{/);
  assert.match(source, /\.eq\("state","awaiting_data_confirmation"\)/);
  assert.match(source, /duplicate_confirmation:\s*true/);
});

test("mock catalog routing: old MTN context cannot narrow a fresh unscoped request", () => {
  const plans = [
    { network: "MTN", size: "1GB" }, { network: "Airtel", size: "1GB" },
    { network: "Glo", size: "1GB" }, { network: "9mobile", size: "1GB" },
    { network: "MTN", size: "2GB" }, { network: "Airtel", size: "2GB" },
    { network: "Glo", size: "2GB" }, { network: "9mobile", size: "2GB" },
  ];
  const cases = [
    { message: "buy 1GB for Mom", oldNetwork: "mtn", expected: ["MTN", "Airtel", "Glo", "9mobile"] },
    { message: "buy 1GB MTN", oldNetwork: null, expected: ["MTN"] },
    { message: "ina son saya 2gb", oldNetwork: null, expected: ["MTN", "Airtel", "Glo", "9mobile"] },
    { message: "buy 1GB data", oldNetwork: "mtn", expected: ["MTN", "Airtel", "Glo", "9mobile"] },
  ];

  for (const item of cases) {
    const unscoped = unscopedRequest(item.message);
    const size = item.message.match(dataSize)?.[0].replace(/\s/g, "").toUpperCase();
    let matching = plans.filter((plan) => plan.size === size);
    if (!unscoped) {
      const explicit = item.message.match(networkToken)?.[0]?.toLowerCase();
      const network = explicit || item.oldNetwork;
      if (network) matching = matching.filter((plan) => plan.network.toLowerCase() === network);
    }
    const actual = [...new Set(matching.map((plan) => plan.network))];
    assert.deepEqual(actual, item.expected, item.message);
  }
});
