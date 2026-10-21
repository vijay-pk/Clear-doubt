// Normalise a student's WhatsApp number to E.164 (+<country><number>).
// Bare 10-digit numbers (optionally with a leading 0) are treated as Indian (+91).
// Returns null when the input can't be a valid phone number.
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);
  if (!hasPlus) {
    if (/^0\d{10}$/.test(digits)) digits = digits.slice(1);
    if (/^\d{10}$/.test(digits)) digits = `91${digits}`;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}
