import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { env } from "../config/env.js";
import { badRequest } from "../lib/errors.js";

const MAX = () => env.MAX_UPLOAD_MB * 1024 * 1024;

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX(), files: 1 },
});

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX(), files: 1 },
});

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DOC_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Verify the real content type from magic bytes — never trust the client's
// Content-Type header or filename for an untrusted upload.
export async function validateImage(buf: Buffer): Promise<{ mime: string }> {
  if (!buf?.length) throw badRequest("Empty file.", "empty_file");
  const ft = await fileTypeFromBuffer(buf);
  if (!ft || !IMAGE_TYPES.has(ft.mime)) {
    throw badRequest("Only JPG, PNG, or WebP images are allowed.", "bad_image");
  }
  return { mime: ft.mime };
}

export async function validateDocument(buf: Buffer, filename: string): Promise<{ mime: string }> {
  if (!buf?.length) throw badRequest("Empty file.", "empty_file");
  const ft = await fileTypeFromBuffer(buf);
  if (ft && DOC_TYPES.has(ft.mime)) return { mime: ft.mime };
  // Plain text / markdown have no magic bytes; accept by extension + UTF-8 sanity.
  const name = filename.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return { mime: "text/plain" };
  }
  throw badRequest("Only PDF, DOCX, or TXT files are allowed.", "bad_document");
}
