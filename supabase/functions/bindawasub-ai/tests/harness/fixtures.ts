// Mock catalog shaped like production data (verified read-only on 2026-10-10):
//   products.volume holds only the UNIT ("GB"/"MB"); the size lives in product_name ("1 GB").
// Plan names, prices and validities below are mock values modelled on that shape.
export type Row = Record<string, any>;

const net = (code: string, name: string) => ({ code, name });
const variant = (code: string, name: string) => ({ code, name });

export function product(id: string, network: [string, string], v: [string, string], name: string, unit: "GB" | "MB",
  price: number, validityValue: number, validityUnit: string, extra: Row = {}): Row {
  return {
    id, sku: `DATA-${network[0]}-${v[0]}-${name}`.toUpperCase().replace(/\s+/g, "-"),
    service_type: "data", product_name: name, volume: unit,
    validity_type: "fixed", validity_value: String(validityValue), validity_unit: validityUnit,
    selling_price: String(price.toFixed(2)), display_order: 0, metadata: {}, active: true,
    network_id: `net-${network[0]}`, variant_id: `var-${v[0]}`,
    service_networks: net(...network), service_variants: variant(...v), ...extra,
  };
}

export const MTN: [string, string] = ["mtn", "MTN"];
export const AIRTEL: [string, string] = ["airtel", "Airtel"];
export const SME: [string, string] = ["sme_data", "SME Data"];
export const GIFTING: [string, string] = ["gifting", "Gifting"];
export const SOCIAL: [string, string] = ["social", "Social data"];

export function catalog(): Row[] {
  return [
    product("p-mtn-sme-500mb", MTN, SME, "500 MB", "MB", 260, 1, "weeks"),
    product("p-mtn-sme-1gb", MTN, SME, "1 GB", "GB", 430, 1, "weeks"),
    product("p-mtn-sme-2gb", MTN, SME, "2 GB", "GB", 850, 1, "months"),
    product("p-mtn-sme-5gb", MTN, SME, "5 GB", "GB", 1600, 1, "months"),
    product("p-airtel-gift-1gb", AIRTEL, GIFTING, "1 GB", "GB", 550, 1, "days"),
    product("p-airtel-sme-1gb", AIRTEL, SME, "1 GB", "GB", 800, 7, "days"),
    product("p-airtel-social-1gb", AIRTEL, SOCIAL, "1 GB", "GB", 350, 3, "days"),
    product("p-airtel-gift-2gb", AIRTEL, GIFTING, "2 GB", "GB", 1100, 2, "days"),
    // Must never be offered: inactive plan.
    product("p-mtn-gift-1gb-inactive", MTN, GIFTING, "1 GB", "GB", 390, 1, "days", { active: false }),
  ];
}

export function seed(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    users: [{ id: "user-1", auth_user_id: "auth-1", phone: "08000000000", name: "Test Customer", role: "customer", language: "english" }],
    ai_settings: [{ enabled: true, gemini_enabled: true, require_purchase_confirmation: true, max_purchase_amount: 50000,
      default_language: "english", allowed_channels: ["web", "app", "telegram"], fallback_message: "fallback" }],
    ai_conversations: [], ai_messages: [], ai_activity_log: [],
    service_definitions: [
      { id: "svc-data", code: "data", name: "Data", description: "", category: "telecom", metadata: {}, active: true },
      { id: "svc-airtime", code: "airtime", name: "Airtime", description: "", category: "telecom", metadata: {}, active: true },
    ],
    service_fields: [
      { service_id: "svc-data", field_key: "phone", label: "Phone number", data_type: "phone", required: true, sensitive: false, validation: {}, display_order: 1, metadata: {}, active: true },
    ],
    products: catalog(),
    saved_beneficiaries: [
      { id: "b1", user_id: "user-1", name: "Mom", phone_number: "08031234567" },
      { id: "b2", user_id: "user-1", name: "Chidi", phone_number: "08055555555" },
      { id: "b3", user_id: "user-1", name: "Musa", phone_number: "08061111111" },
      { id: "b4", user_id: "user-1", name: "Musa", phone_number: "08062222222" },
    ],
    transactions: [],
    provider_plan_mappings: catalog().map((p) => ({ id: `m-${p.id}`, product_id: p.id, provider_id: "prov-1", active: true })),
    api_providers: [{ id: "prov-1", code: "SMEPLUG", status: "active" }],
    ...extra,
  };
}
