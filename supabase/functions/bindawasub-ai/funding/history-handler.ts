function response(data: any, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleFundingHistory(
  supabase: any,
  userId: string,
  corsHeaders: Record<string, string>,
  limitValue: unknown,
) {
  const requestedLimit = Math.min(Math.max(Number(limitValue || 5), 1), 10);
  const { data: fundingRows, error: fundingError } = await supabase
    .from("wallet_funding")
    .select("id, amount, reference, billstack_reference, status, payment_method, created_at, completed_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(requestedLimit);

  if (fundingError) {
    console.error("Funding history error:", fundingError);
    throw fundingError;
  }

  const formattedFunding = (fundingRows || []).map((funding: any) => ({
    id: funding.id,
    amount: Number(funding.amount || 0),
    reference: funding.reference || null,
    billstack_reference: funding.billstack_reference || null,
    status: funding.status || "unknown",
    payment_method: funding.payment_method || null,
    date: funding.completed_at || funding.created_at,
  }));

  return response({
    success: true,
    intent: "funding_history",
    funding: formattedFunding,
    answer: formattedFunding.length > 0
      ? `Here are your latest ${formattedFunding.length} wallet funding transaction${formattedFunding.length === 1 ? "" : "s"}.`
      : "You do not have any wallet funding records yet.",
    ai_powered: false,
  }, 200, corsHeaders);
}
