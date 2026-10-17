# DeviceHub Analytics

Python analytics & ML microservice for **DeviceHub** (IoT platform).
FastAPI service on the fixed port **3014**; talks to the DeviceHub Next.js
backend (`http://localhost:3000`) through authenticated internal APIs.

Copyright © 2026 Parsa Fathi — Apache-2.0.

## Run

```bash
bun run dev                                       # dev mode (auto-reload)
# or
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 3014
```

`python3` resolves to the project venv (`/home/z/.venv/bin/python3`).

Install dependencies (already present in the venv): `python3 -m pip install -r requirements.txt`

Run tests (no real network — the backend is mocked):

```bash
python3 -m pytest tests/ -v
```

Environment variables (all optional):

| Variable             | Default                 | Purpose                                        |
| -------------------- | ----------------------- | ---------------------------------------------- |
| `DH_INTERNAL_TOKEN`  | `dev-internal-token`    | `X-Internal-Token` header for backend calls    |
| `DH_BACKEND_URL`     | `http://localhost:3000` | Base URL of the Next.js backend                |

The service port is **3014 by platform convention and cannot be overridden**.

## Endpoints

### `GET /health`

```json
{"status": "ok", "model": "isolation_forest", "modelVersion": "if-v1.0", "sklearn": "1.5.2"}
```

### `POST /aggregate` — time-bucket aggregation

```json
{"deviceId": "DH-ENV-001", "metric": "temperature",
 "from": "2026-06-01T00:00:00Z", "to": "2026-06-01T01:00:00Z", "intervalSec": 300}
```

Fetches up to 5000 samples from `GET /api/internal/telemetry` and returns:

```json
{
  "buckets": [{"start": "2026-06-01T00:00:00Z", "min": 21.2, "max": 22.9,
               "avg": 21.7, "count": 12, "missing": false}],
  "gaps": [{"start": "2026-06-01T00:15:00Z", "end": "2026-06-01T00:25:00Z"}],
  "totalSamples": 493,
  "outOfOrder": 2
}
```

- Buckets are aligned to UNIX-epoch multiples of `intervalSec` and span the
  **first → last sample** (inclusive).
- A bucket with 0 samples is `missing` (`min`/`max`/`avg` = `null`, `count` = 0).
- `gaps` merges consecutive missing buckets; `end` is the exclusive upper bound.
- `outOfOrder` counts samples whose timestamp is earlier than the max timestamp
  seen so far **in fetch order** (the backend returns latest-first).

### `POST /detect` — anomaly detection

```json
{"deviceId": "DH-ENV-001", "metric": "temperature", "windowMin": 60, "contamination": 0.02}
```

`deviceId`/`metric` are optional (omit them to scan everything). Fetches a
recent window (`hours = windowMin/60 + 1`), groups by `(deviceId, metric)`,
sorts each series by time, builds features, and runs **both** models:

```json
{"series": 2, "findings": [...], "baselineFindings": [...],
 "modelVersion": "if-v1.0", "persistedAnomalies": 5}
```

Each finding (both lists) follows the persistence contract:

```json
{"deviceId": "DH-ENV-001", "metric": "temperature",
 "windowStart": "2026-06-01T00:12:00Z", "windowEnd": "2026-06-01T00:12:00Z",
 "score": 0.93, "model": "isolation_forest", "modelVersion": "if-v1.0",
 "baselineScore": 1.0,
 "details": {"value": 30.6, "absDiff": 8.9, "rollingMean5": 22.4, "z": 6.2,
             "sequence": 734, "unit": "degC", "quality": "good"}}
```

All findings (IsolationForest + z-score baseline) are persisted best-effort via
`POST /api/internal/anomalies`; persistence failures never break detection.

### `POST /evaluate` — labeled synthetic evaluation

Fully self-contained (NO backend data): generates 8 labeled synthetic patterns
(stable baseline, gradual drift, sudden spikes, missing samples, noisy sensor,
disconnected device, repeated stuck values, out-of-range values), runs both
models, computes precision/recall/F1 and mean detection delay per pattern and
overall, and persists an `AnalyticsRun` best-effort (`analyticsRunId: null`
when the backend is unreachable — the response still succeeds).

### `GET /model-info`

Model metadata: algorithm, features, parameters, score definition and
limitations.

## Model

**Primary: IsolationForest** (`isolation_forest` / `if-v1.0`) — scikit-learn
`IsolationForest(n_estimators=100, contamination=0.02, random_state=42)`,
fitted **per (deviceId, metric) series** at inference time on the feature
matrix `[value, abs(diff), rolling_mean_5]` (rolling mean = trailing window of
5, partial windows averaged at the head). Only fitted when a series has
**>= 40 samples**; shorter series fall back to the z-score baseline.

- `score` = `-decision_function` (higher = more anomalous), min–max normalized
  to 0..1 **within the series**.
- `flags` = `predict() == -1` at the given contamination.

**Baseline: z-score** (`zscore_baseline` / `zscore-v1.0`) — deterministic
global z-score; anomaly when `|z| > 3` (population std);
`baselineScore = clip(|z| / 3, 0, 1)`.

### Evaluation results (real, from `POST /evaluate`, contamination 0.05)

| Pattern                | n   | labeled | IF precision | IF recall | IF F1  | Z precision | Z recall | Z F1  |
| ---------------------- | --- | ------- | ------------ | --------- | ------ | ----------- | -------- | ----- |
| stable_baseline        | 150 | 0       | 0.000        | 0.000     | 0.000  | 0.000       | 0.000    | 0.000 |
| gradual_drift          | 150 | 30      | 0.750        | 0.200     | 0.316  | 0.000       | 0.000    | 0.000 |
| sudden_spike           | 150 | 5       | 0.625        | 1.000     | 0.769  | 1.000       | 1.000    | 1.000 |
| missing_samples        | 129 | 0       | 0.000        | 0.000     | 0.000  | 0.000       | 0.000    | 0.000 |
| noisy_sensor           | 150 | 0       | 0.000        | 0.000     | 0.000  | 0.000       | 0.000    | 0.000 |
| disconnected_device    | 150 | 60      | 0.375        | 0.050     | 0.088  | 0.000       | 0.000    | 0.000 |
| repeated_stuck_values  | 150 | 45      | 0.375        | 0.067     | 0.113  | 0.000       | 0.000    | 0.000 |
| out_of_range           | 150 | 6       | 0.750        | 1.000     | 0.857  | 1.000       | 0.833    | 0.909 |
| **overall**            | 1179| 146     | **0.365**    | **0.158** | 0.220  | **0.909**   | **0.069**| 0.127 |

Mean detection delay (samples): IsolationForest **1.2** (10/11 anomaly events
detected), z-score baseline **0.0** (5/11 events detected).

Interpretation: IsolationForest trades precision for recall (it always flags
~contamination fraction, hence FPs on clean patterns) and reacts to spikes,
out-of-range values and — with delay — drift. The z-score baseline is precise
(only extreme values) but blind to drift and stuck values. Flatline/stuck runs
are detected mainly at transitions.

### Limitations

- The anomaly score is **NOT a calibrated probability** — it is a relative
  min–max ranking within one series and is not comparable across series or
  windows.
- IsolationForest needs >= 40 samples per series; shorter series use the
  z-score baseline only.
- `contamination` approximately fixes the flagged fraction, so clean series
  still produce some false positives.
- No seasonality/day–night cycle modeling; periodic IoT patterns can cause
  false positives.
- The z-score baseline assumes roughly Gaussian values; it lags on gradual
  drift and is blind to stuck (flatline) values.
- Missing data is not an anomaly signal — use `/aggregate` gaps instead.

## Backend contract (Next.js app, internal APIs)

- `GET /api/internal/telemetry?deviceId=&metric=&from=&to=&limit=5000` with
  `X-Internal-Token` → `{"samples": [{"deviceId","metric","value","unit",
  "sampleTs","quality","sequence"}]}` (latest first)
- `POST /api/internal/anomalies` (same header) body
  `{"findings": [...]}` → `{"accepted": n}`
- `POST /api/internal/analytics-runs` body `{"kind","model","status","detail"}`
  → `{"id"}`

The client retries each call up to 2 times with a short backoff and a 10s
timeout.

## Layout

```
app/
  main.py            FastAPI app (endpoints, port 3014)
  anomaly.py         IsolationForest + z-score baseline, finding builders
  aggregates.py      bucketing, gaps, out-of-order counting, ISO helpers
  evaluation.py      labeled synthetic evaluation (8 patterns, metrics)
  backend_client.py  httpx client (token header, timeouts, retries=2)
tests/test_analytics.py  22 pytest tests (backend mocked, no real network)
```

## License

Apache-2.0, Copyright © 2026 Parsa Fathi.
