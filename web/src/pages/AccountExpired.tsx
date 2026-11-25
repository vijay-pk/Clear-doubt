import { useAuth } from "../lib/auth";
import { Button, Card } from "../components/ui";

const COPY: Record<string, { title: string; body: string }> = {
  account_expired: {
    title: "Your access has expired",
    body: "Your access period has ended. Please contact your course administrator if you need additional access.",
  },
  account_suspended: {
    title: "Account suspended",
    body: "This account has been suspended. Please contact your course administrator.",
  },
  account_closing: {
    title: "Account closing",
    body: "This account is being closed. Please contact your course administrator.",
  },
};

export default function AccountExpired() {
  const { blocked, logout } = useAuth();
  const copy = COPY[blocked ?? "account_expired"] ?? COPY.account_expired;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl" style={{ background: "var(--surface-2)" }}>⏳</div>
        <Card>
          <h1 className="mb-2 text-xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-sm" style={{ color: "var(--text-soft)" }}>{copy.body}</p>
          <Button variant="secondary" className="mt-5 w-full" onClick={() => logout()}>Back to sign in</Button>
        </Card>
      </div>
    </div>
  );
}
