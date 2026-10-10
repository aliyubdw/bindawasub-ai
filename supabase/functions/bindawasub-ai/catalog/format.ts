import { productSize } from "./size.ts";

function validityText(value:any,unit:any){
  const n=Number(value);
  const u=String(unit||"");
  return Number.isFinite(n)&&n===1?`1 ${u.replace(/s$/i,"")}`:`${value} ${u}`;
}

export function formatCatalogProduct(p:any){
  const n=Array.isArray(p.service_networks)?p.service_networks[0]:p.service_networks;
  const v=Array.isArray(p.service_variants)?p.service_variants[0]:p.service_variants;
  const duration=p.validity_type==="fixed"&&p.validity_value!=null&&p.validity_unit?validityText(p.validity_value,p.validity_unit):(p.validity_type==="unlimited"?"Unlimited":"");
  return {...p,network:n?.code||null,network_name:n?.name||null,variant:v?.code||null,variant_name:v?.name||null,duration};
}

export function productSpecification(p:any){
  const n=Array.isArray(p?.service_networks)?p.service_networks[0]:p?.service_networks;
  const v=Array.isArray(p?.service_variants)?p.service_variants[0]:p?.service_variants;
  const validity=p?.validity_type==="unlimited"
    ?"Unlimited"
    :(p?.validity_value!=null&&p?.validity_unit?validityText(p.validity_value,p.validity_unit):"");
  return {
    id:p?.id||null,
    service_type:p?.service_type||null,
    network:n?.code||n?.name||null,
    network_name:n?.name||null,
    variant:v?.code||v?.name||null,
    variant_name:v?.name||null,
    product_name:p?.product_name||null,
    volume:p?.volume||null,
    size:productSize(p)?.label||p?.product_name||null,
    validity,
    validity_value:p?.validity_value??null,
    validity_unit:p?.validity_unit??null,
    selling_price:Number(p?.selling_price||0),
    sku:p?.sku||null
  };
}

// One-line, catalog-derived description used in every confirmation summary.
export function describePlan(p:any){
  const spec=productSpecification(p);
  const parts=[spec.network_name||spec.network,spec.variant_name||spec.variant,spec.product_name||spec.size].filter(Boolean);
  const validity=spec.validity?`valid ${spec.validity}`:"validity not specified";
  return `${parts.join(" • ")} (${validity}) — ₦${spec.selling_price.toLocaleString("en-NG")}`;
}
