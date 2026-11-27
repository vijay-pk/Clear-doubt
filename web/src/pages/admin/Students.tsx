import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { api, ApiError, type AccessState } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { Card, Button, Input, Field, Badge, Skeleton } from "../../components/ui";
import { PhoneInput } from "../../components/PhoneInput";

interface Student {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  studentIdNo: string | null;
  status: string;
  state: AccessState;
  accessExpiresAt: string | null;
  remainingDays: number | null;
  mustChangePassword: boolean;
  credentialEmailStatus: "PENDING" | "SENT" | "FAILED" | null;
  createdAt: string;
}

interface Stats {
  total: number; ACTIVE: number; EXPIRING_SOON: number; EXPIRED: number;
  SUSPENDED: number; DELETION_PENDING: number; DELETED: number;
}

const STATE_TONE: Record<AccessState, "green" | "amber" | "red" | "blue" | "neutral"> = {
  ACTIVE: "green", EXPIRING_SOON: "amber", EXPIRED: "red", SUSPENDED: "red", DELETION_PENDING: "neutral",
};
const stateLabel = (s: AccessState) => s.replace("_", " ").toLowerCase();
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtPhone = (e164: string | null) => {
  if (!e164) return "";
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
};
const DURATIONS = [45, 90] as const;

const EMAIL_TONE = { SENT: "green", PENDING: "amber", FAILED: "red" } as const;

export default function Students() {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"" | AccessState>("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
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
    try { await api.post(url, {}); toast(okMsg, "success"); refresh(); }
    catch (err) { toast(err instanceof ApiError ? err.message : "Action failed", "error"); }
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
          <p className="text-sm" style={{ color: "var(--text-soft)" }}>Create and manage time-limited student accounts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/admin/students/import/template" download className="rounded-full px-4 py-2 text-sm font-medium" style={{ background: "var(--surface-2)", color: "var(--text)" }}>Download CSV template</a>
          <Button variant="secondary" onClick={() => setShowImport(true)}>Bulk import</Button>
          <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Close" : "+ New student"}</Button>
        </div>
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.name}</span>
                    <Badge tone={STATE_TONE[s.state]}>{stateLabel(s.state)}</Badge>
                    {s.credentialEmailStatus && <Badge tone={EMAIL_TONE[s.credentialEmailStatus]}>email {s.credentialEmailStatus.toLowerCase()}</Badge>}
                    {s.mustChangePassword && <Badge tone="amber">password change required</Badge>}
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-soft)" }}>
                    {s.email}{s.studentIdNo ? ` · ${s.studentIdNo}` : ""}{s.phone ? ` · ${fmtPhone(s.phone)}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: "var(--text-soft)" }}>
                    Expires {fmt(s.accessExpiresAt)}
                    {s.remainingDays !== null && s.state !== "EXPIRED" && s.state !== "DELETION_PENDING" ? ` · ${Math.max(0, s.remainingDays)}d left` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                  {s.status !== "DELETION_PENDING" && <button onClick={() => action(`/admin/students/${s.id}/resend-credentials`, "Credentials re-sent.")} style={{ color: "var(--color-brand)" }}>resend</button>}
                  {s.status !== "DELETION_PENDING" && <button onClick={() => setExtendFor(s)} style={{ color: "var(--color-brand)" }}>extend</button>}
                  {s.status === "SUSPENDED" ? (
                    <button onClick={() => action(`/admin/students/${s.id}/reactivate`, "Reactivated.")} style={{ color: "var(--text-soft)" }}>reactivate</button>
                  ) : s.status !== "DELETION_PENDING" ? (
                    <button onClick={() => action(`/admin/students/${s.id}/suspend`, "Suspended.")} style={{ color: "var(--text-soft)" }}>suspend</button>
                  ) : null}
                  {s.status !== "DELETION_PENDING" && <button onClick={() => setDeleteFor(s)} className="text-red-500">delete</button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showImport && <BulkImportModal onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); refresh(); }} />}
      {extendFor && <ExtendModal student={extendFor} onClose={() => setExtendFor(null)} onDone={() => { setExtendFor(null); refresh(); }} />}
      {deleteFor && <DeleteModal student={deleteFor} onClose={() => setDeleteFor(null)} onDone={() => { setDeleteFor(null); refresh(); }} />}
    </div>
  );
}

function CreateStudent({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", studentIdNo: "", adminNotes: "" });
  const [phone, setPhone] = useState("");
  const [days, setDays] = useState<number>(45);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(() => new Date(Date.now() + days * 86400000), [days]);

  async function create() {
    setBusy(true);
    try {
      await api.post("/admin/students", {
        name: form.name, email: form.email,
        phone: phone || undefined,
        studentIdNo: form.studentIdNo || undefined,
        adminNotes: form.adminNotes || undefined,
        durationDays: days,
      });
      toast(`Student created. Credentials emailed to ${form.email}.`, "success");
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not create student", "error");
    } finally { setBusy(false); }
  }

  return (
    <Card className="mb-4">
      <div className="mb-3 font-medium">New student</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone (optional)"><PhoneInput value={phone} onChange={setPhone} /></Field>
        <Field label="Student ID (optional)"><Input value={form.studentIdNo} onChange={(e) => setForm({ ...form, studentIdNo: e.target.value })} /></Field>
        <Field label="Notes (optional)"><Input value={form.adminNotes} onChange={(e) => setForm({ ...form, adminNotes: e.target.value })} /></Field>
      </div>
      <div className="mt-3">
        <div className="mb-1 text-xs font-medium" style={{ color: "var(--text-soft)" }}>Access period</div>
        <div className="flex gap-2">
          {DURATIONS.map((d) => (
            <button key={d} onClick={() => setDays(d)} className="rounded-full px-4 py-1.5 text-sm font-medium"
              style={days === d ? { background: "var(--color-brand)", color: "#fff" } : { background: "var(--surface-2)", color: "var(--text-soft)" }}>{d} days</button>
          ))}
        </div>
        <p className="mt-2 text-xs" style={{ color: "var(--text-soft)" }}>Expires: <strong>{fmt(preview.toISOString())}</strong> · a temporary password is emailed; the student must change it on first login.</p>
      </div>
      <Button className="mt-3" loading={busy} onClick={create}>Create student</Button>
    </Card>
  );
}

// ---- Bulk import ----
interface PreviewRow {
  rowNum: number; name: string; email: string; countryCode: string;
  phone: string; phoneRaw: string; studentIdNo: string;
  durationDays: number | null; expiresAt: string | null;
  status: "valid" | "needs_duration" | "invalid" | "duplicate_in_file" | "exists";
  errors: string[];
}
const ROW_TONE: Record<PreviewRow["status"], "green" | "amber" | "red" | "neutral"> = {
  valid: "green", needs_duration: "amber", invalid: "red", duplicate_in_file: "neutral", exists: "neutral",
};

function BulkImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [defaultDays, setDefaultDays] = useState<number>(45);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ created: number; duplicates: number; failed: number; total: number } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await api.post<{ fileName: string; rows: PreviewRow[]; counts: Record<string, number> }>("/admin/students/import/parse", fd);
      setFileName(res.fileName);
      setRows(res.rows);
      setCounts(res.counts);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not read the file", "error");
    } finally { setBusy(false); }
  }

  function setRow(i: number, patch: Partial<PreviewRow>) {
    setRows((rs) => rs?.map((r, idx) => (idx === i ? recompute({ ...r, ...patch }) : r)) ?? rs);
  }
  function recompute(r: PreviewRow): PreviewRow {
    // Recompute expiry from the edited duration (client-side preview).
    if (r.durationDays && r.durationDays > 0) {
      return { ...r, expiresAt: new Date(Date.now() + r.durationDays * 86400000).toISOString(), status: r.status === "needs_duration" ? "valid" : r.status };
    }
    return r;
  }
  function applyDefaultToMissing() {
    setRows((rs) => rs?.map((r) => (r.status === "needs_duration" || (!r.durationDays && !r.expiresAt) ? recompute({ ...r, durationDays: defaultDays }) : r)) ?? rs);
  }

  const importable = rows?.filter((r) => r.status === "valid" || (r.durationDays && r.status !== "invalid" && r.status !== "exists" && r.status !== "duplicate_in_file")) ?? [];
  const blocked = rows?.some((r) => r.status === "needs_duration" && !r.durationDays) ?? false;

  async function commit() {
    if (!rows) return;
    setBusy(true);
    try {
      const payload = {
        fileName,
        defaultDurationDays: defaultDays,
        rows: rows
          .filter((r) => r.status !== "invalid" && r.status !== "exists" && r.status !== "duplicate_in_file")
          .map((r) => ({
            name: r.name, email: r.email,
            phone: r.phone || undefined,
            studentIdNo: r.studentIdNo || undefined,
            durationDays: r.durationDays ?? undefined,
          })),
      };
      const res = await api.post<{ result: { created: number; duplicates: number; failed: number; total: number } }>("/admin/students/import/commit", payload);
      setReport(res.result);
      toast(`Imported ${res.result.created} students.`, "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Import failed", "error");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Bulk import students</h2>
            <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-xl" style={{ color: "var(--text-soft)" }}>×</button>
          </div>

          {report ? (
            <div className="space-y-3">
              <p className="text-sm">Import complete.</p>
              <ul className="rounded-xl p-3 text-sm" style={{ background: "var(--surface-2)" }}>
                <li>Created: <strong>{report.created}</strong></li>
                <li>Duplicates skipped: {report.duplicates}</li>
                <li>Failed: {report.failed}</li>
                <li>Total rows: {report.total}</li>
              </ul>
              <p className="text-xs" style={{ color: "var(--text-soft)" }}>Credential emails are queued and sent in the background.</p>
              <Button className="w-full" onClick={onDone}>Done</Button>
            </div>
          ) : !rows ? (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: "var(--text-soft)" }}>
                Upload a CSV or Excel file. Columns: <code>name, email, country_code, phone, student_id, duration_days, expiry_date</code>. Only name and email are required.
              </p>
              <a href="/api/admin/students/import/template" download className="inline-block text-sm" style={{ color: "var(--color-brand)" }}>Download CSV template</a>
              <label className="block">
                <input type="file" accept=".csv,.xlsx" onChange={onFile} disabled={busy} className="block w-full text-sm" />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs">
                {counts && Object.entries(counts).map(([k, v]) => (
                  <span key={k} style={{ color: "var(--text-soft)" }}>{k}: <strong style={{ color: "var(--text)" }}>{v}</strong></span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs" style={{ color: "var(--text-soft)" }}>Assign to rows missing a duration:</span>
                {DURATIONS.map((d) => (
                  <button key={d} onClick={() => setDefaultDays(d)} className="rounded-full px-3 py-1 text-xs font-medium"
                    style={defaultDays === d ? { background: "var(--color-brand)", color: "#fff" } : { background: "var(--surface-2)", color: "var(--text-soft)" }}>{d}d</button>
                ))}
                <input type="number" min={1} max={3650} value={defaultDays} onChange={(e) => setDefaultDays(Number(e.target.value))} className="w-20 rounded-lg px-2 py-1 text-xs" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
                <Button variant="secondary" onClick={applyDefaultToMissing}>Apply to missing</Button>
              </div>

              <div className="max-h-80 overflow-auto rounded-xl" style={{ border: "1px solid var(--border)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: "var(--text-soft)" }}>
                      {["Name", "Email", "Phone", "ID", "Days", "Expiry", "Status"].map((h) => <th key={h} className="p-2 text-left font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                        <td className="p-2">{r.name}</td>
                        <td className="p-2">{r.email}</td>
                        <td className="p-2 min-w-[180px]">
                          <PhoneInput value={r.phone} onChange={(e164) => setRow(i, { phone: e164, errors: r.errors.filter((x) => !/phone/i.test(x)) })} />
                        </td>
                        <td className="p-2">{r.studentIdNo}</td>
                        <td className="p-2">
                          <input type="number" min={1} max={3650} value={r.durationDays ?? ""} onChange={(e) => setRow(i, { durationDays: e.target.value ? Number(e.target.value) : null })}
                            className="w-16 rounded-lg px-2 py-1" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }} />
                        </td>
                        <td className="p-2">{fmt(r.expiresAt)}</td>
                        <td className="p-2"><Badge tone={ROW_TONE[r.status]}>{r.status.replace("_", " ")}</Badge>{r.errors.length > 0 && <div className="text-[10px] text-red-500">{r.errors.join(", ")}</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs" style={{ color: "var(--text-soft)" }}>{importable.length} ready to import. Existing/duplicate rows are skipped automatically.</p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { setRows(null); setReport(null); }} className="flex-1">Back</Button>
                <Button loading={busy} disabled={blocked || importable.length === 0} onClick={commit} className="flex-1">Import {importable.length}</Button>
              </div>
              {blocked && <p className="text-xs text-amber-500">Some rows still need a duration — assign one before importing.</p>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ExtendModal({ student, onClose, onDone }: { student: Student; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [days, setDays] = useState(45);
  const [busy, setBusy] = useState(false);
  async function extend() {
    setBusy(true);
    try { await api.post(`/admin/students/${student.id}/extend`, { addDays: days }); toast("Access extended.", "success"); onDone(); }
    catch (err) { toast(err instanceof ApiError ? err.message : "Could not extend", "error"); }
    finally { setBusy(false); }
  }
  return (
    <Modal onClose={onClose} title={`Extend ${student.name}`}>
      <p className="text-sm" style={{ color: "var(--text-soft)" }}>Current expiry: {fmt(student.accessExpiresAt)}</p>
      <div className="my-3 flex flex-wrap gap-2">
        {[45, 90].map((d) => (
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
    try { await api.del(`/admin/students/${student.id}`); toast("Deletion started.", "info"); onDone(); }
    catch (err) { toast(err instanceof ApiError ? err.message : "Could not delete", "error"); }
    finally { setBusy(false); }
  }
  return (
    <Modal onClose={onClose} title={`Delete ${student.name}?`}>
      <p className="text-sm" style={{ color: "var(--text-soft)" }}>This permanently deletes the account and all of its data. It cannot be undone. Shared course material and other students are unaffected.</p>
      {preview && (
        <ul className="my-3 rounded-xl p-3 text-sm" style={{ background: "var(--surface-2)" }}>
          <li>Doubts: {preview.doubts}</li><li>Messages: {preview.messages}</li>
          <li>Uploaded files: {preview.attachments}</li><li>Approved answers from this student: {preview.approvedAnswers}</li>
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
