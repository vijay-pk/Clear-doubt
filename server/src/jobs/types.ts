export type JobType =
  | "sendEmail"
  | "processImage"
  | "processDocument"
  | "generateAnswer"
  | "deliverMessage"
  | "retention";

export interface JobContext {
  jobId: string;
  attempts: number;
}

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>;

// Throw to reschedule a job without counting it as a failure.
export class DeferError extends Error {
  delayMs: number;
  constructor(message: string, delayMs = 5000) {
    super(message);
    this.delayMs = delayMs;
  }
}
