/**
 * DeviceHub internal API — command lifecycle updates from the edge gateway.
 * PATCH /api/internal/commands/[commandId]/state {state, ackCode?, ackDetail?, result?, sentAt?, completedAt?}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail, audit, emitRealtime } from "@/lib/services";

const VALID = ["REQUESTED", "AUTHORIZED", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"];

// Lifecycle rank — transitions are forward-only. The device acknowledgement and
// the gateway's own "SENT" write race each other over HTTP (simulated devices
// ack in ~1ms), so a stale in-flight transition (e.g. a late SENT arriving after
// SUCCEEDED has already committed) must never overwrite a more advanced state.
const RANK: Record<string, number> = {
  REQUESTED: 0,
  AUTHORIZED: 1,
  QUEUED: 2,
  SENT: 3,
  ACKNOWLEDGED: 4,
  EXECUTING: 5,
  SUCCEEDED: 6,
  FAILED: 6,
  EXPIRED: 6,
  CANCELLED: 6,
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ commandId: string }> }) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const { commandId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !VALID.includes(body.state)) return fail(400, `state must be one of ${VALID.join(", ")}`);

  const command = await db.command.findUnique({
    where: { commandId },
    include: { device: true },
  });
  if (!command) return fail(404, "unknown command");

  // terminal states are final
  if (["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"].includes(command.state)) {
    return fail(409, `command already ${command.state}`);
  }

  const data: Record<string, unknown> = { state: body.state };
  if (body.ackCode) data.ackCode = body.ackCode;
  if (typeof body.ackDetail === "string") data.ackDetail = body.ackDetail.slice(0, 400);
  if (body.result !== undefined) data.result = JSON.stringify(body.result);
  if (body.sentAt) data.sentAt = new Date(body.sentAt);
  if (body.completedAt) data.completedAt = new Date(body.completedAt);
  if (body.state === "ACKNOWLEDGED") data.ackedAt = new Date();

  // Forward-only conditional update: applied iff the command's persisted state
  // is still behind the incoming state (also covers the concurrent-write race).
  const earlier = Object.keys(RANK).filter((s) => RANK[s] < RANK[body.state]);
  const applied = await db.command.updateMany({ where: { id: command.id, state: { in: earlier } }, data });
  if (applied.count === 0) {
    return fail(409, `transition to ${body.state} rejected — command ${commandId} is already at ${command.state} (forward-only lifecycle)`);
  }

  await audit({
    actorType: "GATEWAY",
    action: "COMMAND_STATE_CHANGE",
    resourceType: "Command",
    resourceId: commandId,
    detail: { from: command.state, to: body.state, device: command.device.deviceId, ackCode: body.ackCode || null },
  });

  await emitRealtime("command", {
    commandId,
    deviceId: command.device.deviceId,
    deviceName: command.device.name,
    action: command.action,
    state: body.state,
    ackCode: body.ackCode || null,
    ackDetail: body.ackDetail || null,
    ts: new Date().toISOString(),
  });

  return ok({ ok: true, commandId, state: body.state });
}
