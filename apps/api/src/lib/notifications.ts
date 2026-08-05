import nodemailer from "nodemailer";
import webPush from "web-push";
import { env } from "../config.js";
import { logger } from "./logger.js";
import { systemPrisma } from "./prisma.js";

export const providerStatus = () => ({
  email: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.EMAIL_FROM),
  sms: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_SMS_FROM),
  whatsapp: Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN),
  push: Boolean(env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY),
  razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET),
});

const transporter = providerStatus().email ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE, auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! } }) : null;
if (providerStatus().push) webPush.setVapidDetails(env.WEB_PUSH_SUBJECT, env.WEB_PUSH_PUBLIC_KEY!, env.WEB_PUSH_PRIVATE_KEY!);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export async function verifySmtp() {
  if (!transporter) return { configured: false, reachable: false };
  try { await transporter.verify(); return { configured: true, reachable: true }; }
  catch (error) { logger.warn({ err: error }, "SMTP verification failed"); return { configured: true, reachable: false }; }
}

export async function sendEmail(to: string, subject: string, body: string) {
  if (!transporter) return { skipped: true, reason: "SMTP_NOT_CONFIGURED" } as const;
  const result = await transporter.sendMail({ from: env.EMAIL_FROM!, to, subject, text: body, html: `<div style="font-family:system-ui,sans-serif;line-height:1.6">${escapeHtml(body).replace(/\n/g, "<br>")}</div>` });
  return { skipped: false, provider: "SMTP", messageId: result.messageId } as const;
}

async function sendSms(to: string, body: string) {
  if (!providerStatus().sms) return { skipped: true, reason: "SMS_NOT_CONFIGURED" } as const;
  const data = new URLSearchParams({ To: to, From: env.TWILIO_SMS_FROM!, Body: body });
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: data });
  const result = await response.json() as { sid?: string; message?: string };
  if (!response.ok) throw new Error(result.message ?? `Twilio returned ${response.status}`);
  return { skipped: false, provider: "TWILIO", messageId: result.sid } as const;
}

async function sendWhatsapp(to: string, body: string) {
  if (!providerStatus().whatsapp) return { skipped: true, reason: "WHATSAPP_NOT_CONFIGURED" } as const;
  const response = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "text", text: { preview_url: false, body } }) });
  const result = await response.json() as { messages?: Array<{ id: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? `WhatsApp returned ${response.status}`);
  return { skipped: false, provider: "META_WHATSAPP", messageId: result.messages?.[0]?.id } as const;
}

async function sendPush(userId: string, title: string, body: string, actionUrl?: string | null) {
  if (!providerStatus().push) return { skipped: true, reason: "PUSH_NOT_CONFIGURED" } as const;
  const subscriptions = await systemPrisma.pushSubscription.findMany({ where: { userId, isActive: true } });
  if (!subscriptions.length) return { skipped: true, reason: "NO_ACTIVE_PUSH_SUBSCRIPTION" } as const;
  const payload = JSON.stringify({ title, body, url: actionUrl ?? "/" });
  const results = await Promise.allSettled(subscriptions.map(async (subscription) => { try { return await webPush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload); } catch (error) { if ([404, 410].includes((error as { statusCode?: number }).statusCode ?? 0)) await systemPrisma.pushSubscription.update({ where: { id: subscription.id }, data: { isActive: false } }); throw error; } }));
  const sent = results.filter((result) => result.status === "fulfilled").length;
  if (!sent) throw new Error("No active push subscription accepted the notification");
  return { skipped: false, provider: "WEB_PUSH", messageId: `${sent}/${subscriptions.length}` } as const;
}

export async function deliverNotification(deliveryId: string) {
  const delivery = await systemPrisma.notificationDelivery.findUnique({ where: { id: deliveryId }, include: { notification: { include: { user: true } } } });
  if (!delivery || !["QUEUED", "FAILED"].includes(delivery.status)) return;
  const { notification } = delivery;
  await systemPrisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "PROCESSING", attempts: { increment: 1 }, lastError: null } });
  try {
    const result = delivery.channel === "EMAIL" ? await sendEmail(notification.user.email, notification.title, notification.body) : delivery.channel === "SMS" ? notification.user.phone ? await sendSms(notification.user.phone, notification.body) : { skipped: true, reason: "USER_PHONE_MISSING" } as const : delivery.channel === "WHATSAPP" ? notification.user.phone ? await sendWhatsapp(notification.user.phone, notification.body) : { skipped: true, reason: "USER_PHONE_MISSING" } as const : delivery.channel === "PUSH" ? await sendPush(notification.userId, notification.title, notification.body, notification.actionUrl) : { skipped: true, reason: "UNSUPPORTED_CHANNEL" } as const;
    await systemPrisma.notificationDelivery.update({ where: { id: delivery.id }, data: result.skipped ? { status: "SKIPPED", lastError: result.reason } : { status: "SENT", provider: result.provider, providerMessageId: result.messageId, deliveredAt: new Date() } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Provider delivery failed";
    await systemPrisma.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", lastError: message } });
    logger.error({ err: error, deliveryId, channel: delivery.channel }, "Notification delivery failed");
  }
}
