/**
 * DeviceHub API — device fleet list.
 * GET /api/devices?state&type&group&search&limit
 * POST /api/devices (provision new device — ADMIN)
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser, requireRole } from "@/lib/auth";
import { handle, audit, emitRealtime, fail } from "@/lib/services";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  return handle(async () => {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const state = sp.get("state");
    const type = sp.get("type");
    const group = sp.get("group");
    const search = sp.get("search");
    const limit = Math.min(500, Math.max(1, Number(sp.get("limit") || 200)));

    const where: any = { retiredAt: null };
    if (state) where.state = state;
    if (type) where.type = type;
    if (group) where.group = { key: group };
    if (search) {
      where.OR = [
        { deviceId: { contains: search } },
        { name: { contains: search } },
        { zone: { contains: search } },
      ];
    }

    const devices = await db.device.findMany({
      where,
      orderBy: { deviceId: "asc" },
      take: limit,
      include: { group: { select: { key: true, name: true } } },
    });

    // latest value per primary metric for each device (for table columns)
    const ids = devices.map((d) => d.id);
    const latest = await db.telemetrySample.findMany({
      where: { deviceId: { in: ids } },
      orderBy: { sampleTs: "desc" },
      take: 500,
      select: { deviceId: true, metric: true, value: true, unit: true, sampleTs: true, quality: true },
    });
    const latestByDeviceMetric = new Map<string, any>();
    for (const s of latest) {
      const key = `${s.deviceId}:${s.metric}`;
      if (!latestByDeviceMetric.has(key)) latestByDeviceMetric.set(key, s);
    }

    return NextResponse.json({
      devices: devices.map((d) => {
        const caps = safe(d.capabilities);
        const primary = (caps.metrics || [])[0] || "status";
        const lastTemp = latestByDeviceMetric.get(`${d.id}:temperature`);
        const lastPower = latestByDeviceMetric.get(`${d.id}:power`);
        const lastPrimary = latestByDeviceMetric.get(`${d.id}:${primary}`);
        return {
          deviceId: d.deviceId,
          name: d.name,
          type: d.type,
          origin: d.origin,
          state: d.state,
          health: d.health,
          zone: d.zone,
          group: d.group?.name,
          groupKey: d.group?.key,
          firmwareVersion: d.firmwareVersion,
          lastSeenAt: d.lastSeenAt?.toISOString() || null,
          registeredAt: d.registeredAt.toISOString(),
          profile: d.profile,
          simulator: d.simulator,
          metrics: caps.metrics || [],
          temperature: lastTemp ? { value: lastTemp.value, unit: lastTemp.unit, ts: lastTemp.sampleTs.toISOString() } : null,
          power: lastPower ? { value: lastPower.value, unit: lastPower.unit, ts: lastPower.sampleTs.toISOString() } : null,
          primary: lastPrimary ? { metric: lastPrimary.metric, value: lastPrimary.value, unit: lastPrimary.unit, ts: lastPrimary.sampleTs.toISOString() } : null,
        };
      }),
    });
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireRole("ADMIN");
    const body = await req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || typeof body.type !== "string") {
      return fail(400, "name and type are required");
    }
    const VALID_TYPES = ["ENV_SENSOR", "TEMP_HUM", "MOTION", "POWER_METER", "VIBRATION", "VOLTAGE", "STATUS"];
    if (!VALID_TYPES.includes(body.type)) return fail(400, `type must be one of ${VALID_TYPES.join(", ")}`);

    const count = await db.device.count();
    const deviceId = body.deviceId?.match(/^DH-[A-Z0-9-]{2,}$/) ? body.deviceId : `DH-${body.type.slice(0, 3)}-${String(count + 1).padStart(3, "0")}`;
    const existing = await db.device.findUnique({ where: { deviceId } });
    if (existing) return fail(409, "deviceId already registered");

    const group = body.groupKey ? await db.deviceGroup.findUnique({ where: { key: body.groupKey } }) : null;
    const gw = await db.gateway.findFirst({ where: { gatewayId: "edge-gw-01" } });

    const capabilities = capabilitiesFor(body.type);
    const device = await db.device.create({
      data: {
        deviceId,
        name: body.name.slice(0, 80),
        type: body.type,
        origin: "SIMULATOR",
        zone: body.zone?.slice(0, 60) || group?.name || null,
        profile: ["STABLE", "GRADUAL_DRIFT", "THRESHOLD_VIOLATION", "INTERMITTENT", "SENSOR_FAULT", "STALE"].includes(body.profile) ? body.profile : "STABLE",
        seed: Math.floor(Math.random() * 100000),
        groupId: group?.id,
        gatewayId: gw?.id,
        state: "PROVISIONED",
        capabilities: JSON.stringify(capabilities),
        config: JSON.stringify({ telemetryIntervalSec: 5, reportHeartbeat: true }),
      },
    });
    await db.deviceEvent.create({
      data: { deviceId: device.id, type: "PROVISIONED", detail: JSON.stringify({ by: user.username, type: body.type }) },
    });
    await audit({
      actorType: "USER", actorId: user.id, action: "DEVICE_PROVISIONED",
      resourceType: "Device", resourceId: deviceId,
      detail: { name: body.name, type: body.type, group: group?.key || null },
    });
    await emitRealtime("activity", { type: "DEVICE", message: `Device ${deviceId} (${body.name}) provisioned`, ts: new Date().toISOString() });
    await emitRealtime("device-state", { deviceId, state: "PROVISIONED", lastSeenAt: null, health: 100, provisioned: true });
    return NextResponse.json({ device: { deviceId, name: device.name, type: device.type, state: device.state } }, { status: 201 });
  });
}

function capabilitiesFor(type: string) {
  switch (type) {
    case "ENV_SENSOR": return { metrics: ["temperature", "humidity", "pressure"], units: { temperature: "°C", humidity: "%", pressure: "hPa" }, commands: ["SET_INTERVAL", "REBOOT"] };
    case "TEMP_HUM": return { metrics: ["temperature", "humidity"], units: { temperature: "°C", humidity: "%" }, commands: ["SET_INTERVAL", "REBOOT"] };
    case "MOTION": return { metrics: ["motion"], units: { motion: "events/min" }, commands: ["SET_INTERVAL", "REBOOT"] };
    case "POWER_METER": return { metrics: ["power", "energy"], units: { power: "kW", energy: "kWh" }, commands: ["SET_INTERVAL", "RESET_ENERGY"] };
    case "VIBRATION": return { metrics: ["vibration"], units: { vibration: "mm/s" }, commands: ["SET_INTERVAL", "REBOOT", "SELF_TEST"] };
    case "VOLTAGE": return { metrics: ["voltage", "current"], units: { voltage: "V", current: "A" }, commands: ["SET_INTERVAL", "REBOOT"] };
    default: return { metrics: ["status"], units: { status: "code" }, commands: ["REBOOT"] };
  }
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
