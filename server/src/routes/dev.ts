import { Router } from "express";
import { asyncHandler } from "../http/helpers.js";
import { runDueJobs } from "../jobs/worker.js";
import { env } from "../config/env.js";

// Dev-only helpers. Refused in production (see app.ts guard).
export const devRouter = Router();

devRouter.post(
  "/run-jobs",
  asyncHandler(async (_req, res) => {
    if (env.NODE_ENV === "production") return res.sendStatus(404);
    const n = await runDueJobs();
    res.json({ processed: n });
  }),
);
