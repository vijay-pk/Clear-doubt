import { prisma } from "../db/prisma.js";
import { getEmbedder } from "../embeddings/embedder.js";
import { vectorLiteral } from "../embeddings/vectorStore.js";
import { writeAudit } from "../audit/audit.js";

// Add an answer to Approved Answer Memory. Learning is retrieval-only: approved
// answers are embedded and searched, never used to fine-tune a model.
export async function createApprovedAnswer(input: {
  question: string;
  answer: string;
  tags?: string[];
  draftId?: string;
  createdById: string;
}) {
  const row = await prisma.approvedAnswer.create({
    data: {
      question: input.question.trim(),
      answer: input.answer.trim(),
      tags: input.tags ?? [],
      draftId: input.draftId,
      createdById: input.createdById,
    },
  });

  const embedder = getEmbedder();
  if (embedder.enabled) {
    // Embed the QUESTION (we retrieve by question similarity).
    const [vec] = await embedder.embed([input.question]);
    if (vec) {
      await prisma.$executeRawUnsafe(
        `UPDATE "ApprovedAnswer" SET embedding = ${vectorLiteral(vec)} WHERE id = $1`,
        row.id,
      );
    }
  }
  await writeAudit({ actorId: input.createdById, action: "approved_answer.create", entityType: "ApprovedAnswer", entityId: row.id });
  return row;
}

// Promote an approved/sent draft into the knowledge base.
export async function promoteDraft(draftId: string, adminId: string) {
  const draft = await prisma.responseDraft.findUnique({
    where: { id: draftId },
    include: { doubt: { include: { messages: { where: { sender: "STUDENT" }, orderBy: { createdAt: "asc" }, take: 1 } } } },
  });
  if (!draft) throw new Error("Draft not found");
  const question = draft.doubt.messages[0]?.body ?? "";
  const answer = (draft.editedText ?? draft.answerText ?? "").trim();
  return createApprovedAnswer({ question, answer, draftId, createdById: adminId });
}
