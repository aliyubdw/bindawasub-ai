import { getActiveDataCatalog, normalizeCatalogToken } from "./list.ts";

function response(data: any, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export async function handleProductEnquiry({
  supabase,
  originalMessage,
  message,
  conversationContext,
  corsHeaders,
  shouldUseGeminiFirst,
}: {
  supabase: any;
  originalMessage: string;
  message: string;
  conversationContext: any;
  corsHeaders: Record<string, string>;
  shouldUseGeminiFirst: boolean;
}): Promise<Response | null> {
  const isPriceQuery =
    /\b(?:how\s+much|price|cost|what(?:'s| is)\s+the\s+price)\b/i.test(originalMessage) &&
    /\b[0-9]+(?:\.[0-9]+)?\s*(?:kb|mb|gb|tb)\b/i.test(originalMessage);
  if (isPriceQuery) return null;

  const hasPurchaseVerbAndDataSize =
    /\b(?:buy|purchase|send|get|give|need|want|order|activate|subscribe|saya|sayi|siyo|siya|oda|aika|kunna)\b/i.test(originalMessage) &&
    /\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb)\b/i.test(originalMessage);
  const namesNetwork = /\b(?:mtn|airtel|glo|9mobile|t2)\b/i.test(originalMessage);
  if (hasPurchaseVerbAndDataSize && !namesNetwork) return null;

  if (
    shouldUseGeminiFirst ||
    !(
      message.includes("data") ||
      message.includes("package") ||
      message.includes("plan") ||
      /\b(mtn|airtel|glo|9mobile|t2)\b/i.test(message)
    )
  ) {
    return null;
  }

  const requestedNetwork =
    /\bmtn\b/i.test(originalMessage) ? "mtn" :
    /\bairtel\b/i.test(originalMessage) ? "airtel" :
    /\bglo\b/i.test(originalMessage) ? "glo" :
    /\b(?:9mobile|t2)\b/i.test(originalMessage) ? "9mobile" :
    normalizeCatalogToken(conversationContext?.network) || null;

  const requestedVariant =
    /\b(?:sme|sme data|normal data)\b/i.test(originalMessage) ? "smedata" :
    /\b(?:social|social data)\b/i.test(originalMessage) ? "social" :
    /\b(?:gifting|gift|gift data)\b/i.test(originalMessage) ? "gifting" :
    /\bawoop\b/i.test(originalMessage) ? "awoop" :
    normalizeCatalogToken(conversationContext?.variant) || null;

  const activeDataProducts = await getActiveDataCatalog(supabase);

  const networkProducts = requestedNetwork
    ? activeDataProducts.filter((product: any) => {
        const network = Array.isArray(product.service_networks)
          ? product.service_networks[0]
          : product.service_networks;
        return (
          normalizeCatalogToken(network?.code) === requestedNetwork ||
          normalizeCatalogToken(network?.name) === requestedNetwork
        );
      })
    : activeDataProducts;

  const variantProducts = requestedVariant
    ? networkProducts.filter((product: any) => {
        const variant = Array.isArray(product.service_variants)
          ? product.service_variants[0]
          : product.service_variants;
        return (
          normalizeCatalogToken(variant?.code) === requestedVariant ||
          normalizeCatalogToken(variant?.name) === requestedVariant
        );
      })
    : networkProducts;

  const networkLabel =
    requestedNetwork === "9mobile"
      ? "9mobile (T2)"
      : requestedNetwork
        ? requestedNetwork.toUpperCase()
        : null;

  if (requestedNetwork && networkProducts.length === 0) {
    return response({
      success: true,
      intent: "product_enquiry",
      service_type: "data",
      network: requestedNetwork,
      products: [],
      available: false,
      answer: "There are currently no active data plans for " + networkLabel + ".",
    }, corsHeaders);
  }

  if (requestedNetwork && !requestedVariant) {
    const groupedTypes = Array.from(
      new Map(
        networkProducts.map((product: any) => {
          const variant = Array.isArray(product.service_variants)
            ? product.service_variants[0]
            : product.service_variants;
          const key =
            normalizeCatalogToken(variant?.code || variant?.name) || "data";
          return [
            key,
            {
              code: variant?.code || null,
              name: variant?.name || variant?.code || "Data",
              plan_count: 0,
            },
          ];
        }),
      ).values(),
    ).map((type: any) => ({
      ...type,
      plan_count: networkProducts.filter((product: any) => {
        const variant = Array.isArray(product.service_variants)
          ? product.service_variants[0]
          : product.service_variants;
        return (
          normalizeCatalogToken(variant?.code || variant?.name) ===
          normalizeCatalogToken(type.code || type.name)
        );
      }).length,
    }));

    return response({
      success: true,
      intent: "product_enquiry",
      service_type: "data",
      network: requestedNetwork,
      network_name: networkLabel,
      data_types: groupedTypes,
      products: networkProducts,
      grouped_by: "data_type",
      answer:
        "Here are all available " +
        networkLabel +
        " data plans, grouped by data type.",
    }, corsHeaders);
  }

  if (requestedNetwork && requestedVariant && variantProducts.length === 0) {
    const variantLabel =
      requestedVariant === "smedata"
        ? "SME Data"
        : requestedVariant === "social"
          ? "Social Data"
          : requestedVariant === "gifting"
            ? "Gifting"
            : requestedVariant;

    return response({
      success: true,
      intent: "product_enquiry",
      service_type: "data",
      network: requestedNetwork,
      network_name: networkLabel,
      variant: requestedVariant,
      products: [],
      available: false,
      answer:
        variantLabel + " is currently not available on " + networkLabel + ".",
    }, corsHeaders);
  }

  return response({
    success: true,
    intent: "product_enquiry",
    service_type: "data",
    network: requestedNetwork,
    network_name: networkLabel,
    variant: requestedVariant,
    products: variantProducts,
    answer: requestedVariant
      ? "Here are the available " +
        (requestedVariant === "smedata"
          ? "SME Data"
          : requestedVariant === "social"
            ? "Social Data"
            : requestedVariant === "gifting"
              ? "Gifting"
              : requestedVariant) +
        " plans on " +
        networkLabel +
        "."
      : "Here are the available Bindawasub data plans.",
  }, corsHeaders);
}
