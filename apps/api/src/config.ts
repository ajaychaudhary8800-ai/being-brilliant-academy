import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
for (const path of [resolve(process.cwd(), ".env"), resolve(currentDirectory, "../../../.env"), resolve(currentDirectory, "../../../../.env")]) dotenv.config({ path });

const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());
const optionalString = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  WEB_URL: z.string().min(1).default("http://localhost:3000"),
  CORS_ORIGINS: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  REDIS_URL: optionalUrl,
  REDIS_REQUIRED: z.string().default("false").transform((value) => value === "true"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  METRICS_TOKEN: optionalString,
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(250),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_PATH: z.string().default("./storage"),
  AWS_REGION: optionalString,
  AWS_S3_BUCKET: optionalString,
  AWS_S3_ENDPOINT: optionalUrl,
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,
  AI_PROVIDER_URL: optionalUrl,
  AI_API_KEY: optionalString,
  AI_MODEL: z.string().default("learning-assistant"),
  CRM_WEBHOOK_URL: optionalUrl,
  CRM_WEBHOOK_SECRET: optionalString,
  WEB_PUSH_PUBLIC_KEY: optionalString,
  WEB_PUSH_PRIVATE_KEY: optionalString,
  WEB_PUSH_SUBJECT: z.string().default("mailto:admin@beingbrilliant.in"),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.string().default("false").transform((value) => value === "true"),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  EMAIL_FROM: optionalString,
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_SMS_FROM: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  WHATSAPP_ACCESS_TOKEN: optionalString,
  WHATSAPP_API_VERSION: z.string().default("v23.0"),
  RAZORPAY_KEY_ID: optionalString,
  RAZORPAY_KEY_SECRET: optionalString,
  RAZORPAY_WEBHOOK_SECRET: optionalString,
  RAZORPAY_MODE: z.enum(["test", "live"]).default("test"),
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production") {
    if (value.JWT_ACCESS_SECRET.includes("replace-with")) context.addIssue({ code: "custom", path: ["JWT_ACCESS_SECRET"], message: "Production access secret must be replaced" });
    if (value.JWT_REFRESH_SECRET.includes("replace-with")) context.addIssue({ code: "custom", path: ["JWT_REFRESH_SECRET"], message: "Production refresh secret must be replaced" });
  }
  if (value.STORAGE_DRIVER === "s3" && (!value.AWS_REGION || !value.AWS_S3_BUCKET)) {
    context.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "S3 storage requires AWS_REGION and AWS_S3_BUCKET" });
  }
  const requireTogether = (keys: Array<keyof typeof value>, label: string) => {
    const configured = keys.filter((key) => Boolean(value[key]));
    if (configured.length && configured.length !== keys.length) context.addIssue({ code: "custom", path: [keys[0]], message: `${label} requires ${keys.join(", ")}` });
  };
  if (value.NODE_ENV === "production") {
    requireTogether(["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"], "SMTP");
    requireTogether(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_SMS_FROM"], "Twilio SMS");
    requireTogether(["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"], "WhatsApp Cloud API");
    requireTogether(["WEB_PUSH_PUBLIC_KEY", "WEB_PUSH_PRIVATE_KEY"], "Web Push");
    requireTogether(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"], "Razorpay");
  }
  if (value.RAZORPAY_KEY_ID && !value.RAZORPAY_KEY_ID.startsWith(`rzp_${value.RAZORPAY_MODE}_`)) context.addIssue({ code: "custom", path: ["RAZORPAY_KEY_ID"], message: `Razorpay key does not match ${value.RAZORPAY_MODE} mode` });
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsed.data;
export const corsOrigins = (env.CORS_ORIGINS ?? env.WEB_URL).split(",").map((value) => value.trim()).filter(Boolean);
