export async function getActiveDataCatalog(supabase: any) {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, sku, service_type, product_name, volume, selling_price, validity_type, validity_value, validity_unit, network_id, variant_id, service_networks(code,name), service_variants(code,name), metadata"
    )
    .eq("active", true)
    .eq("service_type", "data")
    .order("selling_price", { ascending: true });

  if (error) throw error;
  return data || [];
}

export function normalizeCatalogToken(value: any) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
