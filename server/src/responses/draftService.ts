import { prisma } from "../db/prisma.js";
import { getAI } from "../ai/getAI.js";
import { searchCourse } from "../retrieval/courseSearch.js";
import { recordUsage, withinBudget } from "../ai/budget.js";
import { logger } from "../lib/logger.js";
import type { RetrievedChunk } from "../ai/types.js";

// Build (or rebuild) the AI draft for a question message. Pure generation —
// NEVER sends anything. Routing to approval/auto happens in approvalService.
export async function buildDraft(questionMessageId: string) {
  const question = await prisma.doubtMessage.findUniqueOrThrow({
    where: { id: questionMessageId },
    include: { attachments: true, doubt: true },
  });

  // Combine text question with any extracted image text.
  const imageAttachment = question.attachments[0];
  const imageText = imageAttachment?.ocrText ?? undefined;
  const imageReadable = imageAttachment ? imageAttachment.status !== "UNREADABLE" : undefined;

  const queryText = [question.body, imageText].filter(Boolean).join("\n");

  let context: RetrievedChunk[] = [];
  try {
    context = await searchCourse(queryText, 6);
  } catch (err) {
    logger.warn({ err }, "course search failed; proceeding without context");
  }

  if (!(await withinBudget())) {
    // Budget exhausted: produce a safe clarification draft rather than calling the model.
    return upsertDraft(questionMessageId, question.doubtId, {
      answerText:
        "Our tutors will review your question shortly. (Automatic answering is paused for today.)",
      isClarification: true,
      evidenceSufficient: false,
      confidence: 0,
      model: "budget_paused",
      citations: [],
    });
  }

  const ai = getAI();
  let result;
  try {
    result = await ai.generateAnswer({ question: question.body, context, imageText, imageReadable });
  } catch (err) {
    // AI call failed (e.g. a decommissioned model or bad key). Never leave the
    // queue silently empty — create a draft a human can answer, and log the cause.
    logger.error({ err }, "AI generateAnswer failed; creating a fallback draft for manual review");
    return upsertDraft(questionMessageId, question.doubtId, {
      answerText:
        "The automatic draft could not be generated for this question. Please review and answer it manually.",
      isClarification: false,
      evidenceSufficient: false,
      confidence: 0,
      model: "error",
      citations: [],
    });
  }

  if (result.usage) await recordUsage(result.usage.promptTokens, result.usage.completionTokens);

  return upsertDraft(questionMessageId, question.doubtId, {
    answerText: result.answer,
    isClarification: result.isClarification,
    evidenceSufficient: result.evidenceSufficient,
    confidence: result.confidence,
    model: result.model,
    citations: result.citations,
  });
}

interface DraftData {
  answerText: string;
  isClarification: boolean;
  evidenceSufficient: boolean;
  confidence: number;
  model: string;
  citations: Array<{ chunkId: string; documentId: string; score: number; snippet: string }>;
}

async function upsertDraft(questionMessageId: string, doubtId: string, data: DraftData) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.responseDraft.findUnique({ where: { questionMessageId } });
    const draft = existing
      ? await tx.responseDraft.update({
          where: { id: existing.id },
          data: {
            status: "PENDING_APPROVAL",
            answerText: data.answerText,
            editedText: null,
            isClarification: data.isClarification,
            evidenceSufficient: data.evidenceSufficient,
            confidence: data.confidence,
            modelUsed: data.model,
          },
        })
      : await tx.responseDraft.create({
          data: {
            doubtId,
            questionMessageId,
            status: "PENDING_APPROVAL",
            answerText: data.answerText,
            isClarification: data.isClarification,
            evidenceSufficient: data.evidenceSufficient,
            confidence: data.confidence,
            modelUsed: data.model,
          },
        });

    await tx.citation.deleteMany({ where: { draftId: draft.id } });
    if (data.citations.length) {
      await tx.citation.createMany({
        data: data.citations.map((c) => ({
          draftId: draft.id,
          chunkId: c.chunkId,
          documentId: c.documentId,
          score: c.score,
          snippet: c.snippet,
        })),
      });
    }
    return draft;
  });
}
