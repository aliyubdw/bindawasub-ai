// Tolerant, deterministic detection of the account questions customers ask most:
// wallet balance, how to fund the wallet, and transaction history / status.
//
// The older detectors were anchored to exact phrases, so common wording such as
// "Check my wallet balance" or "How can I fund my wallet?" (the question mark!) missed them and
// fell through to Gemini. These answers are account data, so they must not depend on Gemini.
//
// A message is matched only when the WHOLE message is one of these requests. Anything with a
// number, a purchase or payment verb, a second request ("and ..."), or another person's wallet
// is left alone for the normal flow.
export type AccountIntent = "wallet_balance" | "fund_howto" | "transaction_history" | "transaction_status";

const FILLER = /\b(?:please|pls|plz|abeg|kindly|just|now|again|for me|min|hey|hi|hello)\b/g;
const POLITE_LEAD = /^(?:can you|could you|will you|would you|i want to|i wanna|i would like to|i'd like to|let me)\s+/;

function normalize(message: string): string {
  return String(message || "")
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(POLITE_LEAD, "");
}

const BAL = "(?:balan[cv]e|balence|blance|balanc)";
const BALANCE_PATTERNS: RegExp[] = [
  new RegExp(`^(?:(?:what is|whats|what's|what)\\s+)?(?:(?:check|show|view|see|tell|know|get|give|display)\\s+)?(?:me\\s+)?(?:my\\s+)?(?:wallet\\s+|account\\s+)?${BAL}(?:\\s+(?:please|now))?$`),
  /^how much (?:do i have|i have|is (?:in|left in|remaining in) my wallet|(?:money )?(?:do i have )?(?:left )?(?:in|remaining in) my wallet|is left|is remaining)$/,
  /^(?:check|show|view|see)\s+my\s+wallet$/,
  /^my wallet$/,
  /^wallet$/,
  // Hausa phrases that were already supported before this change
  /^nawa ne (?:kudin|money) (?:na|a) wallet(?: ta)?$/,
  /^duba balance$/,
  /^duba (?:asusuna|asusun na|wallet(?: na| dina)?)$/,
];

const FUND_PATTERNS: RegExp[] = [
  /^(?:how (?:do|can|should) i|how to|where (?:do|can) i|help me|can i)\s+(?:fund|top ?up|load|credit)(?: up)?(?: my)?(?: wallet| account)?$/,
  /^(?:how (?:do|can|should) i|how to)\s+(?:add|put|deposit)\s+money(?:\s+(?:to|in|into)\s+(?:my\s+)?(?:wallet|account))?$/,
  /^(?:fund|top ?up|load|credit)(?: up)?(?: my)?(?: wallet| account)?$/,
  /^(?:i )?(?:want|need|wanna)(?: to)? (?:fund|top ?up|load|credit)(?: up)?(?: my)?(?: wallet| account)?$/,
  /^(?:i )?(?:want|need|wanna)(?: to)? (?:add|put|deposit) money(?:\s+(?:to|in|into)\s+(?:my\s+)?(?:wallet|account))?$/,
  /^add money(?:\s+(?:to|in|into)\s+(?:my\s+)?(?:wallet|account))?$/,
  // Hausa phrases that were already supported before this change
  /^ta yaya zan yi funding$/,
  /^yaya zan kara kudi(?: a wallet)?$/,
  /^ina son na sa kudi(?: a wallet)?$/,
  // Confirmed Hausa phrasings. "ina sa in ..." is accepted too because customers really write it.
  /^(?:taya|yaya|ta yaya) zan (?:saka|sa|kara) kudi(?: a (?:wallet|asusu(?:na)?))?$/,
  /^ina (?:so|son|sa) (?:in|na) (?:saka|sa|kara) kudi(?: a (?:wallet|asusu(?:na)?))?$/,
];

const HISTORY_PATTERNS: RegExp[] = [
  /^(?:(?:what are|what were|what's|whats)\s+)?(?:(?:show|view|see|check|get|give|list|display)\s+)?(?:me\s+)?(?:my\s+)?(?:(?:recent|latest|past|previous|last(?: \d+)?)\s+)?(?:transactions|purchases|orders|transaction history|purchase history)$/,
  /^what (?:was|were) my last \d+ (?:transactions|purchases)$/,
];

const STATUS_PATTERNS: RegExp[] = [
  /^(?:check )?(?:the )?status$/,
  /^(?:is|was) it (?:successful|successfully done|done|delivered)$/,
  /^did it (?:go through|work|succeed)$/,
];

const BLOCKERS = [
  /\b(?:buy|purchase|send|recharge|pay|transfer|sell|order for)\b/,      // a purchase or payment, not a question
  /\b(?:and|then|also|but)\b/,                                            // two requests in one message
  /\b(?:friend|brother|sister|mother|mom|dad|someone|somebody|another|his|her|their|customer|user)\b/, // someone else's wallet
];

export function detectAccountIntent(message: string): AccountIntent | null {
  const text = normalize(message);
  if (!text || text.length > 60) return null;
  const hasDigits = /\d/.test(text);
  // Numbers are allowed only in "last 3 transactions"; amounts such as "fund 5000" belong to the funding flow.
  if (hasDigits && !/^what (?:was|were) my last \d+ (?:transactions|purchases)$|^(?:\w+ )*last \d+ (?:transactions|purchases)$/.test(text)) return null;
  if (BLOCKERS.some((re) => re.test(text))) return null;
  if (BALANCE_PATTERNS.some((re) => re.test(text))) return "wallet_balance";
  if (FUND_PATTERNS.some((re) => re.test(text))) return "fund_howto";
  if (HISTORY_PATTERNS.some((re) => re.test(text))) return "transaction_history";
  if (STATUS_PATTERNS.some((re) => re.test(text))) return "transaction_status";
  return null;
}
