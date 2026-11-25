import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type AccessState } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { Card, Button, Input, Field, Badge, Skeleton } from "../../components/ui";

interface Student {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  studentIdNo: string | null;
  status: string;
  state: AccessState;
  accessStartAt: string | null;
  accessExpiresAt: string | null;
  remainingDays: number | null;
  adminNotes: string | null;
  createdAt: string;
}

interface Stats {
  total: number;
  ACTIVE: number;
  EXPIRING_SOON: number;
  EXPIRED: number;
  SUSPENDED: number;
  DELETION_PENDING: number;
  DELETED: number;
}

const STATE_TONE: Record<AccessState, "green" | "amber" | "red" | "blue" | "neutral"> = {
  ACTIVE: "green",
  EXPIRING_SOON: "amber",
  EXPIRED: "red",
  SUSPENDED: "red",
  DELETION_PENDING: "neutral",
};
const stateLabel = (s: AccessState) => s.replace("_", " ").toLowerCase();
const fmt = (iso: string | null) => (iso ? `${new Date(iso).toUTCString().slice(5, 16)} UTC` : "—");

const DURATIONS = [7, 15, 30, 60, 90, 180, 365] as const;

export default function Students() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"" | AccessState>("");
  const [showCreate, setShowCreate] = useState(false);
  const [extendFor, setExtendFor] = useState<Student | null>(null);
  const [deleteFor, setDeleteFor] = useState<Student | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["student-stats"],
    queryFn: async () => (await api.get<{ stats: Stats }>("/admin/students/stats")).stats,
  });
  const { data: students, isLoading } = useQuery({
    queryKey: ["students", search, filter],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set("search", search.trim());
      if (filter) qs.set("state", filter);
      const q = qs.toString();
      return (await api.get<{ students: Student[] }>(`/admin/students${q ? `?${q}` : ""}`)).students;
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["students"] });
    qc.invalidateQueries({ queryKey: ["student-stats"] });
  };

  async function action(url: string, okMsg: string) {
    try {
      await api.post(url, {});
      toast(okMsg, "success");
      refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Action failed", "error");
    }
  }

  const statCards: Array<[string, number | undefined, string]> = [
    ["Total", stats?.total, "var(--text)"],
    ["Active", stats?.ACTIVE, "#16a34a"],
    ["Expiring", stats?.EXPIRING_SOON, "#d97706"],
    ["Expired", stats?.EXPIRED, "#dc2626"],
    ["Suspended", stats?.SUSPENDED, "#dc2626"],
    ["Deleting", stats?.DELETION_PENDING, "var(--text-soft)"],
    ["Deleted", stats?.DELETED, "var(--text-soft)"],
  ];

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
          <p className="text-sm" style={{ color: "var(--text-soft)" }}>Create and manage time-limited student accounts.</p>
        </div>
        <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Close" : "+ New student"}</Button>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-7">
        {statCards.map(([label, value, color]) => (
          <Card key={label} className="!p-3 text-center">
            <div className="text-xl font-semibold" style={{ color }}>{value ?? "—"}</div>
            <div className="text-[11px]" style={{ color: "var(--text-soft)" }}>{label}</div>
          </Card>
        ))}
      </div>

      {showCreate && <CreateStudent onDone={() => { setShowCreate(false); refresh(); }} />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, ID…" className="max-w-xs" />
        <div className="flex flex-wrap rounded-full p-1" style={{ background: "var(--surface-2)" }}>
          {([["", "All"], ["ACTIVE", "Active"], ["EXPIRING_SOON", "Expiring"], ["EXPIRED", "Expired"], ["SUSPENDED", "Suspended"], ["DELETION_PENDING", "Deleting"]] as const).map(([val, label]) => (
            <button key={val} onClick={() => setFilter(val)} className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={filter === val ? { background: "var(--surface)", boxShadow: "var(--shadow)" } : { color: "var(--text-soft)" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !students?.length ? (
        <p className="py-10 text-center text-sm" style={{ color: "var(--text-soft)" }}>No students found.</p>
      ) : (
        <div className="space-y-2">
          {students.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge tone={STATE_TONE[s.state]}>{stateLabel(s.state)}</Badge>
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-soft)" }}>
                    {s.email}{s.studentIdNo ? ` · ${s.studentIdNo}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: "var(--text-soft)" }}>
                    Expires {fmt(s.accessExpiresAt)}
                    {s.remainingDays !== null && s.state !== "EXPIRED" && s.state !== "DELETION_PENDING" ? ` · ${Math.max(0, s.remainingDays)}d left` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                  {s.status !== "DELETION_PENDING" && (
                    <button onClick={() => setExtendFor(s)} style={{ color: "var(--color-brand)" }}>extend</button>
                  )}
                  {s.status === "SUSPENDED" ? (
                    <button onClick={() => action(`/admin/students/${s.id}/reactivate`, "Reactivated.")} style={{ color: "var(--text-soft)" }}>reactivate</button>
                  ) : s.status !== "DELETION_PENDING" ? (
                    <button onClick={() => action(`/admin/students/${s.id}/suspend`, "Suspended.")} style={{ color: "var(--text-soft)" }}>suspend</button>
                  ) : null}
                  {s.status !== "DELETION_PENDING" && (
                    <button onClick={() => setDeleteFor(s)} className="text-red-500">delete</button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {extendFor && <ExtendModal student={extendFor} onClose={() => setExtendFor(null)} onDone={() => { setExtendFor(null); refresh(); }} />}
      {deleteFor && <DeleteModal student={deleteFor} onClose={() => setDeleteFor(null)} onDone={() => { setDeleteFor(null); refresh(); }} />}
    </div>
  );
}

function CreateStudent({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", studentIdNo: "", adminNotes: "" });
  const [mode, setMode] = useState<"days" | "date">("days");
  const [days, setDays] = useState<number>(30);
  const [customDate, setCustomDate] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    if (mode === "days") return new Date(Date.now() + days * 86400000);
    const d = customDate ? new Date(customDate) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }, [mode, days, customDate]);

  async function create() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        studentIdNo: form.studentIdNo || undefined,
        adminNotes: form.adminNotes || undefined,
      };
      if (mode === "days") body.durationDays = days;
      else body.customExpiresAt = customDate ? new Date(customDate).toISOString() : undefined;
      await api.post("/admin/students", body);
      toast("Student created.", "success");
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not create student", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      <div className="mb-3 font-medium">New student</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Temp password"><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="≥10 chars, letters + numbers" /></Field>
        <Field label="WhatsApp (optional)"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" /></Field>
        <Field label="Student ID (optional)"><Input value={form.studentIdNo} onChange={(e) => setForm({ ...form, studentIdNo: e.target.value })} /></Field>
        <Field label="Notes (optional)"><Input value={form.adminNotes} onChange={(e) => setForm({ ...form, adminNotes: e.target.value })} /></Field>
      </div>

      <div className="mt-3">
        <div className="mb-2 flex gap-2 text-xs">
          <button onClick={() => setMode("days")} className="rounded-full px-3 py-1" style={mode === "days" ? { background: "var(--surface-2)" } : { color: "var(--text-soft)" }}>Duration</button>
          <button onClick={() => setMode("date")} className="rounded-full px-3 py-1" style={mode === "date" ? { background: "var(--surface-2)" } : { color: "var(--text-soft)" }}>Exact expiry</button>
        </div>
        {mode === "days" ? (
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={days === d ? { background: "var(--color-brand)", color: "#fff" } : { background: "var(--surface-2)", color: "var(--text-soft)" }}>
                {d}d
              </button>
            ))}
            <input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-24 rounded-xl px-3 py-1.5 text-sm" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
          </div>
        ) : (
          <input type="datetime-local" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
        )}
        <p className="mt-2 text-xs" style={{ color: "var(--text-soft)" }}>
          Expiry: <strong>{preview ? fmt(preview.toISOString()) : "—"}</strong>
        </p>
      </div>

      <Button className="mt-3" loading={busy} onClick={create}>Create student</Button>
    </Card>
  );
}

function ExtendModal({ student, onClose, onDone }: { student: Student; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  async function extend() {
    setBusy(true);
    try {
      await api.post(`/admin/students/${student.id}/extend`, { addDays: days });
      toast("Access extended.", "success");
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not extend", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal onClose={onClose} title={`Extend ${student.name}`}>
      <p className="text-sm" style={{ color: "var(--text-soft)" }}>Current expiry: {fmt(student.accessExpiresAt)}</p>
      <div className="my-3 flex flex-wrap gap-2">
        {[7, 15, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)} className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={days === d ? { background: "var(--color-brand)", color: "#fff" } : { background: "var(--surface-2)", color: "var(--text-soft)" }}>+{d}d</button>
        ))}
        <input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-24 rounded-xl px-3 py-1.5 text-sm" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
      </div>
      <Button loading={busy} onClick={extend} className="w-full">Add {days} days</Button>
    </Modal>
  );
}

function DeleteModal({ student, onClose, onDone }: { student: Student; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data: preview } = useQuery({
    queryKey: ["deletion-preview", student.id],
    queryFn: async () => (await api.get<{ preview: { doubts: number; messages: number; attachments: number; approvedAnswers: number } }>(`/admin/students/${student.id}/deletion-preview`)).preview,
  });
  async function del() {
    setBusy(true);
    try {
      await api.del(`/admin/students/${student.id}`);
      toast("Deletion started. All data for this student will be permanently removed.", "info");
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal onClose={onClose} title={`Delete ${student.name}?`}>
      <p className="text-sm" style={{ color: "var(--text-soft)" }}>
        This permanently deletes the account and all of its data. It cannot be undone. Shared course material and other students are unaffected.
      </p>
      {preview && (
        <ul className="my-3 rounded-xl p-3 text-sm" style={{ background: "var(--surface-2)" }}>
          <li>Doubts: {preview.doubts}</li>
          <li>Messages: {preview.messages}</li>
          <li>Uploaded files: {preview.attachments}</li>
          <li>Approved answers from this student: {preview.approvedAnswers}</li>
        </ul>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button loading={busy} onClick={del} className="flex-1 !bg-red-600 !text-white">Delete permanently</Button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-xl" style={{ color: "var(--text-soft)" }}>×</button>
          </div>
          {children}
        </Card>
      </div>
    </div>
  );
}
