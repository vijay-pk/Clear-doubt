export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
}

export interface AnswerRequest {
  question: string;
  // Combined retrieved course material (may be empty).
  context: RetrievedChunk[];
  // When the question came from an image, the extracted/OCR text (may be empty/unreadable).
  imageText?: string;
  imageReadable?: boolean;
}

export interface AnswerCitation {
  chunkId: string;
  documentId: string;
  score: number;
  snippet: string;
}

export interface AnswerResult {
  answer: string;
  isClarification: boolean; // true when the model asks the student to clarify instead of answering
  evidenceSufficient: boolean; // did course material cover this?
  confidence: number; // 0..1
  citations: AnswerCitation[];
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface VisionRequest {
  imageBase64: string;
  mimeType: string;
}

export interface VisionResult {
  text: string; // OCR + transcription of any question in the image
  readable: boolean; // false when the image is too blurry/empty to use
  description: string;
  model: string;
}

export interface AIProvider {
  generateAnswer(req: AnswerRequest): Promise<AnswerResult>;
  readImage(req: VisionRequest): Promise<VisionResult>;
}
