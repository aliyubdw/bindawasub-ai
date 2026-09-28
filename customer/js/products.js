// Bindawasub AI — products, recipient validation and order confirmation

let selectedProduct = null;
let recipientPhone = null;
let waitingForPhone = false;
let waitingForConfirmation = false;

function showProducts(products) {

  const messages =
    document.getElementById("messages");

  const productList =
    document.createElement("div");

  productList.className =
    "product-list";


  products.forEach(product => {

    const card =
      document.createElement("button");

    card.className =
      "product-card";

    card.type =
      "button";


    card.innerHTML = `

      <div class="product-name">
        ${product.product_name}
      </div>

      <div class="product-details">
        ${product.duration || ""}
      </div>

      <div class="product-price">
        ₦${Number(product.selling_price).toLocaleString()}
      </div>

    `;


    /* =========================================
       PACKAGE CLICK
    ========================================= */

    card.onclick = function() {

      selectedProduct = product;

      waitingForPhone = true;

      waitingForConfirmation = false;


      addMessage(
        `Na zabi ${product.product_name}`,
        "user"
      );


      addMessage(
        `Ka turo min lambar wayar da za a saka data.

Misali: 08012345678`,
        "bot"
      );


      const input =
        document.getElementById("messageInput");

      input.placeholder =
        "Shigar da lambar wayar...";

      input.focus();


      productList.remove();

    };


    productList.appendChild(card);

  });


  messages.appendChild(productList);

  messages.scrollTop =
    messages.scrollHeight;
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

${selectedProduct.product_name}
Farashi: ₦${Number(selectedProduct.selling_price).toLocaleString()}
Lamba: ${recipientPhone}

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
          product_id: selectedProduct.id,
          phone_number: recipientPhone,
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

Package: ${selectedProduct.product_name}
Lamba: ${recipientPhone}
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


      waitingForConfirmation =
        false;


      selectedProduct =
        null;


      recipientPhone =
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


      selectedProduct = null;

      recipientPhone = null;

      waitingForPhone = false;

      waitingForConfirmation = false;


      confirm.remove();

      cancel.remove();


      const input =
        document.getElementById("messageInput");

      input.placeholder =
        "Rubuta saƙonka...";

    };


  messages.appendChild(cancel);


  waitingForConfirmation =
    true;

}
