import { buildAiContext, AiContextInput } from "./context.ts";

export type GeminiRequest = AiContextInput & {
  userMessage: string;
};

export async function generateGeminiResponse({
  userMessage,
  ...contextInput
}: GeminiRequest) {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_" + "API_KEY");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const context = buildAiContext(contextInput);
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        model: "gemini-3.5-flash-lite",
        system_instruction: context.systemInstruction,
        input: JSON.stringify({
          current_user_message: userMessage,
          conversation_history: contextInput.conversationHistory?.slice(-12) || []
        }),
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              intent: { type: "string" },
              network: { type: ["string", "null"] },
              volume: { type: ["string", "null"] },
              amount: { type: "number" },
              phone_number: { type: ["string", "null"] },
              product_id: { type: ["string", "null"] },
              product_name: { type: ["string", "null"] },
              variant: { type: ["string", "null"] },
              transaction_id: { type: ["string", "null"] },
              service_type: { type: ["string", "null"] },
              customer_input: { type: "object" },
              language: { type: "string" },
              reply: { type: "string" }
            },
            required: [
              "intent",
              "network",
              "volume",
              "amount",
              "phone_number",
              "product_id",
              "product_name",
              "transaction_id",
              "variant",
              "service_type",
              "customer_input",
              "language",
              "reply"
            ]
          }
        }
      })
    }
  );

  if (!response.ok) {
    console.error("Gemini API error:", await response.text());
    throw new Error("Gemini AI request failed");
  }

  const data = await response.json();
  const outputText =
    data?.steps
      ?.filter((step: any) => step?.type === "model_output")
      ?.flatMap((step: any) => step?.content || [])
      ?.filter((item: any) => item?.type === "text")
      ?.map((item: any) => item.text)
      ?.join("") || "";

  if (!outputText) throw new Error("Gemini returned an empty response");
  return JSON.parse(outputText);
}
