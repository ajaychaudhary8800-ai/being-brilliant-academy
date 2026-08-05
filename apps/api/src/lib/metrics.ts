import type { NextFunction, Request, Response } from "express";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: "bba_" });
const requestCount = new Counter({ name: "bba_http_requests_total", help: "HTTP requests", labelNames: ["method", "route", "status"], registers: [metricsRegistry] });
const requestDuration = new Histogram({ name: "bba_http_request_duration_seconds", help: "HTTP request duration", labelNames: ["method", "route", "status"], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5], registers: [metricsRegistry] });

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = requestDuration.startTimer();
  res.on("finish", () => {
    const labels = { method: req.method, route: req.route?.path ?? req.path, status: String(res.statusCode) };
    requestCount.inc(labels);
    end(labels);
  });
  next();
}
