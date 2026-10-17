import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Card, Skeleton } from "../../components/ui";

interface Stats { pending: number; answeredToday: number; students: number; documents: number; approved: number; aiCostToday: number; aiBudget: number; }

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: async () => (await api.get<{ stats: Stats }>("/admin/stats")).stats,
    refetchInterval: 15000,
  });

  const tiles = [
    { label: "Pending approval", value: data?.pending, to: "/admin/queue", accent: true },
    { label: "Answered today", value: data?.answeredToday },
    { label: "Students", value: data?.students },
    { label: "Course documents", value: data?.documents, to: "/admin/knowledge" },
    { label: "Approved answers", value: data?.approved, to: "/admin/knowledge" },
    { label: "AI cost today", value: data ? `$${data.aiCostToday.toFixed(3)} / $${data.aiBudget}` : undefined },
  ];

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-soft)" }}>Everything at a glance.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((t) => {
          const inner = (
            <Card className={t.accent && (data?.pending ?? 0) > 0 ? "ring-2 ring-[var(--color-brand)]" : ""}>
              <div className="text-sm" style={{ color: "var(--text-soft)" }}>{t.label}</div>
              {isLoading ? <Skeleton className="mt-2 h-8 w-16" /> : <div className="mt-1 text-3xl font-semibold tracking-tight">{t.value ?? "—"}</div>}
            </Card>
          );
          return t.to ? <Link key={t.label} to={t.to}>{inner}</Link> : <div key={t.label}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
