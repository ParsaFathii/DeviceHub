/**
 * DeviceHub internal API — automation rules export for the edge gateway.
 * GET /api/internal/rules
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail } from "@/lib/services";

export async function GET(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const rules = await db.automationRule.findMany({
    where: { enabled: true },
    orderBy: { priority: "asc" },
  });
  return ok({
    rules: rules.map((r) => ({
      ruleId: r.ruleId,
      name: r.name,
      enabled: r.enabled,
      deviceSelector: JSON.parse(r.deviceSelector || "{}"),
      metric: r.metric,
      condition: r.condition,
      threshold: r.threshold,
      durationSec: r.durationSec,
      severity: r.severity,
      cooldownSec: r.cooldownSec,
      priority: r.priority,
      version: r.version,
      lastTriggeredAt: r.lastTriggeredAt?.toISOString() || null,
    })),
  });
}
