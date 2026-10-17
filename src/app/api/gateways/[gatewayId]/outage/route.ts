/**
 * DeviceHub API — injected backend outage for the edge gateway (failure testing).
 * POST /api/gateways/[gatewayId]/outage {seconds}  (ADMIN/OPERATOR)
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, fail, serviceFetch, GATEWAY_URL, audit } from "@/lib/services";

export async function POST(req: NextRequest, { params }: { params: Promise<{ gatewayId: string }> }) {
  return handle(async () => {
    const user = await requireRole("ADMIN", "OPERATOR");
    const { gatewayId } = await params;
    const gw = await db.gateway.findUnique({ where: { gatewayId } });
    if (!gw) return fail(404, "unknown gateway");
    const body = await req.json().catch(() => ({}));
    const seconds = Math.max(10, Math.min(600, Number(body.seconds) || 60));

    const res = await serviceFetch(GATEWAY_URL, "/simulate-offline", {
      method: "POST",
      body: JSON.stringify({ seconds }),
    });
    if (!res.ok) return fail(502, "edge gateway service unreachable");
    const data = await res.json();

    await audit({
      actorType: "USER", actorId: user.id, action: "FAILURE_INJECTION",
      resourceType: "Gateway", resourceId: gatewayId,
      detail: { kind: "simulated backend outage", seconds },
    });
    return NextResponse.json({ ok: true, ...data });
  });
}
