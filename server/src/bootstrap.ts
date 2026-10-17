import { registerHandler } from "./jobs/worker.js";
import { enqueue } from "./jobs/queue.js";
import { generateAnswer } from "./jobs/handlers/generateAnswer.js";
import { processImage } from "./jobs/handlers/processImage.js";
import { processDocument } from "./jobs/handlers/processDocument.js";
import { sendEmail } from "./jobs/handlers/sendEmail.js";
import { deliverMessage } from "./jobs/handlers/deliverMessage.js";
import { retention } from "./jobs/handlers/retention.js";

// Wire all job handlers. Shared by the server entrypoint and the test harness.
export function registerJobHandlers() {
  registerHandler("generateAnswer", generateAnswer);
  registerHandler("processImage", processImage);
  registerHandler("processDocument", processDocument);
  registerHandler("sendEmail", sendEmail);
  registerHandler("deliverMessage", deliverMessage);
  // Retention re-schedules itself once per day.
  registerHandler("retention", async (payload, ctx) => {
    await retention();
    await enqueue("retention", {}, { dedupeKey: "retention:daily", runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    void payload;
    void ctx;
  });
}

export async function scheduleRecurring() {
  await enqueue("retention", {}, { dedupeKey: "retention:daily", runAt: new Date(Date.now() + 60 * 1000) });
}
