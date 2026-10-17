import { prisma } from "../db/prisma.js";
import { getEmbedder } from "../embeddings/embedder.js";
import { vectorLiteral } from "../embeddings/vectorStore.js";

export interface ApprovedMatch {
  id: string;
  question: string;
  answer: string;
  score: number;
}

// Search Approved Answer Memory for prior admin-approved answers to similar
// questions. Used as retrieval examples and (in auto modes) for direct reuse.
export async function searchApproved(query: string, limit = 3): Promise<ApprovedMatch[]> {
  const embedder = getEmbedder();
  const ft = await prisma.$queryRawUnsafe<ApprovedMatch[]>(
    `SELECT id, question, answer,
            ts_rank(tsv, websearch_to_tsquery('english', $1)) AS score
     FROM "ApprovedAnswer"
     WHERE active = true AND tsv @@ websearch_to_tsquery('english', $1)
     ORDER BY score DESC LIMIT $2`,
    query,
    limit * 2,
  );

  let vec: ApprovedMatch[] = [];
  if (embedder.enabled) {
    const [qv] = await embedder.embed([query]);
    if (qv) {
      vec = await prisma.$queryRawUnsafe<ApprovedMatch[]>(
        `SELECT id, question, answer, kb_cosine(embedding, ${vectorLiteral(qv)}) AS score
         FROM "ApprovedAnswer"
         WHERE active = true AND embedding IS NOT NULL
         ORDER BY score DESC LIMIT $1`,
        limit * 2,
      );
    }
  }

  const merged = new Map<string, ApprovedMatch>();
  for (const r of [...ft, ...vec]) {
    const prev = merged.get(r.id);
    if (!prev || Number(r.score) > prev.score) merged.set(r.id, { ...r, score: Number(r.score) });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
