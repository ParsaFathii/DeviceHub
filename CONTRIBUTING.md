# Contributing to DeviceHub

Copyright © 2026 Parsa Fathi — Apache-2.0.

Thanks for considering a contribution. DeviceHub is a small, deliberately explicit codebase — the rules below exist to keep it that way.

## Development environment

- **Runtime:** [Bun](https://bun.sh) for the web app and TypeScript mini-services; Python 3.12 (venv) for the analytics service; gcc (C11) for `protocol-c/`.
- Clone, then:

```bash
bun install
echo 'DATABASE_URL=file:./db/custom.db' > .env
bunx prisma db push
bun prisma/seed.ts
```

- Start services in order: broker (`mini-services/broker`) → simulator (`mini-services/simulator`) → gateway (`mini-services/gateway`) → web (`bun run dev` at root) → realtime (`mini-services/realtime`) → analytics (`mini-services/analytics`). Each mini-service: `bun install && bun run dev`. Analytics: `python3 -m pip install -r requirements.txt && bun run dev`.
- Demo accounts: `admin/admin123`, `operator/operator123`, `viewer/viewer123`.

Full setup: [README.md](README.md) · Persian: [docs/fa/DEVELOPMENT_FA.md](docs/fa/DEVELOPMENT_FA.md).

## Code style

- **TypeScript (web + services):** strict-ish TS, no implicit `any` where avoidable, functional components with hooks for the UI, no default exports for components where the convention is already named exports. Run `bun run lint` — it must pass.
- **Python (analytics):** type hints on public functions, no network in unit tests (backend interactions are mocked via httpx `MockTransport`).
- **C (protocol-c):** `-std=c11 -Wall -Wextra -Werror -O2` clean. No external dependencies, no endianness/alignment/aliasing assumptions. Every new code path gets a test with both a passing and a failing case where applicable.
- **General:** file headers keep the short copyright line (`Copyright © 2026 Parsa Fathi — Apache-2.0`). Don't commit credentials or generated artifacts (`build/`, `build-asan/`, `.next/`, `data/*.db`).

## Test-before-merge policy

A pull request is not mergeable until:

1. `bun run lint` passes (web).
2. `cd protocol-c && make test` passes (and `make test-asan` for protocol changes — sanitizer-clean is required).
3. `cd mini-services/analytics && python3 -m pytest tests/ -v` passes (22/22 baseline).
4. If you touched the data path, APIs, auth, or the gateway: run the three live suites against a running platform and paste the result lines in the PR:
   - `bash tests/api.test.sh` (baseline 45/45)
   - `bash tests/security.test.sh` (baseline 37/37)
   - `bash tests/failure.test.sh` (~3 min; all groups green at baseline)
5. New features that change documented behaviour must update the relevant docs (README / ARCHITECTURE / SECURITY / `docs/fa/`), including honest numbers — never invent metrics. If you evaluate a model, report real precision/recall/F1 from an actual run.

CI (`.github/workflows/ci.yml`) runs items 1–3 plus shell syntax checks. The live suites cannot run in CI (they need the full platform with broker, simulator, gateway, realtime, analytics and web running) — that is documented in the workflow; the PR author runs them locally.

## Commit conventions

- Imperative, subject ≤ 72 chars, body when non-obvious: `fix(gateway): preserve source ts during spool drain`.
- Scope where useful: `web`, `api`, `gateway`, `simulator`, `broker`, `realtime`, `analytics`, `protocol-c`, `docs`, `tests`, `ci`.
- One logical change per commit; tests and the code they cover in the same commit.
- No `--no-verify`, no force-push to shared branches.

## Areas of contribution

- **`protocol-c/`** — the C11 wire-protocol library. Constrained scope, byte-level compatibility requirements, golden-frame tests. Cross-implementation checks (Python/TS parity) are appreciated.
- **`mini-services/gateway/`** — the edge data path: validation, dedup, spool/drain, automation, command routing. Changes here must re-run the failure suite; reliability semantics (preserve source timestamps, never discard delayed data, drain-on-boot) are contractual.
- **Analytics (`mini-services/analytics/`)** — features, calibration work, evaluation datasets. Every model claim needs an evaluation run with real numbers.
- **Web/API (`src/`)** — views, REST routes, auth. Role enforcement stays server-side; the AI route's evidence boundary must not be weakened.
- **Documentation** — especially the Persian set under `docs/fa/`; factual, natural language, no invented numbers.
- **Tests** — new failure scenarios for the live suites are among the most valuable contributions.

## Reporting issues

Use the issue templates (`.github/ISSUE_TEMPLATE/`). For anything security-relevant, prefer a private report to the maintainer over a public issue; include reproduction steps against a local instance. The demo accounts and dev token are public knowledge by design — a report assuming them is fine.
