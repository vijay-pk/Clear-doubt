import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface AuthedUser {
      id: string;
      email: string;
      role: Role;
      name: string;
      emailVerified: boolean;
      mustChangePassword: boolean;
    }
    interface Request {
      user?: AuthedUser;
      sessionId?: string;
      csrfSecret?: string;
      // Set when a valid session exists but the account is blocked (expired /
      // suspended / deletion pending); used by /auth/me to return a 403 + code.
      blockedReason?: "expired" | "suspended" | "deletion_pending";
    }
  }
}

export {};
