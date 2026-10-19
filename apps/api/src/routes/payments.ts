import { Router } from "express";
import crypto from "node:crypto";
import Razorpay from "razorpay";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/http.js";
import { captureSaaSRazorpayPayment } from "../lib/saas-commercial.js";
import { recordSchoolOSPaymentRisk } from "../lib/schoolos-payment-risk.js";
import { recordSchoolOSFailedPayment } from "../lib/schoolos-payment-failure.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
const router = Router();
router.post("/razorpay/order", requireAuth, async (req: AuthRequest, res) => { if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw new AppError(503, "PAYMENT_UNAVAILABLE", "Razorpay is not configured"); const body = z.object({ amount: z.number().int().positive(), receipt: z.string().max(40).optional() }).parse(req.body); const client = new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET }); const order = await client.orders.create({ amount: body.amount, currency: "INR", receipt: body.receipt }); const invoice = await prisma.invoice.create({ data: { userId: req.auth!.userId, amount: body.amount, invoiceNo: `BBA-${Date.now()}`, provider: "RAZORPAY", providerOrderId: order.id } }); res.status(201).json({ data: { order, invoiceId: invoice.id, keyId: env.RAZORPAY_KEY_ID } }); });
router.post("/razorpay/webhook", async (req, res) => { const signature = req.header("x-razorpay-signature"); const raw = req.body as Buffer; const expected = env.RAZORPAY_WEBHOOK_SECRET && Buffer.isBuffer(raw) ? crypto.createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest("hex") : ""; const supplied = signature && /^[a-f0-9]{64}$/i.test(signature) ? signature : ""; if (!expected || !supplied || !crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))) throw new AppError(400, "INVALID_SIGNATURE", "Webhook signature is invalid"); const originalEvent = JSON.parse(raw.toString("utf8")); const event = z.object({ event: z.string(), payload: z.object({ payment: z.object({ entity: z.object({ order_id: z.string().nullable(), id: z.string(), amount: z.number().int().positive(), currency: z.string() }) }) }) }).parse(originalEvent); if (event.event === "refund.processed" || event.event === "payment.dispute.created" || event.event === "payment.dispute.lost" || event.event === "payment.dispute.won") {
  // The signature was verified against raw request bytes above, before parsing.
  const proof = z.object({
    payload: z.object({
      payment: z.object({ entity: z.object({
        id: z.string(), order_id: z.string().nullable(), amount: z.number().int().positive(), currency: z.string(),
      }) }),
      refund: z.object({ entity: z.object({
        id: z.string(), payment_id: z.string(), amount: z.number().int().positive(),
        currency: z.string(), status: z.literal("processed"),
      }) }).optional(),
      dispute: z.object({ entity: z.object({
        id: z.string(), payment_id: z.string(), amount: z.number().int().positive(), currency: z.string(),
      }) }).optional(),
    }),
  }).parse(originalEvent);
  const original=proof.payload.payment.entity;
  const child=event.event==="refund.processed" ? proof.payload.refund?.entity : proof.payload.dispute?.entity;
  if (!child || child.payment_id!==original.id || child.currency.toUpperCase()!==original.currency.toUpperCase())
    throw new AppError(422,"SCHOOLOS_RISK_PROVIDER_LINK_INVALID","Refund or dispute does not reference original payment");
  await recordSchoolOSPaymentRisk({
    type:event.event,entityId:child.id,providerPaymentId:child.payment_id,
    orderId:original.order_id,originalAmountPaise:original.amount,amountPaise:child.amount,
    currency:child.currency,
  },event);
  return res.status(200).send("ok");
}
if (event.event === "payment.failed") {
  // Use the original HMAC-verified raw payload: generic Zod parsing strips nested fields.
  const proof=z.object({payload:z.object({payment:z.object({entity:z.object({
    status:z.literal("failed"),id:z.string(),order_id:z.string().nullable(),
    amount:z.number().int().positive(),currency:z.string(),
    error_code:z.string().nullable().optional(),
  })})})}).parse(originalEvent);
  const failed=proof.payload.payment.entity;
  if (failed.order_id) await recordSchoolOSFailedPayment({
    providerPaymentId:failed.id,orderId:failed.order_id,
    amountPaise:failed.amount,currency:failed.currency,errorCode:failed.error_code,
  });
  return res.status(200).send("ok");
}
if (event.event === "payment.captured") { const payment = event.payload.payment.entity; const orderId = payment.order_id;
if (!orderId) throw new AppError(422,"PAYMENT_ORDER_REQUIRED","Captured payment must reference an order");
if (await captureSaaSRazorpayPayment({...payment, order_id: orderId}, event)) return res.status(200).send("ok"); await prisma.$transaction(async (tx: Prisma.TransactionClient) => { const invoice = await tx.invoice.findUnique({ where: { providerOrderId: orderId } }); if (!invoice || invoice.status === "PAID") return; if (payment.amount !== invoice.amount || payment.currency !== invoice.currency) throw new AppError(422, "PAYMENT_MISMATCH", "Captured payment does not match the invoice"); await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID", paidAt: new Date() } }); await tx.payment.create({ data: { invoiceId: invoice.id, providerPaymentId: payment.id, amount: payment.amount, status: "PAID", raw: event } }); }); } res.status(200).send("ok"); });
export default router;
