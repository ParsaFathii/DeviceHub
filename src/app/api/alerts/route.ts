/**
 * DeviceHub API — alert list.
 * GET /api/alerts?state&severity&deviceId&limit
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
    const state = sp.get("state");
    const severity = sp.get("severity");
    const deviceId = sp.get("deviceId");
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit") || 100)));

    const where: any = {};
    if (state) where.state = state;
    if (severity) where.severity = severity;
    if (deviceId) {
      const d = await db.device.findUnique({ where: { deviceId }, select: { id: true } });
      if (!d) return NextResponse.json({ alerts: [], kpis: { total: 0, critical: 0, warning: 0, info: 0, resolvedToday: 0 } });
      where.deviceId = d.id;
    }

    const alerts = await db.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { device: { select: { deviceId: true, name: true, zone: true, group: { select: { name: true } } } } },
    });

    const [total, critical, warning, info, resolvedToday] = await Promise.all([
      db.alert.count(),
      db.alert.count({ where: { state: "ACTIVE", severity: "CRITICAL" } }),
      db.alert.count({ where: { state: "ACTIVE", severity: "WARNING" } }),
      db.alert.count({ where: { state: "ACTIVE", severity: "INFO" } }),
      db.alert.count({ where: { state: "RESOLVED", resolvedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    ]);

    return NextResponse.json({
      alerts: alerts.map((a) => ({
        alertId: a.alertId,
        deviceId: a.device?.deviceId,
        deviceName: a.device?.name,
        zone: a.device?.zone,
        severity: a.severity,
        title: a.title,
        message: a.message,
        state: a.state,
        ruleId: a.ruleId,
        evidence: safe(a.evidence),
        createdAt: a.createdAt.toISOString(),
        acknowledgedAt: a.acknowledgedAt?.toISOString() || null,
        acknowledgedBy: a.acknowledgedBy,
        resolvedAt: a.resolvedAt?.toISOString() || null,
        resolvedBy: a.resolvedBy,
      })),
      kpis: { total, critical, warning, info, resolvedToday },
    });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
