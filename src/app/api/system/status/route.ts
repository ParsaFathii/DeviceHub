/**
 * DeviceHub API — platform service health (real probes).
 * GET /api/system/status
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, serviceFetch, GATEWAY_URL, ANALYTICS_URL, SIMULATOR_URL, REALTIME_URL } from "@/lib/services";

export async function GET() {
  return handle(async () => {
    await requireUser();

    const probe = async (base: string, path: string): Promise<{ status: string; latencyMs: number | null; data?: any }> => {
      const t0 = Date.now();
      try {
        const res = await serviceFetch(base, path, { method: "GET" });
        return { status: res.ok ? "up" : `degraded(${res.status})`, latencyMs: Date.now() - t0, data: await res.json().catch(() => null) };
      } catch {
        return { status: "down", latencyMs: Date.now() - t0 };
      }
    };

    const [gatewayHealth, gatewayStatus, analytics, simulator, realtime] = await Promise.all([
      probe(GATEWAY_URL, "/health"),
      probe(GATEWAY_URL, "/status"),
      probe(ANALYTICS_URL, "/health"),
      probe(SIMULATOR_URL, "/health"),
      probe(REALTIME_URL, "/health"),
    ]);

    const dbOk = await db.telemetrySample.count({ take: 1 }).then(() => true).catch(() => false);
    const counts = {
      devices: await db.device.count({ where: { retiredAt: null } }),
      samples: await db.telemetrySample.count(),
      alerts: await db.alert.count(),
      commands: await db.command.count(),
      auditEvents: await db.auditEvent.count(),
      anomalyFindings: await db.anomalyFinding.count(),
    };

    return NextResponse.json({
      database: { status: dbOk ? "up" : "down", engine: "SQLite (Prisma)", ...counts },
      gateway: { ...gatewayHealth, url: "edge-gateway (port 3011)", mqttConnected: gatewayStatus?.data?.mqttConnected },
      analytics: { ...analytics, url: "python-analytics (port 3014)" },
      simulator: { ...simulator, url: "device-simulator (port 3012)" },
      realtime: { ...realtime, url: "realtime socket.io (port 3013)" },
      mqttBroker: {
        status: gatewayStatus?.data?.mqttConnected ? "up" : gatewayStatus.status === "up" ? "degraded(client disconnected)" : "unknown",
        url: "aedes MQTT broker (port 1883)",
      },
      checkedAt: new Date().toISOString(),
    });
  });
}
