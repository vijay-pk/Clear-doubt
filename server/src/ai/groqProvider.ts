import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { AIProvider, AnswerRequest, AnswerResult, VisionRequest, VisionResult } from "./types.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
}

async function chat(model: string, messages: ChatMessage[], jsonMode: boolean) {
  if (!env.GROQ_API_KEY) throw new Error("AI_PROVIDER=groq requires GROQ_API_KEY");
  const res = await fetch(`${env.GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 1200,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Groq error (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  return { content: data.choices[0]?.message?.content ?? "", usage: data.usage };
}

const ANSWER_SYSTEM = `You are a patient tutor for Adways Academy. Answer the student's doubt.
Rules:
- Use ONLY the provided course material when it is relevant; cite the chunk ids you used.
- If the course material does not cover the question, you may answer from general knowledge but set evidenceSufficient=false.
- If the question (or the image text) is unclear, incomplete, or unreadable, DO NOT guess — ask one concise clarifying question and set isClarification=true.
- Write like a tutor speaking to a student: clear, encouraging, no mention of "sources", "chunks", or system internals in the answer text.
Return STRICT JSON: {"answer": string, "isClarification": boolean, "evidenceSufficient": boolean, "confidence": number (0..1), "citationChunkIds": string[]}`;

export class GroqAIProvider implements AIProvider {
  async generateAnswer(req: AnswerRequest): Promise<AnswerResult> {
    const contextBlock = req.context.length
      ? req.context.map((c) => `[chunk:${c.chunkId}] (${c.documentTitle})\n${c.content}`).join("\n\n---\n\n")
      : "(no course material matched)";
    const imageBlock =
      req.imageText !== undefined
        ? `\n\nText extracted from the student's image (readable=${req.imageReadable !== false}):\n${req.imageText || "(nothing readable)"}`
        : "";

    const historyBlock =
      req.history && req.history.length
        ? `Earlier in this conversation (answer the latest student message in this context):\n${req.history
            .map((t) => `${t.sender === "TUTOR" ? "Tutor" : "Student"}: ${t.text}`)
            .join("\n")}\n\n`
        : "";

    const user = `${historyBlock}Student question:\n${req.question}${imageBlock}\n\nCourse material:\n${contextBlock}`;

    const { content, usage } = await chat(
      env.GROQ_TEXT_MODEL,
      [
        { role: "system", content: ANSWER_SYSTEM },
        { role: "user", content: user },
      ],
      true,
    );

    let parsed: {
      answer?: string;
      isClarification?: boolean;
      evidenceSufficient?: boolean;
      confidence?: number;
      citationChunkIds?: string[];
    };
    try {
      parsed = JSON.parse(content);
    } catch {
      logger.warn("Groq returned non-JSON; falling back to clarification");
      parsed = { answer: "Sorry, I need a moment — could you rephrase your question?", isClarification: true };
    }

    const citedIds = new Set(parsed.citationChunkIds ?? []);
    const citations = req.context
      .filter((c) => citedIds.has(c.chunkId))
      .map((c) => ({ chunkId: c.chunkId, documentId: c.documentId, score: c.score, snippet: c.content.slice(0, 200) }));

    return {
      answer: parsed.answer?.trim() || "I need a bit more detail to answer that.",
      isClarification: Boolean(parsed.isClarification),
      evidenceSufficient: Boolean(parsed.evidenceSufficient) && req.context.length > 0,
      confidence: clamp01(parsed.confidence ?? 0.5),
      citations,
      model: env.GROQ_TEXT_MODEL,
      usage: usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } : undefined,
    };
  }

  async readImage(req: VisionRequest): Promise<VisionResult> {
    const { content } = await chat(
      env.GROQ_VISION_MODEL,
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Transcribe any question or problem visible in this image as plain text (OCR). Then decide if it is readable. Return STRICT JSON: {"text": string, "readable": boolean, "description": string}. If blurry, cropped, or no question is visible, set readable=false.`,
            },
            { type: "image_url", image_url: { url: `data:${req.mimeType};base64,${req.imageBase64}` } },
          ],
        },
      ],
      true,
    );
    try {
      const p = JSON.parse(content) as { text?: string; readable?: boolean; description?: string };
      return {
        text: p.text ?? "",
        readable: Boolean(p.readable) && Boolean(p.text?.trim()),
        description: p.description ?? "",
        model: env.GROQ_VISION_MODEL,
      };
    } catch {
      return { text: "", readable: false, description: "Could not parse image.", model: env.GROQ_VISION_MODEL };
    }
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
