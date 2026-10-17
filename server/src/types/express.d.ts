import type { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface AuthedUser {
      id: string;
      email: string;
      role: Role;
      name: string;
      emailVerified: boolean;
    }
    interface Request {
      user?: AuthedUser;
      sessionId?: string;
      csrfSecret?: string;
    }
  }
}

export {};
