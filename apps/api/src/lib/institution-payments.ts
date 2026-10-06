import crypto from "node:crypto";
import Razorpay from "razorpay";
import {
  FeePaymentOffsetType,
  InstitutionPaymentOrderStatus,
  PaymentGatewayMode,
  PaymentMode,
  Prisma,
  Role,
} from "@prisma/client";
import { AppError } from "./http.js";
import { assertPaymentWithinAuthoritativeBalance, feeStatus, safeFinanceAuditMetadata } from "./finance-integrity.js";
import { decryptInstitutionPaymentSecret } from "./institution-payment-crypto.js";
import { systemPrisma } from "./prisma.js";

const DEFAULT_METHODS = ["UPI", "CARD", "NETBANKING", "WALLET"];

export function normalizedGatewayMethods(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_METHODS;
  const methods = value
    .map(item => String(item).trim().toUpperCase())
    .filter(item => ["UPI", "CARD", "NETBANKING", "WALLET"].includes(item));
  return [...new Set(methods)];
}

function gatewayClient(gateway: { keyId: string; keySecretEncrypted: string }) {
  return new Razorpay({
    key_id: gateway.keyId,
    key_secret: decryptInstitutionPaymentSecret(gateway.keySecretEncrypted),
  });
}

function assertGatewayKeyMode(gateway: { keyId: string; mode: PaymentGatewayMode }) {
  const expected = gateway.mode === PaymentGatewayMode.LIVE ? "rzp_live_" : "rzp_test_";
  if (!gateway.keyId.startsWith(expected)) {
    throw new AppError(409, "PAYMENT_GATEWAY_MODE_MISMATCH", `Gateway key does not match ${gateway.mode.toLowerCase()} mode`);
  }
}

async function gatewayForOrganization(organizationId: string) {
  const gateway = await systemPrisma.institutionPaymentGateway.findUnique({ where: { organizationId } });
  if (!gateway || !gateway.isEnabled || !gateway.lastVerifiedAt) {
    throw new AppError(409, "INSTITUTION_PAYMENT_GATEWAY_UNAVAILABLE", "Online fee payment is not enabled and verified by this institution");
  }
  assertGatewayKeyMode(gateway);
  return gateway;
}

async function authoritativeFeeBalance(organizationId: string, feeId: string) {
  const fee = await systemPrisma.fee.findFirst({
    where: { id: feeId, organizationId },
    select: {
      id: true,
      organizationId: true,
      studentId: true,
      branchId: true,
      feeHead: true,
      totalPaise: true,
      discountPaise: true,
      finePaise: true,
      amountPaidPaise: true,
      dueDate: true,
      status: true,
    },
  });
  if (!fee) throw new AppError(404, "FEE_NOT_FOUND", "Fee record not found");
  const [payments, offsets] = await Promise.all([
    systemPrisma.feePayment.aggregate({
      where: { organizationId, feeId },
      _sum: { amountPaise: true },
    }),
    systemPrisma.feePaymentOffset.aggregate({
      where: { organizationId, feeId },
      _sum: { amountPaise: true },
    }),
  ]);
  const effectivePaid = Number(payments._sum.amountPaise ?? 0) - Number(offsets._sum.amountPaise ?? 0);
  if (effectivePaid < 0 || effectivePaid !== fee.amountPaidPaise) {
    throw new AppError(409, "PAYMENT_LEDGER_INCONSISTENT", "Fee payment ledger is inconsistent");
  }
  const balancePaise = Math.max(0, fee.totalPaise - fee.discountPaise + fee.finePaise - effectivePaid);
  return { fee, effectivePaid, balancePaise };
}

export async function createInstitutionFeeCheckout(input: {
  organizationId: string;
  payerUserId: string;
  studentId: string;
  feeId: string;
  amountPaise?: number;
  idempotencyKey: string;
}) {
  const gateway = await gatewayForOrganization(input.organizationId);
  const ledger = await authoritativeFeeBalance(input.organizationId, input.feeId);
  if (ledger.fee.studentId !== input.studentId) throw new AppError(404, "FEE_NOT_FOUND", "Fee record not found");
  if (ledger.balancePaise <= 0) throw new AppError(409, "FEE_ALREADY_PAID", "This fee has no outstanding balance");

  const amountPaise = input.amountPaise ?? ledger.balancePaise;
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new AppError(422, "INVALID_PAYMENT_AMOUNT", "Payment amount must be a positive integer in paise");
  assertPaymentWithinAuthoritativeBalance(
    ledger.fee.totalPaise,
    ledger.fee.discountPaise,
    ledger.fee.finePaise,
    ledger.effectivePaid,
    amountPaise,
  );
  if (!gateway.allowPartialPayments && amountPaise !== ledger.balancePaise) {
    throw new AppError(422, "PARTIAL_PAYMENT_DISABLED", "This institution requires the full outstanding amount");
  }

  const storedKey = `${input.organizationId}:${input.idempotencyKey}`;
  const existing = await systemPrisma.institutionPaymentOrder.findUnique({ where: { idempotencyKey: storedKey } });
  if (existing) {
    if (existing.organizationId !== input.organizationId || existing.payerUserId !== input.payerUserId || existing.feeId !== input.feeId || existing.amountPaise !== amountPaise) {
      throw new AppError(409, "PAYMENT_IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different payment");
    }
    if (existing.providerOrderId && existing.status === InstitutionPaymentOrderStatus.CREATED) {
      return {
        reused: true,
        gatewayId: gateway.id,
        keyId: gateway.keyId,
        methods: normalizedGatewayMethods(gateway.paymentMethods),
        allowPartialPayments: gateway.allowPartialPayments,
        localOrderId: existing.id,
        order: {
          id: existing.providerOrderId,
          amount: existing.amountPaise,
          currency: existing.currency,
        },
      };
    }
    throw new AppError(409, "PAYMENT_ORDER_NOT_REUSABLE", "Create a new checkout attempt");
  }

  const localOrder = await systemPrisma.institutionPaymentOrder.create({
    data: {
      organizationId: input.organizationId,
      gatewayId: gateway.id,
      feeId: input.feeId,
      studentId: input.studentId,
      payerUserId: input.payerUserId,
      amountPaise,
      currency: "INR",
      provider: "RAZORPAY",
      idempotencyKey: storedKey,
      status: InstitutionPaymentOrderStatus.CREATED,
    },
  });

  try {
    const client = gatewayClient(gateway);
    const providerOrder = await client.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `FEE-${localOrder.id}`.slice(0, 40),
      notes: {
        organizationId: input.organizationId,
        localOrderId: localOrder.id,
        feeId: input.feeId,
        studentId: input.studentId,
      },
    });
    await systemPrisma.institutionPaymentOrder.update({
      where: { id: localOrder.id },
      data: { providerOrderId: providerOrder.id, raw: providerOrder as unknown as Prisma.InputJsonValue },
    });
    await systemPrisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.payerUserId,
        action: "ONLINE_FEE_CHECKOUT_CREATED",
        entity: "InstitutionPaymentOrder",
        entityId: localOrder.id,
        metadata: safeFinanceAuditMetadata({
          feeId: input.feeId,
          studentId: input.studentId,
          amountPaise,
          providerOrderId: providerOrder.id,
          gatewayId: gateway.id,
        }),
      },
    });
    return {
      reused: false,
      gatewayId: gateway.id,
      keyId: gateway.keyId,
      methods: normalizedGatewayMethods(gateway.paymentMethods),
      allowPartialPayments: gateway.allowPartialPayments,
      localOrderId: localOrder.id,
      order: providerOrder,
    };
  } catch (error) {
    await systemPrisma.institutionPaymentOrder.update({
      where: { id: localOrder.id },
      data: {
        status: InstitutionPaymentOrderStatus.FAILED,
        failureCode: "PROVIDER_ORDER_FAILED",
        failureMessage: error instanceof Error ? error.message.slice(0, 1000) : "Unable to create provider order",
      },
    }).catch(() => undefined);
    throw error;
  }
}

function signatureValid(raw: Buffer, supplied: string | undefined, secret: string) {
  if (!supplied || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

function eventKey(raw: Buffer, supplied?: string) {
  const clean = supplied?.trim();
  return clean && clean.length <= 200 ? clean : crypto.createHash("sha256").update(raw).digest("hex");
}

async function recordReviewRequired(orderId: string, organizationId: string, code: string, message: string, raw: Prisma.InputJsonValue) {
  await systemPrisma.institutionPaymentOrder.update({
    where: { id: orderId },
    data: {
      status: InstitutionPaymentOrderStatus.REVIEW_REQUIRED,
      failureCode: code,
      failureMessage: message,
      raw,
    },
  });
  await systemPrisma.auditLog.create({
    data: {
      organizationId,
      action: "ONLINE_FEE_PAYMENT_REVIEW_REQUIRED",
      entity: "InstitutionPaymentOrder",
      entityId: orderId,
      metadata: safeFinanceAuditMetadata({ code, message }),
    },
  });
}

async function capturePayment(gatewayId: string, eventId: string, event: any) {
  const payment = event?.payload?.payment?.entity;
  if (!payment?.order_id || !payment?.id) return { handled: false, reason: "missing_payment" };
  const order = await systemPrisma.institutionPaymentOrder.findFirst({
    where: { gatewayId, providerOrderId: String(payment.order_id) },
  });
  if (!order) return { handled: false, reason: "unknown_order" };
  if (order.status === InstitutionPaymentOrderStatus.CAPTURED && order.providerPaymentId === String(payment.id)) {
    return { handled: true, duplicate: true, orderId: order.id };
  }

  if (Number(payment.amount) !== order.amountPaise || String(payment.currency).toUpperCase() !== order.currency) {
    await recordReviewRequired(order.id, order.organizationId, "PAYMENT_MISMATCH", "Captured provider payment does not match the local order", event as Prisma.InputJsonValue);
    return { handled: true, reviewRequired: true, orderId: order.id };
  }

  try {
    const result = await systemPrisma.$transaction(async tx => {
      const lockedOrders = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "InstitutionPaymentOrder"
        WHERE "id" = ${order.id}
        FOR UPDATE
      `);
      if (!lockedOrders.length) throw new AppError(404, "PAYMENT_ORDER_NOT_FOUND", "Payment order not found");

      const current = await tx.institutionPaymentOrder.findUnique({ where: { id: order.id } });
      if (!current) throw new AppError(404, "PAYMENT_ORDER_NOT_FOUND", "Payment order not found");
      if (current.status === InstitutionPaymentOrderStatus.CAPTURED) {
        return { paymentId: current.feePaymentId, duplicate: true };
      }

      const feeRows = await tx.$queryRaw<Array<{
        id: string;
        organizationId: string;
        totalPaise: number;
        discountPaise: number;
        finePaise: number;
        amountPaidPaise: number;
        dueDate: Date;
      }>>(Prisma.sql`
        SELECT "id", "organizationId", "totalPaise", "discountPaise", "finePaise", "amountPaidPaise", "dueDate"
        FROM "Fee"
        WHERE "id" = ${current.feeId} AND "organizationId" = ${current.organizationId}
        FOR UPDATE
      `);
      const fee = feeRows[0];
      if (!fee) throw new AppError(404, "FEE_NOT_FOUND", "Fee record not found");

      const [payments, offsets] = await Promise.all([
        tx.feePayment.aggregate({ where: { organizationId: current.organizationId, feeId: fee.id }, _sum: { amountPaise: true } }),
        tx.feePaymentOffset.aggregate({ where: { organizationId: current.organizationId, feeId: fee.id }, _sum: { amountPaise: true } }),
      ]);
      const effectivePaid = Number(payments._sum.amountPaise ?? 0) - Number(offsets._sum.amountPaise ?? 0);
      const remaining = fee.totalPaise - fee.discountPaise + fee.finePaise - effectivePaid;
      if (effectivePaid < 0 || effectivePaid !== fee.amountPaidPaise || current.amountPaise > remaining) {
        await tx.institutionPaymentOrder.update({
          where: { id: current.id },
          data: {
            status: InstitutionPaymentOrderStatus.REVIEW_REQUIRED,
            providerPaymentId: String(payment.id),
            failureCode: "FEE_BALANCE_CHANGED",
            failureMessage: "Captured payment requires manual reconciliation because the authoritative fee balance changed",
            raw: event as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: current.organizationId,
            action: "ONLINE_FEE_PAYMENT_REVIEW_REQUIRED",
            entity: "InstitutionPaymentOrder",
            entityId: current.id,
            metadata: safeFinanceAuditMetadata({ feeId: fee.id, effectivePaid, remaining, capturedPaise: current.amountPaise }),
          },
        });
        return { paymentId: null, reviewRequired: true };
      }

      const receiptNumber = `BBA-FEE-${crypto.randomUUID().toUpperCase()}`;
      const feePayment = await tx.feePayment.create({
        data: {
          organizationId: current.organizationId,
          feeId: fee.id,
          amountPaise: current.amountPaise,
          paymentDate: new Date(),
          paymentMode: PaymentMode.ONLINE,
          transactionId: String(payment.id),
          receiptNumber,
          remarks: "Verified Razorpay online fee payment",
          collectedById: null,
        },
      });
      const amountPaidPaise = effectivePaid + current.amountPaise;
      await tx.fee.update({
        where: { id: fee.id },
        data: {
          amountPaidPaise,
          status: feeStatus(fee.totalPaise, fee.discountPaise, fee.finePaise, amountPaidPaise, fee.dueDate),
        },
      });
      await tx.institutionPaymentOrder.update({
        where: { id: current.id },
        data: {
          status: InstitutionPaymentOrderStatus.CAPTURED,
          providerPaymentId: String(payment.id),
          feePaymentId: feePayment.id,
          capturedAt: new Date(),
          failureCode: null,
          failureMessage: null,
          raw: event as Prisma.InputJsonValue,
        },
      });
      for (const action of ["ONLINE_FEE_PAYMENT_CAPTURED", "RECEIPT_ISSUED"]) {
        await tx.auditLog.create({
          data: {
            organizationId: current.organizationId,
            actorId: current.payerUserId,
            action,
            entity: "FeePayment",
            entityId: feePayment.id,
            metadata: safeFinanceAuditMetadata({
              feeId: fee.id,
              institutionPaymentOrderId: current.id,
              amountPaise: current.amountPaise,
              transactionId: String(payment.id),
              receiptNumber,
            }),
          },
        });
      }
      await tx.notification.create({
        data: {
          organizationId: current.organizationId,
          userId: current.payerUserId,
          title: "Fee payment confirmed",
          body: `Your online fee payment of INR ${(current.amountPaise / 100).toFixed(2)} has been confirmed. Receipt ${receiptNumber} is now available in Fees.`,
          category: "FINANCE",
          sourceModule: "FEES",
          sourceEntityId: feePayment.id,
          actionUrl: "/portal",
          priority: "NORMAL",
          channels: ["IN_APP"],
        },
      });
      return { paymentId: feePayment.id, receiptNumber, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { handled: true, orderId: order.id, ...result };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const refreshed = await systemPrisma.institutionPaymentOrder.findUnique({ where: { id: order.id } });
      if (refreshed?.status === InstitutionPaymentOrderStatus.CAPTURED) {
        return { handled: true, duplicate: true, orderId: order.id, paymentId: refreshed.feePaymentId };
      }
    }
    throw error;
  }
}

async function failPayment(gatewayId: string, event: any) {
  const payment = event?.payload?.payment?.entity;
  if (!payment?.order_id) return { handled: false, reason: "missing_payment" };
  const order = await systemPrisma.institutionPaymentOrder.findFirst({
    where: { gatewayId, providerOrderId: String(payment.order_id) },
  });
  if (!order) return { handled: false, reason: "unknown_order" };
  if (order.status === InstitutionPaymentOrderStatus.CAPTURED || order.status === InstitutionPaymentOrderStatus.REFUNDED) {
    return { handled: true, ignored: true, orderId: order.id };
  }
  await systemPrisma.institutionPaymentOrder.update({
    where: { id: order.id },
    data: {
      status: InstitutionPaymentOrderStatus.FAILED,
      failureCode: String(payment.error_code ?? "PAYMENT_FAILED").slice(0, 120),
      failureMessage: String(payment.error_description ?? "Provider reported payment failure").slice(0, 1000),
      raw: event as Prisma.InputJsonValue,
    },
  });
  return { handled: true, orderId: order.id };
}

async function refundPayment(gatewayId: string, event: any) {
  const refund = event?.payload?.refund?.entity;
  if (!refund?.payment_id || !refund?.id || !refund?.amount) return { handled: false, reason: "missing_refund" };
  const order = await systemPrisma.institutionPaymentOrder.findFirst({
    where: { gatewayId, providerPaymentId: String(refund.payment_id) },
  });
  if (!order || !order.feePaymentId) return { handled: false, reason: "unknown_payment" };

  const amountPaise = Number(refund.amount);
  const result = await systemPrisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "InstitutionPaymentOrder" WHERE "id" = ${order.id} FOR UPDATE
    `);
    if (!locked.length) throw new AppError(404, "PAYMENT_ORDER_NOT_FOUND", "Payment order not found");
    const current = await tx.institutionPaymentOrder.findUnique({ where: { id: order.id } });
    if (!current?.feePaymentId) throw new AppError(409, "PAYMENT_NOT_CAPTURED", "Payment is not captured");

    const existing = await tx.feePaymentOffset.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: current.organizationId,
          idempotencyKey: `razorpay-refund:${String(refund.id)}`,
        },
      },
    });
    if (existing) return { duplicate: true, offsetId: existing.id };

    const feePayment = await tx.feePayment.findUnique({ where: { id: current.feePaymentId } });
    if (!feePayment) throw new AppError(409, "PAYMENT_NOT_FOUND", "Captured fee payment not found");
    const offsetTotals = await tx.feePaymentOffset.aggregate({
      where: { organizationId: current.organizationId, feePaymentId: feePayment.id },
      _sum: { amountPaise: true },
    });
    const alreadyOffset = Number(offsetTotals._sum.amountPaise ?? 0);
    if (!Number.isInteger(amountPaise) || amountPaise <= 0 || alreadyOffset + amountPaise > feePayment.amountPaise) {
      throw new AppError(422, "REFUND_AMOUNT_MISMATCH", "Provider refund exceeds the remaining refundable amount");
    }

    const fee = await tx.fee.findFirst({
      where: { id: current.feeId, organizationId: current.organizationId },
      select: { id: true, branchId: true, totalPaise: true, discountPaise: true, finePaise: true, amountPaidPaise: true, dueDate: true },
    });
    if (!fee) throw new AppError(404, "FEE_NOT_FOUND", "Fee record not found");

    const [gross, allOffsets, fallbackAdmin] = await Promise.all([
      tx.feePayment.aggregate({ where: { organizationId: current.organizationId, feeId: fee.id }, _sum: { amountPaise: true } }),
      tx.feePaymentOffset.aggregate({ where: { organizationId: current.organizationId, feeId: fee.id }, _sum: { amountPaise: true } }),
      current.refundRequestedById
        ? Promise.resolve(null)
        : tx.user.findFirst({ where: { organizationId: current.organizationId, role: Role.SUPER_ADMIN, isActive: true }, select: { id: true } }),
    ]);
    const effectivePaid = Number(gross._sum.amountPaise ?? 0) - Number(allOffsets._sum.amountPaise ?? 0);
    if (effectivePaid !== fee.amountPaidPaise || effectivePaid < amountPaise) {
      throw new AppError(409, "PAYMENT_LEDGER_INCONSISTENT", "Refund requires manual reconciliation");
    }
    const createdById = current.refundRequestedById ?? fallbackAdmin?.id ?? current.payerUserId;
    const offset = await tx.feePaymentOffset.create({
      data: {
        organizationId: current.organizationId,
        feePaymentId: feePayment.id,
        feeId: fee.id,
        type: FeePaymentOffsetType.REFUND,
        amountPaise,
        reason: "Razorpay refund processed",
        idempotencyKey: `razorpay-refund:${String(refund.id)}`,
        reference: String(refund.id),
        createdById,
      },
    });
    const nextPaid = effectivePaid - amountPaise;
    await tx.fee.update({
      where: { id: fee.id },
      data: {
        amountPaidPaise: nextPaid,
        status: feeStatus(fee.totalPaise, fee.discountPaise, fee.finePaise, nextPaid, fee.dueDate),
      },
    });
    const refundedPaise = current.refundedPaise + amountPaise;
    await tx.institutionPaymentOrder.update({
      where: { id: current.id },
      data: {
        refundedPaise,
        refundedAt: new Date(),
        refundAmountPaise: null,
        refundRequestedById: null,
        status: refundedPaise >= current.amountPaise ? InstitutionPaymentOrderStatus.REFUNDED : InstitutionPaymentOrderStatus.CAPTURED,
        raw: event as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: current.organizationId,
        actorId: createdById,
        action: "ONLINE_FEE_PAYMENT_REFUNDED",
        entity: "FeePaymentOffset",
        entityId: offset.id,
        metadata: safeFinanceAuditMetadata({
          institutionPaymentOrderId: current.id,
          feePaymentId: feePayment.id,
          feeId: fee.id,
          amountPaise,
          providerRefundId: String(refund.id),
        }),
      },
    });
    return { duplicate: false, offsetId: offset.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { handled: true, orderId: order.id, ...result };
}

export async function processInstitutionRazorpayWebhook(input: {
  gatewayId: string;
  raw: Buffer;
  signature?: string;
  eventId?: string;
}) {
  const gateway = await systemPrisma.institutionPaymentGateway.findUnique({ where: { id: input.gatewayId } });
  if (!gateway) throw new AppError(404, "PAYMENT_GATEWAY_NOT_FOUND", "Payment gateway not found");
  const webhookSecret = decryptInstitutionPaymentSecret(gateway.webhookSecretEncrypted);
  if (!signatureValid(input.raw, input.signature, webhookSecret)) {
    throw new AppError(400, "INVALID_SIGNATURE", "Webhook signature is invalid");
  }

  let event: any;
  try {
    event = JSON.parse(input.raw.toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_WEBHOOK", "Webhook body is not valid JSON");
  }
  const key = eventKey(input.raw, input.eventId);
  const prior = await systemPrisma.institutionPaymentWebhookEvent.findUnique({
    where: { gatewayId_eventKey: { gatewayId: gateway.id, eventKey: key } },
  });
  if (prior?.processedAt) return { duplicate: true, eventType: prior.eventType };

  const stored = prior ?? await systemPrisma.institutionPaymentWebhookEvent.create({
    data: {
      organizationId: gateway.organizationId,
      gatewayId: gateway.id,
      provider: "RAZORPAY",
      eventKey: key,
      eventType: String(event?.event ?? "unknown"),
      payload: event as Prisma.InputJsonValue,
    },
  });

  let result: Record<string, unknown> = { handled: false };
  if (event?.event === "payment.captured") result = await capturePayment(gateway.id, stored.id, event);
  else if (event?.event === "payment.failed") result = await failPayment(gateway.id, event);
  else if (event?.event === "refund.processed") result = await refundPayment(gateway.id, event);

  await systemPrisma.institutionPaymentWebhookEvent.update({
    where: { id: stored.id },
    data: { processedAt: new Date() },
  });
  return { eventType: String(event?.event ?? "unknown"), ...result };
}

export async function requestInstitutionPaymentRefund(input: {
  organizationId: string;
  orderId: string;
  requestedById: string;
  amountPaise: number;
}) {
  const order = await systemPrisma.institutionPaymentOrder.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
    include: { gateway: true },
  });
  if (!order || !order.providerPaymentId || !order.feePaymentId || order.status !== InstitutionPaymentOrderStatus.CAPTURED) {
    throw new AppError(409, "PAYMENT_NOT_REFUNDABLE", "Only captured online payments can be refunded");
  }
  if (order.refundAmountPaise) throw new AppError(409, "REFUND_ALREADY_PENDING", "A refund is already pending for this payment");
  const refundable = order.amountPaise - order.refundedPaise;
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0 || input.amountPaise > refundable) {
    throw new AppError(422, "INVALID_REFUND_AMOUNT", "Refund amount exceeds the refundable balance");
  }
  if (!order.gateway.isEnabled) throw new AppError(409, "PAYMENT_GATEWAY_DISABLED", "Institution payment gateway is disabled");

  const client = gatewayClient(order.gateway);
  const response = await (client.payments as any).refund(order.providerPaymentId, {
    amount: input.amountPaise,
    notes: {
      organizationId: input.organizationId,
      institutionPaymentOrderId: order.id,
    },
  });
  await systemPrisma.institutionPaymentOrder.update({
    where: { id: order.id },
    data: {
      refundRequestedById: input.requestedById,
      refundAmountPaise: input.amountPaise,
      raw: response as Prisma.InputJsonValue,
    },
  });
  await systemPrisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.requestedById,
      action: "ONLINE_FEE_REFUND_REQUESTED",
      entity: "InstitutionPaymentOrder",
      entityId: order.id,
      metadata: safeFinanceAuditMetadata({
        providerPaymentId: order.providerPaymentId,
        amountPaise: input.amountPaise,
        providerRefundId: response?.id,
      }),
    },
  });
  return {
    orderId: order.id,
    amountPaise: input.amountPaise,
    providerRefundId: response?.id ?? null,
    status: response?.status ?? "pending",
  };
}

export async function verifyInstitutionGatewayCredentials(organizationId: string) {
  const gateway = await systemPrisma.institutionPaymentGateway.findUnique({ where: { organizationId } });
  if (!gateway) throw new AppError(404, "PAYMENT_GATEWAY_NOT_FOUND", "Payment gateway is not configured");
  assertGatewayKeyMode(gateway);
  const client = gatewayClient(gateway);
  await (client.orders as any).all({ count: 1 });
  const verified = await systemPrisma.institutionPaymentGateway.update({
    where: { id: gateway.id },
    data: { lastVerifiedAt: new Date() },
  });
  return { id: verified.id, lastVerifiedAt: verified.lastVerifiedAt, mode: verified.mode, keyId: verified.keyId };
}
