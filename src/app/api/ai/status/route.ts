/**
 * DeviceHub API — AI assistant status (real provider state, no fake "online").
 * GET /api/ai/status
 *
 * "available" is reported ONLY when a REAL tiny chat completion round-trips
 * against the provider (constructor success proves nothing). The ping result
 * is cached in-module for 60s so the ~30s client polling never spams the
 * provider.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/services";

const PING_TTL_MS = 60_000;

type PingResult = { ok: boolean; latencyMs: number | null; at: number; error: string | null };

// module-level cache: {ok, latencyMs, at}
let pingCache: PingResult | null = null;

async function pingProvider(): Promise<PingResult> {
  if (pingCache && Date.now() - pingCache.at < PING_TTL_MS) return pingCache;
  const startedAt = Date.now();
  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    // a REAL tiny completion — the same API surface the diagnostics routes use
    const completion = await zai.chat.completions.create({
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
      temperature: 0,
    });
    const ok = !!completion?.choices?.length;
    pingCache = {
      ok,
      latencyMs: Date.now() - startedAt,
      at: Date.now(),
      error: ok ? null : "provider returned an empty completion",
    };
  } catch (e: unknown) {
    pingCache = {
      ok: false,
      latencyMs: null,
      at: Date.now(),
      error: (e as Error)?.message || "provider unavailable",
    };
  }
  return pingCache;
}

export async function GET() {
  return handle(async () => {
    await requireUser();
    // report the real provider state — probed with a live completion; the
    // platform keeps working without the AI layer either way
    const ping = await pingProvider();
    return NextResponse.json({
      status: ping.ok ? "available" : "unavailable",
      provider: "z-ai-chat (documented provider abstraction)",
      streaming: true,
      multiTurn: true,
      historyPersisted: true,
      advisoryOnly: true,
      canExecuteCommands: false,
      receivesCredentials: false,
      grounding: "answers are built from sanitized telemetry/alert/anomaly/rule/gateway/command evidence only",
      pingLatencyMs: ping.latencyMs,
      lastCheckedAt: new Date(ping.at).toISOString(),
      error: ping.error,
      note: "The DeviceHub platform remains fully operational when the AI layer is unavailable.",
    });
  });
}
