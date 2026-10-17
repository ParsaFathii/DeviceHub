/**
 * DeviceHub API — AI diagnostics, SSE streaming variant.
 * POST /api/ai/diagnostics/stream {question, deviceId?, sessionId?}
 *
 * Same evidence gathering, multi-turn history, persistence and audit as the
 * non-stream route, but the answer is delivered as Server-Sent Events:
 *   data: {"type":"meta","sessionId":"...","evidenceSummary":{...}}   (first)
 *   data: {"type":"delta","text":"..."}                               (many)
 *   data: {"type":"done","latencyMs":123}                             (last)
 *   data: {"type":"error","message":"..."}                            (failure)
 *
 * The provider SDK is probed to stream natively (ReadableStream of SSE
 * frames); if it ever returns a plain JSON completion instead, the answer is
 * re-chunked into ~6 synthetic deltas so the client contract is identical.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import { requireUser, type SessionUser } from "@/lib/auth";
import { fail, audit } from "@/lib/services";
import ZAI from "z-ai-web-dev-sdk";
import {
  AI_MODEL_LABEL,
  buildLLMMessages,
  gatherEvidence,
  iterateProviderStream,
  loadSessionHistory,
  sanitizeSessionId,
  type EvidenceSummary,
} from "@/lib/ai-evidence";
import { randomUUID } from "crypto";

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

export async function POST(req: NextRequest) {
  let user: SessionUser;
  try {
    user = await requireUser();
  } catch {
    return fail(401, "authentication required");
  }

  const body = await req.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.slice(0, 500) : "";
  if (!question.trim()) return fail(400, "question required");
  const deviceId =
    typeof body?.deviceId === "string" && /^DH-[A-Z0-9-]+$/.test(body.deviceId) ? body.deviceId : null;
  const sessionId = sanitizeSessionId(body?.sessionId) || randomUUID();

  // ---- evidence + history gathered up-front: failures → normal JSON error --
  let history: Awaited<ReturnType<typeof loadSessionHistory>>;
  let evidence: Record<string, unknown>;
  let summary: EvidenceSummary;
  try {
    history = await loadSessionHistory(sessionId, user.id);
    ({ evidence, summary } = await gatherEvidence(deviceId));
  } catch (e) {
    console.error("[ai/stream] evidence gathering failed:", (e as Error).message);
    return fail(500, "failed to gather recorded evidence");
  }

  // ---- persist the operator question BEFORE the model call -----------------
  await db.aiInteraction
    .create({ data: { sessionId, userId: user.id, role: "user", content: question } })
    .catch((e: Error) => console.error("[ai/stream] persist question failed:", e.message));

  const messages = buildLLMMessages({ question, evidence, history });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: Record<string, unknown>) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* client went away */
        }
      };

      send({ type: "meta", sessionId, evidenceSummary: summary });

      const startedAt = Date.now();
      let assembled = "";
      let emittedAny = false;
      try {
        const zai = await ZAI.create();
        const res = await zai.chat.completions.create({
          messages,
          temperature: 0.3,
          max_tokens: 1200,
          stream: true,
        });

        if (res && typeof (res as ReadableStream<Uint8Array>).getReader === "function") {
          // native provider streaming — forward deltas as they arrive
          for await (const delta of iterateProviderStream(res as ReadableStream<Uint8Array>)) {
            assembled += delta;
            emittedAny = true;
            send({ type: "delta", text: delta });
          }
        } else {
          // SDK returned a complete JSON completion — re-chunk into ~6 deltas
          const answer: string = res?.choices?.[0]?.message?.content || "";
          if (!answer) throw new Error("empty completion from provider");
          const size = Math.max(1, Math.ceil(answer.length / 6));
          for (let i = 0; i < answer.length; i += size) {
            const chunk = answer.slice(i, i + size);
            assembled += chunk;
            send({ type: "delta", text: chunk });
            await new Promise((r) => setTimeout(r, 15)); // light pacing for the typewriter
          }
          emittedAny = true;
        }

        if (!emittedAny) throw new Error("no content received from provider");

        const latencyMs = Date.now() - startedAt;
        send({ type: "done", latencyMs });

        // ---- persist the assembled assistant answer + audit ----------------
        await db.aiInteraction.create({
          data: {
            sessionId, userId: user.id, role: "assistant", content: assembled,
            evidence: JSON.stringify(summary), model: AI_MODEL_LABEL, latencyMs,
          },
        });
        await audit({
          actorType: "USER", actorId: user.id, action: "AI_DIAGNOSTICS",
          resourceType: "Assistant",
          detail: {
            question: question.slice(0, 120), deviceId: deviceId || null,
            evidenceDevices: summary.devices, evidenceAlerts: summary.alerts,
            sessionId, latencyMs, mode: "stream",
          },
        });
      } catch (e) {
        const message =
          (e as Error)?.message ||
          "AI provider unavailable — the platform continues to operate without the AI layer";
        send({ type: "error", message });
        await audit({
          actorType: "AI", action: "AI_DIAGNOSTICS", resourceType: "Assistant",
          outcome: "FAILURE",
          detail: {
            error: "provider unavailable (stream)", sessionId,
            question: question.slice(0, 120), partialChars: assembled.length,
          },
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
