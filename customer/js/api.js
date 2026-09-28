// Bindawasub AI — shared API and persistent Supabase session

const SUPABASE_URL =
  "https://fuktxjweuanatmurlzpg.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_" + "S1iARs058S3_XAUP1S_0Lw_oEnJuFe2";

const EDGE_FUNCTION_URL =
  SUPABASE_URL + "/functions/v1/bindawasub-ai";

const PROFILE_FUNCTION_URL =
  SUPABASE_URL + "/functions/v1/bindawasub-profile";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: "bindawasub-auth"
    }
  }
);

async function getAccessToken(forceRefresh = false) {
  const current = await supabaseClient.auth.getSession();

  if (current.error) {
    throw new Error(current.error.message || "Unable to read session.");
  }

  if (!forceRefresh && current.data?.session?.access_token) {
    return current.data.session.access_token;
  }

  const refreshed = await supabaseClient.auth.refreshSession();

  if (refreshed.error || !refreshed.data?.session) {
    throw new Error("Ba a shiga cikin asusu ba. Sake shiga.");
  }

  return refreshed.data.session.access_token;
}

async function callEdgeFunction(payload) {
  let token = await getAccessToken(false);

  const requestPayload =
    payload && typeof payload === "object"
      ? { channel: getCustomerChannel(), ...payload }
      : payload;

  let response = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify(requestPayload)
  });

  if (response.status === 401 || response.status === 403) {
    token = await getAccessToken(true);

    response = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify(requestPayload)
    });
  }

  return response;
}


async function callProfileFunction(payload) {
  let token = await getAccessToken(false);
  let response = await fetch(PROFILE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": "Bearer " + token
    },
    body: JSON.stringify(payload || {})
  });

  if (response.status === 401 || response.status === 403) {
    token = await getAccessToken(true);
    response = await fetch(PROFILE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify(payload || {})
    });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Profile request failed.");
  }
  return data;
}

async function getProfileStatus() {
  return callProfileFunction({ action: "status" });
}
