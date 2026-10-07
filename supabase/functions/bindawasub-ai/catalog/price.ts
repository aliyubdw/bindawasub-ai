import { formatCatalogProduct } from "./format.ts";

function normalize(value: any) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function networkFromMessage(message: string) {
  if (/\bmtn\b/i.test(message)) return "mtn";
  if (/\bairtel\b/i.test(message)) return "airtel";
  if (/\bglo\b/i.test(message)) return "glo";
  if (/\b(?:9mobile|t2)\b/i.test(message)) return "9mobile";
  return "";
}
function volumeInMb(value: any) {
  const match = String(value ?? "").trim().match(/([0-9]+(?:\.[0-9]+)?)\s*(kb|mb|gb|tb)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) return null;
  if (unit === "kb") return amount / 1024;
  if (unit === "mb") return amount;
  if (unit === "gb") return amount * 1024;
  if (unit === "tb") return amount * 1024 * 1024;
  return null;
}
function requestedVolumeInMb(message: string) {
  const match = message.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(kb|mb|gb|tb)\b/i);
  return match ? volumeInMb(match[0]) : null;
}
function productNetwork(product: any) {
  const network = Array.isArray(product?.service_networks) ? product.service_networks[0] : product?.service_networks;
  return normalize(network?.code) || normalize(network?.name);
}
function productVariant(product: any) {
  const variant = Array.isArray(product?.service_variants) ? product.service_variants[0] : product?.service_variants;
  return { code: normalize(variant?.code), name: normalize(variant?.name) };
}
export function handleDeterministicDataPriceQuery(message: string, products: any[]) {
  const text = String(message || "").trim();
  if (!/\b(?:how\s+much|price|cost|what(?:\x27s| is)\s+the\s+price)\b/i.test(text)) return null;
  const network = networkFromMessage(text);
  const requestedMb = requestedVolumeInMb(text);
  if (!network || requestedMb == null) return null;
  let candidates = (Array.isArray(products) ? products : []).filter((product: any) =>
    String(product?.service_type || "").toLowerCase() === "data" &&
    Math.abs(Number(volumeInMb(product?.volume)) - requestedMb) < 0.01 &&
    productNetwork(product) === network,
  );
  const variantToken =
    /\b(?:sme|sme\s+data)\b/i.test(text) ? "smedata" :
    /\b(?:social|social\s+data)\b/i.test(text) ? "social" :
    /\b(?:gifting|gift|gift\s+data)\b/i.test(text) ? "gifting" :
    /\bawoop\b/i.test(text) ? "awoop" : "";
  if (variantToken) candidates = candidates.filter((product: any) => {
    const variant = productVariant(product);
    return variant.code === variantToken || variant.name === variantToken;
  });
  if (candidates.length === 1) {
    const product = formatCatalogProduct(candidates[0]);
    const price = Number(candidates[0].selling_price || 0);
    return { type: "price" as const, product, answer: (product.product_name || product.volume) + " on " + (product.network_name || network.toUpperCase()) + " is ₦" + price.toLocaleString("en-NG") + "." };
  }
  if (candidates.length > 1 && !variantToken) {
    const label = requestedMb >= 1024 ? (requestedMb / 1024) + "GB" : requestedMb + "MB";
    const choices = candidates.map((product: any) => {
      const formatted = formatCatalogProduct(product);
      return (formatted.variant_name || "Data") + ": ₦" + Number(product.selling_price || 0).toLocaleString("en-NG");
    });
    return { type: "multiple" as const, products: candidates.map(formatCatalogProduct), answer: "There are " + candidates.length + " " + label + " " + network.toUpperCase() + " options. " + choices.join(" | ") + ". Tell me the data type you want." };
  }
  return null;
}