export type ConversationContext = {
  supabase: any;
  userId: string;
  corsHeaders: Record<string,string>;
};

function response(data: any, status: number, corsHeaders: Record<string,string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

export async function handleNewConversation(ctx: ConversationContext, body: any) {
  const channel = String(body.channel || "web").toLowerCase();
  const { data, error } = await ctx.supabase
    .from("ai_conversations")
    .insert({
      user_id: ctx.userId,
      channel,
      language: "english",
      started_at: new Date().toISOString(),
      last_message_at: new Date().toISOString()
    })
    .select("id, channel, started_at, last_message_at")
    .single();

  if (error) throw error;

  return response({
    success: true,
    conversation_id: data.id,
    channel: data.channel,
    started_at: data.started_at,
    last_message_at: data.last_message_at
  }, 200, ctx.corsHeaders);
}

export async function handleConversationList(ctx: ConversationContext, body: any) {
  const channel = String(body.channel || "web").toLowerCase();
  const { data: conversations, error } = await ctx.supabase
    .from("ai_conversations")
    .select("id, channel, started_at, last_message_at")
    .eq("user_id", ctx.userId)
    .eq("channel", channel)
    .order("last_message_at", { ascending: false })
    .limit(30);

  if (error) throw error;

  const rows = conversations || [];
  const ids = rows.map((item: any) => item.id);
  let messages: any[] = [];

  if (ids.length) {
    const result = await ctx.supabase
      .from("ai_messages")
      .select("conversation_id, role, message, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: true })
      .limit(2000);

    if (result.error) throw result.error;
    messages = result.data || [];
  }

  const summaryById = new Map<string, any>();

  for (const row of messages) {
    if (!summaryById.has(row.conversation_id)) {
      summaryById.set(row.conversation_id, {
        first_user_message: row.role === "user" ? row.message : null,
        preview: row.message || "",
        message_count: 0
      });
    }

    const summary = summaryById.get(row.conversation_id);
    summary.message_count += 1;
    if (!summary.first_user_message && row.role === "user") summary.first_user_message = row.message;
    summary.preview = row.message || summary.preview;
  }

  const formatted = rows.map((conversation: any) => {
    const summary = summaryById.get(conversation.id) || {
      first_user_message: null,
      preview: "",
      message_count: 0
    };
    const titleSource = String(summary.first_user_message || summary.preview || "").trim();
    const title = titleSource
      ? (titleSource.length > 42 ? titleSource.slice(0, 42) + "…" : titleSource)
      : "New conversation";

    return {
      id: conversation.id,
      channel: conversation.channel,
      started_at: conversation.started_at,
      last_message_at: conversation.last_message_at,
      title,
      preview: summary.preview
        ? (String(summary.preview).length > 80 ? String(summary.preview).slice(0, 80) + "…" : String(summary.preview))
        : "",
      message_count: summary.message_count
    };
  });

  return response({
    success: true,
    channel,
    conversations: formatted
  }, 200, ctx.corsHeaders);
}

export async function handleConversationHistory(ctx: ConversationContext, body: any) {
  const channel = String(body.channel || "web").toLowerCase();
  const requestedId = String(body.conversation_id || "").trim();

  let query = ctx.supabase
    .from("ai_conversations")
    .select("id, channel, started_at, last_message_at")
    .eq("user_id", ctx.userId)
    .eq("channel", channel);

  if (requestedId) {
    query = query.eq("id", requestedId);
  } else {
    query = query.order("last_message_at", { ascending: false }).limit(1);
  }

  const { data: conversation, error } = await query.maybeSingle();
  if (error) throw error;

  if (!conversation) {
    return response({
      success: false,
      error: requestedId ? "Conversation not found." : "No conversation found.",
      channel,
      conversation_id: null,
      messages: []
    }, requestedId ? 404 : 200, ctx.corsHeaders);
  }

  const result = await ctx.supabase
    .from("ai_messages")
    .select("role, message, intent, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (result.error) throw result.error;

  return response({
    success: true,
    channel,
    conversation_id: conversation.id,
    started_at: conversation.started_at,
    last_message_at: conversation.last_message_at,
    messages: (result.data || []).reverse()
  }, 200, ctx.corsHeaders);
}
