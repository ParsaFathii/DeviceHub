---
name: Bug report
about: Something in DeviceHub behaves incorrectly
title: "[bug] "
labels: bug
assignees: ''
---

## Summary

<!-- One or two sentences: what is wrong, and what you expected instead. -->

## Area

<!-- Mark the affected area(s): -->
- [ ] Web UI (`src/components/devicehub/`)
- [ ] Public API (`src/app/api/` — not `/internal`)
- [ ] Internal API (`src/app/api/internal/`)
- [ ] Edge gateway (`mini-services/gateway/`)
- [ ] Simulator (`mini-services/simulator/`)
- [ ] MQTT broker (`mini-services/broker/`)
- [ ] Realtime (`mini-services/realtime/`)
- [ ] Analytics / ML (`mini-services/analytics/`)
- [ ] C protocol library (`protocol-c/`)
- [ ] Documentation
- [ ] Other

## Environment

- Commit / branch:
- OS:
- Runtime versions: Bun __, Python __, gcc __
- Services running: broker / simulator / gateway / web / realtime / analytics — which ones?

## Steps to reproduce

1.
2.
3.

## Actual result

<!-- Console output, HTTP status + body, UI behaviour. For data-path issues include gateway metrics (`GET :3011/status`) if available. -->

## Expected result

## Evidence

<!-- Logs, screenshots, spool contents (`GET :3011/buffer`), audit entries. If you ran a test suite, paste the result line (e.g. `RESULT: 37 passed, 0 failed`). -->

## Security notice

<!-- If this involves authentication bypass, secret exposure, or injection: do NOT include live credentials, and consider reporting privately instead. The seeded demo accounts (admin/admin123 etc.) and the dev internal token are public by design. -->
