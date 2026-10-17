/**
 * DeviceHub API — rule execution history.
 * GET /api/rules/[ruleId]/executions?limit
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, fail } from "@/lib/services";

export async function GET(req: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  return handle(async () => {
    await requireUser();
    const { ruleId } = await params;
    const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 100)));
    const rule = await db.automationRule.findUnique({ where: { ruleId } });
    if (!rule) return fail(404, "unknown rule");
    const executions = await db.ruleExecution.findMany({
      where: { ruleId: rule.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { device: { select: { deviceId: true, name: true } } },
    });
    return NextResponse.json({
      executions: executions.map((e) => ({
        outcome: e.outcome,
        deviceId: e.device.deviceId,
        deviceName: e.device.name,
        detail: safe(e.detail),
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
