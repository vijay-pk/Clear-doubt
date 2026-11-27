import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  isValidPhoneNumber,
  type CountryCode,
} from "libphonenumber-js";

// Flag emoji from an ISO-3166 alpha-2 code (regional indicator symbols).
function flag(cc: string): string {
  return cc.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

interface CountryOpt {
  code: CountryCode;
  name: string;
  dial: string;
}

const COUNTRIES: CountryOpt[] = getCountries()
  .map((code) => ({ code, name: regionNames?.of(code) ?? code, dial: getCountryCallingCode(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Controlled international phone input. `value` is E.164 ("" when empty/invalid),
// and onChange emits E.164 while the number is valid, else "".
export function PhoneInput({
  value,
  onChange,
  defaultCountry = "IN",
  placeholder = "Phone number",
}: {
  value: string;
  onChange: (e164: string) => void;
  defaultCountry?: CountryCode;
  placeholder?: string;
}) {
  const [country, setCountry] = useState<CountryCode>(defaultCountry);
  const [national, setNational] = useState("");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  // Hydrate from an existing E.164 value once (edit case).
  useEffect(() => {
    if (hydrated.current) return;
    if (value) {
      const p = parsePhoneNumberFromString(value);
      if (p) {
        if (p.country) setCountry(p.country);
        setNational(p.nationalNumber);
      }
    }
    hydrated.current = true;
  }, [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function emit(nextCountry: CountryCode, nextNational: string) {
    const digits = nextNational.replace(/[^\d]/g, "");
    if (!digits) return onChange("");
    const p = parsePhoneNumberFromString(digits, nextCountry);
    onChange(p && isValidPhoneNumber(digits, nextCountry) ? p.number : "");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.dial.includes(q.replace(/\D/g, "")) || c.code.toLowerCase() === q);
  }, [search]);

  const valid = national.replace(/\D/g, "") ? isValidPhoneNumber(national.replace(/\D/g, ""), country) : null;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex shrink-0 items-center gap-1 rounded-xl px-3 text-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          <span className="text-base">{flag(country)}</span>
          <span>+{getCountryCallingCode(country)}</span>
          <span style={{ color: "var(--text-soft)" }}>▾</span>
        </button>
        <input
          type="tel"
          inputMode="tel"
          value={national}
          onChange={(e) => {
            setNational(e.target.value);
            emit(country, e.target.value);
          }}
          placeholder={placeholder}
          className="w-full rounded-xl px-4 py-3 text-[15px] outline-none focus:ring-2"
          style={{ background: "var(--surface-2)", border: `1px solid ${valid === false ? "#dc2626" : "var(--border)"}`, color: "var(--text)" }}
        />
      </div>
      {valid === false && <div className="mt-1 text-xs text-red-500">Enter a valid number for {country}.</div>}
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-72 overflow-y-auto rounded-xl p-2 shadow-lg" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search country or code…"
            className="mb-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          {filtered.map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => {
                setCountry(c.code);
                setOpen(false);
                setSearch("");
                emit(c.code, national);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
            >
              <span className="text-base">{flag(c.code)}</span>
              <span className="flex-1 truncate">{c.name}</span>
              <span style={{ color: "var(--text-soft)" }}>+{c.dial}</span>
            </button>
          ))}
          {filtered.length === 0 && <div className="px-2 py-2 text-sm" style={{ color: "var(--text-soft)" }}>No matches</div>}
        </div>
      )}
    </div>
  );
}
