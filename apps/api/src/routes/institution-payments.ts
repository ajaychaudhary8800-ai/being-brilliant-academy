import "express-async-errors";
import { InstitutionPaymentOrderStatus, PaymentGatewayMode, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import { encryptInstitutionPaymentSecret, institutionPaymentEncryptionReady } from "../lib/institution-payment-crypto.js";
import {
  normalizedGatewayMethods,
  processInstitutionRazorpayWebhook,
  requestInstitutionPaymentRefund,
  verifyInstitutionGatewayCredentials,
} from "../lib/institution-payments.js";
import { AppError } from "../lib/http.js";
import { systemPrisma } from "../lib/prisma.js";
import { allow, requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

const methods = z.enum(["UPI", "CARD", "NETBANKING", "WALLET"]);
const gatewayInput = z.object({
  mode: z.nativeEnum(PaymentGatewayMode),
  keyId: z.string().trim().min(8).max(120),
  keySecret: z.string().trim().min(8).max(500).optional(),
  webhookSecret: z.string().trim().min(8).max(500).optional(),
  allowPartialPayments: z.boolean().default(false),
  paymentMethods: z.array(methods).min(1).max(4).default(["UPI", "CARD", "NETBANKING", "WALLET"]),
}).strict();

function modeMatches(mode: PaymentGatewayMode, keyId: string) {
  return keyId.startsWith(mode === PaymentGatewayMode.LIVE ? "rzp_live_" : "rzp_test_");
}

function gatewayView(gateway: any) {
  const origin = env.WEB_URL.replace(/\/$/, "");
  return {
    id: gateway.id,
    provider: gateway.provider,
    mode: gateway.mode,
    isEnabled: gateway.isEnabled,
    keyId: gateway.keyId,
    hasKeySecret: Boolean(gateway.keySecretEncrypted),
    hasWebhookSecret: Boolean(gateway.webhookSecretEncrypted),
    allowPartialPayments: gateway.allowPartialPayments,
    paymentMethods: normalizedGatewayMethods(gateway.paymentMethods),
    lastVerifiedAt: gateway.lastVerifiedAt,
    createdAt: gateway.createdAt,
    updatedAt: gateway.updatedAt,
    webhookUrl: `${origin}/api/v1/institution-payments/razorpay/webhook/${gateway.id}`,
  };
}

router.post("/institution-payments/razorpay/webhook/:gatewayId", async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw new AppError(400, "RAW_WEBHOOK_REQUIRED", "Webhook body must be received as raw JSON");
  const result = await processInstitutionRazorpayWebhook({
    gatewayId: String(req.params.gatewayId),
    raw: req.body,
    signature: req.header("x-razorpay-signature") ?? undefined,
    eventId: req.header("x-razorpay-event-id") ?? undefined,
  });
  res.status(200).json({ data: result });
});

router.get("/organization/payment-gateway", requireAuth, allow(Role.SUPER_ADMIN), async (req: AuthRequest, res) => {
  const gateway = await systemPrisma.institutionPaymentGateway.findUnique({ where: { organizationId: req.auth!.organizationId } });
  res.json({
    data: {
      encryptionReady: institutionPaymentEncryptionReady(),
      gateway: gateway ? gatewayView(gateway) : null,
    },
  });
});

router.put("/organization/payment-gateway", requireAuth, allow(Role.SUPER_ADMIN), async (req: AuthRequest, res) => {
  if (!institutionPaymentEncryptionReady()) {
    throw new AppError(503, "PAYMENT_ENCRYPTION_NOT_CONFIGURED", "Configure PAYMENT_CREDENTIAL_ENCRYPTION_KEY before storing institution gateway credentials");
  }
  const data = gatewayInput.parse(req.body);
  if (!modeMatches(data.mode, data.keyId)) {
    throw new AppError(422, "PAYMENT_GATEWAY_MODE_MISMATCH", `Razorpay key must match ${data.mode.toLowerCase()} mode`);
  }
  const organizationId = req.auth!.organizationId;
  const existing = await systemPrisma.institutionPaymentGateway.findUnique({ where: { organizationId } });
  if (!existing && (!data.keySecret || !data.webhookSecret)) {
    throw new AppError(422, "PAYMENT_GATEWAY_SECRETS_REQUIRED", "Key secret and webhook secret are required for initial setup");
  }

  const credentialsChanged =
    !existing ||
    existing.keyId !== data.keyId ||
    existing.mode !== data.mode ||
    Boolean(data.keySecret) ||
    Boolean(data.webhookSecret);

  const create = {
    organizationId,
    provider: "RAZORPAY",
    mode: data.mode,
    keyId: data.keyId,
    keySecretEncrypted: encryptInstitutionPaymentSecret(data.keySecret!),
    webhookSecretEncrypted: encryptInstitutionPaymentSecret(data.webhookSecret!),
    allowPartialPayments: data.allowPartialPayments,
    paymentMethods: data.paymentMethods as unknown as Prisma.InputJsonValue,
    isEnabled: false,
    lastVerifiedAt: null,
    createdById: req.auth!.userId,
    updatedById: req.auth!.userId,
  };
  const update: Prisma.InstitutionPaymentGatewayUpdateInput = {
    mode: data.mode,
    keyId: data.keyId,
    ...(data.keySecret ? { keySecretEncrypted: encryptInstitutionPaymentSecret(data.keySecret) } : {}),
    ...(data.webhookSecret ? { webhookSecretEncrypted: encryptInstitutionPaymentSecret(data.webhookSecret) } : {}),
    allowPartialPayments: data.allowPartialPayments,
    paymentMethods: data.paymentMethods as unknown as Prisma.InputJsonValue,
    updatedById: req.auth!.userId,
    ...(credentialsChanged ? { isEnabled: false, lastVerifiedAt: null } : {}),
  };

  const saved = await systemPrisma.institutionPaymentGateway.upsert({
    where: { organizationId },
    create,
    update,
  });
  await systemPrisma.auditLog.create({
    data: {
      organizationId,
      actorId: req.auth!.userId,
      action: existing ? "INSTITUTION_PAYMENT_GATEWAY_UPDATED" : "INSTITUTION_PAYMENT_GATEWAY_CONFIGURED",
      entity: "InstitutionPaymentGateway",
      entityId: saved.id,
      metadata: {
        provider: saved.provider,
        mode: saved.mode,
        keyId: saved.keyId,
        allowPartialPayments: saved.allowPartialPayments,
        paymentMethods: normalizedGatewayMethods(saved.paymentMethods),
        credentialsChanged,
      },
    },
  });
  res.status(existing ? 200 : 201).json({ data: gatewayView(saved) });
});

router.post("/organization/payment-gateway/verify", requireAuth, allow(Role.SUPER_ADMIN), async (req: AuthRequest, res) => {
  const verified = await verifyInstitutionGatewayCredentials(req.auth!.organizationId);
  const gateway = await systemPrisma.institutionPaymentGateway.findUniqueOrThrow({ where: { organizationId: req.auth!.organizationId } });
  await systemPrisma.auditLog.create({
    data: {
      organizationId: req.auth!.organizationId,
      actorId: req.auth!.userId,
      action: "INSTITUTION_PAYMENT_GATEWAY_VERIFIED",
      entity: "InstitutionPaymentGateway",
      entityId: gateway.id,
      metadata: { mode: verified.mode, keyId: verified.keyId, lastVerifiedAt: verified.lastVerifiedAt },
    },
  });
  res.json({ data: gatewayView(gateway) });
});

router.patch("/organization/payment-gateway/status", requireAuth, allow(Role.SUPER_ADMIN), async (req: AuthRequest, res) => {
  const { isEnabled } = z.object({ isEnabled: z.boolean() }).strict().parse(req.body);
  const organizationId = req.auth!.organizationId;
  const gateway = await systemPrisma.institutionPaymentGateway.findUnique({ where: { organizationId } });
  if (!gateway) throw new AppError(404, "PAYMENT_GATEWAY_NOT_FOUND", "Payment gateway is not configured");
  if (isEnabled && !gateway.lastVerifiedAt) {
    throw new AppError(409, "PAYMENT_GATEWAY_NOT_VERIFIED", "Verify the gateway credentials before enabling online fee collection");
  }
  if (isEnabled && !modeMatches(gateway.mode, gateway.keyId)) {
    throw new AppError(409, "PAYMENT_GATEWAY_MODE_MISMATCH", "Gateway key does not match the configured mode");
  }
  const saved = await systemPrisma.institutionPaymentGateway.update({
    where: { id: gateway.id },
    data: { isEnabled, updatedById: req.auth!.userId },
  });
  await systemPrisma.auditLog.create({
    data: {
      organizationId,
      actorId: req.auth!.userId,
      action: isEnabled ? "INSTITUTION_PAYMENT_GATEWAY_ENABLED" : "INSTITUTION_PAYMENT_GATEWAY_DISABLED",
      entity: "InstitutionPaymentGateway",
      entityId: saved.id,
      metadata: { mode: saved.mode, keyId: saved.keyId },
    },
  });
  res.json({ data: gatewayView(saved) });
});

router.get("/organization/payment-gateway/orders", requireAuth, allow(Role.SUPER_ADMIN), async (req: AuthRequest, res) => {
  const query = z.object({
    status: z.nativeEnum(InstitutionPaymentOrderStatus).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).strict().parse(req.query);
  const where = {
    organizationId: req.auth!.organizationId,
    ...(query.status ? { status: query.status } : {}),
  };
  const [rows, total] = await Promise.all([
    systemPrisma.institutionPaymentOrder.findMany({
      where,
      include: {
        fee: {
          select: {
            id: true,
            feeHead: true,
            branchId: true,
            student: { select: { id: true, admissionNo: true, user: { select: { name: true } } } },
          },
        },
        feePayment: { select: { id: true, receiptNumber: true, paymentDate: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    systemPrisma.institutionPaymentOrder.count({ where }),
  ]);
  res.json({
    data: rows.map(row => ({
      id: row.id,
      amountPaise: row.amountPaise,
      refundedPaise: row.refundedPaise,
      currency: row.currency,
      providerOrderId: row.providerOrderId,
      providerPaymentId: row.providerPaymentId,
      status: row.status,
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      capturedAt: row.capturedAt,
      refundedAt: row.refundedAt,
      createdAt: row.createdAt,
      fee: row.fee,
      receipt: row.feePayment,
    })),
    meta: { total, page: query.page, limit: query.limit, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
  });
});

router.post("/organization/payment-gateway/orders/:orderId/refund", requireAuth, allow(Role.SUPER_ADMIN), async (req: AuthRequest, res) => {
  const { amountPaise } = z.object({ amountPaise: z.number().int().positive().max(2_147_483_647) }).strict().parse(req.body);
  const data = await requestInstitutionPaymentRefund({
    organizationId: req.auth!.organizationId,
    orderId: String(req.params.orderId),
    requestedById: req.auth!.userId,
    amountPaise,
  });
  res.status(202).json({ data });
});

export default router;
