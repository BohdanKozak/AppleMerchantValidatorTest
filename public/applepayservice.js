var applePayService = {
  renderButton: function(f, buttonPlaceholderId) {
    function fireError(err) {
      if (typeof f.onError === "function") {
        f.onError(err);
      } else {
        console.error(err);
      }
    }

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
      fireError(`Container with id "${buttonPlaceholderId}" not found`);
      return;
    }

    if (!window.ApplePaySession || !ApplePaySession.canMakePayments()) {
      container.style.display = "none";
      fireError("Apple Pay is not supported or not available.");
      return;
    }

    const button = createApplePayButton();
    container.appendChild(button);

    button.addEventListener("click", async () => {
      button.disabled = true;
      if (typeof f.onInitPayment !== "function") {
        throw fireError("initPayment is not implemented");
      }
      
      const initResponse = await f.onInitPayment();

      fireError("HELLO FROM APPLEPAY SERVICE")

      if (
        !initResponse ||
        !initResponse.countryCode ||
        !initResponse.amount ||
        !initResponse.currencyCode
      ) {
        throw fireError("'onInitPayment' parameters are invalid");
      }

      const paymentRequest = {
        countryCode: initResponse.countryCode,
        currencyCode: initResponse.currencyCode,
        merchantCapabilities: ["supports3DS"],
        supportedNetworks: ["visa", "masterCard", "amex"],
        total: {
          label: "Your Merchant Name",
          amount: initResponse.amount,
          type: "final",
        },
      };

      const session = new ApplePaySession(4, paymentRequest);

      session.onvalidatemerchant = async (event) => {
        try {
          if (typeof f.onPrepareDeposit !== "function") {
            fireError("onPrepareDeposit is not implemented");
            return session.abort();
          }

          const response = await f.onPrepareDeposit();

          if (!response.ok) throw new Error("Merchant validation failed");

          const merchantSession = await response.json();

          session.completeMerchantValidation(merchantSession);
        } catch (err) {
          fireError("Merchant validation failed: " + err.message);
          session.abort();
        }
      };

      session.onpaymentauthorized = async (event) => {
        if (typeof f.onConfirmDeposit !== "function") {
          fireError("onConfirmDeposit is not implemented");
          return session.completePayment(ApplePaySession.STATUS_FAILURE);
        }

        try {
          await fetch("https://applemerchantvalidatortest.onrender.com/authorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: JSON.stringify(event.payment.token) }),
          });
          const result = await f.onConfirmDeposit(JSON.stringify(event.payment.token));

          session.completePayment(
            result === true
              ? ApplePaySession.STATUS_SUCCESS
              : ApplePaySession.STATUS_FAILURE
          );
        } catch (err) {
          fireError("Payment authorization failed: " + err.message);
          session.completePayment(ApplePaySession.STATUS_FAILURE);
        }
      };

      session.begin();
    });
  },
};
