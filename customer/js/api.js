// Bindawasub AI — shared API and Supabase client

const SUPABASE_URL =
  "https://fuktxjweuanatmurlzpg.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_" + "S1iARs058S3_XAUP1S_0Lw_oEnJuFe2";

const EDGE_FUNCTION_URL =
  "https://fuktxjweuanatmurlzpg.supabase.co/functions/v1/bindawasub-ai";

const supabaseClient =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

let waitingForFundingAmount = false;
let activeFundingRequestId = null;

async function getAccessToken() {
  const { data, error } =
    await supabaseClient.auth.getSession();

  if (error || !data.session) {
    throw new Error("Ba a shiga cikin asusu ba.");
  }

  return data.session.access_token;
}

async function callEdgeFunction(payload) {
  const token = await getAccessToken();

  return fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify(payload)
  });
}
