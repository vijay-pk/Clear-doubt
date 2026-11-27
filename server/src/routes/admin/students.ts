import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { asyncHandler } from "../../http/helpers.js";
import { prisma } from "../../db/prisma.js";
import { badRequest } from "../../lib/errors.js";
import {
  createStudent,
  listStudents,
  getStudent,
  getStudentStats,
  updateStudent,
  extendAccess,
  suspendStudent,
  reactivateStudent,
  deletionPreview,
  requestDeletion,
  resendCredentials,
  computeExpiry,
} from "../../students/studentAdminService.js";
import { parseImportFile, buildPreview, commitImport, sampleCsv } from "../../students/importService.js";

export const studentsRouter = Router();

// Small in-memory uploader for CSV/XLSX imports (≤2 MB, one file).
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

const STATES = ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "SUSPENDED", "DELETION_PENDING"] as const;

// No password: every student gets the configured temporary password + a credential email.
const createSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  studentIdNo: z.string().max(60).optional(),
  durationDays: z.number().int().positive().max(3650).optional(),
  customExpiresAt: z.string().datetime().optional(),
  adminNotes: z.string().max(2000).optional(),
});

studentsRouter.get(
  "/students",
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const stateQ = typeof req.query.state === "string" ? req.query.state : undefined;
    const state = (STATES as readonly string[]).includes(stateQ ?? "") ? (stateQ as (typeof STATES)[number]) : undefined;
    res.json({ students: await listStudents({ search, state }) });
  }),
);

studentsRouter.get(
  "/students/stats",
  asyncHandler(async (_req, res) => {
    res.json({ stats: await getStudentStats() });
  }),
);

// Preview the computed expiry before confirming creation.
studentsRouter.post(
  "/students/preview-expiry",
  asyncHandler(async (req, res) => {
    const input = z
      .object({ durationDays: z.number().int().positive().max(3650).optional(), customExpiresAt: z.string().datetime().optional() })
      .parse(req.body);
    res.json({ expiresAt: computeExpiry(input, new Date()).toISOString() });
  }),
);

// Download a sample CSV template.
studentsRouter.get("/students/import/template", (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="students-template.csv"');
  res.send(sampleCsv());
});

// Recent import batches (history).
studentsRouter.get(
  "/students/import/batches",
  asyncHandler(async (_req, res) => {
    const batches = await prisma.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
    res.json({ batches });
  }),
);

// Parse an uploaded CSV/XLSX and return a validated preview (no accounts created).
studentsRouter.post(
  "/students/import/parse",
  importUpload.single("file"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file?.buffer?.length) throw badRequest("Upload a .csv or .xlsx file.", "no_file");
    const rows = parseImportFile(file.buffer, file.originalname || "upload.csv");
    if (rows.length > 2000) throw badRequest("Too many rows (max 2000 per import).", "too_many_rows");
    const preview = await buildPreview(rows);
    res.json({ fileName: file.originalname, ...preview });
  }),
);

// Create accounts for the confirmed rows + queue their credential emails.
studentsRouter.post(
  "/students/import/commit",
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        fileName: z.string().max(200).optional(),
        defaultDurationDays: z.number().int().positive().max(3650).nullable().optional(),
        rows: z
          .array(
            z.object({
              name: z.string().max(80),
              email: z.string().max(200),
              phone: z.string().max(30).optional(),
              studentIdNo: z.string().max(60).optional(),
              durationDays: z.number().int().positive().max(3650).optional(),
              customExpiresAt: z.string().datetime().optional(),
            }),
          )
          .max(2000),
      })
      .parse(req.body);
    const result = await commitImport(req.user!.id, body.rows, body.defaultDurationDays ?? null, body.fileName ?? "import.csv");
    res.json({ result });
  }),
);

studentsRouter.post(
  "/students",
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const student = await createStudent(req.user!.id, input);
    res.status(201).json({ student });
  }),
);

studentsRouter.get(
  "/students/:id",
  asyncHandler(async (req, res) => {
    res.json({ student: await getStudent(String(req.params.id)) });
  }),
);

studentsRouter.patch(
  "/students/:id",
  asyncHandler(async (req, res) => {
    const patch = z
      .object({
        name: z.string().max(80).optional(),
        phone: z.string().max(30).nullable().optional(),
        studentIdNo: z.string().max(60).nullable().optional(),
        adminNotes: z.string().max(2000).nullable().optional(),
      })
      .parse(req.body);
    res.json({ student: await updateStudent(req.user!.id, String(req.params.id), patch) });
  }),
);

studentsRouter.post(
  "/students/:id/extend",
  asyncHandler(async (req, res) => {
    const input = z
      .object({ addDays: z.number().int().positive().max(3650).optional(), newExpiresAt: z.string().datetime().optional() })
      .parse(req.body);
    res.json({ student: await extendAccess(req.user!.id, String(req.params.id), input) });
  }),
);

studentsRouter.post(
  "/students/:id/suspend",
  asyncHandler(async (req, res) => {
    res.json({ student: await suspendStudent(req.user!.id, String(req.params.id)) });
  }),
);

studentsRouter.post(
  "/students/:id/reactivate",
  asyncHandler(async (req, res) => {
    res.json({ student: await reactivateStudent(req.user!.id, String(req.params.id)) });
  }),
);

// Re-send the credential (welcome) email to an existing student.
studentsRouter.post(
  "/students/:id/resend-credentials",
  asyncHandler(async (req, res) => {
    await resendCredentials(req.user!.id, String(req.params.id));
    res.json({ ok: true });
  }),
);

studentsRouter.get(
  "/students/:id/deletion-preview",
  asyncHandler(async (req, res) => {
    res.json({ preview: await deletionPreview(String(req.params.id)) });
  }),
);

studentsRouter.delete(
  "/students/:id",
  asyncHandler(async (req, res) => {
    await requestDeletion(req.user!.id, String(req.params.id));
    res.json({ ok: true });
  }),
);
