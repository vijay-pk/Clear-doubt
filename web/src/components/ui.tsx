import type { ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; loading?: boolean }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-medium transition active:scale-[.97] disabled:opacity-50 disabled:pointer-events-none select-none";
  const variants: Record<string, string> = {
    primary: "bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-600)]",
    secondary: "border text-[var(--text)]",
    ghost: "text-[var(--color-brand)] hover:bg-black/5",
    danger: "bg-[#ff3b30] text-white hover:brightness-110",
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      style={variant === "secondary" ? { borderColor: "var(--border)", background: "var(--surface)" } : undefined}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-xl px-4 py-3 text-[15px] outline-none transition focus:ring-2 focus:ring-[var(--color-brand)]/40 ${className}`}
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
      {...props}
    />
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-xl px-4 py-3 text-[15px] outline-none transition focus:ring-2 focus:ring-[var(--color-brand)]/40 resize-none ${className}`}
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
      {...props}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl p-5 ${className}`} style={{ background: "var(--surface)", boxShadow: "var(--shadow)" }}>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium" style={{ color: "var(--text-soft)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} />;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "amber" | "green" | "red" | "blue" }) {
  const tones: Record<string, string> = {
    neutral: "bg-black/5 text-[var(--text-soft)]",
    amber: "bg-amber-500/15 text-amber-600",
    green: "bg-green-500/15 text-green-600",
    red: "bg-red-500/15 text-red-600",
    blue: "bg-blue-500/15 text-blue-600",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function EmptyState({ icon = "✦", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 text-4xl opacity-40">{icon}</div>
      <p className="text-[15px] font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm" style={{ color: "var(--text-soft)" }}>{hint}</p>}
    </div>
  );
}
