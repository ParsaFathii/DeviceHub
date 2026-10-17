"""Fully self-contained labeled synthetic evaluation — NO backend data.

Generates 8 synthetic telemetry patterns, each with ground-truth anomaly
labels, runs BOTH the IsolationForest detector and the deterministic z-score
baseline, and computes per-pattern and overall (micro-averaged) metrics:

- precision / recall / F1 (sample level)
- mean detection delay in samples (for each labeled anomaly *event*, the
  first true-positive detection inside the event or within
  ``DELAY_GRACE_SAMPLES`` after it, minus the event start index; undetected
  events are excluded from the mean but counted as ``missedEvents``)

Persistence of an ``AnalyticsRun`` via the backend is best-effort: connection
errors are swallowed and reported as ``analyticsRunId: null``.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .aggregates import to_iso
from .anomaly import isolation_forest_detect, zscore_baseline

EVALUATION_KIND = "labeled_synthetic_evaluation"
EVAL_CONTAMINATION = 0.05
DELAY_GRACE_SAMPLES = 3

_START = datetime(2026, 1, 1, tzinfo=timezone.utc)
_UNIT = "degC"


# --------------------------------------------------------------------- patterns
def _pack(name: str, description: str, values, labels,
          device_id: str, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Package generated values/labels into labeled sample dicts (1-min cadence)."""
    samples = []
    for i, (value, label) in enumerate(zip(values, labels)):
        samples.append({
            "deviceId": device_id,
            "metric": "temperature",
            "value": round(float(value), 4),
            "unit": _UNIT,
            "sampleTs": to_iso(_START + timedelta(minutes=i)),
            "quality": "good",
            "sequence": i,
            "label": int(bool(label)),
        })
    packed = {"name": name, "description": description, "samples": samples}
    if extra:
        packed.update(extra)
    return packed


def _generate_patterns() -> List[Dict[str, Any]]:
    rng = np.random.default_rng(42)
    patterns: List[Dict[str, Any]] = []

    # 1) stable baseline — healthy sensor, no anomalies
    n = 150
    patterns.append(_pack(
        "stable_baseline",
        "Healthy sensor: constant mean with small measurement noise. No ground-truth anomalies.",
        21.5 + rng.normal(0.0, 0.08, n), [0] * n, "DH-EVAL-001",
    ))

    # 2) gradual drift — slow decalibration
    n = 150
    values = np.empty(n)
    labels = [0] * n
    values[:70] = 21.5 + rng.normal(0.0, 0.08, 70)
    for i in range(70, n):
        values[i] = 21.5 + 0.055 * (i - 70) + rng.normal(0.0, 0.08)
    for i in range(120, n):
        labels[i] = 1
    patterns.append(_pack(
        "gradual_drift",
        "Sensor decalibration: value ramps +0.055 degC/sample from sample 70; "
        "the drift tail (samples 120+) is labeled anomalous.",
        values, labels, "DH-EVAL-002",
    ))

    # 3) sudden spikes
    n = 150
    values = 21.5 + rng.normal(0.0, 0.15, n)
    labels = [0] * n
    for i in (45, 46, 47, 100, 101):
        values[i] += 9.0
        labels[i] = 1
    patterns.append(_pack(
        "sudden_spike",
        "Interference spikes: +9.0 degC offsets at samples 45-47 and 100-101 (labeled anomalous).",
        values, labels, "DH-EVAL-003",
    ))

    # 4) missing samples — data-quality gap (present samples are all nominal)
    n = 180
    values = 21.5 + rng.normal(0.0, 0.15, n)
    keep = [i for i in range(n) if not (80 <= i <= 130)]
    patterns.append(_pack(
        "missing_samples",
        "Healthy values but samples 80-130 were never delivered (51-sample gap); "
        "all present samples are nominal. Detecting data gaps is /aggregate's job.",
        [values[i] for i in keep], [0] * len(keep), "DH-EVAL-004",
        extra={"gapSamples": 51},
    ))

    # 5) noisy sensor — false-positive stress test
    n = 150
    patterns.append(_pack(
        "noisy_sensor",
        "Degraded but in-spec sensor: 10x higher noise around the same mean; "
        "no ground-truth anomalies (false-positive stress test).",
        21.5 + rng.normal(0.0, 1.5, n), [0] * n, "DH-EVAL-005",
    ))

    # 6) disconnected device — long flatline
    n = 150
    values = np.empty(n)
    labels = [0] * n
    values[:50] = 21.5 + rng.normal(0.0, 0.10, 50)
    values[50:110] = 22.347  # frozen reading
    values[110:] = 21.5 + rng.normal(0.0, 0.10, 40)
    for i in range(50, 110):
        labels[i] = 1
    patterns.append(_pack(
        "disconnected_device",
        "Device froze mid-reading: exactly-constant 22.347 degC for 60 samples "
        "(labeled anomalous), then recovers.",
        values, labels, "DH-EVAL-006",
    ))

    # 7) repeated stuck values — shorter stickiness runs
    n = 150
    values = 21.5 + rng.normal(0.0, 0.20, n)
    labels = [0] * n
    for start, end, level in ((30, 44, 21.9), (75, 89, 21.3), (120, 134, 22.1)):
        for i in range(start, end + 1):
            values[i] = level
            labels[i] = 1
    patterns.append(_pack(
        "repeated_stuck_values",
        "ADC/sensor stickiness: three 15-sample runs of exactly-repeated values "
        "(labeled anomalous).",
        values, labels, "DH-EVAL-007",
    ))

    # 8) out-of-range values — electrical glitches
    n = 150
    values = 21.5 + rng.normal(0.0, 0.15, n)
    labels = [0] * n
    glitches = {20: 150.0, 55: -40.0, 56: 150.0, 90: -30.0, 125: 140.0, 126: -45.0}
    for i, glitch in glitches.items():
        values[i] = glitch
        labels[i] = 1
    patterns.append(_pack(
        "out_of_range",
        "Electrical glitches: physically impossible readings (150 / -40 degC ...) "
        "at 6 samples (labeled anomalous).",
        values, labels, "DH-EVAL-008",
    ))

    return patterns


# ---------------------------------------------------------------------- metrics
def _classification_metrics(labels: Sequence[int], flags) -> Dict[str, Any]:
    y = np.asarray(labels, dtype=int)
    f = np.asarray(flags, dtype=bool)
    tp = int(np.count_nonzero(f & (y == 1)))
    fp = int(np.count_nonzero(f & (y == 0)))
    fn = int(np.count_nonzero(~f & (y == 1)))
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    return {"tp": tp, "fp": fp, "fn": fn,
            "precision": round(precision, 4), "recall": round(recall, 4),
            "f1": round(f1, 4)}


def _delay_metrics(labels: Sequence[int], flags) -> Dict[str, Any]:
    y = np.asarray(labels, dtype=int)
    flagged = np.nonzero(np.asarray(flags, dtype=bool))[0]
    events: List[Tuple[int, int]] = []
    i = 0
    while i < len(y):
        if y[i] == 1:
            j = i
            while j + 1 < len(y) and y[j + 1] == 1:
                j += 1
            events.append((i, j))
            i = j + 1
        else:
            i += 1
    delays: List[int] = []
    missed = 0
    for start, end in events:
        in_window = [int(d) for d in flagged if start <= d <= end + DELAY_GRACE_SAMPLES]
        if in_window:
            delays.append(in_window[0] - start)
        else:
            missed += 1
    mean_delay = float(np.mean(delays)) if delays else None
    return {
        "anomalyEvents": len(events),
        "detectedEvents": len(delays),
        "missedEvents": missed,
        "meanDetectionDelaySamples": round(mean_delay, 3) if mean_delay is not None else None,
    }


def _model_metrics(labels: Sequence[int], flags) -> Dict[str, Any]:
    metrics = _classification_metrics(labels, flags)
    metrics.update(_delay_metrics(labels, flags))
    metrics["detected"] = int(np.count_nonzero(np.asarray(flags, dtype=bool)))
    return metrics


def _flags_for(values: Sequence[float], contamination: float) -> Tuple[np.ndarray, np.ndarray]:
    if_result = isolation_forest_detect(values, contamination=contamination)
    if_flags = if_result["flags"] if if_result is not None else np.zeros(len(values), dtype=bool)
    z_flags = zscore_baseline(values)["flags"]
    return if_flags, z_flags


# ------------------------------------------------------------------- entrypoint
def run_evaluation(backend: Any = None, contamination: float = EVAL_CONTAMINATION) -> Dict[str, Any]:
    """Run the labeled synthetic evaluation and return the full results JSON."""
    from .anomaly import MODEL_VERSION  # local import to keep module header light

    patterns = _generate_patterns()
    pattern_results: List[Dict[str, Any]] = []
    pooled_labels: List[int] = []
    pooled_if: List[bool] = []
    pooled_z: List[bool] = []

    for pattern in patterns:
        values = [s["value"] for s in pattern["samples"]]
        labels = [s["label"] for s in pattern["samples"]]
        if_flags, z_flags = _flags_for(values, contamination)
        entry: Dict[str, Any] = {
            "name": pattern["name"],
            "description": pattern["description"],
            "sampleCount": len(values),
            "labeledAnomalies": int(sum(labels)),
        }
        if "gapSamples" in pattern:
            entry["gapSamples"] = pattern["gapSamples"]
        entry["isolation_forest"] = _model_metrics(labels, if_flags)
        entry["zscore_baseline"] = _model_metrics(labels, z_flags)
        pattern_results.append(entry)
        pooled_labels.extend(labels)
        pooled_if.extend(bool(f) for f in if_flags)
        pooled_z.extend(bool(f) for f in z_flags)

    overall = {
        "isolation_forest": _model_metrics(pooled_labels, np.asarray(pooled_if, dtype=bool)),
        "zscore_baseline": _model_metrics(pooled_labels, np.asarray(pooled_z, dtype=bool)),
    }

    results: Dict[str, Any] = {
        "kind": EVALUATION_KIND,
        "modelVersion": MODEL_VERSION,
        "contamination": contamination,
        "generatedAt": to_iso(datetime.now(timezone.utc)),
        "patterns": pattern_results,
        "overall": overall,
        "analyticsRunId": None,
    }

    if backend is not None:
        try:  # best-effort persistence — must never break the evaluation response
            results["analyticsRunId"] = backend.push_analytics_run(
                kind="evaluation",
                model="isolation_forest+zscore_baseline",
                status="completed",
                detail={
                    "patternCount": len(pattern_results),
                    "sampleCount": len(pooled_labels),
                    "isolationForest": overall["isolation_forest"],
                    "zscoreBaseline": overall["zscore_baseline"],
                },
            )
        except Exception:  # noqa: BLE001 — deliberate: swallow backend outages
            results["analyticsRunId"] = None

    return results
