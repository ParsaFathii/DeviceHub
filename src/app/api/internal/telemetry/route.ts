/**
 * DeviceHub internal API — telemetry ingestion + export.
 *
 * POST /api/internal/telemetry  {messages: [{topic, payload, parsed}], fromBuffer}
 *   Batch ingest from the edge gateway. Final dedup guard via the
 *   (deviceId, metric, sequence) unique constraint. Delayed samples are
 *   preserved and flagged, never discarded.
 *
 * GET /api/internal/telemetry?deviceId&metric&from&to&hours&limit
 *   Export for the analytics service.
 *
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail, emitRealtime } from "@/lib/services";

interface IngestMetric {
  metric: string;
  value: number;
  unit: string;
  quality: string;
}

interface IngestMessage {
  topic: string;
  payload: string;
  parsed: {
    v: number;
    deviceId: string;
    msgId: string;
    seq: number;
    ts: number;
    metrics: IngestMetric[];
    sim?: boolean;
    profile?: string;
  } | null;
}

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.messages)) return fail(400, "messages array required");
  if (body.messages.length > 500) return fail(413, "batch too large (max 500)");

  const fromBuffer = body.fromBuffer === true;
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  const errors: string[] = [];
  const acceptedSamples: any[] = [];

  // cache latest sampleTs per (deviceId, metric) for delayed-flag computation
  const latestTs = new Map<string, Date>();

  for (const msg of body.messages as IngestMessage[]) {
    const env = msg.parsed ?? safeJson(msg.payload);
    if (!env || env.v !== 1 || typeof env.deviceId !== "string" || !Array.isArray(env.metrics)) {
      rejected++;
      errors.push(`invalid envelope on ${msg.topic || "?"}`);
      continue;
    }
    const device = await db.device.findUnique({ where: { deviceId: env.deviceId } });
    if (!device) {
      rejected++;
      errors.push(`unknown device ${env.deviceId}`);
      continue;
    }

    const sampleTs = new Date(Number.isFinite(env.ts) ? env.ts : Date.now());
    if (isNaN(sampleTs.getTime())) {
      rejected++;
      errors.push(`invalid timestamp for ${env.deviceId}`);
      continue;
    }

    for (const m of env.metrics) {
      if (typeof m.metric !== "string" || !Number.isFinite(m.value)) {
        rejected++;
        errors.push(`invalid metric entry for ${env.deviceId}`);
        continue;
      }
      const key = `${device.id}:${m.metric}`;
      if (!latestTs.has(key)) {
        const latest = await db.telemetrySample.findFirst({
          where: { deviceId: device.id, metric: m.metric },
          orderBy: { sampleTs: "desc" },
          select: { sampleTs: true },
        });
        latestTs.set(key, latest?.sampleTs ?? new Date(0));
      }
      const latest = latestTs.get(key)!;
      const delayed = sampleTs < latest;

      try {
        const row = await db.telemetrySample.create({
          data: {
            schemaVersion: 1,
            deviceId: device.id,
            gatewayId: "edge-gw-01",
            metric: m.metric,
            value: m.value,
            unit: m.unit || "",
            quality: m.quality === "GOOD" || m.quality === "SUSPECT" || m.quality === "BAD" ? m.quality : "GOOD",
            meta: JSON.stringify({ msgId: env.msgId, profile: env.profile || null }),
            sampleTs,
            receivedTs: new Date(),
            messageId: env.msgId,
            sequence: env.seq,
            delayed,
            simulated: env.sim === true,
          },
        });
        accepted++;
        latestTs.set(key, sampleTs > latest ? sampleTs : latest);
        acceptedSamples.push({
          deviceId: env.deviceId,
          metric: m.metric,
          value: m.value,
          unit: m.unit || "",
          quality: m.quality,
          sampleTs: sampleTs.toISOString(),
          seq: env.seq,
          delayed,
          simulated: env.sim === true,
        });
      } catch (e: any) {
        if (String(e?.code) === "P2002") {
          duplicates++; // unique (deviceId, metric, sequence) — repeated delivery
        } else {
          rejected++;
          errors.push(`db error: ${e.message}`);
        }
      }
    }
  }

  // device lastSeen/state updates (one per message with valid deviceId)
  const seenDevices = new Set((body.messages as IngestMessage[])
    .map((m) => m.parsed?.deviceId ?? safeJson(m.payload)?.deviceId)
    .filter((id): id is string => typeof id === "string" && id.startsWith("DH-")));
  for (const deviceId of seenDevices) {
    await db.device.updateMany({
      where: { deviceId, state: { not: "RETIRED" } },
      data: { lastSeenAt: new Date() },
    });
    await db.device.updateMany({
      where: { deviceId, state: { in: ["PROVISIONED", "OFFLINE", "ERROR"] } },
      data: { state: "ONLINE" },
    });
  }

  if (fromBuffer && acceptedSamples.length > 0) {
    // backfilled (offline-buffered) data — emit so clients see recovery history
    await emitRealtime("telemetry", {
      backfill: true,
      samples: acceptedSamples.slice(0, 400),
    });
    await emitRealtime("activity", {
      type: "TELEMETRY",
      message: `${accepted} offline-buffered samples stored (backfill from edge spool)`,
      ts: new Date().toISOString(),
    });
  }

  return ok({ accepted, duplicates, rejected, errors: errors.slice(0, 10) });
}

export async function GET(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const sp = req.nextUrl.searchParams;
  const deviceId = sp.get("deviceId");
  const metric = sp.get("metric");
  const limit = Math.min(5000, Math.max(1, Number(sp.get("limit") || 2000)));
  const from = sp.get("from");
  const to = sp.get("to");

  const where: any = {};
  if (deviceId) {
    const d = await db.device.findUnique({ where: { deviceId }, select: { id: true } });
    if (!d) return ok({ samples: [] });
    where.deviceId = d.id;
  }
  if (metric) where.metric = metric;
  const hoursParam = sp.get("hours");
  if (from || to || hoursParam !== null) {
    where.sampleTs = {};
    if (from) where.sampleTs.gte = new Date(from);
    if (to) where.sampleTs.lte = new Date(to);
    if (!from && !to && hoursParam !== null) {
      const h = Number(hoursParam);
      if (Number.isFinite(h)) where.sampleTs.gte = new Date(Date.now() - h * 3600_000);
    }
  }

  const rowsDesc = await db.telemetrySample.findMany({
    where,
    orderBy: { sampleTs: "desc" },
    take: limit,
    select: {
      deviceId: true, metric: true, value: true, unit: true,
      sampleTs: true, quality: true, sequence: true, delayed: true, simulated: true,
    },
  });
  // newest-first query, returned oldest-first (chronological) for consumers
  const rows = rowsDesc.reverse();
  const idMap = new Map<string, string>();
  if (deviceId && rows.length) {
    const d = await db.device.findUnique({ where: { deviceId }, select: { id: true } });
    if (d) idMap.set(d.id, deviceId);
  } else {
    const devs = await db.device.findMany({ select: { id: true, deviceId: true } });
    for (const d of devs) idMap.set(d.id, d.deviceId);
  }

  return ok({
    samples: rows.map((r) => ({
      deviceId: idMap.get(r.deviceId) || r.deviceId,
      metric: r.metric,
      value: r.value,
      unit: r.unit,
      sampleTs: r.sampleTs.toISOString(),
      quality: r.quality,
      sequence: r.sequence,
      delayed: r.delayed,
      simulated: r.simulated,
    })),
  });
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
