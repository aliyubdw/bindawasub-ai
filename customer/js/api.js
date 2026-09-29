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
      autoRefreshToken: false,
      detectSessionInUrl: true,
      storage: window.localStorage,
      storageKey: "bindawasub-auth"
    }
  }
);

let sessionRefreshPromise = null;
let lastSuccessfulRefreshAt = 0;
let lastSuccessfulAccessToken = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCurrentSession() {
  const current = await supabaseClient.auth.getSession();

  if (current.error) {
    throw new Error(current.error.message || "Unable to read session.");
  }

  return current.data?.session || null;
}

async function refreshSessionSafely() {
  // Never allow multiple parts of the customer app to rotate the same
  // Supabase refresh token at the same time.
  if (sessionRefreshPromise) {
    return sessionRefreshPromise;
  }

  // If another request refreshed the session moments ago, use that result.
  if (
    lastSuccessfulAccessToken &&
    Date.now() - lastSuccessfulRefreshAt < 5000
  ) {
    const latest = await readCurrentSession();
    if (
      latest?.access_token &&
      latest.access_token === lastSuccessfulAccessToken
    ) {
      return latest.access_token;
    }
  }

  sessionRefreshPromise = (async () => {
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await readCurrentSession();

      if (!before) {
        throw new Error("Ba a shiga cikin asusu ba. Sake shiga.");
      }

      const userIdBefore = String(before.user?.id || "");

      try {
        const refreshed = await supabaseClient.auth.refreshSession();

        if (refreshed?.data?.session?.access_token) {
          const refreshedSession = refreshed.data.session;
          lastSuccessfulAccessToken = refreshedSession.access_token;
          lastSuccessfulRefreshAt = Date.now();
          return refreshedSession.access_token;
        }

        lastError =
          refreshed?.error ||
          new Error("Supabase did not return a refreshed session.");
      } catch (error) {
        lastError = error;
      }

      // A refresh can legitimately lose a race with another browser/tab
      // refresh. Read the session that won the race before retrying.
      const latest = await readCurrentSession();

      if (latest?.access_token) {
        const latestUserId = String(latest.user?.id || "");

        // Only accept the newer session if it belongs to the same
        // authenticated account. Never cross account boundaries.
        if (!userIdBefore || !latestUserId || latestUserId === userIdBefore) {
          lastSuccessfulAccessToken = latest.access_token;
          lastSuccessfulRefreshAt = Date.now();
          return latest.access_token;
        }
      }

      if (attempt < 2) {
        await sleep(250 * (attempt + 1));
      }
    }

    throw lastError || new Error("Unable to refresh session.");
  })().finally(() => {
    sessionRefreshPromise = null;
  });

  return sessionRefreshPromise;
}

async function getAccessToken(forceRefresh = false) {
  const session = await readCurrentSession();

  if (!session) {
    throw new Error("Ba a shiga cikin asusu ba. Sake shiga.");
  }

  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  const stillValid = expiresAtMs > Date.now() + 5_000;

  // Supabase getSession() can refresh an expiring session itself. Do not
  // immediately call refreshSession() again after getSession(), because that
  // can rotate the refresh token twice and produce:
  // "Refresh result discarded: session state changed mid-flight".
  if (!forceRefresh && stillValid && session.access_token) {
    return session.access_token;
  }

  if (forceRefresh && stillValid && session.access_token) {
    // A recent successful refresh may already have produced this valid token.
    if (
      lastSuccessfulAccessToken &&
      session.access_token === lastSuccessfulAccessToken &&
      Date.now() - lastSuccessfulRefreshAt < 5000
    ) {
      return session.access_token;
    }
  }

  try {
    return await refreshSessionSafely();
  } catch (error) {
    // A concurrent refresh can finish just after our refresh attempt
    // reports that its result was discarded. Always make one final read
    // before telling the customer that their session is expired.
    const latest = await readCurrentSession().catch(() => null);

    if (latest?.access_token) {
      return latest.access_token;
    }

    throw new Error(
      error?.message || "Your session has expired. Please log in again."
    );
  }
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
