import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../lib/crypto.js";
import { normalizeEmail } from "../auth/authService.js";
import { toE164 } from "../lib/phoneIntl.js";
import { destroyAllForUser } from "../auth/sessionService.js";
import { getSettings } from "../settings/settingsService.js";
import { enqueue } from "../jobs/queue.js";
import { writeAudit } from "../audit/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  derivedState,
  remainingDays,
  type DerivedState,
} from "../auth/accessPolicy.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const STUDENT_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  studentIdNo: true,
  status: true,
  role: true,
  accessStartAt: true,
  accessExpiresAt: true,
  suspendedAt: true,
  deletionStartedAt: true,
  adminNotes: true,
  createdByAdminId: true,
  createdAt: true,
  mustChangePassword: true,
  credentialEmailStatus: true,
  credentialEmailSentAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

type StudentRow = Prisma.UserGetPayload<{ select: typeof STUDENT_SELECT }>;

export interface StudentView extends Omit<StudentRow, "role"> {
  state: DerivedState;
  remainingDays: number | null;
}

async function view(row: StudentRow): Promise<StudentView> {
  const cfg = await getSettings();
  const now = new Date();
  const { role: _role, ...rest } = row;
  void _role;
  return { ...rest, state: derivedState(row, now, cfg), remainingDays: remainingDays(row, now) };
}

// Convert a duration-in-days or an explicit UTC datetime into an expiry instant.
export function computeExpiry(input: { durationDays?: number; customExpiresAt?: string }, from: Date): Date {
  if (input.customExpiresAt) {
    const d = new Date(input.customExpiresAt);
    if (Number.isNaN(d.getTime())) throw badRequest("Invalid expiry date.", "invalid_expiry");
    if (d.getTime() <= from.getTime()) throw badRequest("Expiry must be in the future.", "invalid_expiry");
    return d;
  }
  const days = input.durationDays;
  if (!days || !Number.isFinite(days) || days <= 0 || days > 3650) {
    throw badRequest("Enter an access duration in days, or a future expiry date.", "invalid_duration");
  }
  return new Date(from.getTime() + days * DAY_MS);
}

async function findStudentOrThrow(id: string): Promise<StudentRow> {
  const row = await prisma.user.findUnique({ where: { id }, select: STUDENT_SELECT });
  if (!row || row.role !== "STUDENT") throw notFound("Student not found", "student_not_found");
  return row;
}

// Hash of the configured shared temporary password. Students are forced to
// replace it on first login (mustChangePassword). Never stored in plaintext.
async function tempPasswordHash(): Promise<string> {
  const { studentTempPassword } = await getSettings();
  return hashPassword(studentTempPassword);
}

export async function createStudent(
  actorId: string,
  input: {
    name: string;
    email: string;
    phone?: string;
    studentIdNo?: string;
    durationDays?: number;
    customExpiresAt?: string;
    adminNotes?: string;
  },
): Promise<StudentView> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) throw badRequest("Enter a valid email address.", "invalid_email");
  const name = input.name.trim();
  if (name.length < 2) throw badRequest("Enter the student's name.", "invalid_name");
  const phone = input.phone?.trim() ? toE164(input.phone) : null;
  if (input.phone?.trim() && !phone)
    throw badRequest("Enter a valid phone number with its country code.", "invalid_phone");

  const now = new Date();
  const accessExpiresAt = computeExpiry(input, now);

  if (await prisma.user.findUnique({ where: { email } }))
    throw conflict("An account with this email already exists.", "email_taken");

  const row = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await tempPasswordHash(),
      role: "STUDENT",
      phone,
      studentIdNo: input.studentIdNo?.trim() || null,
      emailVerified: true,
      status: "ACTIVE",
      accessStartAt: now,
      accessExpiresAt,
      adminNotes: input.adminNotes?.trim() || null,
      createdByAdminId: actorId,
      mustChangePassword: true,
      credentialEmailStatus: "PENDING",
    },
    select: STUDENT_SELECT,
  });
  await enqueue("sendEmail", { type: "credential", userId: row.id }, { dedupeKey: `credential:${row.id}` });
  await writeAudit({
    actorId,
    action: "student.create",
    entityType: "User",
    entityId: row.id,
    meta: { accessExpiresAt: accessExpiresAt.toISOString() },
  });
  return view(row);
}

// Re-queue the credential email for an existing student (admin "Resend").
export async function resendCredentials(actorId: string, id: string): Promise<void> {
  const student = await findStudentOrThrow(id);
  await prisma.user.update({ where: { id: student.id }, data: { credentialEmailStatus: "PENDING" } });
  await enqueue("sendEmail", { type: "credential", userId: student.id }, { dedupeKey: `credential:${student.id}` });
  await writeAudit({ actorId, action: "student.resend_credentials", entityType: "User", entityId: student.id });
}

export async function listStudents(opts: { search?: string; state?: DerivedState }): Promise<StudentView[]> {
  const where: Prisma.UserWhereInput = { role: "STUDENT" };
  if (opts.search?.trim()) {
    const q = opts.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { studentIdNo: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, select: STUDENT_SELECT, take: 1000 });
  const cfg = await getSettings();
  const now = new Date();
  let views = rows.map((r) => {
    const { role: _role, ...rest } = r;
    void _role;
    return { ...rest, state: derivedState(r, now, cfg), remainingDays: remainingDays(r, now) };
  });
  if (opts.state) views = views.filter((v) => v.state === opts.state);
  return views;
}

export async function getStudentStats() {
  const rows = await prisma.user.findMany({
    where: { role: "STUDENT" },
    select: { status: true, role: true, accessExpiresAt: true },
  });
  const cfg = await getSettings();
  const now = new Date();
  const counts: Record<DerivedState, number> = {
    ACTIVE: 0,
    EXPIRING_SOON: 0,
    EXPIRED: 0,
    SUSPENDED: 0,
    DELETION_PENDING: 0,
  };
  for (const r of rows) counts[derivedState(r, now, cfg)]++;
  const deleted = await prisma.auditLog.count({ where: { action: "student.deleted" } });
  return { total: rows.length, ...counts, DELETED: deleted };
}

export async function getStudent(id: string): Promise<StudentView> {
  return view(await findStudentOrThrow(id));
}

export async function updateStudent(
  actorId: string,
  id: string,
  patch: { name?: string; phone?: string | null; studentIdNo?: string | null; adminNotes?: string | null },
): Promise<StudentView> {
  await findStudentOrThrow(id);
  const data: Prisma.UserUpdateInput = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 2) throw badRequest("Enter the student's name.", "invalid_name");
    data.name = name;
  }
  if (patch.phone !== undefined) {
    if (patch.phone && patch.phone.trim()) {
      const phone = toE164(patch.phone);
      if (!phone) throw badRequest("Enter a valid phone number with its country code.", "invalid_phone");
      data.phone = phone;
    } else data.phone = null;
  }
  if (patch.studentIdNo !== undefined) data.studentIdNo = patch.studentIdNo?.trim() || null;
  if (patch.adminNotes !== undefined) data.adminNotes = patch.adminNotes?.trim() || null;

  const row = await prisma.user.update({ where: { id }, data, select: STUDENT_SELECT });
  await writeAudit({ actorId, action: "student.update", entityType: "User", entityId: id, meta: { fields: Object.keys(data) } });
  return view(row);
}

// Extend/renew access. If still active, extend from the current expiry; if already
// expired (grace period), extend from now. An explicit newExpiresAt overrides.
export async function extendAccess(
  actorId: string,
  id: string,
  input: { addDays?: number; newExpiresAt?: string },
): Promise<StudentView> {
  const student = await findStudentOrThrow(id);
  if (student.status === "DELETION_PENDING")
    throw badRequest("This account is being deleted and can't be extended.", "deletion_pending");

  const now = new Date();
  let next: Date;
  if (input.newExpiresAt) {
    next = computeExpiry({ customExpiresAt: input.newExpiresAt }, now);
  } else {
    const days = input.addDays;
    if (!days || !Number.isFinite(days) || days <= 0 || days > 3650)
      throw badRequest("Enter how many days to add.", "invalid_duration");
    const base =
      student.accessExpiresAt && student.accessExpiresAt.getTime() > now.getTime() ? student.accessExpiresAt : now;
    next = new Date(base.getTime() + days * DAY_MS);
  }
  const row = await prisma.user.update({
    where: { id },
    data: { accessExpiresAt: next, accessStartAt: student.accessStartAt ?? now },
    select: STUDENT_SELECT,
  });
  await writeAudit({
    actorId,
    action: "student.extend",
    entityType: "User",
    entityId: id,
    meta: { accessExpiresAt: next.toISOString() },
  });
  return view(row);
}

export async function suspendStudent(actorId: string, id: string): Promise<StudentView> {
  const student = await findStudentOrThrow(id);
  if (student.status === "DELETION_PENDING") throw badRequest("This account is being deleted.", "deletion_pending");
  const row = await prisma.user.update({
    where: { id },
    data: { status: "SUSPENDED", suspendedAt: new Date() },
    select: STUDENT_SELECT,
  });
  await destroyAllForUser(id);
  await writeAudit({ actorId, action: "student.suspend", entityType: "User", entityId: id });
  return view(row);
}

export async function reactivateStudent(actorId: string, id: string): Promise<StudentView> {
  const student = await findStudentOrThrow(id);
  if (student.status === "DELETION_PENDING") throw badRequest("This account is being deleted.", "deletion_pending");
  const row = await prisma.user.update({
    where: { id },
    data: { status: "ACTIVE", suspendedAt: null },
    select: STUDENT_SELECT,
  });
  await writeAudit({ actorId, action: "student.reactivate", entityType: "User", entityId: id });
  return view(row);
}

export async function deletionPreview(id: string) {
  await findStudentOrThrow(id);
  const [doubts, messages, attachments, approved] = await Promise.all([
    prisma.doubt.count({ where: { studentId: id } }),
    prisma.doubtMessage.count({ where: { doubt: { studentId: id } } }),
    prisma.attachment.count({ where: { doubtMessage: { doubt: { studentId: id } } } }),
    prisma.approvedAnswer.count({ where: { draft: { doubt: { studentId: id } } } }),
  ]);
  return { doubts, messages, attachments, approvedAnswers: approved };
}

// Manual deletion: block access now, then hand off to the retryable deletion job.
export async function requestDeletion(actorId: string, id: string): Promise<void> {
  await findStudentOrThrow(id);
  await prisma.user.update({ where: { id }, data: { status: "DELETION_PENDING", deletionStartedAt: new Date() } });
  await destroyAllForUser(id);
  await enqueue("deleteStudent", { studentId: id }, { dedupeKey: `deleteStudent:${id}` });
  await writeAudit({ actorId, action: "student.delete_requested", entityType: "User", entityId: id });
}
