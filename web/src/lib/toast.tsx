import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
}

const ToastCtx = createContext<(message: string, kind?: Toast["kind"]) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto max-w-sm w-full rounded-2xl px-4 py-3 text-sm font-medium shadow-lg"
            style={{
              animation: "toastIn .25s ease",
              background: t.kind === "error" ? "#ff3b30" : t.kind === "success" ? "#34c759" : "var(--surface)",
              color: t.kind === "info" ? "var(--text)" : "#fff",
              border: t.kind === "info" ? "1px solid var(--border)" : "none",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
