import { prisma } from "../db/prisma.js";
import { logger } from "../lib/logger.js";

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

// Fire-and-forget audit write; never blocks or breaks the request path.
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        meta: input.meta as object | undefined,
        ip: input.ip,
      },
    });
  } catch (err) {
    logger.warn({ err, action: input.action }, "audit write failed");
  }
}
