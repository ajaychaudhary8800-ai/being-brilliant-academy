import type { NextFunction, Request, Response } from "express";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: "bba_" });

const requestCount = new Counter({
  name: "bba_http_requests_total",
  help: "HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [metricsRegistry],
});

const requestDuration = new Histogram({
  name: "bba_http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

const httpErrors = new Counter({
  name: "bba_http_errors_total",
  help: "Handled HTTP errors by application error code and status",
  labelNames: ["code", "status"],
  registers: [metricsRegistry],
});

const dependencyReady = new Gauge({
  name: "bba_dependency_ready",
  help: "Dependency readiness where 1 is ready and 0 is unavailable",
  labelNames: ["dependency"],
  registers: [metricsRegistry],
});

const notificationDeliveries = new Counter({
  name: "bba_notification_delivery_total",
  help: "Notification delivery attempts by channel and final attempt status",
  labelNames: ["channel", "status"],
  registers: [metricsRegistry],
});

const workerRuns = new Counter({
  name: "bba_worker_runs_total",
  help: "Background worker runs by worker and outcome",
  labelNames: ["worker", "outcome"],
  registers: [metricsRegistry],
});

const workerDuration = new Histogram({
  name: "bba_worker_run_duration_seconds",
  help: "Background worker run duration",
  labelNames: ["worker", "outcome"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = requestDuration.startTimer();
  res.on("finish", () => {
    const labels = {
      method: req.method,
      route: req.route?.path ?? req.path,
      status: String(res.statusCode),
    };
    requestCount.inc(labels);
    end(labels);
  });
  next();
}

export function recordHttpError(code: string, status: number) {
  httpErrors.inc({ code, status: String(status) });
}

export function setDependencyReady(dependency: string, ready: boolean) {
  dependencyReady.set({ dependency }, ready ? 1 : 0);
}

export function recordNotificationDelivery(channel: string, status: string) {
  notificationDeliveries.inc({ channel, status });
}

export function startWorkerRun(worker: string) {
  const startedAt = process.hrtime.bigint();
  return (outcome: "success" | "failure") => {
    workerRuns.inc({ worker, outcome });
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    workerDuration.observe({ worker, outcome }, seconds);
  };
}
