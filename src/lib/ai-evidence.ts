/**
 * DeviceHub — AI evidence gathering (server-only, shared by diagnostics routes).
 *
 * Safety boundary (enforced here, not by the model):
 *  - The LLM receives ONLY sanitized evidence: fleet/device summaries, alert
 *    records, anomaly findings, rule metadata, gateway metrics, command
 *    outcomes. No credentials, no secrets, no internal database ids.
 *  - Every device reference is mapped to its PUBLIC deviceId (DH-XXX-NNN).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface EvidenceSummary {
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

export const EVIDENCE_CHAR_LIMIT = 24000;
export const HISTORY_TURNS = 8;
export const AI_MODEL_LABEL = "z-ai-chat";

/** Session ids must be opaque safe tokens (they come from clients). */
export function sanitizeSessionId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

function safe(s: string | null): Record<string, unknown> {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// System prompt — the 7 original safety rules + 3 multi-turn/formatting rules
// ---------------------------------------------------------------------------

export function buildSystemPrompt(): string {
  return `You are the DeviceHub diagnostics assistant, an advisory IoT operations analyst.

RULES YOU MUST FOLLOW:
1. Answer ONLY from the EVIDENCE JSON provided. Never invent measurements, device states, alert counts, scores or events.
2. Explicitly label information types: [measured fact] (telemetry/DB records), [rule result] (deterministic automation), [ML output] (anomaly detector), [hypothesis] (possible explanation), [recommendation] (follow-up check).
3. If the evidence does not contain the answer, say so plainly.
4. You CANNOT execute commands, change configurations, or control devices. If the operator asks for an action, describe the command that an authorized operator could submit through the audited command system, and note that it requires operator confirmation.
5. Anomaly scores are model scores, NOT calibrated probabilities.
6. All fleet data in this deployment comes from clearly-labelled deterministic simulators; mention this when relevant.
7. Be concise and operational. Use short sections or bullets.
8. This may be a multi-turn conversation: use prior turns only for context (e.g. resolving "that device" or "the offline ones"), but re-ground EVERY claim in the CURRENT evidence provided with the latest question.
9. Structure answers with short bold section headers (like **Fleet status**), ### headings and "- " bullet lists so the operator can scan quickly.
10. When an answer implies operational follow-up, end with a short "Suggested operator check" list.

Respond in the same language as the question (English or Persian).`;
}

// ---------------------------------------------------------------------------
// Multi-turn history (persisted AiInteraction rows → LLM message turns)
// ---------------------------------------------------------------------------

export async function loadSessionHistory(sessionId: string, userId: string): Promise<ChatMsg[]> {
  const rows = await db.aiInteraction.findMany({
    where: { sessionId, userId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
    select: { role: true, content: true },
  });
  return rows
    .reverse()
    .map((r) => ({
      role: r.role === "user" ? ("user" as const) : ("assistant" as const),
      content: r.content.slice(0, 4000),
    }))
    .filter((m) => m.content.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Evidence gathering — real recorded data only, public deviceIds only
// ---------------------------------------------------------------------------

interface SeriesAcc {
  samples: { ts: number; v: number }[];
  unit: string;
  latest: number;
  latestTs: string;
  quality: string;
  q: { GOOD: number; SUSPECT: number; BAD: number };
}

export async function gatherEvidence(
  deviceId: string | null
): Promise<{ evidence: Record<string, unknown>; summary: EvidenceSummary }> {
  const evidence: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  const since = new Date(Date.now() - 3600_000);
  const since24 = new Date(Date.now() - 24 * 3600_000);

  // ---- fleet (scoped) ------------------------------------------------------
  const devices = await db.device.findMany({
    where: deviceId ? { deviceId } : { retiredAt: null },
    select: {
      id: true, deviceId: true, name: true, type: true, state: true, health: true,
      zone: true, profile: true, lastSeenAt: true, firmwareVersion: true, gatewayId: true,
    },
    take: 20,
  });
  const idMap = new Map(devices.map((d) => [d.id, d.deviceId]));
  const deviceScope = deviceId ? { device: { deviceId } } : { device: { deviceId: { in: devices.map((d) => d.deviceId) } } };

  evidence.fleet = devices.map((d) => ({
    deviceId: d.deviceId,
    name: d.name,
    type: d.type,
    state: d.state,
    health: d.health,
    zone: d.zone,
    profile: d.profile,
    lastSeenAt: d.lastSeenAt?.toISOString() || null,
    firmwareVersion: d.firmwareVersion,
    note: "simulated device (deterministic simulator)" as const,
  }));

  // ---- alerts (scoped) + active severity breakdown --------------------------
  const alerts = await db.alert.findMany({
    where: deviceScope,
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { device: { select: { deviceId: true } } },
  });
  evidence.recentAlerts = alerts.map((a) => ({
    alertId: a.alertId, deviceId: a.device.deviceId, severity: a.severity, title: a.title,
    state: a.state, createdAt: a.createdAt.toISOString(), evidence: safe(a.evidence),
  }));

  const activeAlerts = await db.alert.findMany({
    where: { state: "ACTIVE", ...deviceScope },
    select: { deviceId: true, severity: true, title: true },
  });
  const severityBreakdown: Record<string, number> = {};
  for (const a of activeAlerts) severityBreakdown[a.severity] = (severityBreakdown[a.severity] || 0) + 1;
  evidence.activeAlertCounts = severityBreakdown;

  // ---- anomalies (scoped) ----------------------------------------------------
  const anomalies = await db.anomalyFinding.findMany({
    where: deviceScope,
    orderBy: { detectedAt: "desc" },
    take: 10,
    include: { device: { select: { deviceId: true } } },
  });
  evidence.anomalyFindings = anomalies.map((a) => ({
    deviceId: a.device.deviceId, metric: a.metric, score: a.score, model: a.model,
    modelVersion: a.modelVersion, window: `${a.windowStart.toISOString()} → ${a.windowEnd.toISOString()}`,
    baselineScore: a.baselineScore, note: "ML output — score is not a calibrated probability",
  }));

  // ---- correlations: anomaly(24h) AND active alert (cross-signal) -----------
  const anomalies24 = await db.anomalyFinding.findMany({
    where: { detectedAt: { gte: since24 }, ...deviceScope },
    select: { deviceId: true, metric: true, score: true, model: true },
  });
  const anomByDevice = new Map<string, { metric: string; score: number; model: string }[]>();
  for (const a of anomalies24) {
    const list = anomByDevice.get(a.deviceId) || [];
    list.push({ metric: a.metric, score: a.score, model: a.model });
    anomByDevice.set(a.deviceId, list);
  }
  const alertsByDevice = new Map<string, { severity: string; title: string }[]>();
  for (const a of activeAlerts) {
    const list = alertsByDevice.get(a.deviceId) || [];
    list.push({ severity: a.severity, title: a.title });
    alertsByDevice.set(a.deviceId, list);
  }
  const correlations = devices
    .filter((d) => anomByDevice.has(d.id) && alertsByDevice.has(d.id))
    .map((d) => ({
      deviceId: d.deviceId,
      name: d.name,
      zone: d.zone,
      state: d.state,
      health: d.health,
      anomalies24h: (anomByDevice.get(d.id) || []).slice(0, 5),
      activeAlerts: (alertsByDevice.get(d.id) || []).slice(0, 5),
      note: "cross-signal: ML anomaly findings AND active alerts on the same device",
    }));
  evidence.correlations = correlations;

  // ---- telemetry stats (scoped): min/max/avg + stddev + trend + quality ------
  const recent = await db.telemetrySample.findMany({
    where: deviceId
      ? { device: { deviceId }, sampleTs: { gte: since } }
      : { sampleTs: { gte: since }, device: { deviceId: { in: devices.map((d) => d.deviceId) } } },
    orderBy: { sampleTs: "desc" },
    take: 600,
    select: { deviceId: true, metric: true, value: true, unit: true, sampleTs: true, quality: true },
  });
  const stats = new Map<string, SeriesAcc>();
  for (const s of recent) {
    const pubId = idMap.get(s.deviceId) || s.deviceId;
    const key = `${pubId}:${s.metric}`;
    const st =
      stats.get(key) ||
      {
        samples: [], unit: s.unit, latest: s.value, latestTs: s.sampleTs.toISOString(),
        quality: s.quality, q: { GOOD: 0, SUSPECT: 0, BAD: 0 },
      };
    st.samples.push({ ts: s.sampleTs.getTime(), v: s.value });
    st.q[s.quality as "GOOD" | "SUSPECT" | "BAD"] = (st.q[s.quality as "GOOD" | "SUSPECT" | "BAD"] || 0) + 1;
    stats.set(key, st);
  }
  evidence.telemetryStats = [...stats.entries()].slice(0, 40).map(([key, st]) => {
    const [dev, metric] = key.split(":");
    const ordered = [...st.samples].sort((a, b) => a.ts - b.ts); // chronological
    const values = ordered.map((p) => p.v);
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const n = values.length || 1;
    const avg = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - avg) * (b - avg), 0) / n;
    const stddev = Math.sqrt(variance);
    // trend: mean of last 10 samples vs previous 10
    const last10 = values.slice(-10);
    const prev10 = values.slice(-20, -10);
    const avgL = last10.reduce((a, b) => a + b, 0) / (last10.length || 1);
    const avgP = prev10.length ? prev10.reduce((a, b) => a + b, 0) / prev10.length : avgL;
    const tol = Math.max(0.01, 0.02 * Math.max(Math.abs(avgL), Math.abs(avgP), 1e-9));
    const trend = prev10.length === 0 ? "insufficient-history" : avgL - avgP > tol ? "rising" : avgP - avgL > tol ? "falling" : "flat";
    return {
      deviceId: dev, metric, latest: st.latest, min, max,
      avg: Number(avg.toFixed(2)), stddev: Number(stddev.toFixed(3)),
      trend: `${trend} (last10 avg ${avgL.toFixed(2)} vs prev10 avg ${avgP.toFixed(2)})`,
      unit: st.unit, samplesLastHour: values.length, latestTs: st.latestTs,
      quality: st.quality, qualityDistribution: st.q,
    };
  });

  // ---- automation rules ------------------------------------------------------
  const rules = await db.automationRule.findMany({
    take: 12,
    select: {
      ruleId: true, name: true, metric: true, condition: true, threshold: true,
      durationSec: true, severity: true, enabled: true, lastTriggeredAt: true,
    },
  });
  evidence.automationRules = rules.map((r) => ({
    ...r, lastTriggeredAt: r.lastTriggeredAt?.toISOString() || null,
    note: "deterministic edge rule" as const,
  }));

  // ---- gateway status + parsed metrics --------------------------------------
  const gatewayIds = new Set(devices.map((d) => d.gatewayId).filter(Boolean));
  const gateways = await db.gateway.findMany({
    where: deviceId ? { id: { in: [...gatewayIds] } } : { state: { not: "RETIRED" } },
    orderBy: { registeredAt: "asc" },
    take: 8,
    select: {
      gatewayId: true, name: true, state: true, version: true, lastSeenAt: true,
      metrics: true, _count: { select: { devices: true } },
    },
  });
  evidence.gatewayStatus = gateways.map((g) => {
    const m = safe(g.metrics);
    return {
      gatewayId: g.gatewayId, name: g.name, state: g.state, version: g.version,
      lastSeenAt: g.lastSeenAt?.toISOString() || null, connectedDevices: g._count.devices,
      metrics: {
        forwarded: num(m.forwarded), buffered: num(m.buffered), deduped: num(m.deduped),
        dropped: num(m.dropped), queueDepth: num(m.queueDepth), uptimeSec: num(m.uptimeSec),
      },
    };
  });

  // ---- recent commands (operator context) -----------------------------------
  const commands = await db.command.findMany({
    where: deviceScope,
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      device: { select: { deviceId: true } },
      requester: { select: { username: true } },
    },
  });
  evidence.recentCommands = commands.map((c) => ({
    deviceId: c.device.deviceId, action: c.action, state: c.state, ackCode: c.ackCode,
    source: c.source, requester: c.requester?.username || "automation/system",
    ageMin: Math.round((Date.now() - c.createdAt.getTime()) / 60000),
    createdAt: c.createdAt.toISOString(),
  }));

  // ---- zone rollup (fleet-wide, unscoped context) ----------------------------
  const zoneDevices = await db.device.findMany({
    where: { retiredAt: null },
    select: { zone: true, state: true, health: true },
  });
  const zoneMap = new Map<string, { zone: string; devices: number; online: number; healthSum: number }>();
  for (const d of zoneDevices) {
    const z = d.zone || "unassigned";
    const acc = zoneMap.get(z) || { zone: z, devices: 0, online: 0, healthSum: 0 };
    acc.devices += 1;
    if (d.state === "ONLINE") acc.online += 1;
    acc.healthSum += d.health;
    zoneMap.set(z, acc);
  }
  evidence.zoneRollup = [...zoneMap.values()].map((z) => ({
    zone: z.zone, devices: z.devices, online: z.online,
    avgHealth: Math.round(z.healthSum / (z.devices || 1)),
  }));

  const summary: EvidenceSummary = {
    devices: devices.length,
    alerts: alerts.length,
    anomalies: anomalies.length,
    telemetrySeries: (evidence.telemetryStats as unknown[]).length,
    rules: rules.length,
    gateways: gateways.length,
    commands: commands.length,
    correlations: correlations.length,
    window: "last hour",
    origin: "simulator-labelled",
  };
  return { evidence, summary };
}

// ---------------------------------------------------------------------------
// LLM message assembly (system + history + evidence + question)
// ---------------------------------------------------------------------------

export function buildLLMMessages(opts: { question: string; evidence: Record<string, unknown>; history: ChatMsg[] }): ChatMsg[] {
  const ev = JSON.stringify(opts.evidence).slice(0, EVIDENCE_CHAR_LIMIT);
  return [
    { role: "system", content: buildSystemPrompt() },
    ...opts.history,
    { role: "user", content: `QUESTION: ${opts.question}\n\nEVIDENCE (real recorded data, JSON):\n${ev}` },
  ];
}

/** Parse the provider's SSE frame stream into text deltas (server-side). */
export async function* iterateProviderStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload) as {
            choices?: { delta?: { content?: string }; finish_reason?: string }[];
          };
          const delta = obj.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        } catch {
          /* skip malformed frame */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
