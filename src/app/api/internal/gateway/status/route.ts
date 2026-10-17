/**
 * DeviceHub internal API — gateway heartbeat with live metrics.
 * POST /api/internal/gateway/status {gatewayId, state, metrics}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail } from "@/lib/services";

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const body = await req.json().catch(() => null);
  if (!body || typeof body.gatewayId !== "string") return fail(400, "gatewayId required");
  const gw = await db.gateway.findUnique({ where: { gatewayId: body.gatewayId } });
  if (!gw) return fail(404, "unknown gateway");

  await db.gateway.update({
    where: { id: gw.id },
    data: {
      state: body.state || gw.state,
      lastSeenAt: new Date(),
      metrics: JSON.stringify(body.metrics || {}),
    },
  });
  return ok({ ok: true });
}
