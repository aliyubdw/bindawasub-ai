export function formatCatalogProduct(p:any){
  const n=Array.isArray(p.service_networks)?p.service_networks[0]:p.service_networks;
  const v=Array.isArray(p.service_variants)?p.service_variants[0]:p.service_variants;
  const duration=p.validity_type==="fixed"&&p.validity_value!=null&&p.validity_unit?String(p.validity_value)+" "+String(p.validity_unit):(p.validity_type==="unlimited"?"Unlimited":"");
  return {...p,network:n?.code||null,network_name:n?.name||null,variant:v?.code||null,variant_name:v?.name||null,duration};
}

export function productSpecification(p:any){
  const n=Array.isArray(p?.service_networks)?p.service_networks[0]:p?.service_networks;
  const v=Array.isArray(p?.service_variants)?p.service_variants[0]:p?.service_variants;
  const validity=p?.validity_type==="unlimited"
    ?"Unlimited"
    :(p?.validity_value!=null&&p?.validity_unit?String(p.validity_value)+" "+String(p.validity_unit):"");
  return {
    id:p?.id||null,
    service_type:p?.service_type||null,
    network:n?.code||n?.name||null,
    network_name:n?.name||null,
    variant:v?.code||v?.name||null,
    variant_name:v?.name||null,
    product_name:p?.product_name||null,
    volume:p?.volume||null,
    validity,
    validity_value:p?.validity_value??null,
    validity_unit:p?.validity_unit??null,
    selling_price:Number(p?.selling_price||0),
    sku:p?.sku||null
  };
}
