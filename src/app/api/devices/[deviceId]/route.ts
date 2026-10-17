/**
 * DeviceHub API — device detail.
 * GET /api/devices/[deviceId]
 * PATCH /api/devices/[deviceId] {name?, zone?, state?, config?} (OPERATOR+)
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireRole } from "@/lib/auth";
import { handle, audit, emitRealtime, fail } from "@/lib/services";

const VALID_STATES = ["UNPROVISIONED", "PROVISIONED", "ONLINE", "OFFLINE", "DEGRADED", "MAINTENANCE", "ERROR", "RETIRED"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  return handle(async () => {
    await requireUser();
    const { deviceId } = await params;
    const device = await db.device.findUnique({
      where: { deviceId },
      include: {
        group: { select: { key: true, name: true } },
        gateway: { select: { gatewayId: true, name: true, state: true } },
      },
    });
    if (!device) return fail(404, "unknown device");

    const since = new Date(Date.now() - 6 * 3600_000);
    const samples = await db.telemetrySample.findMany({
      where: { deviceId: device.id, sampleTs: { gte: since } },
      orderBy: { sampleTs: "desc" },
      take: 900,
    });

    // group by metric, ascending
    const byMetric = new Map<string, any[]>();
    for (const s of samples.reverse()) {
      const arr = byMetric.get(s.metric) || [];
      arr.push({ value: s.value, unit: s.unit, ts: s.sampleTs.toISOString(), quality: s.quality, delayed: s.delayed, seq: s.sequence });
      byMetric.set(s.metric, arr);
    }

    const events = await db.deviceEvent.findMany({
      where: { deviceId: device.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const alerts = await db.alert.findMany({
      where: { deviceId: device.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const commands = await db.command.findMany({
      where: { deviceId: device.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { requester: { select: { name: true } } },
    });

    const anomalies = await db.anomalyFinding.findMany({
      where: { deviceId: device.id },
      orderBy: { detectedAt: "desc" },
      take: 10,
    });

    return NextResponse.json({
      device: {
        deviceId: device.deviceId,
        name: device.name,
        type: device.type,
        origin: device.origin,
        simulator: device.simulator,
        profile: device.profile,
        state: device.state,
        health: device.health,
        zone: device.zone,
        group: device.group ? { key: device.group.key, name: device.group.name } : null,
        gateway: device.gateway ? { gatewayId: device.gateway.gatewayId, name: device.gateway.name, state: device.gateway.state } : null,
        firmwareVersion: device.firmwareVersion,
        protocolVersion: device.protocolVersion,
        hardwareId: device.hardwareId,
        capabilities: safe(device.capabilities),
        config: safe(device.config),
        configVersion: device.configVersion,
        lastSeenAt: device.lastSeenAt?.toISOString() || null,
        registeredAt: device.registeredAt.toISOString(),
        retiredAt: device.retiredAt?.toISOString() || null,
      },
      telemetry: Object.fromEntries(byMetric),
      events: events.map((e) => ({ type: e.type, detail: safe(e.detail), createdAt: e.createdAt.toISOString() })),
      alerts: alerts.map(mapAlert),
      commands: commands.map((c) => ({
        commandId: c.commandId, action: c.action, state: c.state, ackCode: c.ackCode,
        requester: c.requester?.name || "system", createdAt: c.createdAt.toISOString(),
      })),
      anomalies: anomalies.map((a) => ({
        metric: a.metric, score: a.score, model: a.model, modelVersion: a.modelVersion,
        windowStart: a.windowStart.toISOString(), windowEnd: a.windowEnd.toISOString(),
        baselineScore: a.baselineScore, detectedAt: a.detectedAt.toISOString(), details: safe(a.details),
      })),
    });
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ deviceId: string }> }) {
  return handle(async () => {
    const user = await requireRole("ADMIN", "OPERATOR");
    const { deviceId } = await params;
    const body = await req.json().catch(() => null);
    if (!body) return fail(400, "body required");
    const device = await db.device.findUnique({ where: { deviceId } });
    if (!device) return fail(404, "unknown device");

    const data: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.slice(0, 80);
    if (typeof body.zone === "string") data.zone = body.zone.slice(0, 60) || null;
    if (typeof body.state === "string" && VALID_STATES.includes(body.state)) {
      if (body.state === "RETIRED" && device.state !== "RETIRED") {
        data.retiredAt = new Date();
      }
      data.state = body.state;
      await db.deviceEvent.create({
        data: { deviceId: device.id, type: body.state, detail: JSON.stringify({ by: user.username, from: device.state }) },
      });
    }
    if (body.config && typeof body.config === "object") {
      data.config = JSON.stringify({ ...safe(device.config), ...body.config });
      data.configVersion = device.configVersion + 1;
    }
    if (Object.keys(data).length === 0) return fail(400, "no valid fields to update");

    await db.device.update({ where: { id: device.id }, data });
    await audit({
      actorType: "USER", actorId: user.id, action: "DEVICE_UPDATED",
      resourceType: "Device", resourceId: deviceId,
      detail: { fields: Object.keys(data) },
    });
    await emitRealtime("device-state", { deviceId, state: data.state ?? device.state, updated: Object.keys(data) });
    return NextResponse.json({ ok: true });
  });
}

function mapAlert(a: any) {
  return {
    alertId: a.alertId, severity: a.severity, title: a.title, message: a.message,
    state: a.state, createdAt: a.createdAt.toISOString(), evidence: safe(a.evidence),
  };
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
