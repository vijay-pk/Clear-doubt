import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Card, Spinner, Button } from "../components/ui";

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("Missing verification token.");
      return;
    }
    api
      .post<{ message: string }>("/auth/verify-email", { token })
      .then((r) => {
        setState("ok");
        setMessage(r.message);
      })
      .catch((err) => {
        setState("error");
        setMessage(err instanceof ApiError ? err.message : "Verification failed.");
      });
  }, [token]);

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <Card className="w-full max-w-sm text-center">
        {state === "working" && (
          <div className="flex flex-col items-center gap-3 py-4" style={{ color: "var(--color-brand)" }}>
            <Spinner size={28} />
            <p className="text-sm" style={{ color: "var(--text-soft)" }}>Verifying your email…</p>
          </div>
        )}
        {state !== "working" && (
          <>
            <div className="mb-2 text-4xl">{state === "ok" ? "✅" : "⚠️"}</div>
            <p className="font-medium">{message}</p>
            <Link to="/login"><Button className="mt-5 w-full">Go to sign in</Button></Link>
          </>
        )}
      </Card>
    </div>
  );
}
