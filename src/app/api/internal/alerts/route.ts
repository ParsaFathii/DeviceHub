/**
 * DeviceHub internal API — alert creation from the edge automation engine.
 * POST /api/internal/alerts {ruleId, deviceId, severity, title, message, evidence}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail, audit, emitRealtime } from "@/lib/services";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const body = await req.json().catch(() => null);
  if (!body || typeof body.deviceId !== "string" || typeof body.title !== "string") {
    return fail(400, "deviceId and title are required");
  }
  const device = await db.device.findUnique({ where: { deviceId: body.deviceId } });
  if (!device) return fail(404, "unknown device");

  const severity = ["CRITICAL", "WARNING", "INFO"].includes(body.severity) ? body.severity : "WARNING";

  // create alert
  const alert = await db.alert.create({
    data: {
      alertId: `AL-${randomUUID().slice(0, 8).toUpperCase()}`,
      deviceId: device.id,
      ruleId: body.ruleId || null,
      severity,
      title: body.title.slice(0, 160),
      message: (body.message || body.title).slice(0, 800),
      evidence: JSON.stringify(body.evidence || {}),
    },
  });

  // update rule lastTriggeredAt + execution record FIRED
  if (body.ruleId) {
    await db.automationRule.update({
      where: { ruleId: body.ruleId },
      data: { lastTriggeredAt: new Date() },
    }).catch(() => undefined);
    const rule = await db.automationRule.findUnique({ where: { ruleId: body.ruleId } });
    if (rule) {
      await db.ruleExecution.create({
        data: {
          ruleId: rule.id,
          deviceId: device.id,
          outcome: "FIRED",
          detail: JSON.stringify({ alertId: alert.alertId, evidence: body.evidence || {} }),
        },
      });
    }
  }

  await audit({
    actorType: "GATEWAY",
    action: "ALERT_RAISED",
    resourceType: "Alert",
    resourceId: alert.alertId,
    detail: { ruleId: body.ruleId || null, severity, device: body.deviceId },
  });

  await emitRealtime("alert", {
    alertId: alert.alertId,
    deviceId: body.deviceId,
    deviceName: device.name,
    ruleId: body.ruleId || null,
    severity,
    title: alert.title,
    message: alert.message,
    state: "ACTIVE",
    createdAt: alert.createdAt.toISOString(),
    evidence: body.evidence || {},
  });
  await emitRealtime("activity", {
    type: severity === "CRITICAL" ? "ALERT" : "ALERT",
    message: `${severity} alert: ${alert.title} (${device.name})`,
    ts: alert.createdAt.toISOString(),
  });

  return ok({ alertId: alert.alertId, created: true });
}
