import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../lib/toast";
import { Button, Textarea, Badge, Spinner, EmptyState, Skeleton } from "../../components/ui";

interface DoubtSummary { id: string; title: string; status: string; updatedAt: string; }
interface Attachment { id: string; mimeType: string; originalName: string; status: string; }
interface Message { id: string; sender: "STUDENT" | "TUTOR" | "SYSTEM"; kind: string; body: string; createdAt: string; attachments?: Attachment[]; }
interface DoubtDetail { id: string; title: string; status: string; messages: Message[]; }

const statusTone: Record<string, "amber" | "green" | "blue" | "neutral"> = {
  OPEN: "amber", AWAITING_STUDENT: "blue", ANSWERED: "green", CLOSED: "neutral",
};
const statusLabel: Record<string, string> = {
  OPEN: "Awaiting answer", AWAITING_STUDENT: "Your turn", ANSWERED: "Answered", CLOSED: "Closed",
};

export default function Chat() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [mobileThread, setMobileThread] = useState(false);

  const { data: list, isLoading } = useQuery({
    queryKey: ["doubts"],
    queryFn: async () => (await api.get<{ doubts: DoubtSummary[] }>("/doubts")).doubts,
    refetchInterval: 8000,
  });

  useEffect(() => {
    if (selected === null && list && list.length) setSelected(list[0].id);
  }, [list, selected]);

  async function resendVerification() {
    await api.post("/auth/resend-verification", { email: user!.email }).catch(() => {});
    toast("Verification email sent.", "success");
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col">
      <header className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-brand)] text-sm font-bold text-white">A</div>
          <span className="font-semibold">Doubts</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm sm:inline" style={{ color: "var(--text-soft)" }}>{user?.name}</span>
          <Button variant="ghost" onClick={() => logout()}>Sign out</Button>
        </div>
      </header>

      {!user?.emailVerified && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
          <span>Verify your email to start asking doubts.</span>
          <button onClick={resendVerification} className="font-medium" style={{ color: "var(--color-brand)" }}>Resend link</button>
        </div>
      )}

      <div className="grid flex-1 overflow-hidden md:grid-cols-[300px_1fr]">
        {/* Doubt list */}
        <aside className={`flex-col overflow-y-auto p-3 ${mobileThread ? "hidden" : "flex"} md:flex`} style={{ borderRight: "1px solid var(--border)" }}>
          <Button className="mb-3 w-full" onClick={() => { setSelected("new"); setMobileThread(true); }}>+ New doubt</Button>
          {isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : !list?.length ? (
            <EmptyState icon="💬" title="No doubts yet" hint="Ask your first question." />
          ) : (
            list.map((d) => (
              <button
                key={d.id}
                onClick={() => { setSelected(d.id); setMobileThread(true); }}
                className="mb-1.5 rounded-xl p-3 text-left transition"
                style={{ background: selected === d.id ? "var(--surface-2)" : "transparent" }}
              >
                <div className="line-clamp-1 text-sm font-medium">{d.title}</div>
                <div className="mt-1"><Badge tone={statusTone[d.status]}>{statusLabel[d.status]}</Badge></div>
              </button>
            ))
          )}
        </aside>

        {/* Thread */}
        <section className={`flex-col overflow-hidden ${mobileThread ? "flex" : "hidden"} md:flex`}>
          {selected === "new" ? (
            <NewDoubt
              onBack={() => setMobileThread(false)}
              onCreated={(id) => { qc.invalidateQueries({ queryKey: ["doubts"] }); setSelected(id); }}
            />
          ) : selected ? (
            <Thread doubtId={selected} onBack={() => setMobileThread(false)} />
          ) : (
            <EmptyState icon="👋" title="Pick a doubt or start a new one" />
          )}
        </section>
      </div>
    </div>
  );
}

function Composer({ onSend, disabled }: { onSend: (body: string, image: File | null) => Promise<void>; disabled?: boolean }) {
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function send() {
    if (!body.trim() && !image) return;
    setBusy(true);
    try {
      await onSend(body, image);
      setBody("");
      setImage(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-3" style={{ borderTop: "1px solid var(--border)" }}>
      {image && (
        <div className="mb-2 flex items-center gap-2 text-sm" style={{ color: "var(--text-soft)" }}>
          📎 {image.name}
          <button onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }} className="text-red-500">remove</button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          title="Attach a photo"
        >📷</button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
        <Textarea
          rows={1}
          value={body}
          disabled={disabled}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type your doubt…"
          className="flex-1"
        />
        <Button onClick={send} loading={busy} disabled={disabled} className="h-11 shrink-0">Send</Button>
      </div>
    </div>
  );
}

function NewDoubt({ onCreated, onBack }: { onCreated: (id: string) => void; onBack: () => void }) {
  const toast = useToast();
  async function create(body: string, image: File | null) {
    try {
      const form = new FormData();
      form.append("body", body);
      if (image) form.append("image", image);
      const res = await api.post<{ doubt: { id: string } }>("/doubts", form);
      toast("Doubt submitted. A tutor will answer soon.", "success");
      onCreated(res.doubt.id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not submit", "error");
    }
  }
  return (
    <div className="flex h-full flex-col">
      <ThreadHeader title="New doubt" status="OPEN" onBack={onBack} />
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <EmptyState icon="✏️" title="Ask anything from your course" hint="Type a question or attach a photo of a problem." />
      </div>
      <Composer onSend={create} />
    </div>
  );
}

function Thread({ doubtId, onBack }: { doubtId: string; onBack: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["doubt", doubtId],
    queryFn: async () => (await api.get<{ doubt: DoubtDetail }>(`/doubts/${doubtId}`)).doubt,
    refetchInterval: 5000,
  });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [data?.messages.length]);

  async function send(body: string, image: File | null) {
    try {
      const form = new FormData();
      form.append("body", body);
      if (image) form.append("image", image);
      await api.post(`/doubts/${doubtId}/messages`, form);
      qc.invalidateQueries({ queryKey: ["doubt", doubtId] });
      qc.invalidateQueries({ queryKey: ["doubts"] });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not send", "error");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ThreadHeader title={data?.title ?? "…"} status={data?.status ?? "OPEN"} onBack={onBack} />
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {isLoading ? (
          <Skeleton className="h-16 w-2/3" />
        ) : (
          data?.messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
        {data?.status === "OPEN" && (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-soft)" }}>
            <Spinner size={14} /> A tutor is reviewing your doubt…
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <Composer onSend={send} />
    </div>
  );
}

function ThreadHeader({ title, status, onBack }: { title: string; status: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <button onClick={onBack} className="md:hidden" style={{ color: "var(--color-brand)" }}>‹ Back</button>
      <div className="line-clamp-1 flex-1 font-medium">{title}</div>
      <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const mine = m.sender === "STUDENT";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px]"
        style={mine ? { background: "var(--color-brand)", color: "#fff" } : { background: "var(--surface)", boxShadow: "var(--shadow)" }}
      >
        {m.attachments?.map((a) => (
          <a key={a.id} href={`/api/doubts/attachments/${a.id}`} target="_blank" rel="noreferrer" className="mb-1 block underline">
            📷 {a.originalName}
          </a>
        ))}
        {m.body}
      </div>
    </div>
  );
}
