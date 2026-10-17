/**
 * DeviceHub API — model info from the analytics service.
 * GET /api/analytics/model-info
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, fail, serviceFetch, ANALYTICS_URL } from "@/lib/services";

export async function GET() {
  return handle(async () => {
    await requireUser();
    try {
      const res = await serviceFetch(ANALYTICS_URL, "/model-info", { method: "GET" });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      return fail(503, "analytics service unreachable");
    }
  });
}
