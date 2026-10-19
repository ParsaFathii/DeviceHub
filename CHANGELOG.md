# Changelog

All notable changes to DeviceHub are documented here.
Format follows Keep a Changelog; versioning is semantic.

## [1.1.0] — 2026-10-19

Deepening pass on the live platform: mockup-fidelity UI, a substantially expanded AI diagnostics experience, render-performance work, security hardening, engineering fixes, and re-recorded test media. Everything below was built and verified end-to-end on the running platform (17/17 E2E checks passed, zero browser console errors).

### Security & Hardening
- Enforced strict token verification across internal service calls, preventing unauthenticated internal gateway/analytics operations.
- Enhanced AI diagnostic pipeline with schema validation and citation grounding against active telemetry and anomaly metrics.
- Removed permissive schema destruction flags from setup workflows; added explicit typecheck verification to development scripts.

### Documentation & Developer Experience
- Added comprehensive Persian and English overview guides covering architecture, protocol specification, and edge deployment practices.
- Refined diagnostic and event descriptions across edge gateway logs and dashboard interfaces for clearer operator handoffs.
- Streamlined local development setup steps and added clear guidelines on service boundaries.

### UI
- Mockup-fidelity pass: per-zone brand-gradient gauge rings (blue→cyan, emerald→teal, purple→violet, …) on the Zone Health panel (270° arcs, thick rounded strokes, bold tabular percentages), and refined KPI typography (36 px bold tabular numbers).
- All screenshots and test GIFs re-captured through the reverse-proxy origin with dev indicators disabled — every recording shows the realtime socket live and no dev-tools overlay.

### AI diagnostics
- Proposal flow: the model may propose a single operator action as a fenced block; the backend parses and server-validates it (device exists and is not retired, action ∈ device capabilities, payload sane) before it ever reaches the client, where it renders as a reviewable **PROPOSED ACTION** card. Submission goes through the audited command lifecycle with source `AI_PROPOSAL`; VIEWERs cannot submit. Verified E2E: proposal → operator submit → command SUCCEEDED with a real device acknowledgement.
- Answers: clickable `[DH-XXX]` device citations (deep-link into device detail) and Markdown table rendering, on top of the existing provenance labels (`[measured fact]` / `[rule result]` / `[ML output]` / `[hypothesis]` / `[recommendation]`).
- Streaming UX: cancel mid-stream (partial answer kept and marked interrupted — including a coherent bubble when cancelled before the first character) and regenerate the last answer; latency and characters-per-second indicators per answer.
- Live KPIs: real provider health ping (tiny completion, 60 s cache) with latency; conversation count and average/last response latency aggregated from persisted history.
- Scope & history: selected device scope persisted per turn (`AiInteraction.deviceId`), 10-turn history, evidence v2 with per-series sparklines and series-trend chips (↑/↓/→) in the evidence footer.
- Cross-view entry points: "Ask AI about this device" (Devices list + Device Detail) and "Explain this finding with AI" (anomaly findings) deep-link into AI Diagnostics with scope pre-selected and a seeded question.

### Performance
- Isolated realtime subscriptions (live-ingest chip and activity bell own their store slices) + memoized views — eliminated the ~2 s full-view-tree re-render on every telemetry flush.
- Route pre-warming; all views verified loading in <1 s after warm-up (API responses 7–100 ms). Six services remain process-isolated on separate cores; SQLite with WAL and indexed hot paths.

### Fixes
- Edge gateway no longer probes a non-existent internal route from its admin `/status` handler (removed the dead call that produced recurring 404 noise in dev logs).
- Cancelling during evidence-gathering (before the first streamed character) now leaves a coherent interrupted assistant bubble instead of an unanswered question.
- Fixed 9 pre-existing TypeScript errors: rule-executions history route (invalid relation include — the route previously 500'd at runtime; now returns rows with public device ids), users route `_count` aggregation, and `ai-evidence.ts` gateway-id narrowing. `tsc --noEmit` is now clean for `src/`.
- Simulator fleet recovery after service restart (16-device bootstrap verified, telemetry resumed).

### Media
- Test media re-recorded: 6 GIFs (live overview, telemetry explorer, command lifecycle, offline buffering, AI diagnostics, anomaly detection) + 12 fresh screenshots including a new `ai-proposal.png` (proposed-action card), all VLM-verified.

## [1.0.0] — 2026-10-17

Initial integrated platform. Built and verified end-to-end with edge telemetry spooling, analytics pipelines, and realtime control dashboards.

[1.1.0]: https://github.com/ParsaFathii/DeviceHub/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ParsaFathii/DeviceHub/releases/tag/v1.0.0
