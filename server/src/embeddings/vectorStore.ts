// Portable vector storage using real[] columns + a kb_cosine() SQL function.
// Works on plain Postgres (embedded dev DB) and Supabase alike, with no pgvector
// dependency. Adequate for this app's scale; an ANN index can be added later.

export function vectorLiteral(vec: number[]): string {
  // Numbers are server-generated floats; still guard against anything non-finite.
  const parts = vec.map((n) => {
    if (!Number.isFinite(n)) return "0";
    return n.toFixed(6);
  });
  return `ARRAY[${parts.join(",")}]::real[]`;
}
