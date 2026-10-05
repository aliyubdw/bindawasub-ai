export async function getCustomerTransactions(supabase: any, userId: string, transactionId: string | null, action: string) {
  let recentTransactions: any[] = [];
  let transactionError: any = null;
  const txSelect = `
          id, created_at, phone_number, amount, status, provider, provider_reference, product_id, description, service_type,
          products (
            product_name, service_type, volume, validity_value, validity_unit, validity_type,
            service_networks(code,name), service_variants(code,name)
          )
        `;
  if (transactionId) {
    const exactTx = await supabase.from("transactions").select(txSelect)
      .eq("user_id", userId).eq("id", String(transactionId)).maybeSingle();
    if (exactTx.error) transactionError = exactTx.error;
    else if (exactTx.data) recentTransactions = [exactTx.data];
  }
  if (!recentTransactions.length) {
    const fallbackQuery = await supabase.from("transactions").select(txSelect)
      .eq("user_id", userId).order("created_at", { ascending: false })
      .limit(action === "transaction_history" ? 5 : 3);
    recentTransactions = fallbackQuery.data || [];
    transactionError = fallbackQuery.error;
  }
  if (transactionError) throw transactionError;
  return recentTransactions;
}
