/**
 * DeviceHub API — AI diagnostics, SSE streaming variant.
 * POST /api/ai/diagnostics/stream {question, deviceId?, sessionId?}
 *
 * Same evidence gathering, multi-turn history, persistence and audit as the
 * non-stream route, but the answer is delivered as Server-Sent Events:
 *   data: {"type":"meta","sessionId":"...","evidenceSummary":{...},"seriesPreview":[...]} (first)
 *   data: {"type":"delta","text":"..."}                                    (many)
 *   data: {"type":"done","latencyMs":123,"charsPerSec":45,"turns":7,"proposal":null|{...}} (last)
 *   data: {"type":"error","message":"..."}                                 (failure)
 *
 * The provider answer is fully buffered BEFORE any delta is forwarded so a
 * trailing ```proposal fenced block can be stripped and server-validated
 * (it must NEVER reach a client as raw text); the clean text is then
 * re-chunked into 8-20 paced deltas (~150ms total budget). If the provider
 * returns a plain JSON completion instead of a stream, the same buffered
 * path applies (fallback unchanged in spirit).
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
  buildSeriesPreview,
  gatherEvidence,
  iterateProviderStream,
  loadSessionHistory,
  parseProposalBlock,
  sanitizeSessionId,
  validateProposal,
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
    .create({ data: { sessionId, userId: user.id, role: "user", content: question, deviceId } })
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

      send({ type: "meta", sessionId, evidenceSummary: summary, seriesPreview: buildSeriesPreview(evidence) });

      const startedAt = Date.now();
      let raw = "";
      try {
        const zai = await ZAI.create();
        const res = await zai.chat.completions.create({
          messages,
          temperature: 0.3,
          max_tokens: 1200,
          stream: true,
        });

        // Buffer the FULL answer first — a ```proposal block must be stripped
        // server-side before any text is forwarded to the client.
        if (res && typeof (res as ReadableStream<Uint8Array>).getReader === "function") {
          for await (const delta of iterateProviderStream(res as ReadableStream<Uint8Array>)) {
            raw += delta;
          }
        } else {
          // SDK returned a complete JSON completion (fallback path)
          raw = res?.choices?.[0]?.message?.content || "";
        }

        if (!raw.trim()) throw new Error("no content received from provider");
        const latencyMs = Date.now() - startedAt;

        // ---- strip + server-validate the structured proposal block ---------
        const { cleanText, proposal: parsedProposal } = parseProposalBlock(raw);
        const proposal = await validateProposal(parsedProposal);
        const cleanAnswer =
          cleanText.trim() ||
          (proposal
            ? "Proposed a single operator action — see the command card for review."
            : "(the model returned no narrative content)");

        // ---- re-chunk the clean text into 8-20 paced deltas (~150ms total) -
        const chunks = Math.max(8, Math.min(20, Math.ceil(cleanAnswer.length / 60)));
        const size = Math.max(1, Math.ceil(cleanAnswer.length / chunks));
        const pace = Math.max(6, Math.floor(150 / chunks));
        for (let i = 0; i < cleanAnswer.length; i += size) {
          send({ type: "delta", text: cleanAnswer.slice(i, i + size) });
          await new Promise((r) => setTimeout(r, pace));
        }

        // ---- persist the clean assistant answer (device-scoped) ------------
        await db.aiInteraction
          .create({
            data: {
              sessionId, userId: user.id, role: "assistant", content: cleanAnswer,
              evidence: JSON.stringify(summary), model: AI_MODEL_LABEL, latencyMs, deviceId,
            },
          })
          .catch((e: Error) => console.error("[ai/stream] persist answer failed:", e.message));
        const turns = await db.aiInteraction
          .count({ where: { sessionId, userId: user.id } })
          .catch(() => 0);

        const seconds = latencyMs / 1000;
        const charsPerSec = seconds > 0 ? Math.round(cleanAnswer.length / seconds) : cleanAnswer.length;

        send({ type: "done", latencyMs, charsPerSec, turns, proposal });

        await audit({
          actorType: "USER", actorId: user.id, action: "AI_DIAGNOSTICS",
          resourceType: "Assistant",
          detail: {
            question: question.slice(0, 120), deviceId: deviceId || null,
            evidenceDevices: summary.devices, evidenceAlerts: summary.alerts,
            sessionId, latencyMs, mode: "stream", charsPerSec, turns,
            proposal: proposal
              ? { deviceId: proposal.deviceId, action: proposal.action }
              : null,
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
            question: question.slice(0, 120), partialChars: raw.length,
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
