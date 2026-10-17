import { buildDraft } from "../../responses/draftService.js";
import { routeDraft } from "../../responses/approvalService.js";

interface Payload {
  questionMessageId: string;
}

// Generate (or regenerate) the AI draft, then route it. Generation NEVER sends;
// routeDraft only auto-sends when mode + eligibility allow.
export async function generateAnswer(payloadRaw: unknown): Promise<void> {
  const { questionMessageId } = payloadRaw as Payload;
  const draft = await buildDraft(questionMessageId);
  await routeDraft(draft.id);
}
