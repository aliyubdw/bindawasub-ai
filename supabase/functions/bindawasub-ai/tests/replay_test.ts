// Replays real (masked) customer messages through the web chat backend and the Telegram webhook.
// Mock-only: fake database, scripted Gemini, no network, no provider calls.
//
// Safety rules checked for EVERY message, whatever the model says:
//   - no crash (status < 500) and a non-empty answer
//   - no purchase RPC and no provider call from a single message
//   - exactly one saved assistant reply, equal to what the customer received
//   - any ₦ amount in an answer is a catalog price, a number the customer wrote, or the wallet balance
//   - a data purchase request never asks for confirmation before the customer has chosen a plan
// A snapshot of how each message was routed (backend vs Gemini, intent) catches silent regressions.
// Refresh the snapshot deliberately:  UPDATE_SNAPSHOT=1 deno test --allow-read --allow-write --allow-env ...
import { boot, bootTelegram, send, tgSend, tgState, db, purchaseRpcs, externalCalls, loadRecommend } from "./harness/harness.ts";
import { honestModel, hallucinatingModel } from "./harness/models.ts";
import { parseDataPurchaseRequest } from "../purchase/request.ts";
import type { ModelFn } from "./harness/harness.ts";

type Case = { c: "web" | "telegram"; m: string };
const corpus: Case[] = JSON.parse(await Deno.readTextFile(new URL("./replay/corpus.json", import.meta.url)));
const snapshotUrl = new URL("./replay/snapshot.json", import.meta.url);
const FAKE_PHONE = "08011112222";
const WALLET = 5000;
const fill = (m: string) => m.replace(/<PHONE>/g, FAKE_PHONE).replace(/<SHORTPHONE>/g, "080111122"); // 9 digits: deliberately invalid

function amountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:₦|NGN|\bN)\s*([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:naira|₦)/gi)) out.push(Number(String(m[1] ?? m[2]).replace(/,/g, "")));
  return out;
}

async function replayWeb(model: ModelFn, c: Case, violations: string[], snapshot: Record<string, string>, record: boolean) {
  await boot(model);
  db.tables.wallets = [{ user_id: "user-1", balance: WALLET }];
  db.rpcHandlers["get_my_balance"] = () => ({ data: [{ balance: WALLET }], error: null });
  const message = fill(c.m);
  const tag = `web|${c.m}`;
  const r = await send({ message });
  const fail = (why: string) => violations.push(`${tag}  →  ${why}`);
  if (r.status >= 500) return fail(`crashed with ${r.status}`);
  const answer = String(r.json?.answer ?? "").trim();
  if (r.status === 200 && !answer) fail("empty answer");
  if (purchaseRpcs().length) fail("a purchase RPC ran from a single message");
  if (externalCalls.length) fail(`external call: ${externalCalls[0].url}`);
  const saved = db.tables.ai_messages.filter((x: any) => x.role === "assistant");
  if (r.status === 200 && answer && !(saved.length === 1 && String(saved[0].message).trim() === answer)) fail(`saved reply does not match the answer (${saved.length} saved)`);
  const catalogPrices = new Set(db.tables.products.map((p: any) => Number(p.selling_price)));
  const allowed = new Set<number>([...catalogPrices, WALLET, 0, ...amountsIn(message), ...(message.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)]);
  for (const a of amountsIn(answer)) if (!allowed.has(a)) fail(`amount ₦${a} is not a catalog price, wallet balance or number the customer wrote`);
  if (parseDataPurchaseRequest(message).isDataPurchase && r.json?.requires_confirmation === true) fail("asked for confirmation before a plan was chosen");
  if (record) snapshot[tag] = `${saved[0]?.tool_called ?? "-"}|${r.json?.intent ?? "-"}`;
}

async function replayTelegram(c: Case, violations: string[], snapshot: Record<string, string>, record: boolean) {
  await bootTelegram(honestModel); await loadRecommend();
  db.tables.wallets = [{ user_id: "user-1", balance: WALLET }];
  const tag = `telegram|${c.m}`;
  const r = await tgSend(fill(c.m));
  const fail = (why: string) => violations.push(`${tag}  →  ${why}`);
  if (r.status >= 500) return fail(`crashed with ${r.status}`);
  if (!r.texts.length) fail("the bot sent no reply");
  if (purchaseRpcs().length) fail("a purchase RPC ran from a single message");
  if (record) snapshot[tag] = `${tgState()?.state ?? "-"}|${r.texts.length ? "replied" : "silent"}`;
}

function report(title: string, violations: string[]) {
  if (violations.length) throw new Error(`${title}: ${violations.length} violation(s)\n  ` + violations.slice(0, 40).join("\n  "));
}

Deno.test("replay: privacy guard — the corpus holds no phone numbers, account numbers, emails or IDs", () => {
  const bad = corpus.filter((c) => /\d{9,}/.test(c.m) || /@/.test(c.m) || /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(c.m));
  if (bad.length) throw new Error("personal data in corpus: " + bad.map((b) => b.m).join(" | "));
});

Deno.test("replay: web safety rules hold for every real message (well-behaved model)", async () => {
  const violations: string[] = []; const snapshot: Record<string, string> = {};
  for (const c of corpus.filter((x) => x.c === "web")) await replayWeb(honestModel, c, violations, snapshot, true);
  report("web", violations);
  if (Deno.env.get("UPDATE_SNAPSHOT") === "1") {
    const previous = JSON.parse(await Deno.readTextFile(snapshotUrl).catch(() => "{}"));
    await Deno.writeTextFile(snapshotUrl, JSON.stringify({ ...previous, ...snapshot }, null, 1) + "\n");
    return;
  }
  const expected = JSON.parse(await Deno.readTextFile(snapshotUrl));
  const changed = Object.entries(snapshot).filter(([k, v]) => expected[k] !== v).map(([k, v]) => `${k}  →  was ${expected[k] ?? "(new)"}, now ${v}`);
  if (changed.length) throw new Error(`routing changed for ${changed.length} message(s); if intended, refresh the snapshot:\n  ` + changed.slice(0, 30).join("\n  "));
});

Deno.test("replay: web safety rules hold even if the model misbehaves", async () => {
  const violations: string[] = [];
  for (const c of corpus.filter((x) => x.c === "web")) await replayWeb(hallucinatingModel, c, violations, {}, false);
  report("web (hallucinating model)", violations);
});

Deno.test("replay: Telegram never crashes or buys from a single real message", async () => {
  const violations: string[] = []; const snapshot: Record<string, string> = {};
  for (const c of corpus.filter((x) => x.c === "telegram")) await replayTelegram(c, violations, snapshot, true);
  report("telegram", violations);
  if (Deno.env.get("UPDATE_SNAPSHOT") === "1") {
    const previous = JSON.parse(await Deno.readTextFile(snapshotUrl).catch(() => "{}"));
    await Deno.writeTextFile(snapshotUrl, JSON.stringify({ ...previous, ...snapshot }, null, 1) + "\n");
    return;
  }
  const expected = JSON.parse(await Deno.readTextFile(snapshotUrl));
  const changed = Object.entries(snapshot).filter(([k, v]) => expected[k] !== v).map(([k, v]) => `${k}  →  was ${expected[k] ?? "(new)"}, now ${v}`);
  if (changed.length) throw new Error(`Telegram routing changed for ${changed.length} message(s):\n  ` + changed.slice(0, 30).join("\n  "));
});
