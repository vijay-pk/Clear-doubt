import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { Card, Button, Textarea, Badge, Skeleton, EmptyState } from "../../components/ui";

interface QueueDraft {
  id: string; confidence: number; evidenceSufficient: boolean; isClarification: boolean; answerText: string | null; createdAt: string;
  doubt: { student: { name: string; email: string } };
  questionMessage: { body: string; attachments: { id: string; mimeType: string; status: string }[] };
  _count: { citations: number };
}
interface Citation { id: string; snippet: string; score: number; }
interface DraftDetail extends QueueDraft { citations: Citation[]; questionMessage: QueueDraft["questionMessage"] & { attachments: { id: string; mimeType: string; status: string; ocrText?: string | null }[] }; }

export default function Queue() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["queue"],
    queryFn: async () => (await api.get<{ drafts: QueueDraft[] }>("/admin/queue")).drafts,
    refetchInterval: 10000,
  });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Approval queue</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-soft)" }}>
        Every AI answer waits here. Nothing is sent until you approve it.
      </p>
      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : !data?.length ? (
        <EmptyState icon="🎉" title="Queue is clear" hint="No answers are waiting for review." />
      ) : (
        <div className="space-y-3">
          {data.map((d) => (
            <QueueCard key={d.id} d={d} open={selected === d.id} onToggle={() => setSelected(selected === d.id ? null : d.id)} onDone={() => { setSelected(null); qc.invalidateQueries({ queryKey: ["queue"] }); qc.invalidateQueries({ queryKey: ["stats"] }); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueCard({ d, open, onToggle, onDone }: { d: QueueDraft; open: boolean; onToggle: () => void; onDone: () => void }) {
  return (
    <Card>
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="line-clamp-2 text-[15px] font-medium">{d.questionMessage.body}</div>
            <div className="mt-1 text-xs" style={{ color: "var(--text-soft)" }}>{d.doubt.student.name} · {d.doubt.student.email}</div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {d.isClarification ? <Badge tone="blue">Clarification</Badge> : d.evidenceSufficient ? <Badge tone="green">Course-backed</Badge> : <Badge tone="amber">General</Badge>}
            <span className="text-xs" style={{ color: "var(--text-soft)" }}>conf {Math.round(d.confidence * 100)}%</span>
          </div>
        </div>
      </button>
      {open && <DraftEditor id={d.id} onDone={onDone} />}
    </Card>
  );
}

function DraftEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["draft", id],
    queryFn: async () => (await api.get<{ draft: DraftDetail }>(`/admin/drafts/${id}`)).draft,
  });
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const [detailsMode, setDetailsMode] = useState(false);
  const [detailsMsg, setDetailsMsg] = useState("");
  const answer = text ?? data?.answerText ?? "";

  async function act(kind: "approve" | "reject" | "regenerate" | "request-details") {
    if (kind === "request-details" && !detailsMsg.trim()) {
      toast("Write what details you need from the student.", "error");
      return;
    }
    setBusy(kind);
    try {
      if (kind === "approve") {
        const edited = text !== null && text !== data?.answerText ? { editedText: text } : {};
        await api.post(`/admin/drafts/${id}/approve`, edited);
        toast("Approved and sent.", "success");
      } else if (kind === "reject") {
        await api.post(`/admin/drafts/${id}/reject`, {});
        toast("Rejected.", "info");
      } else if (kind === "request-details") {
        await api.post(`/admin/drafts/${id}/request-details`, { message: detailsMsg });
        toast("Request for details sent to the student.", "success");
      } else {
        await api.post(`/admin/drafts/${id}/regenerate`, {});
        toast("Regenerating…", "info");
      }
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading || !data) return <div className="mt-4"><Skeleton className="h-32" /></div>;
  const att = data.questionMessage.attachments?.[0];
  const imgSrc = att ? `/api/doubts/attachments/${att.id}` : "";

  return (
    <div className="mt-4 space-y-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      {att && (
        <div>
          <div className="mb-1.5 text-[13px] font-medium" style={{ color: "var(--text-soft)" }}>
            Attached image {att.status === "UNREADABLE" && <Badge tone="red">Unreadable</Badge>}
          </div>
          <button
            onClick={() => setLightbox(true)}
            className="block overflow-hidden rounded-xl"
            style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}
            title="Click to enlarge"
          >
            <img src={imgSrc} alt="Student's attachment" className="max-h-56 w-auto object-contain" />
          </button>
          {att.ocrText && <p className="mt-2 rounded-lg p-2 text-sm" style={{ background: "var(--surface-2)" }}>OCR: {att.ocrText}</p>}
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[13px] font-medium" style={{ color: "var(--text-soft)" }}>AI draft (edit before sending if needed)</div>
        <Textarea rows={6} value={answer} onChange={(e) => setText(e.target.value)} />
      </div>

      {data.citations.length > 0 && (
        <div>
          <div className="mb-1.5 text-[13px] font-medium" style={{ color: "var(--text-soft)" }}>Source evidence ({data.citations.length})</div>
          <div className="space-y-1.5">
            {data.citations.map((c) => (
              <div key={c.id} className="rounded-lg p-2 text-xs" style={{ background: "var(--surface-2)" }}>
                <span className="opacity-60">score {c.score.toFixed(2)} · </span>{c.snippet}
              </div>
            ))}
          </div>
        </div>
      )}

      {detailsMode && (
        <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          <div className="mb-1.5 text-[13px] font-medium" style={{ color: "var(--text-soft)" }}>Ask the student for more details</div>
          <Textarea rows={3} value={detailsMsg} onChange={(e) => setDetailsMsg(e.target.value)} placeholder="e.g. Could you share which campaign or screenshot you mean?" />
          <div className="mt-2 flex gap-2">
            <Button onClick={() => act("request-details")} loading={busy === "request-details"}>Send request</Button>
            <Button variant="secondary" onClick={() => setDetailsMode(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => act("approve")} loading={busy === "approve"}>
          {text !== null && text !== data.answerText ? "Save & send" : "Approve & send"}
        </Button>
        {!detailsMode && (
          <Button variant="secondary" onClick={() => setDetailsMode(true)}>Request more details</Button>
        )}
        <Button variant="secondary" onClick={() => act("regenerate")} loading={busy === "regenerate"}>Regenerate</Button>
        <Button variant="danger" onClick={() => act("reject")} loading={busy === "reject"}>Reject</Button>
      </div>

      {lightbox && att && (
        <div
          onClick={() => setLightbox(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,.8)" }}
        >
          <img src={imgSrc} alt="Student's attachment" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
          <button className="absolute right-4 top-4 text-2xl text-white" aria-label="Close">×</button>
        </div>
      )}
    </div>
  );
}
