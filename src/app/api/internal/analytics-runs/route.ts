/**
 * DeviceHub internal API — analytics run records.
 * POST /api/internal/analytics-runs {kind, model, status, detail}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail } from "@/lib/services";

export async function POST(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const body = await req.json().catch(() => null);
  if (!body || typeof body.kind !== "string") return fail(400, "kind required");
  const run = await db.analyticsRun.create({
    data: {
      kind: String(body.kind).slice(0, 40),
      model: body.model ? String(body.model).slice(0, 60) : null,
      status: ["RUNNING", "COMPLETED", "FAILED"].includes(body.status) ? body.status : "RUNNING",
      detail: JSON.stringify(body.detail || {}),
      finishedAt: body.status === "COMPLETED" || body.status === "FAILED" ? new Date() : null,
    },
  });
  return ok({ id: run.id });
}
