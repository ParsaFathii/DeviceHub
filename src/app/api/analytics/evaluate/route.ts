/**
 * DeviceHub API — ML evaluation on labeled synthetic dataset (proxies to Python service).
 * POST /api/analytics/evaluate
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle, fail, serviceFetch, ANALYTICS_URL, audit } from "@/lib/services";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireRole("ADMIN", "OPERATOR");
    try {
      const res = await serviceFetch(ANALYTICS_URL, "/evaluate", { method: "POST", body: "{}" });
      const data = await res.json();
      if (!res.ok) return NextResponse.json(data, { status: res.status });
      await audit({
        actorType: "USER", actorId: user.id, action: "ML_EVALUATION_RUN",
        resourceType: "Analytics",
        detail: {
          isolationForestF1: data.isolationForest?.f1,
          zscoreBaselineF1: data.zscoreBaseline?.f1,
          samples: data.dataset?.samples,
        },
      });
      return NextResponse.json(data);
    } catch {
      return fail(503, "analytics service unreachable — evaluation unavailable");
    }
  });
}
