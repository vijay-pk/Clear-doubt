import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type User } from "../lib/api";
import { useToast } from "../lib/toast";
import { Button, Input, PasswordInput, Field, Card } from "../components/ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<{ user: User; redirect: string }>("/auth/login", { email, password });
      // Seed the cache synchronously so the protected route sees the user
      // immediately (invalidate is async and raced the navigation → bounce).
      qc.setQueryData(["me"], { user: res.user, blocked: null });
      nav(res.redirect, { replace: true });
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
          <form onSubmit={submit} className="space-y-3">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email" />
            </Field>
            <Field label="Password">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Your password" autoComplete="current-password" />
            </Field>
            <Button type="submit" loading={busy} className="w-full">Sign in</Button>
          </form>

          <div className="mt-4 text-center text-sm">
            <Link to="/forgot-password" style={{ color: "var(--color-brand)" }}>Forgot password?</Link>
          </div>
          <p className="mt-4 text-center text-xs" style={{ color: "var(--text-soft)" }}>
            Accounts are created by Adways Academy. If you don't have one, please contact your course administrator.
          </p>
        </Card>
      </div>
    </div>
  );
}
