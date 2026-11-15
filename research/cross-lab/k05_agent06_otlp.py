"""Opt-in OpenTelemetry-compatible technical metrics projection for K05.

This constructs a privacy-minimized OTLP/JSON metrics document. No exporter,
network client, SDK, background service or personal data storage is installed.
The trusted Agent host chooses whether and where to transmit it.
"""
from __future__ import annotations
from k05_agent06_effectiveness import SCHEMA, K05EffectivenessHold

CONTRACT = "IWXA_K05_OTLP_TECHNICAL_METRICS/0.1"
COUNTERS = {
    "elapsed_ms": ("iwxa.agent.execution.duration", "ms"),
    "input_tokens": ("iwxa.ai.input.tokens", "{token}"),
    "output_tokens": ("iwxa.ai.output.tokens", "{token}"),
    "retry_count": ("iwxa.task.retries", "{retry}"),
    "error_count": ("iwxa.task.errors", "{error}"),
    "intervention_count": ("iwxa.task.interventions", "{intervention}"),
}
# Not exported: task/result/source IDs or hashes, money, model/provider
# identifiers, user text, tool names, acceptance receipts, process facts.

def project_otlp_json(observation: dict, *, enabled: bool = False) -> dict:
    if type(observation) is not dict or observation.get("schema") != SCHEMA:
        raise K05EffectivenessHold("K05_OTLP_OBSERVATION_REQUIRED")
    if type(enabled) is not bool:
        raise K05EffectivenessHold("K05_OTLP_OPT_IN_INVALID")
    measurements = observation.get("metrics")
    if type(measurements) is not dict:
        raise K05EffectivenessHold("K05_OTLP_METRICS_REQUIRED")
    if not enabled:
        return {"schema": CONTRACT, "status": "DISABLED", "otlp": None}
    points = []
    for key, (name, unit) in COUNTERS.items():
        value = measurements.get(key)
        if value is None:
            continue
        if type(value) is not int or value < 0 or value > 10**15:
            raise K05EffectivenessHold("K05_OTLP_METRIC_INVALID")
        points.append({
            "name": name,
            "unit": unit,
            "sum": {"aggregationTemporality": 1, "isMonotonic": False,
                    "dataPoints": [{"asInt": str(value), "attributes": []}]},
        })
    return {
        "schema": CONTRACT,
        "status": "READY_FOR_OWNER_APPROVED_EXPORT" if points else "NO_TECHNICAL_METRICS",
        "otlp": {"resourceMetrics": [{
            "resource": {"attributes": [{
                "key": "service.name", "value": {"stringValue": "iwxa-personal-agent"},
            }]},
            "scopeMetrics": [{"scope": {"name": "iwxa.k05"},
                              "metrics": points}],
        }]},
        "note": "Cumulative sums are NOT implied: every export is an isolated delta snapshot. No durable OTLP writer.",
    }
