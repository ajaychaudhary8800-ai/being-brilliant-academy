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
import { workerHealthSnapshot, type WorkerHeartbeat } from "./lib/worker-health.js";
import { systemPrisma } from "./lib/prisma.js";
import { ensureRedis, redis } from "./lib/redis.js";
import { MAX_NOTIFICATION_DELIVERY_ATTEMPTS, deliverNotification, providerStatus, verifySmtp } from "./lib/notifications.js";
import { activeNotificationConstraints } from "./lib/notification-policy.js";
import { deliverScheduledAnalyticsReports } from "./lib/analytics-report-scheduler.js";
import { executeActiveAutomations } from "./lib/automation-executor.js";
import { processQueuedAIExaminerEvaluations } from "./lib/ai-examiner-worker.js";
import { processAIExaminerCheckedCopyRetries } from "./lib/ai-examiner-checked-copy-retry-worker.js";
import { processDueDeviceRetries } from "./lib/device-hub-retry-worker.js";
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
import aiExaminer from "./routes/ai-examiner.js";
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
import institutionPayments from "./routes/institution-payments.js";
import exams from "./routes/exams.js";
import portals from "./routes/portals.js";
import hrPayroll from "./routes/hr-payroll.js";
import finance from "./routes/finance.js";
import paymentOffsets from "./routes/payment-offsets.js";
import feePlans from "./routes/fee-plans.js";
import feeAssignments from "./routes/fee-assignments.js";
import transport from "./routes/transport.js";
import smartTransport from "./routes/smart-transport.js";
import deviceHub from "./routes/device-hub.js";
import connectedCampus from "./routes/connected-campus.js";
import connectedCampusGovernance from "./routes/connected-campus-governance.js";
import safetyOperations from "./routes/safety-operations.js";
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
import meetings from "./routes/meetings.js";
import meetingLive from "./routes/meeting-live.js";
import meetingWorkflow from "./routes/meeting-workflow.js";
import { reconcileSaaSLifecycle } from "./lib/saas-commercial.js";
import { isTenantCorsOriginAllowed } from "./lib/cors-origin.js";
import { livekitHealth } from "./lib/livekit.js";
import { purgeExpiredMeetingRecordings, scheduleDueMeetingActionNotifications, scheduleDueMeetingReminders } from "./lib/meeting-scheduling.js";

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
app.use("/api/v1/institution-payments/razorpay/webhook/:gatewayId", express.raw({ type: "application/json" }));
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

const workerHeartbeats: Record<"notificationDelivery" | "saasLifecycle" | "workflowAutomation" | "aiExaminer" | "meetingReminders" | "deviceHub", WorkerHeartbeat> = {
  notificationDelivery: { lastSuccessAt: null, lastFailureAt: null, lastError: null },
  saasLifecycle: { lastSuccessAt: null, lastFailureAt: null, lastError: null },
  workflowAutomation: { lastSuccessAt: null, lastFailureAt: null, lastError: null },
  aiExaminer: { lastSuccessAt: null, lastFailureAt: null, lastError: null },
  meetingReminders: { lastSuccessAt: null, lastFailureAt: null, lastError: null },
  deviceHub: { lastSuccessAt: null, lastFailureAt: null, lastError: null },
};

function workerSnapshot(name: keyof typeof workerHeartbeats, maxAgeMs: number, now = new Date()) {
  return workerHealthSnapshot(workerHeartbeats[name], maxAgeMs, now);
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
    workflowAutomation: workerSnapshot("workflowAutomation", 10 * 60_000),
    aiExaminer: workerSnapshot("aiExaminer", Math.max(60_000, env.AI_EXAMINER_WORKER_INTERVAL_MS * 12)),
    meetingReminders: workerSnapshot("meetingReminders", 15 * 60_000),
    deviceHub: workerSnapshot("deviceHub", Math.max(60_000, env.DEVICE_HUB_WORKER_INTERVAL_MS * 6)),
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
app.use("/api/v1/ai-examiner", aiExaminer);
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
app.use("/api/v1", institutionPayments);
app.use("/api/v1", onlyPaths(["/analytics"], analytics));
app.use("/api/v1", onlyPaths(["/automations"], automation));
app.use("/api/v1", onlyPaths(["/meetings/native"], meetingLive));
app.use("/api/v1", onlyPaths(["/meetings", "/meeting-actions"], meetingWorkflow));
app.use("/api/v1", onlyPaths(["/meetings", "/meeting-series", "/meeting-teams"], meetings));
app.use("/api/v1", onlyPaths(["/inventory"], inventory));
app.use("/api/v1", onlyPaths(["/communication"], communication));
app.use("/api/v1", onlyPaths(["/hostel"], hostel));
app.use("/api/v1", onlyPaths(["/library"], library));
app.use("/api/v1", onlyPaths(["/device-hub"], deviceHub));
app.use("/api/v1", onlyPaths(["/connected-campus"], connectedCampus));
app.use("/api/v1", onlyPaths(["/connected-campus"], connectedCampusGovernance));
app.use("/api/v1", onlyPaths(["/connected-campus"], safetyOperations));
app.use("/api/v1", onlyPaths(["/transport"], transport));
app.use("/api/v1", onlyPaths(["/transport"], smartTransport));
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

const runMeetingReminderWorker = async () => {
  const finishMetric = startWorkerRun("meeting_reminders");
  try {
    const now = new Date();
    const [reminders, actions, retention] = await Promise.all([
      scheduleDueMeetingReminders(now),
      scheduleDueMeetingActionNotifications(now),
      purgeExpiredMeetingRecordings(now),
    ]);
    const result = { processed: reminders.processed, actionNotifications: actions.queued, recordingsPurged: retention.purged };
    workerHeartbeats.meetingReminders = {
      lastSuccessAt: new Date(),
      lastFailureAt: workerHeartbeats.meetingReminders.lastFailureAt,
      lastError: null,
    };
    finishMetric("success");
    if (result.processed || result.actionNotifications || result.recordingsPurged) logger.info(result, "Meeting workflows reconciled");
  } catch (error) {
    workerHeartbeats.meetingReminders = {
      lastSuccessAt: workerHeartbeats.meetingReminders.lastSuccessAt,
      lastFailureAt: new Date(),
      lastError: error instanceof Error ? error.message.slice(0, 500) : "Meeting reminder worker failed",
    };
    finishMetric("failure");
    logger.error({ err: error }, "Meeting reminder worker failed");
  }
};
void runMeetingReminderWorker();
const meetingReminderWorker = setInterval(() => void runMeetingReminderWorker(), 5 * 60_000);
meetingReminderWorker.unref();

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

let workflowAutomationWorkerRunning = false;
const runWorkflowAutomationWorker = async () => {
  if (workflowAutomationWorkerRunning) return;
  workflowAutomationWorkerRunning = true;
  const finishMetric = startWorkerRun("workflow_automation");
  try {
    const results = await executeActiveAutomations(new Date());
    const failed = results.filter(result => !result.ok);
    workerHeartbeats.workflowAutomation = {
      lastSuccessAt: new Date(),
      lastFailureAt: failed.length ? new Date() : workerHeartbeats.workflowAutomation.lastFailureAt,
      lastError: failed[0]?.error ?? null,
    };
    finishMetric(failed.length ? "failure" : "success");
    if (failed.length) logger.warn({ failed: failed.length, total: results.length }, "Workflow automation worker completed with failures");
  } catch (error) {
    workerHeartbeats.workflowAutomation = {
      lastSuccessAt: workerHeartbeats.workflowAutomation.lastSuccessAt,
      lastFailureAt: new Date(),
      lastError: error instanceof Error ? error.message.slice(0, 500) : "Workflow automation worker failed",
    };
    finishMetric("failure");
    logger.error({ err: error }, "Workflow automation worker failed");
  } finally {
    workflowAutomationWorkerRunning = false;
  }
};
void runWorkflowAutomationWorker();
const workflowAutomationWorker = setInterval(() => void runWorkflowAutomationWorker(), 5 * 60_000);
workflowAutomationWorker.unref();

let deviceHubWorkerRunning = false;
const runDeviceHubWorker = async () => {
  if (deviceHubWorkerRunning) return;
  deviceHubWorkerRunning = true;
  const finishMetric = startWorkerRun("device_hub_retry");
  try {
    const results = await processDueDeviceRetries(50);
    const failed = results.filter(result => !result.ok);
    workerHeartbeats.deviceHub = {
      lastSuccessAt: new Date(),
      lastFailureAt: failed.length ? new Date() : workerHeartbeats.deviceHub.lastFailureAt,
      lastError: failed[0]?.error?.slice(0, 500) ?? null,
    };
    finishMetric(failed.length ? "failure" : "success");
    if (failed.length) logger.warn({ failed: failed.length, total: results.length }, "Device Hub retry worker completed with failures");
  } catch (error) {
    workerHeartbeats.deviceHub = {
      lastSuccessAt: workerHeartbeats.deviceHub.lastSuccessAt,
      lastFailureAt: new Date(),
      lastError: error instanceof Error ? error.message.slice(0, 500) : "Device Hub retry worker failed",
    };
    finishMetric("failure");
    logger.error({ err: error }, "Device Hub retry worker failed");
  } finally {
    deviceHubWorkerRunning = false;
  }
};
void runDeviceHubWorker();
const deviceHubWorker = setInterval(() => void runDeviceHubWorker(), env.DEVICE_HUB_WORKER_INTERVAL_MS);
deviceHubWorker.unref();

let aiExaminerWorkerRunning = false;
const runAIExaminerWorker = async () => {
  if (aiExaminerWorkerRunning) return;
  aiExaminerWorkerRunning = true;
  const finishMetric = startWorkerRun("ai_examiner");
  try {
    const results = await processQueuedAIExaminerEvaluations(2);
    const recoveryResults = await processAIExaminerCheckedCopyRetries(5);
    const failed = results.filter(result => "failed" in result && result.failed);
    const recoveryFailed = recoveryResults.filter(result => result.outcome === "FAILED");
    const failureCount = failed.length + recoveryFailed.length;
    workerHeartbeats.aiExaminer = {
      lastSuccessAt: new Date(),
      lastFailureAt: failureCount ? new Date() : workerHeartbeats.aiExaminer.lastFailureAt,
      lastError: failed[0] && "error" in failed[0]
        ? failed[0].error?.message ?? null
        : recoveryFailed[0]?.error ?? null,
    };
    finishMetric(failureCount ? "failure" : "success");
    if (failed.length) logger.warn({ failed: failed.length, total: results.length }, "AI Examiner worker completed with evaluation failures");
    if (recoveryFailed.length) logger.warn({ failed: recoveryFailed.length, total: recoveryResults.length }, "AI Examiner checked-copy recovery completed with failures");
  } catch (error) {
    workerHeartbeats.aiExaminer = {
      lastSuccessAt: workerHeartbeats.aiExaminer.lastSuccessAt,
      lastFailureAt: new Date(),
      lastError: error instanceof Error ? error.message.slice(0, 500) : "AI Examiner worker failed",
    };
    finishMetric("failure");
    logger.error({ err: error }, "AI Examiner worker failed");
  } finally {
    aiExaminerWorkerRunning = false;
  }
};
void runAIExaminerWorker();
const aiExaminerWorker = setInterval(() => void runAIExaminerWorker(), env.AI_EXAMINER_WORKER_INTERVAL_MS);
aiExaminerWorker.unref();

async function shutdown(signal: string) {
  logger.info({ signal }, "Graceful shutdown started");
  clearInterval(notificationWorker);
  clearInterval(saasLifecycleWorker);
  clearInterval(analyticsReportWorker);
  clearInterval(workflowAutomationWorker);
  clearInterval(aiExaminerWorker);
  clearInterval(deviceHubWorker);
  clearInterval(meetingReminderWorker);
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
