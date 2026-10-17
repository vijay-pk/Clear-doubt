-- Search / retrieval layer. Hand-written because Prisma cannot model generated
-- tsvector columns or portable vector columns. Uses real[] + kb_cosine so it
-- works on plain Postgres (embedded dev) and Supabase alike (no pgvector needed).

-- Cosine similarity over real[] vectors. IMMUTABLE so it can be used in queries.
CREATE OR REPLACE FUNCTION kb_cosine(a real[], b real[])
RETURNS double precision
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  dot double precision := 0;
  na double precision := 0;
  nb double precision := 0;
  i int;
  n int;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN 0; END IF;
  n := least(array_length(a, 1), array_length(b, 1));
  IF n IS NULL THEN RETURN 0; END IF;
  FOR i IN 1..n LOOP
    dot := dot + (a[i]::double precision * b[i]::double precision);
    na := na + (a[i]::double precision * a[i]::double precision);
    nb := nb + (b[i]::double precision * b[i]::double precision);
  END LOOP;
  IF na = 0 OR nb = 0 THEN RETURN 0; END IF;
  RETURN dot / (sqrt(na) * sqrt(nb));
END;
$$;

-- Chunks of course documents (not a Prisma model; accessed via $queryRaw).
CREATE TABLE "DocumentChunk" (
  "id" text PRIMARY KEY,
  "documentId" text NOT NULL,
  "ordinal" integer NOT NULL,
  "content" text NOT NULL,
  "tokenCount" integer NOT NULL DEFAULT 0,
  "embedding" real[],
  "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId")
    REFERENCES "CourseDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");
CREATE INDEX "DocumentChunk_tsv_idx" ON "DocumentChunk" USING GIN ("tsv");

-- Approved-answer memory: add embedding + full-text column to the Prisma table.
ALTER TABLE "ApprovedAnswer" ADD COLUMN "embedding" real[];
ALTER TABLE "ApprovedAnswer"
  ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "question" || ' ' || "answer")) STORED;
CREATE INDEX "ApprovedAnswer_tsv_idx" ON "ApprovedAnswer" USING GIN ("tsv");
