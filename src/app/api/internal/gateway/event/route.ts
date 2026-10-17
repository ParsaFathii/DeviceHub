/**
 * DeviceHub internal API — gateway lifecycle events (CONNECTED/DISCONNECTED/BUFFERING/DRAINING/DRAINED/OVERFLOW).
 * POST /api/internal/gateway/event {gatewayId, type, detail}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail, audit } from "@/lib/services";

const TYPES = ["CONNECTED", "DISCONNECTED", "BUFFERING", "DRAINING", "DRAINED", "OVERFLOW", "RESTARTED"];

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const body = await req.json().catch(() => null);
  if (!body || typeof body.gatewayId !== "string" || !TYPES.includes(body.type)) {
    return fail(400, "gatewayId and valid type required");
  }
  const gw = await db.gateway.findUnique({ where: { gatewayId: body.gatewayId } });
  if (!gw) return fail(404, "unknown gateway");

  await db.gatewayEvent.create({
    data: {
      gatewayId: gw.id,
      type: body.type,
      detail: JSON.stringify(body.detail || {}),
    },
  });

  if (body.type === "BUFFERING") {
    await db.gateway.update({ where: { id: gw.id }, data: { state: "BUFFERING" } });
  } else if (body.type === "DRAINED" || body.type === "CONNECTED") {
    await db.gateway.update({ where: { id: gw.id }, data: { state: "ONLINE", lastSeenAt: new Date() } });
  }

  await audit({
    actorType: "GATEWAY",
    action: `GATEWAY_${body.type}`,
    resourceType: "Gateway",
    resourceId: body.gatewayId,
    detail: body.detail || {},
  });

  return ok({ ok: true });
}
