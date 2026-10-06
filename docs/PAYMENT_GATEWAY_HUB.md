# Payment Gateway Hub — ERP 4.1

## Purpose

Being Brilliant uses two deliberately separate payment flows.

### A. Institution fee collection

Parents and students pay school/institute fees through the **institution's own Razorpay merchant account**.

Settlement path:

```text
Parent / Student
      ↓
Institution Razorpay account
      ↓
Institution bank settlement
```

Being Brilliant stores the institution's Razorpay Key ID plus encrypted Key Secret and encrypted Webhook Secret. The secrets are never returned to the browser.

### B. Platform SaaS subscription billing

Schools and institutes pay their Being Brilliant ERP/LMS subscription through the **platform Razorpay account configured by Adhyay Eduventure Private Limited**.

Settlement path:

```text
School / Institute
      ↓
Adhyay platform Razorpay account
      ↓
Adhyay bank settlement
```

This existing flow is exposed in **Subscription & Billing** and uses platform environment credentials. Institution fee credentials are never reused for SaaS billing.

## Institution setup

Prerequisite on the API service:

```env
PAYMENT_CREDENTIAL_ENCRYPTION_KEY=<strong unique secret of at least 32 characters>
```

For each tenant:

1. Sign in as that institution's `SUPER_ADMIN`.
2. Open **Fees & Finance → Payment Gateway**.
3. Select Razorpay mode: Test or Live.
4. Enter the institution's Razorpay Key ID, Key Secret and a dedicated Webhook Secret.
5. Select allowed checkout methods.
6. Choose whether partial fee payments are allowed.
7. Save.
8. Copy the generated tenant-specific webhook URL into the institution's Razorpay dashboard.
9. Subscribe that webhook to:
   - `payment.captured`
   - `payment.failed`
   - `refund.processed`
10. Use **Verify credentials**.
11. Enable online fees only after verification succeeds.

Changing a key, secret or mode automatically disables the gateway and clears the prior verification state. Re-verification is required.

## Student/parent checkout

The fee amount is always derived from the authoritative fee ledger.

- Full outstanding balance is the default.
- Partial payment is allowed only when the institution enables it.
- Checkout requires an idempotency key.
- Creating a Razorpay order does **not** mark the fee paid.
- Browser checkout success does **not** mark the fee paid.
- Only a signature-verified `payment.captured` webhook can create the `FeePayment`, update the fee balance/status and issue the receipt.

If a capture arrives after the authoritative balance has changed and the captured amount can no longer be safely applied, the transaction enters `REVIEW_REQUIRED` instead of corrupting the ledger.

## Receipts

After verified capture:

- a normal `FeePayment` record is created;
- the transaction uses `PaymentMode.ONLINE`;
- a unique receipt number is generated;
- the receipt becomes visible in the student/parent portal;
- finance reports continue to use the same authoritative `FeePayment` ledger.

## Refunds

Refund requests are initiated from the tenant Payment Gateway workspace.

The system sends the request to Razorpay but **does not reduce the ERP fee ledger immediately**. The ledger is changed only after a signature-verified `refund.processed` webhook.

The verified provider refund creates a normal `FeePaymentOffset` with type `REFUND`, so existing finance reporting and refund/reversal arithmetic remain authoritative.

## Security controls

- AES-256-GCM encryption for institution Key Secret and Webhook Secret.
- Separate server-side encryption key.
- Secrets never returned through the gateway API.
- Raw webhook body preserved before JSON parsing.
- HMAC SHA-256 signature verification with timing-safe comparison.
- Tenant-specific gateway ID in webhook URL.
- Provider order/payment IDs are unique.
- Checkout idempotency keys are unique.
- Serializable/row-lock capture path protects against concurrent over-collection.
- Amount and currency must match the locally created order.
- Fee payment is applied only to the order's tenant and fee.
- Credentials must be provider-verified before the gateway can be enabled.
- Credential changes disable the gateway until it is verified again.
- Audit records are created for gateway configuration, verification, enable/disable, checkout, capture, review-required state and refund activity.

## Production activation

Do not copy one institution's Razorpay credentials into another tenant.

Before enabling a live tenant:

- confirm the institution owns the Razorpay merchant account;
- use `LIVE` mode with an `rzp_live_` Key ID;
- use a dedicated webhook secret;
- verify the public API webhook URL is reachable over HTTPS;
- execute a controlled small-value live payment;
- confirm the verified webhook creates exactly one fee payment and receipt;
- confirm the amount reaches the intended institution merchant settlement;
- execute a controlled refund and confirm the refund webhook creates the correct fee offset;
- retain provider transaction IDs and ERP evidence.

## Platform SaaS gateway production activation

The Adhyay platform payment flow uses:

```env
RAZORPAY_MODE=live
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

The platform webhook remains:

```text
/api/v1/payments/razorpay/webhook
```

A tenant pays through **Admin → Subscription & Billing**. Subscription activation is confirmed only by the verified platform webhook.

## Provider extensibility

The database separates provider-independent gateway/order records from Razorpay-specific execution. Razorpay is the first supported institution provider. Future Cashfree, PayU or CCAvenue adapters can be added without mixing tenant fee settlement with platform SaaS billing.
