// Cancelling a funding request for real: the backend action and the Telegram step that uses it. Mock-only.
import { boot, bootTelegram, send, tgSend, tgState, db, purchaseRpcs } from "./harness/harness.ts";
import { honestModel } from "./harness/models.ts";

function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

const settings = { manual_funding_settings: [{ id: 1, active: true, bank_name: "Test Bank", account_name: "Mock Account", account_number: "0000000000", instructions: "Mock instructions." }] };
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, user_id: "user-1", reference: `MFR-${id}`, amount: 500, status: "pending", payment_reference: null, created_at: new Date().toISOString(), ...extra });
const status = (id: string) => db.tables.manual_funding_requests.find((r: any) => r.id === id)?.status;

Deno.test("manual_funding_cancel cancels the customer's own pending request", async () => {
  await boot(honestModel, { manual_funding_requests: [row("r1")] } as any);
  const r = await send({ action: "manual_funding_cancel", request_id: "r1" });
  eq([r.status, r.json.success, status("r1")], [200, true, "cancelled"], "cancelled");
  assert(/MFR-r1/.test(r.json.answer) && /No money was added/.test(r.json.answer), `answer: ${r.json.answer}`);
  eq(purchaseRpcs().length, 0, "no wallet or purchase RPC");
  const again = await send({ action: "manual_funding_cancel", request_id: "r1" });
  eq([again.status, again.json.success], [400, false], "cancelling twice is refused");
});

Deno.test("manual_funding_cancel never touches a submitted, decided or someone else's request", async () => {
  await boot(honestModel, { manual_funding_requests: [
    row("sub", { payment_reference: "BANK-REF", status: "submitted" }),
    row("subpend", { payment_reference: "BANK-REF" }),
    row("done", { status: "approved" }), row("no", { status: "rejected" }),
    row("theirs", { user_id: "someone-else" }),
  ] } as any);
  for (const id of ["sub", "subpend", "done", "no", "theirs", "missing"]) {
    const r = await send({ action: "manual_funding_cancel", request_id: id });
    assert(r.status >= 400, `${id} should be refused, got ${r.status}`);
  }
  eq([status("sub"), status("subpend"), status("done"), status("no"), status("theirs")], ["submitted", "pending", "approved", "rejected", "pending"], "nothing changed");
  eq((await send({ action: "manual_funding_cancel" })).status, 400, "a request ID is required");
});

Deno.test("Telegram: cancelling in the funding-reference step really cancels the request", async () => {
  for (const word of ["cancel", "❌ Cancel", "Soke"]) {
    await bootTelegram(honestModel, { ...settings, manual_funding_requests: [] } as any);
    await tgSend("Ta ya zan saka kudi a wallet");
    await tgSend("500");
    eq(tgState().state, "awaiting_funding_reference", `'${word}': waiting for the reference`);
    eq(db.tables.manual_funding_requests[0].status, "pending", `'${word}': a pending request exists`);
    const r = await tgSend(word);
    eq(db.tables.manual_funding_requests[0].status, "cancelled", `'${word}': the request is really cancelled`);
    assert(/has been cancelled/.test(r.texts.join(" ")) && /No money was added/.test(r.texts.join(" ")), `'${word}' reply: ${r.texts.join(" | ")}`);
    eq(tgState().state, "idle", `'${word}': back to idle`);
    eq(purchaseRpcs().length, 0, `'${word}': no wallet or purchase RPC`);
  }
});

Deno.test("Telegram: if the request already moved on, cancel says so and changes nothing", async () => {
  await bootTelegram(honestModel, { ...settings, manual_funding_requests: [] } as any);
  await tgSend("Ta ya zan saka kudi a wallet");
  await tgSend("500");
  db.tables.manual_funding_requests[0].status = "approved"; // an admin approved it in the meantime
  const r = await tgSend("cancel");
  eq(db.tables.manual_funding_requests[0].status, "approved", "approved request untouched");
  assert(/already approved/.test(r.texts.join(" ")), `reply: ${r.texts.join(" | ")}`);
  eq(tgState().state, "idle", "back to idle");
});
