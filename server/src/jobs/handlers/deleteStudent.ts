import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { getStorage } from "../../storage/storage.js";
import { destroyAllForUser } from "../../auth/sessionService.js";
import { writeAudit } from "../../audit/audit.js";
import { logger } from "../../lib/logger.js";

interface Payload {
  studentId: string;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

// Write the non-identifying deletion record once (idempotent across retries).
async function recordDeleted(studentId: string, meta: Record<string, unknown>): Promise<void> {
  const existing = await prisma.auditLog.count({ where: { action: "student.deleted", entityId: studentId } });
  if (existing === 0) {
    await writeAudit({ action: "student.deleted", entityType: "User", entityId: studentId, meta: { ...meta, deletedAt: new Date().toISOString() } });
  }
}

// Permanently delete all data for one student. Idempotent and retryable: a partial
// run can be safely re-run. Storage objects are removed BEFORE the DB rows (which
// hold the keys) vanish, so a storage failure throws and the job retries with the
// rows still intact. Never touches shared course material, other students, or
// approved answers that did not originate from this student.
export async function deleteStudent(raw: unknown): Promise<void> {
  const { studentId } = (raw ?? {}) as Payload;
  if (!studentId) return;

  const user = await prisma.user.findUnique({ where: { id: studentId }, select: { id: true, role: true, deletionStartedAt: true } });
  if (!user) {
    // Already deleted — ensure the operational record exists and stop.
    await recordDeleted(studentId, {});
    return;
  }
  if (user.role !== "STUDENT") {
    logger.warn({ studentId }, "deleteStudent: target is not a student, skipping");
    return;
  }

  // 1. Mark pending + revoke every session/token-bearing login.
  await prisma.user.update({
    where: { id: studentId },
    data: { status: "DELETION_PENDING", deletionStartedAt: user.deletionStartedAt ?? new Date() },
  });
  await destroyAllForUser(studentId);

  // 2. Delete student-owned storage objects while the Attachment rows still exist.
  //    storage.remove is idempotent; if it throws, the job retries (rows intact).
  const attachments = await prisma.attachment.findMany({
    where: { doubtMessage: { doubt: { studentId } } },
    select: { storageKey: true },
  });
  const storage = getStorage();
  for (const a of attachments) {
    await storage.remove(a.storageKey);
  }

  const doubtCount = await prisma.doubt.count({ where: { studentId } });

  // 3. Delete this student's approved-answer memory BEFORE the user delete, while
  //    the draft→doubt→student link still exists (draftId is SET NULL on cascade).
  const approved = await prisma.approvedAnswer.deleteMany({ where: { draft: { doubt: { studentId } } } });

  // 4. Hard-delete the user. Cascades sessions, tokens, doubts → messages →
  //    attachments, drafts → citations/deliveries.
  try {
    await prisma.user.delete({ where: { id: studentId } });
  } catch (err) {
    if (!isNotFound(err)) throw err; // retry on transient errors
  }

  // 5. Verify nothing student-owned remains in the active database.
  const remaining = await prisma.doubt.count({ where: { studentId } });
  if (remaining > 0) throw new Error(`deleteStudent: ${remaining} doubts still present for ${studentId}`);

  // 6. Minimal, non-identifying operational record.
  await recordDeleted(studentId, {
    doubts: doubtCount,
    attachments: attachments.length,
    approvedAnswers: approved.count,
  });
  logger.info({ studentId, attachments: attachments.length }, "student data deleted");
}
