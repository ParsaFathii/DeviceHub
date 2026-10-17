# Changelog

All notable changes to DeviceHub are documented here.
Format follows Keep a Changelog; versioning is semantic.

## [1.0.0] — 2026-10-17

Initial integrated platform. Everything below was built and tested together in one environment; there is no earlier released history to report.

### Platform
- Web application: Next.js 16 + TypeScript + Tailwind + shadcn/ui + recharts; single-page client at `/` with 11 views (Fleet Overview, Devices, Device Detail, Gateways, Telemetry Explorer, Automation Rules, Alerts, Anomaly Analysis, Commands & Audit, AI Diagnostics, Settings); dark industrial theme; realtime updates via socket.io.
- Authentication: session cookies with server-side role enforcement for ADMIN / OPERATOR / VIEWER; PBKDF2-SHA256 password hashing; logout invalidation.
- Data store: Prisma + SQLite (documented adaptation from PostgreSQL for this build environment), 15 models covering users/sessions, gateways, devices, telemetry, commands, alerts, automation rules and executions, audit events, anomaly findings, analytics runs.

### Edge data path
- Device simulator: 16 seeded deterministic devices across 6 profiles (STABLE, GRADUAL_DRIFT, THRESHOLD_VIOLATION, INTERMITTENT, SENSOR_FAULT, STALE) with a control API for failure injection (pause/resume, duplicate, delayed, replay).
- MQTT: real broker (aedes, port 1883), topic hierarchy `device/{id}/telemetry|status|command|ack` and `gateway/{id}/status`, QoS 1, retained status topics, gateway persistent session.
- Edge gateway (TypeScript service, port 3011): protocol-v1 validation, msgId dedup, durable SQLite spool (5000-record cap, WAL, survives `kill -9`), automatic drain preserving source timestamps, 45 s device OFFLINE timeout monitor, deterministic automation engine (threshold + duration hold + cooldown) executed at the edge, command routing with device acknowledgements.
- Reliability verified by failure injection: duplicate delivery deduped; delayed telemetry preserved and flagged; 30 s backend outage → 89 records spooled → automatic drain → DRAINED event; gateway `kill -9` with 57 spooled records → restart → drain on boot; malformed input rejected; oversized batch → 413; device silence → OFFLINE timeout → resume → ONLINE; MQTT broker kill → reconnect.

### Protocol
- DeviceHub protocol v1 JSON envelope on the live path: `{v, deviceId, msgId, seq, ts, metrics[{metric, value, unit, quality}], sim}`.
- C11 binary frame codec in `protocol-c/`: 22-byte little-endian header, CRC-32 (IEEE 802.3), typed telemetry (11-byte) / status (12-byte, incl. 2 reserved) / ACK / ERROR payloads; 26 tests / 519 assertions passing on gcc 14.2, ASan+UBSan-clean.

### Analytics / ML
- Python FastAPI service (port 3014): time-bucket aggregation with gap detection, IsolationForest anomaly detection (`if-v1.0`, features `[value, |Δ|, rolling-mean₅]`, per-series ≥ 40 samples) plus a deterministic z-score baseline (|z| > 3).
- Evaluation on a labeled synthetic dataset (1179 samples, 146 anomalies, 8 patterns) — real measured results: IsolationForest precision 0.365 / recall 0.158 / F1 0.220 (spike recall 1.000, mean detection delay ≈ 1.2 samples); z-score baseline precision 0.909 / recall 0.069 / F1 0.127 (perfect on spikes, blind to gradual drift). 22/22 pytest passing.

### AI layer
- `/api/ai/diagnostics` using the z-ai-chat provider: evidence-grounded (fleet summaries, alert records, anomaly findings, rule metadata — sanitized, no credentials), answers labelled `[measured fact]` / `[rule result]` / `[ML output]` / `[hypothesis]` / `[recommendation]`, advisory-only. Verified: the assistant cannot execute commands (refuses and proposes operator confirmation; 0 AI-sourced commands in the audit log). Platform fully operational when the AI provider is unavailable.

### Commands
- Lifecycle REQUESTED → AUTHORIZED → QUEUED → SENT → (ACKNOWLEDGED) → SUCCEEDED / FAILED / EXPIRED with real device acknowledgements over MQTT, capability validation, and audit on every state change.

### Testing
- `tests/api.test.sh` — 45/45 checks passed (auth, fleet, telemetry, command lifecycle with real acks, alerts, rules versioning, audit, services, ML eval, AI grounding).
- `tests/security.test.sh` — 37/37 checks passed (authn/authz 401/403, internal token, forged cookies, invalid identities, audited denials, payload limits, secret scan, AI safety, logout invalidation).
- `tests/failure.test.sh` — reliability suite, all scenario groups passed (dedup, delayed data, backend outage + drain, gateway crash + drain-on-boot, malformed input, OFFLINE timeout, broker restart).
- CI workflow with protocol-c tests, analytics pytest, web lint, and shell syntax checks (live suites require the running platform and are documented as such).

### Known limitations (documented, by design of this build environment)
- SQLite instead of PostgreSQL; TypeScript edge gateway (the C++ gateway of the architecture doc maps to this component — same responsibilities); no Flutter/Kotlin clients; no Spring Boot backend; no Docker execution; no physical-hardware testing; dev MQTT configuration without TLS. The C protocol library is real and tested. All fleet data is simulator data, clearly labelled.

[1.0.0]: https://github.com/ParsaFathii/DeviceHub/releases/tag/v1.0.0
