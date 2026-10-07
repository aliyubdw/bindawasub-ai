export function jsonResponse(
  data: any,
  corsHeaders: Record<string, string>,
  status = 200,
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(
  error: string,
  corsHeaders: Record<string, string>,
  status = 400,
) {
  return jsonResponse({ success: false, error }, corsHeaders, status);
}
