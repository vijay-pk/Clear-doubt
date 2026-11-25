import type { Role, UserStatus } from "@prisma/client";

// Derived, user-facing lifecycle state. EXPIRING_SOON / EXPIRED are computed from
// accessExpiresAt (the source of truth); only ACTIVE / SUSPENDED / DELETION_PENDING
// are persisted on User.status.
export type DerivedState =
  | "ACTIVE"
  | "EXPIRING_SOON"
  | "EXPIRED"
  | "SUSPENDED"
  | "DELETION_PENDING";

export interface AccessUser {
  role: Role;
  status: UserStatus;
  accessExpiresAt: Date | null;
}

export interface AccessConfig {
  studentExpiringSoonDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Reason a student is denied access, or null when access is allowed.
export type BlockReason = "suspended" | "deletion_pending" | "expired" | null;

export function derivedState(user: AccessUser, now: Date, cfg: AccessConfig): DerivedState {
  if (user.status === "SUSPENDED") return "SUSPENDED";
  if (user.status === "DELETION_PENDING") return "DELETION_PENDING";
  // Admins and any account without a limit are simply active.
  if (user.role !== "STUDENT" || !user.accessExpiresAt) return "ACTIVE";
  const expiry = user.accessExpiresAt.getTime();
  const t = now.getTime();
  if (t >= expiry) return "EXPIRED";
  if (t >= expiry - cfg.studentExpiringSoonDays * DAY_MS) return "EXPIRING_SOON";
  return "ACTIVE";
}

// Whether this user may use the app right now (null = allowed).
export function accessBlockReason(user: AccessUser, now: Date): BlockReason {
  if (user.status === "SUSPENDED") return "suspended";
  if (user.status === "DELETION_PENDING") return "deletion_pending";
  if (user.role === "STUDENT" && user.accessExpiresAt && now.getTime() >= user.accessExpiresAt.getTime()) {
    return "expired";
  }
  return null;
}

export function isAccessBlocked(user: AccessUser, now: Date): boolean {
  return accessBlockReason(user, now) !== null;
}

// Milliseconds of access remaining (negative once expired; null when no limit).
export function remainingMs(user: AccessUser, now: Date): number | null {
  if (!user.accessExpiresAt) return null;
  return user.accessExpiresAt.getTime() - now.getTime();
}

export function remainingDays(user: AccessUser, now: Date): number | null {
  const ms = remainingMs(user, now);
  if (ms === null) return null;
  return Math.ceil(ms / DAY_MS);
}
