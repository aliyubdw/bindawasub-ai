// Bindawasub AI — customer authentication and session management

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
      options: {
        data: {
          name,
          phone
        }
      }
    });

    if (error) throw error;

    if (data.session) {
      showChatScreen();

      try {
        const isAdmin = await verifyAdminMode();
        if (isAdmin) {
          document.getElementById("customerInterface").classList.add("admin-hidden");
        } else {
          document.getElementById("customerInterface").classList.remove("admin-hidden");
        }
      } catch (setupError) {
        console.error("Post-registration setup failed:", setupError);
      }

      messageBox.textContent = "Account created successfully.";
    } else {
      showLoginForm();
      document.getElementById("loginEmail").value = email;
      messageBox.textContent =
        "Account created. Check your email to confirm your account, then log in.";
    }
  } catch (error) {
    console.error("Registration failed:", error);
    errorBox.textContent = error?.message || "Account creation failed.";
  } finally {
    button.disabled = false;
    button.textContent = "Create account";
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

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error || !data.session) {
    errorBox.textContent = error?.message || "Login failed.";
    loginButton.disabled = false;
    loginButton.textContent = "Login";
    return;
  }

  // Do NOT show the customer interface first.
  // Determine admin/customer mode before displaying the app.
  try {
    const isAdmin = await verifyAdminMode();

    showChatScreen();

    if (isAdmin) {
      document.getElementById("customerInterface").classList.add("admin-hidden");
    } else {
      document.getElementById("customerInterface").classList.remove("admin-hidden");
    }
  } catch (error) {
    console.error("Post-login setup failed:", error);
    await supabaseClient.auth.signOut();
    errorBox.textContent = "An kasa tabbatar da asusun. Sake gwadawa.";
    document.getElementById("loginScreen").style.display = "block";
    document.getElementById("chatScreen").style.display = "none";
    loginButton.disabled = false;
    loginButton.textContent = "Login";
    return;
  }

  loginButton.disabled = false;
  loginButton.textContent = "Login";
}

async function logoutUser() {
  await supabaseClient.auth.signOut();
  document.getElementById("chatScreen").style.display = "none";
  document.getElementById("loginScreen").style.display = "block";
  document.getElementById("loginPassword").value = "";
  hideAdminMode();
}

async function initAuth() {
  const { data } = await supabaseClient.auth.getSession();

  if (data.session) {
    try {
      const isAdmin = await verifyAdminMode();
      showChatScreen();

      if (isAdmin) {
        document.getElementById("customerInterface").classList.add("admin-hidden");
      } else {
        document.getElementById("customerInterface").classList.remove("admin-hidden");
      }
    } catch (error) {
      console.error("Session setup failed:", error);
      await supabaseClient.auth.signOut();
    }
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log("Auth event:", event, "has session:", !!session);

    // Only a real signed-in/initial session should display the app.
    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
      setTimeout(async () => {
        try {
          const isAdmin = await verifyAdminMode();
          showChatScreen();

          if (isAdmin) {
            document.getElementById("customerInterface").classList.add("admin-hidden");
          } else {
            document.getElementById("customerInterface").classList.remove("admin-hidden");
          }
        } catch (error) {
          console.error("Auth setup failed:", error);
        }
      }, 0);
    }

    // Do NOT log the user out on TOKEN_REFRESHED or other transient auth events.
    if (event === "SIGNED_OUT") {
      stopFundingStatusNotifications();
      hideAdminMode();
      document.getElementById("chatScreen").style.display = "none";
      document.getElementById("loginScreen").style.display = "block";
    }
  });
}
