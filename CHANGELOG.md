# Changelog

All notable changes to DeviceHub are documented here.
Format follows Keep a Changelog; versioning is semantic.

## [1.1.0] — 2026-10-18

### Security & Hardening
- Enforced strict token verification across internal service calls, preventing unauthenticated internal gateway/analytics operations.
- Enhanced AI diagnostic pipeline with schema validation and citation grounding against active telemetry and anomaly metrics.
- Removed permissive schema destruction flags from setup workflows; added explicit typecheck verification to development scripts.

### Documentation & Developer Experience
- Added comprehensive Persian and English overview guides covering architecture, protocol specification, and edge deployment practices.
- Refined diagnostic and event descriptions across edge gateway logs and dashboard interfaces for clearer operator handoffs.
- Streamlined local development setup steps and added clear guidelines on service boundaries.

## [1.0.0] — 2026-10-17

Initial integrated platform. Built and verified end-to-end with edge telemetry spooling, analytics pipelines, and realtime control dashboards.

[1.1.0]: https://github.com/ParsaFathii/DeviceHub/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ParsaFathii/DeviceHub/releases/tag/v1.0.0
