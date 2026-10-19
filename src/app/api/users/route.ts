/**
 * DeviceHub API — users and roles (ADMIN only).
 * GET /api/users
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { handle } from "@/lib/services";

export async function GET() {
  return handle(async () => {
    await requireRole("ADMIN");
    const users = await db.user.findMany({
      orderBy: { role: "asc" },
      select: {
        id: true, username: true, name: true, email: true, role: true, active: true,
        createdAt: true, _count: { select: { commands: true, auditEvents: true } },
      },
    });
    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id, username: u.username, name: u.name, email: u.email, role: u.role,
        active: u.active, createdAt: u.createdAt.toISOString(),
        commandsIssued: u._count.commands, auditEvents: u._count.auditEvents,
      })),
    });
  });
}
