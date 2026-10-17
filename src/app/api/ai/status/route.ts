/**
 * DeviceHub API — AI assistant status (real provider state, no fake "online").
 * GET /api/ai/status
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/services";

export async function GET() {
  return handle(async () => {
    await requireUser();
    // report the real provider state — probed lazily; the platform works without AI
    let providerReachable = false;
    let providerError: string | null = null;
    try {
      const { default: ZAI } = await import("z-ai-web-dev-sdk");
      const zai = await ZAI.create();
      providerReachable = !!zai;
    } catch (e: any) {
      providerError = e?.message || "provider unavailable";
    }
    return NextResponse.json({
      status: providerReachable ? "available" : "unavailable",
      provider: "z-ai-chat (documented provider abstraction)",
      streaming: true,
      multiTurn: true,
      historyPersisted: true,
      advisoryOnly: true,
      canExecuteCommands: false,
      receivesCredentials: false,
      grounding: "answers are built from sanitized telemetry/alert/anomaly/rule/gateway/command evidence only",
      error: providerError,
      note: "The DeviceHub platform remains fully operational when the AI layer is unavailable.",
    });
  });
}
