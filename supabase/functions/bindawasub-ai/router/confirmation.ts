// Keep confirmations and cancellations on the pending-purchase path instead of action routing.
export function isPurchaseConfirmationMessage(value: unknown): boolean {
  const message = String(value ?? "").trim();
  return /^(?:yes|yeah|yep|ok|okay|confirm|confirmed|proceed|go ahead|do it|eh|e|naam|toh|no|nope|cancel|stop|a'a|ba na so|kar a(?: yi)?)(?:\b|$)/i.test(message);
}
