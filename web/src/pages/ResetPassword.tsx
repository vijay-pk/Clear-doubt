import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/toast";
import { Card, Input, Field, Button } from "../components/ui";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      toast("Password updated. Please sign in.", "success");
      nav("/login", { replace: true });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Reset failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-xl font-semibold">Choose a new password</h1>
        {!token ? (
          <p className="text-sm" style={{ color: "var(--text-soft)" }}>This reset link is invalid or missing a token.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="New password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="At least 10 characters" autoComplete="new-password" />
            </Field>
            <Button type="submit" loading={busy} className="w-full">Update password</Button>
          </form>
        )}
        <div className="mt-4 text-center text-sm">
          <Link to="/login" style={{ color: "var(--color-brand)" }}>Back to sign in</Link>
        </div>
      </Card>
    </div>
  );
}
