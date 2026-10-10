// Runs the REAL bindawasub-ai Edge Function handler against fake Supabase + scripted Gemini.
// No network, no provider calls, no real purchases.
import { db, resetDb } from "./fake_supabase.ts";
import { seed, Row } from "./fixtures.ts";

let handler: ((req: Request) => Promise<Response>) | null = null;
(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve(), shutdown() {} }; };
Deno.env.set("SUPABASE_URL", "https://mock.supabase.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "mock-service-role");
Deno.env.set("GEMINI_API_KEY", "mock-gemini");

export type ModelFn = (message: string, ctx: { products: Row[] }) => Row;
export const externalCalls: { url: string; body: any }[] = [];
export const geminiCalls: string[] = [];
let currentModel: ModelFn = () => ({ intent: "unknown" });

const baseAi = { network: null, volume: null, amount: 0, phone_number: null, product_id: null, product_name: null,
  variant: null, transaction_id: null, service_type: null, customer_input: {}, language: "english", reply: "" };

function geminiResponse(obj: Row) {
  return new Response(JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify({ ...baseAi, ...obj }) }] }] }), { status: 200 });
}

export const telegramSent: { method: string; payload: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url);
  if (url.includes("generativelanguage.googleapis.com")) {
    const sent = JSON.parse(init.body);
    const message = JSON.parse(sent.input).current_user_message as string;
    geminiCalls.push(message);
    return geminiResponse(currentModel(message, { products: db.tables.products }));
  }
  if (url.startsWith("https://api.telegram.org/")) {
    telegramSent.push({ method: url.split("/").pop()!, payload: safeParse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  }
  if (url.endsWith("/functions/v1/bindawasub-ai")) return await handler!(new Request(url, init)); // in-process
  // Anything else (provider-execution, Telegram, SMEPlug) is recorded and blocked.
  externalCalls.push({ url, body: init?.body ? safeParse(init.body) : null });
  return new Response(JSON.stringify({ success: false, error: "blocked by test harness" }), { status: 599 });
}) as typeof fetch;
void realFetch;

function safeParse(s: any) { try { return JSON.parse(s); } catch { return s; } }

export async function boot(model: ModelFn, extraSeed: Record<string, Row[]> = {}) {
  currentModel = model;
  resetDb(seed(extraSeed));
  externalCalls.length = 0;
  geminiCalls.length = 0;
  telegramSent.length = 0;
  db.authUsers["good-token"] = { id: "auth-1" };
  if (!handler) await import("../../index.ts");
  if (!handler) throw new Error("Edge Function did not register a Deno.serve handler");
}

export function setModel(model: ModelFn) { currentModel = model; }

export async function send(body: Row, opts: { channel?: string; token?: string } = {}) {
  const req = new Request("https://mock.supabase.test/functions/v1/bindawasub-ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.token ?? "good-token"}` },
    body: JSON.stringify({ channel: opts.channel ?? "web", ...body }),
  });
  const res = await handler!(req);
  const json = await res.json();
  return { status: res.status, json };
}

export const purchaseRpcs = () => db.rpcCalls.filter((c) => /purchase/i.test(c.name));
export { db };

export function mockPurchaseRpc() {
  db.rpcHandlers["process_service_purchase"] = () => ({ data: { success: true, transaction_id: "tx-1", transaction: { id: "tx-1", status: "pending" } }, error: null });
}

// ---- Telegram webhook, run in-process against the same fake database ----
let tgHandler: ((req: Request) => Promise<Response>) | null = null;
export async function bootTelegram(model: ModelFn) {
  await boot(model, {
    telegram_accounts: [{ id: "ta1", user_id: "user-1", telegram_user_id: 111, telegram_chat_id: 111, active: true }],
    telegram_conversation_states: [],
  });
  db.rpcHandlers["get_my_balance"] = () => ({ data: [{ balance: 5000 }], error: null });
  mockPurchaseRpc();
  Deno.env.set("TELEGRAM_BOT_TOKEN", "mock-bot");
  Deno.env.set("TELEGRAM_WEBHOOK_SECRET", "mock-secret");
  if (!tgHandler) {
    const previous = (Deno as any).serve;
    (Deno as any).serve = (h: any) => { tgHandler = h; return { finished: Promise.resolve(), shutdown() {} }; };
    await import("../../../telegram-webhook/index.ts");
    (Deno as any).serve = previous;
  }
}
export async function tgSend(text: string) {
  telegramSent.length = 0;
  const res = await tgHandler!(new Request("https://mock.supabase.test/functions/v1/telegram-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "mock-secret" },
    body: JSON.stringify({ message: { chat: { id: 111, type: "private" }, from: { id: 111, first_name: "Ali" }, text } }),
  }));
  return { status: res.status, json: await res.json().catch(() => ({})), texts: telegramSent.map((m) => String(m.payload?.text ?? "")) };
}
export const tgState = () => db.tables.telegram_conversation_states[0];
