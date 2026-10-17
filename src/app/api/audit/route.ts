/**
 * DeviceHub API — audit trail.
 * GET /api/audit?action&resourceType&outcome&limit
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
    const action = sp.get("action");
    const resourceType = sp.get("resourceType");
    const outcome = sp.get("outcome");
    const limit = Math.min(500, Math.max(1, Number(sp.get("limit") || 100)));

    const where: any = {};
    if (action) where.action = { contains: action };
    if (resourceType) where.resourceType = resourceType;
    if (outcome) where.outcome = outcome;

    const events = await db.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { actor: { select: { username: true, name: true } } },
    });

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        actorType: e.actorType,
        actor: e.actor?.username || e.actorType,
        actorName: e.actor?.name || null,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        outcome: e.outcome,
        detail: safe(e.detail),
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
