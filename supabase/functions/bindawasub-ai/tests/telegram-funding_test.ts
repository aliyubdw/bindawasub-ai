// Telegram: a funding question in any language must lead into the amount step. Mock-only.
import { bootTelegram, tgSend, tgState, db, purchaseRpcs } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const funding = { manual_funding_settings: [{ id: 1, active: true, bank_name: "Test Bank", account_name: "Mock Account", account_number: "0000000000", instructions: "Mock instructions." }], manual_funding_requests: [] };

Deno.test("Telegram: a Hausa funding question enters the amount step, and the next number becomes a funding request", async () => {
  await bootTelegram(honestModel, funding);
  const ask = await tgSend("Ta ya zan saka kudi a wallet");
  eq(tgState().state, "awaiting_funding_amount", "waiting for the amount");
  assert(/How much would you like to add/.test(ask.texts.join(" ")), `prompt: ${ask.texts.join(" | ")}`);
  await tgSend("500");
  const requests = db.tables.manual_funding_requests;
  eq([requests.length, requests[0]?.amount, requests[0]?.status], [1, 500, "pending"], "one pending ₦500 funding request");
  eq(tgState().state, "awaiting_funding_reference", "now waiting for the transfer reference");
  eq(purchaseRpcs().length, 0, "no purchase or wallet RPC");
});

Deno.test("Telegram: the other Hausa phrasings and the English keyword path behave the same", async () => {
  for (const phrase of ["Ta yaya zan saka kudi a wallet", "Ina so in saka kudi", "Ina sa in saka kudi", "fund wallet"]) {
    await bootTelegram(honestModel, funding);
    await tgSend(phrase);
    eq(tgState().state, "awaiting_funding_amount", `'${phrase}' leads into the amount step`);
  }
});

Deno.test("Telegram: cancelling in the amount step, in English, with the button, or in Hausa, creates nothing", async () => {
  for (const word of ["cancel", "❌ Cancel", "Soke", "A'a ba yanzu ba"]) {
    await bootTelegram(honestModel, funding);
    await tgSend("Ta ya zan saka kudi a wallet");
    await tgSend(word);
    eq(tgState().state, "idle", `'${word}' returns to idle`);
    eq(db.tables.manual_funding_requests.length, 0, `'${word}' created no request`);
  }
});

Deno.test("Telegram: unrelated messages and amounts-in-the-question do not enter the amount step", async () => {
  for (const phrase of ["Hello", "Buy 1gb for 08067436727", "Ta ya zan saka 5000 a wallet", "Check my wallet balance"]) {
    await bootTelegram(honestModel, funding);
    await tgSend(phrase);
    assert(tgState()?.state !== "awaiting_funding_amount", `'${phrase}' must not enter the funding amount step`);
  }
});
