import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/authContext.js";
import { draftsRouter } from "./drafts.js";
import { settingsRouter } from "./settings.js";
import { knowledgeRouter } from "./knowledge.js";
import { usersRouter } from "./users.js";
import { studentsRouter } from "./students.js";
import { logsRouter } from "./logs.js";
import { whatsappRouter } from "./whatsapp.js";

export const adminRouter = Router();

// Server-enforced: every admin route requires an authenticated ADMIN/SUPER_ADMIN.
adminRouter.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

adminRouter.use(draftsRouter);
adminRouter.use(settingsRouter);
adminRouter.use(knowledgeRouter);
adminRouter.use(usersRouter);
adminRouter.use(studentsRouter);
adminRouter.use(logsRouter);
adminRouter.use(whatsappRouter);
