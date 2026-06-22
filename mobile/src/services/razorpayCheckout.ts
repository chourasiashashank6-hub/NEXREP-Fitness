import { Platform } from "react-native";
import i18n from "../i18n";
import type { PlanId } from "../constants/plans";
import { createRazorpayOrder, verifyRazorpayPayment } from "../api/payments";

export type RazorpayPrefill = {
  email?: string;
  contact?: string;
  name?: string;
};

export type RazorpayCheckoutParams = {
  planId: PlanId;
  billingCycle: "monthly" | "yearly";
  amountInr: number;
  planLabel: string;
  paymentMethod: string;
  prefill: RazorpayPrefill;
};

export type RazorpayCheckoutResult = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type RazorpayHandlerResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: (r: unknown) => void) => void };
  }
}

function loadRazorpayScript(): Promise<NonNullable<typeof window.Razorpay>> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error(i18n.t("payment.checkout.browserOnly")));
      return;
    }
    if (window.Razorpay) {
      resolve(window.Razorpay);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error(i18n.t("payment.checkout.loadFailed")));
    };
    script.onerror = () => reject(new Error(i18n.t("payment.checkout.loadCheckoutFailed")));
    document.body.appendChild(script);
  });
}

async function openWebCheckout(
  order: { key_id: string; order_id: string; amount: number },
  params: RazorpayCheckoutParams,
): Promise<RazorpayCheckoutResult> {
  const Razorpay = await loadRazorpayScript();

  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: "INR",
      name: "NexRep",
      description: i18n.t("payment.checkout.description", { planLabel: params.planLabel }),
      order_id: order.order_id,
      prefill: params.prefill,
      theme: { color: "#2ECC9A" },
      handler: (response: RazorpayHandlerResponse) => {
        resolve({
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id: response.razorpay_order_id,
          razorpay_signature: response.razorpay_signature,
        });
      },
      modal: {
        ondismiss: () => reject(Object.assign(new Error(i18n.t("payment.checkout.cancelled")), { code: 2 })),
      },
    });
    rzp.on("payment.failed", (resp: unknown) => {
      const detail =
        resp && typeof resp === "object" && "error" in resp
          ? String((resp as { error?: { description?: string } }).error?.description ?? i18n.t("payment.checkout.paymentFailed"))
          : i18n.t("payment.checkout.paymentFailed");
      reject(new Error(detail));
    });
    rzp.open();
  });
}

export async function runRazorpayCheckout(params: RazorpayCheckoutParams): Promise<RazorpayCheckoutResult> {
  const order = await createRazorpayOrder({
    plan_id: params.planId,
    billing_cycle: params.billingCycle,
    amount_inr: params.amountInr,
    payment_method: params.paymentMethod,
  });

  if (Platform.OS !== "web") {
    throw new Error(i18n.t("payment.checkout.mobileOnly"));
  }

  return openWebCheckout(order, params);
}

export async function completePayment(
  checkout: RazorpayCheckoutResult,
  planId: PlanId,
  billingCycle: "monthly" | "yearly",
) {
  return verifyRazorpayPayment({
    razorpay_order_id: checkout.razorpay_order_id,
    razorpay_payment_id: checkout.razorpay_payment_id,
    razorpay_signature: checkout.razorpay_signature,
    plan_id: planId,
    billing_cycle: billingCycle,
  });
}

export function buildRazorpayWebViewHtml(
  order: { key_id: string; order_id: string; amount: number },
  params: RazorpayCheckoutParams,
): string {
  const prefill = JSON.stringify(params.prefill);
  const checkoutDescription = JSON.stringify(i18n.t("payment.checkout.description", { planLabel: params.planLabel }));
  const openingSecureCheckout = i18n.t("payment.checkout.openingSecureCheckout");
  const paymentFailed = JSON.stringify(i18n.t("payment.checkout.paymentFailed"));
  return `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>body{margin:0;background:#0a0f0d;color:#e8f0eb;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
</head><body><p>${openingSecureCheckout}</p>
<script>
  const options = {
    key: ${JSON.stringify(order.key_id)},
    amount: ${order.amount},
    currency: "INR",
    name: "NexRep",
    description: ${checkoutDescription},
    order_id: ${JSON.stringify(order.order_id)},
    prefill: ${prefill},
    theme: { color: "#2ECC9A" },
    handler: function (response) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, ...response }));
    },
    modal: { ondismiss: function () {
      window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, code: 2 }));
    }}
  };
  const rzp = new Razorpay(options);
  rzp.on("payment.failed", function (resp) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, message: (resp.error && resp.error.description) || ${paymentFailed} }));
  });
  rzp.open();
</script></body></html>`;
}

export async function createOrderForCheckout(params: RazorpayCheckoutParams) {
  return createRazorpayOrder({
    plan_id: params.planId,
    billing_cycle: params.billingCycle,
    amount_inr: params.amountInr,
    payment_method: params.paymentMethod,
  });
}
