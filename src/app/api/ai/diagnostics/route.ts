/**
 * DeviceHub API — AI diagnostics (evidence-grounded, advisory only).
 * POST /api/ai/diagnostics {question, deviceId?}
 *
 * Safety boundary (enforced here, not by the model):
 *  - The LLM receives ONLY sanitized evidence: fleet/device summaries, alert
 *    records, anomaly findings, rule metadata. No credentials, no secrets.
 *  - The LLM never executes commands. If the user asks for an action, the
 *    assistant returns a PROPOSAL which must be confirmed and submitted
 *    through the normal audited command flow.
 *  - Output must label measured facts / rule results / ML output / hypotheses.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, fail, audit } from "@/lib/services";
import ZAI from "z-ai-web-dev-sdk";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.slice(0, 500) : "";
    if (!question.trim()) return fail(400, "question required");
    const deviceId = typeof body?.deviceId === "string" && /^DH-[A-Z0-9-]+$/.test(body.deviceId) ? body.deviceId : null;

    // ---- gather evidence (real recorded data only) ------------------------
    const evidence: any = { generatedAt: new Date().toISOString() };

    const devices = await db.device.findMany({
      where: deviceId ? { deviceId } : { retiredAt: null },
      select: { id: true, deviceId: true, name: true, type: true, state: true, health: true, zone: true, profile: true, lastSeenAt: true, firmwareVersion: true },
      take: 20,
    });
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

    const deviceIds = devices.map((d) => d.deviceId);
    const alerts = await db.alert.findMany({
      where: deviceId ? { device: { deviceId } } : { device: { deviceId: { in: deviceIds } } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { device: { select: { deviceId: true } } },
    });
    evidence.recentAlerts = alerts.map((a) => ({
      alertId: a.alertId, deviceId: a.device.deviceId, severity: a.severity, title: a.title,
      state: a.state, createdAt: a.createdAt.toISOString(), evidence: safe(a.evidence),
    }));

    const anomalies = await db.anomalyFinding.findMany({
      where: deviceId ? { device: { deviceId } } : { device: { deviceId: { in: deviceIds } } },
      orderBy: { detectedAt: "desc" },
      take: 10,
      include: { device: { select: { deviceId: true } } },
    });
    evidence.anomalyFindings = anomalies.map((a) => ({
      deviceId: a.device.deviceId, metric: a.metric, score: a.score, model: a.model,
      modelVersion: a.modelVersion, window: `${a.windowStart.toISOString()} → ${a.windowEnd.toISOString()}`,
      baselineScore: a.baselineScore, note: "ML output — score is not a calibrated probability",
    }));

    // latest telemetry stats per device/metric (mapped to PUBLIC deviceIds)
    const since = new Date(Date.now() - 3600_000);
    const idMap = new Map(devices.map((d) => [d.id, d.deviceId]));
    const recent = await db.telemetrySample.findMany({
      where: deviceId ? { device: { deviceId }, sampleTs: { gte: since } } : { sampleTs: { gte: since }, device: { deviceId: { in: deviceIds } } },
      orderBy: { sampleTs: "desc" },
      take: 600,
      select: { deviceId: true, metric: true, value: true, unit: true, sampleTs: true, quality: true },
    });
    const stats = new Map<string, { values: number[]; unit: string; latest: number; latestTs: string; quality: string }>();
    for (const s of recent) {
      const key = `${idMap.get(s.deviceId) || s.deviceId}:${s.metric}`;
      const st = stats.get(key) || { values: [], unit: s.unit, latest: s.value, latestTs: s.sampleTs.toISOString(), quality: s.quality };
      st.values.push(s.value);
      stats.set(key, st);
    }
    evidence.telemetryStats = [...stats.entries()].slice(0, 40).map(([key, st]) => {
      const [dev, metric] = key.split(":");
      const sorted = [...st.values].sort((a, b) => a - b);
      const min = sorted[0], max = sorted[sorted.length - 1];
      const avg = Number((st.values.reduce((a, b) => a + b, 0) / st.values.length).toFixed(2));
      return { deviceId: dev, metric, latest: st.latest, min, max, avg, unit: st.unit, samplesLastHour: st.values.length, latestTs: st.latestTs, quality: st.quality };
    });

    const rules = await db.automationRule.findMany({
      where: deviceId ? {} : {},
      take: 12,
      select: { ruleId: true, name: true, metric: true, condition: true, threshold: true, durationSec: true, severity: true, enabled: true, lastTriggeredAt: true },
    });
    evidence.automationRules = rules.map((r) => ({
      ...r, lastTriggeredAt: r.lastTriggeredAt?.toISOString() || null,
      note: "deterministic edge rule" as const,
    }));

    // ---- call the LLM with a strictly grounded system prompt ---------------
    const systemPrompt = `You are the DeviceHub diagnostics assistant, an advisory IoT operations analyst.

RULES YOU MUST FOLLOW:
1. Answer ONLY from the EVIDENCE JSON provided. Never invent measurements, device states, alert counts, scores or events.
2. Explicitly label information types: [measured fact] (telemetry/DB records), [rule result] (deterministic automation), [ML output] (anomaly detector), [hypothesis] (possible explanation), [recommendation] (follow-up check).
3. If the evidence does not contain the answer, say so plainly.
4. You CANNOT execute commands, change configurations, or control devices. If the operator asks for an action, describe the command that an authorized operator could submit through the audited command system, and note that it requires operator confirmation.
5. Anomaly scores are model scores, NOT calibrated probabilities.
6. All fleet data in this deployment comes from clearly-labelled deterministic simulators; mention this when relevant.
7. Be concise and operational. Use short sections or bullets.

Respond in the same language as the question (English or Persian).`;

    let answer: string;
    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `QUESTION: ${question}\n\nEVIDENCE (real recorded data, JSON):\n${JSON.stringify(evidence).slice(0, 24000)}` },
        ],
        temperature: 0.3,
        max_tokens: 1200,
      });
      answer = completion.choices[0]?.message?.content || "";
    } catch (e: any) {
      await audit({
        actorType: "AI", action: "AI_DIAGNOSTICS", resourceType: "Assistant",
        outcome: "FAILURE", detail: { error: "provider unavailable" },
      });
      return fail(503, `AI provider unavailable: ${e.message || "unknown error"} — the platform continues to operate without the AI layer`);
    }

    await audit({
      actorType: "USER", actorId: user.id, action: "AI_DIAGNOSTICS",
      resourceType: "Assistant",
      detail: { question: question.slice(0, 120), deviceId: deviceId || null, evidenceDevices: devices.length, evidenceAlerts: alerts.length },
    });

    return NextResponse.json({
      answer,
      evidenceSummary: {
        devices: devices.length,
        alerts: alerts.length,
        anomalies: anomalies.length,
        telemetrySeries: evidence.telemetryStats.length,
        rules: rules.length,
        window: "last hour",
        origin: "simulator-labelled",
      },
      safety: {
        advisory: "AI layer is advisory only — it cannot execute commands or bypass authorization",
        proposalsRequireConfirmation: true,
      },
    });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
