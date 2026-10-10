// A plan is offered for purchase only if the customer could actually buy it right now:
// the product, its network and its data type are active, and at least one active provider
// mapping points at a provider that is itself active. Mirrors the admin dashboard's model.
function one(value: any) { return Array.isArray(value) ? value[0] : value; }

export async function filterEligibleDataProducts(supabase: any, products: any[]): Promise<any[]> {
  const candidates = (products || []).filter((p: any) =>
    p?.active !== false &&
    one(p?.service_networks)?.active !== false &&
    one(p?.service_variants)?.active !== false
  );
  if (!candidates.length) return [];

  const ids = candidates.map((p: any) => p.id);
  const { data: mappings, error: mappingError } = await supabase
    .from("provider_plan_mappings")
    .select("product_id,provider_id,active,provider_status")
    .in("product_id", ids)
    .eq("active", true);
  if (mappingError) throw mappingError;

  const providerIds = Array.from(new Set((mappings || []).map((m: any) => m.provider_id)));
  const { data: providers, error: providerError } = providerIds.length
    ? await supabase.from("api_providers").select("id,status").in("id", providerIds)
    : { data: [], error: null };
  if (providerError) throw providerError;

  const activeProviders = new Set((providers || [])
    .filter((p: any) => String(p.status || "").toLowerCase() === "active")
    .map((p: any) => p.id));
  const executable = new Set((mappings || [])
    .filter((m: any) => String(m.provider_status || "active").toLowerCase() === "active" && activeProviders.has(m.provider_id))
    .map((m: any) => m.product_id));

  return candidates.filter((p: any) => executable.has(p.id));
}

// Loads the full eligible data catalog (same query shape the AI path uses).
export async function loadEligibleDataProducts(supabase: any): Promise<any[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, sku, service_type, product_name, volume, validity_value, validity_unit, validity_type, selling_price, display_order, metadata, network_id, variant_id, service_networks(code,name,active), service_variants(code,name,active)")
    .eq("active", true)
    .eq("service_type", "data")
    .order("selling_price", { ascending: true });
  if (error) throw error;
  return await filterEligibleDataProducts(supabase, data || []);
}
