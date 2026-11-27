import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { Button, PasswordInput, Field, Card } from "../components/ui";

// Mandatory first-login password change. A student with the temporary password
// lands here and cannot reach any student feature until this succeeds.
export default function ChangePassword() {
  const { user, refresh, logout } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const firstTime = user?.mustChangePassword;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      toast("The new passwords don't match.", "error");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      toast("Password updated.", "success");
      await qc.invalidateQueries({ queryKey: ["me"] });
      refresh();
      nav(user?.role === "STUDENT" ? "/chat" : "/admin", { replace: true });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not change the password", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-brand)] text-2xl font-bold text-white">A</div>
          <h1 className="text-2xl font-semibold tracking-tight">Create your password</h1>
          {firstTime && (
            <p className="mt-1 text-sm" style={{ color: "var(--text-soft)" }}>
              Please create your new password to continue using your student account.
            </p>
          )}
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Temporary password">
              <PasswordInput value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
            </Field>
            <Field label="New password">
              <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} placeholder="At least 10 characters, letters + numbers" autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={10} autoComplete="new-password" />
            </Field>
            <Button type="submit" loading={busy} className="w-full">Set password</Button>
          </form>
          <button onClick={() => logout()} className="mt-4 w-full text-center text-sm" style={{ color: "var(--text-soft)" }}>Sign out</button>
        </Card>
      </div>
    </div>
  );
}
