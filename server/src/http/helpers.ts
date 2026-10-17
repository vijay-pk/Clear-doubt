import type { Request, Response, NextFunction, RequestHandler } from "express";
import { AppError } from "../lib/errors.js";

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function clientIp(req: Request): string | undefined {
  return req.ip ?? (req.socket?.remoteAddress || undefined);
}

export function ensure(condition: unknown, error: AppError): asserts condition {
  if (!condition) throw error;
}
