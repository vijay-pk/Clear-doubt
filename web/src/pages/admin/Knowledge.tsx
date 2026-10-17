import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { useDropzone } from "../../lib/useDropzone";
import { Card, Button, Input, Textarea, Field, Badge, Skeleton, EmptyState } from "../../components/ui";

interface Doc { id: string; title: string; originalName: string; status: string; createdAt: string; error?: string | null; uploadedBy: { name: string }; }
interface Approved { id: string; question: string; answer: string; active: boolean; createdAt: string; }

const docTone: Record<string, "amber" | "green" | "red" | "blue"> = { UPLOADED: "blue", PROCESSING: "amber", READY: "green", FAILED: "red" };

export default function Knowledge() {
  const [tab, setTab] = useState<"docs" | "answers">("docs");
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Knowledge</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--text-soft)" }}>Course material the AI grounds answers in, and the approved-answer memory.</p>
      <div className="mb-5 flex rounded-full p-1" style={{ background: "var(--surface-2)", width: "fit-content" }}>
        {(["docs", "answers"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className="rounded-full px-4 py-1.5 text-sm font-medium"
            style={tab === t ? { background: "var(--surface)", boxShadow: "var(--shadow)" } : { color: "var(--text-soft)" }}>
            {t === "docs" ? "Course documents" : "Approved answers"}
          </button>
        ))}
      </div>
      {tab === "docs" ? <Documents /> : <ApprovedAnswers />}
    </div>
  );
}

function Documents() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => (await api.get<{ documents: Doc[] }>("/admin/documents")).documents,
    refetchInterval: 5000,
  });

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post("/admin/documents", form);
      toast("Uploaded. Processing…", "success");
      qc.invalidateQueries({ queryKey: ["documents"] });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Upload failed", "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const { dragging, dropProps } = useDropzone(upload);

  return (
    <div>
      <Card className={`mb-4 relative transition ${dragging ? "ring-2 ring-[var(--color-brand)]" : ""}`}>
        <div {...dropProps} className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Upload course material</div>
            <div className="text-sm" style={{ color: "var(--text-soft)" }}>
              {dragging ? "Drop file to upload" : "PDF, DOCX, or TXT — click Upload or drag a file here."}
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button loading={busy} onClick={() => fileRef.current?.click()}>Upload</Button>
        </div>
      </Card>
      {isLoading ? <Skeleton className="h-20" /> : !data?.length ? <EmptyState icon="📄" title="No documents yet" /> : (
        <div className="space-y-2">
          {data.map((d) => (
            <Card key={d.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="line-clamp-1 font-medium">{d.title}</div>
                  <div className="text-xs" style={{ color: "var(--text-soft)" }}>{d.originalName} · {d.uploadedBy.name}</div>
                  {d.error && <div className="mt-1 text-xs text-red-500">{d.error}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={docTone[d.status]}>{d.status.toLowerCase()}</Badge>
                  <DeleteDoc id={d.id} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteDoc({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <button className="text-xs text-red-500" onClick={async () => { await api.del(`/admin/documents/${id}`); toast("Deleted.", "info"); qc.invalidateQueries({ queryKey: ["documents"] }); }}>confirm?</button>
  ) : (
    <button className="text-xs" style={{ color: "var(--text-soft)" }} onClick={() => setConfirm(true)}>delete</button>
  );
}

function ApprovedAnswers() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["approved"],
    queryFn: async () => (await api.get<{ answers: Approved[] }>("/admin/approved-answers")).answers,
  });

  async function add() {
    if (!q.trim() || !a.trim()) return;
    setBusy(true);
    try {
      await api.post("/admin/approved-answers", { question: q, answer: a });
      setQ(""); setA("");
      toast("Added to memory.", "success");
      qc.invalidateQueries({ queryKey: ["approved"] });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Failed", "error");
    } finally { setBusy(false); }
  }

  return (
    <div>
      <Card className="mb-4 space-y-3">
        <div className="font-medium">Add an approved answer</div>
        <Field label="Question"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Common question…" /></Field>
        <Field label="Answer"><Textarea rows={3} value={a} onChange={(e) => setA(e.target.value)} placeholder="The approved answer…" /></Field>
        <Button onClick={add} loading={busy}>Add to memory</Button>
      </Card>
      {isLoading ? <Skeleton className="h-20" /> : !data?.length ? <EmptyState icon="🧠" title="No approved answers yet" hint="Promote good answers from the queue, or add them here." /> : (
        <div className="space-y-2">
          {data.map((x) => (
            <Card key={x.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{x.question}</div>
                  <div className="mt-1 line-clamp-2 text-sm" style={{ color: "var(--text-soft)" }}>{x.answer}</div>
                </div>
                <button onClick={async () => { await api.patch(`/admin/approved-answers/${x.id}`, { active: !x.active }); qc.invalidateQueries({ queryKey: ["approved"] }); }}>
                  <Badge tone={x.active ? "green" : "neutral"}>{x.active ? "active" : "off"}</Badge>
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
