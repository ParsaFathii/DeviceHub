<!-- DeviceHub pull request template — Copyright © 2026 Parsa Fathi — Apache-2.0 -->

## What

<!-- One paragraph: what this PR changes and why. Reference the issue if one exists ("Closes #N"). -->

## Type

- [ ] Fix (bug)
- [ ] Feature
- [ ] Reliability / data-path semantics
- [ ] Analytics / ML (includes evaluation numbers)
- [ ] Protocol (`protocol-c/`)
- [ ] Documentation
- [ ] CI / tooling
- [ ] Dependencies

## How

<!-- Key design decisions, in the order a reviewer should read them. Mention invariants you preserved (e.g. source-timestamp preservation, server-side role enforcement, AI evidence boundary). -->

## Verification (test-before-merge policy)

Run what applies to your change and paste the result lines:

- [ ] `bun run lint` — clean
- [ ] `cd protocol-c && make test` — 26/26 tests, 519/519 assertions (and `make test-asan` if protocol bytes changed)
- [ ] `cd mini-services/analytics && python3 -m pytest tests/ -v` — baseline 22/22

Live suites (need the full platform running; required for data-path, API, auth, or gateway changes):

- [ ] `bash tests/api.test.sh` — baseline **45/45**
- [ ] `bash tests/security.test.sh` — baseline **37/37**
- [ ] `bash tests/failure.test.sh` (~3 min) — all scenario groups green

<!-- If a baseline number changed, explain why the new number is correct (e.g. new checks added). Never delete checks to make a suite pass. -->

## ML evaluation (only for analytics changes)

<!-- Real numbers from an actual run (precision/recall/F1, dataset size). No invented metrics — reviewers may re-run /evaluate. -->

## Documentation

- [ ] README / ARCHITECTURE / SECURITY updated where behaviour changed
- [ ] `docs/fa/` updated (Persian docs stay in sync)
- [ ] CHANGELOG entry added for user-visible changes

## Safety checklist

- [ ] No credentials or secrets introduced (source, logs, docs)
- [ ] Role enforcement remains server-side
- [ ] AI route changes do not widen the evidence boundary or add execution capability
- [ ] Telemetry semantics preserved: delayed data flagged not discarded, source timestamps never rewritten
