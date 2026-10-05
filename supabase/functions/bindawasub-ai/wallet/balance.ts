export async function getWalletBalance(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("get_my_balance", { p_user_id: userId });
  if (error) throw error;
  const wallet = data?.[0];
  return { balance: Number(wallet?.balance ?? 0), currency: wallet?.currency || "NGN" };
}
