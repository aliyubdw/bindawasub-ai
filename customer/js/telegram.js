// Bindawasub AI — Telegram account linking

const TELEGRAM_LINK_CODE_URL =
  SUPABASE_URL + "/functions/v1/telegram-link-code";

async function createTelegramLinkCode() {
  const button = document.getElementById("telegramLinkButton");

  if (button) {
    button.disabled = true;
    button.textContent = "Creating code…";
  }

  try {
    let token = await getAccessToken(false);

    let response = await fetch(TELEGRAM_LINK_CODE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({ action: "create" })
    });

    if (response.status === 401 || response.status === 403) {
      token = await getAccessToken(true);

      response = await fetch(TELEGRAM_LINK_CODE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({ action: "create" })
      });
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success !== true) {
      throw new Error(data.error || "Unable to create Telegram link code.");
    }

    const messages = document.getElementById("messages");
    if (!messages) return;

    const card = document.createElement("div");
    card.className = "message bot";
    card.style.whiteSpace = "normal";

    const safeCode = escapeHtml(data.code);

    card.innerHTML = `
      <strong>Connect Telegram</strong>
      <p style="margin:8px 0;">Your one-time Telegram link code is:</p>
      <div style="font-size:20px;font-weight:800;letter-spacing:1px;padding:10px;border-radius:10px;background:#f1f5f3;text-align:center;word-break:break-all;">
        ${safeCode}
      </div>
      <p style="margin:8px 0;">This code expires in 15 minutes.</p>
      <p style="margin:8px 0;">Open the Bindawasub Telegram bot and send:</p>
      <div style="padding:10px;border-radius:8px;background:#f7f7f7;font-family:monospace;">
        /start ${safeCode}
      </div>
    `;

    messages.appendChild(card);
    messages.scrollTop = messages.scrollHeight;
  } catch (error) {
    addMessage(
      "❌ " + (error?.message || "Unable to create Telegram link code."),
      "bot"
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Connect Telegram";
    }
  }
}
