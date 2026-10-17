import type { Request, Response, NextFunction } from "express";
import { constantTimeEqual } from "../lib/crypto.js";
import { forbidden } from "../lib/errors.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

// Synchronizer-token CSRF. The session holds csrfSecret; the SPA echoes it in
// X-CSRF-Token (read from the non-httpOnly adways_csrf cookie). Must match.
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  // Only enforce for authenticated, cookie-based requests.
  if (!req.user || !req.csrfSecret) return next();
  const header = req.get("x-csrf-token") || "";
  if (!header || !constantTimeEqual(header, req.csrfSecret)) {
    return next(forbidden("Invalid CSRF token", "csrf"));
  }
  next();
}
