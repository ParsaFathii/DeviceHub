/**
 * DeviceHub internal API — rule execution history records from the edge engine.
 * POST /api/internal/rule-executions {ruleId, deviceId, outcome, detail}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail } from "@/lib/services";

const OUTCOMES = ["FIRED", "SUPPRESSED_COOLDOWN", "CONDITION_MET_WAITING", "NOT_MET", "ERROR"];

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const body = await req.json().catch(() => null);
  if (!body || typeof body.ruleId !== "string" || typeof body.deviceId !== "string") {
    return fail(400, "ruleId and deviceId required");
  }
  const rule = await db.automationRule.findUnique({ where: { ruleId: body.ruleId } });
  const device = await db.device.findUnique({ where: { deviceId: body.deviceId } });
  if (!rule || !device) return fail(404, "unknown rule or device");

  const outcome = OUTCOMES.includes(body.outcome) ? body.outcome : "ERROR";
  const exec = await db.ruleExecution.create({
    data: {
      ruleId: rule.id,
      deviceId: device.id,
      outcome,
      detail: JSON.stringify(body.detail || {}),
    },
  });
  return ok({ id: exec.id, outcome });
}
