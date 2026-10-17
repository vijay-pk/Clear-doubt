import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { Button, Input, Field, Card } from "../components/ui";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { refresh } = useAuth();
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const res = await api.post<{ user: User; redirect: string }>("/auth/login", { email, password });
        refresh();
        nav(res.redirect, { replace: true });
      } else {
        await api.post("/auth/register", { email, name, password });
        toast("Account created. Check your email to verify, then sign in.", "success");
        setMode("login");
        setPassword("");
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Something went wrong", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-brand)] text-2xl font-bold text-white">A</div>
          <h1 className="text-2xl font-semibold tracking-tight">Adways Academy</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-soft)" }}>Doubt-clearing, answered by your tutors.</p>
        </div>

        <Card>
          <div className="mb-5 flex rounded-full p-1" style={{ background: "var(--surface-2)" }}>
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 rounded-full py-2 text-sm font-medium transition"
                style={mode === m ? { background: "var(--surface)", color: "var(--text)", boxShadow: "var(--shadow)" } : { color: "var(--text-soft)" }}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "register" && (
              <Field label="Full name">
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Your name" autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder={mode === "register" ? "At least 10 characters" : "Your password"} autoComplete={mode === "login" ? "current-password" : "new-password"} />
            </Field>
            <Button type="submit" loading={busy} className="w-full">{mode === "login" ? "Sign in" : "Create account"}</Button>
          </form>

          {mode === "login" && (
            <div className="mt-4 text-center text-sm">
              <Link to="/forgot-password" style={{ color: "var(--color-brand)" }}>Forgot password?</Link>
            </div>
          )}
          {mode === "register" && (
            <p className="mt-4 text-center text-xs" style={{ color: "var(--text-soft)" }}>
              Students only. Admin accounts are provisioned by Adways Academy.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
