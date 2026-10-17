/**
 * DeviceHub API — telemetry explorer query.
 * GET /api/telemetry?deviceId&metric&from&to&hours&intervalSec&limit&threshold
 * Aggregation delegates to the Python analytics service when available,
 * with a deterministic TypeScript fallback (so the explorer degrades gracefully).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, serviceFetch, ANALYTICS_URL, fail } from "@/lib/services";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const deviceId = sp.get("deviceId");
    const metric = sp.get("metric");
    if (!deviceId || !metric) return fail(400, "deviceId and metric are required");
    const hours = Math.min(168, Math.max(0.1, Number(sp.get("hours") || 1)));
    const intervalSec = Math.max(5, Number(sp.get("intervalSec") || 30));
    const limit = Math.min(5000, Math.max(10, Number(sp.get("limit") || 3000)));
    const threshold = sp.get("threshold") ? Number(sp.get("threshold")) : null;

    const device = await db.device.findUnique({ where: { deviceId }, select: { id: true, simulator: true, profile: true } });
    if (!device) return fail(404, "unknown device");

    const from = new Date(Date.now() - hours * 3600_000);
    const rows = await db.telemetrySample.findMany({
      where: { deviceId: device.id, metric, sampleTs: { gte: from } },
      orderBy: { sampleTs: "asc" },
      take: limit,
    });
    if (rows.length === 0) {
      return NextResponse.json({ deviceId, metric, samples: [], buckets: [], gaps: [], totalSamples: 0, outOfOrder: 0, aggregation: "none", simulated: device.simulator });
    }

    // try the Python analytics service for bucketing (falls back to TS below)
    try {
      const res = await serviceFetch(ANALYTICS_URL, `/aggregate`, {
        method: "POST",
        body: JSON.stringify({
          deviceId, metric,
          from: from.toISOString(),
          to: new Date().toISOString(),
          intervalSec,
        }),
      });
      if (res.ok) {
        const agg = await res.json();
        return NextResponse.json({
          deviceId, metric,
          samples: rows.map(mapSample),
          buckets: agg.buckets || [],
          gaps: agg.gaps || [],
          totalSamples: agg.totalSamples ?? rows.length,
          outOfOrder: agg.outOfOrder ?? 0,
          aggregation: `python-analytics (${intervalSec}s buckets)`,
          simulated: device.simulator,
          profile: device.profile,
        });
      }
    } catch { /* fall through to TS aggregation */ }

    // deterministic TS fallback aggregation
    const buckets: any[] = [];
    const gaps: any[] = [];
    const intervalMs = intervalSec * 1000;
    const first = rows[0].sampleTs.getTime();
    const last = rows[rows.length - 1].sampleTs.getTime();
    const bucketCount = Math.min(2000, Math.ceil((last - first) / intervalMs) + 1);
    let outOfOrder = 0;
    let maxTs = 0;
    for (const r of rows) {
      if (r.sampleTs.getTime() < maxTs) outOfOrder++;
      maxTs = Math.max(maxTs, r.sampleTs.getTime());
    }
    for (let i = 0; i < bucketCount; i++) {
      const bStart = first + i * intervalMs;
      const bEnd = bStart + intervalMs;
      const inBucket = rows.filter((r) => r.sampleTs.getTime() >= bStart && r.sampleTs.getTime() < bEnd);
      const bucket: any = {
        start: new Date(bStart).toISOString(),
        count: inBucket.length,
        min: inBucket.length ? Math.min(...inBucket.map((r) => r.value)) : null,
        max: inBucket.length ? Math.max(...inBucket.map((r) => r.value)) : null,
        avg: inBucket.length ? Number((inBucket.reduce((a, r) => a + r.value, 0) / inBucket.length).toFixed(3)) : null,
        missing: false,
      };
      if (inBucket.length === 0 && bStart < last) {
        bucket.missing = true;
        gaps.push({ start: new Date(bStart).toISOString(), end: new Date(bEnd).toISOString() });
      }
      buckets.push(bucket);
    }
    return NextResponse.json({
      deviceId, metric,
      samples: rows.map(mapSample),
      buckets,
      gaps,
      totalSamples: rows.length,
      outOfOrder,
      aggregation: `typescript-fallback (${intervalSec}s buckets)`,
      simulated: device.simulator,
      profile: device.profile,
    });
  });
}

function mapSample(r: any) {
  return {
    value: r.value, unit: r.unit, ts: r.sampleTs.toISOString(),
    quality: r.quality, delayed: r.delayed, seq: r.sequence,
  };
}
