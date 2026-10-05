export function maskTransactionPhone(phone:any){
  const digits=String(phone||"").replace(/\D/g,"");
  return digits.length>=7?digits.slice(0,4)+"****"+digits.slice(-3):"—";
}

export function formatTransactionForAI(tx:any){
  const p=Array.isArray(tx?.products)?tx.products[0]:tx?.products;
  const n=Array.isArray(p?.service_networks)?p.service_networks[0]:p?.service_networks;
  const v=Array.isArray(p?.service_variants)?p.service_variants[0]:p?.service_variants;
  return {transaction_id:tx?.id||null,created_at:tx?.created_at||null,status:tx?.status||"pending",amount:Number(tx?.amount||0),service_type:tx?.service_type||p?.service_type||null,product_name:p?.product_name||tx?.description||"Purchase",volume:p?.volume||null,network:n?.code||n?.name||null,variant:v?.code||v?.name||null,phone_number:maskTransactionPhone(tx?.phone_number)};
}
