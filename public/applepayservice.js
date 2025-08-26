var applePayService = {
  renderButton: function(f, buttonPlaceholderId) {
    function fireError(err) {
      if (typeof f.onError === "function") {
        f.onError(err);
      } else {
        console.error(err);
      }
    }

    function getApplePayVersion() {
      if (!window.ApplePaySession) return 0;

      for (let v = 16; v >= 1; v--) {
          if (ApplePaySession.supportsVersion(v)) return v;
      }
        return 0;
    }

    function createApplePayButton() {
      const button = document.createElement("button");
      button.id = "applepay_button";
      button.setAttribute("type", "pay");
      button.setAttribute("lang", "en");
      button.setAttribute("role", "button");

      button.style.setProperty("-apple-pay-button-style", "black");
      button.style.setProperty("-apple-pay-button-type", "plain");
      button.style.width = "200px";
    button.style.height = "44px";
    
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

      const session = new ApplePaySession(getApplePayVersion(), paymentRequest);

      session.onvalidatemerchant = async () => {
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
          const result = await f.onConfirmDeposit(btoa(JSON.stringify(event.payment.token)));

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
