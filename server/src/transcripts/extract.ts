import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";
import { badRequest } from "../lib/errors.js";

// Extract plain text from an uploaded course document (untrusted bytes).
export async function extractText(bytes: Buffer, mimeType: string, filename: string): Promise<string> {
  const name = filename.toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) {
    const { text } = await extractPdfText(new Uint8Array(bytes), { mergePages: true });
    return typeof text === "string" ? text : (text as string[]).join("\n");
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return value;
  }
  if (mimeType.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return bytes.toString("utf8");
  }
  throw badRequest(`Unsupported document type: ${mimeType || filename}`, "unsupported_type");
}
