// Formats a tutor answer for WhatsApp: includes the student's question (so a
// student with many doubts can tell which one is answered) and converts
// Markdown to WhatsApp's own formatting (*bold*, _italic_, ~strike~).

const QUESTION_MAX = 600;
const MESSAGE_MAX = 4096;

export function markdownToWhatsApp(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/```[a-zA-Z0-9]*\n?/g, "```") // keep code blocks, drop language tags
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*") // headings → bold line
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // **bold** → *bold*
    .replace(/__(.+?)__/g, "*$1*") // __bold__ → *bold*
    .replace(/~~(.+?)~~/g, "~$1~") // ~~strike~~ → ~strike~
    .replace(/^(\s*)[-*]\s+/gm, "$1• ") // bullet lists
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)") // [text](url)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function oneLine(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function formatWhatsAppAnswer(opts: { question: string; answer: string; isClarification?: boolean }): string {
  const question = oneLine(opts.question, QUESTION_MAX) || "Your doubt";
  const heading = opts.isClarification ? "*Your tutor needs a little more detail*" : "*Your doubt has been answered*";
  const label = opts.isClarification ? "*Tutor's question:*" : "*Answer:*";
  const head = `${heading}\n\n*Your question:*\n${question}\n\n${label}\n`;
  const body = markdownToWhatsApp(opts.answer);
  const room = MESSAGE_MAX - head.length;
  const answer = body.length > room ? `${body.slice(0, room - 1).trimEnd()}…` : body;
  return head + answer;
}
