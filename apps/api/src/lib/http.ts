import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";
export class AppError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
export const notFound = (_req: Request, _res: Response, next: NextFunction) => next(new AppError(404, "NOT_FOUND", "Resource not found"));
export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof AppError ? err.status : err instanceof ZodError ? 422 : 500;
  const code = err instanceof AppError ? err.code : err instanceof ZodError ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
  const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log({ err, requestId: req.id, method: req.method, path: req.originalUrl, status }, "Request failed");
  res.status(status).json({ error: { code, message: status === 500 ? "An unexpected error occurred" : err.message, ...(err instanceof ZodError ? { issues: err.flatten() } : {}) }, requestId: req.id });
};
