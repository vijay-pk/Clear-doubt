export interface Chunk {
  ordinal: number;
  content: string;
  tokenCount: number;
}

// Rough token estimate (~4 chars/token) — good enough for sizing chunks.
function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

// Split text into ~800-token chunks with ~120-token overlap, on paragraph/sentence
// boundaries where possible.
export function chunkText(text: string, targetTokens = 800, overlapTokens = 120): Chunk[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  const paras = clean.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  let ordinal = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const content = buf.join("\n\n").trim();
    if (content) chunks.push({ ordinal: ordinal++, content, tokenCount: estTokens(content) });
  };

  for (const para of paras) {
    const t = estTokens(para);
    if (t > targetTokens) {
      // Paragraph too big: split by sentences.
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (bufTokens + estTokens(s) > targetTokens) {
          flush();
          buf = overlapTail(buf, overlapTokens);
          bufTokens = buf.reduce((n, x) => n + estTokens(x), 0);
        }
        buf.push(s);
        bufTokens += estTokens(s);
      }
      continue;
    }
    if (bufTokens + t > targetTokens) {
      flush();
      buf = overlapTail(buf, overlapTokens);
      bufTokens = buf.reduce((n, x) => n + estTokens(x), 0);
    }
    buf.push(para);
    bufTokens += t;
  }
  flush();
  return chunks;
}

function overlapTail(buf: string[], overlapTokens: number): string[] {
  const tail: string[] = [];
  let t = 0;
  for (let i = buf.length - 1; i >= 0; i--) {
    const bt = Math.ceil(buf[i]!.length / 4);
    if (t + bt > overlapTokens) break;
    tail.unshift(buf[i]!);
    t += bt;
  }
  return tail;
}
