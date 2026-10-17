import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Card, Input, Field, Button } from "../components/ui";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await api.post("/auth/forgot-password", { email }).catch(() => {});
    setSent(true);
    setBusy(false);
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">Reset password</h1>
        {sent ? (
          <p className="mt-2 text-sm" style={{ color: "var(--text-soft)" }}>
            If an account exists for {email}, a reset link is on its way. Check your inbox.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
            </Field>
            <Button type="submit" loading={busy} className="w-full">Send reset link</Button>
          </form>
        )}
        <div className="mt-4 text-center text-sm">
          <Link to="/login" style={{ color: "var(--color-brand)" }}>Back to sign in</Link>
        </div>
      </Card>
    </div>
  );
}
