export async function createManualFundingRequest(supabase: any, userId: string, amount: number) {
      const { data: settings, error: settingsError } = await supabase
        .from("manual_funding_settings")
        .select("active, bank_name, account_name, account_number, instructions")
        .eq("id", 1)
        .maybeSingle();

      if (settingsError) throw settingsError;
      if (!settings?.active) return { success:false, error:"Manual wallet funding is temporarily unavailable." };
      if (!Number.isFinite(amount) || amount <= 0) return { success:false, error:"Funding amount must be greater than zero." };

      const reference = `MFR-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
      const { data: request, error: requestError } = await supabase
        .from("manual_funding_requests")
        .insert({ user_id:userId, amount, reference, status:"pending" })
        .select("id, amount, reference, status, created_at")
        .single();

      if (requestError) throw requestError;

      return {
        success:true,
        request,
        bank_account: settings.account_number ? {
          bank_name:settings.bank_name,
          account_name:settings.account_name,
          account_number:settings.account_number
        } : null,
        instructions:settings.instructions || "Transfer the exact amount to the configured Bindawasub bank account, then submit your transfer reference."
      };
}