import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";
import { recordHttpError } from "./metrics.js";
export class AppError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const notFound = (_req: Request, _res: Response, next: NextFunction) => next(new AppError(404, "NOT_FOUND", "Resource not found"));
export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  const commercialLimit = err.message.includes("SAAS_PLAN_LIMIT_REACHED:");
  const status = commercialLimit ? 409 : err instanceof AppError ? err.status : err instanceof ZodError ? 422 : 500;
  const code = commercialLimit ? "PLAN_LIMIT_REACHED" : err instanceof AppError ? err.code : err instanceof ZodError ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
  const message = commercialLimit ? "Your subscription plan capacity limit has been reached" : status === 500 ? "An unexpected error occurred" : err.message;
  recordHttpError(code, status);
  const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log({ err, requestId: req.id, method: req.method, path: req.originalUrl, status }, "Request failed");
  res.status(status).json({ error: { code, message, ...(err instanceof ZodError ? { issues: err.flatten() } : {}) }, requestId: req.id });
};
