import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "not_found", message: "Not found" } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return res.status(400).json({
      error: { code: "validation", message: first ? `${first.path.join(".")}: ${first.message}` : "Invalid input" },
    });
  }
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, "request error");
    return res.status(err.status).json({
      error: { code: err.code, message: err.expose ? err.message : "Internal error" },
    });
  }
  logger.error({ err, path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "server_error", message: "Internal error" } });
}
