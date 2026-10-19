/**
 * DeviceHub — Fleet Overview view (v2 refinement: gauge rings, tabular figures,
 * gradient chart polish, thin status rings per approved mockups).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  StatCard, SectionCard, StatusPill, GaugeRing, ProgressBar, DH, timeAgo, fmtVal, fmtInt,
  severityColor, healthColor, SimulatorBadge, EmptyState, rgba,
} from "./shared";
import { useDhStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Radio, Wifi, WifiOff, AlertTriangle, Activity, MapPin, ArrowRight, ServerCrash, Thermometer,
} from "lucide-react";

const ZONE_COLORS = [DH.accent, DH.cyan, DH.purple, "#6366f1", "#0ea5e9", "#14b8a6"];

export function OverviewView() {
  const { data, isLoading } = useQuery({
    queryKey: ["overview"],
    queryFn: async () => {
      const res = await fetch("/api/overview");
      if (!res.ok) throw new Error("failed to load overview");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const telemetryFeed = useDhStore((s) => s.telemetryFeed);
  const activityFeed = useDhStore((s) => s.activityFeed);
  const setView = useDhStore((s) => s.setView);
  const openDevice = useDhStore((s) => s.openDevice);

  if (isLoading || !data) {
    return <OverviewSkeleton />;
  }

  const k = data.kpis;
  const rateData = data.rateBuckets.map((b: any) => ({
    t: new Date(b.minute).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    samples: b.count,
  }));
  const onlinePct = k.totalDevices ? Math.round((k.online / k.totalDevices) * 100) : 0;
  const degradedPct = k.totalDevices ? Math.round((k.degraded / k.totalDevices) * 100) : 0;
  const offlinePct = k.totalDevices ? Math.round((k.offline / k.totalDevices) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Radio className="h-5 w-5" />} label="Total Devices" value={k.totalDevices} trend={`${fmtInt(k.samples24h)} samples / 24h`} trendNeutral />
        <StatCard icon={<Wifi className="h-5 w-5" />} label="Online" value={k.online} trend={`${onlinePct}% of fleet`} trendUp iconColor={DH.success} />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Active Alerts" value={k.activeAlerts} trend={`${k.criticalAlerts} critical`} trendUp={false} iconColor={k.criticalAlerts > 0 ? DH.danger : DH.warning} />
        <StatCard icon={<Activity className="h-5 w-5" />} label="Fleet Health" value={k.fleetHealth} unit="%" trend={`avg · ${k.offline} offline`} trendUp={k.fleetHealth >= 80} iconColor={healthColor(k.fleetHealth)} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Telemetry rate chart */}
        <SectionCard
          title="Telemetry Ingest Rate"
          icon={<Activity className="h-4 w-4" />}
          className="xl:col-span-2"
          action={
            <span className="flex items-center gap-2 text-[10px] font-medium" style={{ color: DH.textSecondary }}>
              <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5" style={{ backgroundColor: rgba(DH.accent, 0.09), border: `1px solid ${rgba(DH.accent, 0.2)}` }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: DH.accent, boxShadow: `0 0 6px ${rgba(DH.accent, 0.8)}` }} />
                samples / min
              </span>
              last 10 min
            </span>
          }
        >
          <div className="h-[220px]">
            {rateData.length === 0 ? (
              <EmptyState title="No telemetry ingested yet" subtitle="Waiting for the device fleet…" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rateData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rateGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={DH.accent} stopOpacity={0.32} />
                      <stop offset="70%" stopColor={DH.accent} stopOpacity={0.06} />
                      <stop offset="100%" stopColor={DH.accent} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 6" stroke="rgba(30,41,59,0.65)" vertical={false} />
                  <XAxis dataKey="t" tick={{ fill: DH.textSecondary, fontSize: 10 }} axisLine={{ stroke: rgba(DH.textSecondary, 0.15) }} tickLine={false} dy={6} />
                  <YAxis tick={{ fill: DH.textSecondary, fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip
                    cursor={{ stroke: rgba(DH.accent, 0.35), strokeWidth: 1 }}
                    contentStyle={{
                      backgroundColor: "#101A2C",
                      border: `1px solid ${DH.borderSoft}`,
                      borderRadius: 12,
                      fontSize: 12,
                      color: DH.textPrimary,
                      boxShadow: "0 12px 32px -12px rgba(0,0,0,0.7)",
                      padding: "8px 12px",
                    }}
                    labelStyle={{ color: DH.textSecondary, fontSize: 10, marginBottom: 2 }}
                    itemStyle={{ color: DH.textPrimary, fontWeight: 600 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="samples"
                    stroke={DH.accent}
                    strokeWidth={2.5}
                    fill="url(#rateGrad)"
                    name="samples/min"
                    activeDot={{ r: 4, fill: DH.accent, stroke: "#0B1120", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </SectionCard>

        {/* Live activity feed */}
        <SectionCard
          title="Live Activity"
          icon={<Activity className="h-4 w-4" />}
          iconColor={DH.success}
          action={
            <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: DH.success }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: DH.success, boxShadow: `0 0 8px ${rgba(DH.success, 0.9)}` }} />
              REALTIME
            </span>
          }
        >
          <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
            {activityFeed.length === 0 && (
              <EmptyState title="Waiting for live events…" subtitle="Telemetry, alerts and commands will appear here in real time" />
            )}
            {activityFeed.slice(0, 14).map((a) => {
              const dotColor =
                a.type === "ALERT" ? DH.danger :
                a.type === "COMMAND" ? DH.accent :
                a.type === "GATEWAY" ? DH.warning :
                a.type === "ANOMALY" ? DH.purple :
                a.type === "DEVICE" ? DH.cyan : DH.success;
              return (
                <div
                  key={a.id}
                  className="flex items-start gap-2.5 rounded-lg border px-2.5 py-1.5"
                  style={{ backgroundColor: rgba(DH.surfaceHover, 0.4), borderColor: DH.borderFaint }}
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor, boxShadow: `0 0 6px ${rgba(dotColor, 0.8)}` }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] leading-snug" style={{ color: DH.textPrimary }} title={a.message}>{a.message}</div>
                    <div className="text-[10px] tabular-nums" style={{ color: DH.textSecondary }}>{new Date(a.ts).toLocaleTimeString()}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Zone health gauge rings */}
        <SectionCard title="Zone Health" icon={<MapPin className="h-4 w-4" />}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {data.zones.map((z: any, i: number) => {
              const grad = DH.zoneGradients[i % DH.zoneGradients.length];
              return (
                <div key={z.key} className="flex flex-col items-center gap-2">
                  <GaugeRing
                    percent={z.avgHealth}
                    gradient={grad}
                    color={grad[1]}
                    label={`${z.avgHealth}%`}
                    sublabel="Avg Health"
                    size={92}
                  />
                  <div className="text-center">
                    <div className="text-[11px] font-semibold" style={{ color: DH.textPrimary }}>{z.name}</div>
                    <div className="text-[10px] tabular-nums" style={{ color: DH.textSecondary }}>
                      <span style={{ color: DH.success }}>{z.online}</span> on
                      {z.warning > 0 && <span style={{ color: DH.warning }}> · {z.warning} warn</span>}
                      {z.offline > 0 && <span style={{ color: DH.danger }}> · {z.offline} off</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        {/* Recent alerts */}
        <SectionCard
          title="Recent Alerts"
          icon={<AlertTriangle className="h-4 w-4" />}
          iconColor={DH.warning}
          action={
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px] text-slate-400 hover:bg-slate-700/40" onClick={() => setView("alerts")}>
              View All <ArrowRight className="h-3 w-3" />
            </Button>
          }
        >
          <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
            {data.recentAlerts.length === 0 && <EmptyState title="No alerts recorded" subtitle="Automation rules have not triggered" />}
            {data.recentAlerts.map((a: any) => (
              <button
                key={a.alertId}
                onClick={() => a.deviceId && openDevice(a.deviceId)}
                className="flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:border-slate-600"
                style={{ backgroundColor: rgba(DH.surfaceHover, 0.4), borderColor: DH.borderFaint }}
              >
                <span
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    color: severityColor(a.severity),
                    backgroundColor: rgba(severityColor(a.severity), 0.13),
                    border: `1px solid ${rgba(severityColor(a.severity), 0.25)}`,
                  }}
                >
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold" style={{ color: DH.textPrimary }}>{a.title}</div>
                  <div className="text-[11px]" style={{ color: DH.textSecondary }}>{a.deviceName} · {a.zone || "—"} · {timeAgo(a.createdAt)}</div>
                </div>
                <StatusPill label={a.state} />
              </button>
            ))}
          </div>
        </SectionCard>

        {/* Fleet status summary — thin status rings per design's Device Status panel */}
        <SectionCard title="Fleet Status" icon={<ServerCrash className="h-4 w-4" />} iconColor={DH.cyan}>
          <div className="space-y-4">
            {/* thin rings: online / degraded / offline share of fleet */}
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center gap-1.5">
                <GaugeRing percent={onlinePct} color={DH.success} label={`${onlinePct}%`} sublabel="Online" size={68} thickness={6} />
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <GaugeRing percent={degradedPct} color={DH.warning} label={`${degradedPct}%`} sublabel="Warning" size={68} thickness={6} />
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <GaugeRing percent={offlinePct} color={DH.danger} label={`${offlinePct}%`} sublabel="Offline" size={68} thickness={6} />
              </div>
            </div>

            <div className="space-y-2.5">
              {[
                { label: "Online", value: k.online, color: DH.success, icon: <Wifi className="h-3.5 w-3.5" /> },
                { label: "Offline", value: k.offline, color: DH.danger, icon: <WifiOff className="h-3.5 w-3.5" /> },
                { label: "Degraded", value: k.degraded, color: DH.warning, icon: <AlertTriangle className="h-3.5 w-3.5" /> },
                { label: "Maintenance", value: k.maintenance, color: DH.cyan, icon: <Activity className="h-3.5 w-3.5" /> },
              ].map((row) => (
                <div key={row.label}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 font-medium" style={{ color: DH.textSecondary }}>
                      <span style={{ color: row.color }}>{row.icon}</span> {row.label}
                    </span>
                    <span className="font-semibold tabular-nums" style={{ color: DH.textPrimary }}>{row.value}</span>
                  </div>
                  <ProgressBar percent={k.totalDevices ? (row.value / k.totalDevices) * 100 : 0} color={row.color} height={5} />
                </div>
              ))}
            </div>

            <div className="rounded-xl border p-3" style={{ borderColor: DH.borderFaint, backgroundColor: rgba(DH.surfaceHover, 0.4) }}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-wider" style={{ color: DH.textSecondary }}>DATA ORIGIN</span>
                <SimulatorBadge />
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: DH.textSecondary }}>
                {data.dataOrigin.note}. Physical devices: {data.dataOrigin.physicalDevices}. All telemetry is labelled with its origin and never merged invisibly.
              </p>
            </div>

            <div className="rounded-xl border p-3" style={{ borderColor: DH.borderFaint, backgroundColor: rgba(DH.surfaceHover, 0.4) }}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider" style={{ color: DH.textSecondary }}>
                <Thermometer className="h-3 w-3" /> LIVE TELEMETRY SNAPSHOT
              </div>
              {telemetryFeed.length === 0 ? (
                <div className="text-[11px]" style={{ color: DH.textSecondary }}>waiting for samples…</div>
              ) : (
                <div className="space-y-1">
                  {telemetryFeed.slice(-5).reverse().map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px]">
                      <span style={{ color: DH.textSecondary }}>{s.deviceId} · {s.metric}</span>
                      <span className="font-mono font-semibold tabular-nums" style={{ color: DH.textPrimary }}>{fmtVal(s.value, s.unit)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-[158px] animate-pulse rounded-2xl" style={{ backgroundColor: DH.surface }} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="h-[280px] animate-pulse rounded-2xl xl:col-span-2" style={{ backgroundColor: DH.surface }} />
        <div className="h-[280px] animate-pulse rounded-2xl" style={{ backgroundColor: DH.surface }} />
      </div>
      <div className="h-[300px] animate-pulse rounded-2xl" style={{ backgroundColor: DH.surface }} />
    </div>
  );
}
