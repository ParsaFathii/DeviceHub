/**
 * DeviceHub API — AI diagnostics (evidence-grounded, advisory only, multi-turn).
 * POST /api/ai/diagnostics {question, deviceId?, sessionId?}
 *
 * Safety boundary (enforced here, not by the model):
 *  - The LLM receives ONLY sanitized evidence: fleet/device summaries, alert
 *    records, anomaly findings, rule metadata, gateway metrics, command
 *    outcomes. No credentials, no secrets, no internal ids.
 *  - The LLM never executes commands. If the user asks for an action, the
 *    assistant returns a PROPOSAL which must be confirmed and submitted
 *    through the normal audited command flow.
 *  - Output must label measured facts / rule results / ML output / hypotheses.
 *  - Both the question and the answer are persisted (AiInteraction) so the
 *    conversation can continue across turns; every call is audited.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, fail, audit } from "@/lib/services";
import ZAI from "z-ai-web-dev-sdk";
import {
  AI_MODEL_LABEL,
  buildLLMMessages,
  gatherEvidence,
  loadSessionHistory,
  sanitizeSessionId,
  type EvidenceSummary,
} from "@/lib/ai-evidence";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.slice(0, 500) : "";
    if (!question.trim()) return fail(400, "question required");
    const deviceId =
      typeof body?.deviceId === "string" && /^DH-[A-Z0-9-]+$/.test(body.deviceId) ? body.deviceId : null;
    const sessionId = sanitizeSessionId(body?.sessionId) || randomUUID();

    // ---- prior conversation turns (multi-turn, own sessions only) ----------
    const history = await loadSessionHistory(sessionId, user.id);

    // ---- gather evidence (real recorded data only) -------------------------
    const { evidence, summary } = await gatherEvidence(deviceId);

    // ---- persist the operator question BEFORE the model call ----------------
    await db.aiInteraction.create({
      data: { sessionId, userId: user.id, role: "user", content: question },
    });

    // ---- call the LLM with a strictly grounded system prompt ---------------
    const messages = buildLLMMessages({ question, evidence, history });
    const startedAt = Date.now();
    let answer: string;
    try {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages,
        temperature: 0.3,
        max_tokens: 1200,
      });
      answer = completion.choices[0]?.message?.content || "";
    } catch (e) {
      const msg = (e as Error)?.message || "unknown error";
      await audit({
        actorType: "AI", action: "AI_DIAGNOSTICS", resourceType: "Assistant",
        outcome: "FAILURE",
        detail: { error: "provider unavailable", sessionId, question: question.slice(0, 120) },
      });
      return fail(503, `AI provider unavailable: ${msg} — the platform continues to operate without the AI layer`);
    }
    const latencyMs = Date.now() - startedAt;

    // ---- persist the assistant answer with evidence summary -----------------
    await db.aiInteraction.create({
      data: {
        sessionId, userId: user.id, role: "assistant", content: answer,
        evidence: JSON.stringify(summary), model: AI_MODEL_LABEL, latencyMs,
      },
    });

    await audit({
      actorType: "USER", actorId: user.id, action: "AI_DIAGNOSTICS",
      resourceType: "Assistant",
      detail: {
        question: question.slice(0, 120), deviceId: deviceId || null,
        evidenceDevices: summary.devices, evidenceAlerts: summary.alerts,
        sessionId, latencyMs,
      },
    });

    return NextResponse.json({
      answer,
      sessionId,
      latencyMs,
      evidenceSummary: summary satisfies EvidenceSummary,
      safety: {
        advisory: "AI layer is advisory only — it cannot execute commands or bypass authorization",
        proposalsRequireConfirmation: true,
      },
    });
  });
}
