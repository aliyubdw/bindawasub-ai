// Is this message written in Hausa? Used to pick the language of backend-written replies.
// Deliberately conservative: only distinctive Hausa words count, so English is never answered in Hausa.
const HAUSA_MARKERS = new RegExp(
  "\\b(?:sannu|ina so|ina son|ina sa|zan|kudi|kudin|asusu|asusuna|duba|soke|yaya|taya|ta yaya|nawa ne|don allah|na gode|a'a|ba yanzu ba|saka|saya|sayi|siyo|siya|aika|kunna)\\b|\\ba sa (?:ma|wa)\\b",
  "i",
);

export function looksHausa(message: unknown): boolean {
  return HAUSA_MARKERS.test(String(message ?? "").toLowerCase().replace(/[\u2018\u2019`]/g, "'"));
}
