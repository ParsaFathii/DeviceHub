/**
 * DeviceHub — Settings view (users & roles, simulator control, services health).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatCard, StatusPill, DH, EmptyState, stateColor, SimulatorBadge, rgba, fmtInt } from "./shared";
import { useDhStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Sliders, Server, ShieldCheck, Loader2, Play, Pause, RotateCcw, Copy, Bug, Timer, Repeat } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function SettingsView() {
  const user = useDhStore((s) => s.user);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [injectDevice, setInjectDevice] = useState("");
  const [injectAction, setInjectAction] = useState("duplicate-last");

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: user?.role === "ADMIN",
  });

  const { data: simData } = useQuery({
    queryKey: ["simulator"],
    queryFn: async () => {
      const res = await fetch("/api/simulator/status");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: sysData } = useQuery({
    queryKey: ["system-status"],
    queryFn: async () => {
      const res = await fetch("/api/system/status");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const fleetAction = useMutation({
    mutationFn: async (action: string) => {
      const res = await fetch("/api/simulator/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: `fleet-${action}` }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    },
    onSuccess: (d, action) => {
      toast({ title: `Fleet ${action}`, description: action === "restart" ? "Deterministic reset — all seeds reset, sequence counters at zero (reproducible replay)" : `Fleet ${action}d` });
      queryClient.invalidateQueries({ queryKey: ["simulator"] });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const deviceInject = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/simulator/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: injectDevice, action: injectAction }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    },
    onSuccess: (d) => {
      const label = injectAction === "duplicate-last" ? "duplicate telemetry message injected (same msgId — tests gateway dedup)" :
        injectAction === "delayed" ? "delayed sample injected (source timestamp 3 minutes in the past)" :
        injectAction === "pause" ? "device paused (status MAINTENANCE)" : "device resumed";
      toast({ title: "Injection sent", description: label });
    },
    onError: (e: any) => toast({ title: "Injection failed", description: e.message, variant: "destructive" }),
  });

  const canOperate = user?.role === "ADMIN" || user?.role === "OPERATOR";
  const simFleet = simData?.fleet || [];

  return (
    <div className="space-y-5">
      {/* Services health */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Server className="h-5 w-5" />} label="MQTT Broker" value={sysData?.mqttBroker?.status === "up" ? "UP" : (sysData?.mqttBroker?.status || "…")} trend="aedes · port 1883" trendUp={sysData?.mqttBroker?.status === "up"} iconColor={DH.cyan} />
        <StatCard icon={<Server className="h-5 w-5" />} label="Edge Gateway" value={sysData?.gateway?.status === "up" ? "UP" : (sysData?.gateway?.status || "…")} trend={`port 3011 · ${sysData?.gateway?.latencyMs ?? "—"}ms`} trendUp={sysData?.gateway?.status === "up"} iconColor={sysData?.gateway?.status === "up" ? DH.success : DH.danger} />
        <StatCard icon={<Server className="h-5 w-5" />} label="Analytics (Python)" value={sysData?.analytics?.status === "up" ? "UP" : (sysData?.analytics?.status || "…")} trend="FastAPI · port 3014" trendUp={sysData?.analytics?.status === "up"} iconColor={DH.purple} />
        <StatCard icon={<Server className="h-5 w-5" />} label="Database" value={sysData?.database?.status === "up" ? "UP" : (sysData?.database?.status || "…")} trend={`${fmtInt(sysData?.database?.samples ?? 0)} samples stored`} trendNeutral iconColor={DH.success} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Users & roles (ADMIN) */}
        <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.borderSoft, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
          <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: DH.borderFaint }}>
            <h3 className="flex items-center gap-2.5 text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: rgba(DH.accent, 0.12), border: `1px solid ${rgba(DH.accent, 0.2)}`, color: DH.accent }}>
                <Users className="h-4 w-4" />
              </span>
              Users & Roles
            </h3>
            {user?.role !== "ADMIN" && <span className="text-[10px]" style={{ color: DH.textSecondary }}>ADMIN only</span>}
          </div>
          <div className="p-4">
            {user?.role === "ADMIN" ? (
              usersData?.users?.map((u: any) => (
                <div key={u.id} className="mb-2 flex items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: DH.borderFaint, backgroundColor: rgba(DH.surfaceHover, 0.4) }}>
                  <div>
                    <div className="text-[13px] font-semibold" style={{ color: DH.textPrimary }}>{u.name}</div>
                    <div className="text-[10.5px] tabular-nums" style={{ color: DH.textSecondary }}>@{u.username} · {u.commandsIssued} commands · {u.auditEvents} audit events</div>
                  </div>
                  <StatusPill label={u.role} color={u.role === "ADMIN" ? DH.danger : u.role === "OPERATOR" ? DH.warning : DH.accent} />
                </div>
              )) || <EmptyState title="No users" />
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <ShieldCheck className="h-6 w-6" style={{ color: DH.textSecondary, opacity: 0.5 }} />
                <div className="text-[12px]" style={{ color: DH.textSecondary }}>
                  User management requires the ADMIN role. You are signed in as <span className="font-semibold" style={{ color: DH.textPrimary }}>{user?.role}</span>.
                </div>
              </div>
            )}
            <div className="mt-3 rounded-xl border p-3 text-[10.5px] leading-relaxed" style={{ borderColor: DH.border, color: DH.textSecondary }}>
              <span className="font-semibold">Role model (enforced server-side):</span> ADMIN — full administration ·
              OPERATOR — inspection, commands, rule management · VIEWER — read-only. The frontend never enforces permissions alone.
            </div>
          </div>
        </div>

        {/* Simulator control */}
        <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.borderSoft, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
          <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: DH.borderFaint }}>
            <h3 className="flex items-center gap-2.5 text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: rgba(DH.purple, 0.12), border: `1px solid ${rgba(DH.purple, 0.2)}`, color: DH.purple }}>
                <Sliders className="h-4 w-4" />
              </span>
              Simulator Control
              <SimulatorBadge />
            </h3>
            {canOperate && (
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 gap-1 border-slate-600 bg-transparent text-[11px] text-slate-300" onClick={() => fleetAction.mutate("pause")} disabled={fleetAction.isPending}>
                  <Pause className="h-3 w-3" /> Pause
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 border-slate-600 bg-transparent text-[11px] text-slate-300" onClick={() => fleetAction.mutate("resume")} disabled={fleetAction.isPending}>
                  <Play className="h-3 w-3" /> Resume
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 border-slate-600 bg-transparent text-[11px] text-slate-300" onClick={() => fleetAction.mutate("restart")} disabled={fleetAction.isPending}>
                  {fleetAction.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Deterministic Reset
                </Button>
              </div>
            )}
          </div>
          <div className="p-4">
            {/* failure injection */}
            {canOperate && (
              <div className="mb-4 rounded-xl border p-3" style={{ borderColor: rgba(DH.purple, 0.25), backgroundColor: rgba(DH.purple, 0.05) }}>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold" style={{ color: DH.purple }}>
                  <Bug className="h-3.5 w-3.5" /> TEST INJECTION — duplicate / delayed telemetry
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={injectDevice} onValueChange={setInjectDevice}>
                    <SelectTrigger className="h-8 w-[170px] border-slate-700 bg-slate-800/60 text-[11.5px] text-slate-200">
                      <SelectValue placeholder="Device" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[240px] border-slate-700 bg-[#151E2D] text-slate-200">
                      {simFleet.map((d: any) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>{d.deviceId}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={injectAction} onValueChange={setInjectAction}>
                    <SelectTrigger className="h-8 w-[190px] border-slate-700 bg-slate-800/60 text-[11.5px] text-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                      <SelectItem value="duplicate-last"><Repeat className="mr-1 inline h-3 w-3" /> Duplicate last message</SelectItem>
                      <SelectItem value="delayed"><Timer className="mr-1 inline h-3 w-3" /> Delayed sample (−3 min)</SelectItem>
                      <SelectItem value="pause">Pause device</SelectItem>
                      <SelectItem value="resume">Resume device</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-8 text-[11.5px]" style={{ backgroundColor: DH.purple }} onClick={() => deviceInject.mutate()} disabled={deviceInject.isPending || !injectDevice}>
                    {deviceInject.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />} Inject
                  </Button>
                </div>
              </div>
            )}

            {/* fleet grid */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {simFleet.map((d: any) => (
                <div key={d.deviceId} className="flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1.5" style={{ borderColor: DH.borderFaint, backgroundColor: rgba(DH.surfaceHover, 0.4) }}>
                  <span className="font-mono text-[9.5px]" style={{ color: DH.textPrimary }}>{d.deviceId}</span>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: d.killed || d.wentSilent ? DH.danger : d.paused ? DH.warning : d.connected ? DH.success : DH.textSecondary, boxShadow: d.connected && !d.paused ? `0 0 6px ${rgba(DH.success, 0.7)}` : undefined }}
                    title={`${d.profile} · ${d.published} published${d.wentSilent ? " · SILENT" : ""}`}
                  />
                </div>
              ))}
              {simFleet.length === 0 && <div className="col-span-3"><EmptyState title="Simulator fleet unavailable" subtitle="The simulator service is not reachable" /></div>}
            </div>
          </div>
        </div>
      </div>

      {/* platform info */}
      <div className="rounded-2xl border p-5" style={{ backgroundColor: DH.surface, borderColor: DH.borderSoft, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
        <h3 className="mb-3 flex items-center gap-2.5 text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: rgba(DH.success, 0.12), border: `1px solid ${rgba(DH.success, 0.2)}`, color: DH.success }}>
            <ShieldCheck className="h-4 w-4" />
          </span>
          Platform Information
        </h3>
        <div className="grid grid-cols-1 gap-3 text-[11.5px] sm:grid-cols-2 lg:grid-cols-4">
          <InfoRow label="Platform" value="DeviceHub — IoT Device Management, Edge Gateway, Telemetry Analytics and Local AI Platform" />
          <InfoRow label="Owner / Copyright" value="Parsa Fathi · © 2026 · Apache-2.0" />
          <InfoRow label="Data origin" value="Deterministic simulator (seeded, reproducible). Physical device: 0." />
          <InfoRow label="Protocol" value="DeviceHub protocol v1 (JSON envelope over MQTT QoS1; C11 binary codec in protocol-c/)" />
          <InfoRow label="Storage" value={`${sysData?.database?.devices ?? "—"} devices · ${fmtInt(sysData?.database?.samples ?? 0)} samples · ${sysData?.database?.alerts ?? "—"} alerts · ${sysData?.database?.commands ?? "—"} commands`} />
          <InfoRow label="Offline buffer" value="Durable SQLite spool (WAL) at the edge — survives gateway restarts, 5000-record cap with loss events" />
          <InfoRow label="Automation" value="Deterministic edge rules (duration hold + cooldown) — independent of the AI layer" />
          <InfoRow label="AI layer" value="Optional, evidence-grounded, advisory-only. Platform operates fully without it." />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: DH.borderFaint, backgroundColor: rgba(DH.surfaceHover, 0.4) }}>
      <div className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>{label}</div>
      <div className="mt-1 text-[11.5px] leading-snug tabular-nums" style={{ color: DH.textPrimary }}>{value}</div>
    </div>
  );
}
