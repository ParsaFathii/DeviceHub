"""DeviceHub Analytics — Python analytics & ML microservice.

FastAPI service on the fixed port 3014. Communicates with the DeviceHub
Next.js backend (http://localhost:3000) through authenticated internal APIs
(``X-Internal-Token``).

Copyright © 2026 Parsa Fathi — Apache-2.0.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import sklearn
import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .aggregates import aggregate_samples, parse_ts
from .anomaly import (
    BASELINE_MODEL_NAME,
    BASELINE_MODEL_VERSION,
    FEATURES,
    MIN_SAMPLES,
    MODEL_NAME,
    MODEL_VERSION,
    detect_series,
)
from .backend_client import BackendClient, BackendError
from .evaluation import run_evaluation

logger = logging.getLogger("devicehub.analytics")

PORT = 3014  # fixed by platform convention — no env override

app = FastAPI(
    title="DeviceHub Analytics",
    description="Telemetry aggregation and anomaly detection for DeviceHub",
    version=MODEL_VERSION,
)

_default_backend: Optional[BackendClient] = None


def get_backend_client() -> BackendClient:
    """FastAPI dependency returning the shared backend client (env-configured)."""
    global _default_backend
    if _default_backend is None:
        _default_backend = BackendClient()
    return _default_backend


# ---------------------------------------------------------------- request models
class AggregateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    deviceId: str = Field(..., examples=["DH-ENV-001"])
    metric: str = Field(..., examples=["temperature"])
    from_: str = Field(..., alias="from", description="ISO-8601 UTC start (inclusive)")
    to: str = Field(..., description="ISO-8601 UTC end (inclusive)")
    intervalSec: int = Field(default=300, ge=1, le=86400, description="Bucket size in seconds")


class DetectRequest(BaseModel):
    deviceId: Optional[str] = Field(default=None, description="Optional device filter")
    metric: Optional[str] = Field(default=None, description="Optional metric filter")
    windowMin: int = Field(default=60, ge=1, le=1440, description="Detection window in minutes")
    contamination: float = Field(default=0.02, gt=0.0, le=0.5,
                                 description="IsolationForest contamination")


# --------------------------------------------------------------------- endpoints
@app.get("/health")
def health() -> Dict[str, str]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "modelVersion": MODEL_VERSION,
        "sklearn": sklearn.__version__,
    }


@app.post("/aggregate")
def aggregate(req: AggregateRequest,
              backend: BackendClient = Depends(get_backend_client)) -> Dict[str, Any]:
    """Fetch telemetry for a window and return fixed-interval buckets, gaps and stats."""
    try:
        start = parse_ts(req.from_)
        end = parse_ts(req.to)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid ISO timestamp: {exc}") from exc
    if end < start:
        raise HTTPException(status_code=400, detail="'to' must not be earlier than 'from'")
    try:
        samples = backend.fetch_telemetry(
            device_id=req.deviceId, metric=req.metric,
            from_dt=start, to_dt=end, limit=5000,
        )
    except BackendError as exc:
        raise HTTPException(status_code=503, detail=f"DeviceHub backend unavailable: {exc}") from exc
    try:
        result = aggregate_samples(samples, req.intervalSec)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "deviceId": req.deviceId,
        "metric": req.metric,
        "intervalSec": req.intervalSec,
        **result,
    }


@app.post("/detect")
def detect(req: DetectRequest,
           backend: BackendClient = Depends(get_backend_client)) -> Dict[str, Any]:
    """Detect anomalies on recent telemetry using IsolationForest + z-score baseline."""
    hours = req.windowMin / 60.0 + 1.0  # convenience window for the backend fetch
    to_dt = datetime.now(timezone.utc)
    from_dt = to_dt - timedelta(hours=hours)
    try:
        samples = backend.fetch_telemetry(
            device_id=req.deviceId, metric=req.metric,
            from_dt=from_dt, to_dt=to_dt, limit=5000, hours=hours,
        )
    except BackendError as exc:
        raise HTTPException(status_code=503, detail=f"DeviceHub backend unavailable: {exc}") from exc

    groups: Dict[tuple, List[Dict[str, Any]]] = {}
    for sample in samples:
        groups.setdefault((sample.get("deviceId"), sample.get("metric")), []).append(sample)

    findings: List[Dict[str, Any]] = []
    baseline_findings: List[Dict[str, Any]] = []
    for key in sorted(groups, key=lambda k: (str(k[0]), str(k[1]))):
        series_if, series_baseline = detect_series(groups[key], contamination=req.contamination)
        findings.extend(series_if)
        baseline_findings.extend(series_baseline)

    persisted = 0
    if findings or baseline_findings:
        try:  # best-effort persistence
            persisted = backend.push_anomalies(findings + baseline_findings)
        except Exception:  # noqa: BLE001 — deliberate: persistence must not break detection
            persisted = 0

    return {
        "series": len(groups),
        "findings": findings,
        "baselineFindings": baseline_findings,
        "modelVersion": MODEL_VERSION,
        "persistedAnomalies": persisted,
    }


@app.post("/evaluate")
def evaluate(backend: BackendClient = Depends(get_backend_client)) -> Dict[str, Any]:
    """Run the labeled synthetic evaluation (no backend data needed).

    Backend persistence of the resulting AnalyticsRun is best-effort: a
    connection failure yields ``analyticsRunId: null`` and never breaks the
    response.
    """
    return run_evaluation(backend=backend)


@app.get("/model-info")
def model_info() -> Dict[str, Any]:
    """Model metadata: algorithm, features, parameters and limitations."""
    return {
        "model": MODEL_NAME,
        "modelVersion": MODEL_VERSION,
        "algorithm": (
            "Isolation Forest (sklearn IsolationForest) fitted per (deviceId, metric) "
            "series, plus a deterministic z-score baseline"
        ),
        "library": f"scikit-learn {sklearn.__version__}",
        "features": FEATURES,
        "training": (
            "unsupervised; the forest is fitted on the fetched window at inference "
            "time (no stored model state between calls)"
        ),
        "parameters": {
            "n_estimators": 100,
            "contamination": "request-configurable, default 0.02 (evaluation uses 0.05)",
            "random_state": 42,
            "minSamplesPerSeries": MIN_SAMPLES,
        },
        "scoreDefinition": (
            "score = min-max normalized -decision_function within each series; "
            "higher = more anomalous"
        ),
        "baseline": {
            "model": BASELINE_MODEL_NAME,
            "modelVersion": BASELINE_MODEL_VERSION,
            "rule": "anomaly when |z| > 3 (population std)",
            "baselineScore": "clip(|z| / 3, 0, 1)",
        },
        "limitations": [
            "The anomaly score is NOT a calibrated probability: it is a relative "
            "min-max ranking within one series and is not comparable across series "
            "or time windows.",
            "IsolationForest is only fitted when a series has >= 40 samples; shorter "
            "series rely on the z-score baseline only.",
            "The contamination parameter approximately fixes the flagged fraction, "
            "so clean series still yield some false positives.",
            "No seasonality or day/night cycle modeling; periodic IoT patterns can "
            "produce false positives.",
            "The z-score baseline assumes roughly Gaussian values; it lags on gradual "
            "drift and is blind to stuck (flatline) values.",
            "Missing data is not an anomaly signal here: use POST /aggregate gaps for "
            "data-quality monitoring.",
        ],
    }


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT)
