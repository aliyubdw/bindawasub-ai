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

function showProducts(products) {
  const messages = document.getElementById("messages");
  if (!messages || !Array.isArray(products) || !products.length) return;

  const productList = document.createElement("div");
  productList.className = "product-list";

  const firstProduct = products[0] || {};
  const networkName =
    firstProduct.network_name ||
    (Array.isArray(firstProduct.service_networks) ? firstProduct.service_networks[0]?.name : firstProduct.service_networks?.name) ||
    firstProduct.network ||
    "Data";

  const topHeading = document.createElement("div");
  topHeading.className = "product-list-heading";
  topHeading.innerHTML = `
    <span class="product-network-icon">📶</span>
    <span><strong>${networkName} Data Plans</strong><small>Choose a package</small></span>
  `;
  productList.appendChild(topHeading);

  // Group every plan by its Data Type. The network response already contains
  // only plans for the selected network, so no other network can leak here.
  const groups = new Map();

  products.forEach(product => {
    const variantName =
      product.variant_name ||
      (Array.isArray(product.service_variants) ? product.service_variants[0]?.name : product.service_variants?.name) ||
      product.variant ||
      "Data";

    const key =
      String(
        product.variant ||
        product.variant_name ||
        variantName
      ).trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "data";

    if (!groups.has(key)) {
      groups.set(key, {
        name: variantName,
        products: []
      });
    }

    groups.get(key).products.push(product);
  });

  groups.forEach(group => {
    const groupHeading = document.createElement("div");
    groupHeading.className = "product-list-heading data-type-heading";
    groupHeading.innerHTML = `
      <span class="product-network-icon">▣</span>
      <span><strong>${group.name}</strong><small>${group.products.length} plan${group.products.length === 1 ? "" : "s"} available</small></span>
    `;
    productList.appendChild(groupHeading);

    const grid = document.createElement("div");
    grid.className = "product-grid";

    group.products.forEach(product => {
      const card = document.createElement("button");
      card.className = "product-card";
      card.type = "button";

      const name = String(product.product_name || "Data");
      const duration =
        String(product.duration || (
          product.validity_value != null && product.validity_unit
            ? product.validity_value + " " + product.validity_unit
            : "Validity not specified"
        ));
      const price = Number(product.selling_price || 0).toLocaleString();
      const network =
        product.network_name ||
        product.network ||
        (Array.isArray(product.service_networks) ? product.service_networks[0]?.name : product.service_networks?.name) ||
        "Data";

      card.innerHTML = `
        <span class="product-network">${network}</span>
        <span class="product-name">${name}</span>
        <span class="product-details">${duration}</span>
        <span class="product-price">₦${price}</span>
        <span class="product-select">Select</span>
      `;

      card.onclick = function() {
        BindawasubCustomerState.selectedProduct = product;
        BindawasubCustomerState.waitingForPhone = true;
        BindawasubCustomerState.waitingForConfirmation = false;

        addMessage(`Na zabi ${product.product_name}`, "user");
        addMessage(
          `Ka turo min lambar wayar da za a saka data.\\n\\nMisali: 08012345678`,
          "bot"
        );

        const input = document.getElementById("messageInput");
        input.placeholder = "Shigar da lambar wayar...";
        input.focus();
        productList.remove();
      };

      grid.appendChild(card);
    });

    productList.appendChild(grid);
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

${BindawasubCustomerState.selectedProduct.product_name}
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

        const reference =
          "BW-" +
          Date.now() +
          "-" +
          Math.random()
            .toString(36)
            .substring(2, 8);


        /* =====================================
           PROCESS WALLET PURCHASE
        ===================================== */

        const response = await callEdgeFunction({
          action: "purchase",
          product_id: BindawasubCustomerState.selectedProduct.id,
          phone_number: BindawasubCustomerState.recipientPhone,
          reference: reference
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
