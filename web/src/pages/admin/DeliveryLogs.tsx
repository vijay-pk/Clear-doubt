import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Card, Badge, Skeleton, EmptyState } from "../../components/ui";

interface Log { id: string; channel: string; status: string; providerMessageId?: string | null; error?: string | null; attempts: number; createdAt: string; }
const tone: Record<string, "green" | "amber" | "red" | "neutral" | "blue"> = { SENT: "green", SENDING: "blue", PENDING: "amber", FAILED: "red", SKIPPED: "neutral" };

export default function DeliveryLogs() {
  const { data, isLoading } = useQuery({
    queryKey: ["delivery"],
    queryFn: async () => (await api.get<{ logs: Log[] }>("/admin/delivery-logs")).logs,
    refetchInterval: 8000,
  });
  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Delivery logs</h1>
      <p className="mb-5 text-sm" style={{ color: "var(--text-soft)" }}>Per-channel send history. Each channel is independent and idempotent.</p>
      {isLoading ? <Skeleton className="h-24" /> : !data?.length ? <EmptyState icon="📤" title="No deliveries yet" /> : (
        <div className="space-y-2">
          {data.map((l) => (
            <Card key={l.id}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone="blue">{l.channel}</Badge>
                  <Badge tone={tone[l.status]}>{l.status.toLowerCase()}</Badge>
                  {l.attempts > 1 && <span style={{ color: "var(--text-soft)" }}>×{l.attempts}</span>}
                </div>
                <span className="text-xs" style={{ color: "var(--text-soft)" }}>{new Date(l.createdAt).toLocaleString()}</span>
              </div>
              {l.error && <div className="mt-1 text-xs text-red-500">{l.error}</div>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
