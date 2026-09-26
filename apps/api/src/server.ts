import "express-async-errors";
import crypto from "node:crypto";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { RedisStore } from "rate-limit-redis";
import { corsOrigins, env } from "./config.js";
import { AppError, errorHandler, notFound } from "./lib/http.js";
import { logger } from "./lib/logger.js";
import { metricsMiddleware, metricsRegistry, setDependencyReady, startWorkerRun } from "./lib/metrics.js";
import { systemPrisma } from "./lib/prisma.js";
import { ensureRedis, redis } from "./lib/redis.js";
import { MAX_NOTIFICATION_DELIVERY_ATTEMPTS, deliverNotification, providerStatus, verifySmtp } from "./lib/notifications.js";
import { activeNotificationConstraints } from "./lib/notification-policy.js";
import { deliverScheduledAnalyticsReports } from "./lib/analytics-report-scheduler.js";
import { onlyPaths } from "./lib/scoped-router.js";
import auth from "./routes/auth.js";
import courses from "./routes/courses.js";
import learning from "./routes/learning.js";
import adminLms, { lmsLearning } from "./routes/admin-lms.js";
import admin from "./routes/admin.js";
import adminUsers from "./routes/admin-users.js";
import adminCourses from "./routes/admin-courses.js";
import adminBatches from "./routes/admin-batches.js";
import adminAcademicSessions from "./routes/admin-academic-sessions.js";
import adminTeacherAllocations from "./routes/admin-teacher-allocations.js";
import adminSubjectOptions from "./routes/admin-subject-options.js";
import adminSubjects from "./routes/admin-subjects.js";
import adminSubjectEnforcement from "./routes/admin-subject-enforcement.js";
import adminExaminationBranchEnforcement from "./routes/admin-examination-branch-enforcement.js";
import adminClassrooms from "./routes/admin-classrooms.js";
import adminStudents from "./routes/admin-students.js";
import adminTimetables from "./routes/admin-timetables.js";
import adminAcademicOperations from "./routes/admin-academic-operations.js";
import adminEducationMasters from "./routes/admin-education-masters.js";
import homeworks from "./routes/homeworks.js";
import studentHomeworks from "./routes/student-homeworks.js";
import teacherHomeworks from "./routes/teacher-homeworks.js";
import adminExaminations from "./routes/admin-examinations.js";
import examinationWorkflow from "./routes/examination-workflow.js";
import adminFees from "./routes/admin-fees.js";
import feeDefaulters from "./routes/fee-defaulters.js";
import adminTests from "./routes/admin-tests.js";
import adminEnquiries from "./routes/admin-enquiries.js";
import adminCertificates from "./routes/admin-certificates.js";
import attendance from "./routes/attendance.js";
import attendanceReports from "./routes/attendance-reports.js";
import attendanceLeaveEnforcement from "./routes/attendance-leave-enforcement.js";
import leaveManagement from "./routes/leave-management.js";
import payments from "./routes/payments.js";
import exams from "./routes/exams.js";
import portals from "./routes/portals.js";
import hrPayroll from "./routes/hr-payroll.js";
import finance from "./routes/finance.js";
import paymentOffsets from "./routes/payment-offsets.js";
import feePlans from "./routes/fee-plans.js";
import feeAssignments from "./routes/fee-assignments.js";
import transport from "./routes/transport.js";
import library from "./routes/library.js";
import hostel from "./routes/hostel.js";
import communication from "./routes/communication.js";
import noticeBoard from "./routes/notice-board.js";
import inventory from "./routes/inventory.js";
import analytics from "./routes/analytics.js";
import automation from "./routes/automation.js";
import organizations from "./routes/organizations.js";
import organizationProvisioning from "./routes/organization-provisioning.js";
import learningEcosystem from "./routes/learning-ecosystem.js";
import premiumExperience from "./routes/premium-experience.js";
import birthdays from "./routes/birthdays.js";
import teacherPhotos from "./routes/teacher-photos.js";
import imageUploads from "./routes/image-uploads.js";
import publicBranding from "./routes/public-branding.js";
import saasCommercial from "./routes/saas-commercial.js";
import saasSales from "./routes/saas-sales.js";
import legalSalesDocuments from "./routes/legal-sales-documents.js";
import platformControlCenter from "./routes/platform-control-center.js";
import { reconcileSaaSLifecycle } from "./lib/saas-commercial.js";
import { isTenantCorsOriginAllowed } from "./lib/cors-origin.js";
import { livekitHealth } from "./lib/livekit.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const supplied = req.headers["x-request-id"];
      const id = typeof supplied === "string" && supplied.length <= 100 ? supplied : crypto.randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
  }),
);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", ...corsOrigins],
      },
    },
    hsts: env.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      void isTenantCorsOriginAllowed(origin)
        .then((allowed) => callback(allowed ? null : new AppError(403, "ORIGIN_NOT_ALLOWED", "Origin not allowed"), allowed))
        .catch((error) => callback(error instanceof Error ? error : new Error("Unable to validate origin"), false));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use(compression({ threshold: 1024 }));
app.use(metricsMiddleware);

const sendRedisCommand = async (...args: string[]) => (await redis!.call(...(args as [string, ...string[]]))) as string | number | boolean | Array<string | number | boolean>;
const redisStore = redis ? new RedisStore({ sendCommand: sendRedisCommand }) : undefined;
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: redisStore,
    keyGenerator: (req) => {
      const authorization = req.headers.authorization;
      if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
        const sessionKey = crypto.createHash("sha256").update(authorization.slice(7)).digest("hex").slice(0, 24);
        return `${ipKeyGenerator(req.ip ?? "")}:session:${sessionKey}`;
      }
      return ipKeyGenerator(req.ip ?? "");
    },
    skip: (req) => req.path.startsWith("/health") || req.path === "/metrics",
  }),
);
app.use(
  "/api/v1/auth/login",
  express.json({ limit: "1mb" }),
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: redis ? new RedisStore({ prefix: "rl:auth:", sendCommand: sendRedisCommand }) : undefined,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "unknown";
      const organization = typeof req.body?.organization === "string" ? req.body.organization.trim().toLowerCase() : "unknown";
      return `${ipKeyGenerator(req.ip ?? "")}:${organization}:${email}`;
    },
  }),
);
app.use("/api/v1/payments/razorpay/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/health/live", (_req, res) =>
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }),
);
async function dependencyChecks() {
  const checks: Record<string, boolean> = {
    database: false,
    redis: !env.REDIS_REQUIRED,
  };
  try {
    await systemPrisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (error) {
    logger.error({ err: error }, "Database readiness check failed");
  }
  if (redis) {
    try {
      checks.redis = await ensureRedis();
    } catch {
      checks.redis = false;
    }
  }
  for (const [dependency, ready] of Object.entries(checks)) setDependencyReady(dependency, ready);
  return checks;
}

type WorkerHeartbeat = {
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
};

const workerHeartbeats: Record<"notificationDelivery" | "saasLifecycle", WorkerHeartbeat> = {
  notificationDelivery: { lastSuccessAt: null, lastFailureAt: null, lastError: null },
  saasLifecycle: { lastSuccessAt: null, lastFailureAt: null, lastError: null },
};

function workerSnapshot(name: keyof typeof workerHeartbeats, maxAgeMs: number, now = new Date()) {
  const heartbeat = workerHeartbeats[name];
  const healthy = Boolean(heartbeat.lastSuccessAt && now.getTime() - heartbeat.lastSuccessAt.getTime() <= maxAgeMs);
  return {
    healthy,
    lastSuccessAt: heartbeat.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: heartbeat.lastFailureAt?.toISOString() ?? null,
  };
}

app.get("/health/ready", async (_req, res) => {
  const checks = await dependencyChecks();
  const ready = Object.values(checks).every(Boolean);
  res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks });
});

app.get("/health/operational", async (_req, res) => {
  const checks = await dependencyChecks();
  const workers = {
    notificationDelivery: workerSnapshot("notificationDelivery", 2 * 60_000),
    saasLifecycle: workerSnapshot("saasLifecycle", 10 * 60_000),
  };
  const healthy = Object.values(checks).every(Boolean) && Object.values(workers).every(worker => worker.healthy);
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "operational" : "degraded",
    checks,
    workers,
    timestamp: new Date().toISOString(),
  });
});
app.get("/health/integrations", async (_req, res) => {
  const [smtp, livekit] = await Promise.all([verifySmtp(), livekitHealth()]);
  res.json({
    providers: providerStatus(),
    smtp,
    livekit,
    razorpayMode: env.RAZORPAY_MODE,
  });
});
app.get("/metrics", async (req, res) => {
  if (env.NODE_ENV === "production" && !env.METRICS_TOKEN) {
    return res.status(503).json({
      error: { code: "METRICS_NOT_CONFIGURED", message: "Production metrics require METRICS_TOKEN" },
    });
  }
  if (env.METRICS_TOKEN && req.headers.authorization !== `Bearer ${env.METRICS_TOKEN}`) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Metrics token required" },
    });
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", metricsRegistry.contentType);
  return res.send(await metricsRegistry.metrics());
});

// Public authentication routes must be mounted before the authenticated
// feature routers below, whose router-level guards intentionally reject
// unauthenticated requests.
app.use("/api/v1/auth", auth);
app.use("/api/v1/public", publicBranding);
app.use("/api/v1", onlyPaths(["/public/saas-sales", "/platform/sales"], saasSales));
app.use("/api/v1", onlyPaths(["/platform/legal-sales"], legalSalesDocuments));
app.use("/api/v1", onlyPaths(["/platform/control-center"], platformControlCenter));
app.use("/api/v1", teacherPhotos);
app.use("/api/v1", imageUploads);
// These role-aware fee routers must run before broad admin routers whose
// router-level guards intentionally reject non-admin roles.
app.use("/api/v1/admin", onlyPaths(["/fees"], adminFees));
app.use("/api/v1", onlyPaths(["/admin/fee-defaulters"], feeDefaulters));
// Teacher-aware LMS routes must be scoped and mounted before broad admin
// routers whose router-level guards reject non-administrator roles.
app.use("/api/v1/admin", onlyPaths(["/lms"], adminLms));
app.use("/api/v1/admin", adminAcademicSessions);
app.use("/api/v1/admin", adminSubjects);
app.use("/api/v1/admin", adminTeacherAllocations);
app.use("/api/v1/admin", adminSubjectOptions);
app.use("/api/v1/admin", adminSubjectEnforcement);
app.use("/api/v1/admin", adminExaminationBranchEnforcement);
app.use("/api/v1/admin", adminClassrooms);
app.use("/api/v1/admin", adminAcademicOperations);
app.use("/api/v1/admin", adminEducationMasters);
app.use("/api/v1/exam-workflow", examinationWorkflow);
app.use("/api/v1/student", studentHomeworks);
app.use("/api/v1/teacher", adminSubjectOptions);
app.use("/api/v1/teacher", teacherHomeworks);
app.use("/api/v1", onlyPaths(["/platform/organizations"], organizationProvisioning));
app.use("/api/v1", onlyPaths(["/portal/leaves", "/admin/leaves"], leaveManagement));
app.use("/api/v1/attendance", attendanceLeaveEnforcement);
app.use("/api/v1", onlyPaths(["/notices", "/admin/notices"], noticeBoard));
app.use("/api/v1", onlyPaths(["/birthdays", "/admin/teachers"], birthdays));
// Mount role-aware learning routes before broad admin routers that intentionally
// reject non-admin requests.
app.use("/api/v1", onlyPaths(["/premium"], premiumExperience));
app.use("/api/v1", onlyPaths(["/learning"], learningEcosystem));

app.use("/api/v1", onlyPaths(["/finance/payments", "/finance/payment-offsets"], paymentOffsets));

app.use("/api/v1", onlyPaths(["/platform", "/organization"], organizations));
app.use("/api/v1", saasCommercial);
app.use("/api/v1", onlyPaths(["/analytics"], analytics));
app.use("/api/v1", onlyPaths(["/automations"], automation));
app.use("/api/v1", onlyPaths(["/inventory"], inventory));
app.use("/api/v1", onlyPaths(["/communication"], communication));
app.use("/api/v1", onlyPaths(["/hostel"], hostel));
app.use("/api/v1", onlyPaths(["/library"], library));
app.use("/api/v1", onlyPaths(["/transport"], transport));
app.use("/api/v1", onlyPaths(["/finance/fee-plans"], feePlans));
app.use("/api/v1", onlyPaths(["/finance/fee-assignments"], feeAssignments));
app.use("/api/v1", onlyPaths(["/finance"], finance));
app.use("/api/v1", onlyPaths(["/hr", "/employee"], hrPayroll));
app.use("/api/v1/portal", portals);
app.use("/api/v1/courses", courses);
app.use("/api/v1/learning", learning);
app.use("/api/v1/learning", lmsLearning);
app.use("/api/v1/admin", adminCertificates);
app.use("/api/v1/admin", adminStudents);
app.use("/api/v1/admin", adminTimetables);
app.use("/api/v1/admin", homeworks);
app.use("/api/v1/admin", adminExaminations);
app.use("/api/v1/admin", adminUsers);
app.use("/api/v1/admin", admin);
app.use("/api/v1/admin", adminCourses);
app.use("/api/v1/admin", adminBatches);
app.use("/api/v1/admin", adminTests);
app.use("/api/v1/admin", adminEnquiries);
app.use("/api/v1/attendance", attendance);
app.use("/api/v1/attendance", onlyPaths(["/reports"], attendanceReports));
app.use("/api/v1/payments", payments);
app.use("/api/v1/exams", exams);
app.use(notFound, errorHandler);

export const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, "API listening"));
const runNotificationDeliveryWorker = async () => {
  const finishMetric = startWorkerRun("notification_delivery");
  try {
    const now = new Date();
    const queued = await systemPrisma.notificationDelivery.findMany({
      where: {
        status: { in: ["QUEUED", "FAILED"] },
        attempts: { lt: MAX_NOTIFICATION_DELIVERY_ATTEMPTS },
        notification: activeNotificationConstraints(now),
      },
      select: { id: true },
      take: 50,
      orderBy: { createdAt: "asc" },
    });
    await Promise.all(queued.map(({ id }) => deliverNotification(id, now)));
    workerHeartbeats.notificationDelivery = { lastSuccessAt: new Date(), lastFailureAt: workerHeartbeats.notificationDelivery.lastFailureAt, lastError: null };
    finishMetric("success");
  } catch (error) {
    workerHeartbeats.notificationDelivery = {
      lastSuccessAt: workerHeartbeats.notificationDelivery.lastSuccessAt,
      lastFailureAt: new Date(),
      lastError: error instanceof Error ? error.message.slice(0, 500) : "Notification worker failed",
    };
    finishMetric("failure");
    logger.error({ err: error }, "Notification worker failed");
  }
};
void runNotificationDeliveryWorker();
const notificationWorker = setInterval(() => void runNotificationDeliveryWorker(), 30_000);
notificationWorker.unref();

const reconcileCommercialLifecycle = async () => {
  const finishMetric = startWorkerRun("saas_lifecycle");
  try {
    const result = await reconcileSaaSLifecycle(new Date());
    workerHeartbeats.saasLifecycle = { lastSuccessAt: new Date(), lastFailureAt: workerHeartbeats.saasLifecycle.lastFailureAt, lastError: null };
    finishMetric("success");
    if (result.overdueInvoices || result.pastDue || result.cancelled || result.expiredTrialsPastDue || result.renewalRemindersQueued) {
      logger.info(result, "SaaS subscription lifecycle reconciled");
    }
  } catch (error) {
    workerHeartbeats.saasLifecycle = {
      lastSuccessAt: workerHeartbeats.saasLifecycle.lastSuccessAt,
      lastFailureAt: new Date(),
      lastError: error instanceof Error ? error.message.slice(0, 500) : "SaaS lifecycle worker failed",
    };
    finishMetric("failure");
    logger.error({ err: error }, "SaaS subscription lifecycle worker failed");
  }
};
void reconcileCommercialLifecycle();
const saasLifecycleWorker = setInterval(() => void reconcileCommercialLifecycle(), 5 * 60_000);
saasLifecycleWorker.unref();

let analyticsReportWorkerRunning = false;
const runAnalyticsReportWorker = async () => {
  if (analyticsReportWorkerRunning) return;
  analyticsReportWorkerRunning = true;
  const finishMetric = startWorkerRun("analytics_report_delivery");
  try { await deliverScheduledAnalyticsReports(); finishMetric("success"); }
  catch (error) { finishMetric("failure"); logger.error({ err: error }, "Analytics report worker failed"); }
  finally { analyticsReportWorkerRunning = false; }
};
void runAnalyticsReportWorker();
const analyticsReportWorker = setInterval(() => void runAnalyticsReportWorker(), 60_000);
analyticsReportWorker.unref();

async function shutdown(signal: string) {
  logger.info({ signal }, "Graceful shutdown started");
  clearInterval(notificationWorker);
  clearInterval(saasLifecycleWorker);
  clearInterval(analyticsReportWorker);
  server.close(async () => {
    await Promise.allSettled([systemPrisma.$disconnect(), redis?.quit() ?? Promise.resolve()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("uncaughtException");
});
process.on("unhandledRejection", (error) => {
  logger.error({ err: error }, "Unhandled rejection");
});
