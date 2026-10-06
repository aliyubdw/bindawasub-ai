export type ConversationManagerContext = {
  supabase: any;
  userId: string;
  channel: string;
};

export async function loadOrCreateConversation(
  ctx: ConversationManagerContext,
  conversationId: string | null,
  defaultLanguage: string
) {
  let existingConversation: any = null;

  if (conversationId) {
    const result = await ctx.supabase
      .from("ai_conversations")
      .select("id, conversation_context, pending_product_id, pending_phone_number, pending_at, pending_service_type, pending_airtime_amount, pending_network, pending_customer_input")
      .eq("id", conversationId)
      .eq("user_id", ctx.userId)
      .eq("channel", ctx.channel)
      .maybeSingle();

    if (result.error) throw result.error;

    if (!result.data) {
      return { error: "Conversation not found.", status: 404 };
    }

    existingConversation = result.data;
  } else {
    const result = await ctx.supabase
      .from("ai_conversations")
      .select("id, conversation_context, pending_product_id, pending_phone_number, pending_at, pending_service_type, pending_airtime_amount, pending_network, pending_customer_input")
      .eq("user_id", ctx.userId)
      .eq("channel", ctx.channel)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error) {
      console.error("Conversation lookup error:", result.error);
    }

    existingConversation = result.data;
  }

  if (existingConversation) {
    return {
      conversationId: existingConversation.id,
      conversationContext:
        existingConversation.conversation_context &&
        typeof existingConversation.conversation_context === "object"
          ? existingConversation.conversation_context
          : {},
      existingConversation
    };
  }

  const { data: newConversation, error } = await ctx.supabase
    .from("ai_conversations")
    .insert({
      user_id: ctx.userId,
      channel: ctx.channel,
      language: defaultLanguage || "english",
      started_at: new Date().toISOString(),
      last_message_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (error) {
    console.error("Conversation create error:", error);
    return { conversationId: null, conversationContext: {}, existingConversation: null };
  }

  return {
    conversationId: newConversation.id,
    conversationContext: {},
    existingConversation: null
  };
}

export async function touchConversation(
  supabase: any,
  conversationId: string,
  userId: string,
  channel: string
) {
  await supabase
    .from("ai_conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId)
    .eq("channel", channel);
}

export async function logAiMessage(
  supabase: any,
  conversationId: string | null,
  role: "user" | "assistant",
  message: string,
  intent: string | null = null,
  toolCalled: string | null = null
) {
  if (!conversationId || !message) return;

  try {
    await supabase.from("ai_messages").insert({
      conversation_id: conversationId,
      role,
      message,
      intent,
      tool_called: toolCalled
    });
  } catch (error) {
    console.error("AI message logging error:", error);
  }
}

export async function persistAssistantMessage(
  supabase: any,
  conversationId: string | null,
  answer: any,
  intent: string | null,
  toolCalled: string | null = null
) {
  const textValue = typeof answer === "string" ? answer : "";
  if (!textValue) return;
  await logAiMessage(supabase, conversationId, "assistant", textValue, intent, toolCalled);
}

export async function logAiActivity(
  supabase: any,
  userId: string,
  conversationId: string | null,
  channel: string,
  eventType: string,
  intent: string | null,
  userMessage: string | null,
  aiResponse: string | null,
  success: boolean,
  errorMessage: string | null = null,
  transactionId: string | null = null,
  metadata: Record<string, unknown> = {}
) {
  try {
    await supabase.from("ai_activity_log").insert({
      user_id: userId,
      conversation_id: conversationId,
      transaction_id: transactionId,
      channel,
      event_type: eventType,
      intent,
      user_message: userMessage,
      ai_response: aiResponse,
      success,
      error_message: errorMessage,
      metadata
    });
  } catch (error) {
    console.error("AI activity logging error:", error);
  }
}
