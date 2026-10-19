/**
 * DeviceHub API — AI conversation history (persisted AiInteraction rows).
 * GET    /api/ai/history                 → { sessions: [...], total, stats: {...} }
 * GET    /api/ai/history?sessionId=xxx   → { interactions: [...] }
 * DELETE /api/ai/history?sessionId=xxx   → { deleted: n }  (own sessions only)
 *
 * Users can only read/delete their own sessions (filtered by userId).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, fail, audit } from "@/lib/services";
import { sanitizeSessionId } from "@/lib/ai-evidence";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const sessionId = sanitizeSessionId(req.nextUrl.searchParams.get("sessionId"));

    // ---- single session transcript -------------------------------------------
    if (sessionId) {
      const interactions = await db.aiInteraction.findMany({
        where: { sessionId, userId: user.id },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return NextResponse.json({
        interactions: interactions.map((i) => ({
          id: i.id,
          role: i.role,
          content: i.content,
          evidence: (() => {
            try {
              return i.evidence ? JSON.parse(i.evidence) : {};
            } catch {
              return {};
            }
          })(),
          model: i.model,
          latencyMs: i.latencyMs,
          createdAt: i.createdAt.toISOString(),
        })),
      });
    }

    // ---- session list (last 20 distinct, most recent first) -------------------
    const rows = await db.aiInteraction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { sessionId: true, role: true, content: true, createdAt: true },
    });
    const grouped = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = grouped.get(r.sessionId) || ([] as typeof rows);
      list.push(r);
      grouped.set(r.sessionId, list);
    }
    const sessions = [...grouped.entries()].slice(0, 20).map(([sid, list]) => {
      const first = list[list.length - 1]; // rows are desc → last item is oldest
      const last = list[0];
      const firstUser = [...list].reverse().find((r) => r.role === "user");
      return {
        sessionId: sid,
        title: (firstUser?.content || "conversation").slice(0, 90),
        createdAt: first.createdAt.toISOString(),
        lastActivityAt: last.createdAt.toISOString(),
        interactionCount: list.length,
      };
    });
    const totalRes = await db.$queryRaw<Array<{ cnt: number | bigint }>>(
      Prisma.sql`SELECT COUNT(DISTINCT sessionId) AS cnt FROM AiInteraction WHERE userId = ${user.id}`
    );
    const total = Number(totalRes[0]?.cnt ?? 0);

    // ---- interaction stats (aggregated server-side, not row-loaded) ---------
    const [agg, lastAssistant, totalInteractions] = await Promise.all([
      db.aiInteraction.aggregate({
        where: { userId: user.id, role: "assistant", latencyMs: { not: null } },
        _avg: { latencyMs: true },
      }),
      db.aiInteraction.findFirst({
        where: { userId: user.id, role: "assistant", latencyMs: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { latencyMs: true },
      }),
      db.aiInteraction.count({ where: { userId: user.id } }),
    ]);
    const stats = {
      avgLatencyMs: agg._avg.latencyMs == null ? null : Math.round(agg._avg.latencyMs),
      lastLatencyMs: lastAssistant?.latencyMs ?? null,
      totalInteractions,
    };
    return NextResponse.json({ sessions, total, stats });
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const user = await requireUser();
    const sessionId = sanitizeSessionId(req.nextUrl.searchParams.get("sessionId"));
    if (!sessionId) return fail(400, "sessionId required");
    // only the owning user can delete a session's interactions
    const res = await db.aiInteraction.deleteMany({ where: { sessionId, userId: user.id } });
    await audit({
      actorType: "USER", actorId: user.id, action: "AI_HISTORY_DELETED",
      resourceType: "Assistant",
      detail: { sessionId, deleted: res.count },
    });
    return NextResponse.json({ deleted: res.count });
  });
}
