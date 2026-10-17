/**
 * DeviceHub API — current session user.
 * GET /api/auth/me
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { handle } from "@/lib/services";

export async function GET() {
  return handle(async () => {
    const user = await getSessionUser();
    return NextResponse.json({ user });
  });
}
