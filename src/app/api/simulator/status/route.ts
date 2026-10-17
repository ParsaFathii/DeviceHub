/**
 * DeviceHub API — simulator fleet status (proxy).
 * GET /api/simulator/status
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, fail, serviceFetch, SIMULATOR_URL } from "@/lib/services";

export async function GET() {
  return handle(async () => {
    await requireUser();
    try {
      const res = await serviceFetch(SIMULATOR_URL, "/status", { method: "GET" });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      return fail(503, "simulator service unreachable");
    }
  });
}
