export function normalizeLookup(value:any){
  return String(value??"").toLowerCase().replace(/[^a-z0-9]+/g,"");
}

export function resolveCatalogProduct(ai:any, products:any[]){
  const list=Array.isArray(products)?products:[];
  const id=String(ai?.product_id||"").trim();
  if(id){
    const exact=list.find((p:any)=>p.id===id);
    if(exact)return exact;
  }

  let candidates=list.slice();
  const service=normalizeLookup(ai?.service_type);
  const network=normalizeLookup(ai?.network);
  const volume=normalizeLookup(ai?.volume);
  const variant=normalizeLookup(ai?.variant);
  const name=normalizeLookup(ai?.product_name);

  if(service)candidates=candidates.filter((p:any)=>normalizeLookup(p.service_type)===service);
  if(network)candidates=candidates.filter((p:any)=>{
    const n=Array.isArray(p.service_networks)?p.service_networks[0]:p.service_networks;
    return normalizeLookup(n?.code)===network||normalizeLookup(n?.name)===network;
  });
  if(volume)candidates=candidates.filter((p:any)=>normalizeLookup(p.volume)===volume);
  if(variant)candidates=candidates.filter((p:any)=>{
    const v=Array.isArray(p.service_variants)?p.service_variants[0]:p.service_variants;
    return normalizeLookup(v?.code)===variant||normalizeLookup(v?.name)===variant;
  });
  if(name){
    const named=candidates.filter((p:any)=>normalizeLookup(p.product_name)===name);
    if(named.length===1)return named[0];
    if(named.length>0)candidates=named;
  }
  return candidates.length===1?candidates[0]:null;
}

export function filterCatalogBySpecification(ai:any, products:any[]){
  const list=Array.isArray(products)?products:[];
  const requested={
    service:normalizeLookup(ai?.service_type),
    network:normalizeLookup(ai?.network),
    variant:normalizeLookup(ai?.variant),
    volume:normalizeLookup(ai?.volume),
    product:normalizeLookup(ai?.product_name)
  };

  let candidates=list.slice();
  if(requested.service)candidates=candidates.filter((p:any)=>normalizeLookup(p?.service_type)===requested.service);
  if(requested.network)candidates=candidates.filter((p:any)=>{
    const n=Array.isArray(p?.service_networks)?p.service_networks[0]:p?.service_networks;
    return normalizeLookup(n?.code)===requested.network||normalizeLookup(n?.name)===requested.network;
  });
  if(requested.variant)candidates=candidates.filter((p:any)=>{
    const v=Array.isArray(p?.service_variants)?p.service_variants[0]:p?.service_variants;
    return normalizeLookup(v?.code)===requested.variant||normalizeLookup(v?.name)===requested.variant;
  });
  if(requested.volume)candidates=candidates.filter((p:any)=>normalizeLookup(p?.volume)===requested.volume);
  if(requested.product)candidates=candidates.filter((p:any)=>normalizeLookup(p?.product_name)===requested.product);

  return candidates;
}


async
