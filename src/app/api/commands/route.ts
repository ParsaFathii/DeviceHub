/**
 * DeviceHub API — command request + history.
 * GET  /api/commands?deviceId&state&limit
 * POST /api/commands {deviceId, action, payload, source} (OPERATOR+)
 *
 * Lifecycle: REQUESTED → AUTHORIZED → QUEUED → SENT → (ACKNOWLEDGED) → SUCCEEDED/FAILED
 * Success is NEVER reported at API-accept time — only the device acknowledgement
 * (routed through the edge gateway) completes the lifecycle.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireRole } from "@/lib/auth";
import { handle, audit, emitRealtime, fail, serviceFetch, GATEWAY_URL } from "@/lib/services";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const deviceId = sp.get("deviceId");
    const state = sp.get("state");
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit") || 50)));

    // Lazy lifecycle completion: commands still in flight whose expiry has
    // passed transition to EXPIRED (e.g. gateway restart lost the ack wait).
    const expired = await db.command.updateMany({
      where: {
        state: { in: ["REQUESTED", "AUTHORIZED", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING"] },
        expiresAt: { lt: new Date() },
      },
      data: { state: "EXPIRED", completedAt: new Date(), result: JSON.stringify({ error: "expired before acknowledgement" }) },
    });
    if (expired.count > 0) {
      await audit({
        actorType: "SYSTEM",
        action: "COMMAND_EXPIRED",
        resourceType: "Command",
        detail: { count: expired.count, reason: "expiry sweep" },
      });
    }

    const where: any = {};
    if (deviceId) {
      const d = await db.device.findUnique({ where: { deviceId }, select: { id: true } });
      if (!d) return NextResponse.json({ commands: [] });
      where.deviceId = d.id;
    }
    if (state) where.state = state;

    const commands = await db.command.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { device: { select: { deviceId: true, name: true } }, requester: { select: { name: true, username: true } } },
    });

    return NextResponse.json({
      commands: commands.map((c) => ({
        commandId: c.commandId,
        deviceId: c.device.deviceId,
        deviceName: c.device.name,
        action: c.action,
        payload: safe(c.payload),
        state: c.state,
        ackCode: c.ackCode,
        ackDetail: c.ackDetail,
        result: safe(c.result),
        source: c.source,
        requester: c.requester?.name || "system",
        createdAt: c.createdAt.toISOString(),
        sentAt: c.sentAt?.toISOString() || null,
        ackedAt: c.ackedAt?.toISOString() || null,
        completedAt: c.completedAt?.toISOString() || null,
        expiresAt: c.expiresAt.toISOString(),
      })),
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireRole("ADMIN", "OPERATOR");
    const body = await req.json().catch(() => null);
    if (!body || typeof body.deviceId !== "string" || typeof body.action !== "string") {
      return fail(400, "deviceId and action are required");
    }
    const device = await db.device.findUnique({ where: { deviceId: body.deviceId } });
    if (!device) return fail(404, "unknown device");

    // validate action against device capabilities (safety: no arbitrary actions)
    const caps = safe(device.capabilities);
    const supported: string[] = caps.commands || [];
    if (!supported.includes(body.action)) {
      await audit({
        actorType: "USER", actorId: user.id, action: "COMMAND_REQUESTED",
        resourceType: "Device", resourceId: device.deviceId,
        outcome: "DENIED",
        detail: { action: body.action, reason: "action not in device capabilities" },
      });
      return fail(422, `device ${device.deviceId} does not support action ${body.action} (supported: ${supported.join(", ")})`);
    }

    // validate payload per action
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const validation = validatePayload(body.action, payload);
    if (!validation.ok) {
      await audit({
        actorType: "USER", actorId: user.id, action: "COMMAND_REQUESTED",
        resourceType: "Device", resourceId: device.deviceId,
        outcome: "DENIED",
        detail: { action: body.action, reason: validation.error },
      });
      return fail(422, validation.error!);
    }

    if (device.state === "RETIRED") return fail(409, "device is retired");

    const commandId = `CMD-${randomUUID().slice(0, 8).toUpperCase()}`;
    const source = ["WEB", "API", "AI_PROPOSAL", "AUTOMATION"].includes(body.source) ? body.source : "WEB";

    const command = await db.command.create({
      data: {
        commandId,
        deviceId: device.id,
        requesterId: user.id,
        action: body.action,
        payload: JSON.stringify(payload),
        state: "REQUESTED",
        source,
        authorizedAt: new Date(), // role check passed = authorized
        expiresAt: new Date(Date.now() + 120_000),
      },
    });

    await audit({
      actorType: "USER", actorId: user.id, action: "COMMAND_REQUESTED",
      resourceType: "Command", resourceId: commandId,
      detail: { device: device.deviceId, action: body.action, source, state: "AUTHORIZED" },
    });

    // dispatch through the edge gateway (real MQTT route to the device)
    let dispatched = false;
    let dispatchError: string | null = null;
    try {
      const res = await serviceFetch(GATEWAY_URL, "/dispatch", {
        method: "POST",
        body: JSON.stringify({
          commandId,
          deviceId: device.deviceId,
          action: body.action,
          payload,
          expiresAt: command.expiresAt.toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      dispatched = res.ok && data.ok;
      if (!dispatched) dispatchError = data.error || `gateway responded ${res.status}`;
    } catch (e: any) {
      dispatchError = "edge gateway unreachable";
    }

    if (dispatched) {
      await db.command.update({ where: { id: command.id }, data: { state: "QUEUED" } });
    } else {
      await db.command.update({
        where: { id: command.id },
        data: { state: "FAILED", result: JSON.stringify({ error: dispatchError }), completedAt: new Date() },
      });
    }

    await emitRealtime("command", {
      commandId, deviceId: device.deviceId, deviceName: device.name,
      action: body.action, state: dispatched ? "QUEUED" : "FAILED",
      requester: user.name, createdAt: command.createdAt.toISOString(),
    });
    await emitRealtime("activity", {
      type: "COMMAND",
      message: `${user.name} requested ${body.action} on ${device.deviceId} (${commandId})`,
      ts: new Date().toISOString(),
    });

    return NextResponse.json({
      commandId,
      state: dispatched ? "QUEUED" : "FAILED",
      note: dispatched
        ? "command queued and routed to device via edge gateway — final state depends on device acknowledgement"
        : `dispatch failed: ${dispatchError}`,
    }, { status: dispatched ? 201 : 502 });
  });
}

function validatePayload(action: string, payload: any): { ok: boolean; error?: string } {
  switch (action) {
    case "SET_INTERVAL": {
      const s = Number(payload.intervalSec);
      if (!Number.isFinite(s) || s < 2 || s > 300) return { ok: false, error: "intervalSec must be a number between 2 and 300" };
      return { ok: true };
    }
    case "REBOOT":
    case "RESET_ENERGY":
    case "SELF_TEST":
      return { ok: true };
    default:
      return { ok: true };
  }
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
