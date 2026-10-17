/**
 * DeviceHub — Edge Gateways view (health, offline buffer, events, outage injection).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatCard, StatusPill, DH, timeAgo, fmtTs, EmptyState, stateColor } from "./shared";
import { useDhStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Cpu, Activity, Database, ArrowUpDown, Zap, Loader2, ServerCog } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function GatewaysView() {
  const user = useDhStore((s) => s.user);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [outageFor, setOutageFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["gateways"],
    queryFn: async () => {
      const res = await fetch("/api/gateways");
      if (!res.ok) throw new Error("failed");
      const list = await res.json();
      const details = await Promise.all(
        list.gateways.map(async (g: any) => {
          const r = await fetch(`/api/gateways/${g.gatewayId}`);
          return r.ok ? await r.json() : null;
        })
      );
      return { list: list.gateways, details };
    },
    refetchInterval: 5000,
  });

  const outage = useMutation({
    mutationFn: async ({ gatewayId, seconds }: { gatewayId: string; seconds: number }) => {
      const res = await fetch(`/api/gateways/${gatewayId}/outage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seconds }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    },
    onSuccess: (d) => {
      toast({
        title: "Backend outage injected",
        description: `The edge gateway will buffer telemetry locally for ${d.offlineForSec}s, then drain the spool automatically.`,
      });
      queryClient.invalidateQueries({ queryKey: ["gateways"] });
    },
    onError: (e: any) => toast({ title: "Injection failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return <div className="h-[300px] animate-pulse rounded-2xl" style={{ backgroundColor: DH.surface }} />;
  }

  const canOperate = user?.role === "ADMIN" || user?.role === "OPERATOR";

  return (
    <div className="space-y-5">
      {data.details.map((detail: any, i: number) => {
        const g = detail?.gateway || data.list[i];
        const live = detail?.live;
        const metrics = live?.metrics || g.metrics || {};
        const buffer = detail?.buffer;
        return (
          <div key={g.gatewayId} className="space-y-5">
            {/* Gateway summary */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                icon={<Cpu className="h-5 w-5" />}
                label="Gateway"
                value={g.name.split("(")[0].trim()}
                trend={`${g.gatewayId} · v${g.version}`}
                trendUp
              />
              <StatCard
                icon={<Activity className="h-5 w-5" />}
                label="State"
                value={live?.mqttConnected ? (live.offlineMode ? "BUFFERING" : "ONLINE") : g.state}
                trend={`up ${Math.floor((live?.uptimeSec || 0) / 60)}m ${(live?.uptimeSec || 0) % 60}s`}
                trendUp
                iconColor={live?.mqttConnected ? DH.success : DH.danger}
              />
              <StatCard
                icon={<ArrowUpDown className="h-5 w-5" />}
                label="Forwarded / Deduped"
                value={`${metrics.forwarded ?? 0} / ${metrics.deduped ?? 0}`}
                trend={`rejected ${metrics.rejected ?? 0}`}
                trendUp
                iconColor={DH.cyan}
              />
              <StatCard
                icon={<Database className="h-5 w-5" />}
                label="Spool Pending"
                value={buffer?.pending ?? metrics.pendingSpool ?? 0}
                trend={`drained total ${metrics.uploadedFromBuffer ?? 0}`}
                trendUp={!(buffer?.pending)}
                iconColor={(buffer?.pending ?? 0) > 0 ? DH.warning : DH.success}
              />
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              {/* Gateway detail card */}
              <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
                <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: DH.border }}>
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
                    <ServerCog className="h-4 w-4" style={{ color: DH.accent }} /> Edge Gateway Status
                  </h3>
                  <StatusPill label={live?.mqttConnected ? (live.offlineMode ? "BUFFERING" : "ONLINE") : g.state} />
                </div>
                <div className="space-y-3 p-5">
                  <Row label="MQTT session" value={live?.mqttConnected ? "connected (persistent, clean=false)" : "disconnected — reconnecting"} ok={live?.mqttConnected} />
                  <Row label="Backend link" value={live?.backendHealthy ? "healthy" : "unavailable — buffering"} ok={live?.backendHealthy} />
                  <Row label="Devices tracked" value={String(live?.devices?.length ?? "—")} ok />
                  <Row label="Queue depth" value={String(metrics.queueDepth ?? 0)} ok />
                  <Row label="Alerts fired (edge rules)" value={String(metrics.alertsFired ?? 0)} ok />
                  <Row label="Commands routed" value={String(metrics.commandsRouted ?? 0)} ok />
                  <Row label="Dropped / lost" value={String(metrics.dropped ?? 0)} ok={!(metrics.dropped)} />
                  <Row label="Last forwarded" value={metrics.lastForwardedAt ? timeAgo(new Date(Number(metrics.lastForwardedAt)).toISOString()) : "—"} ok />
                  <Row label="Last drain" value={metrics.lastDrainAt ? timeAgo(new Date(Number(metrics.lastDrainAt)).toISOString()) : "—"} ok />
                  <Row label="Spool limit" value={`${buffer?.limit ?? 5000} records (durable SQLite, WAL)`} ok />

                  {canOperate && (
                    <div className="mt-4 rounded-xl border p-3" style={{ borderColor: `${DH.warning}44`, backgroundColor: `${DH.warning}0d` }}>
                      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold" style={{ color: DH.warning }}>
                        <Zap className="h-3.5 w-3.5" /> FAILURE INJECTION — offline buffering test
                      </div>
                      <p className="mb-3 text-[11px] leading-relaxed" style={{ color: DH.textSecondary }}>
                        Simulate a backend outage: the gateway keeps validating telemetry from devices, stores it in the durable
                        spool, and drains it with original timestamps after reconnection.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[30, 90, 180].map((sec) => (
                          <Button
                            key={sec}
                            size="sm"
                            variant="outline"
                            disabled={outage.isPending || (live?.offlineMode ?? false)}
                            onClick={() => outage.mutate({ gatewayId: g.gatewayId, seconds: sec })}
                            className="h-7 border-slate-600 bg-transparent text-[11px] text-slate-300 hover:bg-slate-700/50"
                          >
                            {outage.isPending && outageFor === `${g.gatewayId}-${sec}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                            {sec}s outage
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Buffer records */}
              <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
                <div className="border-b px-5 py-4" style={{ borderColor: DH.border }}>
                  <h3 className="text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
                    Offline Buffer {buffer?.pending ? `(${buffer.pending} pending)` : "(empty)"}
                  </h3>
                </div>
                <div className="max-h-[360px] overflow-y-auto p-3">
                  {!buffer || buffer.records?.length === 0 ? (
                    <EmptyState title="Spool is empty" subtitle="All received telemetry has been delivered to the backend" />
                  ) : (
                    buffer.records.map((r: any) => (
                      <div key={r.msgId} className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border px-3 py-2" style={{ borderColor: DH.border, backgroundColor: `${DH.surfaceHover}55` }}>
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[11px]" style={{ color: DH.textPrimary }}>{r.msgId}</div>
                          <div className="text-[9.5px]" style={{ color: DH.textSecondary }}>{r.topic}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[10px]" style={{ color: DH.warning }}>buffered {timeAgo(r.bufferedAt)}</div>
                          <div className="text-[9.5px]" style={{ color: DH.textSecondary }}>tries {r.tries}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Gateway events */}
              <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
                <div className="border-b px-5 py-4" style={{ borderColor: DH.border }}>
                  <h3 className="text-[15px] font-semibold" style={{ color: DH.textPrimary }}>Lifecycle Events</h3>
                </div>
                <div className="max-h-[360px] overflow-y-auto p-3">
                  {(!detail?.events || detail.events.length === 0) && <EmptyState title="No gateway events yet" />}
                  {detail?.events?.map((e: any, idx: number) => (
                    <div key={idx} className="mb-1.5 flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-700/25">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stateColor(e.type) }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium" style={{ color: DH.textPrimary }}>{e.type}</div>
                        <div className="truncate text-[10px]" style={{ color: DH.textSecondary }}>{JSON.stringify(e.detail).slice(0, 70)}</div>
                      </div>
                      <span className="shrink-0 text-[10px]" style={{ color: DH.textSecondary }}>{timeAgo(e.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* devices on this gateway */}
            {live?.devices && (
              <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
                <div className="border-b px-5 py-4" style={{ borderColor: DH.border }}>
                  <h3 className="text-[15px] font-semibold" style={{ color: DH.textPrimary }}>Device Sessions ({live.devices.length})</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {live.devices.map((d: any) => (
                    <div key={d.deviceId} className="flex items-center justify-between rounded-lg border px-2.5 py-2" style={{ borderColor: DH.border, backgroundColor: `${DH.surfaceHover}55` }}>
                      <span className="font-mono text-[10.5px]" style={{ color: DH.textPrimary }}>{d.deviceId}</span>
                      <StatusPill label={d.state} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b pb-2 last:border-0" style={{ borderColor: `${DH.border}66` }}>
      <span className="text-[11.5px]" style={{ color: DH.textSecondary }}>{label}</span>
      <span className="text-right text-[11.5px] font-medium" style={{ color: ok === undefined ? DH.textPrimary : ok ? DH.success : DH.warning }}>{value}</span>
    </div>
  );
}
