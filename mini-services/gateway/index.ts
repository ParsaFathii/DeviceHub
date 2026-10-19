/**
 * DeviceHub Edge Gateway
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 *
 * Implements the edge-gateway responsibilities of the DeviceHub architecture
 * (protocol validation, dedup, offline buffering with durable spool, reconnect
 * backfill, deterministic automation, command routing, metrics) as a
 * long-running service. The wire protocol and message semantics match the
 * documented DeviceHub protocol v1; the reference binary codec lives in
 * protocol-c/ (C11).
 *
 * MQTT topics:
 *   IN : device/+/telemetry, device/+/status, device/+/ack
 *   OUT: device/{id}/command, gateway/{gatewayId}/status (retained)
 *
 * Admin API (port 3011):
 *   GET  /health
 *   GET  /status                  — metrics + device session states
 *   GET  /buffer                  — pending spool records (durable SQLite)
 *   POST /simulate-offline {sec}  — backend outage injection (buffer locally, drain after)
 *   POST /dispatch                — command routing from backend
 *   POST /buffer/clear            — drop spool (records LOST events)
 */
import mqtt from "mqtt";
import { Database } from "bun:sqlite";

const GATEWAY_ID = "edge-gw-01";
const MQTT_URL = process.env.DH_MQTT_URL || "mqtt://localhost:1883";
const BACKEND = process.env.DH_BACKEND_URL || "http://localhost:3000";
const REALTIME = process.env.DH_REALTIME_URL || "http://localhost:3013";
const INTERNAL_TOKEN = process.env.DH_INTERNAL_TOKEN || "dev-internal-token";
const PORT = 3011;
const DB_PATH = `${import.meta.dir}/data/edge.db`;

const startedAt = Date.now();

// Hot-reload safety: end any previous instance's MQTT client + timers so two
// gateway processes never fight over the persistent MQTT session.
const __g = globalThis as any;
if (typeof __g.__dhGwCleanup === "function") {
  try { __g.__dhGwCleanup(); } catch { /* ignore */ }
}
const __timers: ReturnType<typeof setInterval>[] = [];
const __iv = (fn: () => void, ms: number) => {
  const t = setInterval(fn, ms);
  __timers.push(t);
  return t;
};

// ---------------------------------------------------------------------------
// Durable spool (SQLite) — survives process restarts
// ---------------------------------------------------------------------------
const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS buffer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    msg_id TEXT NOT NULL UNIQUE,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    ts INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_buffer_created ON buffer(created_at);
`);

const SPOOL_LIMIT = 5000;

const metrics = {
  received: 0,
  forwarded: 0,
  deduped: 0,
  rejected: 0,
  buffered: 0,
  uploadedFromBuffer: 0,
  dropped: 0,
  alertsFired: 0,
  commandsRouted: 0,
  lastForwardedAt: null as number | null,
  lastDrainAt: null as number | null,
};

// bounded LRU-ish dedup window
const DEDUP_WINDOW = 8000;
const dedupSeen = new Map<string, number>(); // msgId -> ts

function isDuplicate(msgId: string): boolean {
  const now = Date.now();
  if (dedupSeen.has(msgId)) {
    dedupSeen.set(msgId, now);
    return true;
  }
  dedupSeen.set(msgId, now);
  if (dedupSeen.size > DEDUP_WINDOW) {
    // prune oldest quarter
    const entries = [...dedupSeen.entries()].sort((a, b) => a[1] - b[1]).slice(0, Math.floor(DEDUP_WINDOW / 4));
    for (const [k] of entries) dedupSeen.delete(k);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Backend / realtime helpers
// ---------------------------------------------------------------------------
let offlineMode = false;
let offlineUntil = 0;
let backendHealthy = true;

async function callBackend(method: string, path: string, body?: unknown): Promise<any | null> {
  try {
    const res = await fetch(`${BACKEND}${path}`, {
      method,
      headers: { "content-type": "application/json", "X-Internal-Token": INTERNAL_TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok && res.status >= 500) throw new Error(`backend ${res.status} for ${method} ${path}`);
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  } catch (e: any) {
    backendHealthy = false;
    console.error(`[gw] backend call FAILED ${method} ${path}: ${e?.name || ""} ${e?.message || e}`);
    return null;
  }
}

async function emitRealtime(event: string, data: unknown) {
  try {
    await fetch(`${REALTIME}/emit`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Internal-Token": INTERNAL_TOKEN },
      body: JSON.stringify({ event, data }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* realtime is non-critical */ }
}

// ---------------------------------------------------------------------------
// Message validation (DeviceHub protocol v1, JSON envelope)
// ---------------------------------------------------------------------------
const METRIC_RANGES: Record<string, { min: number; max: number; unit: string }> = {
  temperature: { min: -60, max: 150, unit: "°C" },
  humidity: { min: 0, max: 100, unit: "%" },
  pressure: { min: 700, max: 1200, unit: "hPa" },
  motion: { min: 0, max: 100, unit: "events/min" },
  power: { min: 0, max: 200, unit: "kW" },
  energy: { min: 0, max: 1e9, unit: "kWh" },
  vibration: { min: 0, max: 80, unit: "mm/s" },
  voltage: { min: 0, max: 400, unit: "V" },
  current: { min: 0, max: 200, unit: "A" },
  status: { min: 0, max: 255, unit: "code" },
};

export interface ValidationIssue {
  deviceId: string;
  reason: string;
  detail?: string;
}

function validateTelemetry(envelope: any, topic: string): { ok: true; samples: any[] } | { ok: false; reason: string } {
  if (typeof envelope !== "object" || envelope === null) return { ok: false, reason: "payload is not an object" };
  if (envelope.v !== 1) return { ok: false, reason: `unsupported schema version ${envelope.v}` };
  const deviceId = envelope.deviceId;
  if (typeof deviceId !== "string" || !/^DH-[A-Z0-9-]+$/.test(deviceId)) return { ok: false, reason: "invalid deviceId" };
  if (!topic.endsWith(`/${deviceId}/telemetry`)) return { ok: false, reason: "topic/deviceId mismatch" };
  if (typeof envelope.msgId !== "string" || envelope.msgId.length === 0 || envelope.msgId.length > 128)
    return { ok: false, reason: "invalid msgId" };
  if (!Number.isInteger(envelope.seq) || envelope.seq < 0 || envelope.seq > 1e9) return { ok: false, reason: "invalid seq" };
  const ts = envelope.ts;
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid ts" };
  const skew = Date.now() - ts;
  if (skew < -5 * 60_000) return { ok: false, reason: "timestamp too far in the future" };
  if (skew > 24 * 3600_000) return { ok: false, reason: "timestamp older than 24h" };
  if (!Array.isArray(envelope.metrics) || envelope.metrics.length === 0 || envelope.metrics.length > 16)
    return { ok: false, reason: "metrics must be a non-empty array (<=16)" };
  const samples: any[] = [];
  for (const m of envelope.metrics) {
    if (typeof m.metric !== "string" || !(m.metric in METRIC_RANGES)) return { ok: false, reason: `unknown metric ${m.metric}` };
    if (!Number.isFinite(m.value)) return { ok: false, reason: `non-finite value for ${m.metric}` };
    const range = METRIC_RANGES[m.metric];
    // out-of-range values are ACCEPTED but flagged SUSPECT (sensor may be faulty) —
    // only structurally invalid messages are rejected.
    const quality = m.quality === "GOOD" || m.quality === "SUSPECT" || m.quality === "BAD" ? m.quality : null;
    if (!quality) return { ok: false, reason: `invalid quality for ${m.metric}` };
    samples.push({
      deviceId,
      msgId: envelope.msgId,
      seq: envelope.seq,
      ts,
      metric: m.metric,
      value: m.value,
      unit: m.unit || METRIC_RANGES[m.metric].unit,
      quality,
      outOfRange: m.value < range.min || m.value > range.max,
      simulated: envelope.sim === true,
      profile: envelope.profile || null,
    });
  }
  return { ok: true, samples };
}

// ---------------------------------------------------------------------------
// Forwarding queue with offline buffering
// ---------------------------------------------------------------------------
const forwardQueue: { topic: string; payload: string; parsed: any }[] = [];
const MAX_QUEUE = 10000;

function enqueue(topic: string, payload: string) {
  if (forwardQueue.length >= MAX_QUEUE) {
    metrics.dropped++;
    console.error(`[gw] forward queue overflow — dropping oldest (total dropped ${metrics.dropped})`);
    forwardQueue.shift();
  }
  let parsed: any = null;
  try { parsed = JSON.parse(payload); } catch { parsed = null; }
  forwardQueue.push({ topic, payload, parsed });
}

function spool(topic: string, payload: string): void {
  let parsed: any;
  try { parsed = JSON.parse(payload); } catch { return; }
  const msgId = parsed?.msgId;
  if (typeof msgId !== "string") return;
  const ts = Number.isFinite(parsed?.ts) ? parsed.ts : Date.now();
  try {
    const count = (db.query("SELECT COUNT(*) AS c FROM buffer").get() as any).c;
    if (count >= SPOOL_LIMIT) {
      // drop OLDEST, record a clear loss event
      const oldest = db.query("SELECT id, msg_id FROM buffer ORDER BY created_at ASC LIMIT 1").get() as any;
      if (oldest) {
        db.run("DELETE FROM buffer WHERE id = ?", [oldest.id]);
        metrics.dropped++;
        console.error(`[gw] spool overflow — LOST buffered record ${oldest.msg_id} (limit ${SPOOL_LIMIT})`);
      }
    }
    db.run("INSERT OR IGNORE INTO buffer (msg_id, topic, payload, ts, created_at) VALUES (?,?,?,?,?)", [
      msgId, topic, payload, ts, Date.now(),
    ]);
    metrics.buffered++;
  } catch (e: any) {
    console.error(`[gw] spool write failed: ${e.message}`);
  }
}

let draining = false;
async function drainSpool(): Promise<void> {
  if (draining) { console.log("[gw] drain already running"); return; }
  draining = true;
  let iterations = 0;
  try {
    let drained = 0;
    while (true) {
      iterations++;
      if (iterations > 1000) { console.error("[gw] drain loop guard triggered"); break; }
      const rows = db.query("SELECT * FROM buffer ORDER BY created_at ASC LIMIT 20").all() as any[];
      if (rows.length === 0) break;
      const messages = rows.map((r) => ({ topic: r.topic, payload: r.payload, parsed: safeJson(r.payload) }));
      console.log(`[gw] drain batch #${iterations}: posting ${messages.length} (pending ${pendingCount()})`);
      const res = await callBackend("POST", "/api/internal/telemetry", { messages, fromBuffer: true });
      console.log(`[gw] drain batch #${iterations}: result ok=${res?.ok} status=${res?.status}`);
      if (!res || !res.ok) {
        console.warn(`[gw] drain failed — backend unavailable, ${rows.length} records remain spooled`);
        break;
      }
      for (const r of rows) db.run("DELETE FROM buffer WHERE id = ?", [r.id]);
      drained += rows.length;
      metrics.uploadedFromBuffer += rows.length;
      await new Promise((r) => setTimeout(r, 50)); // gentle drain rate
    }
    if (drained > 0) {
      metrics.lastDrainAt = Date.now();
      console.log(`[gw] drained ${drained} buffered records to backend`);
      await callBackend("POST", "/api/internal/gateway/event", {
        gatewayId: GATEWAY_ID, type: "DRAINED", detail: { drained, pending: pendingCount() },
      });
      await emitRealtime("activity", { type: "GATEWAY", message: `Edge gateway drained ${drained} buffered records after reconnection`, ts: new Date().toISOString() });
    }
  } finally {
    draining = false;
  }
}

function pendingCount(): number {
  return (db.query("SELECT COUNT(*) AS c FROM buffer").get() as any).c;
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

let forwarding = false;
async function flushForwardQueue(): Promise<void> {
  if (forwarding || forwardQueue.length === 0) return;
  forwarding = true;
  try {
    if (offlineMode || !backendHealthy) {
      // move everything into the durable spool
      while (forwardQueue.length > 0) {
        const item = forwardQueue.shift()!;
        spool(item.topic, item.payload);
      }
      return;
    }
    const batch = forwardQueue.splice(0, 25);
    const messages = batch.map((b) => ({ topic: b.topic, payload: b.payload, parsed: b.parsed }));
    const res = await callBackend("POST", "/api/internal/telemetry", { messages, fromBuffer: false });
    if (!res || !res.ok) {
      if (res && res.status === 400) {
        // malformed batch — log and drop (never retry structurally invalid data)
        metrics.rejected += messages.length;
        console.warn(`[gw] backend rejected batch (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
      } else {
        // backend down → spool for later
        for (const m of messages) spool(m.topic, m.payload);
        console.warn(`[gw] backend unavailable — spooled ${messages.length} messages`);
      }
    } else {
      metrics.forwarded += messages.length;
      metrics.lastForwardedAt = Date.now();
      backendHealthy = true;
    }
  } finally {
    forwarding = false;
  }
}

__iv(flushForwardQueue, 2000);

// ---------------------------------------------------------------------------
// Device session state (online/offline derivation)
// ---------------------------------------------------------------------------
interface DeviceSession {
  lastSeen: number;
  lastState: string;
  lastTelemetry: any | null;
}

const sessions = new Map<string, DeviceSession>();
const OFFLINE_TIMEOUT_MS = 45_000;
const ONLINE_STATES = new Set(["PROVISIONED", "OFFLINE", "ERROR", "DEGRADED", "MAINTENANCE"]);

function touchSession(deviceId: string, telemetry?: any) {
  const now = Date.now();
  const s = sessions.get(deviceId) || { lastSeen: now, lastState: "PROVISIONED", lastTelemetry: null };
  s.lastSeen = now;
  if (telemetry) s.lastTelemetry = telemetry;
  if (s.lastState !== "ONLINE") {
    s.lastState = "ONLINE";
    void callBackend("PATCH", `/api/internal/devices/${deviceId}`, { state: "ONLINE", reason: "telemetry/heartbeat received" });
    void emitRealtime("device-state", { deviceId, state: "ONLINE", lastSeenAt: new Date(now).toISOString() });
  }
  sessions.set(deviceId, s);
}

__iv(() => {
  const now = Date.now();
  for (const [deviceId, s] of sessions) {
    if (s.lastState === "ONLINE" && now - s.lastSeen > OFFLINE_TIMEOUT_MS) {
      s.lastState = "OFFLINE";
      console.log(`[gw] device ${deviceId} timed out (no message for ${Math.round((now - s.lastSeen) / 1000)}s) → OFFLINE`);
      void callBackend("PATCH", `/api/internal/devices/${deviceId}`, { state: "OFFLINE", reason: `no message for ${Math.round((now - s.lastSeen) / 1000)}s` });
      void emitRealtime("device-state", { deviceId, state: "OFFLINE", lastSeenAt: new Date(s.lastSeen).toISOString() });
    }
  }
}, 5000);

// ---------------------------------------------------------------------------
// Automation engine (deterministic rules evaluated at the edge)
// ---------------------------------------------------------------------------
interface Rule {
  ruleId: string;
  name: string;
  enabled: boolean;
  deviceSelector: any;
  metric: string;
  condition: "ABOVE" | "BELOW";
  threshold: number;
  durationSec: number;
  severity: string;
  cooldownSec: number;
  priority: number;
  version: number;
  lastTriggeredAt: string | null;
}

let rules: Rule[] = [];

async function refreshRules() {
  const res = await callBackend("GET", "/api/internal/rules");
  if (res && res.ok && Array.isArray(res.data?.rules)) {
    rules = res.data.rules;
  }
}

__iv(refreshRules, 15000);

// rule+device → condition state
interface CondState {
  heldSince: number | null;
  lastOutcome: string;
}
const condStates = new Map<string, CondState>();

function selectorMatches(rule: Rule, deviceId: string, deviceType: string | null): boolean {
  const sel = rule.deviceSelector || {};
  if (sel.deviceId) return sel.deviceId === deviceId;
  if (sel.type) return deviceType === sel.type;
  return false;
}

// device type lookup from backend device list (cached)
const deviceTypes = new Map<string, string>();
async function refreshDeviceTypes() {
  const res = await callBackend("GET", "/api/internal/devices");
  if (res && res.ok && Array.isArray(res.data?.devices)) {
    for (const d of res.data.devices) deviceTypes.set(d.deviceId, d.type);
  }
}
__iv(refreshDeviceTypes, 60000);

async function evaluateRules(deviceId: string, samples: any[]) {
  const deviceType = deviceTypes.get(deviceId) || null;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!selectorMatches(rule, deviceId, deviceType)) continue;
    const sample = samples.find((s) => s.metric === rule.metric);
    if (!sample) continue;
    const key = `${rule.ruleId}:${deviceId}`;
    const cs = condStates.get(key) || { heldSince: null, lastOutcome: "NOT_MET" };
    const met = rule.condition === "ABOVE" ? sample.value > rule.threshold : sample.value < rule.threshold;

    if (!met) {
      if (cs.lastOutcome !== "NOT_MET") {
        cs.lastOutcome = "NOT_MET";
        void callBackend("POST", "/api/internal/rule-executions", { ruleId: rule.ruleId, deviceId, outcome: "NOT_MET", detail: { observed: sample.value } });
      }
      cs.heldSince = null;
      condStates.set(key, cs);
      continue;
    }

    if (cs.heldSince === null) {
      cs.heldSince = Date.now();
      cs.lastOutcome = "CONDITION_MET_WAITING";
      void callBackend("POST", "/api/internal/rule-executions", { ruleId: rule.ruleId, deviceId, outcome: "CONDITION_MET_WAITING", detail: { observed: sample.value, mustHoldSec: rule.durationSec } });
      condStates.set(key, cs);
      continue;
    }

    const heldSec = (Date.now() - cs.heldSince) / 1000;
    if (heldSec >= rule.durationSec) {
      // cooldown check
      if (rule.lastTriggeredAt && Date.now() - new Date(rule.lastTriggeredAt).getTime() < rule.cooldownSec * 1000) {
        if (cs.lastOutcome !== "SUPPRESSED_COOLDOWN") {
          cs.lastOutcome = "SUPPRESSED_COOLDOWN";
          void callBackend("POST", "/api/internal/rule-executions", { ruleId: rule.ruleId, deviceId, outcome: "SUPPRESSED_COOLDOWN", detail: { observed: sample.value, heldSec: Math.round(heldSec) } });
        }
        condStates.set(key, cs);
        continue;
      }
      // FIRE
      cs.heldSince = null;
      cs.lastOutcome = "FIRED";
      condStates.set(key, cs);
      metrics.alertsFired++;
      const res = await callBackend("POST", "/api/internal/alerts", {
        ruleId: rule.ruleId,
        deviceId,
        severity: rule.severity,
        title: `${rule.name}: ${rule.metric} ${rule.condition === "ABOVE" ? "above" : "below"} ${rule.threshold}${sample.unit}`,
        message: `${rule.metric} held ${rule.condition.toLowerCase()} ${rule.threshold}${sample.unit} for ${Math.round(heldSec)}s (observed ${sample.value}${sample.unit}). Rule v${rule.version}, priority ${rule.priority}.`,
        evidence: {
          observed: sample.value,
          threshold: rule.threshold,
          heldSec: Math.round(heldSec),
          ruleVersion: rule.version,
          sampleTs: new Date(sample.ts).toISOString(),
          quality: sample.quality,
        },
      });
      if (res && res.ok) {
        console.log(`[gw] ALERT FIRED: rule=${rule.ruleId} device=${deviceId} value=${sample.value}${sample.unit}`);
        rule.lastTriggeredAt = new Date().toISOString();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MQTT connection
// ---------------------------------------------------------------------------
const mqttClient = mqtt.connect(MQTT_URL, {
  clientId: `gateway-${GATEWAY_ID}`,
  clean: false, // persistent session: broker queues QoS1 messages while gateway reconnects
  keepalive: 30,
  reconnectPeriod: 3000,
  connectTimeout: 8000,
});

mqttClient.on("connect", () => {
  console.log(`[gw] MQTT connected as gateway-${GATEWAY_ID} (clean=false, persistent session)`);
  mqttClient.subscribe(
    ["device/+/telemetry", "device/+/status", "device/+/ack"],
    { qos: 1 },
    (err) => {
      if (err) console.error(`[gw] subscribe failed: ${err.message}`);
    }
  );
  publishGatewayStatus("CONNECTED");
  void callBackend("POST", "/api/internal/gateway/event", { gatewayId: GATEWAY_ID, type: "CONNECTED", detail: { mqtt: true } });
  void drainSpool(); // restart recovery: upload anything persisted before the crash
  void refreshRules();
  void refreshDeviceTypes();
});

mqttClient.on("reconnect", () => console.log(`[gw] MQTT reconnecting...`));
mqttClient.on("close", () => {
  publishGatewayStatus("DISCONNECTED");
});
mqttClient.on("error", (err) => console.warn(`[gw] MQTT error: ${err.message}`));

let realtimeAccumulator = new Map<string, any[]>();
let realtimeFlushTimer: ReturnType<typeof setInterval> | null = __iv(() => {
  if (realtimeAccumulator.size === 0) return;
  const payload = Object.fromEntries(realtimeAccumulator);
  realtimeAccumulator = new Map();
  emitRealtime("telemetry", { devices: payload });
}, 1500);

mqttClient.on("message", (topic, message) => {
  metrics.received++;
  const payload = message.toString();
  if (payload.length > 64 * 1024) {
    metrics.rejected++;
    console.warn(`[gw] oversized message on ${topic} (${payload.length}B) — rejected`);
    return;
  }
  const parsed = safeJson(payload);
  if (!parsed) {
    metrics.rejected++;
    console.warn(`[gw] non-JSON payload on ${topic} — rejected`);
    return;
  }

  if (topic.endsWith("/telemetry")) {
    const result = validateTelemetry(parsed, topic);
    if (!result.ok) {
      metrics.rejected++;
      console.warn(`[gw] rejected telemetry on ${topic}: ${result.reason}`);
      void emitRealtime("activity", { type: "GATEWAY_REJECT", message: `Rejected telemetry on ${topic}: ${result.reason}`, ts: new Date().toISOString() });
      return;
    }
    if (isDuplicate(parsed.msgId)) {
      metrics.deduped++;
      return; // repeated MQTT delivery / device retry — drop silently (counted)
    }
    touchSession(parsed.deviceId, parsed);
    enqueue(topic, payload);
    // realtime accumulation (only validated live samples)
    const arr = realtimeAccumulator.get(parsed.deviceId) || [];
    for (const s of result.samples) arr.push({ metric: s.metric, value: s.value, unit: s.unit, quality: s.quality, sampleTs: new Date(s.ts).toISOString(), seq: s.seq, simulated: s.simulated });
    realtimeAccumulator.set(parsed.deviceId, arr);
    void evaluateRules(parsed.deviceId, result.samples);
  } else if (topic.endsWith("/status")) {
    // device status/heartbeat
    const deviceId = parsed.deviceId;
    if (typeof deviceId !== "string") return;
    if (parsed.state === "ONLINE" || parsed.state === "MAINTENANCE") {
      touchSession(deviceId);
      // health updates forwarded to backend
      if (Number.isFinite(parsed.health)) {
        void callBackend("PATCH", `/api/internal/devices/${deviceId}`, { health: Math.max(0, Math.min(100, Math.round(parsed.health))) });
      }
    } else if (parsed.state === "OFFLINE") {
      const s = sessions.get(deviceId);
      if (s && s.lastState !== "OFFLINE") {
        s.lastState = "OFFLINE";
        void callBackend("PATCH", `/api/internal/devices/${deviceId}`, { state: "OFFLINE", reason: "device reported offline" });
        void emitRealtime("device-state", { deviceId, state: "OFFLINE", lastSeenAt: new Date().toISOString() });
      }
    }
  } else if (topic.endsWith("/ack")) {
    handleAck(parsed);
  }
});

// ---------------------------------------------------------------------------
// Command routing
// ---------------------------------------------------------------------------
interface PendingCommand {
  commandId: string;
  deviceId: string;
  timer: ReturnType<typeof setTimeout>;
}
const pendingCommands = new Map<string, PendingCommand>();

async function dispatchCommand(body: any): Promise<{ ok: boolean; error?: string }> {
  const { commandId, deviceId, action, payload } = body;
  if (!commandId || !deviceId || !action) return { ok: false, error: "commandId, deviceId and action are required" };
  const topic = `device/${deviceId}/command`;
  const envelope = { v: 1, commandId, deviceId, action, payload: payload || {}, issuedAt: Date.now(), expiresAt: body.expiresAt || Date.now() + 120000 };
  const seen = sessions.get(deviceId);
  if (!seen || Date.now() - seen.lastSeen > 60_000) {
    return { ok: false, error: "device is not connected to this gateway" };
  }
  metrics.commandsRouted++;
  // Register the ack-wait BEFORE publishing: a fast device (the simulator acks
  // REBOOT in <1ms) can have its acknowledgement delivered on the same
  // event-loop tick as the QoS-1 PUBACK — i.e. before the publish callback
  // resolves — and the ack must never be dropped as "unknown command".
  const timer = setTimeout(() => {
    const p = pendingCommands.get(commandId);
    if (p) {
      pendingCommands.delete(commandId);
      void callBackend("PATCH", `/api/internal/commands/${commandId}/state`, {
        state: "FAILED", result: { error: "no acknowledgement received within timeout" }, ackCode: "ERROR",
      });
      void emitRealtime("command", { commandId, deviceId, action, state: "FAILED", detail: "ack timeout" });
    }
  }, 30000);
  pendingCommands.set(commandId, { commandId, deviceId, timer });
  await new Promise<void>((resolve) => {
    mqttClient.publish(topic, JSON.stringify(envelope), { qos: 1 }, () => resolve());
  });
  void callBackend("PATCH", `/api/internal/commands/${commandId}/state`, { state: "SENT", sentAt: new Date().toISOString() });
  void emitRealtime("command", { commandId, deviceId, action, state: "SENT" });
  return { ok: true };
}

function handleAck(parsed: any) {
  const { commandId, code, detail } = parsed;
  if (typeof commandId !== "string") return;
  const pending = pendingCommands.get(commandId);
  if (!pending) return; // late or unknown ack — ignore
  clearTimeout(pending.timer);
  pendingCommands.delete(commandId);
  const okCode = code === "OK";
  const ts = new Date().toISOString();
  void callBackend("PATCH", `/api/internal/commands/${commandId}/state`, {
    state: okCode ? "SUCCEEDED" : "FAILED",
    ackCode: code,
    ackDetail: detail || "",
    completedAt: ts,
    result: okCode ? { ack: code, detail: detail || "" } : { error: `device responded ${code}`, detail: detail || "" },
  });
  void emitRealtime("command", { commandId, deviceId: pending.deviceId, state: okCode ? "SUCCEEDED" : "FAILED", ackCode: code, detail });
  console.log(`[gw] command ${commandId} ${okCode ? "SUCCEEDED" : "FAILED"} (${code})`);
}

// ---------------------------------------------------------------------------
// Gateway status publishing
// ---------------------------------------------------------------------------
function publishGatewayStatus(state: string) {
  const status = {
    gatewayId: GATEWAY_ID,
    state,
    ts: Date.now(),
    metrics: { ...metrics, queueDepth: forwardQueue.length, pendingSpool: pendingCount() },
  };
  mqttClient.publish(`gateway/${GATEWAY_ID}/status`, JSON.stringify(status), { qos: 1, retain: true });
}

async function heartbeat() {
  const state = mqttClient.connected ? (offlineMode ? "BUFFERING" : "ONLINE") : "OFFLINE";
  publishGatewayStatus(state);
  const wasUnhealthy = !backendHealthy;
  const res = await callBackend("POST", "/api/internal/gateway/status", {
    gatewayId: GATEWAY_ID,
    state: offlineMode ? "BUFFERING" : mqttClient.connected ? "ONLINE" : "OFFLINE",
    metrics: { ...metrics, queueDepth: forwardQueue.length, pendingSpool: pendingCount(), uptimeSec: Math.round((Date.now() - startedAt) / 1000) },
  });
  if (res && res.ok) {
    backendHealthy = true;
    if (wasUnhealthy) {
      console.log(`[gw] backend reachable again — draining spool (${pendingCount()} pending)`);
      await callBackend("POST", "/api/internal/gateway/event", { gatewayId: GATEWAY_ID, type: "DRAINING", detail: { pending: pendingCount() } });
      await drainSpool();
    }
  }
  if (offlineMode && Date.now() >= offlineUntil) {
    offlineMode = false;
    console.log(`[gw] simulated backend outage ended — draining spool (${pendingCount()} pending)`);
    void callBackend("POST", "/api/internal/gateway/event", { gatewayId: GATEWAY_ID, type: "DRAINING", detail: { pending: pendingCount() } });
    void emitRealtime("gateway", { gatewayId: GATEWAY_ID, state: "ONLINE", buffering: false, pending: pendingCount() });
    await drainSpool();
    void emitRealtime("gateway", { gatewayId: GATEWAY_ID, state: "ONLINE", buffering: false, pending: pendingCount(), drained: true });
  }
}
__iv(heartbeat, 5000);

__g.__dhGwCleanup = () => {
  for (const t of __timers) clearInterval(t);
  try { mqttClient.end(true); } catch { /* ignore */ }
  try { server?.stop?.(); } catch { /* ignore */ }
};

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", service: "devicehub-gateway", gatewayId: GATEWAY_ID, port: PORT });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json({
        gatewayId: GATEWAY_ID,
        mqttConnected: mqttClient.connected,
        backendHealthy,
        offlineMode,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        metrics: { ...metrics, queueDepth: forwardQueue.length, pendingSpool: pendingCount() },
        devices: [...sessions.entries()].map(([id, s]) => ({ deviceId: id, state: s.lastState, lastSeen: new Date(s.lastSeen).toISOString() })),
      });
    }
    if (req.method === "GET" && url.pathname === "/buffer") {
      const rows = db.query("SELECT msg_id, topic, ts, tries, created_at FROM buffer ORDER BY created_at DESC LIMIT 200").all() as any[];
      return Response.json({
        pending: pendingCount(),
        limit: SPOOL_LIMIT,
        records: rows.map((r) => ({ msgId: r.msg_id, topic: r.topic, ts: new Date(r.ts).toISOString(), tries: r.tries, bufferedAt: new Date(r.created_at).toISOString() })),
      });
    }
    if (req.method === "POST" && url.pathname === "/simulate-offline") {
      const body = await req.json().catch(() => ({}));
      const sec = Math.max(5, Math.min(600, Number(body.seconds) || 60));
      offlineMode = true;
      offlineUntil = Date.now() + sec * 1000;
      console.warn(`[gw] FAILURE INJECTION: simulated backend outage for ${sec}s — buffering locally`);
      await callBackend("POST", "/api/internal/gateway/event", { gatewayId: GATEWAY_ID, type: "BUFFERING", detail: { injectedSeconds: sec } });
      await emitRealtime("gateway", { gatewayId: GATEWAY_ID, state: "BUFFERING", buffering: true, injectedSeconds: sec });
      await emitRealtime("activity", { type: "GATEWAY", message: `Failure injection: backend outage simulated for ${sec}s — edge gateway buffering locally`, ts: new Date().toISOString() });
      return Response.json({ ok: true, offlineForSec: sec, note: "telemetry will be buffered in durable spool and drained automatically" });
    }
    if (req.method === "POST" && url.pathname === "/dispatch") {
      const body = await req.json().catch(() => ({}));
      const result = await dispatchCommand(body);
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }
    if (req.method === "POST" && url.pathname === "/buffer/clear") {
      const n = pendingCount();
      db.run("DELETE FROM buffer");
      if (n > 0) {
        metrics.dropped += n;
        await callBackend("POST", "/api/internal/gateway/event", { gatewayId: GATEWAY_ID, type: "OVERFLOW", detail: { lost: n, reason: "spool manually cleared" } });
      }
      return Response.json({ ok: true, cleared: n });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(`[gw] DeviceHub edge gateway admin API on :${PORT}`);
console.log(`[gw] MQTT ${MQTT_URL} | backend ${BACKEND} | realtime ${REALTIME}`);
console.log(`[gw] durable spool at ${DB_PATH} (limit ${SPOOL_LIMIT} records)`);

process.on("SIGINT", () => {
  console.log("[gw] graceful shutdown — flushing state");
  publishGatewayStatus("OFFLINE");
  server.stop();
  mqttClient.end(false, {}, () => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});
