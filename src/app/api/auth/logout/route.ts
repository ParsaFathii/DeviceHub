/**
 * DeviceHub API — logout.
 * POST /api/auth/logout
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { NextResponse } from "next/server";
import { destroySession, getSessionUser } from "@/lib/auth";
import { audit, handle } from "@/lib/services";

export async function POST() {
  return handle(async () => {
    const user = await getSessionUser();
    await destroySession();
    if (user) {
      await audit({ actorType: "USER", actorId: user.id, action: "LOGOUT", resourceType: "Session" });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set({ name: "dh_session", value: "", path: "/", maxAge: 0 });
    return res;
  });
}
