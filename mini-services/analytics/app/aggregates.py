"""Time-bucket aggregation of telemetry samples.

Pure functions — no network access. Used by the ``POST /aggregate`` endpoint.

Shared ISO-8601 helpers (``parse_ts`` / ``to_iso``) also live here because
every other module needs the exact same UTC serialization.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# Safety cap so a pathological interval cannot explode the bucket loop.
MAX_BUCKETS = 50_000


def parse_ts(value: Any) -> datetime:
    """Parse an ISO-8601 timestamp (UTC ``Z`` or explicit offset) into an aware UTC datetime.

    Naive timestamps are assumed to be UTC.
    """
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_iso(dt: datetime) -> str:
    """Format an aware datetime as ISO-8601 UTC with a trailing ``Z``."""
    dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def _bucket_start(ts: datetime, interval_sec: int) -> datetime:
    """Floor a timestamp onto the bucket grid (UNIX-epoch aligned)."""
    epoch = math.floor(ts.timestamp() / interval_sec) * interval_sec
    return datetime.fromtimestamp(epoch, tz=timezone.utc)


def aggregate_samples(samples: List[Dict[str, Any]], interval_sec: int) -> Dict[str, Any]:
    """Bucket telemetry samples into fixed intervals.

    Rules (matching the DeviceHub analytics contract):

    - Buckets are aligned to UNIX-epoch multiples of ``interval_sec`` and span
      from the *first* sample's bucket through the *last* sample's bucket
      (both inclusive), regardless of the requested window.
    - A bucket containing zero samples is flagged ``missing`` with
      ``min``/``max``/``avg`` = ``None`` and ``count`` = 0.
    - ``gaps`` merges runs of consecutive missing buckets into
      ``{"start", "end"}`` ranges; ``end`` is the exclusive upper bound, i.e.
      the end of the last missing bucket.
    - ``outOfOrder`` counts samples whose timestamp is earlier than the maximum
      timestamp seen so far *in fetch order* (the order the backend returned
      them — the backend returns latest-first, so this flags re-deliveries).
    - Samples missing ``sampleTs`` or ``value`` (or unparseable) are skipped;
      ``totalSamples`` counts the usable samples.

    Returns ``{"buckets": [...], "gaps": [...], "totalSamples": n, "outOfOrder": n}``.
    """
    if isinstance(interval_sec, bool) or not isinstance(interval_sec, int) or interval_sec <= 0:
        raise ValueError("intervalSec must be a positive integer (seconds)")
    interval = int(interval_sec)

    parsed: List[Tuple[datetime, float]] = []
    out_of_order = 0
    max_ts: Optional[datetime] = None
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        try:
            ts = parse_ts(sample.get("sampleTs"))
            value = float(sample.get("value"))
        except (TypeError, ValueError):
            continue
        if max_ts is not None and ts < max_ts:
            out_of_order += 1
        elif max_ts is None or ts > max_ts:
            max_ts = ts
        parsed.append((ts, value))

    if not parsed:
        return {"buckets": [], "gaps": [], "totalSamples": 0, "outOfOrder": 0}

    parsed.sort(key=lambda item: item[0])
    start_bucket = _bucket_start(parsed[0][0], interval)
    end_bucket = _bucket_start(parsed[-1][0], interval)
    n_buckets = int((end_bucket.timestamp() - start_bucket.timestamp()) // interval) + 1
    if n_buckets > MAX_BUCKETS:
        raise ValueError(
            f"intervalSec too small: would produce {n_buckets} buckets (max {MAX_BUCKETS})"
        )

    by_bucket: Dict[int, List[float]] = defaultdict(list)
    for ts, value in parsed:
        by_bucket[int(_bucket_start(ts, interval).timestamp())].append(value)

    buckets: List[Dict[str, Any]] = []
    gaps: List[Dict[str, str]] = []
    gap_start_epoch: Optional[int] = None
    epoch = int(start_bucket.timestamp())
    end_epoch = int(end_bucket.timestamp())
    while epoch <= end_epoch:
        values = by_bucket.get(epoch)
        if values:
            if gap_start_epoch is not None:
                gaps.append({
                    "start": to_iso(datetime.fromtimestamp(gap_start_epoch, tz=timezone.utc)),
                    "end": to_iso(datetime.fromtimestamp(epoch, tz=timezone.utc)),
                })
                gap_start_epoch = None
            buckets.append({
                "start": to_iso(datetime.fromtimestamp(epoch, tz=timezone.utc)),
                "min": min(values),
                "max": max(values),
                "avg": sum(values) / len(values),
                "count": len(values),
                "missing": False,
            })
        else:
            buckets.append({
                "start": to_iso(datetime.fromtimestamp(epoch, tz=timezone.utc)),
                "min": None,
                "max": None,
                "avg": None,
                "count": 0,
                "missing": True,
            })
            if gap_start_epoch is None:
                gap_start_epoch = epoch
        epoch += interval
    if gap_start_epoch is not None:
        gaps.append({
            "start": to_iso(datetime.fromtimestamp(gap_start_epoch, tz=timezone.utc)),
            "end": to_iso(datetime.fromtimestamp(end_epoch + interval, tz=timezone.utc)),
        })

    return {
        "buckets": buckets,
        "gaps": gaps,
        "totalSamples": len(parsed),
        "outOfOrder": out_of_order,
    }
