export function buildPurchaseConfirmation(
  tx: any,
  fallbackPurchase: any,
  execution: any,
) {
  const product = Array.isArray(tx?.products) ? tx.products[0] : tx?.products;
  const networkInfo = Array.isArray(product?.service_networks)
    ? product.service_networks[0]
    : product?.service_networks;
  const variantInfo = Array.isArray(product?.service_variants)
    ? product.service_variants[0]
    : product?.service_variants;
  const reference =
    tx?.provider_reference ||
    execution?.provider_reference ||
    fallbackPurchase?.provider_reference ||
    null;
  const description =
    tx?.description ||
    fallbackPurchase?.description ||
    product?.product_name ||
    "Purchase";
  const productName =
    product?.product_name || fallbackPurchase?.product_name || description;
  const phoneNumber =
    tx?.phone_number ||
    fallbackPurchase?.phone_number ||
    fallbackPurchase?.customer_input?.phone ||
    null;
  const amount = Number(tx?.amount ?? fallbackPurchase?.amount ?? 0);
  const status =
    tx?.status || execution?.status || fallbackPurchase?.status || "pending";
  const provider =
    tx?.provider || execution?.provider || fallbackPurchase?.provider || null;

  return {
    transaction_id:
      tx?.id ||
      fallbackPurchase?.id ||
      fallbackPurchase?.transaction_id ||
      execution?.transaction_id ||
      null,
    date: tx?.created_at || fallbackPurchase?.created_at || null,
    description,
    product_name: productName,
    service_type: tx?.service_type || fallbackPurchase?.service_type || null,
    network:
      networkInfo?.code ||
      networkInfo?.name ||
      fallbackPurchase?.network ||
      null,
    variant:
      variantInfo?.code ||
      variantInfo?.name ||
      fallbackPurchase?.variant ||
      null,
    volume: product?.volume || fallbackPurchase?.volume || null,
    phone_number: phoneNumber,
    amount,
    status,
    provider,
    reference,
    provider_reference: reference,
    provider_message: execution?.message || null,
  };
}
