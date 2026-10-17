/**
 * DeviceHub API — gateway detail (live status from the edge service + events + buffer).
 * GET /api/gateways/[gatewayId]
 * POST /api/gateways/[gatewayId]/simulate-offline — injected via /api/gateways/[id]/outage
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireRole } from "@/lib/auth";
import { handle, fail, serviceFetch, GATEWAY_URL, audit, emitRealtime } from "@/lib/services";

export async function GET(req: NextRequest, { params }: { params: Promise<{ gatewayId: string }> }) {
  return handle(async () => {
    await requireUser();
    const { gatewayId } = await params;
    const gw = await db.gateway.findUnique({
      where: { gatewayId },
      include: { devices: { select: { deviceId: true, state: true, health: true, type: true } } },
    });
    if (!gw) return fail(404, "unknown gateway");

    const events = await db.gatewayEvent.findMany({
      where: { gatewayId: gw.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    // live status from the edge service (may be offline — degrade gracefully)
    let live: any = null;
    let buffer: any = null;
    try {
      const res = await serviceFetch(GATEWAY_URL, "/status", { method: "GET" });
      if (res.ok) live = await res.json();
      const bres = await serviceFetch(GATEWAY_URL, "/buffer", { method: "GET" });
      if (bres.ok) buffer = await bres.json();
    } catch { /* edge service unreachable */ }

    return NextResponse.json({
      gateway: {
        gatewayId: gw.gatewayId,
        name: gw.name,
        version: gw.version,
        state: gw.state,
        registeredAt: gw.registeredAt.toISOString(),
        lastSeenAt: gw.lastSeenAt?.toISOString() || null,
        capabilities: safe(gw.capabilities),
        metrics: safe(gw.metrics),
      },
      live,
      buffer,
      devices: gw.devices,
      events: events.map((e) => ({ type: e.type, detail: safe(e.detail), createdAt: e.createdAt.toISOString() })),
    });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
