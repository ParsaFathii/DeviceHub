/**
 * DeviceHub API — resolve an alert (OPERATOR+).
 * POST /api/alerts/[alertId]/resolve
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, fail, audit, emitRealtime } from "@/lib/services";

export async function POST(req: NextRequest, { params }: { params: Promise<{ alertId: string }> }) {
  return handle(async () => {
    const user = await requireRole("ADMIN", "OPERATOR");
    const { alertId } = await params;
    const alert = await db.alert.findUnique({ where: { alertId }, include: { device: true } });
    if (!alert) return fail(404, "unknown alert");
    if (alert.state === "RESOLVED") return fail(409, "alert already resolved");

    await db.alert.update({
      where: { id: alert.id },
      data: { state: "RESOLVED", resolvedAt: new Date(), resolvedBy: user.username },
    });
    await audit({
      actorType: "USER", actorId: user.id, action: "ALERT_RESOLVED",
      resourceType: "Alert", resourceId: alertId,
      detail: { device: alert.device.deviceId, severity: alert.severity },
    });
    await emitRealtime("alert-updated", { alertId, state: "RESOLVED", resolvedBy: user.username });
    return NextResponse.json({ ok: true, alertId, state: "RESOLVED" });
  });
}
