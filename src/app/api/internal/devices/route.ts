/**
 * DeviceHub internal API — device registry export for edge services.
 * GET /api/internal/devices  (X-Internal-Token)
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { isInternalRequest, ok, fail } from "@/lib/services";

export async function GET(req: NextRequest) {
  if (!isInternalRequest(req)) return fail(401, "unauthorized");
  const devices = await db.device.findMany({
    where: { retiredAt: null },
    select: {
      deviceId: true,
      name: true,
      type: true,
      profile: true,
      seed: true,
      state: true,
      zone: true,
      simulator: true,
      origin: true,
      config: true,
      gatewayId: true,
      capabilities: true,
    },
    orderBy: { deviceId: "asc" },
  });
  return ok({
    devices: devices.map((d) => ({
      ...d,
      config: safe(d.config),
      capabilities: safe(d.capabilities),
    })),
  });
}

function safe(s: string | null): any {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
