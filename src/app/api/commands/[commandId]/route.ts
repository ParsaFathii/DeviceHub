/**
 * DeviceHub API — single command detail.
 * GET /api/commands/[commandId]
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, fail } from "@/lib/services";

export async function GET(req: NextRequest, { params }: { params: Promise<{ commandId: string }> }) {
  return handle(async () => {
    await requireUser();
    const { commandId } = await params;
    // lazy expiry sweep for this command if in-flight past its expiry
    await db.command.updateMany({
      where: {
        commandId,
        state: { in: ["REQUESTED", "AUTHORIZED", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING"] },
        expiresAt: { lt: new Date() },
      },
      data: { state: "EXPIRED", completedAt: new Date(), result: JSON.stringify({ error: "expired before acknowledgement" }) },
    });
    const c = await db.command.findUnique({
      where: { commandId },
      include: { device: { select: { deviceId: true, name: true } }, requester: { select: { name: true, username: true } } },
    });
    if (!c) return fail(404, "unknown command");
    return NextResponse.json({
      command: {
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
        authorizedAt: c.authorizedAt?.toISOString() || null,
        sentAt: c.sentAt?.toISOString() || null,
        ackedAt: c.ackedAt?.toISOString() || null,
        completedAt: c.completedAt?.toISOString() || null,
        expiresAt: c.expiresAt.toISOString(),
      },
    });
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
