/**
 * DeviceHub — Automation Rules view.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatCard, StatusPill, DH, timeAgo, EmptyState, stateColor } from "./shared";
import { useDhStore } from "@/lib/store";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Workflow, Zap, ShieldOff, CheckCircle2, History, Plus, Loader2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function AutomationView() {
  const user = useDhStore((s) => s.user);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editRule, setEditRule] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [historyRule, setHistoryRule] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["rules"],
    queryFn: async () => {
      const res = await fetch("/api/rules");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 8000,
  });

  const { data: historyData } = useQuery({
    queryKey: ["rule-executions", historyRule],
    queryFn: async () => {
      const res = await fetch(`/api/rules/${historyRule}/executions?limit=100`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!historyRule,
  });

  const toggleRule = useMutation({
    mutationFn: async ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) => {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const canOperate = user?.role === "ADMIN" || user?.role === "OPERATOR";
  const rules = data?.rules || [];
  const enabledCount = rules.filter((r: any) => r.enabled).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Workflow className="h-5 w-5" />} label="Total Rules" value={rules.length} trend={`${enabledCount} enabled`} trendUp />
        <StatCard icon={<Zap className="h-5 w-5" />} label="Rules Fired" value={data?.stats?.totalFired ?? 0} trend="total (edge engine)" trendUp iconColor={DH.danger} />
        <StatCard icon={<ShieldOff className="h-5 w-5" />} label="Cooldown Suppressed" value={data?.stats?.totalSuppressed ?? 0} trend="repeated events dampened" trendUp iconColor={DH.warning} />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Deterministic Engine" value="ACTIVE" trend="edge gateway — LLM independent" trendUp iconColor={DH.success} />
      </div>

      <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: DH.border }}>
          <h3 className="text-[15px] font-semibold" style={{ color: DH.textPrimary }}>Automation Rules</h3>
          {canOperate && (
            <Button size="sm" className="h-8 gap-1.5 text-[12px]" style={{ backgroundColor: DH.accent }} onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New Rule
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left">
            <thead>
              <tr className="border-b" style={{ borderColor: DH.border }}>
                {["Rule", "Selector", "Condition", "Duration", "Severity", "Cooldown", "Version", "Last Fired", "Enabled", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={10} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" style={{ color: DH.textSecondary }} /></td></tr>}
              {!isLoading && rules.length === 0 && <tr><td colSpan={10}><EmptyState title="No automation rules" /></td></tr>}
              {rules.map((r: any) => (
                <tr key={r.ruleId} className="border-b transition-colors hover:bg-slate-700/25" style={{ borderColor: `${DH.border}88` }}>
                  <td className="px-4 py-3">
                    <div className="text-[13px] font-semibold" style={{ color: DH.textPrimary }}>{r.name}</div>
                    <div className="font-mono text-[10px]" style={{ color: DH.textSecondary }}>{r.ruleId}</div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded px-1.5 py-0.5 text-[10.5px]" style={{ color: DH.cyan, backgroundColor: `${DH.cyan}12` }}>
                      {r.deviceSelector.deviceId || `type:${r.deviceSelector.type}`}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[12px] font-medium" style={{ color: r.condition === "ABOVE" ? DH.danger : DH.cyan }}>
                      {r.metric} {r.condition === "ABOVE" ? ">" : "<"} {r.threshold}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: DH.textSecondary }}>{r.durationSec}s</td>
                  <td className="px-4 py-3"><StatusPill label={r.severity} /></td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: DH.textSecondary }}>{r.cooldownSec}s</td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: DH.textSecondary }}>v{r.version}</td>
                  <td className="px-4 py-3 text-[11px]" style={{ color: DH.textSecondary }}>{r.lastTriggeredAt ? timeAgo(r.lastTriggeredAt) : "never"}</td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={r.enabled}
                      disabled={!canOperate || toggleRule.isPending}
                      onCheckedChange={(checked) => toggleRule.mutate({ ruleId: r.ruleId, enabled: checked })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {canOperate && (
                        <button
                          onClick={() => setEditRule(r)}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-slate-700/50"
                          style={{ color: DH.accent }}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={() => setHistoryRule(r.ruleId)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium hover:bg-slate-700/50"
                        style={{ color: DH.textSecondary }}
                      >
                        <History className="h-3 w-3" /> History
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit dialog */}
      {editRule && (
        <EditRuleDialog rule={editRule} onClose={() => setEditRule(null)} />
      )}

      {/* Create dialog */}
      <CreateRuleDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* History dialog */}
      <Dialog open={!!historyRule} onOpenChange={(o) => !o && setHistoryRule(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto border-slate-700 bg-[#151E2D] sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-100">
              <Clock className="h-4 w-4" /> Execution history — {historyRule}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
            {(!historyData?.executions || historyData.executions.length === 0) && <EmptyState title="No executions recorded" />}
            {historyData?.executions?.map((e: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: DH.border, backgroundColor: `${DH.surfaceHover}55` }}>
                <div className="min-w-0">
                  <div className="text-[12px] font-medium" style={{ color: stateColor(e.outcome === "FIRED" ? "SUCCEEDED" : e.outcome === "SUPPRESSED_COOLDOWN" ? "WARNING" : e.outcome === "NOT_MET" ? "OFFLINE" : "QUEUED") }}>
                    {e.outcome}
                  </div>
                  <div className="text-[10.5px]" style={{ color: DH.textSecondary }}>{e.deviceName} · {JSON.stringify(e.detail).slice(0, 80)}</div>
                </div>
                <span className="shrink-0 text-[10px]" style={{ color: DH.textSecondary }}>{timeAgo(e.createdAt)}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditRuleDialog({ rule, onClose }: { rule: any; onClose: () => void }) {
  const [threshold, setThreshold] = useState(String(rule.threshold));
  const [durationSec, setDurationSec] = useState(String(rule.durationSec));
  const [cooldownSec, setCooldownSec] = useState(String(rule.cooldownSec));
  const [severity, setSeverity] = useState(rule.severity);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rules/${rule.ruleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threshold: Number(threshold), durationSec: Number(durationSec), cooldownSec: Number(cooldownSec), severity }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    },
    onSuccess: (d) => {
      toast({ title: "Rule updated", description: `${rule.name} is now version v${d.version} — the edge engine picks it up within 15s` });
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="border-slate-700 bg-[#151E2D] sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Edit Rule — {rule.name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-400">Threshold ({rule.metric})</Label>
            <Input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="border-slate-700 bg-slate-800/60 text-slate-100" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-400">Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200"><SelectValue /></SelectTrigger>
              <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                {["CRITICAL", "WARNING", "INFO"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-400">Hold duration (s)</Label>
            <Input type="number" value={durationSec} onChange={(e) => setDurationSec(e.target.value)} className="border-slate-700 bg-slate-800/60 text-slate-100" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-400">Cooldown (s)</Label>
            <Input type="number" value={cooldownSec} onChange={(e) => setCooldownSec(e.target.value)} className="border-slate-700 bg-slate-800/60 text-slate-100" />
          </div>
        </div>
        <p className="text-[11px] text-slate-500">Semantic edits increment the rule version (current: v{rule.version}) and are audited.</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-700 bg-transparent text-slate-300">Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} style={{ backgroundColor: DH.accent }}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Save (v{rule.version + 1})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateRuleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("temperature");
  const [condition, setCondition] = useState("ABOVE");
  const [threshold, setThreshold] = useState("80");
  const [durationSec, setDurationSec] = useState("120");
  const [cooldownSec, setCooldownSec] = useState("300");
  const [severity, setSeverity] = useState("WARNING");
  const [selectorType, setSelectorType] = useState("ENV_SENSOR");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name, metric, condition, threshold: Number(threshold), durationSec: Number(durationSec),
          cooldownSec: Number(cooldownSec), severity, deviceSelector: { type: selectorType },
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    },
    onSuccess: () => {
      toast({ title: "Rule created", description: "The edge gateway will load it within 15 seconds" });
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      onClose();
      setName("");
    },
    onError: (e: any) => toast({ title: "Creation failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="border-slate-700 bg-[#151E2D] sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-slate-100">New Automation Rule</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-400">Rule name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Low Voltage Sag Alert" className="border-slate-700 bg-slate-800/60 text-slate-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] text-slate-400">Device type selector</Label>
              <Select value={selectorType} onValueChange={setSelectorType}>
                <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                  {["ENV_SENSOR", "TEMP_HUM", "MOTION", "POWER_METER", "VIBRATION", "VOLTAGE", "STATUS"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-slate-400">Metric</Label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                  {["temperature", "humidity", "pressure", "motion", "power", "energy", "vibration", "voltage", "current", "status"].map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-slate-400">Condition</Label>
              <Select value={condition} onValueChange={setCondition}>
                <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                  <SelectItem value="ABOVE">ABOVE</SelectItem>
                  <SelectItem value="BELOW">BELOW</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-slate-400">Threshold</Label>
              <Input type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="border-slate-700 bg-slate-800/60 text-slate-100" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-slate-400">Hold duration (s)</Label>
              <Input type="number" value={durationSec} onChange={(e) => setDurationSec(e.target.value)} className="border-slate-700 bg-slate-800/60 text-slate-100" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-slate-400">Cooldown (s)</Label>
              <Input type="number" value={cooldownSec} onChange={(e) => setCooldownSec(e.target.value)} className="border-slate-700 bg-slate-800/60 text-slate-100" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-400">Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200 w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                {["CRITICAL", "WARNING", "INFO"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-700 bg-transparent text-slate-300">Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()} style={{ backgroundColor: DH.accent }}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Create Rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
