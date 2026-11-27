import * as XLSX from "xlsx";
import { prisma } from "../db/prisma.js";
import { hashPassword } from "../lib/crypto.js";
import { normalizeEmail } from "../auth/authService.js";
import { toE164, combineE164 } from "../lib/phoneIntl.js";
import { getSettings } from "../settings/settingsService.js";
import { enqueue } from "../jobs/queue.js";
import { writeAudit } from "../audit/audit.js";
import { badRequest } from "../lib/errors.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RawRow {
  name: string;
  email: string;
  countryCode: string; // e.g. "+91" (optional)
  phone: string; // national number (or full international if it starts with +)
  studentIdNo: string;
  durationDays: number | null;
  expiryDate: string; // raw string from the file
}

export type RowStatus = "valid" | "needs_duration" | "invalid" | "duplicate_in_file" | "exists";

export interface PreviewRow {
  rowNum: number;
  name: string;
  email: string;
  countryCode: string; // raw from file
  phone: string; // normalized E.164, or "" when none/unresolved
  phoneRaw: string; // original national/phone cell (for editing)
  studentIdNo: string;
  durationDays: number | null;
  expiresAt: string | null; // computed ISO, or null when it needs a duration
  status: RowStatus;
  errors: string[];
}

// Header aliases → canonical field.
const HEADER_MAP: Record<string, keyof RawRow> = {
  name: "name", "full name": "name", "student name": "name", fullname: "name",
  email: "email", "email address": "email", "e-mail": "email",
  "country code": "countryCode", country_code: "countryCode", code: "countryCode", "dial code": "countryCode", "country": "countryCode",
  phone: "phone", mobile: "phone", "phone number": "phone", whatsapp: "phone", "mobile number": "phone",
  "student id": "studentIdNo", id: "studentIdNo", "student id no": "studentIdNo", studentid: "studentIdNo", student_id: "studentIdNo", "roll no": "studentIdNo",
  duration: "durationDays", "duration days": "durationDays", "access days": "durationDays", days: "durationDays", duration_days: "durationDays",
  expiry: "expiryDate", "expiry date": "expiryDate", "expires on": "expiryDate", expiry_date: "expiryDate", "expiry at": "expiryDate",
};

function rowsFromCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); out.push(row); }
  return out.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function rowsFromXlsx(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  return json.map((r) => r.map((c) => String(c ?? ""))).filter((r) => r.some((cell) => cell.trim() !== ""));
}

// Parse an uploaded CSV/XLSX file into normalized raw rows (no validation yet).
export function parseImportFile(buf: Buffer, filename: string): RawRow[] {
  const name = filename.toLowerCase();
  let grid: string[][];
  if (name.endsWith(".csv")) grid = rowsFromCsv(buf.toString("utf8"));
  else if (name.endsWith(".xlsx")) grid = rowsFromXlsx(buf);
  else throw badRequest("Upload a .csv or .xlsx file.", "bad_file");
  // Drop comment/instruction lines (the template ships with leading "# …" notes).
  grid = grid.filter((r) => !(r[0] ?? "").trim().startsWith("#"));
  if (grid.length < 2) throw badRequest("The file has no data rows.", "empty_file");

  const header = grid[0]!.map((h) => h.trim().toLowerCase());
  const idx: Partial<Record<keyof RawRow, number>> = {};
  header.forEach((h, i) => {
    const key = HEADER_MAP[h];
    if (key && idx[key] === undefined) idx[key] = i;
  });
  if (idx.name === undefined || idx.email === undefined) {
    throw badRequest("The file must have at least Name and Email columns.", "missing_columns");
  }

  return grid.slice(1).map((cells) => {
    const get = (k: keyof RawRow) => (idx[k] !== undefined ? (cells[idx[k]!] ?? "").trim() : "");
    const durRaw = get("durationDays");
    const dur = durRaw ? Number(durRaw) : null;
    return {
      name: get("name"),
      email: get("email"),
      countryCode: get("countryCode"),
      phone: get("phone"),
      studentIdNo: get("studentIdNo"),
      durationDays: dur !== null && Number.isFinite(dur) ? dur : null,
      expiryDate: get("expiryDate"),
    };
  });
}

function computeFromRow(row: RawRow, now: Date): { expiresAt: Date | null; err: string | null } {
  // Precedence: explicit valid future expiry date > explicit valid duration.
  if (row.expiryDate) {
    const d = new Date(row.expiryDate);
    if (Number.isNaN(d.getTime())) return { expiresAt: null, err: "Invalid expiry date" };
    if (d.getTime() <= now.getTime()) return { expiresAt: null, err: "Expiry date is in the past" };
    return { expiresAt: d, err: null };
  }
  if (row.durationDays !== null) {
    if (row.durationDays <= 0 || row.durationDays > 3650) return { expiresAt: null, err: "Invalid duration" };
    return { expiresAt: new Date(now.getTime() + row.durationDays * DAY_MS), err: null };
  }
  return { expiresAt: null, err: null }; // needs a duration
}

// Validate raw rows against each other and the DB, producing a preview.
export async function buildPreview(rows: RawRow[]): Promise<{ rows: PreviewRow[]; counts: Record<string, number> }> {
  const now = new Date();
  const emails = rows.map((r) => normalizeEmail(r.email)).filter((e) => EMAIL_RE.test(e));
  const existing = new Set(
    (await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } })).map((u) => u.email),
  );
  const seen = new Map<string, number>();

  const preview: PreviewRow[] = rows.map((r, i) => {
    const errors: string[] = [];
    const email = normalizeEmail(r.email);
    const name = r.name.trim();
    if (name.length < 2) errors.push("Missing name");
    if (!EMAIL_RE.test(email)) errors.push("Invalid email");
    const { e164, needsCorrection } = combineE164(r.countryCode, r.phone);
    const phone = e164 ?? "";
    if (needsCorrection) {
      errors.push(r.countryCode.trim() ? "Invalid phone number" : "Phone needs a country code (e.g. +91)");
    }
    const { expiresAt, err } = computeFromRow(r, now);
    if (err) errors.push(err);

    let status: RowStatus = "valid";
    if (errors.length) status = "invalid";
    else if (EMAIL_RE.test(email) && existing.has(email)) status = "exists";
    else if (EMAIL_RE.test(email) && (seen.get(email) ?? 0) > 0) status = "duplicate_in_file";
    else if (!expiresAt) status = "needs_duration";
    if (EMAIL_RE.test(email)) seen.set(email, (seen.get(email) ?? 0) + 1);

    return {
      rowNum: i + 1,
      name,
      email,
      countryCode: r.countryCode.trim(),
      phone,
      phoneRaw: r.phone.trim(),
      studentIdNo: r.studentIdNo.trim(),
      durationDays: r.durationDays,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      status,
      errors,
    };
  });

  const counts = {
    total: preview.length,
    valid: preview.filter((p) => p.status === "valid").length,
    needsDuration: preview.filter((p) => p.status === "needs_duration").length,
    invalid: preview.filter((p) => p.status === "invalid").length,
    duplicateInFile: preview.filter((p) => p.status === "duplicate_in_file").length,
    exists: preview.filter((p) => p.status === "exists").length,
  };
  return { rows: preview, counts };
}

export interface CommitRow {
  name: string;
  email: string;
  phone?: string;
  studentIdNo?: string;
  durationDays?: number;
  customExpiresAt?: string;
}

export interface ImportResult {
  batchId: string;
  total: number;
  created: number;
  duplicates: number;
  failed: number;
  rows: Array<{ email: string; result: "created" | "duplicate" | "failed"; error?: string }>;
}

// Create accounts for the confirmed rows. Idempotent on retry: an existing email
// is reported as a duplicate, never overwritten. Each created student gets the
// temp password + mustChangePassword and a queued credential email.
export async function commitImport(
  actorId: string,
  rows: CommitRow[],
  defaultDurationDays: number | null,
  fileName: string,
): Promise<ImportResult> {
  const now = new Date();
  const { studentTempPassword } = await getSettings();
  const pwHash = await hashPassword(studentTempPassword);
  const results: ImportResult["rows"] = [];
  let created = 0, duplicates = 0, failed = 0;

  for (const r of rows) {
    const email = normalizeEmail(r.email);
    try {
      if (!EMAIL_RE.test(email)) throw new Error("Invalid email");
      const name = r.name.trim();
      if (name.length < 2) throw new Error("Missing name");
      const phone = r.phone?.trim() ? toE164(r.phone) : null;
      if (r.phone?.trim() && !phone) throw new Error("Invalid phone");

      let expiresAt: Date | null = null;
      if (r.customExpiresAt) {
        const d = new Date(r.customExpiresAt);
        if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) throw new Error("Invalid expiry date");
        expiresAt = d;
      } else {
        const days = r.durationDays ?? defaultDurationDays ?? null;
        if (!days || days <= 0 || days > 3650) throw new Error("Missing or invalid duration");
        expiresAt = new Date(now.getTime() + days * DAY_MS);
      }

      if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
        duplicates++;
        results.push({ email, result: "duplicate" });
        continue;
      }

      const user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash: pwHash,
          role: "STUDENT",
          phone,
          studentIdNo: r.studentIdNo?.trim() || null,
          emailVerified: true,
          status: "ACTIVE",
          accessStartAt: now,
          accessExpiresAt: expiresAt,
          createdByAdminId: actorId,
          mustChangePassword: true,
          credentialEmailStatus: "PENDING",
        },
        select: { id: true },
      });
      await enqueue("sendEmail", { type: "credential", userId: user.id }, { dedupeKey: `credential:${user.id}` });
      created++;
      results.push({ email, result: "created" });
    } catch (err) {
      failed++;
      results.push({ email, result: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  const batch = await prisma.importBatch.create({
    data: {
      createdByAdminId: actorId,
      fileName: fileName.slice(0, 200),
      totalRows: rows.length,
      createdCount: created,
      duplicateCount: duplicates,
      failedCount: failed,
      status: "DONE",
    },
  });
  await writeAudit({ actorId, action: "student.bulk_import", entityType: "ImportBatch", entityId: batch.id, meta: { created, duplicates, failed } });

  return { batchId: batch.id, total: rows.length, created, duplicates, failed, rows: results };
}

// Prevent spreadsheet formula injection in generated CSV downloads.
export function csvCell(value: string): string {
  const v = value ?? "";
  const needsGuard = /^[=+\-@\t\r]/.test(v);
  const escaped = `"${(needsGuard ? "'" + v : v).replace(/"/g, '""')}"`;
  return escaped;
}

export function sampleCsv(): string {
  // Columns stay in sync with the import parser (HEADER_MAP) by construction.
  const header = ["name", "email", "country_code", "phone", "student_id", "duration_days", "expiry_date"];
  const rows = [
    ["Rahul", "rahul@example.com", "+91", "9876543210", "STU001", "45", ""],
    ["John", "john@example.com", "+1", "4155552671", "STU002", "90", ""],
    ["Ahmed", "ahmed@example.com", "+971", "501234567", "STU003", "45", ""],
    ["Sarah", "sarah@example.com", "+44", "7700900123", "STU004", "", ""],
  ];
  const notes = [
    "# name and email are required. country_code uses international format e.g. +91. phone is the national number without the country code.",
    "# Phone is optional. duration_days can be 45, 90 or a custom number; if blank, assign it in the import preview. expiry_date is optional (YYYY-MM-DD). Do not include passwords — credentials are emailed automatically.",
  ];
  return [...notes, [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")].join("\r\n");
}
