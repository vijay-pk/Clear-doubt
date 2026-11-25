import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../http/helpers.js";
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
  computeExpiry,
} from "../../students/studentAdminService.js";

export const studentsRouter = Router();

const STATES = ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "SUSPENDED", "DELETION_PENDING"] as const;

const createSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(10).max(200),
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
