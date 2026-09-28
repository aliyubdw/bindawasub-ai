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

async function sendEmailLink() {
  const email = document.getElementById("loginEmail").value.trim();
  const errorBox = document.getElementById("loginError");
  const button = document.getElementById("emailLinkButton");

  errorBox.textContent = "";

  if (!email) {
    errorBox.textContent = "Enter your email address first.";
    document.getElementById("loginEmail").focus();
    return;
  }

  button.disabled = true;
  button.textContent = "Sending link...";

  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin + window.location.pathname
      }
    });

    if (error) throw error;

    errorBox.className = "login-success";
    errorBox.textContent = "Check your email. We sent you a secure sign-in link.";
  } catch (error) {
    console.error("Email link login failed:", error);
    errorBox.className = "login-error";
    errorBox.textContent = error?.message || "Unable to send sign-in link.";
  } finally {
    button.disabled = false;
    button.textContent = "Continue with email";
  }
}

async function loginWithGoogle() {
  const button = document.getElementById("googleButton");
  const errorBox = document.getElementById("loginError");

  errorBox.className = "login-error";
  errorBox.textContent = "";
  button.disabled = true;
  button.textContent = "Opening Google...";

  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });

    if (error) throw error;
  } catch (error) {
    console.error("Google login failed:", error);
    errorBox.textContent = error?.message || "Unable to continue with Google.";
    button.disabled = false;
    button.textContent = "Continue with Google";
  }
}

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

    const isAdmin = await verifyAdminMode();

    if (isAdmin) {
      window.location.replace("./admin/");
      return;
    }

    await showChatScreen();
    document.getElementById("customerInterface").classList.remove("admin-hidden");
  } catch (error) {
    console.error("Post-login setup failed:", error);
    await supabaseClient.auth.signOut({ scope: "local" }).catch(() => {});
    errorBox.textContent = error?.message || "An kasa shiga. Sake gwadawa.";
    document.getElementById("loginScreen").style.display = "block";
    document.getElementById("chatScreen").style.display = "none";
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Login";
  }
}

async function logoutUser() {
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

async function applyAuthenticatedSession(session) {
  if (!session || authTransitionRunning) return;

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
    await supabaseClient.auth.signOut({ scope: "local" }).catch(() => {});
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
