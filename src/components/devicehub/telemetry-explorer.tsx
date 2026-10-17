/**
 * DeviceHub — Telemetry Explorer view.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from "recharts";
import { DH, EmptyState, SimulatorBadge, rgba, fmtInt } from "./shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Download, Loader2 } from "lucide-react";

const HOURS_OPTIONS = [
  { value: "0.25", label: "Last 15 min" },
  { value: "1", label: "Last hour" },
  { value: "3", label: "Last 3 hours" },
  { value: "6", label: "Last 6 hours" },
  { value: "24", label: "Last 24 hours" },
];

const INTERVALS = [
  { value: "5", label: "5s" },
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
  { value: "60", label: "1 min" },
  { value: "300", label: "5 min" },
];

export function TelemetryExplorerView() {
  const [deviceId, setDeviceId] = useState<string>("");
  const [metric, setMetric] = useState<string>("temperature");
  const [hours, setHours] = useState("1");
  const [intervalSec, setIntervalSec] = useState("30");

  const { data: devicesData } = useQuery({
    queryKey: ["devices", "explorer"],
    queryFn: async () => {
      const res = await fetch("/api/devices?limit=200");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  const devices = devicesData?.devices || [];
  const selectedDevice = devices.find((d: any) => d.deviceId === deviceId) || devices[0];
  const effectiveDeviceId = selectedDevice?.deviceId || "";
  const availableMetrics = selectedDevice?.metrics || ["temperature"];

  const { data, isLoading } = useQuery({
    queryKey: ["telemetry", effectiveDeviceId, metric, hours, intervalSec],
    queryFn: async () => {
      const res = await fetch(`/api/telemetry?deviceId=${effectiveDeviceId}&metric=${metric}&hours=${hours}&intervalSec=${intervalSec}&limit=3000`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!effectiveDeviceId,
    refetchInterval: 15000,
  });

  // chart data from raw samples (live detail) with bucket overlay option
  const samples = data?.samples || [];
  const chartData = samples.map((s: any) => ({
    t: new Date(s.ts).getTime(),
    label: new Date(s.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    v: s.value,
    quality: s.quality,
    delayed: s.delayed,
  }));
  const unit = samples[0]?.unit || "";
  const gaps: any[] = data?.gaps || [];
  const threshold = metric === "temperature" ? 85 : metric === "vibration" ? 8 : metric === "power" ? 15 : null;

  function exportCsv() {
    if (!samples.length) return;
    const rows = [
      ["deviceId", "metric", "value", "unit", "sampleTs", "quality", "sequence", "delayed", "simulated"],
      ...samples.map((s: any) => [effectiveDeviceId, metric, s.value, s.unit, s.ts, s.quality, s.seq, s.delayed, data?.simulated]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `devicehub_${effectiveDeviceId}_${metric}_${new Date().toISOString().slice(0, 19)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border p-4" style={{ backgroundColor: DH.surface, borderColor: DH.borderSoft, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>Device</div>
          <Select value={effectiveDeviceId} onValueChange={setDeviceId}>
            <SelectTrigger className="h-9 w-[220px] rounded-lg border-slate-700 bg-slate-800/60 text-[12px] text-slate-200">
              <SelectValue placeholder="Select device" />
            </SelectTrigger>
            <SelectContent className="max-h-[280px] border-slate-700 bg-[#151E2D] text-slate-200">
              {devices.map((d: any) => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.deviceId} — {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>Metric</div>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="h-9 w-[150px] rounded-lg border-slate-700 bg-slate-800/60 text-[12px] text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
              {availableMetrics.map((m: string) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>Time range</div>
          <Select value={hours} onValueChange={setHours}>
            <SelectTrigger className="h-9 w-[140px] rounded-lg border-slate-700 bg-slate-800/60 text-[12px] text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
              {HOURS_OPTIONS.map((h) => (
                <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>Aggregation</div>
          <Select value={intervalSec} onValueChange={setIntervalSec}>
            <SelectTrigger className="h-9 w-[90px] rounded-lg border-slate-700 bg-slate-800/60 text-[12px] text-slate-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
              {INTERVALS.map((i) => (
                <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-9 gap-1.5 border-slate-700 bg-transparent text-[12px] text-slate-300 hover:bg-slate-700/40"
          onClick={exportCsv}
          disabled={!samples.length}
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {/* Main chart */}
      <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.borderSoft, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4" style={{ borderColor: DH.borderFaint }}>
          <h3 className="flex items-center gap-2.5 text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: rgba(DH.accent, 0.12), border: `1px solid ${rgba(DH.accent, 0.2)}`, color: DH.accent }}>
              <LineChart className="h-4 w-4" />
            </span>
            {effectiveDeviceId || "—"} · {metric} {unit && <span className="text-[12px] font-normal" style={{ color: DH.textSecondary }}>({unit})</span>}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-[10px] tabular-nums" style={{ color: DH.textSecondary }}>
            {selectedDevice?.simulator && <SimulatorBadge />}
            <span>{fmtInt(samples.length)} samples</span>
            <span>· agg: {data?.aggregation || "—"}</span>
            {data?.outOfOrder > 0 && <span style={{ color: DH.cyan }}>· {data.outOfOrder} out-of-order</span>}
            {gaps.length > 0 && <span style={{ color: DH.warning }}>· {gaps.length} gaps</span>}
          </div>
        </div>
        <div className="h-[380px] p-4">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: DH.textSecondary }} />
            </div>
          ) : chartData.length === 0 ? (
            <EmptyState title="No samples in the selected range" subtitle="Try a wider time range or another device/metric" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="telemetryGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={DH.accent} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={DH.accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 6" stroke="rgba(30,41,59,0.65)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: DH.textSecondary, fontSize: 10 }}
                  axisLine={{ stroke: rgba(DH.textSecondary, 0.15) }}
                  tickLine={false}
                  minTickGap={60}
                />
                <YAxis tick={{ fill: DH.textSecondary, fontSize: 10 }} axisLine={false} tickLine={false} domain={["auto", "auto"]} width={48} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#101A2C", border: `1px solid ${DH.borderSoft}`, borderRadius: 12, fontSize: 12, color: DH.textPrimary, boxShadow: "0 12px 32px -12px rgba(0,0,0,0.7)" }}
                  labelStyle={{ color: DH.textSecondary }}
                  formatter={(v: any, _n: any, p: any) => [
                    `${Number(v).toFixed(2)} ${unit}${p?.payload?.quality !== "GOOD" ? ` (${p.payload.quality})` : ""}${p?.payload?.delayed ? " · DELAYED" : ""}`,
                    metric,
                  ]}
                />
                {threshold !== null && <ReferenceLine y={threshold} stroke={DH.danger} strokeDasharray="6 4" label={{ value: `threshold ${threshold}${unit}`, fill: DH.danger, fontSize: 10, position: "insideTopRight" }} />}
                {gaps.map((gap: any, i: number) => (
                  <ReferenceArea
                    key={i}
                    x1={new Date(gap.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    x2={new Date(gap.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    fill={DH.warning}
                    fillOpacity={0.08}
                    stroke={DH.warning}
                    strokeOpacity={0.25}
                  />
                ))}
                <Area type="monotone" dataKey="v" stroke={DH.accent} strokeWidth={2.5} fill="url(#telemetryGrad)" connectNulls dot={false} activeDot={{ r: 4, fill: DH.accent, stroke: "#0B1120", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Aggregation table */}
      <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.borderSoft, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}>
        <div className="border-b px-5 py-4" style={{ borderColor: DH.borderFaint }}>
          <h3 className="text-[15px] font-semibold" style={{ color: DH.textPrimary }}>Aggregated Buckets ({fmtInt(data?.buckets?.length || 0)})</h3>
        </div>
        <div className="max-h-[260px] overflow-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead className="sticky top-0" style={{ backgroundColor: DH.surface }}>
              <tr className="border-b" style={{ borderColor: DH.border }}>
                {["Window start", "Min", "Avg", "Max", "Count", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.buckets || []).slice().reverse().map((b: any, i: number) => (
                <tr key={i} className="border-b" style={{ borderColor: `${DH.border}66` }}>
                  <td className="px-4 py-2 text-[11.5px] tabular-nums" style={{ color: DH.textPrimary }}>{new Date(b.start).toLocaleTimeString()}</td>
                  <td className="px-4 py-2 font-mono text-[11.5px] tabular-nums" style={{ color: DH.textSecondary }}>{b.min ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-[11.5px] font-semibold tabular-nums" style={{ color: DH.textPrimary }}>{b.avg ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-[11.5px] tabular-nums" style={{ color: DH.textSecondary }}>{b.max ?? "—"}</td>
                  <td className="px-4 py-2 text-[11.5px] tabular-nums" style={{ color: DH.textSecondary }}>{b.count}</td>
                  <td className="px-4 py-2">
                    {b.missing ? (
                      <span className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ color: DH.warning, backgroundColor: rgba(DH.warning, 0.10), border: `1px solid ${rgba(DH.warning, 0.22)}` }}>MISSING DATA</span>
                    ) : (
                      <span className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold" style={{ color: DH.success, backgroundColor: rgba(DH.success, 0.10), border: `1px solid ${rgba(DH.success, 0.22)}` }}>OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
