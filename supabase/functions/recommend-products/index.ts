import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Strategy = "cheapest" | "most_data" | "best_value";

function parseBudget(value: unknown): number {
  const text = String(value ?? "");
  const patterns = [
    /(?:₦|NGN|naira)\s*([0-9][0-9,]*(?:\.\d+)?)/i,
    /([0-9][0-9,]*(?:\.\d+)?)\s*(?:₦|NGN|naira)\b/i,
    /\b(?:under|below|within|for|budget(?:\s+of)?|with|have|got)\s*₦?\s*(?:NGN\s*)?([0-9][0-9,]*(?:\.\d+)?)/i,
    /\b([0-9]+(?:\.\d+)?)\s*(?:k|thousand)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const raw = m[1].replace(/,/g, "");
    if (raw.replace(/\D/g, "").length >= 9) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return /\b(?:k|thousand)\b/i.test(m[0]) ? n * 1000 : n;
    }
  }
  return 0;
}

function networkKey(value: unknown): string {
  const s = String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (s === "etisalat" || s === "t2" || s.startsWith("9mobile")) return "9mobile";
  return s;
}

function requestedNetwork(text: string): string {
  if (/\bmtn\b/i.test(text)) return "mtn";
  if (/\bairtel\b/i.test(text)) return "airtel";
  if (/\bglo\b/i.test(text)) return "glo";
  if (/\b(?:9mobile|etisalat|t2)\b/i.test(text)) return "9mobile";
  return "";
}

function strategyFor(text: string): Strategy {
  if (/\b(?:most|maximum|max|biggest|largest|highest)\s+(?:gb|data|internet)\b/i.test(text)) return "most_data";
  if (/\b(?:cheap|cheapest|cheaper|lowest price|least expensive)\b/i.test(text)) return "cheapest";
  return "best_value";
}

function dataGb(p: any): number {
  for (const source of [p?.volume, p?.product_name]) {
    const m = String(source ?? "").toLowerCase().replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)\s*(tb|gb|mb|kb)\b/);
    if (!m) continue;
    const n = Number(m[1]);
    if (m[2] === "tb") return n * 1024;
    if (m[2] === "gb") return n;
    if (m[2] === "mb") return n / 1024;
    return n / 1048576;
  }
  return 0;
}

function validityDays(p: any): number {
  if (p?.validity_type === "unlimited") return 1000000;
  const n = Number(p?.validity_value ?? 0);
  const unit = String(p?.validity_unit ?? "").toLowerCase();
  if (!Number.isFinite(n)) return 0;
  if (unit.startsWith("month")) return n * 30;
  if (unit.startsWith("week")) return n * 7;
  if (unit.startsWith("day")) return n;
  if (unit.startsWith("hour")) return n / 24;
  return 0;
}

function rank(products: any[], strategy: Strategy): any[] {
  return products.slice().sort((a, b) => {
    const ag = dataGb(a), bg = dataGb(b);
    const ap = Number(a.selling_price), bp = Number(b.selling_price);
    const av = ap > 0 ? ag / ap : 0;
    const bv = bp > 0 ? bg / bp : 0;
    const ad = validityDays(a), bd = validityDays(b);
    if (strategy === "most_data") return (bg - ag) || (ap - bp) || (bd - ad);
    if (strategy === "cheapest") return (ap - bp) || (bg - ag) || (bd - ad);
    return (bv - av) || (bg - ag) || (ap - bp) || (bd - ad);
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Internal-only endpoint: the Telegram webhook supplies the trusted wallet balance.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey || req.headers.get("authorization") !== "Bearer " + serviceRoleKey) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ success: false, error: "POST required" }), {
        status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json();
    const message = String(body?.message ?? "").trim();
    const walletBalance = Number(body?.wallet_balance ?? 0);
    if (!message) {
      return new Response(JSON.stringify({ success: false, error: "message is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const budgetFromMessage = parseBudget(message);
    const requestedBudget = budgetFromMessage > 0 ? budgetFromMessage : Math.max(0, walletBalance);
    const affordableBudget = Math.min(requestedBudget, Math.max(0, walletBalance));
    const strategy = strategyFor(message);
    const network = requestedNetwork(message);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data, error } = await supabase
      .from("products")
      .select("id,service_type,product_name,volume,selling_price,active,sku,validity_value,validity_unit,validity_type,network_id,service_networks(code,name)")
      .eq("active", true)
      .eq("service_type", "data");

    if (error) throw error;

    const all = (data ?? []).map((p: any) => {
      const n = Array.isArray(p.service_networks) ? p.service_networks[0] : p.service_networks;
      return { ...p, network: n?.code ?? null, network_name: n?.name ?? null };
    });

    const scoped = network ? all.filter((p: any) => networkKey(p.network ?? p.network_name) === network) : all;
    const affordable = scoped.filter((p: any) => Number(p.selling_price) <= affordableBudget);

    let ranked = rank(affordable, strategy);

    // Default behavior: when the customer did not name a network, diversify across
    // networks so one network cannot occupy all three recommendation slots.
    // Explicit network requests remain fully scoped to that network.
    let selected: any[];
    if (!network) {
      const byNetwork = new Map<string, any[]>();
      for (const p of ranked) {
        const key = networkKey(p.network ?? p.network_name) || "unknown";
        if (!byNetwork.has(key)) byNetwork.set(key, []);
        byNetwork.get(key)!.push(p);
      }

      const networkBest = Array.from(byNetwork.values())
        .map(items => items[0])
        .sort((a, b) => rank([a, b], strategy)[0] === a ? -1 : 1);

      selected = [];
      for (const p of networkBest) {
        if (selected.length >= 3) break;
        selected.push(p);
      }

      // If fewer than 3 networks have affordable plans, fill remaining slots
      // with the strongest remaining plans without duplicating a product.
      if (selected.length < 3) {
        const selectedIds = new Set(selected.map(p => String(p.id)));
        for (const p of ranked) {
          if (selected.length >= 3) break;
          if (selectedIds.has(String(p.id))) continue;
          selected.push(p);
          selectedIds.add(String(p.id));
        }
      }
    } else {
      selected = ranked.slice(0, 3);
    }

    const recommendations = selected.map((p: any, i: number) => ({
      rank: i + 1,
      product_id: p.id,
      product_name: p.product_name,
      volume: p.volume,
      network: p.network,
      network_name: p.network_name,
      selling_price: Number(p.selling_price),
      validity_value: p.validity_value,
      validity_unit: p.validity_unit,
      validity_type: p.validity_type,
      sku: p.sku,
    }));

    const money = (n: number) => "₦" + Number(n || 0).toLocaleString("en-NG");
    const label = network ? String(network).toUpperCase() : "data";
    let answer = "";

    if (walletBalance <= 0) {
      answer = "Your wallet balance is ₦0. Please fund your wallet first.";
    } else if (!scoped.length) {
      answer = "There are currently no active " + label + " data plans.";
    } else if (walletBalance < Math.min(...scoped.map((p: any) => Number(p.selling_price)))) {
      answer = "Your wallet balance is " + money(walletBalance) + ", which is below the cheapest available plan.";
    } else if (!recommendations.length) {
      answer = "No " + label + " data plan is available within " + money(requestedBudget) + ".";
    } else {
      const title = strategy === "most_data" ? "most data" : strategy === "cheapest" ? "cheapest" : "best-value";
      answer = "Here are the " + title + " options" + (network ? " for " + network.toUpperCase() : " across available networks") + " within " + money(requestedBudget) + ".";
    }

    return new Response(JSON.stringify({
      success: true,
      intent: "budget_recommendation",
      strategy,
      requested_network: network || null,
      requested_budget: requestedBudget,
      affordable_budget: affordableBudget,
      wallet_balance: walletBalance,
      recommendations,
      requires_selection: recommendations.length > 0,
      answer,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("recommend-products error", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Recommendation failed"
    }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});