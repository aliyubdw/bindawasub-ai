// Bindawasub AI — transaction and funding history rendering

function showTransactionHistory(transactions) {
  const messages = document.getElementById("messages");

  const box = document.createElement("div");
  box.className = "message bot";
  box.style.maxWidth = "95%";

  const title = document.createElement("div");
  title.style.fontWeight = "bold";
  title.style.marginBottom = "10px";
  title.textContent = "📋 Your recent transactions";
  box.appendChild(title);

  transactions.forEach((tx, index) => {
    const item = document.createElement("div");
    item.style.padding = "9px 0";
    item.style.borderTop = index === 0 ? "none" : "1px solid #ddd";

    const date = tx.date
      ? new Date(tx.date).toLocaleString("en-NG", {
          dateStyle: "medium",
          timeStyle: "short"
        })
      : "Date unavailable";

    const status = String(tx.status || "unknown").toLowerCase();
    const statusLabel =
      status === "successful" ? "✅ Successful" :
      status === "failed" ? "❌ Failed" :
      status === "pending" ? "⏳ Pending" :
      status === "reversed" ? "↩️ Reversed" :
      "ℹ️ " + status;

    item.innerHTML =
      "<strong>" + (tx.product_name || "Data purchase") + "</strong>" +
      "<br>Amount: ₦" + Number(tx.amount || 0).toLocaleString() +
      "<br>Phone: " + (tx.phone_number || "—") +
      "<br>Status: " + statusLabel +
      "<br><small>" + date + "</small>";

    box.appendChild(item);
  });

  messages.appendChild(box);
  messages.scrollTop = messages.scrollHeight;
}

function showFundingHistory(funding) {
  const messages = document.getElementById("messages");

  const box = document.createElement("div");
  box.className = "message bot";
  box.style.maxWidth = "95%";

  const title = document.createElement("div");
  title.style.fontWeight = "bold";
  title.style.marginBottom = "10px";
  title.textContent = "💰 Your recent wallet funding";
  box.appendChild(title);

  funding.forEach((item, index) => {
    const row = document.createElement("div");
    row.style.padding = "9px 0";
    row.style.borderTop = index === 0 ? "none" : "1px solid #ddd";

    const date = item.date
      ? new Date(item.date).toLocaleString("en-NG", {
          dateStyle: "medium",
          timeStyle: "short"
        })
      : "Date unavailable";

    const status = String(item.status || "unknown").toLowerCase();
    const statusLabel =
      status === "successful" ? "✅ Successful" :
      status === "failed" ? "❌ Failed" :
      status === "pending" ? "⏳ Pending" :
      "ℹ️ " + status;

    const method = item.payment_method || "—";

    row.innerHTML =
      "<strong>₦" + Number(item.amount || 0).toLocaleString() + "</strong>" +
      "<br>Method: " + method +
      "<br>Status: " + statusLabel +
      "<br>Reference: " + (item.reference || "—") +
      "<br><small>" + date + "</small>";

    box.appendChild(row);
  });

  messages.appendChild(box);
  messages.scrollTop = messages.scrollHeight;
}
