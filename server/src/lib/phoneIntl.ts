import { parsePhoneNumberFromString } from "libphonenumber-js";

// Validate a complete phone number (E.164 or international) and return E.164,
// or null when it is not a valid number. Used for the single-field phone input
// (the SPA's country selector already produces a full international number).
export function toE164(input: string): string | null {
  const t = (input ?? "").trim();
  if (!t) return null;
  const p = parsePhoneNumberFromString(t.startsWith("+") ? t : `+${t}`);
  return p && p.isValid() ? p.number : null;
}

export interface CombineResult {
  e164: string | null;
  needsCorrection: boolean; // present but ambiguous/invalid — ask the admin to fix
}

// Combine a CSV `country_code` (e.g. "+91") + national number into E.164.
// - blank national  → no phone (optional), not an error
// - national starts with "+" → parsed directly (country code ignored)
// - country code present → "+<cc><national>"
// - neither → ambiguous: needsCorrection (never guess the country)
export function combineE164(countryCode: string | undefined, national: string): CombineResult {
  const nat = (national ?? "").trim();
  if (!nat) return { e164: null, needsCorrection: false };
  if (nat.startsWith("+")) {
    const p = parsePhoneNumberFromString(nat);
    return p && p.isValid() ? { e164: p.number, needsCorrection: false } : { e164: null, needsCorrection: true };
  }
  const ccDigits = (countryCode ?? "").replace(/\D/g, "");
  if (ccDigits) {
    const natDigits = nat.replace(/\D/g, "");
    const p = parsePhoneNumberFromString(`+${ccDigits}${natDigits}`);
    return p && p.isValid() ? { e164: p.number, needsCorrection: false } : { e164: null, needsCorrection: true };
  }
  return { e164: null, needsCorrection: true };
}
