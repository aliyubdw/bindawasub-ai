export async function loadAiConfig(supabase: any) {
  const { data, error } = await supabase
    .from("ai_settings")
    .select(
      "enabled, gemini_enabled, require_purchase_confirmation, max_purchase_amount, default_language, allowed_channels, fallback_message",
    )
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || {};
}

export function isChannelAllowed(config: any, channel: string) {
  const allowed = Array.isArray(config?.allowed_channels)
    ? config.allowed_channels.map((x: any) => String(x).toLowerCase())
    : ["web", "app", "whatsapp", "telegram"];
  return allowed.includes(String(channel).toLowerCase());
}
