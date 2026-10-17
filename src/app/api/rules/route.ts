/**
 * DeviceHub API — automation rules.
 * GET  /api/rules
 * POST /api/rules (ADMIN/OPERATOR) — creates a rule (version 1)
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireRole } from "@/lib/auth";
import { handle, fail, audit, emitRealtime } from "@/lib/services";
import { randomUUID } from "crypto";

const METRICS = ["temperature", "humidity", "pressure", "motion", "power", "energy", "vibration", "voltage", "current", "status"];

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const rules = await db.automationRule.findMany({
      orderBy: { priority: "asc" },
      include: { executions: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
    const [totalFired, totalSuppressed] = await Promise.all([
      db.ruleExecution.count({ where: { outcome: "FIRED" } }),
      db.ruleExecution.count({ where: { outcome: "SUPPRESSED_COOLDOWN" } }),
    ]);
    return NextResponse.json({
      rules: rules.map((r) => ({
        ruleId: r.ruleId,
        name: r.name,
        enabled: r.enabled,
        deviceSelector: safe(r.deviceSelector),
        metric: r.metric,
        condition: r.condition,
        threshold: r.threshold,
        durationSec: r.durationSec,
        severity: r.severity,
        cooldownSec: r.cooldownSec,
        priority: r.priority,
        version: r.version,
        lastTriggeredAt: r.lastTriggeredAt?.toISOString() || null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        recentExecutions: r.executions.map((e) => ({
          outcome: e.outcome, detail: safe(e.detail), createdAt: e.createdAt.toISOString(),
        })),
      })),
      stats: { totalFired, totalSuppressed },
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireRole("ADMIN", "OPERATOR");
    const body = await req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || !body.name.trim()) return fail(400, "name required");
    if (!METRICS.includes(body.metric)) return fail(400, `metric must be one of ${METRICS.join(", ")}`);
    if (body.condition !== "ABOVE" && body.condition !== "BELOW") return fail(400, "condition must be ABOVE or BELOW");
    if (!Number.isFinite(body.threshold)) return fail(400, "threshold must be a number");
    const durationSec = Math.max(0, Math.min(3600, Number(body.durationSec) || 0));
    const cooldownSec = Math.max(0, Math.min(86400, Number(body.cooldownSec) || 300));
    const severity = ["CRITICAL", "WARNING", "INFO"].includes(body.severity) ? body.severity : "WARNING";

    const selector: any = {};
    if (body.deviceSelector?.deviceId && /^DH-[A-Z0-9-]+$/.test(body.deviceSelector.deviceId)) selector.deviceId = body.deviceSelector.deviceId;
    else if (body.deviceSelector?.type) selector.type = body.deviceSelector.type;
    else return fail(400, "deviceSelector requires deviceId or type");

    const ruleId = `rule-${randomUUID().slice(0, 6)}`;
    const rule = await db.automationRule.create({
      data: {
        ruleId,
        name: body.name.slice(0, 80),
        enabled: true,
        deviceSelector: JSON.stringify(selector),
        metric: body.metric,
        condition: body.condition,
        threshold: Number(body.threshold),
        durationSec,
        severity,
        cooldownSec,
        priority: Math.max(1, Math.min(9, Number(body.priority) || 5)),
        version: 1,
        createdById: user.id,
      },
    });
    await audit({
      actorType: "USER", actorId: user.id, action: "RULE_CREATED",
      resourceType: "AutomationRule", resourceId: ruleId,
      detail: { name: rule.name, metric: rule.metric, threshold: rule.threshold, condition: rule.condition, durationSec, cooldownSec },
    });
    await emitRealtime("activity", { type: "RULE", message: `Automation rule created: ${rule.name} (${ruleId})`, ts: new Date().toISOString() });
    return NextResponse.json({ rule: { ruleId, name: rule.name, enabled: true, version: 1 } }, { status: 201 });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
