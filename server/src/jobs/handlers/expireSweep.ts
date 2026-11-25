import { prisma } from "../../db/prisma.js";
import { destroyAllForUser } from "../../auth/sessionService.js";
import { getSettings } from "../../settings/settingsService.js";
import { enqueue } from "../../jobs/queue.js";
import { logger } from "../../lib/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Periodic safety net for access expiry. Real-time enforcement already blocks
// expired students on every request; this sweep revokes their lingering sessions
// and, after the grace period, hands expired accounts to the deletion job.
export async function expireSweep(): Promise<void> {
  const cfg = await getSettings();
  const now = new Date();

  // Expired but still ACTIVE students (DELETION_PENDING/SUSPENDED handled elsewhere).
  const expired = await prisma.user.findMany({
    where: { role: "STUDENT", status: "ACTIVE", accessExpiresAt: { lt: now } },
    select: { id: true, accessExpiresAt: true },
  });

  // Drop any live sessions so an open tab can't keep working.
  for (const s of expired) {
    await destroyAllForUser(s.id);
  }

  // Past the grace window → start permanent deletion.
  const graceCutoff = new Date(now.getTime() - cfg.studentAccessGraceDays * DAY_MS);
  const toDelete = expired.filter((s) => s.accessExpiresAt !== null && s.accessExpiresAt.getTime() < graceCutoff.getTime());
  for (const s of toDelete) {
    await prisma.user.update({ where: { id: s.id }, data: { status: "DELETION_PENDING", deletionStartedAt: now } });
    await enqueue("deleteStudent", { studentId: s.id }, { dedupeKey: `deleteStudent:${s.id}` });
  }

  if (expired.length || toDelete.length) {
    logger.info({ expired: expired.length, queuedForDeletion: toDelete.length }, "expiry sweep done");
  }
}
