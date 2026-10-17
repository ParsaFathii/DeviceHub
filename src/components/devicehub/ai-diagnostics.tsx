/**
 * DeviceHub — AI Diagnostics view (v2: streaming, multi-turn, persisted history).
 *
 * Layout: KPI row → safety banner → chat card (history drawer + streaming
 * messages + quick actions + composer). Design language follows the shared v2
 * token system (DH tokens, gradient icon chips, tabular figures).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  StatCard, DH, rgba, EmptyState, SimulatorBadge, timeAgo, fmtInt,
} from "./shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Activity, Send, ShieldAlert, Database, Loader2, Bot, User, Copy, Check,
  ChevronDown, History, Plus, Trash2, FileText, Sparkles, WifiOff,
  AlertTriangle, Terminal, MessagesSquare, CircleCheck, Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---- types -------------------------------------------------------------------

interface EvidenceSummary {
  devices: number;
  alerts: number;
  anomalies: number;
  telemetrySeries: number;
  rules: number;
  gateways: number;
  commands: number;
  correlations: number;
  window: string;
  origin: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  latencyMs?: number;
  evidence?: EvidenceSummary | null;
  ts: string;
  error?: string;
}

interface HistorySession {
  sessionId: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
  interactionCount: number;
}

interface DeviceLite {
  deviceId: string;
  name: string;
  state: string;
}

const SESSION_KEY = "dh-ai-session";
const MAX_QUESTION = 500;

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---- markdown-lite renderer (custom, no external packages) --------------------

const TOKEN_COLORS: Record<string, string> = {
  "measured fact": DH.cyan,
  "rule result": DH.accent,
  "ml output": DH.purple,
  hypothesis: DH.warning,
  recommendation: DH.success,
};

const INLINE_RE =
  /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[(?:measured fact|rule result|ML output|hypothesis|recommendation)\]|▍)/gi;

function TokenChip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="mx-0.5 inline-flex translate-y-[-1px] items-center rounded-full px-1.5 py-[1px] text-[9px] font-semibold tracking-wide"
      style={{ color, backgroundColor: rgba(color, 0.10), border: `1px solid ${rgba(color, 0.22)}` }}
    >
      {label}
    </span>
  );
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(INLINE_RE).filter((p) => p !== undefined && p !== "");
  return parts.map((p, i) => {
    const key = `${keyPrefix}-${i}`;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return <strong key={key} className="font-semibold" style={{ color: DH.textPrimary }}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
      return <em key={key} style={{ color: DH.textSecondary }}>{p.slice(1, -1)}</em>;
    }
    if (p === "▍") {
      return (
        <span key={key} className="animate-pulse" style={{ color: DH.accent }} aria-hidden="true">▍</span>
      );
    }
    const bracket = p.match(/^\[(.+)\]$/);
    if (bracket) {
      const color = TOKEN_COLORS[bracket[1].toLowerCase()];
      if (color) return <TokenChip key={key} label={bracket[1]} color={color} />;
    }
    return <span key={key}>{p}</span>;
  });
}

function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} className="ml-1 space-y-1">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed" style={{ color: DH.textPrimary }}>
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: DH.accent }} aria-hidden="true" />
            <span className="min-w-0">{renderInline(b, `li-${key}-${i}`)}</span>
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const t = line.trim();
    if (t.startsWith("### ")) {
      flushBullets(`h-${i}`);
      blocks.push(
        <div key={`h-${i}`} className="mt-1 text-[12.5px] font-bold tracking-tight" style={{ color: DH.textPrimary }}>
          {renderInline(t.slice(4), `hi-${i}`)}
        </div>
      );
    } else if (t.startsWith("## ")) {
      flushBullets(`h-${i}`);
      blocks.push(
        <div key={`h-${i}`} className="mt-1 text-[13px] font-bold tracking-tight" style={{ color: DH.textPrimary }}>
          {renderInline(t.slice(3), `hi-${i}`)}
        </div>
      );
    } else if (t.startsWith("# ")) {
      flushBullets(`h-${i}`);
      blocks.push(
        <div key={`h-${i}`} className="mt-1 text-[13.5px] font-bold tracking-tight" style={{ color: DH.textPrimary }}>
          {renderInline(t.slice(2), `hi-${i}`)}
        </div>
      );
    } else if (t.startsWith("- ") || t.startsWith("• ")) {
      bullets.push(t.slice(2));
    } else if (t === "") {
      flushBullets(`p-${i}`);
    } else {
      flushBullets(`p-${i}`);
      blocks.push(
        <p key={`p-${i}`} className="text-[12.5px] leading-relaxed" style={{ color: DH.textPrimary }}>
          {renderInline(t, `pi-${i}`)}
        </p>
      );
    }
  });
  flushBullets("end");
  return <div className="space-y-2">{blocks}</div>;
}

// ---- evidence footer (collapsible) ---------------------------------------------

function EvidenceFooter({ evidence }: { evidence: EvidenceSummary }) {
  const [open, setOpen] = useState(false);
  const chips: [string, number | string][] = [
    ["devices", evidence.devices],
    ["alerts", evidence.alerts],
    ["anomalies", evidence.anomalies],
    ["series", evidence.telemetrySeries],
    ["rules", evidence.rules],
    ["gateways", evidence.gateways],
    ["commands", evidence.commands],
    ["correlations", evidence.correlations],
  ];
  return (
    <div className="mt-3 border-t pt-2" style={{ borderColor: DH.borderFaint }}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CircleCheck className="h-3 w-3 shrink-0" style={{ color: DH.success }} aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>evidence</span>
        {chips.filter(([, v]) => typeof v === "number").map(([label, v]) => (
          <span
            key={label as string}
            className="inline-flex items-baseline gap-1 rounded-full px-1.5 py-[1px] text-[9.5px] tabular-nums"
            style={{ color: DH.textSecondary, backgroundColor: rgba(DH.textSecondary, 0.07) }}
          >
            <span className="font-semibold" style={{ color: DH.textPrimary }}>{v as number}</span> {label}
          </span>
        ))}
        <span className="text-[9.5px]" style={{ color: DH.textSecondary }}>· window: {evidence.window}</span>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Hide evidence JSON" : "Show evidence JSON"}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-semibold transition-colors hover:bg-slate-700/40"
          style={{ color: DH.textSecondary }}
        >
          {open ? "hide JSON" : "show JSON"}
          <ChevronDown className="h-3 w-3 transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <pre
          className="mt-2 max-h-40 overflow-auto rounded-lg border p-2 font-mono text-[10px] leading-relaxed"
          style={{ borderColor: DH.borderFaint, backgroundColor: rgba(DH.bg, 0.55), color: DH.textSecondary }}
          aria-label="Evidence summary JSON"
        >
          {JSON.stringify(evidence, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---- assistant bubble -----------------------------------------------------------

function AssistantBubble({ message }: { message: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — non-critical */
    }
  };
  return (
    <div className="flex justify-start">
      <div
        className="max-w-[88%] rounded-2xl rounded-bl-md border p-4 sm:max-w-[85%]"
        style={{ backgroundColor: `${DH.surfaceHover}66`, borderColor: DH.borderSoft, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide" style={{ color: DH.purple }}>
            <Bot className="h-3 w-3" aria-hidden="true" /> DEVICEHUB ASSISTANT
          </span>
          {message.evidence?.origin === "simulator-labelled" && <SimulatorBadge />}
          {typeof message.latencyMs === "number" && (
            <span
              className="inline-flex items-center rounded-full px-1.5 py-[1px] text-[9px] font-semibold tabular-nums"
              style={{ color: DH.cyan, backgroundColor: rgba(DH.cyan, 0.08), border: `1px solid ${rgba(DH.cyan, 0.20)}` }}
            >
              {message.latencyMs} ms
            </span>
          )}
          {!message.error && message.content && (
            <button
              onClick={copy}
              aria-label="Copy answer text"
              title="Copy answer"
              className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-semibold transition-colors hover:bg-slate-700/40"
              style={{ color: copied ? DH.success : DH.textSecondary }}
            >
              {copied ? <Check className="h-3 w-3" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
              {copied ? "copied" : "copy"}
            </button>
          )}
        </div>
        {message.error ? (
          <div className="text-[12px] leading-relaxed" style={{ color: DH.danger }}>{message.error}</div>
        ) : (
          <MarkdownLite text={message.content} />
        )}
        {message.evidence && <EvidenceFooter evidence={message.evidence} />}
      </div>
    </div>
  );
}

// ---- quick actions ----------------------------------------------------------------

const QUICK_ACTIONS: { label: string; icon: typeof FileText; color: string; question: string }[] = [
  {
    label: "Fleet summary report", icon: FileText, color: DH.accent,
    question: "Give me a fleet summary report: device states, zone rollup, active alerts by severity, and the telemetry trends that changed the most.",
  },
  {
    label: "Explain worst anomaly", icon: Sparkles, color: DH.purple,
    question: "Explain the worst anomaly finding currently recorded: which device and metric, what the ML score means, and what could plausibly cause it.",
  },
  {
    label: "Connectivity problems", icon: WifiOff, color: DH.warning,
    question: "Summarize connectivity problems in the fleet: offline or degraded devices, gateway state, buffering/dropped metrics and recent command failures.",
  },
  {
    label: "Devices needing attention", icon: AlertTriangle, color: DH.danger,
    question: "Which devices need attention right now? Rank them by active alerts, anomaly findings, health and correlated signals.",
  },
  {
    label: "Command suggestions", icon: Terminal, color: DH.success,
    question: "Suggest commands an authorized operator could submit for the least healthy devices, and describe the audited confirmation flow they must go through.",
  },
];

// ---- main view ----------------------------------------------------------------------

export function AiDiagnosticsView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<{ text: string; evidence: EvidenceSummary | null } | null>(null);
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState("all");
  const [sessionId, setSessionId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const sessionRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const applySession = useCallback((sid: string) => {
    sessionRef.current = sid;
    setSessionId(sid);
    try {
      localStorage.setItem(SESSION_KEY, sid);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // fresh session on mount — nothing is auto-loaded
  useEffect(() => {
    applySession(newSessionId());
  }, [applySession]);

  // auto-scroll while messages grow / answer streams in
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming?.text, streaming]);

  const { data: status } = useQuery({
    queryKey: ["ai-status"],
    queryFn: async () => {
      const res = await fetch("/api/ai/status");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: historyData } = useQuery({
    queryKey: ["ai-history"],
    queryFn: async () => {
      const res = await fetch("/api/ai/history");
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ sessions: HistorySession[]; total: number }>;
    },
  });

  const { data: devicesData } = useQuery({
    queryKey: ["ai-devices"],
    queryFn: async () => {
      const res = await fetch("/api/devices?limit=50");
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ devices: DeviceLite[] }>;
    },
    staleTime: 300000,
  });

  // ---- ask (SSE streaming) --------------------------------------------------------
  const sendQuestion = useCallback(async (q: string) => {
    const text = q.trim().slice(0, MAX_QUESTION);
    if (!text || streaming || !sessionRef.current) return;
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", content: text, ts: new Date().toISOString() }]);
    setStreaming({ text: "", evidence: null });
    let answer = "";
    let latencyMs: number | undefined;
    let evidence: EvidenceSummary | null = null;
    try {
      const res = await fetch("/api/ai/diagnostics/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: text,
          deviceId: scope !== "all" ? scope : undefined,
          sessionId: sessionRef.current,
        }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || `request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: { type: string; text?: string; sessionId?: string; latencyMs?: number; message?: string; evidenceSummary?: EvidenceSummary };
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.type === "meta") {
            evidence = evt.evidenceSummary || null;
            if (evt.sessionId && evt.sessionId !== sessionRef.current) applySession(evt.sessionId);
            setStreaming({ text: answer, evidence });
          } else if (evt.type === "delta" && typeof evt.text === "string") {
            answer += evt.text;
            setStreaming({ text: answer, evidence });
          } else if (evt.type === "done") {
            latencyMs = evt.latencyMs;
          } else if (evt.type === "error") {
            throw new Error(evt.message || "AI provider unavailable");
          }
        }
      }
      if (answer.trim()) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: answer, latencyMs, evidence, ts: new Date().toISOString() },
        ]);
        queryClient.invalidateQueries({ queryKey: ["ai-history"] });
      } else {
        throw new Error("stream ended without an answer");
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", ts: new Date().toISOString(), error: (e as Error).message },
      ]);
      toast({
        title: "AI unavailable",
        description: "The platform continues to operate without the AI layer",
        variant: "destructive",
      });
    } finally {
      setStreaming(null);
    }
  }, [scope, streaming, applySession, queryClient, toast]);

  const newConversation = useCallback(() => {
    if (streaming) return;
    setMessages([]);
    setStreaming(null);
    setQuestion("");
    setHistoryOpen(false);
    applySession(newSessionId());
  }, [streaming, applySession]);

  const loadSession = useCallback(async (sid: string) => {
    if (streaming) return;
    try {
      const res = await fetch(`/api/ai/history?sessionId=${encodeURIComponent(sid)}`);
      if (!res.ok) throw new Error("failed to load transcript");
      const d = (await res.json()) as {
        interactions: { role: string; content: string; latencyMs?: number; evidence?: EvidenceSummary | null; createdAt: string }[];
      };
      setMessages(
        d.interactions.map((i) => ({
          role: i.role === "user" ? ("user" as const) : ("assistant" as const),
          content: i.content,
          latencyMs: i.latencyMs ?? undefined,
          evidence: i.evidence ?? null,
          ts: i.createdAt,
        }))
      );
      applySession(sid);
      setHistoryOpen(false);
    } catch {
      toast({ title: "Could not load conversation", variant: "destructive" });
    }
  }, [streaming, applySession, toast]);

  const deleteSession = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/ai/history?sessionId=${encodeURIComponent(sid)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("failed");
      queryClient.invalidateQueries({ queryKey: ["ai-history"] });
      if (sid === sessionRef.current) newConversation();
    } catch {
      toast({ title: "Could not delete conversation", variant: "destructive" });
    }
  }, [queryClient, newConversation, toast]);

  const aiAvailable = status?.status === "available";
  const isStreaming = streaming !== null;
  const devices = devicesData?.devices || [];
  const sessions = historyData?.sessions || [];
  const canSend = !isStreaming && question.trim().length > 0;

  return (
    <div className="space-y-5">
      {/* ---- KPI row ---- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="AI Provider"
          value={aiAvailable ? "AVAILABLE" : "UNAVAILABLE"}
          trend={aiAvailable ? "streaming · multi-turn" : (status?.error || "provider unreachable").slice(0, 44)}
          trendUp={aiAvailable}
          iconColor={aiAvailable ? DH.success : DH.danger}
        />
        <StatCard
          icon={<MessagesSquare className="h-5 w-5" />}
          label="Conversations Persisted"
          value={historyData ? fmtInt(historyData.total) : "—"}
          trend="ai sessions on record"
          trendNeutral
          iconColor={DH.purple}
        />
        <StatCard
          icon={<ShieldAlert className="h-5 w-5" />}
          label="Command Execution"
          value="DENIED"
          trend="advisory layer only"
          trendNeutral
          iconColor={DH.warning}
        />
        <StatCard
          icon={<Database className="h-5 w-5" />}
          label="Grounding"
          value="RECORDED DATA"
          trend="telemetry · alerts · anomalies · rules · gateways"
          trendNeutral
          iconColor={DH.cyan}
        />
      </div>

      {/* ---- safety banner ---- */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-2xl border p-4"
        style={{ borderColor: rgba(DH.warning, 0.28), backgroundColor: rgba(DH.warning, 0.05), boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `linear-gradient(135deg, ${rgba(DH.warning, 0.20)} 0%, ${rgba(DH.warning, 0.08)} 100%)`, border: `1px solid ${rgba(DH.warning, 0.25)}`, color: DH.warning }}
        >
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="flex-1 text-[11.5px] leading-relaxed" style={{ color: DH.textSecondary }}>
          <span className="font-semibold" style={{ color: DH.warning }}>Evidence boundary:</span> the assistant receives only
          sanitized recorded data (telemetry statistics, alert records, anomaly findings, rule metadata, gateway metrics,
          command outcomes). It must label measured facts, rule results, ML outputs, hypotheses and recommendations. It
          cannot execute commands, bypass authorization, access credentials, or invent data — proposals require operator
          confirmation through the audited command system.
        </p>
      </div>

      {/* ---- chat card ---- */}
      <div
        className="rounded-2xl border"
        style={{ backgroundColor: DH.surface, borderColor: DH.borderSoft, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -18px rgba(0,0,0,0.8)" }}
      >
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4" style={{ borderColor: DH.borderFaint }}>
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-xl"
              style={{
                background: `linear-gradient(135deg, ${rgba(DH.accent, 0.20)} 0%, ${rgba(DH.accent, 0.08)} 100%)`,
                border: `1px solid ${rgba(DH.accent, 0.25)}`,
                color: DH.accent,
                boxShadow: `inset 0 1px 0 ${rgba(DH.accent, 0.18)}`,
              }}
            >
              <Bot className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: DH.textPrimary }}>Diagnostics Assistant</h3>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: aiAvailable ? DH.success : DH.danger }}>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${aiAvailable ? "animate-pulse" : ""}`}
                    style={{ backgroundColor: aiAvailable ? DH.success : DH.danger, boxShadow: `0 0 6px ${rgba(aiAvailable ? DH.success : DH.danger, 0.8)}` }}
                    aria-hidden="true"
                  />
                  {aiAvailable ? "PROVIDER ONLINE" : "PROVIDER OFFLINE — PLATFORM UNAFFECTED"}
                </span>
                <span
                  className="hidden font-mono text-[9px] sm:inline"
                  style={{ color: DH.textSecondary, opacity: 0.75 }}
                  title={sessionId}
                >
                  session {sessionId ? `${sessionId.slice(0, 13)}…` : "—"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen((v) => !v)}
              aria-expanded={historyOpen}
              aria-label="Toggle conversation history"
              className="h-8 gap-1.5 border-slate-700 bg-transparent text-[11px] text-slate-300 hover:bg-slate-700/40"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" /> History
              {historyData?.total ? (
                <span className="rounded-full px-1.5 text-[10px] font-semibold tabular-nums" style={{ backgroundColor: rgba(DH.purple, 0.12), color: DH.purple }}>
                  {historyData.total}
                </span>
              ) : null}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={newConversation}
              disabled={isStreaming}
              aria-label="Start a new conversation"
              className="h-8 gap-1.5 border-slate-700 bg-transparent text-[11px] text-slate-300 hover:bg-slate-700/40"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New Conversation
            </Button>
          </div>
        </div>

        {/* history drawer */}
        {historyOpen && (
          <div className="border-b" style={{ borderColor: DH.borderFaint, backgroundColor: rgba(DH.surfaceHover, 0.35) }}>
            <div className="max-h-56 overflow-y-auto p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>
                <History className="h-3 w-3" aria-hidden="true" /> Conversation history (latest 20)
              </div>
              {sessions.length === 0 ? (
                <EmptyState icon={<MessagesSquare className="h-6 w-6" />} title="No saved conversations yet" subtitle="Ask a question — every session is persisted with its evidence." />
              ) : (
                <div className="space-y-1.5">
                  {sessions.map((s) => {
                    const active = s.sessionId === sessionRef.current;
                    return (
                      <div
                        key={s.sessionId}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open conversation: ${s.title}`}
                        onClick={() => loadSession(s.sessionId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            loadSession(s.sessionId);
                          }
                        }}
                        className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 transition-colors"
                        style={{
                          borderColor: active ? rgba(DH.accent, 0.30) : DH.borderFaint,
                          backgroundColor: active ? rgba(DH.accent, 0.08) : "transparent",
                        }}
                      >
                        <MessagesSquare className="h-3.5 w-3.5 shrink-0" style={{ color: DH.textSecondary }} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[11.5px] font-medium" style={{ color: DH.textPrimary }}>{s.title}</div>
                          <div className="text-[10px] tabular-nums" style={{ color: DH.textSecondary }}>
                            {timeAgo(s.lastActivityAt)} · {s.interactionCount} msgs
                          </div>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Delete conversation: ${s.title}`}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors"
                              style={{ borderColor: rgba(DH.danger, 0.22), color: DH.danger, backgroundColor: rgba(DH.danger, 0.06) }}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="border-slate-700 bg-[#151E2D]">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="text-slate-100">Delete this conversation?</AlertDialogTitle>
                              <AlertDialogDescription className="text-slate-400">
                                &ldquo;{s.title}&rdquo; and its {s.interactionCount} recorded interactions will be removed from AI history. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-700/40">Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteSession(s.sessionId)} style={{ backgroundColor: DH.danger }} className="text-white hover:opacity-90">
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* messages */}
        <div ref={scrollRef} className="max-h-[460px] min-h-[200px] overflow-y-auto p-5" role="log" aria-label="Assistant conversation" aria-live="polite">
          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{
                  background: `linear-gradient(135deg, ${rgba(DH.accent, 0.20)} 0%, ${rgba(DH.accent, 0.08)} 100%)`,
                  border: `1px solid ${rgba(DH.accent, 0.25)}`,
                  color: DH.accent,
                }}
              >
                <Zap className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="text-center">
                <div className="text-[14px] font-semibold" style={{ color: DH.textPrimary }}>Ask about your fleet</div>
                <div className="mx-auto mt-1 max-w-[440px] text-[11.5px] leading-relaxed" style={{ color: DH.textSecondary }}>
                  Answers stream in real time, are grounded strictly in recorded evidence, and label facts, rule results,
                  ML outputs and hypotheses. Use a quick action below or type your own question — sessions are saved so
                  you can continue the conversation later.
                </div>
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="mb-4 flex justify-end">
                <div
                  className="max-w-[75%] rounded-2xl rounded-br-md border px-4 py-2.5"
                  style={{ backgroundColor: rgba(DH.accent, 0.09), borderColor: rgba(DH.accent, 0.27), boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}
                >
                  <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wide" style={{ color: DH.accent }}>
                    <User className="h-3 w-3" aria-hidden="true" /> OPERATOR
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: DH.textPrimary }}>{m.content}</div>
                </div>
              </div>
            ) : (
              <div key={i} className="mb-4">
                <AssistantBubble message={m} />
              </div>
            )
          )}

          {isStreaming && streaming && (
            <div className="mb-4">
              <div className="flex justify-start">
                <div
                  className="max-w-[88%] rounded-2xl rounded-bl-md border p-4 sm:max-w-[85%]"
                  style={{ backgroundColor: `${DH.surfaceHover}66`, borderColor: DH.borderSoft, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide" style={{ color: DH.purple }}>
                      <Bot className="h-3 w-3" aria-hidden="true" /> DEVICEHUB ASSISTANT
                    </span>
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[9px] font-semibold"
                      style={{ color: DH.accent, backgroundColor: rgba(DH.accent, 0.09), border: `1px solid ${rgba(DH.accent, 0.22)}` }}
                    >
                      <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" /> STREAMING
                    </span>
                    {streaming.evidence?.origin === "simulator-labelled" && <SimulatorBadge />}
                  </div>
                  {streaming.text ? (
                    <MarkdownLite text={`${streaming.text}▍`} />
                  ) : (
                    <div className="flex items-center gap-2 text-[11.5px]" style={{ color: DH.textSecondary }}>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> gathering recorded evidence and consulting the model…
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* quick actions */}
        <div className="border-t p-4 pb-2" style={{ borderColor: DH.borderFaint }}>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>Quick actions</div>
          <div className="flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  onClick={() => sendQuestion(a.question)}
                  disabled={isStreaming}
                  aria-label={`Ask: ${a.label}`}
                  className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-medium transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    borderColor: rgba(a.color, 0.22),
                    background: `linear-gradient(135deg, ${rgba(a.color, 0.16)} 0%, ${rgba(a.color, 0.06)} 100%)`,
                    color: DH.textPrimary,
                  }}
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-lg"
                    style={{
                      background: `linear-gradient(135deg, ${rgba(a.color, 0.20)} 0%, ${rgba(a.color, 0.08)} 100%)`,
                      border: `1px solid ${rgba(a.color, 0.25)}`,
                      color: a.color,
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* composer */}
        <div className="p-4 pt-2" style={{ borderTop: `1px solid ${DH.borderFaint}` }}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger
                aria-label="Device scope"
                className="h-11 w-full rounded-xl border-slate-700 bg-slate-800/60 text-[12px] text-slate-200 sm:w-[210px]"
              >
                <SelectValue placeholder="All devices" />
              </SelectTrigger>
              <SelectContent className="max-h-72 border-slate-700 bg-[#151E2D] text-slate-200">
                <SelectItem value="all">All devices</SelectItem>
                {devices.map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.deviceId} — {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && canSend) {
                    e.preventDefault();
                    sendQuestion(question);
                  }
                }}
                maxLength={MAX_QUESTION}
                placeholder="Ask about devices, alerts, anomalies, telemetry, gateways… (Enter to send, Shift+Enter for a new line)"
                aria-label="Question for the diagnostics assistant"
                className="min-h-[44px] resize-none rounded-xl border-slate-700 bg-slate-800/60 pr-16 text-[12.5px] text-slate-100 placeholder:text-slate-500"
                rows={2}
                disabled={isStreaming}
              />
              {question.length > 0 && (
                <span
                  className="pointer-events-none absolute bottom-2 right-3 text-[10px] tabular-nums"
                  style={{ color: question.length >= MAX_QUESTION ? DH.danger : DH.textSecondary }}
                  aria-label={`${question.length} of ${MAX_QUESTION} characters`}
                >
                  {question.length}/{MAX_QUESTION}
                </span>
              )}
            </div>
            <Button
              onClick={() => sendQuestion(question)}
              disabled={!canSend}
              aria-label="Send question"
              className="h-11 gap-1.5 self-end rounded-xl sm:self-auto"
              style={{ backgroundColor: DH.accent }}
            >
              {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              Ask
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
