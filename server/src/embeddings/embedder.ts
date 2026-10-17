import { createHash } from "node:crypto";
import { env } from "../config/env.js";

export interface Embedder {
  readonly dim: number;
  readonly enabled: boolean;
  embed(texts: string[]): Promise<number[][]>;
}

class NoneEmbedder implements Embedder {
  dim = 0;
  enabled = false;
  async embed(): Promise<number[][]> {
    return [];
  }
}

// Deterministic hashing embedder: stable vectors without a network, for tests/dev.
class MockEmbedder implements Embedder {
  enabled = true;
  constructor(public dim: number) {}
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const vec = new Array<number>(this.dim).fill(0);
      const tokens = t.toLowerCase().split(/\W+/).filter(Boolean);
      for (const tok of tokens) {
        const h = createHash("md5").update(tok).digest();
        for (let i = 0; i < this.dim; i++) {
          vec[i] = (vec[i] ?? 0) + (h[i % h.length]! / 255 - 0.5) * 2;
        }
      }
      return normalize(vec);
    });
  }
}

class OpenAICompatibleEmbedder implements Embedder {
  enabled = true;
  constructor(public dim: number) {
    if (!env.EMBEDDING_BASE_URL || !env.EMBEDDING_API_KEY) {
      throw new Error("EMBEDDING_PROVIDER=openai_compatible requires EMBEDDING_BASE_URL and EMBEDDING_API_KEY");
    }
  }
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${env.EMBEDDING_BASE_URL!.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.EMBEDDING_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.EMBEDDING_MODEL, input: texts }),
    });
    if (!res.ok) throw new Error(`Embedding error (${res.status}): ${await res.text()}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => d.embedding);
  }
}

function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

let instance: Embedder | null = null;
export function getEmbedder(): Embedder {
  if (!instance) {
    instance =
      env.EMBEDDING_PROVIDER === "none"
        ? new NoneEmbedder()
        : env.EMBEDDING_PROVIDER === "openai_compatible"
          ? new OpenAICompatibleEmbedder(env.EMBEDDING_DIM)
          : new MockEmbedder(env.EMBEDDING_DIM);
  }
  return instance;
}

export function setEmbedder(e: Embedder) {
  instance = e;
}
