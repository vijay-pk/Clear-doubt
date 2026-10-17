import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useToast } from "../../lib/toast";
import { useAuth } from "../../lib/auth";
import { Card, Button, Badge, Skeleton } from "../../components/ui";

type Mode = "A" | "B" | "C";
interface Settings {
  replyMode: Mode; autoReplyPaused: boolean; autoReplyMinConfidence: number;
  autoReplyRequireEvidence: boolean; autoReplyImagesAllowed: boolean; defaultDeliveryChannels: string[];
}
interface Integrations {
  aiProvider: string; embeddingProvider: string; emailProvider: string; emailConfigured: boolean;
  whatsappEnabled: boolean; whatsappConfigured: boolean; storageProvider: string;
}

const modes: { id: Mode; title: string; desc: string }[] = [
  { id: "A", title: "Manual", desc: "Every answer is reviewed and approved by a human before sending. (Default, safest.)" },
  { id: "B", title: "Supervised", desc: "Auto-sends only when a strong, previously-approved answer matches. Everything else is reviewed." },
  { id: "C", title: "Controlled Auto-Reply", desc: "Auto-sends AI answers that meet strict eligibility (confidence + course evidence). Opt-in." },
];

export default function Settings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => await api.get<{ settings: Settings; integrations: Integrations }>("/admin/settings"),
  });

  async function patch(body: Partial<Settings>) {
    try {
      await api.put("/admin/settings", body);
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast("Settings saved.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Save failed", "error");
    }
  }

  async function togglePause(paused: boolean) {
    await api.post("/admin/settings/pause", { paused }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast(paused ? "Auto-replies paused." : "Auto-replies resumed.", paused ? "error" : "success");
  }

  if (isLoading || !data) return <Skeleton className="h-64" />;
  const s = data.settings;
  const i = data.integrations;

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      {/* Emergency pause */}
      <Card className={s.autoReplyPaused ? "ring-2 ring-red-500" : ""}>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Emergency pause</div>
            <div className="text-sm" style={{ color: "var(--text-soft)" }}>Instantly stop all automatic replies. Manual approvals still work.</div>
          </div>
          <Button variant={s.autoReplyPaused ? "primary" : "danger"} onClick={() => togglePause(!s.autoReplyPaused)}>
            {s.autoReplyPaused ? "Resume" : "Pause now"}
          </Button>
        </div>
      </Card>

      {/* Reply mode */}
      <Card>
        <div className="mb-3 font-medium">Reply mode</div>
        <div className="space-y-2">
          {modes.map((m) => (
            <button key={m.id} onClick={() => patch({ replyMode: m.id })} className="flex w-full items-start gap-3 rounded-xl p-3 text-left transition"
              style={{ background: s.replyMode === m.id ? "var(--surface-2)" : "transparent", border: s.replyMode === m.id ? "1px solid var(--color-brand)" : "1px solid var(--border)" }}>
              <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full" style={{ border: "2px solid var(--color-brand)", background: s.replyMode === m.id ? "var(--color-brand)" : "transparent" }} />
              <div>
                <div className="text-sm font-medium">{m.title} {m.id === "A" && <Badge>default</Badge>}</div>
                <div className="text-sm" style={{ color: "var(--text-soft)" }}>{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Auto-reply eligibility */}
      <Card>
        <div className="mb-3 font-medium">Auto-reply eligibility (modes B & C)</div>
        <Row label="Minimum confidence">
          <input type="range" min={0.5} max={0.95} step={0.05} value={s.autoReplyMinConfidence}
            onChange={(e) => patch({ autoReplyMinConfidence: Number(e.target.value) })} />
          <span className="w-10 text-right text-sm">{Math.round(s.autoReplyMinConfidence * 100)}%</span>
        </Row>
        <Toggle label="Require course evidence" value={s.autoReplyRequireEvidence} onChange={(v) => patch({ autoReplyRequireEvidence: v })} />
        <Toggle label="Allow auto-reply to photo doubts" value={s.autoReplyImagesAllowed} onChange={(v) => patch({ autoReplyImagesAllowed: v })} />
      </Card>

      {/* Channels */}
      <Card>
        <div className="mb-3 font-medium">Default delivery channels</div>
        {(["WEBSITE", "EMAIL", "WHATSAPP"] as const).map((ch) => {
          const on = s.defaultDeliveryChannels.includes(ch);
          const disabled = ch === "WHATSAPP" && !i.whatsappConfigured;
          return (
            <Toggle key={ch} label={ch[0] + ch.slice(1).toLowerCase() + (disabled ? " (configure first)" : "")} value={on} disabled={disabled}
              onChange={(v) => patch({ defaultDeliveryChannels: v ? [...s.defaultDeliveryChannels, ch] : s.defaultDeliveryChannels.filter((c) => c !== ch) })} />
          );
        })}
      </Card>

      {/* WhatsApp sending backend */}
      <WhatsAppCard />

      {/* Integration status (no secrets shown) */}
      <Card>
        <div className="mb-3 font-medium">Integrations</div>
        <IntRow label="AI provider" value={i.aiProvider} ok={i.aiProvider !== "mock"} />
        <IntRow label="Embeddings" value={i.embeddingProvider} ok={i.embeddingProvider !== "mock" && i.embeddingProvider !== "none"} />
        <IntRow label="Email" value={i.emailProvider} ok={i.emailConfigured} />
        <IntRow label="WhatsApp Cloud API" value={i.whatsappConfigured ? "configured" : i.whatsappEnabled ? "enabled, not configured" : "off"} ok={i.whatsappConfigured} />
        <IntRow label="Storage" value={i.storageProvider} ok />
        <p className="mt-3 text-xs" style={{ color: "var(--text-soft)" }}>Secrets (API keys, tokens) are stored server-side and never shown here.</p>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-3 py-2"><span className="flex-1 text-sm">{label}</span>{children}</div>;
}
function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Row label={label}>
      <button disabled={disabled} onClick={() => onChange(!value)} className="relative h-7 w-12 rounded-full transition disabled:opacity-40"
        style={{ background: value ? "var(--color-brand)" : "var(--border)" }}>
        <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all" style={{ left: value ? "22px" : "2px" }} />
      </button>
    </Row>
  );
}
function IntRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span>{label}</span><Badge tone={ok ? "green" : "amber"}>{value}</Badge></div>;
}

interface WaStatus {
  provider: "none" | "cloud" | "web";
  whatsappWebRiskAck: boolean;
  cloudConfigured: boolean;
  web: { state: string; detail?: string; qr: string | null; botId: string | null };
}

function WhatsAppCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const isSuper = user?.role === "SUPER_ADMIN";
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["wa-status"],
    queryFn: async () => await api.get<WaStatus>("/admin/whatsapp/status"),
    refetchInterval: (q) => {
      const s = (q.state.data as WaStatus | undefined)?.web.state;
      return s === "connecting" || s === "qr" ? 2500 : 15000;
    },
  });

  async function call(path: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      await api.post(`/admin/whatsapp/${path}`, body);
      qc.invalidateQueries({ queryKey: ["wa-status"] });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Failed", "error");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading || !data) return <Card><Skeleton className="h-24" /></Card>;
  const web = data.web;

  return (
    <Card>
      <div className="mb-3 font-medium">WhatsApp delivery</div>
      <Row label="Sending backend">
        <select
          value={data.provider}
          disabled={!isSuper || busy !== null}
          onChange={(e) => call("provider", { provider: e.target.value }, "provider")}
          className="rounded-xl px-3 py-2 text-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          <option value="none">Off</option>
          <option value="cloud">Official Cloud API</option>
          <option value="web">WhatsApp Web (QR)</option>
        </select>
      </Row>

      {data.provider === "cloud" && (
        <IntRow label="Cloud API" value={data.cloudConfigured ? "configured" : "set keys in env"} ok={data.cloudConfigured} />
      )}

      {data.provider === "web" && (
        <div className="mt-2 space-y-3">
          <p className="rounded-lg p-2 text-xs" style={{ background: "var(--surface-2)", color: "var(--text-soft)" }}>
            Unofficial automation. May violate WhatsApp's terms and can get the number banned — use a dedicated number. Needs an always-on host; on a sleeping/free host the link drops.
          </p>
          <Toggle label="I acknowledge the risk" value={data.whatsappWebRiskAck} disabled={!isSuper || busy !== null}
            onChange={(v) => call("ack-risk", { ack: v }, "ack")} />

          <IntRow label="Connection" value={web.state} ok={web.state === "connected"} />
          {web.detail && <p className="text-xs" style={{ color: "var(--text-soft)" }}>{web.detail}</p>}

          {web.qr && (
            <div className="flex flex-col items-center gap-2 rounded-xl p-3" style={{ background: "#fff" }}>
              <img src={web.qr} alt="WhatsApp QR" width={220} height={220} />
              <span className="text-xs text-black">WhatsApp → Linked devices → Link a device</span>
            </div>
          )}

          {isSuper && (
            <div className="flex gap-2">
              {web.state !== "connected" && (
                <Button loading={busy === "connect"} disabled={!data.whatsappWebRiskAck} onClick={() => call("web/connect", {}, "connect")}>
                  {web.state === "qr" || web.state === "connecting" ? "Refresh" : "Connect / show QR"}
                </Button>
              )}
              {(web.state === "connected" || web.state === "qr" || web.state === "connecting") && (
                <Button variant="danger" loading={busy === "logout"} onClick={() => call("web/logout", {}, "logout")}>Log out</Button>
              )}
            </div>
          )}
        </div>
      )}
      {!isSuper && <p className="mt-2 text-xs" style={{ color: "var(--text-soft)" }}>Only a super admin can change the WhatsApp backend.</p>}
    </Card>
  );
}
