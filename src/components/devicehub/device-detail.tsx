/**
 * DeviceHub — Device detail view (identity, telemetry charts, alerts, commands, actions).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { StatusPill, DH, timeAgo, fmtTs, fmtVal, SimulatorBadge, EmptyState, severityColor, stateColor } from "./shared";
import { useDhStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Radio, Thermometer, Wrench, RotateCcw, Activity, AlertTriangle, Terminal, Gauge, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const RULE_THRESHOLDS: Record<string, number | null> = {
  temperature: 85, vibration: 8, power: 15, voltage: 207, humidity: 25,
};

export function DeviceDetailView({ deviceId }: { deviceId: string | null }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const user = useDhStore((s) => s.user);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["device", deviceId],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${deviceId}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 6000,
    enabled: !!deviceId,
  });

  const sendCommand = useMutation({
    mutationFn: async (payload: { action: string; payload?: any }) => {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId, ...payload, source: "WEB" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    },
    onSuccess: (d) => {
      toast({ title: `Command ${d.commandId} ${d.state}`, description: d.note });
      queryClient.invalidateQueries({ queryKey: ["device", deviceId] });
      setCommandOpen(false);
    },
    onError: (e: any) => toast({ title: "Command rejected", description: e.message, variant: "destructive" }),
  });

  if (!deviceId) return <EmptyState title="No device selected" subtitle="Open a device from the Devices view" />;
  if (isLoading || !data) {
    return <div className="h-[400px] animate-pulse rounded-2xl" style={{ backgroundColor: DH.surface }} />;
  }

  const d = data.device;
  const canOperate = user?.role === "ADMIN" || user?.role === "OPERATOR";
  const metrics = Object.keys(data.telemetry || {});

  return (
    <div className="space-y-5">
      {/* Identity header */}
      <div className="rounded-2xl border p-5" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: `${DH.accent}1a`, color: DH.accent }}>
              <Radio className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[18px] font-bold" style={{ color: DH.textPrimary }}>{d.name}</h2>
                <StatusPill label={d.state} />
                {d.simulator && <SimulatorBadge />}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: DH.textSecondary }}>
                <span className="font-mono">{d.deviceId}</span>
                <span>{d.type}</span>
                <span>fw {d.firmwareVersion} · proto v{d.protocolVersion}</span>
                <span>hw {d.hardwareId || "—"}</span>
                <span>config v{d.configVersion}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]" style={{ color: DH.textSecondary }}>
                <span>Zone: {d.zone || "—"} {d.group ? `(${d.group.name})` : ""}</span>
                <span>Gateway: {d.gateway ? `${d.gateway.gatewayId} [${d.gateway.state}]` : "—"}</span>
                <span>Profile: {d.profile}</span>
                <span>Last seen: {timeAgo(d.lastSeenAt)}</span>
                <span>Registered: {fmtTs(d.registeredAt)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canOperate && (
              <>
                <Button variant="outline" size="sm" className="gap-1.5 border-slate-700 bg-transparent text-slate-300 hover:bg-slate-700/40" onClick={() => sendCommand.mutate({ action: "REBOOT" })} disabled={sendCommand.isPending}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reboot
                </Button>
                <Button size="sm" className="gap-1.5" style={{ backgroundColor: DH.accent }} onClick={() => setCommandOpen(true)}>
                  <Terminal className="h-3.5 w-3.5" /> Send Command
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <InfoTile label="Health" value={`${d.health}%`} color={d.health > 80 ? DH.success : d.health > 60 ? DH.warning : DH.danger} />
          <InfoTile label="Capabilities" value={(d.capabilities?.metrics || []).length + " metrics"} />
          <InfoTile label="Commands" value={(d.capabilities?.commands || []).join(", ")} small />
          <InfoTile label="Origin" value={d.origin} />
          <InfoTile label="Telemetry interval" value={`${d.config?.telemetryIntervalSec || "—"}s`} />
          <InfoTile label="Metrics stored" value={Object.values(data.telemetry || {}).reduce((a: number, b: any) => a + b.length, 0)} />
        </div>
      </div>

      {/* Telemetry charts */}
      {metrics.length === 0 ? (
        <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
          <EmptyState title="No telemetry recorded yet" subtitle="Waiting for the first samples from this device…" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {metrics.map((metric) => (
            <MetricChart key={metric} metric={metric} series={data.telemetry[metric]} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Connectivity history */}
        <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
          <div className="border-b px-5 py-4" style={{ borderColor: DH.border }}>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
              <Activity className="h-4 w-4" style={{ color: DH.accent }} /> Connectivity History
            </h3>
          </div>
          <div className="max-h-[280px] overflow-y-auto p-3">
            {data.events.length === 0 && <EmptyState title="No events yet" />}
            {data.events.map((e: any, i: number) => (
              <div key={i} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-700/25">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stateColor(e.type) }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium" style={{ color: DH.textPrimary }}>{e.type}</div>
                  <div className="truncate text-[10px]" style={{ color: DH.textSecondary }}>{e.detail?.reason || e.detail?.note || JSON.stringify(e.detail).slice(0, 60)}</div>
                </div>
                <span className="shrink-0 text-[10px]" style={{ color: DH.textSecondary }}>{timeAgo(e.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Active alerts */}
        <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
          <div className="border-b px-5 py-4" style={{ borderColor: DH.border }}>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
              <AlertTriangle className="h-4 w-4" style={{ color: DH.danger }} /> Alerts
            </h3>
          </div>
          <div className="max-h-[280px] overflow-y-auto p-3">
            {data.alerts.length === 0 && <EmptyState title="No alerts for this device" subtitle="Automation rules have not triggered" />}
            {data.alerts.map((a: any) => (
              <div key={a.alertId} className="mb-2 rounded-xl border p-3" style={{ borderColor: DH.border, backgroundColor: `${DH.surfaceHover}55` }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold" style={{ color: severityColor(a.severity) }}>{a.severity}</span>
                  <StatusPill label={a.state} />
                </div>
                <div className="mt-1 text-[12px]" style={{ color: DH.textPrimary }}>{a.title}</div>
                <div className="mt-0.5 text-[10px]" style={{ color: DH.textSecondary }}>{timeAgo(a.createdAt)} · evidence: threshold {a.evidence?.threshold}, held {a.evidence?.heldSec}s</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent commands */}
        <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
          <div className="border-b px-5 py-4" style={{ borderColor: DH.border }}>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
              <Terminal className="h-4 w-4" style={{ color: DH.accent }} /> Recent Commands
            </h3>
          </div>
          <div className="max-h-[280px] overflow-y-auto p-3">
            {data.commands.length === 0 && <EmptyState title="No commands sent to this device" />}
            {data.commands.map((c: any) => (
              <div key={c.commandId} className="mb-2 flex items-center justify-between gap-2 rounded-xl border p-3" style={{ borderColor: DH.border, backgroundColor: `${DH.surfaceHover}55` }}>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium" style={{ color: DH.textPrimary }}>{c.action} <span className="font-mono text-[10px]" style={{ color: DH.textSecondary }}>{c.commandId}</span></div>
                  <div className="text-[10px]" style={{ color: DH.textSecondary }}>{c.requester} · {timeAgo(c.createdAt)}{c.ackCode ? ` · ack ${c.ackCode}` : ""}</div>
                </div>
                <StatusPill label={c.state} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <CommandDialog
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        deviceId={d.deviceId}
        commands={d.capabilities?.commands || []}
        onSubmit={(action, payload) => sendCommand.mutate({ action, payload })}
        pending={sendCommand.isPending}
      />
    </div>
  );
}

function MetricChart({ metric, series }: { metric: string; series: any[] }) {
  const threshold = RULE_THRESHOLDS[metric] ?? null;
  const data = (series || []).slice(-120).map((s: any) => ({
    t: new Date(s.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    v: s.value,
    quality: s.quality,
    delayed: s.delayed,
  }));
  const unit = series?.[0]?.unit || "";
  const color = metric === "temperature" ? DH.warning : metric === "vibration" ? DH.purple : metric === "power" ? DH.cyan : DH.accent;
  const suspectCount = data.filter((d) => d.quality !== "GOOD").length;
  const delayedCount = data.filter((d) => d.delayed).length;

  return (
    <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4" style={{ borderColor: DH.border }}>
        <h3 className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: DH.textPrimary }}>
          <Thermometer className="h-4 w-4" style={{ color }} /> {metric} <span className="text-[11px] font-normal" style={{ color: DH.textSecondary }}>({unit})</span>
        </h3>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: DH.textSecondary }}>
          <span>{data.length} samples</span>
          {threshold !== null && <span style={{ color: DH.danger }}>threshold {threshold}{unit}</span>}
          {suspectCount > 0 && <span style={{ color: DH.warning }}>{suspectCount} suspect</span>}
          {delayedCount > 0 && <span style={{ color: DH.cyan }}>{delayedCount} delayed</span>}
        </div>
      </div>
      <div className="h-[200px] p-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={`g-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
            <XAxis dataKey="t" tick={{ fill: DH.textSecondary, fontSize: 9 }} axisLine={{ stroke: DH.border }} tickLine={false} minTickGap={40} />
            <YAxis tick={{ fill: DH.textSecondary, fontSize: 9 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ backgroundColor: DH.surface, border: `1px solid ${DH.border}`, borderRadius: 12, fontSize: 11, color: DH.textPrimary }}
              labelStyle={{ color: DH.textSecondary }}
              formatter={(v: any, _n: any, p: any) => [`${Number(v).toFixed(2)} ${unit}${p?.payload?.quality !== "GOOD" ? ` (${p.payload.quality})` : ""}`, metric]}
            />
            {threshold !== null && <ReferenceLine y={threshold} stroke={DH.danger} strokeDasharray="6 4" strokeWidth={1} />}
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#g-${metric})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InfoTile({ label, value, color, small }: { label: string; value: React.ReactNode; color?: string; small?: boolean }) {
  return (
    <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: DH.border, backgroundColor: `${DH.surfaceHover}55` }}>
      <div className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>{label}</div>
      <div className={`mt-0.5 ${small ? "text-[10.5px]" : "text-[13px] font-semibold"}`} style={{ color: color || DH.textPrimary }}>{value}</div>
    </div>
  );
}

function CommandDialog({
  open, onClose, deviceId, commands, onSubmit, pending,
}: {
  open: boolean; onClose: () => void; deviceId: string; commands: string[];
  onSubmit: (action: string, payload?: any) => void; pending: boolean;
}) {
  const [action, setAction] = useState(commands[0] || "REBOOT");
  const [intervalSec, setIntervalSec] = useState("10");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="border-slate-700 bg-[#151E2D] sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Wrench className="h-4 w-4" /> Send Command to {deviceId}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-400">Action (validated against device capabilities)</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                {commands.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {action === "SET_INTERVAL" && (
            <div className="space-y-1.5">
              <Label className="text-[12px] text-slate-400">Telemetry interval (seconds, 2–300)</Label>
              <Input type="number" min={2} max={300} value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} className="border-slate-700 bg-slate-800/60 text-slate-100" />
            </div>
          )}
          <div className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-3 text-[11px] leading-relaxed text-slate-500">
            The command is authorized by your role, dispatched through the edge gateway over MQTT, and its final state
            (SUCCEEDED / FAILED) reflects the device acknowledgement — never the API acceptance alone.
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-700 bg-transparent text-slate-300">Cancel</Button>
          <Button onClick={() => onSubmit(action, action === "SET_INTERVAL" ? { intervalSec: Number(intervalSec) } : {})} disabled={pending} style={{ backgroundColor: DH.accent }}>
            {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Dispatch Command
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
