var applePayService = {
  renderButton: function(buttonPlaceholderId) {
    function createApplePayButton() {
      const button = document.createElement("button");
      button.id = "applepay_button";
      button.setAttribute("type", "button");
      button.setAttribute("lang", "en");
      button.setAttribute("role", "button");

      Object.assign(button.style, {
        width: "220px",
        height: "44px",
        cursor: "pointer",
        display: "inline-block",
        WebkitAppearance: "-apple-pay-button"
      });
      button.style.setProperty("-apple-pay-button-style", "black");
      button.style.setProperty("-apple-pay-button-type", "plain");

      return button;
    }

    const container = document.getElementById(buttonPlaceholderId);
    if (!container) {
      alert(`Container with id "${buttonPlaceholderId}" not found`);
      return;
    }

    if (!window.ApplePaySession || !ApplePaySession.canMakePayments()) {
      container.style.display = "none";
      alert("Apple Pay is not supported or not available.");
      return;
    }

    const button = createApplePayButton();
    container.appendChild(button);

    button.addEventListener("click", async () => {
      button.disabled = true;

      const paymentRequest = {
        countryCode: "US",
        currencyCode: "USD",
        merchantCapabilities: ["supports3DS"],
        supportedNetworks: ["visa", "masterCard", "amex"],
        total: {
          label: "Your Merchant Name",
          amount: "9.99",
          type: "final",
        },
      };

      const session = new ApplePaySession(4, paymentRequest);

      session.onvalidatemerchant = async (event) => {
        try {
          const response = await fetch(
            "https://applemerchantvalidatortest.onrender.com/validate-merchant",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ validationUrl: event.validationURL }),
            }
          );

          if (!response.ok) throw new Error("Merchant validation failed");

          const merchantSession = await response.json();

          session.completeMerchantValidation(merchantSession);
        } catch (err) {
          alert("Merchant validation failed: " + err.message);
          session.abort();
        }
      };

      session.onpaymentauthorized = async (event) => {
        try {
          await fetch("https://applemerchantvalidatortest.onrender.com/authorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: event.payment.token }),
          });

          session.completePayment(ApplePaySession.STATUS_SUCCESS);
        } catch (err) {
          alert("Payment authorization failed: " + err.message);
          session.completePayment(ApplePaySession.STATUS_FAILURE);
        }
      };

      session.begin();
    });
  },
};
