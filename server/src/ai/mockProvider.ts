import type { AIProvider, AnswerRequest, AnswerResult, VisionRequest, VisionResult } from "./types.js";

// Deterministic provider for tests and offline dev. No network.
export class MockAIProvider implements AIProvider {
  async generateAnswer(req: AnswerRequest): Promise<AnswerResult> {
    const hasEvidence = req.context.length > 0;
    const unreadable = req.imageText !== undefined && req.imageReadable === false;

    if (unreadable) {
      return {
        answer:
          "I couldn't read the image clearly. Could you retake the photo in good light, keeping the full question in frame and the text sharp?",
        isClarification: true,
        evidenceSufficient: false,
        confidence: 0.2,
        citations: [],
        model: "mock",
      };
    }

    const citations = req.context.slice(0, 3).map((c) => ({
      chunkId: c.chunkId,
      documentId: c.documentId,
      score: c.score,
      snippet: c.content.slice(0, 160),
    }));

    const base = req.imageText ? `${req.imageText}\n\n${req.question}` : req.question;
    const answer = hasEvidence
      ? `Based on the course material: ${base.slice(0, 200)} — ${req.context[0]!.content.slice(0, 200)}`
      : `Here is a general explanation for: ${base.slice(0, 200)}`;

    return {
      answer,
      isClarification: false,
      evidenceSufficient: hasEvidence,
      confidence: hasEvidence ? 0.85 : 0.5,
      citations,
      model: "mock",
    };
  }

  async readImage(req: VisionRequest): Promise<VisionResult> {
    // Deterministic: empty/tiny payloads are "unreadable".
    const readable = req.imageBase64.length > 100;
    return {
      text: readable ? "Mock OCR: solve for x in 2x + 3 = 7" : "",
      readable,
      description: readable ? "A handwritten algebra question." : "Unreadable image.",
      model: "mock-vision",
    };
  }
}
