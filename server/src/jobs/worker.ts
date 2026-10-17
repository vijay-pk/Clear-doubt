import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { claimNext, completeJob, failJob, deferJob, reclaimStale } from "./queue.js";
import { DeferError, type JobHandler, type JobType } from "./types.js";

const handlers = new Map<JobType, JobHandler>();

export function registerHandler(type: JobType, handler: JobHandler) {
  handlers.set(type, handler);
}

let running = false;
let timer: NodeJS.Timeout | null = null;
const workerId = `w-${randomUUID().slice(0, 8)}`;

// Run a single pass: claim and process one job. Returns true if a job was handled.
export async function runOnce(): Promise<boolean> {
  const job = await claimNext(workerId);
  if (!job) return false;
  const handler = handlers.get(job.type as JobType);
  if (!handler) {
    await failJob(job.id, `No handler for job type ${job.type}`, 99, 1);
    logger.error({ type: job.type }, "no handler for job");
    return true;
  }
  try {
    await handler(job.payload, { jobId: job.id, attempts: job.attempts });
    await completeJob(job.id);
  } catch (err) {
    if (err instanceof DeferError) {
      await deferJob(job.id, err.delayMs);
      return true;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, type: job.type, jobId: job.id, attempts: job.attempts }, "job failed");
    await failJob(job.id, message, job.attempts, job.maxAttempts);
  }
  return true;
}

// Drain all currently-due jobs (used by tests via runDueJobs()).
export async function runDueJobs(limit = 1000): Promise<number> {
  let n = 0;
  while (n < limit) {
    const did = await runOnce();
    if (!did) break;
    n++;
  }
  return n;
}

async function loop() {
  if (!running) return;
  try {
    await reclaimStale();
    // Drain as many as are ready, then wait.
    let processed = 0;
    while (running && (await runOnce())) {
      processed++;
      if (processed > 50) break; // yield periodically
    }
  } catch (err) {
    logger.error({ err }, "worker loop error");
  } finally {
    if (running) timer = setTimeout(loop, env.WORKER_POLL_MS);
  }
}

export function startWorker() {
  if (running) return;
  running = true;
  logger.info({ workerId }, "worker started");
  timer = setTimeout(loop, 200);
}

export function stopWorker() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}
