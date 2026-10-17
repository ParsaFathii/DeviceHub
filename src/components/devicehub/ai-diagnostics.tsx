/**
 * DeviceHub — AI Diagnostics view (evidence-grounded assistant).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { StatCard, DH, EmptyState, SimulatorBadge } from "./shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Activity, Send, ShieldAlert, Database, Loader2, Bot, User, CircleCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface QaEntry {
  question: string;
  answer: string;
  evidence?: any;
  ts: string;
  error?: string;
}

const SUGGESTIONS = [
  "Explain the temperature anomaly on DH-ENV-003",
  "Summarize connectivity problems in the fleet",
  "Which devices have the most suspect telemetry quality?",
  "Explain the evidence behind the latest critical alert",
  "What command could an operator send to fix the vibration sensor?",
];

export function AiDiagnosticsView() {
  const [question, setQuestion] = useState("");
  const [entries, setEntries] = useState<QaEntry[]>([]);
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery({
    queryKey: ["ai-status"],
    queryFn: async () => {
      const res = await fetch("/api/ai/status");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  const ask = useMutation({
    mutationFn: async (q: string) => {
      const res = await fetch("/api/ai/diagnostics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      return d;
    },
    onSuccess: (d) => {
      setEntries((prev) => [...prev, { question, answer: d.answer, evidence: d.evidenceSummary, ts: new Date().toISOString() }]);
      setQuestion("");
    },
    onError: (e: any) => {
      setEntries((prev) => [...prev, { question, answer: "", ts: new Date().toISOString(), error: e.message }]);
      toast({ title: "AI unavailable", description: "The platform continues to operate without the AI layer", variant: "destructive" });
    },
  });

  const aiAvailable = status?.status === "available";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="AI Provider"
          value={aiAvailable ? "AVAILABLE" : "UNAVAILABLE"}
          trend={status?.provider || "—"}
          trendUp={aiAvailable}
          iconColor={aiAvailable ? DH.success : DH.danger}
        />
        <StatCard icon={<ShieldAlert className="h-5 w-5" />} label="Command Execution" value="DENIED" trend="advisory layer only" trendUp iconColor={DH.warning} />
        <StatCard icon={<Database className="h-5 w-5" />} label="Grounding" value="RECORDED DATA" trend="telemetry · alerts · anomalies" trendUp iconColor={DH.cyan} />
        <StatCard icon={<Bot className="h-5 w-5" />} label="Credential Access" value="NONE" trend="secrets never provided" trendUp iconColor={DH.success} />
      </div>

      {/* safety banner */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-4" style={{ borderColor: `${DH.warning}44`, backgroundColor: `${DH.warning}0a` }}>
        <ShieldAlert className="h-5 w-5 shrink-0" style={{ color: DH.warning }} />
        <p className="flex-1 text-[11.5px] leading-relaxed" style={{ color: DH.textSecondary }}>
          <span className="font-semibold" style={{ color: DH.warning }}>Evidence boundary:</span> the assistant receives only
          sanitized recorded data (telemetry statistics, alert records, anomaly findings, rule metadata). It must label
          measured facts, rule results, ML outputs, hypotheses and recommendations. It cannot execute commands, bypass
          authorization, access credentials, or invent data — proposals require operator confirmation through the audited
          command system.
        </p>
      </div>

      {/* chat */}
      <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: DH.border }}>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
            <Bot className="h-4 w-4" style={{ color: DH.accent }} /> Diagnostics Assistant
          </h3>
          <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: aiAvailable ? DH.success : DH.danger }}>
            <span className={`h-1.5 w-1.5 rounded-full ${aiAvailable ? "animate-pulse" : ""}`} style={{ backgroundColor: aiAvailable ? DH.success : DH.danger }} />
            {aiAvailable ? "PROVIDER ONLINE" : "PROVIDER OFFLINE — PLATFORM UNAFFECTED"}
          </span>
        </div>

        <div ref={scrollRef} className="max-h-[460px] min-h-[200px] overflow-y-auto p-5">
          {entries.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: `${DH.accent}18`, color: DH.accent }}>
                <Activity className="h-6 w-6" />
              </div>
              <div className="text-center">
                <div className="text-[14px] font-semibold" style={{ color: DH.textPrimary }}>Ask about your fleet</div>
                <div className="mt-1 max-w-[420px] text-[11.5px] leading-relaxed" style={{ color: DH.textSecondary }}>
                  Answers are generated strictly from recorded evidence — with explicit labeling of facts, rule results,
                  ML outputs and hypotheses.
                </div>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => setQuestion(s)}
                    className="rounded-full border px-3 py-1.5 text-[11px] transition-colors hover:bg-slate-700/40"
                    style={{ borderColor: DH.border, color: DH.textSecondary }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {entries.map((e, i) => (
            <div key={i} className="mb-5 space-y-3">
              {/* question */}
              <div className="flex justify-end">
                <div className="max-w-[75%] rounded-2xl rounded-br-md border px-4 py-2.5" style={{ backgroundColor: `${DH.accent}18`, borderColor: `${DH.accent}44` }}>
                  <div className="flex items-center gap-2 text-[10px] font-semibold" style={{ color: DH.accent }}>
                    <User className="h-3 w-3" /> OPERATOR
                  </div>
                  <div className="mt-1 text-[12.5px]" style={{ color: DH.textPrimary }}>{e.question}</div>
                </div>
              </div>
              {/* answer */}
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md border p-4" style={{ backgroundColor: `${DH.surfaceHover}66`, borderColor: DH.border }}>
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold" style={{ color: DH.purple }}>
                    <Bot className="h-3 w-3" /> DEVICEHUB ASSISTANT {e.evidence?.origin === "simulator-labelled" && <SimulatorBadge />}
                  </div>
                  {e.error ? (
                    <div className="text-[12px]" style={{ color: DH.danger }}>{e.error}</div>
                  ) : (
                    <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: DH.textPrimary }}>{e.answer}</div>
                  )}
                  {e.evidence && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 text-[10px]" style={{ borderColor: DH.border, color: DH.textSecondary }}>
                      <span className="flex items-center gap-1"><CircleCheck className="h-3 w-3" style={{ color: DH.success }} /> evidence:</span>
                      <span>{e.evidence.devices} devices</span>
                      <span>{e.evidence.alerts} alerts</span>
                      <span>{e.evidence.anomalies} anomalies</span>
                      <span>{e.evidence.telemetrySeries} telemetry series</span>
                      <span>{e.evidence.rules} rules</span>
                      <span>· window: {e.evidence.window}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {ask.isPending && (
            <div className="flex items-center gap-2 text-[11.5px]" style={{ color: DH.textSecondary }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> gathering recorded evidence and consulting the model…
            </div>
          )}
        </div>

        <div className="border-t p-4" style={{ borderColor: DH.border }}>
          <div className="flex gap-2">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && question.trim()) {
                  e.preventDefault();
                  ask.mutate(question);
                }
              }}
              placeholder="Ask about devices, alerts, anomalies, telemetry… (Enter to send)"
              className="min-h-[44px] resize-none border-slate-700 bg-slate-800/60 text-[12.5px] text-slate-100 placeholder:text-slate-500"
              rows={2}
            />
            <Button
              onClick={() => question.trim() && ask.mutate(question)}
              disabled={ask.isPending || !question.trim()}
              className="h-11 gap-1.5 self-end"
              style={{ backgroundColor: DH.accent }}
            >
              {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Ask
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
