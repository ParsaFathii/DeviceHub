/**
 * DeviceHub Device Simulator Fleet
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 *
 * Deterministic, seeded simulated devices publishing over real MQTT (port 1883).
 * Every message is explicitly marked simulated:true — the platform never presents
 * simulator data as physical-device data.
 *
 * Profiles (reproducible via per-device seeds):
 *   STABLE              — nominal values with sensor noise
 *   GRADUAL_DRIFT       — slow trend away from baseline
 *   THRESHOLD_VIOLATION — value ramps above rule thresholds (drives real alerts)
 *   INTERMITTENT        — periodic connectivity drops, reconnects, resumes
 *   SENSOR_FAULT        — occasional out-of-spec spikes flagged SUSPECT/BAD quality
 *   STALE               — publishes a few samples, then goes silent (device OFFLINE)
 *
 * Control API (port 3012):
 *   GET  /status                     — fleet state
 *   POST /control {deviceId, action} — pause | resume | duplicate-last | delayed | replay-late-batch | profile
 *   POST /fleet   {action}           — pause | resume | restart (restart resets seeds → deterministic replay)
 */
import mqtt from "mqtt";

const MQTT_URL = process.env.DH_MQTT_URL || "mqtt://localhost:1883";
const BACKEND = process.env.DH_BACKEND_URL || "http://localhost:3000";
const INTERNAL_TOKEN = process.env.DH_INTERNAL_TOKEN || "dev-internal-token";
const PORT = 3012;

// Hot-reload safety: end the previous module instance's clients + timers so
// zombie heartbeats never keep "silenced" devices artificially alive.
const __g = globalThis as any;
if (typeof __g.__dhSimCleanup === "function") {
  try { __g.__dhSimCleanup(); } catch { /* ignore */ }
}
const __simTimers: ReturnType<typeof setInterval>[] = [];
const __iv = (fn: () => void, ms: number) => {
  const t = setInterval(fn, ms);
  __simTimers.push(t);
  return t;
};

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — reproducible measurement profiles
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rnd: () => number, mean: number, sigma: number): number {
  const u = Math.max(rnd(), 1e-9);
  const v = rnd();
  return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Device model
// ---------------------------------------------------------------------------
interface DeviceSpec {
  deviceId: string;
  name: string;
  type: string;
  profile: string;
  seed: number;
  zone?: string;
  intervalSec: number;
}

interface SimDevice {
  spec: DeviceSpec;
  client: mqtt.MqttClient | null;
  connected: boolean;
  paused: boolean;
  killed: boolean;
  seq: number;
  statusSeq: number;
  sampleCount: number;
  published: number;
  lastEnvelope: any | null;
  lastPublishAt: number | null;
  rnd: () => number;
  timer: ReturnType<typeof setInterval> | null;
  statusTimer: ReturnType<typeof setInterval> | null;
  drift: number;
  offlineUntil: number;
  nextOfflineAt: number;
  wentSilent: boolean;
  health: number;
  energyCounter: number;
  rebootingUntil: number;
}

const METRIC_DEFS: Record<string, { base: number; sigma: number; unit: string; min: number; max: number; decimals: number }> = {
  temperature: { base: 22, sigma: 0.6, unit: "°C", min: -40, max: 125, decimals: 2 },
  humidity: { base: 45, sigma: 2, unit: "%", min: 0, max: 100, decimals: 1 },
  pressure: { base: 1013, sigma: 2, unit: "hPa", min: 800, max: 1200, decimals: 1 },
  motion: { base: 2, sigma: 1.4, unit: "events/min", min: 0, max: 30, decimals: 0 },
  power: { base: 8.5, sigma: 0.7, unit: "kW", min: 0, max: 60, decimals: 2 },
  energy: { base: 0, sigma: 0, unit: "kWh", min: 0, max: 1e9, decimals: 2 },
  vibration: { base: 3.2, sigma: 0.5, unit: "mm/s", min: 0, max: 40, decimals: 2 },
  voltage: { base: 230, sigma: 1.8, unit: "V", min: 180, max: 260, decimals: 1 },
  current: { base: 12, sigma: 0.8, unit: "A", min: 0, max: 60, decimals: 2 },
  status: { base: 0, sigma: 0, unit: "code", min: 0, max: 0, decimals: 0 },
};

const TYPE_METRICS: Record<string, string[]> = {
  ENV_SENSOR: ["temperature", "humidity", "pressure"],
  TEMP_HUM: ["temperature", "humidity"],
  MOTION: ["motion"],
  POWER_METER: ["power", "energy"],
  VIBRATION: ["vibration"],
  VOLTAGE: ["voltage", "current"],
  STATUS: ["status"],
};

const devices = new Map<string, SimDevice>();

// ---------------------------------------------------------------------------
// Value generation — profile-driven, deterministic
// ---------------------------------------------------------------------------
function generateValue(dev: SimDevice, metric: string): { value: number; quality: string } {
  const def = METRIC_DEFS[metric];
  const p = dev.spec.profile;
  let value = def.base;
  let quality = "GOOD";

  if (metric === "energy") {
    // cumulative counter
    const powerDef = METRIC_DEFS.power;
    dev.energyCounter += (powerDef.base + dev.drift * 4) * (dev.spec.intervalSec / 3600);
    return { value: Number(dev.energyCounter.toFixed(2)), quality };
  }
  if (metric === "status") {
    return { value: p === "SENSOR_FAULT" && dev.rnd() < 0.1 ? 1 : 0, quality };
  }

  value = gaussian(dev.rnd, def.base, def.sigma);

  switch (p) {
    case "STABLE":
      break;
    case "GRADUAL_DRIFT":
      dev.drift += 0.015;
      value += dev.drift;
      break;
    case "THRESHOLD_VIOLATION":
      // nominal for first 24 samples, then ramp: temperature climbs to ~92°C
      if (dev.sampleCount > 24) {
        const ramp = Math.min(70, (dev.sampleCount - 24) * 2.2);
        if (metric === "temperature") value = def.base + ramp + gaussian(dev.rnd, 0, 0.8);
        else if (metric === "humidity") value = def.base - ramp * 0.3 + gaussian(dev.rnd, 0, 0.5);
        else value += ramp * 0.1;
      }
      break;
    case "SENSOR_FAULT":
      if (dev.rnd() < 0.12) {
        const spike = dev.rnd() < 0.5 ? 5.5 : 0.22;
        value = def.base * spike + gaussian(dev.rnd, 0, def.sigma);
        quality = dev.rnd() < 0.5 ? "SUSPECT" : "BAD";
      }
      break;
    default:
      break;
  }

  // GRADUAL_DRIFT also affects other metrics mildly
  if (p === "GRADUAL_DRIFT" && metric !== "temperature") value += dev.drift * 0.4;

  // clamp to physical plausible range; mark clipped values as suspect
  if (value < def.min) {
    value = def.min;
    quality = "SUSPECT";
  }
  if (value > def.max) {
    value = def.max;
    quality = "SUSPECT";
  }
  return { value: Number(value.toFixed(def.decimals)), quality };
}

// ---------------------------------------------------------------------------
// MQTT publishing
// ---------------------------------------------------------------------------
function buildTelemetryEnvelope(dev: SimDevice, ts: number, seqOverride?: number) {
  const metrics = TYPE_METRICS[dev.spec.type] || ["status"];
  const m = metrics.map((metric) => {
    const { value, quality } = generateValue(dev, metric);
    return { metric, value, unit: METRIC_DEFS[metric].unit, quality };
  });
  const seq = seqOverride ?? ++dev.seq;
  return {
    v: 1,
    deviceId: dev.spec.deviceId,
    msgId: `${dev.spec.deviceId}-${seq}`,
    seq,
    ts,
    metrics: m,
    sim: true,
    profile: dev.spec.profile,
  };
}

function publishTelemetry(dev: SimDevice, seqOverride?: number, tsOverride?: number) {
  if (!dev.client || !dev.connected) return;
  const ts = tsOverride ?? Date.now();
  const envelope = buildTelemetryEnvelope(dev, ts, seqOverride);
  if (seqOverride !== undefined) {
    // do not advance internal state for injected replays
    dev.seq = Math.max(dev.seq, 0);
  }
  dev.client.publish(
    `device/${dev.spec.deviceId}/telemetry`,
    JSON.stringify(envelope),
    { qos: 1, retain: false },
    (err) => {
      if (err) return console.warn(`[sim] publish error ${dev.spec.deviceId}: ${err.message}`);
      dev.published++;
      dev.lastEnvelope = envelope;
      dev.lastPublishAt = Date.now();
      dev.sampleCount++;
      // health degrades slightly for faulty sensors, recovers otherwise
      if (dev.spec.profile === "SENSOR_FAULT") dev.health = Math.max(55, dev.health - 0.4);
      else dev.health = Math.min(100, dev.health + 0.3);
    }
  );
}

function publishStatus(dev: SimDevice, state: string, detail?: Record<string, unknown>) {
  if (!dev.client || !dev.connected) return;
  const payload = {
    v: 1,
    deviceId: dev.spec.deviceId,
    msgId: `${dev.spec.deviceId}-st-${++dev.statusSeq}`,
    ts: Date.now(),
    state,
    health: Math.round(dev.health),
    fw: "1.4.2",
    proto: 1,
    sim: true,
    detail: detail || {},
  };
  dev.client.publish(`device/${dev.spec.deviceId}/status`, JSON.stringify(payload), { qos: 1, retain: true });
}

function connectDevice(dev: SimDevice) {
  if (dev.client) {
    try { dev.client.end(true); } catch { /* ignore */ }
    dev.client = null;
  }
  const client = mqtt.connect(MQTT_URL, {
    clientId: `${dev.spec.deviceId}-${Math.random().toString(16).slice(2, 8)}`,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2500,
    connectTimeout: 8000,
    will: {
      topic: `device/${dev.spec.deviceId}/status`,
      payload: JSON.stringify({ v: 1, deviceId: dev.spec.deviceId, ts: Date.now(), state: "OFFLINE", reason: "unexpected", sim: true }),
      qos: 1,
      retain: true,
    },
  });
  dev.client = client;

  client.on("connect", () => {
    dev.connected = true;
    console.log(`[sim] ${dev.spec.deviceId} MQTT connected (${dev.spec.profile})`);
    client.subscribe(`device/${dev.spec.deviceId}/command`, { qos: 1 });
    publishStatus(dev, "ONLINE", { profile: dev.spec.profile });
    // immediate first sample so dashboards populate fast
    if (!dev.paused && !dev.killed && !dev.wentSilent && Date.now() >= dev.rebootingUntil) {
      publishTelemetry(dev);
    }
  });

  client.on("reconnect", () => {
    if (dev.connected) console.log(`[sim] ${dev.spec.deviceId} reconnecting...`);
    dev.connected = false;
  });
  client.on("close", () => { dev.connected = false; });
  client.on("error", (err) => {
    if (dev.connected) console.warn(`[sim] ${dev.spec.deviceId} error: ${err.message}`);
  });

  // ---- command handling ---------------------------------------------------
  client.on("message", (topic, message) => {
    if (!topic.endsWith("/command")) return;
    let cmd: any;
    try { cmd = JSON.parse(message.toString()); } catch { return; }
    const { commandId, action, payload } = cmd;
    console.log(`[sim] ${dev.spec.deviceId} received command ${commandId} action=${action}`);
    const ack = (code: string, detail?: string) => {
      dev.client?.publish(
        `device/${dev.spec.deviceId}/ack`,
        JSON.stringify({ v: 1, commandId, deviceId: dev.spec.deviceId, code, detail: detail || "", ts: Date.now(), sim: true }),
        { qos: 1 }
      );
    };
    switch (action) {
      case "REBOOT":
        ack("OK", "rebooting in 1s");
        setTimeout(() => {
          publishStatus(dev, "MAINTENANCE", { note: "reboot requested" });
          dev.rebootingUntil = Date.now() + 8000;
          setTimeout(() => publishStatus(dev, "ONLINE", { note: "reboot complete" }), 8000);
        }, 1000);
        break;
      case "SET_INTERVAL": {
        const s = Number(payload?.intervalSec);
        if (!Number.isFinite(s) || s < 2 || s > 300) return ack("REJECTED", "intervalSec must be 2..300");
        dev.spec.intervalSec = s;
        restartTimer(dev);
        ack("OK", `interval set to ${s}s`);
        break;
      }
      case "RESET_ENERGY":
        dev.energyCounter = 0;
        ack("OK", "energy counter reset");
        break;
      case "SELF_TEST":
        setTimeout(() => ack("OK", `self-test passed (profile=${dev.spec.profile}, health=${Math.round(dev.health)})`), 1500);
        break;
      default:
        ack("UNSUPPORTED", `action ${action} not supported by ${dev.spec.type}`);
    }
  });
}

function restartTimer(dev: SimDevice) {
  if (dev.timer) clearInterval(dev.timer);
  dev.timer = setInterval(() => {
    tick(dev);
  }, dev.spec.intervalSec * 1000);
}

function tick(dev: SimDevice) {
  const now = Date.now();
  if (dev.paused || dev.killed || dev.wentSilent || now < dev.rebootingUntil) return;

  // INTERMITTENT profile: scheduled connectivity windows
  if (dev.spec.profile === "INTERMITTENT") {
    if (now >= dev.nextOfflineAt) {
      if (now < dev.offlineUntil) return; // in offline window
      // offline window ended → schedule next one
      dev.nextOfflineAt = now + 60000 + Math.floor(dev.rnd() * 60000);
      dev.offlineUntil = dev.nextOfflineAt + 20000 + Math.floor(dev.rnd() * 20000);
    }
  }

  // STALE profile: after 5 samples go permanently silent
  if (dev.spec.profile === "STALE" && dev.sampleCount >= 5) {
    dev.wentSilent = true;
    console.log(`[sim] ${dev.spec.deviceId} going silent (STALE profile)`);
    return;
  }

  publishTelemetry(dev);
}

// ---------------------------------------------------------------------------
// Fleet bootstrap from backend registry
// ---------------------------------------------------------------------------
async function fetchFleet(): Promise<DeviceSpec[]> {
  const res = await fetch(`${BACKEND}/api/internal/devices`, {
    headers: { "X-Internal-Token": INTERNAL_TOKEN },
  });
  if (!res.ok) throw new Error(`backend responded ${res.status}`);
  const data = await res.json();
  return data.devices.map((d: any) => ({
    deviceId: d.deviceId,
    name: d.name,
    type: d.type,
    profile: d.profile,
    seed: d.seed,
    zone: d.zone,
    intervalSec: d.config?.telemetryIntervalSec ?? 5,
  }));
}

async function bootstrap(retry = true): Promise<void> {
  try {
    const fleet = await fetchFleet();
    for (const spec of fleet) {
      if (devices.has(spec.deviceId)) continue;
      // Sequence base is time-derived so a service restart never collides with
      // already-ingested sequences (dedup is (deviceId, metric, sequence)).
      // Measurement VALUES stay deterministic via the seeded PRNG.
      const seqBase = Math.floor(Date.now() / 1000) % 10_000_000;
      const dev: SimDevice = {
        spec,
        client: null,
        connected: false,
        paused: false,
        killed: false,
        seq: seqBase,
        statusSeq: 0,
        sampleCount: 0,
        published: 0,
        lastEnvelope: null,
        lastPublishAt: null,
        rnd: mulberry32(spec.seed),
        timer: null,
        statusTimer: null,
        drift: 0,
        offlineUntil: 0,
        nextOfflineAt: Date.now() + 30000 + (spec.seed % 30) * 1000,
        wentSilent: false,
        health: 100,
        energyCounter: 1000 + (spec.seed % 500),
        rebootingUntil: 0,
      };
      devices.set(spec.deviceId, dev);
      connectDevice(dev);
      restartTimer(dev);
      // status heartbeat
      dev.statusTimer = __iv(() => {
        if (dev.connected && !dev.killed && !dev.wentSilent) publishStatus(dev, "ONLINE");
      }, 15000);
    }
    console.log(`[sim] fleet bootstrapped: ${devices.size} devices`);
  } catch (e: any) {
    console.warn(`[sim] backend not reachable (${e.message}) — retrying in 5s`);
    if (retry) setTimeout(() => bootstrap(), 5000);
  }
}

__g.__dhSimCleanup = () => {
  for (const t of __simTimers) clearInterval(t);
  for (const d of devices.values()) {
    try { d.client?.end(true); } catch { /* ignore */ }
  }
};

// ---------------------------------------------------------------------------
// Control API
// ---------------------------------------------------------------------------
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok", service: "devicehub-simulator", devices: devices.size, port: PORT });
    }
    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json({
        fleet: [...devices.values()].map((d) => ({
          deviceId: d.spec.deviceId,
          profile: d.spec.profile,
          type: d.spec.type,
          connected: d.connected,
          paused: d.paused,
          killed: d.killed,
          wentSilent: d.wentSilent,
          published: d.published,
          sampleCount: d.sampleCount,
          intervalSec: d.spec.intervalSec,
          health: Math.round(d.health),
          lastPublishAt: d.lastPublishAt,
        })),
      });
    }
    if (req.method === "POST" && url.pathname === "/control") {
      const body = await req.json().catch(() => ({}));
      const dev = devices.get(body.deviceId);
      if (!dev) return Response.json({ error: "unknown deviceId" }, { status: 404 });
      switch (body.action) {
        case "pause":
          dev.paused = true;
          publishStatus(dev, "MAINTENANCE", { note: "paused by operator" });
          break;
        case "silence":
          // full radio silence: stops telemetry AND heartbeats (triggers gateway OFFLINE timeout)
          dev.paused = true;
          dev.wentSilent = true;
          break;
        case "resume":
          dev.paused = false;
          dev.wentSilent = false;
          publishStatus(dev, "ONLINE", { note: "resumed by operator" });
          break;
        case "duplicate-last":
          // re-publish the exact same envelope (same msgId) — duplicate delivery injection
          if (dev.lastEnvelope && dev.client?.connected) {
            dev.client.publish(`device/${dev.spec.deviceId}/telemetry`, JSON.stringify(dev.lastEnvelope), { qos: 1 });
          } else {
            return Response.json({ error: "no recent envelope" }, { status: 409 });
          }
          break;
        case "delayed":
          // publish a NEW sample whose source timestamp is 3 minutes in the past (delayed telemetry)
          publishTelemetry(dev, undefined, Date.now() - 3 * 60 * 1000);
          break;
        case "profile":
          if (typeof body.profile === "string" && ["STABLE", "GRADUAL_DRIFT", "THRESHOLD_VIOLATION", "INTERMITTENT", "SENSOR_FAULT", "STALE"].includes(body.profile)) {
            dev.spec.profile = body.profile;
            dev.rnd = mulberry32(dev.spec.seed + dev.sampleCount);
          } else {
            return Response.json({ error: "invalid profile" }, { status: 400 });
          }
          break;
        default:
          return Response.json({ error: "unknown action" }, { status: 400 });
      }
      return Response.json({ ok: true, deviceId: dev.spec.deviceId, action: body.action });
    }
    if (req.method === "POST" && url.pathname === "/fleet") {
      const body = await req.json().catch(() => ({}));
      switch (body.action) {
        case "pause":
          for (const d of devices.values()) d.paused = true;
          break;
        case "resume":
          for (const d of devices.values()) { d.paused = false; d.wentSilent = false; }
          break;
        case "restart":
          // full deterministic reset: new PRNG from original seed, values reproducible;
          // sequence base is re-derived so replayed values ingest as fresh samples
          {
            const seqBase = Math.floor(Date.now() / 1000) % 10_000_000;
            for (const d of devices.values()) {
              d.rnd = mulberry32(d.spec.seed);
              d.seq = seqBase; d.statusSeq = 0; d.sampleCount = 0; d.published = 0;
              d.drift = 0; d.energyCounter = 1000 + (d.spec.seed % 500);
              d.wentSilent = false; d.paused = false; d.health = 100;
              d.nextOfflineAt = Date.now() + 30000 + (d.spec.seed % 30) * 1000;
              d.offlineUntil = 0;
              publishStatus(d, "ONLINE", { note: "fleet restart (deterministic reset)" });
              publishTelemetry(d);
            }
          }
          break;
        default:
          return Response.json({ error: "unknown action" }, { status: 400 });
      }
      return Response.json({ ok: true, fleet: devices.size });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log(`[sim] DeviceHub simulator control API on :${PORT}`);
console.log(`[sim] MQTT broker: ${MQTT_URL}`);
bootstrap();
