// Balance, funding instructions and transaction history/status are answered by the backend,
// not Gemini, for the way customers really phrase them. Mock-only.
import { boot, send, db, geminiCalls, purchaseRpcs } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";
import { detectAccountIntent } from "../router/account-intents.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const MUST_MATCH: [string, string][] = [
  ["Check my wallet balance", "wallet_balance"], ["check my wallet balance", "wallet_balance"], ["What's my balance?", "wallet_balance"],
  ["what's my wallet balance", "wallet_balance"], ["what's my wallet balanve", "wallet_balance"], ["How much is in my wallet", "wallet_balance"],
  ["How much is remaining in my wallet", "wallet_balance"], ["Check my balance please", "wallet_balance"], ["balance", "wallet_balance"],
  ["Wallet balance", "wallet_balance"], ["Check my wallet", "wallet_balance"], ["nawa ne kudin na wallet ta", "wallet_balance"],
  ["How can I fund my wallet?", "fund_howto"], ["How do I fund my wallet?", "fund_howto"], ["I want fund my wallet", "fund_howto"],
  ["I want to fund my wallet", "fund_howto"], ["fund", "fund_howto"], ["Fund wallet", "fund_howto"], ["How can I add money?", "fund_howto"],
  ["top up", "fund_howto"], ["ta yaya zan yi funding", "fund_howto"],
  ["Show my recent transactions", "transaction_history"], ["What was my last 3 transactions", "transaction_history"],
  ["My transactions", "transaction_history"], ["transaction history", "transaction_history"], ["show my purchases", "transaction_history"],
  ["Check status", "transaction_status"], ["Is it successful", "transaction_status"],
];
const MUST_NOT_MATCH = [
  "Fund wallet 1000", "fund my wallet with 5000", "check my balance and buy 1gb for 08011112222", "Buy 1gb for 08011112222",
  "Can I fund my friend's wallet", "how much is 1gb", "How much is MTN 1gb", "How much have I spent this month", "How much is airtime",
  "I need my money back", "what is the balance of payments", "Send me my balance to 08011112222", "I want to buy data", "1000", "Hello",
  "status of my order for 2gb", "Fund Mom's wallet",
];

Deno.test("account intents: every real phrasing matches", () => {
  const misses = MUST_MATCH.filter(([m, want]) => detectAccountIntent(m) !== want).map(([m, w]) => `${m} (wanted ${w}, got ${detectAccountIntent(m)})`);
  eq(misses, [], "phrasings that should match");
});

Deno.test("account intents: purchases, amounts, other people's wallets and compound requests are left alone", () => {
  const over = MUST_NOT_MATCH.filter((m) => detectAccountIntent(m) !== null).map((m) => `${m} → ${detectAccountIntent(m)}`);
  eq(over, [], "messages that must not be intercepted");
});

const walletRow = { user_id: "user-1", balance: 5000, currency: "NGN" };
const withWallet = async (extra: Record<string, unknown[]> = {}) => {
  await boot(honestModel, { wallets: [walletRow], manual_funding_settings: [{ id: 1, active: true, bank_name: "Test Bank", account_name: "Mock Account", account_number: "0000000000", instructions: "Mock instructions." }], ...extra } as any);
  db.rpcHandlers["get_my_balance"] = () => ({ data: [{ balance: 5000, currency: "NGN" }], error: null });
};

Deno.test("end to end: balance, funding and history are answered without consulting Gemini", async () => {
  for (const [message, intentPart] of [["Check my wallet balance", "wallet_balance"], ["How can I fund my wallet?", ""], ["Show my recent transactions", ""]] as const) {
    await withWallet();
    const r = await send({ message });
    eq(r.status, 200, `${message}: status`);
    assert(String(r.json.answer || "").trim().length > 0, `${message}: empty answer`);
    eq(geminiCalls.length, 0, `${message}: Gemini must not be consulted`);
    if (intentPart) eq(r.json.intent, intentPart, `${message}: intent`);
    eq(purchaseRpcs().length, 0, `${message}: nothing bought`);
  }
});

Deno.test("end to end: the balance shown is the real wallet balance", async () => {
  await withWallet();
  const r = await send({ message: "What's my wallet balance?" });
  assert(/5,000/.test(r.json.answer), `balance missing from: ${r.json.answer}`);
});

Deno.test("end to end: compound and amount messages still take their normal route", async () => {
  await withWallet();
  const compound = await send({ message: "check my balance and buy 1gb for 08067436727" });
  assert(Array.isArray(compound.json.products) && compound.json.products.length > 0, "the data purchase part was not lost");
  await withWallet();
  await send({ message: "Fund wallet 1000" });
  assert(geminiCalls.length >= 1, "an amount message still goes to the normal (Gemini) flow");
});
