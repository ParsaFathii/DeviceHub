/**
 * DeviceHub internal API helpers + audit + realtime emit.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const INTERNAL_TOKEN = process.env.DH_INTERNAL_TOKEN || "dev-internal-token";
export const GATEWAY_URL = process.env.DH_GATEWAY_URL || "http://localhost:3011";
export const ANALYTICS_URL = process.env.DH_ANALYTICS_URL || "http://localhost:3014";
export const SIMULATOR_URL = process.env.DH_SIMULATOR_URL || "http://localhost:3012";
export const REALTIME_URL = process.env.DH_REALTIME_URL || "http://localhost:3013";

export function isInternalRequest(req: NextRequest): boolean {
  return req.headers.get("x-internal-token") === INTERNAL_TOKEN;
}

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** Catch-all handler wrapper: converts ApiError to responses. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e: any) {
    if (e?.digest) throw e; // next.js internal
    const status = typeof e?.status === "number" ? e.status : 500;
    const msg = e?.message || "internal error";
    if (status >= 500) console.error("[api] error:", e);
    return NextResponse.json({ error: msg }, { status });
  }
}

/** Sanitized audit event (never secrets/credentials). */
export async function audit(params: {
  actorType: "USER" | "GATEWAY" | "SYSTEM" | "DEVICE" | "AI";
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: "SUCCESS" | "FAILURE" | "DENIED";
  detail?: Record<string, unknown>;
}) {
  try {
    await db.auditEvent.create({
      data: {
        actorType: params.actorType,
        actorId: params.actorId ?? null,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId ?? null,
        outcome: params.outcome || "SUCCESS",
        detail: JSON.stringify(params.detail || {}),
      },
    });
  } catch (e) {
    console.error("[audit] failed to record event:", (e as Error).message);
  }
}

/** Emit realtime event to the realtime service (best-effort). */
export async function emitRealtime(event: string, data: unknown) {
  try {
    await fetch(`${REALTIME_URL}/emit`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Internal-Token": INTERNAL_TOKEN },
      body: JSON.stringify({ event, data }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* realtime is non-critical */
  }
}

/** Server-side fetch to a mini-service with the internal token. */
export async function serviceFetch(base: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "X-Internal-Token": INTERNAL_TOKEN,
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(20000),
  });
}
