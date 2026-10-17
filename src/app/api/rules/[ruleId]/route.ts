/**
 * DeviceHub API — update an automation rule (versioned edits, audit).
 * PATCH /api/rules/[ruleId] {enabled?, threshold?, durationSec?, cooldownSec?, severity?, name?, condition?}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, fail, audit, emitRealtime } from "@/lib/services";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  return handle(async () => {
    const user = await requireRole("ADMIN", "OPERATOR");
    const { ruleId } = await params;
    const body = await req.json().catch(() => null);
    if (!body) return fail(400, "body required");
    const rule = await db.automationRule.findUnique({ where: { ruleId } });
    if (!rule) return fail(404, "unknown rule");

    const data: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") data.enabled = body.enabled;
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.slice(0, 80);
    if (Number.isFinite(body.threshold)) data.threshold = Number(body.threshold);
    if (body.condition === "ABOVE" || body.condition === "BELOW") data.condition = body.condition;
    if (Number.isFinite(body.durationSec)) data.durationSec = Math.max(0, Math.min(3600, Number(body.durationSec)));
    if (Number.isFinite(body.cooldownSec)) data.cooldownSec = Math.max(0, Math.min(86400, Number(body.cooldownSec)));
    if (["CRITICAL", "WARNING", "INFO"].includes(body.severity)) data.severity = body.severity;

    if (Object.keys(data).length === 0) return fail(400, "no valid fields to update");

    // semantic change → version increment (rule versioning)
    const semanticFields = ["threshold", "condition", "durationSec", "cooldownSec", "severity"];
    const isSemantic = semanticFields.some((f) => f in data);
    if (isSemantic) data.version = rule.version + 1;

    await db.automationRule.update({ where: { id: rule.id }, data });
    await audit({
      actorType: "USER", actorId: user.id, action: "RULE_UPDATED",
      resourceType: "AutomationRule", resourceId: ruleId,
      detail: { fields: Object.keys(data), fromVersion: rule.version, toVersion: isSemantic ? rule.version + 1 : rule.version },
    });
    await emitRealtime("activity", { type: "RULE", message: `Rule ${rule.name} updated v${isSemantic ? rule.version + 1 : rule.version} (${Object.keys(data).join(", ")})`, ts: new Date().toISOString() });
    return NextResponse.json({ ok: true, ruleId, version: isSemantic ? rule.version + 1 : rule.version });
  });
}
