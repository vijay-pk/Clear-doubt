import { prisma } from "../db/prisma.js";
import type { JobType } from "./types.js";

export interface EnqueueOptions {
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

// Enqueue a job. If dedupeKey is set and a PENDING job with the same (type, key)
// exists, the payload is refreshed instead of creating a duplicate (debounce).
export async function enqueue(type: JobType, payload: unknown, opts: EnqueueOptions = {}) {
  const data = {
    type,
    payload: (payload ?? {}) as object,
    dedupeKey: opts.dedupeKey ?? null,
    runAt: opts.runAt ?? new Date(),
    maxAttempts: opts.maxAttempts ?? 5,
  };
  if (opts.dedupeKey) {
    return prisma.job.upsert({
      where: { type_dedupeKey: { type, dedupeKey: opts.dedupeKey } },
      create: data,
      update: { payload: data.payload, runAt: data.runAt, status: "PENDING" },
    });
  }
  return prisma.job.create({ data });
}

export const enqueueDebounced = enqueue; // alias: dedupeKey makes it debounced

interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

// Atomically claim one due job using FOR UPDATE SKIP LOCKED.
export async function claimNext(workerId: string): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH next AS (
      SELECT id FROM "Job"
      WHERE status = 'PENDING' AND "runAt" <= now()
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "Job" j
    SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId},
        attempts = j.attempts + 1, "updatedAt" = now()
    FROM next
    WHERE j.id = next.id
    RETURNING j.id;
  `;
  const id = rows[0]?.id;
  if (!id) return null;
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) return null;
  return { id: job.id, type: job.type, payload: job.payload, attempts: job.attempts, maxAttempts: job.maxAttempts };
}

export async function completeJob(id: string) {
  await prisma.job.update({ where: { id }, data: { status: "DONE", lockedAt: null, lockedBy: null } });
}

export async function failJob(id: string, error: string, attempts: number, maxAttempts: number) {
  const dead = attempts >= maxAttempts;
  const backoffMs = Math.min(60_000, 1000 * 2 ** attempts);
  await prisma.job.update({
    where: { id },
    data: dead
      ? { status: "FAILED", lastError: error.slice(0, 2000), lockedAt: null, lockedBy: null }
      : {
          status: "PENDING",
          lastError: error.slice(0, 2000),
          runAt: new Date(Date.now() + backoffMs),
          lockedAt: null,
          lockedBy: null,
        },
  });
}

export async function deferJob(id: string, delayMs: number) {
  // Reschedule without counting a failure: roll back the attempt increment.
  await prisma.job.update({
    where: { id },
    data: {
      status: "PENDING",
      runAt: new Date(Date.now() + delayMs),
      attempts: { decrement: 1 },
      lockedAt: null,
      lockedBy: null,
    },
  });
}

// Reclaim jobs stuck in RUNNING (e.g. a crashed worker) past the stale timeout.
export async function reclaimStale(staleMs = 2 * 60 * 1000) {
  const cutoff = new Date(Date.now() - staleMs);
  await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: cutoff } },
    data: { status: "PENDING", lockedAt: null, lockedBy: null },
  });
}
