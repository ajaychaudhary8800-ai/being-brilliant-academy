import "express-async-errors";
import crypto from "node:crypto";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { RedisStore } from "rate-limit-redis";
import { corsOrigins, env } from "./config.js";
import { AppError, errorHandler, notFound } from "./lib/http.js";
import { logger } from "./lib/logger.js";
import { metricsMiddleware, metricsRegistry } from "./lib/metrics.js";
import { systemPrisma } from "./lib/prisma.js";
import { ensureRedis, redis } from "./lib/redis.js";
import { deliverNotification, providerStatus, verifySmtp } from "./lib/notifications.js";
import { onlyPaths } from "./lib/scoped-router.js";
import auth from "./routes/auth.js";
import courses from "./routes/courses.js";
import learning from "./routes/learning.js";
import adminLms, { lmsLearning } from "./routes/admin-lms.js";
import admin from "./routes/admin.js";
import adminCourses from "./routes/admin-courses.js";
import adminBatches from "./routes/admin-batches.js";
import adminAcademicSessions from "./routes/admin-academic-sessions.js";
import adminTeacherAllocations from "./routes/admin-teacher-allocations.js";
import adminSubjectOptions from "./routes/admin-subject-options.js";
import adminSubjectEnforcement from "./routes/admin-subject-enforcement.js";
import adminClassrooms from "./routes/admin-classrooms.js";
import adminStudents from "./routes/admin-students.js";
import adminTimetables from "./routes/admin-timetables.js";
import homeworks from "./routes/homeworks.js";
import adminExaminations from "./routes/admin-examinations.js";
import examinationWorkflow from "./routes/examination-workflow.js";
import adminFees from "./routes/admin-fees.js";
import feeDefaulters from "./routes/fee-defaulters.js";
import adminTests from "./routes/admin-tests.js";
import adminEnquiries from "./routes/admin-enquiries.js";
import adminCertificates from "./routes/admin-certificates.js";
import attendance from "./routes/attendance.js";
import leaveManagement from "./routes/leave-management.js";
import payments from "./routes/payments.js";
import exams from "./routes/exams.js";
import portals from "./routes/portals.js";
import hrPayroll from "./routes/hr-payroll.js";
import finance from "./routes/finance.js";
import transport from "./routes/transport.js";
import library from "./routes/library.js";
import hostel from "./routes/hostel.js";
import communication from "./routes/communication.js";
import noticeBoard from "./routes/notice-board.js";
import inventory from "./routes/inventory.js";
import analytics from "./routes/analytics.js";
import organizations from "./routes/organizations.js";
import organizationProvisioning from "./routes/organization-provisioning.js";
import learningEcosystem from "./routes/learning-ecosystem.js";
import premiumExperience from "./routes/premium-experience.js";
import birthdays from "./routes/birthdays.js";
import teacherPhotos from "./routes/teacher-photos.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(pinoHttp({ logger, genReqId: (req, res) => {
  const supplied = req.headers["x-request-id"];
  const id = typeof supplied === "string" && supplied.length <= 100 ? supplied : crypto.randomUUID();
  res.setHeader("x-request-id", id); return id;
} }));
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", "data:", "https:"], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], connectSrc: ["'self'", ...corsOrigins] } },
  hsts: env.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use(cors({ origin(origin, callback) { callback(origin && !corsOrigins.includes(origin) ? new AppError(403, "ORIGIN_NOT_ALLOWED", "Origin not allowed") : null, true); }, credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));
app.use(compression({ threshold: 1024 }));
app.use(metricsMiddleware);

const sendRedisCommand = async (...args: string[]) => await redis!.call(...args as [string, ...string[]]) as string | number | boolean | Array<string | number | boolean>;
const redisStore = redis ? new RedisStore({ sendCommand: sendRedisCommand }) : undefined;
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: env.RATE_LIMIT_MAX, standardHeaders: "draft-8", legacyHeaders: false, store: redisStore, skip: (req) => req.path.startsWith("/health") || req.path === "/metrics" }));
app.use("/api/v1/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: env.AUTH_RATE_LIMIT_MAX, standardHeaders: "draft-8", legacyHeaders: false, store: redis ? new RedisStore({ prefix: "rl:auth:", sendCommand: sendRedisCommand }) : undefined }));
app.use("/api/v1/payments/razorpay/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/health/live", (_req, res) => res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() }));
app.get("/health/ready", async (_req, res) => {
  const checks: Record<string, boolean> = { database: false, redis: !env.REDIS_REQUIRED };
  try { await systemPrisma.$queryRaw`SELECT 1`; checks.database = true; } catch (error) { logger.error({ err: error }, "Database readiness check failed"); }
  if (redis) { try { checks.redis = await ensureRedis(); } catch { checks.redis = false; } }
  const ready = Object.values(checks).every(Boolean);
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks });
});
app.get("/health/integrations", async (_req, res) => res.json({ providers: providerStatus(), smtp: await verifySmtp(), razorpayMode: env.RAZORPAY_MODE }));
app.get("/metrics", async (req, res) => {
  if (env.METRICS_TOKEN && req.headers.authorization !== `Bearer ${env.METRICS_TOKEN}`) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Metrics token required" } });
  res.setHeader("Content-Type", metricsRegistry.contentType); return res.send(await metricsRegistry.metrics());
});

// Public authentication routes must be mounted before the authenticated
// feature routers below, whose router-level guards intentionally reject
// unauthenticated requests.
app.use("/api/v1/auth", auth);
app.use("/api/v1", teacherPhotos);
app.use("/api/v1/admin", adminAcademicSessions);
app.use("/api/v1/admin", adminTeacherAllocations);
app.use("/api/v1/admin", adminSubjectOptions);
app.use("/api/v1/admin", adminSubjectEnforcement);
app.use("/api/v1/admin", adminClassrooms);
app.use("/api/v1/exam-workflow", examinationWorkflow);
app.use("/api/v1", onlyPaths(["/platform/organizations"], organizationProvisioning));
app.use("/api/v1", onlyPaths(["/portal/leaves", "/admin/leaves"], leaveManagement));
app.use("/api/v1", onlyPaths(["/admin/fee-defaulters"], feeDefaulters));
app.use("/api/v1", onlyPaths(["/notices", "/admin/notices"], noticeBoard));
app.use("/api/v1", onlyPaths(["/birthdays", "/admin/teachers"], birthdays));
// Mount role-aware learning routes before broad admin routers that intentionally
// reject non-admin requests.
app.use("/api/v1", onlyPaths(["/premium"], premiumExperience));
app.use("/api/v1", onlyPaths(["/learning"], learningEcosystem));

app.use("/api/v1", onlyPaths(["/platform", "/organization"], organizations)); app.use("/api/v1", onlyPaths(["/analytics"], analytics)); app.use("/api/v1", onlyPaths(["/inventory"], inventory)); app.use("/api/v1", onlyPaths(["/communication"], communication)); app.use("/api/v1", onlyPaths(["/hostel"], hostel)); app.use("/api/v1", onlyPaths(["/library"], library)); app.use("/api/v1", onlyPaths(["/transport"], transport)); app.use("/api/v1", onlyPaths(["/finance"], finance)); app.use("/api/v1", onlyPaths(["/hr", "/employee"], hrPayroll)); app.use("/api/v1/portal", portals); app.use("/api/v1/courses", courses); app.use("/api/v1/learning", learning); app.use("/api/v1/learning", lmsLearning); app.use("/api/v1/admin", adminCertificates); app.use("/api/v1/admin", adminStudents); app.use("/api/v1/admin", adminTimetables); app.use("/api/v1/admin", homeworks); app.use("/api/v1/admin", adminExaminations); app.use("/api/v1/admin", adminLms); app.use("/api/v1/admin", admin); app.use("/api/v1/admin", adminCourses); app.use("/api/v1/admin", adminBatches); app.use("/api/v1/admin", adminFees); app.use("/api/v1/admin", adminTests); app.use("/api/v1/admin", adminEnquiries); app.use("/api/v1/attendance", attendance); app.use("/api/v1/payments", payments); app.use("/api/v1/exams", exams);
app.use(notFound, errorHandler);

export const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, "API listening"));
const notificationWorker = setInterval(async () => {
  try {
    const queued = await systemPrisma.notificationDelivery.findMany({ where: { status: { in: ["QUEUED", "FAILED"] }, attempts: { lt: 3 } }, select: { id: true }, take: 50, orderBy: { createdAt: "asc" } });
    await Promise.all(queued.map(({ id }) => deliverNotification(id)));
  } catch (error) { logger.error({ err: error }, "Notification worker failed"); }
}, 30_000);
notificationWorker.unref();
async function shutdown(signal: string) {
  logger.info({ signal }, "Graceful shutdown started");
  clearInterval(notificationWorker);
  server.close(async () => { await Promise.allSettled([systemPrisma.$disconnect(), redis?.quit() ?? Promise.resolve()]); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => { logger.fatal({ err: error }, "Uncaught exception"); void shutdown("uncaughtException"); });
process.on("unhandledRejection", (error) => { logger.error({ err: error }, "Unhandled rejection"); });
