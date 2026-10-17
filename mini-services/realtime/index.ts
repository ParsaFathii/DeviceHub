/**
 * DeviceHub Realtime Service (socket.io)
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 *
 * Streams live platform events to the web client:
 *   telemetry, device-state, alert, command, gateway, rule-execution, anomaly, activity
 *
 * Browser clients connect via the Caddy gateway:
 *   io("/?XTransformPort=3013")  (path must stay "/")
 *
 * Server-side producers (edge gateway, Next.js API, analytics) emit events via
 * POST /emit with the X-Internal-Token header.
 */
import { createServer } from "http";
import { Server } from "socket.io";

const PORT = 3013;
const INTERNAL_TOKEN = process.env.DH_INTERNAL_TOKEN || "dev-internal-token";

const ALLOWED_EVENTS = new Set([
  "telemetry",
  "device-state",
  "alert",
  "alert-updated",
  "command",
  "gateway",
  "rule-execution",
  "anomaly",
  "activity",
  "buffer",
]);

const stats = {
  clientConnections: 0,
  emits: 0,
  lastEventAt: null as string | null,
  startedAt: new Date().toISOString(),
};

const server = createServer((req: any, res: any) => {
  res.setHeader("content-type", "application/json");
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    res.end(
      JSON.stringify({
        status: "ok",
        service: "devicehub-realtime",
        port: PORT,
        clients: io.engine.clientsCount,
        emits: stats.emits,
        lastEventAt: stats.lastEventAt,
        startedAt: stats.startedAt,
      })
    );
    return;
  }

  if (url.pathname === "/emit") {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }
    const token = req.headers["x-internal-token"];
    if (token !== INTERNAL_TOKEN) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const { event, data, deviceId } = parsed;
        if (typeof event !== "string" || !ALLOWED_EVENTS.has(event)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "unknown event", allowed: [...ALLOWED_EVENTS] }));
          return;
        }
        stats.emits++;
        stats.lastEventAt = new Date().toISOString();
        io.emit(event, data);
        res.statusCode = 202;
        res.end(JSON.stringify({ ok: true, clients: io.engine.clientsCount }));
      } catch (e: any) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid json: " + e.message }));
      }
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

const io = new Server(server, {
  // Default path "/socket.io/" — Caddy routes browser traffic to this port purely via
  // the XTransformPort query param, so the browser still connects with io("/?XTransformPort=3013").
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  stats.clientConnections++;
  console.log(`[realtime] web client connected: ${socket.id} (total ${io.engine.clientsCount})`);

  socket.emit("hello", { service: "devicehub-realtime", startedAt: stats.startedAt });

  // Clients may subscribe to a single device room: device:{deviceId}
  socket.on("subscribe-device", (deviceId: string) => {
    if (typeof deviceId === "string" && /^DH-[A-Z0-9-]+$/.test(deviceId)) {
      socket.join(`device:${deviceId}`);
    }
  });
  socket.on("unsubscribe-device", (deviceId: string) => {
    socket.leave(`device:${deviceId}`);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[realtime] web client disconnected: ${socket.id} (${reason})`);
  });
});

server.listen(PORT, () => {
  console.log(`[realtime] DeviceHub realtime service listening on :${PORT}`);
  console.log(`[realtime] browser clients: io("/?XTransformPort=${PORT}")`);
  console.log(`[realtime] internal emit: POST http://localhost:${PORT}/emit (X-Internal-Token)`);
});

process.on("SIGINT", () => {
  console.log("[realtime] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
