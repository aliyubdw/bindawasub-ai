// Hausa phrasings confirmed by the owner, and Hausa replies for balance and cancel. Mock-only.
import { boot, send, db, geminiCalls, purchaseRpcs } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";
import { detectAccountIntent } from "../router/account-intents.ts";
import { isExplicitCancel } from "../account/cancel-handler.ts";
import { looksHausa } from "../router/language.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

Deno.test("Hausa: confirmed balance and funding phrasings are recognised", () => {
  const cases: [string, string | null][] = [
    ["Duba min asusuna", "wallet_balance"], ["duba asusuna", "wallet_balance"],
    ["Taya zan saka kudi a wallet", "fund_howto"], ["Yaya zan saka kudi a wallet", "fund_howto"],
    ["Ta ya zan saka kudi a wallet", "fund_howto"], ["Ta yaya zan saka kudi a wallet", "fund_howto"], ["ta ya ya zan saka kudi", "fund_howto"], // spaced spellings customers type
    ["Ina so in saka kudi", "fund_howto"], ["Ina so in saka kudi a wallet", "fund_howto"],
    ["Ina sa in saka kudi", "fund_howto"], // a typo real customers make
    ["Ina so in saka 5000 a wallet", null],  // an amount belongs to the funding flow
    ["Ta ya zan saka 5000 a wallet", null],  // so does this
    ["Ya zan saka kudi a wallet", null],      // too loose to trust
  ];
  const wrong = cases.filter(([m, want]) => detectAccountIntent(m) !== want).map(([m, w]) => `${m} (wanted ${w}, got ${detectAccountIntent(m)})`);
  eq(wrong, [], "Hausa phrasings");
});

Deno.test("Hausa: cancel words", () => {
  for (const m of ["soke", "A soke", "Soke shi", "soke wannan", "A'a ba yanzu ba", "ba yanzu ba"]) assert(isExplicitCancel(m), `should cancel: ${m}`);
  for (const m of ["A'a", "a soke 1gb mtn", "yaya zan soke"]) assert(!isExplicitCancel(m), `must not cancel: ${m}`);
});

Deno.test("Hausa detection never mistakes English for Hausa", () => {
  for (const m of ["Check my wallet balance", "Show MTN data plans", "I want to buy data", "How can I fund my wallet?", "Cancel", "hi"]) assert(!looksHausa(m), `English flagged as Hausa: ${m}`);
  for (const m of ["Duba min asusuna", "Sannu", "A saya 1gb wa Num", "A sa ma Num 1gb MTN", "Ina so in saka kudi"]) assert(looksHausa(m), `Hausa missed: ${m}`);
});

const withWallet = async () => {
  await boot(honestModel, { wallets: [{ user_id: "user-1", balance: 2190, currency: "NGN" }] } as any);
  db.rpcHandlers["get_my_balance"] = () => ({ data: [{ balance: 2190, currency: "NGN" }], error: null });
};

Deno.test("Hausa message gets the approved Hausa balance reply; English is unchanged", async () => {
  await withWallet();
  const ha = await send({ message: "Duba min asusuna" });
  eq(ha.json.answer, "Kudin da ke wallet ɗinka ₦2,190 ne.", "Hausa balance reply");
  eq(geminiCalls.length, 0, "Gemini not consulted");
  const en = await send({ message: "Check my wallet balance" });
  eq(en.json.answer, "Your wallet balance is ₦2,190.", "English balance reply");
});

Deno.test("Hausa cancel with nothing pending gets the approved Hausa reply; English is unchanged", async () => {
  await boot(honestModel);
  const ha = await send({ message: "Soke" });
  eq(ha.json.answer, "To, an soke. Babu abin da ke jiran aiki kuma ba a cire kuɗi ba.", "Hausa cancel reply");
  const en = await send({ message: "Cancel" });
  eq(en.json.answer, "Okay, cancelled. Nothing was pending and nothing was charged.", "English cancel reply");
});

Deno.test("Hausa cancel really cancels a just-created funding request", async () => {
  const now = new Date().toISOString();
  await boot(honestModel, {
    ai_conversations: [{ id: "c1", user_id: "user-1", channel: "web", status: "active", language: "hausa", last_message_at: now, conversation_context: {}, pending_product_id: null }],
    ai_messages: [{ id: "m1", conversation_id: "c1", role: "assistant", message: "…", intent: "fund_wallet", tool_called: "backend", created_at: now }],
    manual_funding_requests: [{ id: "r1", user_id: "user-1", reference: "MFR-H", amount: 500, status: "pending", payment_reference: null, created_at: now }],
  } as any);
  await send({ message: "A soke", conversation_id: "c1" });
  eq(db.tables.manual_funding_requests[0].status, "cancelled", "request cancelled");
  eq(purchaseRpcs().length, 0, "no wallet or purchase RPC");
});

Deno.test("Hausa data purchase for a saved contact lists plans and never buys", async () => {
  await boot(honestModel);
  const named = await send({ message: "A sa ma Mom 1gb MTN" });
  eq(named.json.products.map((p: any) => p.network_name), ["MTN"], "MTN only, as asked");
  eq(named.json.phone_number, "08031234567", "saved contact resolved");
  assert(/Na samu data plans/.test(named.json.answer), `reply should be in Hausa: ${named.json.answer}`);
  eq(named.json.requires_confirmation, false, "nothing confirmed yet");
  const open = await send({ message: "A saya 1gb wa Mom" });
  assert(open.json.products.length > 1, "all networks listed when none named");
  eq(purchaseRpcs().length, 0, "nothing bought");
});

Deno.test("Hausa 'Ta ya zan saka kudi a wallet' is answered by the backend, not Gemini", async () => {
  await boot(honestModel, { manual_funding_settings: [{ id: 1, active: true, bank_name: "Test Bank", account_name: "Mock Account", account_number: "0000000000", instructions: "Mock instructions." }] } as any);
  const r = await send({ message: "Ta ya zan saka kudi a wallet" });
  eq(r.json.intent, "fund_wallet", "funding instructions intent");
  eq(geminiCalls.length, 0, "Gemini not consulted");
});
