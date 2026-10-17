/**
 * DeviceHub API — gateway fleet status.
 * GET /api/gateways
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/services";

export async function GET() {
  return handle(async () => {
    await requireUser();
    const gateways = await db.gateway.findMany({
      orderBy: { gatewayId: "asc" },
      include: { _count: { select: { devices: true } } },
    });
    return NextResponse.json({
      gateways: gateways.map((g) => ({
        gatewayId: g.gatewayId,
        name: g.name,
        version: g.version,
        state: g.state,
        devices: g._count.devices,
        lastSeenAt: g.lastSeenAt?.toISOString() || null,
        registeredAt: g.registeredAt.toISOString(),
        capabilities: safe(g.capabilities),
        metrics: safe(g.metrics),
      })),
    });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
