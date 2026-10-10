// Data-size parsing shared by every catalog lookup.
//
// Production catalog shape (verified read-only): products.volume holds only the UNIT
// ("GB" / "MB") and products.product_name holds the size ("1 GB", "1.5 GB", "500 MB").
// Comparing a requested "1GB" to products.volume therefore never matches, which is the
// root cause of the unscoped-purchase failure. Sizes are compared numerically in MB.

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)\b/i;
const UNIT_TO_MB: Record<string, number> = { kb: 1 / 1024, mb: 1, gb: 1024, tb: 1024 * 1024 };

export type DataSize = { mb: number; label: string };

export function parseDataSize(value: unknown): DataSize | null {
  const match = String(value ?? "").match(SIZE_RE);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase();
  return { mb: amount * UNIT_TO_MB[unit], label: `${match[1]} ${unit.toUpperCase()}` };
}

// Size of a catalog product. Tries product_name ("1 GB"), then "<name> <volume>" for rows
// that store "1" + "GB" separately, then volume on its own ("1GB").
export function productSize(product: any): DataSize | null {
  const name = String(product?.product_name ?? "").trim();
  const volume = String(product?.volume ?? "").trim();
  return parseDataSize(name) || parseDataSize(`${name} ${volume}`) || parseDataSize(volume);
}

export function sameSize(a: DataSize | null, b: DataSize | null): boolean {
  return !!a && !!b && Math.abs(a.mb - b.mb) < 0.01;
}

export function productMatchesSize(product: any, requested: unknown): boolean {
  return sameSize(productSize(product), parseDataSize(requested));
}
