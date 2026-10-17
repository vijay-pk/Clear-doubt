import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

// Periodic cleanup: expired sessions/tokens and data past the retention window.
export async function retention(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - env.RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const sessions = await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  const tokens = await prisma.verificationToken.deleteMany({ where: { expiresAt: { lt: now } } });

  // Old closed/answered doubts past retention (cascades messages, drafts, attachments).
  const doubts = await prisma.doubt.deleteMany({
    where: { updatedAt: { lt: cutoff }, status: { in: ["ANSWERED", "CLOSED"] } },
  });

  // Old finished jobs.
  const jobs = await prisma.job.deleteMany({
    where: { status: { in: ["DONE", "FAILED"] }, updatedAt: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
  });

  logger.info(
    { sessions: sessions.count, tokens: tokens.count, doubts: doubts.count, jobs: jobs.count },
    "retention sweep done",
  );
}
