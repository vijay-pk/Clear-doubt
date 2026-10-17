import pino from "pino";
import { isProd } from "../config/env.js";

export const logger = pino({
  level: isProd ? "info" : "debug",
  // Never log request bodies/headers that may carry secrets or student PII.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-hub-signature-256"]',
      "password",
      "passwordHash",
      "token",
    ],
    remove: true,
  },
  transport: !isProd
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
    : undefined,
});
