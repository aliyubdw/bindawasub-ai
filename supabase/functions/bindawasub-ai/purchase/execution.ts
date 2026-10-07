export async function executeViaProviderExecution(transactionId: string) {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceRoleKey || !supabaseUrl) {
    throw new Error("Supabase server configuration is incomplete.");
  }

  const response = await fetch(
    `${supabaseUrl}/functions/v1/provider-execution`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
      },
      body: JSON.stringify({
        action: "execute_purchase",
        transaction_id: transactionId,
      }),
    }
  );

  const raw = await response.text();
  let result: any;
  try {
    result = JSON.parse(raw);
  } catch {
    result = { success: false, error: raw };
  }

  if (!response.ok) {
    throw new Error(result?.error || "Provider execution failed.");
  }
  return result;
}
