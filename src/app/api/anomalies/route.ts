/**
 * DeviceHub API — anomaly findings list + analytics run history.
 * GET /api/anomalies?deviceId&model&limit
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/services";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const deviceId = sp.get("deviceId");
    const model = sp.get("model");
    const limit = Math.min(500, Math.max(1, Number(sp.get("limit") || 100)));

    const where: any = {};
    if (deviceId) {
      const d = await db.device.findUnique({ where: { deviceId }, select: { id: true } });
      if (!d) return NextResponse.json({ findings: [], runs: [] });
      where.deviceId = d.id;
    }
    if (model) where.model = model;

    const findings = await db.anomalyFinding.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      take: limit,
      include: { device: { select: { deviceId: true, name: true, zone: true } } },
    });

    const runs = await db.analyticsRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 10,
    });

    return NextResponse.json({
      findings: findings.map((f) => ({
        id: f.id,
        deviceId: f.device.deviceId,
        deviceName: f.device.name,
        zone: f.device.zone,
        metric: f.metric,
        score: f.score,
        baselineScore: f.baselineScore,
        model: f.model,
        modelVersion: f.modelVersion,
        windowStart: f.windowStart.toISOString(),
        windowEnd: f.windowEnd.toISOString(),
        detectedAt: f.detectedAt.toISOString(),
        details: safe(f.details),
      })),
      runs: runs.map((r) => ({
        kind: r.kind, model: r.model, status: r.status,
        detail: safe(r.detail), startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() || null,
      })),
    });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
