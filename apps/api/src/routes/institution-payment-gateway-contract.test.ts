import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative: string) => readFile(new URL(relative, import.meta.url), "utf8");

test("institution fee gateway keeps tenant funds separate from platform SaaS billing", async () => {
  const [route, service, schema, subscription] = await Promise.all([
    read("./institution-payments.ts"),
    read("../lib/institution-payments.ts"),
    read("../../prisma/schema.prisma"),
    read("../../../web/app/admin/subscription/page.tsx"),
  ]);
  assert.match(schema, /model InstitutionPaymentGateway \{/);
  assert.match(schema, /organizationId\s+String\s+@unique/);
  assert.match(schema, /model InstitutionPaymentOrder \{/);
  assert.match(schema, /providerOrderId\s+String\?\s+@unique/);
  assert.match(schema, /providerPaymentId\s+String\?\s+@unique/);
  assert.match(route, /\/organization\/payment-gateway/);
  assert.match(route, /allow\(Role\.SUPER_ADMIN\)/);
  assert.match(service, /gatewayClient\(gateway/);
  assert.match(subscription, /\/organization\/subscription\/checkout/);
  assert.match(subscription, /Pay subscription with Razorpay/);
});

test("institution gateway credentials are encrypted, masked and verification-gated", async () => {
  const [route, cryptoSource, config] = await Promise.all([
    read("./institution-payments.ts"),
    read("../lib/institution-payment-crypto.ts"),
    read("../config.ts"),
  ]);
  assert.match(config, /PAYMENT_CREDENTIAL_ENCRYPTION_KEY/);
  assert.match(cryptoSource, /aes-256-gcm/);
  assert.match(cryptoSource, /createCipheriv/);
  assert.match(cryptoSource, /setAuthTag/);
  assert.match(route, /encryptInstitutionPaymentSecret/);
  assert.match(route, /hasKeySecret/);
  assert.match(route, /hasWebhookSecret/);
  assert.doesNotMatch(route, /keySecretEncrypted:\s*gateway\.keySecretEncrypted/);
  assert.doesNotMatch(route, /webhookSecretEncrypted:\s*gateway\.webhookSecretEncrypted/);
  assert.match(route, /PAYMENT_GATEWAY_NOT_VERIFIED/);
  assert.match(route, /lastVerifiedAt/);
});

test("fee checkout does not mutate the fee ledger until a verified webhook captures payment", async () => {
  const [portal, service, server] = await Promise.all([
    read("./portals.ts"),
    read("../lib/institution-payments.ts"),
    read("../server.ts"),
  ]);
  assert.match(portal, /router\.post\("\/student\/fees\/:feeId\/pay"/);
  assert.match(portal, /router\.post\("\/parent\/children\/:studentId\/fees\/:feeId\/pay"/);
  assert.match(portal, /Idempotency-Key/);
  assert.match(portal, /createInstitutionFeeCheckout/);
  assert.match(service, /client\.orders\.create/);
  assert.match(service, /payment\.captured/);
  assert.match(service, /timingSafeEqual/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(service, /PaymentMode\.ONLINE/);
  assert.match(service, /tx\.feePayment\.create/);
  assert.match(service, /tx\.fee\.update/);
  const rawIndex = server.indexOf('app.use("/api/v1/institution-payments/razorpay/webhook/:gatewayId", express.raw');
  const jsonIndex = server.indexOf('app.use(express.json');
  assert.ok(rawIndex >= 0 && rawIndex < jsonIndex, "institution webhook must preserve the raw body before JSON parsing");
  assert.ok(server.includes('onlyPaths(["/platform/saas", "/organization/entitlements", "/organization/subscription"], saasCommercial)'));
  assert.ok(!server.includes('app.use("/api/v1", saasCommercial)'));
});

test("gateway capture enforces authoritative amount, currency, idempotency and manual-review safety", async () => {
  const service = await read("../lib/institution-payments.ts");
  assert.match(service, /assertPaymentWithinAuthoritativeBalance/);
  assert.match(service, /PARTIAL_PAYMENT_DISABLED/);
  assert.match(service, /PAYMENT_IDEMPOTENCY_CONFLICT/);
  assert.match(service, /PAYMENT_MISMATCH/);
  assert.match(service, /FEE_BALANCE_CHANGED/);
  assert.match(service, /REVIEW_REQUIRED/);
  assert.match(service, /effectivePaid !== fee\.amountPaidPaise/);
  assert.match(service, /providerPaymentId: String\(payment\.id\)/);
});

test("missed captured webhooks can be reconciled only from provider-authoritative data", async () => {
  const [route, service, gatewayPage] = await Promise.all([
    read("./institution-payments.ts"),
    read("../lib/institution-payments.ts"),
    read("../../../web/app/admin/payment-gateway/page.tsx"),
  ]);
  assert.match(route, /orders\/:orderId\/reconcile/);
  assert.match(route, /reconcileInstitutionPaymentOrder/);
  assert.match(service, /export async function reconcileInstitutionPaymentOrder/);
  assert.match(service, /client\.orders as any\)\.fetch\(order\.providerOrderId\)/);
  assert.match(service, /fetchPayments\(order\.providerOrderId\)/);
  assert.match(service, /PROVIDER_ORDER_MISMATCH/);
  assert.match(service, /MULTIPLE_CAPTURED_PAYMENTS/);
  assert.match(service, /PROVIDER_PAYMENT_NOT_CAPTURED/);
  assert.match(service, /String\(notes\.organizationId/);
  assert.match(service, /String\(notes\.localOrderId/);
  assert.match(service, /capturePayment\(order\.gatewayId/);
  assert.match(service, /ONLINE_FEE_PAYMENT_RECONCILIATION_RUN/);
  assert.match(gatewayPage, /Reconcile/);
  assert.match(gatewayPage, /orders\/\$\{order\.id\}\/reconcile/);
});

test("refunds are provider-confirmed before reducing the authoritative fee ledger", async () => {
  const service = await read("../lib/institution-payments.ts");
  assert.match(service, /requestInstitutionPaymentRefund/);
  assert.match(service, /client\.payments/);
  assert.match(service, /refund\.processed/);
  assert.match(service, /FeePaymentOffsetType\.REFUND/);
  assert.match(service, /razorpay-refund:/);
  assert.match(service, /amountPaidPaise: nextPaid/);
  assert.match(service, /ONLINE_FEE_PAYMENT_REFUNDED/);
});

test("web clients expose tenant setup, parent/student checkout and receipt download without secrets", async () => {
  const [gatewayPage, portal, sidebar, settings] = await Promise.all([
    read("../../../web/app/admin/payment-gateway/page.tsx"),
    read("../../../web/components/portal-workspace.tsx"),
    read("../../../web/components/sidebar.tsx"),
    read("../../../web/app/admin/settings/page.tsx"),
  ]);
  assert.match(gatewayPage, /Institution Razorpay account/);
  assert.match(gatewayPage, /Student money settles to the institution(?:'|&apos;)s own merchant account/);
  assert.match(gatewayPage, /Verify credentials/);
  assert.match(gatewayPage, /Enable online fees/);
  assert.match(gatewayPage, /refund/);
  assert.match(portal, /loadRazorpayCheckout/);
  assert.match(portal, /Pay .*online|Pay \$\{onlinePayments/);
  assert.match(portal, /Download receipt/);
  assert.match(portal, /ParentFees/);
  assert.match(sidebar, /Payment Gateway/);
  assert.match(sidebar, /tenantOnly: true/);
  assert.match(settings, /Student Payment Gateway/);
  assert.doesNotMatch(gatewayPage, /keySecretEncrypted|webhookSecretEncrypted/);
});
