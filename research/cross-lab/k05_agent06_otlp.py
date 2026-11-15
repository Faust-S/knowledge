"""Opt-in OpenTelemetry OTLP/JSON technical metrics view of K05 observations.

No network client, background service or private-data storage. Caller must
supply the actual owner-observed window in nanoseconds. No timestamps, IDs,
money, result text, raw receipts or provider labels are invented/exported.
"""
from __future__ import annotations

from k05_agent06_effectiveness import SCHEMA, K05EffectivenessHold

CONTRACT = "IWXA_K05_OTLP_TECHNICAL_METRICS/0.2"
TECHNICAL = {
    "elapsed_ms": ("iwxa.agent.execution.duration", "ms", "gauge"),
    "input_tokens": ("iwxa.ai.input.tokens", "{token}", "sum"),
    "output_tokens": ("iwxa.ai.output.tokens", "{token}", "sum"),
    "retry_count": ("iwxa.task.retries", "{retry}", "sum"),
    "error_count": ("iwxa.task.errors", "{error}", "sum"),
    "intervention_count": ("iwxa.task.interventions", "{intervention}", "sum"),
}
# No user IDs, task/result/source hashes, model name, tool names, money or
# owner receipt IDs. Do not assert this is a complete anonymization process.


def _timestamp(value):
    # 2000-01-01 through 2100-01-01, wall-clock UTC nanoseconds, not Python
    # process start or arbitrary monotonic clock values.
    return type(value) is int and 946684800000000000 <= value <= 4102444800000000000


def project_otlp_json(
    observation: dict, *, enabled: bool = False,
    start_time_unix_nano: int | None = None,
    time_unix_nano: int | None = None,
) -> dict:
    """One owner-approved run delta/gauge. No I/O or automatic transmission."""
    if type(observation) is not dict or observation.get("schema") != SCHEMA:
        raise K05EffectivenessHold("K05_OTLP_OBSERVATION_REQUIRED")
    if type(enabled) is not bool:
        raise K05EffectivenessHold("K05_OTLP_OPT_IN_INVALID")
    if not enabled:
        return {"schema": CONTRACT, "status": "DISABLED", "otlp": None}
    metrics = observation.get("metrics")
    statuses = observation.get("metric_status")
    if type(metrics) is not dict or type(statuses) is not dict:
        raise K05EffectivenessHold("K05_OTLP_METRICS_REQUIRED")
    if not (_timestamp(start_time_unix_nano) and _timestamp(time_unix_nano)
            and start_time_unix_nano <= time_unix_nano):
        return {"schema": CONTRACT, "status": "MEASUREMENT_WINDOW_REQUIRED",
                "otlp": None}
    start, end = str(start_time_unix_nano), str(time_unix_nano)
    points = []
    for key, (name, unit, kind) in TECHNICAL.items():
        value = metrics.get(key)
        reported = statuses.get(key)
        if reported not in ("OBSERVED", "UNKNOWN") or (
            reported == "UNKNOWN" and value is not None
        ):
            raise K05EffectivenessHold("K05_OTLP_METRIC_STATUS_INVALID")
        if value is None:
            if reported == "OBSERVED":
                raise K05EffectivenessHold("K05_OTLP_METRIC_STATUS_INVALID")
            continue
        if type(value) is not int or not 0 <= value <= 10**15:
            raise K05EffectivenessHold("K05_OTLP_METRIC_INVALID")
        point = {
            "startTimeUnixNano": start, "timeUnixNano": end,
            "asInt": str(value), "attributes": [],
        }
        datum = ({"gauge": {"dataPoints": [point]}}
                 if kind == "gauge" else
                 {"sum": {"aggregationTemporality": 1, "isMonotonic": True,
                          "dataPoints": [point]}})
        points.append({"name": name, "unit": unit, **datum})
    return {
        "schema": CONTRACT,
        "status": "READY_FOR_OWNER_APPROVED_EXPORT" if points else "NO_TECHNICAL_METRICS",
        "otlp": {"resourceMetrics": [{
            "resource": {"attributes": [{
                "key": "service.name", "value": {"stringValue": "iwxa-personal-agent"},
            }]},
            "scopeMetrics": [{"scope": {"name": "iwxa.k05"}, "metrics": points}],
        }]},
        "note": "One source-bound run. Sum points use DELTA temporality. No network exporter or lifetime totals.",
    }
