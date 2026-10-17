# DeviceHub — Architecture

Copyright © 2026 Parsa Fathi — Apache-2.0.

This document describes the system as **built and tested in this repository**. Where a component differs from the original design document (e.g. the TypeScript edge gateway standing in for the C++ gateway), that is stated explicitly.

Related: [README.md](README.md) (overview, quick start), [SECURITY.md](SECURITY.md) (auth model, threats), [docs/fa/ARCHITECTURE_FA.md](docs/fa/ARCHITECTURE_FA.md) (Persian).

---

## 1. Components and responsibilities

### Device simulator fleet (`mini-services/simulator`, port 3012)

16 deterministic devices (per-device seeds, mulberry32 PRNG) across 6 profiles:

| Profile | Behaviour |
|---|---|
| `STABLE` | nominal values with sensor noise |
| `GRADUAL_DRIFT` | slow trend away from baseline |
| `THRESHOLD_VIOLATION` | ramps above rule thresholds (drives real alerts) |
| `INTERMITTENT` | periodic connectivity drops, reconnects, resumes |
| `SENSOR_FAULT` | occasional out-of-spec spikes flagged SUSPECT/BAD quality |
| `STALE` | publishes a few samples, then goes silent (device OFFLINE) |

Every message carries `sim: true`. The control API supports `pause`, `resume`, `duplicate-last`, `delayed`, `replay-late-batch`, `profile` per device, and `pause/resume/restart` for the whole fleet (restart resets seeds → deterministic replay). The failure-injection tests use this API.

### MQTT broker (`mini-services/broker`, port 1883)

Real broker (aedes), TCP MQTT. Local development configuration: no TLS, anonymous clients allowed (production requirements in [SECURITY.md](SECURITY.md)). QoS 1 on all device topics; device and gateway status topics are retained. Broker restart is survivable: clients reconnect and the gateway's persistent session (`clean: false`) resumes queued QoS 1 deliveries.

### Edge gateway (`mini-services/gateway`, port 3011)

The heart of the data path. Responsibilities, in processing order:

1. **Protocol-v1 validation** — envelope structure, deviceId/topic match, `msgId`, `seq`, timestamp skew (rejects > 5 min future / > 24 h old), 1–16 metrics, known metric names, quality enum, payload size ≤ 64 KiB. Out-of-range values are accepted and flagged SUSPECT; only structurally invalid messages are rejected (counted, with an activity event).
2. **Deduplication** — in-memory `msgId` window (8000 entries, LRU-pruned by a quarter when full). Repeated MQTT deliveries are dropped silently and counted.
3. **Forward queueing** — in-memory queue (cap 10 000, overflow drops oldest and counts), flushed every 2 s in batches of 25 to the backend `POST /api/internal/telemetry`.
4. **Durable spooling** — when the backend is unreachable, messages move into a SQLite spool (`mini-services/gateway/data/edge.db`, WAL mode, 5000-record cap). The spool survives `kill -9`.
5. **Automatic drain** — on backend recovery or on boot, spooled records are posted in batches of 20 (50 ms pause between batches), **preserving source timestamps**, followed by a `DRAINED` gateway event.
6. **Session monitoring** — per-device ONLINE/OFFLINE derived from message activity; 45 s silence timeout; state changes pushed to the backend and realtime.
7. **Automation engine** — deterministic rule evaluation on every validated telemetry batch (details below).
8. **Command routing** — publishes commands to `device/{id}/command` (QoS 1), awaits device acks on `device/{id}/ack`, enforces a 30 s ack timeout, drives the command lifecycle via the backend's internal state API.
9. **Metrics & status** — publishes retained `gateway/edge-gw-01/status` (state + counters) and heartbeats the backend every 5 s.

Admin API (port 3011): `GET /health`, `GET /status`, `GET /buffer`, `POST /simulate-offline {sec}` (backend-outage injection), `POST /dispatch` (command routing), `POST /buffer/clear` (records LOST events).

### Next.js backend + web client (port 3000)

Next.js 16 + TypeScript + Tailwind + shadcn/ui + recharts. Single-page client at `/` with 11 views. Server-side responsibilities:

- Session auth with roles (ADMIN/OPERATOR/VIEWER) enforced on every route.
- Prisma + SQLite central store (15 models — see `prisma/schema.prisma`).
- Public REST API (session-authenticated) and internal API (`/api/internal/*`, `X-Internal-Token`).
- Telemetry ingest with the final dedup guard (unique `(deviceId, metric, sequence)`) and delayed-flag computation.
- Command lifecycle management with capability validation and audit.
- Alerts, rules (CRUD + versioning + executions), audit query, anomaly findings storage, analytics proxy, AI diagnostics.

### Realtime service (`mini-services/realtime`, port 3013)

socket.io server. Server-side producers (gateway, backend, analytics) emit via `POST /emit` with the internal token; browsers receive fan-out. Clients can join per-device rooms (`subscribe-device` with a `DH-*` id). In this sandbox, browser connections are routed through Caddy via the `XTransformPort=3013` query parameter, which is why the client connects with `io("/?XTransformPort=3013")`.

### Analytics service (`mini-services/analytics`, port 3014)

Python FastAPI. Endpoints: `GET /health`, `POST /aggregate` (UNIX-epoch-aligned bucketing, gap detection, out-of-order counting), `POST /detect` (IsolationForest + z-score baseline, per-series), `POST /evaluate` (labeled synthetic dataset), `GET /model-info`. Talks to the backend only through internal APIs; backend calls use httpx with 10 s timeout and 2 retries with backoff.

### C protocol library (`protocol-c/`)

Portable C11 codec for the DeviceHub binary frame format: 22-byte little-endian header + typed payloads, CRC-32 (IEEE 802.3) integrity, no external dependencies, no endianness/alignment assumptions. 26 tests / 519 assertions pass on gcc 14.2 (`-std=c11 -Wall -Wextra -Werror -O2`), including an ASan+UBSan-clean build. This is the reference implementation of the binary form of protocol v1; the live MQTT path in this deployment carries the JSON envelope form.

---

## 2. End-to-end data flow

```
 device (sim)         broker            gateway                  backend               clients
──────────────  ─────────────────  ──────────────────────  ─────────────────────  ─────────────
 publish          QoS 1 routing     validate (protocol v1)  POST /api/internal/     socket.io
 device/{id}/                       dedup (msgId)           telemetry (batch 25)    realtime
 telemetry      ──────────────►     enqueue ── flush 2s ──►  unique(device,metric,   events ──►
                                      │                      sequence) final guard    web views
                                      │                      sampleTs preserved,
                                      │                      receivedTs = now,
                                      │                      delayed flag computed
                                      │
                                      ├─ evaluate rules ─────► POST /api/internal/
                                      │   (edge, per batch)      rule-executions
                                      │                      └─ fire ──► POST /api/internal/alerts
                                      │
                                      ├─ session monitor ───► PATCH /api/internal/devices/{id}
                                      │   (45 s timeout)        ONLINE/OFFLINE
                                      │
                                      └─ backend down? ──► SQLite spool (WAL, 5000)
                                          on recovery/boot: drain in batches of 20,
                                          source timestamps preserved, DRAINED event
```

Status path: devices publish retained `device/{id}/status` heartbeats (state, health); the gateway uses them for session keep-alive and health propagation. Command path is the reverse direction: backend → gateway `/dispatch` → `device/{id}/command` → device executes → `device/{id}/ack` → gateway → backend state update → realtime + audit.

---

## 3. Offline buffering state machine

Each spooled record (`BufferRecord` in the central store mirrors the gateway's local spool for audit) moves through:

```
                    telemetry arrives, backend unreachable
                              │
                              ▼
                          PENDING ──────────────┐
                       (SQLite spool, ts kept)   │ spool full (5000):
                              │                  │ oldest record → LOST
              backend healthy │  or boot          │ (lossReason recorded)
                              ▼                   │
 drain: batches of 20,  ┌──────────┐              │
 50 ms apart           │ UPLOADED │              │
 preserve sampleTs ───►└──────────┘              │
                              ▲                  │
                  POST /api/internal/telemetry    │
                  fromBuffer: true                │
                              │                  │
                              │  manual clear ───┘
                              │  (POST /buffer/clear → LOST)
```

Two drain triggers:

1. **Drain-on-reconnect** — the gateway heartbeat (5 s) detects backend recovery (or an injected outage window ends) → `DRAINING` event → drain → `DRAINED` event.
2. **Drain-on-boot** — the MQTT `connect` handler drains whatever the spool holds at startup. Verified: `kill -9` with 57 spooled records → restart → all 57 drained.

Verified behaviour (failure suite): 30 s injected outage → 89 records spooled → automatic drain → `DRAINED` event; delayed/backfilled samples arrive with their original `sampleTs` and `delayed: true`; the backend emits a `telemetry` backfill event so connected clients see recovery history.

Malformed batches are never retried (counted as rejected); transport failures are spooled and retried.

---

## 4. Automation engine evaluation loop

Runs in the gateway on every validated telemetry batch, per matching rule/device pair:

```
               sample for rule.metric arrives
                          │
                 value vs threshold
                          │
          ┌─────────── met ────────────┐
          ▼                            ▼
     not met                        met
          │                            │
   reset heldSince ──► NOT_MET   heldSince set? ──no──► CONDITION_MET_WAITING
   (recorded on                     │ yes
    transition)                     │
                                   ▼
                       heldSec ≥ durationSec? ──no──► keep waiting
                                   │ yes
                                   ▼
                       within cooldownSec of
                       last trigger? ──yes──► SUPPRESSED_COOLDOWN
                                   │ no
                                   ▼
                                 FIRE
             create alert (severity, evidence: observed, threshold,
             heldSec, ruleVersion, sampleTs, quality)
             reset heldSince, set rule.lastTriggeredAt
             every outcome → RuleExecution record
```

Rules are refreshed from the backend every 15 s; device type mappings every 60 s. Because evaluation happens at the edge, alerting continues during backend outages — alerts are created once the connection returns (the alert call goes through the same forwarding path). The engine is deterministic: same inputs, same outcomes.

---

## 5. Command state machine

```
                    POST /api/commands (OPERATOR/ADMIN)
                              │ validate action against device
                              │ capabilities + payload validation
                              │ (denials audited, 422)
                              ▼
        ┌────────────── REQUESTED ──────────────┐
        │           (created, expiresAt +120 s) │
        ▼                                       │
    AUTHORIZED (role check passed)              │ dispatch to gateway /dispatch
        │                                       ▼
        │                                  QUEUED (gateway accepted)
        │                                       │ gateway publishes
        │                                       │ device/{id}/command (QoS 1)
        │                                       ▼
        │                                     SENT
        │                                       │
        │                     ┌── ack on device/{id}/ack ──┐
        │                     ▼                            ▼
        │              ACKNOWLEDGED code=OK         code≠OK or no ack
        │                     │                    within 30 s
        │                     ▼                            │
        │                SUCCEEDED                   FAILED
        │              (completedAt,                  (ackCode, result,
        │               result, audit)                 audit)
        │
        └── gateway unreachable / device offline ──► FAILED (dispatch error)
        └── not dispatched before expiry ──────────► EXPIRED
```

Every transition is written to the audit log (actor, action, resource, outcome, sanitized detail) and emitted on the realtime `command` event. AI-originated proposals never enter this machine directly — an operator must submit them through the normal audited flow (verified: 0 AI-sourced commands in the audit log).

---

## 6. Realtime event catalog

| Event | Payload | Producer |
|---|---|---|
| `telemetry` | live: `{devices: {deviceId: [samples]}}` (1.5 s aggregation); backfill: `{backfill: true, samples}` | gateway / backend |
| `device-state` | `{deviceId, state, lastSeenAt}` | gateway |
| `alert` | new alert record | backend |
| `alert-updated` | ack/resolve transitions | backend |
| `command` | command lifecycle transitions | backend / gateway |
| `gateway` | `{gatewayId, state, buffering, pending, drained?}` | gateway |
| `rule-execution` | rule outcome records | backend |
| `anomaly` | ML findings | backend / analytics |
| `activity` | human-readable activity feed items | backend / gateway |
| `buffer` | buffer state changes | backend |

Emission requires the internal token and the event name must be in the server-side allow-list. Browser payloads contain no credentials.

---

## 7. Failure modes

| Failure | System behaviour | Verified by |
|---|---|---|
| Duplicate MQTT delivery (QoS 1 retry / device replay) | gateway drops on `msgId`; backend unique `(deviceId, metric, sequence)` as final guard | failure suite R1 |
| Delayed telemetry (out-of-order arrival) | stored with `delayed: true`, `sampleTs` preserved, never discarded | failure suite R2 |
| Backend outage (e.g. 30 s) | gateway spools locally (89 records in test), drain-on-reconnect, `DRAINED` event | failure suite R3 |
| Gateway crash (`kill -9`) with populated spool | SQLite WAL spool survives; drain-on-boot (57 records in test) | failure suite R4 |
| Malformed telemetry | rejected at validation with counters; malformed batches never retried | failure suite R5 |
| Oversized batch | backend 413 (max 500 messages/batch) | failure suite / security suite |
| Device silence | 45 s timeout → OFFLINE (backend + realtime), resume → ONLINE | failure suite R6 |
| MQTT broker restart | simulator + gateway auto-reconnect; gateway persistent session resumes | failure suite R7 |
| Analytics service down | aggregation falls back to a TypeScript implementation in the backend; rest of platform unaffected | api suite (services checks) |
| AI provider unavailable | `/api/ai/diagnostics` degrades; platform fully operational | design + verified during build |
| Spool overflow (> 5000) | oldest record dropped, `LOST`/`OVERFLOW` recorded, counted in metrics | gateway implementation |
| Command ack timeout (30 s) | command → FAILED with error detail | api suite (command lifecycle) |

---

## 8. Documented adaptations (this build)

- SQLite (Prisma) instead of PostgreSQL — schema is Prisma-portable; only SQLite was built and tested here.
- The edge gateway is a TypeScript service; the C++ gateway from the architecture document maps to this component (same responsibilities).
- The C11 protocol library in `protocol-c/` is real and tested, but the live MQTT path carries the JSON envelope form of protocol v1.
- No mobile clients, no Spring Boot backend, no Docker, no physical hardware. All fleet data is simulator data, labelled end-to-end.
