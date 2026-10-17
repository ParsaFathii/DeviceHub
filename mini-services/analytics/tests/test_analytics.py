"""DeviceHub Analytics service tests.

No real network access: the backend is mocked with ``httpx.MockTransport``.
Covers: aggregate bucketing (gaps + out-of-order), z-score baseline on
spike/drift data, IsolationForest on injected spikes, the labeled synthetic
evaluation, /model-info, /health, /detect, /aggregate, /evaluate endpoints,
and the backend client (token header, params, retries).
"""
import json
import math
import os
from datetime import datetime, timedelta, timezone

import httpx
import numpy as np
import pytest
import sklearn
from fastapi.testclient import TestClient

from app.aggregates import aggregate_samples, parse_ts, to_iso
from app.anomaly import (
    MIN_SAMPLES,
    MODEL_NAME,
    MODEL_VERSION,
    detect_series,
    isolation_forest_detect,
    zscore_baseline,
)
from app.backend_client import BackendClient
from app.evaluation import run_evaluation
from app.main import app, get_backend_client

T0 = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
DEFAULT_TOKEN = os.environ.get("DH_INTERNAL_TOKEN", "dev-internal-token")


def mk_sample(dt, value, seq, device="DH-ENV-001", metric="temperature"):
    return {
        "deviceId": device,
        "metric": metric,
        "value": value,
        "unit": "degC",
        "sampleTs": to_iso(dt),
        "quality": "good",
        "sequence": seq,
    }


@pytest.fixture()
def client():
    return TestClient(app)


# ------------------------------------------------------------------- aggregates
def test_aggregate_bucketing_min_max_avg_count():
    samples = [
        mk_sample(T0, 1.0, 1),
        mk_sample(T0 + timedelta(seconds=60), 2.0, 2),
        mk_sample(T0 + timedelta(seconds=120), 3.0, 3),
        mk_sample(T0 + timedelta(seconds=310), 5.0, 4),
        mk_sample(T0 + timedelta(seconds=350), 7.0, 5),
        mk_sample(T0 + timedelta(seconds=900), 9.0, 6),
    ]
    result = aggregate_samples(samples, 300)
    assert result["totalSamples"] == 6
    assert result["outOfOrder"] == 0
    assert [b["start"] for b in result["buckets"]] == [
        "2026-03-01T12:00:00Z",
        "2026-03-01T12:05:00Z",
        "2026-03-01T12:10:00Z",
        "2026-03-01T12:15:00Z",
    ]
    b0, b1, b2, b3 = result["buckets"]
    assert b0["count"] == 3 and b0["min"] == 1.0 and b0["max"] == 3.0
    assert b0["avg"] == pytest.approx(2.0) and b0["missing"] is False
    assert b1["count"] == 2 and b1["min"] == 5.0 and b1["max"] == 7.0
    assert b1["avg"] == pytest.approx(6.0)
    assert b2["missing"] is True and b2["count"] == 0
    assert b2["min"] is None and b2["max"] is None and b2["avg"] is None
    assert b3["count"] == 1 and b3["missing"] is False
    # one missing bucket between 12:10 and the next bucket at 12:15
    assert result["gaps"] == [{"start": "2026-03-01T12:10:00Z", "end": "2026-03-01T12:15:00Z"}]


def test_aggregate_out_of_order_counted_in_fetch_order():
    samples = [
        mk_sample(T0, 1.0, 1),                              # max so far = 12:00
        mk_sample(T0 + timedelta(seconds=120), 3.0, 3),     # new max = 12:02
        mk_sample(T0 + timedelta(seconds=60), 2.0, 2),      # earlier than max -> OOO
        mk_sample(T0 + timedelta(seconds=600), 9.0, 6),     # new max = 12:10
        mk_sample(T0 + timedelta(seconds=30), 1.5, 7),      # earlier than max -> OOO
    ]
    result = aggregate_samples(samples, 300)
    assert result["totalSamples"] == 5
    assert result["outOfOrder"] == 2
    b0, b1, b2 = result["buckets"]
    assert b0["count"] == 4  # 12:00 bucket holds 1.0, 3.0, 2.0, 1.5 regardless of order
    assert b0["min"] == 1.0 and b0["max"] == 3.0
    assert b0["avg"] == pytest.approx((1.0 + 3.0 + 2.0 + 1.5) / 4)
    assert b1["missing"] is True
    assert b2["count"] == 1 and b2["max"] == 9.0
    assert result["gaps"] == [{"start": "2026-03-01T12:05:00Z", "end": "2026-03-01T12:10:00Z"}]


def test_aggregate_merges_consecutive_missing_buckets():
    samples = [
        mk_sample(T0, 1.0, 1),
        mk_sample(T0 + timedelta(seconds=900), 9.0, 6),  # 15 minutes later
    ]
    result = aggregate_samples(samples, 300)
    missing = [b["missing"] for b in result["buckets"]]
    assert missing == [False, True, True, False]
    assert result["gaps"] == [{"start": "2026-03-01T12:05:00Z", "end": "2026-03-01T12:15:00Z"}]


def test_aggregate_empty_and_invalid_interval():
    empty = aggregate_samples([], 300)
    assert empty == {"buckets": [], "gaps": [], "totalSamples": 0, "outOfOrder": 0}
    with pytest.raises(ValueError):
        aggregate_samples([mk_sample(T0, 1.0, 1)], 0)
    with pytest.raises(ValueError):
        aggregate_samples([mk_sample(T0, 1.0, 1)], -300)


# --------------------------------------------------------------------- anomaly
def test_zscore_baseline_flags_spike():
    rng = np.random.default_rng(7)
    values = list(20.0 + rng.normal(0.0, 0.3, 100))
    values[60] = 35.0  # hard spike
    result = zscore_baseline(values)
    assert bool(result["flags"][60]) is True
    assert result["scores"][60] == pytest.approx(1.0)  # |z|/3 clipped to 1
    assert int(result["flags"].sum()) == 1  # nothing else crosses |z| > 3
    assert result["scores"][0] < 0.5
    assert result["ok"] is True


def test_zscore_baseline_flags_late_drift():
    rng = np.random.default_rng(11)
    values = [20.0 + float(rng.normal(0.0, 0.2)) for _ in range(100)]
    for i in range(100, 125):  # steep ramp: 20 -> 41.6
        values.append(20.0 + 0.9 * (i - 100) + float(rng.normal(0.0, 0.2)))
    result = zscore_baseline(values)
    assert int(result["flags"][:100].sum()) == 0  # clean baseline stays clean
    assert int(result["flags"][100:].sum()) >= 3  # drift tail crosses |z| > 3


def test_zscore_baseline_degenerate_series_flags_nothing():
    result = zscore_baseline([22.0] * 50)  # constant series, std = 0
    assert int(result["flags"].sum()) == 0
    assert result["ok"] is False


def test_isolation_forest_flags_injected_spikes():
    rng = np.random.default_rng(42)
    values = list(20.0 + rng.normal(0.0, 0.3, 120))
    spike_indices = [40, 41, 80, 100]
    for i in spike_indices:
        values[i] += 8.0
    result = isolation_forest_detect(values, contamination=0.05)
    assert result is not None
    for i in spike_indices:
        assert bool(result["flags"][i]) is True
    assert float(result["scores"].min()) >= 0.0
    assert float(result["scores"].max()) <= 1.0
    # the spikes are the most anomalous points of the series
    normal_mask = np.ones(len(values), dtype=bool)
    normal_mask[spike_indices] = False
    assert float(result["scores"][spike_indices].min()) >= float(np.median(result["scores"][normal_mask]))


def test_isolation_forest_requires_min_samples():
    assert MIN_SAMPLES == 40
    assert isolation_forest_detect([20.0 + 0.1 * i for i in range(39)], 0.02) is None
    assert isolation_forest_detect([20.0 + 0.1 * i for i in range(40)], 0.02) is not None


def test_detect_series_builds_findings_for_spike():
    samples = []
    for i in range(60):
        dt = T0 + timedelta(minutes=i)
        samples.append(mk_sample(dt, 20.0 + 0.4 * math.sin(i / 5.0), i))
    samples[30]["value"] = 30.0  # injected spike
    if_findings, baseline_findings = detect_series(samples, contamination=0.05)
    required = {"deviceId", "metric", "windowStart", "windowEnd", "score",
                "model", "modelVersion", "baselineScore", "details"}
    assert if_findings, "IsolationForest should flag the spike"
    for finding in if_findings + baseline_findings:
        assert required.issubset(finding.keys())
        assert 0.0 <= finding["score"] <= 1.0
    assert all(f["model"] == MODEL_NAME and f["modelVersion"] == MODEL_VERSION for f in if_findings)
    assert all(f["model"] == "zscore_baseline" and f["modelVersion"] == "zscore-v1.0"
               for f in baseline_findings)
    assert any(f["details"]["value"] == pytest.approx(30.0) for f in if_findings)
    assert any(f["details"]["value"] == pytest.approx(30.0) for f in baseline_findings)
    # latest-first ordering must not matter
    if_findings_rev, baseline_rev = detect_series(list(reversed(samples)), contamination=0.05)
    assert {f["windowStart"] for f in if_findings_rev} == {f["windowStart"] for f in if_findings}


def test_detect_series_short_series_has_no_isolation_forest():
    samples = [mk_sample(T0 + timedelta(minutes=i), 20.0 + 0.1 * (i % 3), i) for i in range(30)]
    if_findings, baseline_findings = detect_series(samples, contamination=0.05)
    assert if_findings == []  # below MIN_SAMPLES -> no IF findings
    assert baseline_findings == []  # and nothing crosses |z| > 3


# ------------------------------------------------------------------ evaluation
class _BrokenBackend:
    def push_analytics_run(self, *args, **kwargs):
        raise RuntimeError("backend down")


def test_run_evaluation_full_metrics():
    results = run_evaluation(backend=_BrokenBackend())
    assert results["analyticsRunId"] is None  # best-effort persistence never breaks evaluation
    assert results["modelVersion"] == MODEL_VERSION
    assert results["kind"] == "labeled_synthetic_evaluation"
    names = [p["name"] for p in results["patterns"]]
    assert names == [
        "stable_baseline", "gradual_drift", "sudden_spike", "missing_samples",
        "noisy_sensor", "disconnected_device", "repeated_stuck_values", "out_of_range",
    ]
    by_name = {p["name"]: p for p in results["patterns"]}
    # REQUIRED: spike recall for IsolationForest >= 0.5
    assert by_name["sudden_spike"]["isolation_forest"]["recall"] >= 0.5
    # z-score baseline catches extreme out-of-range values
    assert by_name["out_of_range"]["zscore_baseline"]["recall"] >= 0.5
    for pattern in results["patterns"]:
        for model_key in ("isolation_forest", "zscore_baseline"):
            metrics = pattern[model_key]
            for key in ("precision", "recall", "f1"):
                assert 0.0 <= metrics[key] <= 1.0
            assert metrics["detected"] >= 0
            assert metrics["tp"] + metrics["fp"] == metrics["detected"]
            delay = metrics["meanDetectionDelaySamples"]
            assert delay is None or delay >= 0
    assert "isolation_forest" in results["overall"] and "zscore_baseline" in results["overall"]
    assert results["overall"]["isolation_forest"]["tp"] > 0
    assert results["overall"]["zscore_baseline"]["tp"] > 0


# -------------------------------------------------------------------- endpoints
def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "model": "isolation_forest",
        "modelVersion": "if-v1.0",
        "sklearn": sklearn.__version__,
    }


def test_model_info_endpoint(client):
    response = client.get("/model-info")
    assert response.status_code == 200
    body = response.json()
    assert body["model"] == MODEL_NAME
    assert body["modelVersion"] == MODEL_VERSION
    assert body["features"] == ["value", "abs(diff)", "rolling_mean_5"]
    assert body["parameters"]["n_estimators"] == 100
    assert any("NOT a calibrated probability" in limitation for limitation in body["limitations"])


def _with_backend_override(transport, retries=0):
    mock_client = BackendClient(base_url="http://backend.test", retries=retries,
                                transport=transport)
    app.dependency_overrides[get_backend_client] = lambda: mock_client
    return mock_client


def test_aggregate_endpoint_with_mocked_backend():
    samples = [
        mk_sample(T0, 1.0, 1),
        mk_sample(T0 + timedelta(seconds=60), 2.0, 2),
        mk_sample(T0 + timedelta(seconds=120), 3.0, 3),
        mk_sample(T0 + timedelta(seconds=900), 9.0, 6),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/api/internal/telemetry"
        assert request.headers.get("X-Internal-Token") == DEFAULT_TOKEN
        assert "deviceId=DH-ENV-001" in str(request.url)
        assert "metric=temperature" in str(request.url)
        assert "limit=5000" in str(request.url)
        return httpx.Response(200, json={"samples": samples})

    _with_backend_override(httpx.MockTransport(handler))
    try:
        response = TestClient(app).post("/aggregate", json={
            "deviceId": "DH-ENV-001", "metric": "temperature",
            "from": "2026-03-01T12:00:00Z", "to": "2026-03-01T12:20:00Z",
            "intervalSec": 300,
        })
    finally:
        app.dependency_overrides.pop(get_backend_client, None)
    assert response.status_code == 200
    body = response.json()
    assert body["totalSamples"] == 4
    assert body["outOfOrder"] == 0
    assert [b["start"] for b in body["buckets"]] == [
        "2026-03-01T12:00:00Z", "2026-03-01T12:05:00Z",
        "2026-03-01T12:10:00Z", "2026-03-01T12:15:00Z",
    ]
    assert body["buckets"][2]["missing"] is True
    assert body["buckets"][0]["avg"] == pytest.approx(2.0)
    # two consecutive missing buckets merge into a single gap
    assert body["gaps"] == [{"start": "2026-03-01T12:05:00Z", "end": "2026-03-01T12:15:00Z"}]


def test_aggregate_endpoint_backend_unavailable_returns_503():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "down"})

    _with_backend_override(httpx.MockTransport(handler))
    try:
        response = TestClient(app).post("/aggregate", json={
            "deviceId": "DH-ENV-001", "metric": "temperature",
            "from": "2026-03-01T12:00:00Z", "to": "2026-03-01T12:20:00Z",
            "intervalSec": 300,
        })
    finally:
        app.dependency_overrides.pop(get_backend_client, None)
    assert response.status_code == 503


def test_detect_endpoint_with_mocked_backend():
    # backend returns latest-first, with 4 injected spikes
    samples = []
    for i in range(120):
        dt = datetime(2026, 3, 1, 12, 0, tzinfo=timezone.utc) + timedelta(minutes=i)
        samples.append(mk_sample(dt, 20.0 + 0.3 * math.sin(i / 4.0), i))
    for i in (40, 41, 80, 100):
        samples[i]["value"] += 8.0
    latest_first = list(reversed(samples))
    pushed = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET" and request.url.path == "/api/internal/telemetry":
            assert request.headers.get("X-Internal-Token") == DEFAULT_TOKEN
            assert "hours=" in str(request.url)  # convenience window param
            return httpx.Response(200, json={"samples": latest_first})
        if request.method == "POST" and request.url.path == "/api/internal/anomalies":
            pushed["body"] = json.loads(request.content)
            return httpx.Response(200, json={"accepted": len(pushed["body"]["findings"])})
        return httpx.Response(404, json={"error": "unexpected route"})

    _with_backend_override(httpx.MockTransport(handler))
    try:
        response = TestClient(app).post("/detect", json={
            "deviceId": "DH-ENV-001", "metric": "temperature",
            "windowMin": 60, "contamination": 0.05,
        })
    finally:
        app.dependency_overrides.pop(get_backend_client, None)
    assert response.status_code == 200
    body = response.json()
    assert body["series"] == 1
    assert body["modelVersion"] == "if-v1.0"
    assert len(body["findings"]) >= 3
    assert any(f["details"]["value"] > 27.0 for f in body["findings"])
    assert any(f["details"]["value"] > 27.0 for f in body["baselineFindings"])
    required = {"deviceId", "metric", "windowStart", "windowEnd", "score",
                "model", "modelVersion", "baselineScore", "details"}
    assert all(required.issubset(f.keys()) for f in body["findings"])
    # both models' findings are persisted in a single POST
    assert pushed["body"]["findings"] == body["findings"] + body["baselineFindings"]
    assert body["persistedAnomalies"] == len(pushed["body"]["findings"])


def test_evaluate_endpoint_survives_backend_outage():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "backend not ready"})

    _with_backend_override(httpx.MockTransport(handler))
    try:
        response = TestClient(app).post("/evaluate")
    finally:
        app.dependency_overrides.pop(get_backend_client, None)
    assert response.status_code == 200  # synthetic data only; persistence is best-effort
    body = response.json()
    assert len(body["patterns"]) == 8
    assert body["analyticsRunId"] is None
    assert body["overall"]["isolation_forest"]["recall"] > 0.0


# --------------------------------------------------------------- backend client
def test_backend_client_fetch_telemetry_sends_token_and_params():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["token"] = request.headers.get("X-Internal-Token")
        captured["params"] = dict(request.url.params)
        return httpx.Response(200, json={"samples": [{
            "deviceId": "D1", "metric": "temperature", "value": 21.0, "unit": "degC",
            "sampleTs": "2026-01-01T00:00:00Z", "quality": "good", "sequence": 1,
        }]})

    backend = BackendClient(base_url="http://backend.test", token="tok-123",
                            retries=0, transport=httpx.MockTransport(handler))
    try:
        samples = backend.fetch_telemetry(
            device_id="D1", metric="temperature",
            from_dt=datetime(2026, 1, 1, tzinfo=timezone.utc),
            to_dt=datetime(2026, 1, 2, tzinfo=timezone.utc),
        )
    finally:
        backend.close()
    assert captured["path"] == "/api/internal/telemetry"
    assert captured["token"] == "tok-123"
    assert captured["params"]["deviceId"] == "D1"
    assert captured["params"]["metric"] == "temperature"
    assert captured["params"]["from"] == "2026-01-01T00:00:00Z"
    assert captured["params"]["to"] == "2026-01-02T00:00:00Z"
    assert captured["params"]["limit"] == "5000"
    assert len(samples) == 1
    assert samples[0]["value"] == 21.0


def test_backend_client_retries_then_succeeds():
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] < 3:
            return httpx.Response(500, json={"error": "boom"})
        return httpx.Response(200, json={"samples": []})

    backend = BackendClient(base_url="http://backend.test", retries=2,
                            transport=httpx.MockTransport(handler))
    try:
        samples = backend.fetch_telemetry()
    finally:
        backend.close()
    assert samples == []
    assert calls["count"] == 3  # 1 initial try + 2 retries


def test_backend_client_push_anomalies_and_analytics_run():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured[request.url.path] = json.loads(request.content)
        captured.setdefault("calls", []).append((request.method, request.url.path))
        if request.url.path == "/api/internal/anomalies":
            return httpx.Response(200, json={"accepted": len(captured[request.url.path]["findings"])})
        return httpx.Response(200, json={"id": 42})

    backend = BackendClient(base_url="http://backend.test", retries=0,
                            transport=httpx.MockTransport(handler))
    try:
        accepted = backend.push_anomalies([
            {"deviceId": "D1", "metric": "m", "score": 0.9, "model": "isolation_forest"},
        ])
        run_id = backend.push_analytics_run(kind="evaluation", model="if+z",
                                            status="completed", detail={"x": 1})
        empty_accepted = backend.push_anomalies([])  # nothing to persist
    finally:
        backend.close()
    assert accepted == 1
    assert empty_accepted == 0
    assert run_id == 42
    assert captured["/api/internal/anomalies"]["findings"][0]["deviceId"] == "D1"
    assert captured["/api/internal/analytics-runs"] == {
        "kind": "evaluation", "model": "if+z", "status": "completed", "detail": {"x": 1},
    }


def test_parse_ts_roundtrip():
    assert to_iso(parse_ts("2026-03-01T12:00:00Z")) == "2026-03-01T12:00:00Z"
    assert to_iso(parse_ts("2026-03-01T12:00:00+00:00")) == "2026-03-01T12:00:00Z"
    assert to_iso(parse_ts("2026-03-01T14:00:00+02:00")) == "2026-03-01T12:00:00Z"
    assert to_iso(parse_ts("2026-03-01T12:00:00")) == "2026-03-01T12:00:00Z"  # naive = UTC
    with pytest.raises(ValueError):
        parse_ts("not-a-timestamp")
