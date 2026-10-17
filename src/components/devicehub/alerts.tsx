/**
 * DeviceHub — System Alerts view.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatCard, StatusPill, DH, timeAgo, fmtTs, EmptyState, severityColor } from "./shared";
import { useDhStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bell, AlertTriangle, AlertCircle, Info, CheckCircle2, Download, Eye, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function AlertsView() {
  const [tab, setTab] = useState("ACTIVE");
  const [evidenceAlert, setEvidenceAlert] = useState<any | null>(null);
  const user = useDhStore((s) => s.user);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["alerts", tab],
    queryFn: async () => {
      const res = await fetch(`/api/alerts?state=${tab === "ALL" ? "" : tab}&limit=150`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 6000,
  });

  const act = useMutation({
    mutationFn: async ({ alertId, action }: { alertId: string; action: "ack" | "resolve" }) => {
      const res = await fetch(`/api/alerts/${alertId}/${action}`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    },
    onSuccess: (d) => {
      toast({ title: `Alert ${d.state.toLowerCase()}`, description: `${d.alertId} → ${d.state}` });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (e: any) => toast({ title: "Action failed", description: e.message, variant: "destructive" }),
  });

  const canOperate = user?.role === "ADMIN" || user?.role === "OPERATOR";
  const alerts = data?.alerts || [];
  const k = data?.kpis || {};

  function exportJson() {
    const blob = new Blob([JSON.stringify(alerts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `devicehub_alerts_${tab}_${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Bell className="h-5 w-5" />} label="Total Alerts" value={k.total ?? 0} trend="all time" trendUp />
        <StatCard icon={<AlertCircle className="h-5 w-5" />} label="Critical (active)" value={k.critical ?? 0} trend={`${k.warning ?? 0} warnings active`} trendUp={false} iconColor={DH.danger} />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Warnings (active)" value={k.warning ?? 0} trend={`${k.info ?? 0} info active`} trendUp={false} iconColor={DH.warning} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Resolved Today" value={k.resolvedToday ?? 0} trend="by operators" trendUp iconColor={DH.success} />
      </div>

      <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: DH.border }}>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-8 bg-slate-800/60">
              {["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "ALL"].map((t) => (
                <TabsTrigger key={t} value={t} className="h-7 px-3 text-[12px] text-slate-400 data-[state=active]:text-slate-100">{t}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 border-slate-700 bg-transparent text-[12px] text-slate-300" onClick={exportJson} disabled={!alerts.length}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left">
            <thead>
              <tr className="border-b" style={{ borderColor: DH.border }}>
                {["Alert Details", "Source / Device", "Timestamp", "Severity", "Status", "Action"].map((h) => (
                  <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" style={{ color: DH.textSecondary }} /></td></tr>}
              {!isLoading && alerts.length === 0 && (
                <tr><td colSpan={6}><EmptyState title={`No ${tab.toLowerCase()} alerts`} subtitle="Automation rules have not produced alerts in this state" /></td></tr>
              )}
              {alerts.map((a: any) => (
                <tr key={a.alertId} className="border-b transition-colors hover:bg-slate-700/25" style={{ borderColor: `${DH.border}88` }}>
                  <td className="max-w-[360px] px-4 py-3">
                    <div className="flex items-start gap-2.5">
                      <span
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                        style={{ color: severityColor(a.severity), backgroundColor: `${severityColor(a.severity)}1a` }}
                      >
                        {a.severity === "CRITICAL" ? "!" : a.severity === "WARNING" ? "▲" : "i"}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-semibold" style={{ color: DH.textPrimary }}>{a.title}</div>
                        <div className="truncate text-[11px]" style={{ color: DH.textSecondary }}>{a.message}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[12px] font-medium" style={{ color: DH.textPrimary }}>{a.deviceName}</div>
                    <div className="text-[10.5px]" style={{ color: DH.textSecondary }}>{a.deviceId} · {a.zone || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[11.5px]" style={{ color: DH.textPrimary }}>{timeAgo(a.createdAt)}</div>
                    <div className="text-[10px]" style={{ color: DH.textSecondary }}>{fmtTs(a.createdAt)}</div>
                  </td>
                  <td className="px-4 py-3"><StatusPill label={a.severity} /></td>
                  <td className="px-4 py-3"><StatusPill label={a.state} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEvidenceAlert(a)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-slate-700/50"
                        style={{ color: DH.cyan }}
                      >
                        <Eye className="h-3 w-3" /> Evidence
                      </button>
                      {canOperate && a.state === "ACTIVE" && (
                        <button
                          onClick={() => act.mutate({ alertId: a.alertId, action: "ack" })}
                          disabled={act.isPending}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-slate-700/50"
                          style={{ color: DH.warning }}
                        >
                          Ack
                        </button>
                      )}
                      {canOperate && a.state !== "RESOLVED" && (
                        <button
                          onClick={() => act.mutate({ alertId: a.alertId, action: "resolve" })}
                          disabled={act.isPending}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-slate-700/50"
                          style={{ color: DH.success }}
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Evidence dialog */}
      <Dialog open={!!evidenceAlert} onOpenChange={(o) => !o && setEvidenceAlert(null)}>
        <DialogContent className="border-slate-700 bg-[#151E2D] sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Alert Evidence — {evidenceAlert?.alertId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border p-3" style={{ borderColor: DH.border, backgroundColor: `${DH.surfaceHover}55` }}>
              <div className="text-[12px] font-semibold" style={{ color: DH.textPrimary }}>{evidenceAlert?.title}</div>
              <div className="mt-1 text-[11.5px]" style={{ color: DH.textSecondary }}>{evidenceAlert?.message}</div>
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: DH.border }}>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>Rule evidence (deterministic)</div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg p-2 font-mono text-[11px]" style={{ color: DH.textPrimary, backgroundColor: "#0B1120" }}>
                {JSON.stringify(evidenceAlert?.evidence, null, 2)}
              </pre>
            </div>
            <p className="text-[10.5px] leading-relaxed" style={{ color: DH.textSecondary }}>
              Evidence references the exact observed values, thresholds and hold durations recorded by the deterministic
              edge automation engine. No values are invented.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
