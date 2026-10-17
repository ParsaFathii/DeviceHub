/**
 * DeviceHub API — simulator control (failure injection, deterministic replay).
 * POST /api/simulator/control {deviceId?, action, profile?, seconds?}  (ADMIN/OPERATOR)
 * Actions: pause|resume|duplicate-last|delayed|profile|fleet-pause|fleet-resume|fleet-restart
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, fail, serviceFetch, SIMULATOR_URL, audit } from "@/lib/services";

const DEVICE_ACTIONS = ["pause", "resume", "duplicate-last", "delayed", "profile"];
const FLEET_ACTIONS = ["fleet-pause", "fleet-resume", "fleet-restart"];

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireRole("ADMIN", "OPERATOR");
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string") return fail(400, "action required");

    let path: string;
    let payload: any = {};
    if (FLEET_ACTIONS.includes(body.action)) {
      path = "/fleet";
      payload = { action: body.action.replace("fleet-", "") };
    } else if (DEVICE_ACTIONS.includes(body.action)) {
      if (typeof body.deviceId !== "string") return fail(400, "deviceId required for this action");
      path = "/control";
      payload = { deviceId: body.deviceId, action: body.action, profile: body.profile };
    } else {
      return fail(400, `action must be one of ${[...DEVICE_ACTIONS, ...FLEET_ACTIONS].join(", ")}`);
    }

    try {
      const res = await serviceFetch(SIMULATOR_URL, path, { method: "POST", body: JSON.stringify(payload) });
      const data = await res.json();
      await audit({
        actorType: "USER", actorId: user.id, action: "SIMULATOR_CONTROL",
        resourceType: "Simulator", resourceId: body.deviceId || "fleet",
        detail: { action: body.action, profile: body.profile || null, ok: res.ok },
      });
      return NextResponse.json(data, { status: res.status });
    } catch {
      return fail(503, "simulator service unreachable");
    }
  });
}
