import { prisma } from "../db/prisma.js";
import { getEmbedder } from "../embeddings/embedder.js";
import { vectorLiteral } from "../embeddings/vectorStore.js";
import type { RetrievedChunk } from "../ai/types.js";

interface Row {
  id: string;
  documentId: string;
  title: string;
  content: string;
  score: number;
}

// Hybrid retrieval: vector similarity (when embeddings enabled) blended with
// Postgres full-text rank over the generated tsv column. Returns top chunks.
export async function searchCourse(query: string, limit = 6): Promise<RetrievedChunk[]> {
  const embedder = getEmbedder();

  // Full-text candidates (always available).
  const ftRows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT c.id, c."documentId", d.title, c.content,
            ts_rank(c.tsv, websearch_to_tsquery('english', $1)) AS score
     FROM "DocumentChunk" c
     JOIN "CourseDocument" d ON d.id = c."documentId"
     WHERE d.status = 'READY' AND c.tsv @@ websearch_to_tsquery('english', $1)
     ORDER BY score DESC
     LIMIT $2`,
    query,
    limit * 2,
  );

  let vecRows: Row[] = [];
  if (embedder.enabled) {
    const [qv] = await embedder.embed([query]);
    if (qv) {
      vecRows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT c.id, c."documentId", d.title, c.content,
                kb_cosine(c.embedding, ${vectorLiteral(qv)}) AS score
         FROM "DocumentChunk" c
         JOIN "CourseDocument" d ON d.id = c."documentId"
         WHERE d.status = 'READY' AND c.embedding IS NOT NULL
         ORDER BY score DESC
         LIMIT $1`,
        limit * 2,
      );
    }
  }

  // Blend: normalize each list to 0..1 and sum weighted.
  const merged = new Map<string, { row: Row; score: number }>();
  const add = (rows: Row[], weight: number) => {
    const max = Math.max(1e-9, ...rows.map((r) => Number(r.score)));
    for (const r of rows) {
      const norm = (Number(r.score) / max) * weight;
      const existing = merged.get(r.id);
      if (existing) existing.score += norm;
      else merged.set(r.id, { row: r, score: norm });
    }
  };
  add(ftRows, 1.0);
  add(vecRows, 1.2); // slight preference for semantic match when available

  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => ({
      chunkId: row.id,
      documentId: row.documentId,
      documentTitle: row.title,
      content: row.content,
      score,
    }));
}
