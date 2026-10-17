/**
 * DeviceHub — Commands & Audit view.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StatCard, StatusPill, DH, timeAgo, fmtTs, EmptyState, stateColor } from "./shared";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal, CheckCircle2, XCircle, Clock, FileText, ChevronRight } from "lucide-react";

const LIFECYCLE = ["REQUESTED", "AUTHORIZED", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING", "SUCCEEDED"];
const TERMINAL = ["FAILED", "EXPIRED", "CANCELLED"];

export function CommandsAuditView() {
  const [tab, setTab] = useState("commands");

  const { data: commandsData } = useQuery({
    queryKey: ["commands"],
    queryFn: async () => {
      const res = await fetch("/api/commands?limit=100");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: auditData } = useQuery({
    queryKey: ["audit"],
    queryFn: async () => {
      const res = await fetch("/api/audit?limit=120");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 8000,
  });

  const commands = commandsData?.commands || [];
  const succeeded = commands.filter((c: any) => c.state === "SUCCEEDED").length;
  const failed = commands.filter((c: any) => ["FAILED", "EXPIRED", "CANCELLED"].includes(c.state)).length;
  const pending = commands.filter((c: any) => ["REQUESTED", "AUTHORIZED", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING"].includes(c.state)).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Terminal className="h-5 w-5" />} label="Total Commands" value={commands.length} trend="audited lifecycle" trendUp />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Succeeded" value={succeeded} trend="device-acknowledged" trendUp iconColor={DH.success} />
        <StatCard icon={<XCircle className="h-5 w-5" />} label="Failed / Expired" value={failed} trend="real device outcomes" trendUp={false} iconColor={DH.danger} />
        <StatCard icon={<FileText className="h-5 w-5" />} label="Audit Events" value={auditData?.events?.length ?? 0} trend="actor · action · outcome" trendUp iconColor={DH.cyan} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9 bg-slate-800/60">
          <TabsTrigger value="commands" className="h-8 px-4 text-[12.5px] text-slate-400 data-[state=active]:text-slate-100">Command Lifecycle</TabsTrigger>
          <TabsTrigger value="audit" className="h-8 px-4 text-[12.5px] text-slate-400 data-[state=active]:text-slate-100">Audit Trail</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "commands" ? (
        <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
          <div className="border-b px-5 py-4" style={{ borderColor: DH.border }}>
            <h3 className="text-[15px] font-semibold" style={{ color: DH.textPrimary }}>Commands ({commands.length})</h3>
            <p className="mt-0.5 text-[11px]" style={{ color: DH.textSecondary }}>
              Request accepted ≠ delivered ≠ acknowledged ≠ completed — the stepper shows the real progress of each command.
            </p>
          </div>
          <div className="space-y-2.5 p-4">
            {commands.length === 0 && <EmptyState title="No commands issued yet" subtitle="Send a command from a device detail page" />}
            {commands.map((c: any) => {
              const stepIdx = LIFECYCLE.indexOf(c.state);
              const terminalFail = TERMINAL.includes(c.state);
              return (
                <div key={c.commandId} className="rounded-xl border p-4" style={{ borderColor: DH.border, backgroundColor: `${DH.surfaceHover}55` }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[11px] rounded px-1.5 py-0.5" style={{ color: DH.accent, backgroundColor: `${DH.accent}14` }}>{c.commandId}</span>
                      <span className="text-[13px] font-semibold" style={{ color: DH.textPrimary }}>{c.action}</span>
                      <span className="text-[11.5px]" style={{ color: DH.textSecondary }}>→ {c.deviceName} <span className="font-mono">({c.deviceId})</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.source === "AI_PROPOSAL" && (
                        <span className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold" style={{ color: DH.purple, backgroundColor: `${DH.purple}14` }}>AI PROPOSAL</span>
                      )}
                      <StatusPill label={c.state} />
                    </div>
                  </div>

                  {/* lifecycle stepper */}
                  <div className="mt-3 flex items-center gap-1 overflow-x-auto pb-1">
                    {(terminalFail ? [...LIFECYCLE.slice(0, 4), c.state] : LIFECYCLE).map((st, i, arr) => {
                      const active = terminalFail ? (i < 4 || i === arr.length - 1) : i <= stepIdx;
                      const isFail = terminalFail && i === arr.length - 1;
                      return (
                        <div key={st} className="flex items-center">
                          <div className="flex flex-col items-center gap-1">
                            <div
                              className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold"
                              style={{
                                backgroundColor: active ? (isFail ? DH.danger : i === LIFECYCLE.indexOf("SUCCEEDED") && !terminalFail ? DH.success : DH.accent) : DH.surfaceHover,
                                color: active ? "white" : DH.textSecondary,
                              }}
                            >
                              {isFail ? "×" : active ? "✓" : ""}
                            </div>
                            <span className="whitespace-nowrap text-[8.5px] font-medium" style={{ color: active ? (isFail ? DH.danger : DH.textSecondary) : `${DH.textSecondary}88` }}>{st}</span>
                          </div>
                          {i < arr.length - 1 && (
                            <div className="mx-1 h-[2px] w-4 sm:w-8" style={{ backgroundColor: active && !isFail ? DH.accent : DH.surfaceHover }} />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px]" style={{ color: DH.textSecondary }}>
                    <span>requester: {c.requester}</span>
                    <span>created: {timeAgo(c.createdAt)}</span>
                    {c.sentAt && <span>sent: {fmtTs(c.sentAt)}</span>}
                    {c.ackedAt && <span>acked: {fmtTs(c.ackedAt)}</span>}
                    {c.completedAt && <span>completed: {fmtTs(c.completedAt)}</span>}
                    <span>expires: {fmtTs(c.expiresAt)}</span>
                    {c.ackCode && <span style={{ color: c.ackCode === "OK" ? DH.success : DH.danger }}>ack: {c.ackCode} {c.ackDetail ? `“${c.ackDetail.slice(0, 60)}”` : ""}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
          <div className="border-b px-5 py-4" style={{ borderColor: DH.border }}>
            <h3 className="text-[15px] font-semibold" style={{ color: DH.textPrimary }}>Audit Trail ({auditData?.events?.length ?? 0})</h3>
            <p className="mt-0.5 text-[11px]" style={{ color: DH.textSecondary }}>Actor · action · resource · outcome · timestamp (credentials are never logged)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b" style={{ borderColor: DH.border }}>
                  {["Time", "Actor", "Action", "Resource", "Outcome", "Detail"].map((h) => (
                    <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(auditData?.events || []).map((e: any) => (
                  <tr key={e.id} className="border-b transition-colors hover:bg-slate-700/25" style={{ borderColor: `${DH.border}88` }}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11px]" style={{ color: DH.textSecondary }}>
                      {timeAgo(e.createdAt)}
                      <div className="text-[9.5px]">{fmtTs(e.createdAt)}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11.5px] font-medium" style={{ color: DH.textPrimary }}>{e.actorName || e.actor}</span>
                      <div className="text-[9.5px]" style={{ color: DH.textSecondary }}>{e.actorType}</div>
                    </td>
                    <td className="px-4 py-2.5 text-[11.5px] font-mono" style={{ color: DH.accent }}>{e.action}</td>
                    <td className="px-4 py-2.5 text-[11px]" style={{ color: DH.textSecondary }}>{e.resourceType}{e.resourceId ? ` · ${e.resourceId}` : ""}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill label={e.outcome === "SUCCESS" ? "SUCCEEDED" : e.outcome === "DENIED" ? "RETIRED" : e.outcome} />
                    </td>
                    <td className="max-w-[260px] truncate px-4 py-2.5 text-[10.5px]" style={{ color: DH.textSecondary }} title={JSON.stringify(e.detail)}>
                      {JSON.stringify(e.detail).slice(0, 60)}
                    </td>
                  </tr>
                ))}
                {(!auditData?.events || auditData.events.length === 0) && (
                  <tr><td colSpan={6}><EmptyState title="No audit events yet" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
