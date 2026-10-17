/**
 * DeviceHub internal API — anomaly findings persistence from the analytics service.
 * POST /api/internal/anomalies {findings: [{deviceId, metric, windowStart, windowEnd, score, model, modelVersion, baselineScore, details}]}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail, emitRealtime } from "@/lib/services";

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.findings)) return fail(400, "findings array required");
  if (body.findings.length > 5000) return fail(413, "too many findings");

  let accepted = 0;
  const created: any[] = [];
  for (const f of body.findings) {
    if (typeof f.deviceId !== "string" || typeof f.metric !== "string" || !Number.isFinite(f.score)) continue;
    const device = await db.device.findUnique({ where: { deviceId: f.deviceId } });
    if (!device) continue;
    const row = await db.anomalyFinding.create({
      data: {
        deviceId: device.id,
        metric: f.metric,
        windowStart: new Date(f.windowStart || Date.now()),
        windowEnd: new Date(f.windowEnd || Date.now()),
        score: Math.max(0, Math.min(1, Number(f.score))),
        model: String(f.model || "unknown").slice(0, 60),
        modelVersion: String(f.modelVersion || "unknown").slice(0, 40),
        baselineScore: Number.isFinite(f.baselineScore) ? Math.max(0, Math.min(1, Number(f.baselineScore))) : null,
        details: JSON.stringify(f.details || {}),
      },
    });
    accepted++;
    created.push({
      id: row.id,
      deviceId: f.deviceId,
      metric: f.metric,
      score: row.score,
      model: row.model,
      modelVersion: row.modelVersion,
      windowStart: row.windowStart.toISOString(),
      windowEnd: row.windowEnd.toISOString(),
    });
  }

  if (created.length > 0) {
    await emitRealtime("anomaly", { count: created.length, findings: created.slice(0, 50) });
    await emitRealtime("activity", {
      type: "ANOMALY",
      message: `Anomaly detection stored ${created.length} findings (${created[0].model} v${created[0].modelVersion})`,
      ts: new Date().toISOString(),
    });
  }

  return ok({ accepted });
}
