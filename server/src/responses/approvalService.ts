import type { ResponseDraft } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getSettings, type PlatformSettings } from "../settings/settingsService.js";
import { searchApproved } from "../retrieval/approvedSearch.js";
import { enqueue } from "../jobs/queue.js";
import { writeAudit } from "../audit/audit.js";
import { badRequest, notFound } from "../lib/errors.js";

export interface Eligibility {
  eligible: boolean;
  reason: string;
}

export function finalText(draft: ResponseDraft): string {
  return (draft.editedText ?? draft.answerText ?? "").trim();
}

// Decide whether a fresh draft may be sent WITHOUT human approval, per mode.
export async function computeEligibility(
  draft: ResponseDraft,
  hasImage: boolean,
  settings: PlatformSettings,
): Promise<Eligibility> {
  if (settings.replyMode === "A") return { eligible: false, reason: "manual_mode" };
  if (settings.autoReplyPaused) return { eligible: false, reason: "globally_paused" };
  if (draft.isClarification) return { eligible: false, reason: "needs_clarification" };
  if (hasImage && !settings.autoReplyImagesAllowed) return { eligible: false, reason: "image_not_allowed" };

  if (settings.replyMode === "B") {
    // Supervised: only reuse a strong prior approved answer.
    const q = await prisma.doubtMessage.findUnique({ where: { id: draft.questionMessageId } });
    if (!q) return { eligible: false, reason: "no_question" };
    const matches = await searchApproved(q.body, 1);
    if (matches[0] && matches[0].score >= 0.9) return { eligible: true, reason: "approved_reuse" };
    return { eligible: false, reason: "no_strong_approved_match" };
  }

  // Mode C: Controlled Auto-Reply with strict eligibility.
  if (draft.confidence < settings.autoReplyMinConfidence)
    return { eligible: false, reason: "below_confidence" };
  if (settings.autoReplyRequireEvidence && !draft.evidenceSufficient)
    return { eligible: false, reason: "insufficient_evidence" };
  return { eligible: true, reason: "auto_eligible" };
}

// Called after a draft is (re)built. Auto-sends only when eligible; otherwise the
// draft stays in PENDING_APPROVAL for a human. Generating NEVER sends by itself.
export async function routeDraft(draftId: string): Promise<void> {
  const draft = await prisma.responseDraft.findUnique({ where: { id: draftId } });
  if (!draft) return;
  const hasImage =
    (await prisma.attachment.count({ where: { doubtMessageId: draft.questionMessageId } })) > 0;
  const settings = await getSettings();
  const elig = await computeEligibility(draft, hasImage, settings);

  await prisma.responseDraft.update({ where: { id: draftId }, data: { autoEligible: elig.eligible } });

  if (elig.eligible) {
    await prisma.responseDraft.update({
      where: { id: draftId },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById: null },
    });
    await writeAudit({ action: "draft.auto_approved", entityType: "ResponseDraft", entityId: draftId, meta: { reason: elig.reason, mode: settings.replyMode } });
    await enqueue("deliverMessage", { draftId }, { dedupeKey: `deliver:${draftId}` });
  }
}

// ---- Admin actions ----

async function loadPending(draftId: string) {
  const draft = await prisma.responseDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw notFound("Draft not found");
  if (!["PENDING_APPROVAL", "DRAFTING"].includes(draft.status))
    throw badRequest(`Draft is ${draft.status}, cannot act on it.`, "bad_state");
  return draft;
}

export async function approveDraft(draftId: string, adminId: string, editedText?: string) {
  const draft = await loadPending(draftId);
  await prisma.responseDraft.update({
    where: { id: draft.id },
    data: {
      status: "APPROVED",
      editedText: editedText?.trim() || draft.editedText,
      decidedById: adminId,
      decidedAt: new Date(),
    },
  });
  await writeAudit({ actorId: adminId, action: editedText ? "draft.edit_approve" : "draft.approve", entityType: "ResponseDraft", entityId: draftId });
  await enqueue("deliverMessage", { draftId }, { dedupeKey: `deliver:${draftId}` });
}

export async function rejectDraft(draftId: string, adminId: string, reason?: string) {
  const draft = await loadPending(draftId);
  await prisma.responseDraft.update({
    where: { id: draft.id },
    data: { status: "REJECTED", decidedById: adminId, decidedAt: new Date() },
  });
  await writeAudit({ actorId: adminId, action: "draft.reject", entityType: "ResponseDraft", entityId: draftId, meta: { reason } });
}

export async function regenerateDraft(draftId: string, adminId: string) {
  const draft = await loadPending(draftId);
  await prisma.responseDraft.update({ where: { id: draft.id }, data: { status: "DRAFTING" } });
  await writeAudit({ actorId: adminId, action: "draft.regenerate", entityType: "ResponseDraft", entityId: draftId });
  await enqueue("generateAnswer", { questionMessageId: draft.questionMessageId }, { dedupeKey: `gen:${draft.questionMessageId}` });
}
