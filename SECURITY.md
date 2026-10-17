# DeviceHub — Security Model

Copyright © 2026 Parsa Fathi — Apache-2.0.

This document describes the security posture **as built and tested in this repository**, including its limits. It is a self-assessment backed by an executable test suite (`tests/security.test.sh`, 37/37 passing) — **not** a third-party audit.

Related: [ARCHITECTURE.md](ARCHITECTURE.md), [docs/fa/SECURITY_FA.md](docs/fa/SECURITY_FA.md) (Persian).

---

## Authentication

- **Session cookies.** Login exchanges credentials for an opaque 256-bit random token stored in the `dh_session` cookie — `httpOnly`, `SameSite=Lax`, path `/`, 24 h TTL. Sessions are server-side rows; logout deletes them (verified: requests with the old cookie get 401 after logout).
- **Password hashing.** PBKDF2-SHA256, 60 000 iterations, 32-byte key, 16-byte random salt, stored as `pbkdf2$<salt>$<hash>`.
- **Roles enforced server-side.** Every API route resolves the session and role before doing work. The client UI hides unauthorized actions, but hiding is cosmetic — enforcement is on the server (verified with direct API calls as VIEWER: 403, and the denial is audited).
- **Expiry.** Expired sessions are rejected and deleted on use.

Demo accounts (seed): `admin/admin123` (ADMIN), `operator/operator123` (OPERATOR), `viewer/viewer123` (VIEWER). Change these before any exposed deployment.

## Roles

| Capability | ADMIN | OPERATOR | VIEWER |
|---|---|---|---|
| Read APIs / all views | ✔ | ✔ | ✔ |
| Send commands | ✔ | ✔ | ✘ 403 + audit |
| Rules CRUD / versioning | ✔ | ✔ | ✘ |
| Alert acknowledge/resolve | ✔ | ✔ | ✘ |
| Simulator & gateway controls | ✔ | ✘ | ✘ |
| User management | ✔ | ✘ | ✘ |

Role denials are audited (`ROLE_DENIAL`, outcome `DENIED`) — audit never blocks enforcement.

## Internal API boundary

Routes under `/api/internal/*` (telemetry ingest/export, device state, gateway status/events, alerts, rules, rule executions, command state, anomalies, analytics runs) accept **no session**. They require the `X-Internal-Token` header:

- shared by the edge gateway, simulator and analytics services;
- configured via `DH_INTERNAL_TOKEN`, default `dev-internal-token` **for local development only**;
- missing/wrong token → 401 (verified).

The realtime emit endpoint (`POST /emit` on port 3013) uses the same token and additionally allow-lists event names; unknown events → 400.

## Audit coverage

`AuditEvent` records actor (USER / GATEWAY / SYSTEM / DEVICE / AI), action, resource type/id, outcome (SUCCESS / FAILURE / DENIED) and sanitized detail. Coverage includes:

- logins and logouts;
- role denials and command-capability denials (with reason);
- command lifecycle transitions (requested → authorized → queued → sent → acked → completed);
- rule updates (versioned);
- alert acknowledgements and resolutions;
- gateway events (CONNECTED / BUFFERING / DRAINING / DRAINED / OVERFLOW);
- AI usage (diagnostics requests and any proposals).

Details are sanitized — the secret scan in the security suite checks that credentials never appear in source or logs.

## AI safety boundary

Enforced in the route code, not delegated to the model:

1. The model receives **only sanitized evidence** (fleet summaries, alert records, anomaly findings, rule metadata, telemetry statistics). No credentials, no secrets, no internal tokens.
2. It **cannot execute commands**. Asking it to act produces a refusal plus a proposal describing the command an authorized operator could submit through the audited flow. Verified: after explicitly asking the assistant to execute an action, the audit log contains **0 AI-sourced commands**.
3. Answers must label statements `[measured fact]` / `[rule result]` / `[ML output]` / `[hypothesis]` / `[recommendation]`, and anomaly scores are always introduced as non-calibrated model scores.
4. Input is bounded (question capped, evidence JSON capped), and the platform is fully operational when the AI provider is unavailable.

## Input validation

- Telemetry envelopes: full protocol-v1 validation at the gateway (version, identity, topic match, timestamp skew, metric whitelist, quality enum, size limits).
- Commands: action checked against **device capabilities**; payload validated per action (e.g. `SET_INTERVAL` requires `intervalSec` ∈ [2, 300]); denials audited.
- Batches: max 500 messages per ingest call → 413 otherwise; per-message MQTT size cap 64 KiB at the gateway; realtime emit body capped at 2 MB.
- Device identity regex `^DH-[A-Z0-9-]+$` enforced at ingest, command dispatch and realtime room subscription.

## Known limits (read before deploying)

This is a development build. The following are **documented limitations of this deployment**, with production requirements:

| Limit in this build | Production requirement |
|---|---|
| MQTT broker (aedes) on plain TCP :1883, anonymous clients, no TLS | TLS listener (8883) with server cert; client certificates per device/gateway; per-client credentials/ACLs |
| Shared dev internal token `dev-internal-token` | Unique per-service credentials, rotated; delivered by a secret manager |
| Demo passwords seeded in the repo | Real credential provisioning; enforce password policy |
| SQLite with local file access | PostgreSQL (or equivalent) with its own access control, backups, encryption at rest |
| No HTTPS termination in-app (Caddy dev proxy in the sandbox) | TLS at the edge, HSTS, secure cookie flags |
| socket.io CORS `origin: *` on the realtime service | Restrict to the web origin |
| No rate limiting beyond payload-size caps | Rate limits / throttling on public endpoints |
| Session tokens stored in DB rows (no revocation UI beyond logout) | Session management policy (idle timeout, forced revocation) |

None of these were hidden during testing — the security suite tests what the system *does* enforce (authn/authz, token boundary, audit, validation, AI safety), and passes 37/37 against the running platform.

## How the 37 security tests map

`bash tests/security.test.sh` (against the live platform):

| Group | Checks | Mechanism verified |
|---|---|---|
| S1 unauthenticated access | API access without a session | 401 on protected routes |
| S2 role enforcement | VIEWER/OPERATOR/ADMIN boundaries exercised per capability | 403 where required, allowed where not |
| S3 internal token | internal APIs without/with wrong token | 401; correct token required |
| S4 invalid identities | forged/malformed device identities at ingest | rejected, counted |
| S5 command authorization | unauthorized command attempts | 403/422, denials audited |
| S6 payload limits | oversized bodies/batches | 413 / rejection |
| S7 secret scan | repository source & logs | no credentials committed |
| S8 AI safety | ask the assistant to execute commands | refusal + proposal; 0 AI-sourced commands in audit |
| S9 logout invalidation | reuse of cookie after logout | 401 |

Running it requires the full platform up (see README quick start). CI runs a syntax check only — the suite needs the live system.
