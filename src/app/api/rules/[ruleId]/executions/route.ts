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
    });
    // RuleExecution rows carry the Device internal id (the model declares no
    // `device` relation) — resolve public deviceId + name via a lookup.
    const deviceKeys = [...new Set(executions.map((e) => e.deviceId))];
    const devices = deviceKeys.length
      ? await db.device.findMany({
          where: { id: { in: deviceKeys } },
          select: { id: true, deviceId: true, name: true },
        })
      : [];
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    return NextResponse.json({
      executions: executions.map((e) => ({
        outcome: e.outcome,
        deviceId: deviceById.get(e.deviceId)?.deviceId ?? e.deviceId,
        deviceName: deviceById.get(e.deviceId)?.name ?? "unknown",
        detail: safe(e.detail),
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
