"""Anomaly detection models for DeviceHub telemetry.

Two detectors run side by side:

- **IsolationForest** (primary model, ``isolation_forest`` / ``if-v1.0``):
  scikit-learn ``IsolationForest(n_estimators=100, contamination=..., random_state=42)``
  fitted *per (deviceId, metric) series* on the feature matrix
  ``[value, abs(diff), rolling_mean_5]``. The anomaly score is
  ``-decision_function`` (higher = more anomalous) min-max normalized to 0..1
  within the series. Only fitted when the series has >= ``MIN_SAMPLES`` samples.
- **z-score baseline** (deterministic sanity baseline,
  ``zscore_baseline`` / ``zscore-v1.0``): flags samples with ``|z| > 3``
  (population std); ``baselineScore = clip(|z| / 3, 0, 1)``.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from sklearn.ensemble import IsolationForest

from .aggregates import parse_ts, to_iso

MODEL_NAME = "isolation_forest"
MODEL_VERSION = "if-v1.0"

BASELINE_MODEL_NAME = "zscore_baseline"
BASELINE_MODEL_VERSION = "zscore-v1.0"

MIN_SAMPLES = 40
ZSCORE_THRESHOLD = 3.0
FEATURES = ["value", "abs(diff)", "rolling_mean_5"]


def rolling_mean(values, window: int = 5) -> np.ndarray:
    """Trailing rolling mean (window includes the current element).

    Partial windows are averaged over the available head elements.
    """
    x = np.asarray(values, dtype=float)
    n = x.shape[0]
    if n == 0:
        return x
    csum = np.concatenate(([0.0], np.cumsum(x)))
    idx = np.arange(n)
    lo = np.maximum(0, idx - window + 1)
    return (csum[idx + 1] - csum[lo]) / (idx - lo + 1)


def build_features(values) -> np.ndarray:
    """Feature matrix ``[value, abs(diff), rolling_mean_5]`` with shape (n, 3).

    ``diff[0]`` is 0 (no previous sample to diff against).
    """
    x = np.asarray(values, dtype=float)
    n = x.shape[0]
    if n == 0:
        return np.zeros((0, 3), dtype=float)
    diff = np.zeros(n, dtype=float)
    if n > 1:
        diff[1:] = np.abs(np.diff(x))
    roll = rolling_mean(x, window=5)
    return np.column_stack([x, diff, roll])


def isolation_forest_detect(values, contamination: float = 0.02) -> Optional[Dict[str, Any]]:
    """Fit an IsolationForest on the series and score every sample.

    Returns ``{"scores": ndarray, "flags": ndarray}`` where

    - ``scores`` = min-max normalized ``-decision_function`` within the series
      (0..1, higher = more anomalous), and
    - ``flags`` = ``predict() == -1`` (the model's inlier/outlier decision at
      the given contamination level).

    Returns ``None`` when the series has fewer than ``MIN_SAMPLES`` samples —
    callers must fall back to the z-score baseline in that case.
    """
    x = np.asarray(values, dtype=float)
    if x.shape[0] < MIN_SAMPLES:
        return None
    features = build_features(x)
    forest = IsolationForest(
        n_estimators=100,
        contamination=float(contamination),
        random_state=42,
    )
    forest.fit(features)
    raw = -forest.decision_function(features)  # higher = more anomalous
    lo = float(raw.min())
    hi = float(raw.max())
    if hi - lo < 1e-12:
        scores = np.zeros_like(raw)
    else:
        scores = (raw - lo) / (hi - lo)
    flags = forest.predict(features) == -1
    return {"scores": scores, "flags": flags}


def zscore_baseline(values) -> Dict[str, Any]:
    """Deterministic z-score baseline over the whole series.

    A sample is flagged when ``|z| > 3`` using the *population* standard
    deviation. ``scores`` = ``clip(|z| / 3, 0, 1)``. Degenerate series
    (``std`` ~ 0 or fewer than 2 samples) yield no flags and ``ok = False``.
    """
    x = np.asarray(values, dtype=float)
    n = x.shape[0]
    if n == 0:
        return {"z": np.zeros(0), "flags": np.zeros(0, dtype=bool),
                "scores": np.zeros(0), "mean": None, "std": None, "ok": False}
    mean = float(np.mean(x))
    std = float(np.std(x))
    if n < 2 or std < 1e-12:
        return {"z": np.zeros(n), "flags": np.zeros(n, dtype=bool),
                "scores": np.zeros(n), "mean": mean, "std": std, "ok": False}
    z = (x - mean) / std
    absz = np.abs(z)
    return {
        "z": z,
        "flags": absz > ZSCORE_THRESHOLD,
        "scores": np.clip(absz / ZSCORE_THRESHOLD, 0.0, 1.0),
        "mean": mean,
        "std": std,
        "ok": True,
    }


def _finding(sample: Dict[str, Any], ts_iso: str, score: float, model: str,
             model_version: str, baseline_score: Optional[float],
             details: Dict[str, Any]) -> Dict[str, Any]:
    """Assemble one finding in the backend persistence format."""
    return {
        "deviceId": sample.get("deviceId"),
        "metric": sample.get("metric"),
        "windowStart": ts_iso,
        "windowEnd": ts_iso,
        "score": score,
        "model": model,
        "modelVersion": model_version,
        "baselineScore": baseline_score,
        "details": details,
    }


def detect_series(samples: List[Dict[str, Any]],
                  contamination: float = 0.02) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Run both detectors over one (deviceId, metric) series.

    Samples may arrive in any order — the backend returns *latest first* — so
    they are sorted by ``(sampleTs, sequence)`` before feature computation.
    Findings are per-sample (``windowStart == windowEnd``).

    Returns ``(isolation_forest_findings, zscore_baseline_findings)``, both
    ready to be POSTed to ``/api/internal/anomalies``.
    """
    usable = [
        s for s in samples
        if isinstance(s, dict) and s.get("sampleTs") is not None and s.get("value") is not None
    ]
    if not usable:
        return [], []
    ordered = sorted(usable, key=lambda s: (parse_ts(s.get("sampleTs")), int(s.get("sequence") or 0)))
    values = [float(s["value"]) for s in ordered]
    timestamps = [to_iso(parse_ts(s["sampleTs"])) for s in ordered]

    if_result = isolation_forest_detect(values, contamination=contamination)
    z_result = zscore_baseline(values)
    features = build_features(values) if if_result is not None else None

    if_findings: List[Dict[str, Any]] = []
    if if_result is not None:
        for i in np.nonzero(if_result["flags"])[0]:
            i = int(i)
            baseline_score = (
                round(float(z_result["scores"][i]), 6) if z_result["ok"] else None
            )
            if_findings.append(_finding(
                ordered[i], timestamps[i],
                round(float(if_result["scores"][i]), 6),
                MODEL_NAME, MODEL_VERSION, baseline_score,
                details={
                    "value": values[i],
                    "absDiff": round(float(features[i, 1]), 6),
                    "rollingMean5": round(float(features[i, 2]), 6),
                    "z": round(float(z_result["z"][i]), 4) if z_result["ok"] else None,
                    "sequence": ordered[i].get("sequence"),
                    "unit": ordered[i].get("unit"),
                    "quality": ordered[i].get("quality"),
                },
            ))

    baseline_findings: List[Dict[str, Any]] = []
    if z_result["ok"]:
        for i in np.nonzero(z_result["flags"])[0]:
            i = int(i)
            baseline_findings.append(_finding(
                ordered[i], timestamps[i],
                round(float(z_result["scores"][i]), 6),
                BASELINE_MODEL_NAME, BASELINE_MODEL_VERSION,
                round(float(z_result["scores"][i]), 6),
                details={
                    "value": values[i],
                    "z": round(float(z_result["z"][i]), 4),
                    "seriesMean": round(float(z_result["mean"]), 4),
                    "seriesStd": round(float(z_result["std"]), 4),
                    "sequence": ordered[i].get("sequence"),
                    "unit": ordered[i].get("unit"),
                },
            ))

    return if_findings, baseline_findings
