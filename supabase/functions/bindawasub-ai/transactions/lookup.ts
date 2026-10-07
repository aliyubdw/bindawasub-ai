export async function loadCustomerTransaction(
  supabase: any,
  userId: string,
  transactionId: string,
) {
  const { data, error } = await supabase
    .from("transactions")
    .select(`
      id, created_at, phone_number, amount, status, provider, provider_reference,
      description, service_type, product_id,
      products (product_name, volume, validity_type, validity_value, validity_unit,
        service_networks(code,name), service_variants(code,name))
    `)
    .eq("id", transactionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Customer transaction readback error:", error);
    return null;
  }
  return data || null;
}
