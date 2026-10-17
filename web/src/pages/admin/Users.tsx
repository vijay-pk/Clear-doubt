import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../lib/toast";
import { Card, Button, Input, Field, Badge, Skeleton } from "../../components/ui";

interface U { id: string; email: string; name: string; role: string; status: string; emailVerified: boolean; createdAt: string; }

export default function Users() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const isSuper = user?.role === "SUPER_ADMIN";
  const { data, isLoading } = useQuery({ queryKey: ["users"], queryFn: async () => (await api.get<{ users: U[] }>("/admin/users")).users });

  const [form, setForm] = useState({ name: "", email: "", password: "", role: "ADMIN" });
  const [busy, setBusy] = useState(false);

  async function createAdmin() {
    setBusy(true);
    try {
      await api.post("/admin/users", form);
      toast("Admin created.", "success");
      setForm({ name: "", email: "", password: "", role: "ADMIN" });
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Failed", "error");
    } finally { setBusy(false); }
  }

  async function suspend(u: U) {
    await api.post(`/admin/users/${u.id}/${u.status === "SUSPENDED" ? "unsuspend" : "suspend"}`, {}).catch((e) => toast(e.message, "error"));
    qc.invalidateQueries({ queryKey: ["users"] });
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--text-soft)" }}>Students self-register. Admins are provisioned here (super admin only).</p>

      {isSuper && (
        <Card className="mb-4">
          <div className="mb-3 font-medium">Add an admin</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Temp password"><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="≥10 chars" /></Field>
            <Field label="Role">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full rounded-xl px-4 py-3 text-[15px]" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}>
                <option value="ADMIN">Admin</option>
                <option value="SUPER_ADMIN">Super Admin</option>
              </select>
            </Field>
          </div>
          <Button className="mt-3" loading={busy} onClick={createAdmin}>Create admin</Button>
        </Card>
      )}

      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="space-y-2">
          {data?.map((u) => (
            <Card key={u.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs" style={{ color: "var(--text-soft)" }}>{u.email}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={u.role === "STUDENT" ? "neutral" : "blue"}>{u.role.toLowerCase()}</Badge>
                  {u.status === "SUSPENDED" && <Badge tone="red">suspended</Badge>}
                  {u.role !== "SUPER_ADMIN" && (
                    <button onClick={() => suspend(u)} className="text-xs" style={{ color: "var(--text-soft)" }}>
                      {u.status === "SUSPENDED" ? "restore" : "suspend"}
                    </button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
