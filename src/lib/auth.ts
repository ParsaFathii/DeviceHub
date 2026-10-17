/**
 * DeviceHub authentication — session cookies + role enforcement.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { randomBytes, pbkdf2Sync } from "crypto";

export type Role = "ADMIN" | "OPERATOR" | "VIEWER";

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  role: Role;
}

const SESSION_COOKIE = "dh_session";
const SESSION_TTL_MS = 24 * 3600 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 60000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const [, salt, hash] = parts;
  const candidate = pbkdf2Sync(password, salt, 60000, 32, "sha256").toString("hex");
  return candidate === hash;
}

export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      token,
      userId,
      userAgent: userAgent?.slice(0, 200) || null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (!session.user.active) return null;
  return {
    id: session.user.id,
    username: session.user.username,
    name: session.user.name,
    role: session.user.role,
  };
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { token } }).catch(() => undefined);
  }
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

// ---- Role helpers -----------------------------------------------------------

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "authentication required");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    // Security-relevant denials are always audited (server-side enforcement).
    try {
      const { audit } = await import("@/lib/services");
      await audit({
        actorType: "USER",
        actorId: user.id,
        action: "ROLE_DENIAL",
        resourceType: "Authorization",
        outcome: "DENIED",
        detail: { userRole: user.role, required: roles.join("|") },
      });
    } catch { /* audit must never block enforcement */ }
    throw new ApiError(403, `role ${user.role} is not permitted for this operation (requires ${roles.join(" or ")})`);
  }
  return user;
}
