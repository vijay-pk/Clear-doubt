import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Card, Skeleton, EmptyState } from "../../components/ui";

interface Log { id: string; action: string; entityType?: string | null; entityId?: string | null; createdAt: string; actor?: { name: string; role: string } | null; }

export default function Audit() {
  const { data, isLoading } = useQuery({ queryKey: ["audit"], queryFn: async () => (await api.get<{ logs: Log[] }>("/admin/audit")).logs });
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--text-soft)" }}>Every decision and action, time-stamped.</p>
      {isLoading ? <Skeleton className="h-40" /> : !data?.length ? <EmptyState icon="🧾" title="No activity yet" /> : (
        <Card>
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {data.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <span className="font-medium">{l.action}</span>
                  {l.entityType && <span style={{ color: "var(--text-soft)" }}> · {l.entityType}</span>}
                  <div className="text-xs" style={{ color: "var(--text-soft)" }}>{l.actor ? `${l.actor.name} (${l.actor.role})` : "system"}</div>
                </div>
                <span className="shrink-0 text-xs" style={{ color: "var(--text-soft)" }}>{new Date(l.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
