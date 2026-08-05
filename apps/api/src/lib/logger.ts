import pino from "pino";
import { env } from "../config.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "bba-api", environment: env.NODE_ENV },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "password", "token", "refreshToken", "accessToken", "*.password", "*.token"],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
