/**
 * DeviceHub API — authentication.
 * POST /api/auth/login {username, password}
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, createSession, sessionCookieOptions } from "@/lib/auth";
import { audit, fail, handle } from "@/lib/services";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.username !== "string" || typeof body.password !== "string") {
      return fail(400, "username and password required");
    }
    const user = await db.user.findUnique({ where: { username: body.username } });
    if (!user || !user.active || !verifyPassword(body.password, user.passwordHash)) {
      await audit({
        actorType: "USER",
        action: "LOGIN",
        resourceType: "Session",
        outcome: "FAILURE",
        detail: { username: body.username, reason: "invalid credentials" },
      });
      return fail(401, "invalid username or password");
    }
    const token = await createSession(user.id, req.headers.get("user-agent") || undefined);
    await audit({
      actorType: "USER",
      actorId: user.id,
      action: "LOGIN",
      resourceType: "Session",
      detail: { username: user.username, role: user.role },
    });
    const res = NextResponse.json({
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
    });
    res.cookies.set({ ...sessionCookieOptions(), value: token });
    return res;
  });
}
