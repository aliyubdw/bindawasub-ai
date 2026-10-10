// Bindawasub AI — products, recipient validation and order confirmation

function showDataTypes(dataTypes, networkName) {
  const messages = document.getElementById("messages");
  if (!messages || !Array.isArray(dataTypes) || !dataTypes.length) return;

  const list = document.createElement("div");
  list.className = "product-list data-type-list";

  const heading = document.createElement("div");
  heading.className = "product-list-heading";
  heading.innerHTML = `
    <span class="product-network-icon">📶</span>
    <span><strong>${networkName || "Data"} Data Types</strong><small>Choose a data type</small></span>
  `;
  list.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "product-grid";

  dataTypes.forEach(type => {
    const card = document.createElement("button");
    card.className = "product-card";
    card.type = "button";

    const name = String(type.name || type.code || "Data");
    const count = Number(type.plan_count || 0);

    card.innerHTML = `
      <span class="product-network">${networkName || "Data"}</span>
      <span class="product-name">${name}</span>
      <span class="product-details">${count} plan${count === 1 ? "" : "s"} available</span>
      <span class="product-select">Choose</span>
    `;

    card.onclick = function() {
      addMessage(name, "user");
      list.remove();
      sendMessage(name);
    };

    grid.appendChild(card);
  });

  list.appendChild(grid);
  messages.appendChild(list);
  messages.scrollTop = messages.scrollHeight;
}

function showProducts(products, purchaseContext = null) {
  const messages = document.getElementById("messages");
  if (!messages || !Array.isArray(products) || !products.length) return;

  const productList = document.createElement("div");
  productList.className = "product-list";

  const firstProduct = products[0] || {};
  const networkName =
    firstProduct.network_name ||
    firstProduct.network ||
    (Array.isArray(firstProduct.service_networks)
      ? firstProduct.service_networks[0]?.name
      : firstProduct.service_networks?.name) ||
    "Data";

  const networkNames = [...new Set(products.map(product =>
    String(product.network_name || product.network ||
      (Array.isArray(product.service_networks)
        ? product.service_networks[0]?.name
        : product.service_networks?.name) || "Network")
  ))];
  const heading = document.createElement("div");
  heading.className = "product-list-heading";
  heading.innerHTML = `
    <span class="product-network-icon">📶</span>
    <span><strong>${networkNames.length > 1 ? "Matching Data Plans Across Networks" : networkName + " Data Plans"}</strong><small>Choose a network and data type</small></span>
  `;
  productList.appendChild(heading);

  // Group every plan by its Data Type / variant.
  // This is intentionally done from the live product metadata so every
  // network can have its own set of categories.
  const groups = new Map();

  products.forEach(product => {
    const variantName =
      product.variant_name ||
      product.variant ||
      (Array.isArray(product.service_variants)
        ? product.service_variants[0]?.name
        : product.service_variants?.name) ||
      "Other Data";

    const productNetwork = String(
      product.network_name || product.network ||
      (Array.isArray(product.service_networks)
        ? product.service_networks[0]?.name
        : product.service_networks?.name) || "Network"
    ).trim();
    const variantKey = String(product.variant || variantName).trim().toLowerCase();
    const groupKey = productNetwork.toLowerCase() + "|" + variantKey;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        name: networkNames.length > 1 ? productNetwork + " — " + String(variantName) : String(variantName),
        products: []
      });
    }

    groups.get(groupKey).products.push(product);
  });

  groups.forEach(group => {
    const category = document.createElement("section");
    category.className = "product-category";

    const categoryHeading = document.createElement("div");
    categoryHeading.className = "product-category-heading";
    categoryHeading.innerHTML = `
      <strong>${group.name}</strong>
      <small>${group.products.length} plan${group.products.length === 1 ? "" : "s"}</small>
    `;
    category.appendChild(categoryHeading);

    const grid = document.createElement("div");
    grid.className = "product-grid";

    group.products.forEach(product => {
      const card = document.createElement("button");
      card.className = "product-card";
      card.type = "button";

      const name = String(product.product_name || "Data");
      const duration =
        String(product.duration || product.validity || (
          product.validity_value != null && product.validity_unit
            ? product.validity_value + " " + product.validity_unit
            : product.validity_type === "unlimited" ? "Unlimited" : "Validity not specified"
        ));
      const price = Number(product.selling_price || 0).toLocaleString();

      const productNetworkName =
        product.network_name ||
        product.network ||
        (Array.isArray(product.service_networks)
          ? product.service_networks[0]?.name
          : product.service_networks?.name) ||
        networkName;

      card.innerHTML = `
        <span class="product-network">${productNetworkName}</span>
        <span class="product-name">${name}</span>
        <span class="product-details">${duration}</span>
        <span class="product-price">₦${price}</span>
        <span class="product-select">Select</span>
      `;

      card.onclick = function() {
        BindawasubCustomerState.selectedProduct = product;
        BindawasubCustomerState.waitingForPhone = false;
        BindawasubCustomerState.waitingForConfirmation = false;

        addMessage("Na zabi " + String(product.product_name || "Data plan"), "user");
        productList.remove();

        const resolvedPhone = validatePhone(String(
          purchaseContext?.phone_number ||
          purchaseContext?.customer_input?.phone ||
          ""
        ));
        const isPurchaseChoice =
          String(purchaseContext?.intent || "").toLowerCase() === "purchase_intent";

        if (isPurchaseChoice && resolvedPhone) {
          BindawasubCustomerState.recipientPhone = resolvedPhone;
          addMessage("Recipient details are ready. Please review the purchase before confirming.", "bot");
          showConfirmation();
          return;
        }

        BindawasubCustomerState.waitingForPhone = true;
        addMessage(
          isPurchaseChoice
            ? "Plan selected. Please send the recipient's phone number to continue.\n\nExample: 08012345678"
            : "Ka turo min lambar wayar da za a saka data.\n\nMisali: 08012345678",
          "bot"
        );

        const input = document.getElementById("messageInput");
        input.placeholder = "Shigar da lambar wayar...";
        input.focus();
      };

      grid.appendChild(card);
    });

    category.appendChild(grid);
    productList.appendChild(category);
  });

  messages.appendChild(productList);
  messages.scrollTop = messages.scrollHeight;
}

function validatePhone(phone) {

  let number =
    phone.replace(/\s+/g, "")
         .replace(/-/g, "");


  if (number.startsWith("+234")) {

    number =
      "0" + number.substring(4);

  }


  else if (number.startsWith("234")) {

    number =
      "0" + number.substring(3);

  }


  if (
    /^0[789][0-9]{9}$/.test(number)
  ) {

    return number;

  }


  return null;
}

function showConfirmation() {

  const messages =
    document.getElementById("messages");


  const box =
    document.createElement("div");

  box.className =
    "message bot";


  box.textContent =
`Ga bayanan sayayyarka:

Network: ${BindawasubCustomerState.selectedProduct.network_name || BindawasubCustomerState.selectedProduct.network || (Array.isArray(BindawasubCustomerState.selectedProduct.service_networks) ? BindawasubCustomerState.selectedProduct.service_networks[0]?.name : BindawasubCustomerState.selectedProduct.service_networks?.name) || "—"}
Data type: ${BindawasubCustomerState.selectedProduct.variant_name || BindawasubCustomerState.selectedProduct.variant || (Array.isArray(BindawasubCustomerState.selectedProduct.service_variants) ? BindawasubCustomerState.selectedProduct.service_variants[0]?.name : BindawasubCustomerState.selectedProduct.service_variants?.name) || "Not specified"}
Plan: ${BindawasubCustomerState.selectedProduct.product_name}
Validity: ${BindawasubCustomerState.selectedProduct.validity || BindawasubCustomerState.selectedProduct.duration || (BindawasubCustomerState.selectedProduct.validity_value && BindawasubCustomerState.selectedProduct.validity_unit ? BindawasubCustomerState.selectedProduct.validity_value + " " + BindawasubCustomerState.selectedProduct.validity_unit : "Not specified")}
Farashi: ₦${Number(BindawasubCustomerState.selectedProduct.selling_price).toLocaleString()}
Lamba: ${BindawasubCustomerState.recipientPhone}

Kana tabbatar da wannan sayayya?`;


  messages.appendChild(box);


  /* =========================================
     CONFIRM BUTTON
  ========================================= */

  const confirm =
    document.createElement("button");

  confirm.className =
    "confirm-button";

  confirm.textContent =
    "✅ Eh, tabbatar da sayayya";

  // Keep one reference for this confirmation screen. If the request times out
  // after the backend has accepted it, a retry must reuse the same reference.
  const purchaseReference =
    "BW-" +
    Date.now() +
    "-" +
    Math.random().toString(36).substring(2, 8);

  confirm.onclick =
    async function() {

      addMessage(
        "Eh, na tabbatar.",
        "user"
      );


      confirm.disabled = true;


      if (cancel) {
        cancel.disabled = true;
      }


      addMessage(
        "Ana sarrafa sayayyar... Kada ka rufe shafin.",
        "bot"
      );


      try {

        /* =====================================
           CREATE UNIQUE TRANSACTION REFERENCE
        ===================================== */

        /* =====================================
           PROCESS WALLET PURCHASE
        ===================================== */

        const response = await callEdgeFunction({
          action: "purchase",
          product_id: BindawasubCustomerState.selectedProduct.id,
          phone_number: BindawasubCustomerState.recipientPhone,
          reference: purchaseReference
        });


        const data =
          await response.json();


        /* =====================================
           PURCHASE SUCCESS
        ===================================== */

        if (
          response.ok &&
          data.success &&
          data.purchase
        ) {

          const purchase =
            data.purchase;


          addMessage(
            `✅ An karɓi sayayyar.

Package: ${BindawasubCustomerState.selectedProduct.product_name}
Lamba: ${BindawasubCustomerState.recipientPhone}
Farashi: ₦${Number(
              purchase.purchase_amount
            ).toLocaleString()}

Balance kafin sayayya: ₦${Number(
              purchase.balance_before
            ).toLocaleString()}

Balance bayan sayayya: ₦${Number(
              purchase.balance_after
            ).toLocaleString()}

Transaction status: ${purchase.status}

Reference: ${purchase.reference}

A halin yanzu sayayyar tana jiran VTU processing. Ba a tura data zuwa provider ba tukuna.`,
            "bot"
          );

        }


        /* =====================================
           PURCHASE ERROR
        ===================================== */

        else {

          addMessage(
            "❌ An kasa kammala sayayyar.\n\n" +
            (
              data.error ||
              "Unknown error"
            ),
            "bot"
          );


          confirm.disabled = false;


          if (cancel) {
            cancel.disabled = false;
          }


          return;
        }

      }


      catch (error) {

        console.error(error);


        addMessage(
          "❌ An samu matsala wajen haɗawa da tsarin sayayya.",
          "bot"
        );


        confirm.disabled = false;


        if (cancel) {
          cancel.disabled = false;
        }


        return;
      }


      BindawasubCustomerState.waitingForConfirmation =
        false;


      BindawasubCustomerState.selectedProduct =
        null;


      BindawasubCustomerState.recipientPhone =
        null;


      confirm.remove();


      if (cancel) {
        cancel.remove();
      }

    };


  messages.appendChild(confirm);


  /* =========================================
     CANCEL BUTTON
  ========================================= */

  const cancel =
    document.createElement("button");

  cancel.className =
    "cancel-button";

  cancel.textContent =
    "❌ A'a, canza bayanai";


  cancel.onclick =
    function() {

      addMessage(
        "A'a, ina son canza bayanin.",
        "user"
      );


      addMessage(
        "To, ka sake zabar package ko ka turo sabon lambar waya.",
        "bot"
      );


      BindawasubCustomerState.selectedProduct = null;

      BindawasubCustomerState.recipientPhone = null;

      BindawasubCustomerState.waitingForPhone = false;

      BindawasubCustomerState.waitingForConfirmation = false;


      confirm.remove();

      cancel.remove();


      const input =
        document.getElementById("messageInput");

      input.placeholder =
        "Rubuta saƙonka...";

    };


  messages.appendChild(cancel);


  BindawasubCustomerState.waitingForConfirmation =
    true;

}
