import type { Request, Response, NextFunction } from "express";
import type { Role } from "@prisma/client";
import { env } from "../config/env.js";
import { loadSession } from "../auth/sessionService.js";
import { accessBlockReason } from "../auth/accessPolicy.js";
import { forbidden, unauthorized } from "../lib/errors.js";

// Attaches req.user / req.sessionId if a valid session cookie is present. Never throws.
// Expiry is enforced here on EVERY request (the expiry timestamp is the source of
// truth), so an old session/token is rejected the instant access lapses — independent
// of the background sweep job.
export async function authContext(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[env.SESSION_COOKIE_NAME];
    if (token) {
      const session = await loadSession(token);
      if (session) {
        const blocked = accessBlockReason(session.user, new Date());
        if (blocked) {
          req.blockedReason = blocked;
        } else {
          req.user = {
            id: session.user.id,
            email: session.user.email,
            role: session.user.role,
            name: session.user.name,
            emailVerified: session.user.emailVerified,
            mustChangePassword: session.user.mustChangePassword,
          };
          req.sessionId = session.id;
          req.csrfSecret = session.csrfSecret;
        }
      }
    }
  } catch {
    // ignore — unauthenticated
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

// Blocks a student who still has the temporary password from using any student
// feature until they change it. Enforced on the backend, not just in the SPA.
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role === "STUDENT" && req.user.mustChangePassword) {
    return next(forbidden("Please create your new password to continue using your student account.", "password_change_required"));
  }
  next();
}

export function requireVerified(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  // Admins are seeded pre-verified; students must verify email before acting.
  if (req.user.role === "STUDENT" && !req.user.emailVerified) {
    return next(forbidden("Please verify your email first.", "email_unverified"));
  }
  next();
}
