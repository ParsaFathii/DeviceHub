"""HTTP client for the DeviceHub Next.js backend internal APIs (port 3000).

- Sends the ``X-Internal-Token`` header on every call
  (token from ``DH_INTERNAL_TOKEN``, default ``dev-internal-token``).
- Connect/read timeouts, plus up to ``retries`` extra attempts with a short
  linear backoff.
- ``fetch_telemetry`` raises :class:`BackendError` when the backend is
  unreachable (callers translate that into HTTP 503), while
  ``push_anomalies`` / ``push_analytics_run`` are best-effort and never raise —
  persistence failures must not break analytics responses.

A custom ``httpx`` transport can be injected for tests
(``httpx.MockTransport``), so no real network is ever needed in unit tests.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Union

import httpx

from .aggregates import to_iso

logger = logging.getLogger("devicehub.analytics.backend")

DEFAULT_BASE_URL = os.environ.get("DH_BACKEND_URL", "http://localhost:3000")
DEFAULT_TOKEN = os.environ.get("DH_INTERNAL_TOKEN", "dev-internal-token")
DEFAULT_TIMEOUT = 10.0
DEFAULT_RETRIES = 2


class BackendError(RuntimeError):
    """Raised when a required backend call fails after all retries."""


class BackendClient:
    """Small ``httpx`` wrapper around the DeviceHub internal APIs."""

    def __init__(self,
                 base_url: str = DEFAULT_BASE_URL,
                 token: str = DEFAULT_TOKEN,
                 retries: int = DEFAULT_RETRIES,
                 timeout: float = DEFAULT_TIMEOUT,
                 transport: Optional[httpx.BaseTransport] = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.retries = max(0, int(retries))
        self.timeout = timeout
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            headers={"X-Internal-Token": token},
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------------ low level
    def _request(self, method: str, path: str, *,
                 params: Optional[Dict[str, Any]] = None,
                 json_body: Optional[Any] = None) -> Optional[Any]:
        """Execute a request with retries. Returns parsed JSON or ``None``."""
        last_error: Optional[Exception] = None
        attempts = self.retries + 1
        for attempt in range(1, attempts + 1):
            try:
                response = self._client.request(method, path, params=params, json=json_body)
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt < attempts:
                    time.sleep(min(0.2 * attempt, 0.5))
        logger.error("backend %s %s failed after %d attempts: %s",
                     method, path, attempts, last_error)
        return None

    @staticmethod
    def _iso(value: Union[str, datetime, None]) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, datetime):
            return to_iso(value)
        return str(value)

    # ----------------------------------------------------------------- API calls
    def fetch_telemetry(self,
                        device_id: Optional[str] = None,
                        metric: Optional[str] = None,
                        from_dt: Union[str, datetime, None] = None,
                        to_dt: Union[str, datetime, None] = None,
                        limit: int = 5000,
                        hours: Optional[float] = None) -> List[Dict[str, Any]]:
        """GET /api/internal/telemetry → list of samples (raises BackendError)."""
        params: Dict[str, Any] = {"limit": limit}
        if device_id:
            params["deviceId"] = device_id
        if metric:
            params["metric"] = metric
        from_iso = self._iso(from_dt)
        to_iso_value = self._iso(to_dt)
        if from_iso:
            params["from"] = from_iso
        if to_iso_value:
            params["to"] = to_iso_value
        if hours is not None:
            # convenience param: recent-window fetches (backend returns latest first)
            params["hours"] = round(float(hours), 3)
        data = self._request("GET", "/api/internal/telemetry", params=params)
        if data is None:
            raise BackendError(
                f"GET {self.base_url}/api/internal/telemetry failed after {self.retries + 1} attempts"
            )
        samples = data.get("samples") if isinstance(data, dict) else None
        if not isinstance(samples, list):
            raise BackendError("malformed telemetry response: 'samples' list missing")
        return samples

    def push_anomalies(self, findings: List[Dict[str, Any]]) -> int:
        """POST /api/internal/anomalies (best-effort). Returns count accepted."""
        if not findings:
            return 0
        data = self._request("POST", "/api/internal/anomalies",
                             json_body={"findings": findings})
        if not isinstance(data, dict):
            return 0
        try:
            return int(data.get("accepted", 0))
        except (TypeError, ValueError):
            return 0

    def push_analytics_run(self, kind: str, model: str, status: str,
                           detail: Any) -> Optional[Any]:
        """POST /api/internal/analytics-runs (best-effort). Returns run id or None."""
        data = self._request("POST", "/api/internal/analytics-runs",
                             json_body={"kind": kind, "model": model,
                                        "status": status, "detail": detail})
        if not isinstance(data, dict):
            return None
        return data.get("id")
