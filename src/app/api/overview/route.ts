/**
 * DeviceHub API — fleet overview (KPIs, zone health, recent alerts, live summary).
 * GET /api/overview
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/services";

export async function GET() {
  return handle(async () => {
    await requireUser();
    const [totalDevices, online, degraded, maintenance, offline, activeAlerts, criticalAlerts, samples24h, commands24h] = await Promise.all([
      db.device.count({ where: { retiredAt: null } }),
      db.device.count({ where: { state: "ONLINE" } }),
      db.device.count({ where: { state: "DEGRADED" } }),
      db.device.count({ where: { state: "MAINTENANCE" } }),
      db.device.count({ where: { state: "OFFLINE" } }),
      db.alert.count({ where: { state: "ACTIVE" } }),
      db.alert.count({ where: { state: "ACTIVE", severity: "CRITICAL" } }),
      db.telemetrySample.count({ where: { receivedTs: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
      db.command.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
    ]);

    // zone (group) health
    const groups = await db.deviceGroup.findMany({ include: { devices: { where: { retiredAt: null } } } });
    const zones = groups.map((g) => {
      const devs = g.devices;
      const onlineCount = devs.filter((d) => d.state === "ONLINE").length;
      const avgHealth = devs.length ? Math.round(devs.reduce((a, d) => a + d.health, 0) / devs.length) : 0;
      return {
        key: g.key,
        name: g.name,
        devices: devs.length,
        online: onlineCount,
        warning: devs.filter((d) => ["DEGRADED", "MAINTENANCE"].includes(d.state)).length,
        offline: devs.filter((d) => d.state === "OFFLINE").length,
        avgHealth,
      };
    });

    // telemetry rate: samples per minute over last 10 min (from 1-min buckets)
    const rateBuckets: { minute: string; count: number }[] = [];
    for (let i = 9; i >= 0; i--) {
      const start = new Date(Date.now() - (i + 1) * 60_000);
      const end = new Date(Date.now() - i * 60_000);
      const count = await db.telemetrySample.count({ where: { receivedTs: { gte: start, lt: end } } });
      rateBuckets.push({ minute: start.toISOString(), count });
    }

    const recentAlerts = await db.alert.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { device: { select: { deviceId: true, name: true, zone: true } } },
    });

    const recentCommands = await db.command.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { device: { select: { deviceId: true, name: true } }, requester: { select: { name: true } } },
    });

    // avg health fleet-wide
    const devices = await db.device.findMany({ where: { retiredAt: null }, select: { health: true } });
    const fleetHealth = devices.length ? Math.round(devices.reduce((a, d) => a + d.health, 0) / devices.length) : 0;

    // simulator origin disclosure — fleet currently runs on simulated devices
    const simulated = await db.device.count({ where: { simulator: true, retiredAt: null } });

    return NextResponse.json({
      kpis: {
        totalDevices, online, degraded, maintenance, offline,
        activeAlerts, criticalAlerts, samples24h, commands24h, fleetHealth,
      },
      zones,
      rateBuckets,
      recentAlerts: recentAlerts.map(mapAlert),
      recentCommands: recentCommands.map(mapCommand),
      dataOrigin: {
        simulatedDevices: simulated,
        physicalDevices: totalDevices - simulated,
        note: "Fleet data originates from the deterministic device simulator (clearly labelled in all views)",
      },
    });
  });
}

function mapAlert(a: any) {
  return {
    alertId: a.alertId,
    deviceId: a.device?.deviceId,
    deviceName: a.device?.name,
    zone: a.device?.zone,
    severity: a.severity,
    title: a.title,
    message: a.message,
    state: a.state,
    createdAt: a.createdAt.toISOString(),
    evidence: safe(a.evidence),
  };
}

function mapCommand(c: any) {
  return {
    commandId: c.commandId,
    deviceId: c.device?.deviceId,
    deviceName: c.device?.name,
    action: c.action,
    state: c.state,
    requester: c.requester?.name || "system",
    createdAt: c.createdAt.toISOString(),
  };
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
