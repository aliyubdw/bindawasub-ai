// Regression tests for PR #24's unscoped data-plan routing and PR #25's catalog-size matching.
// These tests use mock catalog data only. They do not call Supabase, Telegram, or a vending provider.
import { filterCatalogBySpecification, productMatchesVolume } from "../catalog/lookup.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const purchaseVerb = /\b(?:buy|purchase|send|get|give|need|want|order|activate|subscribe|saya|sayi|siyo|siya|oda|aika|kunna)\b/i;
const dataSize = /\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb)\b/i;
const networkName = /\b(?:mtn|airtel|glo|9mobile|t2)\b/i;

function mockRoute(message: string, priorNetwork: string | null, plans: { network: string; size: string }[]) {
  const unscoped = purchaseVerb.test(message) && dataSize.test(message) && !networkName.test(message);
  const size = message.match(dataSize)?.[0].replace(/\s/g, "").toLowerCase();
  let candidates = plans.filter((plan) => plan.size.toLowerCase() === size);
  if (!unscoped) {
    const explicitNetwork = message.match(networkName)?.[0]?.toLowerCase();
    const network = explicitNetwork || priorNetwork;
    if (network) candidates = candidates.filter((plan) => plan.network.toLowerCase() === network);
  }
  return { unscoped, candidates };
}

const mockPlans = [
  { network: "MTN", size: "1GB" },
  { network: "Airtel", size: "1GB" },
  { network: "Glo", size: "1GB" },
  { network: "9mobile", size: "1GB" },
  { network: "MTN", size: "2GB" },
  { network: "Airtel", size: "2GB" },
  { network: "Glo", size: "2GB" },
  { network: "9mobile", size: "2GB" },
];

Deno.test("unscoped request after MTN context shows all matching networks", () => {
  const result = mockRoute("buy 1GB for Mom", "mtn", mockPlans);
  assert(result.unscoped, "request should be classified as unscoped");
  assert(result.candidates.length === 4, "expected four 1GB plans");
  assert(new Set(result.candidates.map((p) => p.network)).size === 4, "expected all four networks");
});

Deno.test("explicit MTN request stays scoped to MTN", () => {
  const result = mockRoute("buy 1GB MTN", null, mockPlans);
  assert(!result.unscoped, "explicit network request must not be unscoped");
  assert(result.candidates.length === 1 && result.candidates[0].network === "MTN", "expected MTN only");
});

Deno.test("Hausa request without a network shows all matching networks", () => {
  const result = mockRoute("ina son saya 2gb", null, mockPlans);
  assert(result.unscoped, "Hausa purchase phrase should be recognized");
  assert(result.candidates.length === 4, "expected four 2GB plans");
});

Deno.test("new unscoped request ignores previous MTN context", () => {
  const result = mockRoute("buy 1GB data", "mtn", mockPlans);
  assert(result.candidates.length === 4, "prior network must not filter the candidates");
});

const catalog = [
  { id: "mtn-1", service_type: "data", product_name: "MTN SME 1GB", volume: "GB", selling_price: 430, service_networks: { code: "mtn", name: "MTN" }, service_variants: { code: "sme", name: "SME" } },
  { id: "airtel-1", service_type: "data", product_name: "Airtel Social 1 GB", volume: "GB", selling_price: 350, service_networks: { code: "airtel", name: "Airtel" }, service_variants: { code: "social", name: "Social" } },
  { id: "airtel-10", service_type: "data", product_name: "Airtel SME 10GB", volume: "GB", selling_price: 2500, service_networks: { code: "airtel", name: "Airtel" }, service_variants: { code: "sme", name: "SME" } },
  { id: "airtel-15", service_type: "data", product_name: "Airtel SME 1.5GB", volume: "GB", selling_price: 700, service_networks: { code: "airtel", name: "Airtel" }, service_variants: { code: "sme", name: "SME" } },
  { id: "glo-500", service_type: "data", product_name: "Glo 500MB", volume: "MB", selling_price: 100, service_networks: { code: "glo", name: "Glo" }, service_variants: { code: "sme", name: "SME" } },
];

Deno.test("real catalog matcher matches 1GB when volume stores only GB", () => {
  assert(productMatchesVolume(catalog[0], "1GB"), "should match MTN SME 1GB");
  assert(productMatchesVolume(catalog[1], "1 GB"), "should match Airtel Social 1 GB");
  const matches = filterCatalogBySpecification({ service_type: "data", volume: "1GB" }, catalog);
  assert(matches.length === 2, "1GB should match only the two 1GB catalog rows");
  assert(!matches.some((p) => p.id === "airtel-10" || p.id === "airtel-15"), "must not match 10GB or 1.5GB");
});

Deno.test("real catalog matcher handles MB sizes and explicit network filters", () => {
  const mbMatches = filterCatalogBySpecification({ service_type: "data", volume: "500MB" }, catalog);
  assert(mbMatches.length === 1 && mbMatches[0].id === "glo-500", "500MB should match only Glo 500MB");
  const mtnMatches = filterCatalogBySpecification({ service_type: "data", volume: "1GB", network: "MTN" }, catalog);
  assert(mtnMatches.length === 1 && mtnMatches[0].id === "mtn-1", "explicit MTN filter should return MTN only");
});

Deno.test("production routing source retains the safety guards", async () => {
  const root = new URL("../../../../", import.meta.url);
  const router = await Deno.readTextFile(new URL("supabase/functions/bindawasub-ai/ai/intent-router.ts", root));
  const index = await Deno.readTextFile(new URL("supabase/functions/bindawasub-ai/index.ts", root));
  const catalogHandler = await Deno.readTextFile(new URL("supabase/functions/bindawasub-ai/catalog/handler.ts", root));
  const telegram = await Deno.readTextFile(new URL("supabase/functions/telegram-webhook/index.ts", root));

  assert(router.includes("delete customerInput.network;"), "unscoped router must discard inherited network");
  assert(router.includes("network: null, product_id: null, product_name: null"), "unscoped request must discard AI-guessed product/network");
  assert(router.includes("requires_confirmation:false"), "showing choices must not purchase");
  assert(index.includes("ai.network = null;") && index.includes("delete ai.customer_input.network;"), "index must clear guessed/inherited network");
  assert(catalogHandler.includes("if (hasPurchaseVerbAndDataSize && !namesNetwork) return null;"), "catalog enquiry must yield unscoped purchase to purchase router");
  assert(telegram.includes("awaiting_natural_language_product_selection"), "Telegram must wait for a plan selection");
  assert(telegram.includes("awaiting_data_confirmation"), "Telegram plan selection must continue to explicit confirmation");
  assert(telegram.includes('idempotency_key: "TG-"+acct.user_id+"-"+crypto.randomUUID()'), "Telegram confirmation must have a fresh transaction reference");
  assert(telegram.includes("if(!confirmed)"), "Telegram must gate execution on confirmation");
  assert(telegram.includes("duplicate_confirmation:true"), "duplicate confirmations must be guarded");
  assert(telegram.includes("p.product_name||p.volume"), "Telegram labels must prefer full product name over unit-only volume");
});
