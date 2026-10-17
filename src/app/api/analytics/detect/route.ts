/**
 * DeviceHub API — anomaly detection trigger (proxies to the Python analytics service).
 * POST /api/analytics/detect {deviceId?, metric?, windowMin?, contamination?}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, fail, serviceFetch, ANALYTICS_URL, audit } from "@/lib/services";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireRole("ADMIN", "OPERATOR");
    const body = await req.json().catch(() => ({}));
    try {
      const res = await serviceFetch(ANALYTICS_URL, "/detect", {
        method: "POST",
        body: JSON.stringify({
          deviceId: body.deviceId || undefined,
          metric: body.metric || undefined,
          windowMin: Math.max(5, Math.min(1440, Number(body.windowMin) || 60)),
          contamination: Math.min(0.2, Math.max(0.005, Number(body.contamination) || 0.02)),
        }),
      });
      const data = await res.json();
      if (!res.ok) return NextResponse.json(data, { status: res.status });
      await audit({
        actorType: "USER", actorId: user.id, action: "ANOMALY_DETECTION_RUN",
        resourceType: "Analytics", detail: { windowMin: body.windowMin || 60, findings: data.findings?.length || 0 },
      });
      return NextResponse.json(data);
    } catch {
      return fail(503, "analytics service unreachable — anomaly detection unavailable (core platform unaffected)");
    }
  });
}
