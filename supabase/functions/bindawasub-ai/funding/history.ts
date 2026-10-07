export function isFundingHistoryRequest(message: string): boolean {
  const text = String(message || "").trim().toLowerCase();
  return (
    text.includes("funding history") ||
    text.includes("funding histories") ||
    text.includes("show my funding") ||
    text.includes("my funding") ||
    text.includes("wallet funding") ||
    text.includes("funding transactions") ||
    text.includes("deposit history") ||
    text.includes("deposit histories") ||
    text.includes("show my deposits") ||
    text.includes("my deposits") ||
    text.includes("how did i fund my wallet") ||
    text.includes("how did i fund") ||
    text.includes("tarihin funding") ||
    text.includes("tarihin kudin wallet") ||
    text.includes("yadda na saka kudi") ||
    text.includes("kudin da na saka") ||
    text.includes("yadda na cika wallet") ||
    text.includes("cikawa wallet")
  );
}
