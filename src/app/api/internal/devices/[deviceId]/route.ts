/**
 * DeviceHub internal API — device state/health updates from the edge gateway.
 * PATCH /api/internal/devices/[deviceId] {state?, health?, reason?}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail, audit, emitRealtime } from "@/lib/services";

const VALID_STATES = ["UNPROVISIONED", "PROVISIONED", "ONLINE", "OFFLINE", "DEGRADED", "MAINTENANCE", "ERROR", "RETIRED"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const { deviceId } = await params;
  const body = await req.json().catch(() => ({}));
  const device = await db.device.findUnique({ where: { deviceId } });
  if (!device) return fail(404, "unknown device");

  const data: Record<string, unknown> = { lastSeenAt: new Date() };

  if (typeof body.health === "number") {
    data.health = Math.max(0, Math.min(100, Math.round(body.health)));
  }

  if (typeof body.state === "string" && VALID_STATES.includes(body.state)) {
    if (device.state === "RETIRED" && body.state !== "RETIRED") {
      return fail(409, "retired devices cannot come back online — reprovision required");
    }
    if (device.state !== body.state) {
      data.state = body.state;
      await db.deviceEvent.create({
        data: {
          deviceId: device.id,
          type: body.state,
          detail: JSON.stringify({ reason: body.reason || "gateway-reported", from: device.state }),
        },
      });
      await audit({
        actorType: "GATEWAY",
        action: "DEVICE_STATE_CHANGE",
        resourceType: "Device",
        resourceId: deviceId,
        detail: { from: device.state, to: body.state, reason: body.reason || null },
      });
      await emitRealtime("device-state", {
        deviceId,
        state: body.state,
        lastSeenAt: new Date().toISOString(),
        health: data.health ?? device.health,
        reason: body.reason || null,
      });
    }
  }

  await db.device.update({ where: { id: device.id }, data });
  return ok({ ok: true, deviceId, state: data.state ?? device.state });
}
