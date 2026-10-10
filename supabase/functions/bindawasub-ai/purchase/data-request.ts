// Deterministic handling of natural-language data purchases ("Buy 1GB for 08067436727").
//
// Everything here comes from (a) the CURRENT message text, (b) the customer's own saved
// contacts, and (c) the live eligible catalog. Gemini output and earlier conversation
// context (network, product, phone, volume) are never consulted, so nothing can be
// invented, and no money moves: this module only lists options or records a pending
// confirmation that still needs an explicit "yes" (or a confirm tap) from the customer.
import { describePlan, productSpecification } from "../catalog/format.ts";
import { productSize, sameSize } from "../catalog/size.ts";
import { classifyConfirmation, normalizeNigerianPhone, parseDataPurchaseRequest, parseNetwork, parsePhone, parseVariant } from "./request.ts";

const SELECTION_TTL_MS = 15 * 60 * 1000;
const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const one = (v: any) => (Array.isArray(v) ? v[0] : v);

export type DataRequestContext = {
  supabase: any;
  userId: string;
  channel: string;
  conversationId: string | null;
  conversationContext: any;
  originalMessage: string;
  eligibleProducts: any[];
  corsHeaders: Record<string, string>;
  persistAssistantMessage: (...args: any[]) => Promise<void>;
};

const isHausa = (message: string) =>
  /\b(?:saya|sayi|siyo|siya|oda|aika|kunna|ina son|zan saya|zan siye)\b/i.test(message);

function reply(ctx: DataRequestContext, body: Record<string, unknown>, answer: string) {
  return ctx.persistAssistantMessage(ctx.supabase, ctx.conversationId, answer, "purchase_intent", "backend").then(() =>
    new Response(JSON.stringify({ success: true, intent: "purchase_intent", service_type: "data", answer, ai_powered: false, ...body }),
      { status: 200, headers: { ...ctx.corsHeaders, "Content-Type": "application/json" } }));
}

const productNetwork = (p: any) => norm(one(p?.service_networks)?.code) || norm(one(p?.service_networks)?.name);
const productVariant = (p: any) => [norm(one(p?.service_variants)?.code), norm(one(p?.service_variants)?.name)];
const byPriceThenNetwork = (a: any, b: any) =>
  Number(a.selling_price) - Number(b.selling_price) || String(one(a.service_networks)?.name).localeCompare(String(one(b.service_networks)?.name));

async function resolveContact(ctx: DataRequestContext): Promise<{ phone: string | null; ambiguous: string | null }> {
  const { data, error } = await ctx.supabase.from("saved_beneficiaries").select("name,phone_number").eq("user_id", ctx.userId);
  if (error) { console.error("Saved beneficiary lookup failed:", error); return { phone: null, ambiguous: null }; }
  const words = String(ctx.originalMessage || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hits = (data || []).filter((c: any) => {
    const nameWords = String(c.name || "").trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!nameWords.length || String(c.name).trim().length < 2 || !normalizeNigerianPhone(c.phone_number)) return false;
    return words.some((_, start) => nameWords.every((w, i) => words[start + i] === w));
  });
  // Several contacts with the same name must never be guessed between.
  const distinctPhones = new Set(hits.map((c: any) => normalizeNigerianPhone(c.phone_number)));
  if (distinctPhones.size > 1) return { phone: null, ambiguous: String(hits[0].name) };
  return { phone: hits.length ? normalizeNigerianPhone(hits[0].phone_number) : null, ambiguous: null };
}

async function savePending(ctx: DataRequestContext, fields: Record<string, unknown>, context: Record<string, unknown>) {
  if (!ctx.conversationId) return;
  await ctx.supabase.from("ai_conversations").update({
    ...fields,
    conversation_context: { ...(ctx.conversationContext || {}), ...context, updated_at: new Date().toISOString() },
    last_message_at: new Date().toISOString(),
  }).eq("id", ctx.conversationId).eq("user_id", ctx.userId).eq("channel", ctx.channel);
}

const NO_PENDING = {
  pending_product_id: null, pending_phone_number: null, pending_at: null, pending_service_type: null,
  pending_airtime_amount: null, pending_network: null, pending_idempotency_key: null, pending_customer_input: {},
};

function choiceLine(p: any) {
  const s = productSpecification(p);
  return `${s.network_name || s.network} • ${s.variant_name || s.variant || "Data"} • ${s.product_name} • ${s.validity || "validity not specified"} • ₦${s.selling_price.toLocaleString("en-NG")}`;
}

function confirmationBody(ctx: DataRequestContext, product: any, phone: string, hausa: boolean) {
  const summary = describePlan(product);
  const answer = hausa
    ? `Tabbatar da wannan sayayya: ${summary} zuwa ${phone}. Rubuta YES don tabbatarwa ko NO don soke.`
    : `Please confirm this purchase: ${summary} for ${phone}. Reply YES to confirm or NO to cancel.`;
  return { answer, body: { product, phone_number: phone, customer_input: { phone }, requires_confirmation: true } };
}

async function startConfirmation(ctx: DataRequestContext, product: any, phone: string, hausa: boolean) {
  const key = `AI-${ctx.conversationId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await savePending(ctx, {
    pending_product_id: product.id, pending_phone_number: phone, pending_at: new Date().toISOString(),
    pending_service_type: "data", pending_airtime_amount: null, pending_network: null,
    pending_idempotency_key: key, pending_customer_input: { phone },
  }, { last_intent: "purchase_intent", service_type: "data", pending_selection: null, phone_number: phone });
  const { answer, body } = confirmationBody(ctx, product, phone, hausa);
  return reply(ctx, body, answer);
}

// ---------------------------------------------------------------------------------------
// A fresh request: "Buy 1GB for 08067436727", "buy 2gb airtel for Mom", "ina son saya 1gb"
// ---------------------------------------------------------------------------------------
export async function handleDataSizeRequest(ctx: DataRequestContext): Promise<Response | null> {
  const request = parseDataPurchaseRequest(ctx.originalMessage);
  if (!request.isDataPurchase || !request.size) return null;
  const hausa = isHausa(ctx.originalMessage);

  // A new request supersedes any earlier pending purchase or open selection.
  await savePending(ctx, NO_PENDING, { pending_selection: null });

  let phone = request.phone;
  if (!phone && !request.phoneInvalid) {
    const contact = await resolveContact(ctx);
    if (contact.ambiguous) {
      return reply(ctx, { products: [], missing_fields: ["phone"] },
        hausa ? `Kana da lambobi fiye da ɗaya mai suna ${contact.ambiguous}. Da fatan za ka aiko lambar kai tsaye.`
              : `You have more than one saved contact named ${contact.ambiguous}. Please send the phone number you want to use.`);
    }
    phone = contact.phone;
  }
  if (request.phoneInvalid) {
    return reply(ctx, { products: [], missing_fields: ["phone"] },
      hausa ? "Lambar wayar da ka rubuta ba daidai ba ce. Da fatan ka sake aiko ta (misali 08012345678)."
            : "That phone number doesn't look valid. Please send it again (for example 08012345678).");
  }

  const wantNetwork = request.network;
  const wantVariant = request.variant;
  const sized = ctx.eligibleProducts.filter((p) => sameSize(productSize(p), request.size));
  const matches = sized
    .filter((p) => !wantNetwork || productNetwork(p) === wantNetwork)
    .filter((p) => !wantVariant || productVariant(p).includes(wantVariant))
    .sort(byPriceThenNetwork);

  if (!matches.length) {
    const sizes = Array.from(new Map(ctx.eligibleProducts.map((p) => [productSize(p)?.mb, productSize(p)?.label])).entries())
      .filter(([mb]) => mb != null).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, label]) => label);
    const scope = [wantNetwork ? wantNetwork.toUpperCase() : null, wantVariant].filter(Boolean).join(" ");
    return reply(ctx, { products: [], missing_fields: [] },
      (scope ? `There is no active ${request.size.label} ${scope} plan right now.` : `There is no active ${request.size.label} plan right now.`) +
      (sizes.length ? ` Available sizes: ${sizes.join(", ")}.` : "") + " I did not pick a different network or plan for you.");
  }

  // Always let the customer choose, even if only one plan matches: nothing is selected on their behalf.
  const choices = matches.map(productSpecification);
  await savePending(ctx, {}, {
    last_intent: "purchase_intent", service_type: "data",
    pending_selection: { size_mb: request.size.mb, product_ids: matches.map((p) => p.id), phone, created_at: new Date().toISOString() },
  });
  const networks = new Set(matches.map(productNetwork));
  const lead = hausa
    ? "Na samu data plans masu girman da ka nema. Duba network, nau'in data, validity da farashi, sannan ka zaɓi plan ɗin da kake so."
    : networks.size > 1
      ? `I found ${request.size.label} plans on ${networks.size} networks. Compare the network, data type, validity and price, then choose the one you want.`
      : `I found ${matches.length === 1 ? "1 matching plan" : `${matches.length} matching plans`} for ${request.size.label}. Choose the one you want.`;
  return reply(ctx, {
    products: choices, phone_number: phone, customer_input: phone ? { phone } : {},
    missing_fields: phone ? [] : ["phone"], requires_confirmation: false,
  }, lead + "\n" + matches.map((p, i) => `${i + 1}. ${choiceLine(p)}`).join("\n") + (phone ? "" : "\nI'll ask for the recipient number after you choose."));
}

// ---------------------------------------------------------------------------------------
// Follow-up while a selection is open: "2", "option 1", "mtn", "airtel gifting", or a phone number
// ---------------------------------------------------------------------------------------
export async function handleSelectionFollowUp(ctx: DataRequestContext): Promise<Response | null> {
  const sel = ctx.conversationContext?.pending_selection;
  if (!sel || !Array.isArray(sel.product_ids)) return null;
  const message = String(ctx.originalMessage || "").trim();
  const age = Date.now() - new Date(sel.created_at || 0).getTime();
  const expired = !Number.isFinite(age) || age > SELECTION_TTL_MS;
  const confirmation = classifyConfirmation(message);

  if (confirmation === "cancel") {
    await savePending(ctx, NO_PENDING, { pending_selection: null });
    return reply(ctx, { products: [], cancelled: true }, "Okay, I cancelled that request. No money was deducted.");
  }
  if (expired) { await savePending(ctx, {}, { pending_selection: null }); return null; }
  if (confirmation === "confirm") return null; // nothing chosen yet, so nothing to confirm
  if (parseDataPurchaseRequest(message).isDataPurchase) return null; // a new request, handled elsewhere

  const hausa = isHausa(message) || String(ctx.conversationContext?.language || "") === "hausa";
  const options = ctx.eligibleProducts.filter((p) => sel.product_ids.includes(p.id)).sort(byPriceThenNetwork);
  const phoneInMessage = parsePhone(message).phone;
  const chosenId = sel.chosen_product_id as string | undefined;

  // A recipient number arriving after a plan was chosen completes the confirmation.
  if (chosenId && phoneInMessage) {
    const chosen = options.find((p) => p.id === chosenId);
    if (chosen) return startConfirmation(ctx, chosen, phoneInMessage, hausa);
  }
  if (!chosenId && phoneInMessage && /^\s*(?:\+?234|0)[\d\s-]+$/.test(message)) {
    await savePending(ctx, {}, { pending_selection: { ...sel, phone: phoneInMessage } });
    return reply(ctx, { products: options.map(productSpecification), phone_number: phoneInMessage, customer_input: { phone: phoneInMessage } },
      "Got the number. Now choose which plan you want:\n" + options.map((p, i) => `${i + 1}. ${choiceLine(p)}`).join("\n"));
  }

  const numberMatch = message.match(/^(?:option|choice|number|no\.?)?\s*(\d{1,2})[.)]?$/i);
  let narrowed = options;
  if (numberMatch) {
    const picked = options[Number(numberMatch[1]) - 1];
    narrowed = picked ? [picked] : [];
  } else {
    const network = parseNetwork(message);
    const variant = parseVariant(message);
    if (!network && !variant) return null; // unrelated message: leave the selection open, let the normal flow answer
    narrowed = options.filter((p) => (!network || productNetwork(p) === network) && (!variant || productVariant(p).includes(variant)));
  }

  if (narrowed.length === 1) {
    const phone = sel.phone || null;
    if (phone) return startConfirmation(ctx, narrowed[0], phone, hausa);
    await savePending(ctx, {}, { pending_selection: { ...sel, chosen_product_id: narrowed[0].id } });
    return reply(ctx, { product: narrowed[0], products: [], missing_fields: ["phone"] },
      `${hausa ? "Ka zaɓi" : "You chose"} ${describePlan(narrowed[0])}. ${hausa ? "Ka aiko lambar wayar mai karɓa." : "Please send the recipient's phone number."}`);
  }
  const list = narrowed.length ? narrowed : options;
  return reply(ctx, { products: list.map(productSpecification), phone_number: sel.phone || null, customer_input: sel.phone ? { phone: sel.phone } : {} },
    (narrowed.length ? "Several plans still match. Please choose one:\n" : "I couldn't match that to the plans above. Please choose one:\n") +
    list.map((p, i) => `${i + 1}. ${choiceLine(p)}`).join("\n"));
}
