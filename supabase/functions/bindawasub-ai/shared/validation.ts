export function normalizeChannel(value: unknown, fallback = "web") {
  const channel = String(value || fallback).trim().toLowerCase();
  return channel || fallback;
}

export function requirePositiveAmount(value: unknown, field = "amount") {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid " + field + ".");
  return amount;
}