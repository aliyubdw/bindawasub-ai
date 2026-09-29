// Bindawasub AI — customer authentication and persistent session management

function normalizeRegistrationPhone(phone) {
  let number = String(phone || "").replace(/\s+/g, "").replace(/-/g, "");

  if (number.startsWith("+234")) {
    number = "0" + number.substring(4);
  } else if (number.startsWith("234")) {
    number = "0" + number.substring(3);
  }

  return /^0[789][0-9]{9}$/.test(number) ? number : null;
}

function showLoginForm() {
  document.getElementById("loginForm").style.display = "block";
  document.getElementById("registerForm").style.display = "none";
  document.getElementById("authSubtitle").textContent =
    "Shiga cikin asusunka domin amfani da Bindawasub.";
  document.getElementById("loginError").textContent = "";
  document.getElementById("registerMessage").textContent = "";
}

function showProfileCompletionForm(email = "") {
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("registerForm").style.display = "none";
  document.getElementById("profileCompletionForm").style.display = "block";
  document.getElementById("authSubtitle").textContent =
    "Complete your Bindawasub profile to continue.";
  document.getElementById("loginError").textContent = "";
  document.getElementById("registerMessage").textContent = "";
  document.getElementById("profileEmail").value = email || "";
  document.getElementById("profileName").focus();
}

function hideProfileCompletionForm() {
  document.getElementById("profileCompletionForm").style.display = "none";
}

async function completeProfile() {
  const name = document.getElementById("profileName").value.trim();
  const phone = normalizeRegistrationPhone(
    document.getElementById("profilePhone").value.trim()
  );
  const button = document.getElementById("completeProfileButton");
  const errorBox = document.getElementById("loginError");

  errorBox.textContent = "";

  if (!name) {
    errorBox.textContent = "Enter your full name.";
    return;
  }

  if (!phone) {
    errorBox.textContent = "Enter a valid Nigerian phone number.";
    return;
  }

  button.disabled = true;
  button.textContent = "Creating account...";

  try {
    const data = await callProfileFunction({
      action: "complete_profile",
      name,
      phone
    });

    const isAdmin = data.user?.role === "admin" || await verifyAdminMode();

    if (isAdmin) {
      window.location.replace("./admin/");
      return;
    }

    hideProfileCompletionForm();
    await showChatScreen();
    document.getElementById("customerInterface").classList.remove("admin-hidden");
  } catch (error) {
    console.error("Profile completion failed:", error);
    errorBox.textContent = error?.message || "Unable to complete your account.";
  } finally {
    button.disabled = false;
    button.textContent = "Continue";
  }
}

function showRegisterForm() {
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("registerForm").style.display = "block";
  document.getElementById("authSubtitle").textContent =
    "Create your Bindawasub customer account.";
  document.getElementById("loginError").textContent = "";
  document.getElementById("registerMessage").textContent = "";
}

async function registerUser() {
  const name = document.getElementById("registerName").value.trim();
  const phone = normalizeRegistrationPhone(
    document.getElementById("registerPhone").value.trim()
  );
  const email = document.getElementById("registerEmail").value.trim();
  const password = document.getElementById("registerPassword").value;
  const button = document.getElementById("registerButton");
  const errorBox = document.getElementById("loginError");
  const messageBox = document.getElementById("registerMessage");

  errorBox.textContent = "";
  messageBox.textContent = "";

  if (!name) {
    errorBox.textContent = "Enter your full name.";
    return;
  }

  if (!phone) {
    errorBox.textContent = "Enter a valid Nigerian phone number.";
    return;
  }

  if (!email) {
    errorBox.textContent = "Enter your email address.";
    return;
  }

  if (password.length < 8) {
    errorBox.textContent = "Password must be at least 8 characters.";
    return;
  }

  button.disabled = true;
  button.textContent = "Creating account...";

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { name, phone } }
    });

    if (error) throw error;

    if (data.session) {
      const profile = await callProfileFunction({
        action: "complete_profile",
        name,
        phone
      });

      const isAdmin = profile.user?.role === "admin" || await verifyAdminMode();

      if (isAdmin) {
        window.location.replace("./admin/");
        return;
      }

      await showChatScreen();
      document.getElementById("customerInterface").classList.remove("admin-hidden");
      messageBox.textContent = "Account created successfully.";
    } else {
      showLoginForm();
      document.getElementById("loginEmail").value = email;
      messageBox.textContent =
        "Account created. Log in with your email and password to continue.";
    }
  } catch (error) {
    console.error("Registration failed:", error);
    errorBox.textContent = error?.message || "Account creation failed.";
  } finally {
    button.disabled = false;
    button.textContent = "Create account";
  }
}

function getGoogleRedirectUrl() {
  return "https://bindawasub-ai.vercel.app/";
}

async function loginWithGoogle() {
  const button = document.getElementById("googleButton");
  const errorBox = document.getElementById("loginError");

  if (button) {
    button.disabled = true;
    button.textContent = "Opening Google...";
  }
  if (errorBox) {
    errorBox.className = "login-error";
    errorBox.textContent = "";
  }

  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getGoogleRedirectUrl()
      }
    });

    if (error) throw error;
  } catch (error) {
    console.error("Google login failed:", error);
    if (errorBox) {
      errorBox.textContent = error?.message || "Unable to continue with Google.";
    }
    if (button) {
      button.disabled = false;
      button.textContent = "Continue with Google";
    }
  }
}

window.loginWithGoogle = loginWithGoogle;

async function loginUser() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorBox = document.getElementById("loginError");
  const loginButton = document.getElementById("loginButton");

  errorBox.textContent = "";

  if (!email || !password) {
    errorBox.textContent = "Shigar da email da password.";
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = "Ana shiga...";

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.session) {
      throw new Error(error?.message || "Login failed.");
    }

    // Do not initialize the account here.
    // The single SIGNED_IN/INITIAL_SESSION handler below owns session boot.
    // This prevents loginUser() and onAuthStateChange() from racing and
    // loading two different account states in the same browser.
  } catch (error) {
    // Do not sign the customer out here. If Supabase successfully created a
    // session but a later UI/bootstrap step fails, destroying the valid
    // session makes the app look like it logged the customer out immediately.
    console.error("Login failed:", error);
    errorBox.textContent = error?.message || "An kasa shiga. Sake gwadawa.";
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Login";
  }
}

async function logoutUser() {
  resetCustomerSessionState();
  lastAuthenticatedUserId = null;

  try {
    await supabaseClient.auth.signOut({ scope: "local" });
  } catch (error) {
    console.error("Logout failed:", error);
  }

  document.getElementById("chatScreen").style.display = "none";
  document.getElementById("loginScreen").style.display = "block";
  document.getElementById("loginPassword").value = "";
  hideAdminMode();
}

let authBooted = false;
let authTransitionRunning = false;
let lastAuthenticatedUserId = null;

function resetCustomerSessionState() {
  // Never allow conversation state from one authenticated account
  // to survive into another account in the same browser session.
  BindawasubCustomerState.activeConversationId = null;
  BindawasubCustomerState.historyOpen = false;
  resetCustomerOrderState();
  resetCustomerFundingState();

  const messages = document.getElementById("messages");
  if (messages) messages.innerHTML = "";

  const historyList = document.getElementById("conversationHistoryList");
  if (historyList) historyList.innerHTML = "";

  const historyPanel = document.getElementById("conversationHistoryPanel");
  if (historyPanel) historyPanel.hidden = true;

  const input = document.getElementById("messageInput");
  if (input) input.value = "";
}

async function applyAuthenticatedSession(session) {
  if (!session || authTransitionRunning) return;

  const authenticatedUserId = String(session.user?.id || "").trim();
  if (!authenticatedUserId) {
    console.error("Authenticated session has no user id.");
    return;
  }

  // Detect account changes even when Supabase changes the session
  // without a full page reload (for example, account A -> account B).
  if (lastAuthenticatedUserId && lastAuthenticatedUserId !== authenticatedUserId) {
    resetCustomerSessionState();
    hideAdminMode();
  }

  lastAuthenticatedUserId = authenticatedUserId;
  authTransitionRunning = true;

  try {
    const profile = await getProfileStatus();

    if (!profile.profile_complete) {
      showProfileCompletionForm(session?.user?.email || profile.email || "");
      return;
    }

    const isAdmin = profile.user?.role === "admin" || await verifyAdminMode();

    if (isAdmin) {
      window.location.replace("./admin/");
      return;
    }

    await showChatScreen();
    document.getElementById("customerInterface").classList.remove("admin-hidden");
  } catch (error) {
    console.error("Session setup failed:", error);

    // Do not sign out or destroy the authenticated session when the profile
    // service has a temporary/database error. Show the error while keeping
    // the login session available for a retry.
    const loginError = document.getElementById("loginError");
    if (loginError) {
      loginError.textContent =
        error?.message || "Login succeeded, but Bindawasub could not load your account. Please try again.";
    }
    document.getElementById("chatScreen").style.display = "none";
    document.getElementById("loginScreen").style.display = "block";
  } finally {
    authTransitionRunning = false;
  }
}

async function initAuth() {
  if (authBooted) return;
  authBooted = true;

  supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log("Auth event:", event, "has session:", !!session);

    if (event === "SIGNED_OUT" || !session) {
      if (event === "SIGNED_OUT") {
        resetCustomerSessionState();
        lastAuthenticatedUserId = null;
        stopFundingStatusNotifications();
        hideAdminMode();
        document.getElementById("chatScreen").style.display = "none";
        document.getElementById("loginScreen").style.display = "block";
      }
      return;
    }

    if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
      setTimeout(() => {
        applyAuthenticatedSession(session);
      }, 0);
    }
  });

  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Initial session read failed:", error);
    return;
  }

  if (data.session) {
    await applyAuthenticatedSession(data.session);
  }
}
