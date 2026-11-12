"""K05 optional, stateless comparison of already-saved Agent 0.5 model results.

This is a clean consumer of PA.K05.MODEL_EXECUTION_OBSERVATION/0.1.0.
It does not read Core, execute models, rank models, score answers or make
Task/Result acceptance decisions. Host supplies authorized exact bytes.
"""
from __future__ import annotations

from hashlib import sha256
from typing import Mapping
import re

SCHEMA = "IWXA_K05_AGENT05_PAIRED_OBSERVATIONS/0.1"
AGENT_MODEL_OBSERVATION = "PA.K05.MODEL_EXECUTION_OBSERVATION/0.1.0"
SHA = re.compile(r"^[0-9a-f]{64}$")
REVISION = re.compile(r"^sha256:[0-9a-f]{64}$")
MAX_TASK_BYTES = 65536
MAX_RESULT_BYTES = 2_000_000
MAX_SOURCE_BYTES = 1_000_000
MAX_SOURCES = 16
FIELDS = frozenset({
    "contract", "status", "observed_input_tokens", "observed_output_tokens",
    "observed_latency_ms", "quality_status", "cost_status",
    "actual_cost_usd", "estimated_savings_usd", "provenance_status",
    "owner_receipt_refs", "source_revision", "provider_id", "model",
    "read_only", "result_accepted", "execution_authority_granted",
})
RUN_FIELDS = frozenset({
    "run_id", "task_sha256", "source_manifest", "model_digest",
    "runtime_revision", "result_sha256", "model_observation",
})


class AgentComparisonHold(ValueError):
    pass


def fail(code: str) -> None:
    raise AgentComparisonHold("K05_AGENT05_" + code)


def _count(value, limit: int):
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= limit:
        fail("INVALID_REPORTED_METRIC")
    return value


def _hex(value) -> bool:
    return type(value) is str and SHA.fullmatch(value) is not None


def _bytes(data, limit: int) -> bytes:
    if type(data) is not bytes or not 0 < len(data) <= limit:
        fail("SOURCE_OR_RESULT_BYTES_MISSING")
    return data


def _observation(value):
    if type(value) is not dict or set(value) != FIELDS:
        fail("AGENT_OBSERVATION_FIELDS_CHANGED")
    if value["contract"] != AGENT_MODEL_OBSERVATION:
        fail("AGENT_OBSERVATION_CONTRACT_CHANGED")
    if value["status"] not in {
        "OBSERVED", "METRICS_UNAVAILABLE", "PROVENANCE_INCOMPLETE"
    } or value["provenance_status"] not in {
        "LINKED", "INCOMPLETE", "NOT_RECORDED", "UNKNOWN"
    }:
        fail("AGENT_OBSERVATION_STATUS_INVALID")
    if (value["read_only"] is not True
            or value["result_accepted"] is not False
            or value["execution_authority_granted"] is not False
            or value["quality_status"] != "QUALITY_UNKNOWN"
            or value["cost_status"] != "COST_UNKNOWN"
            or value["actual_cost_usd"] is not None
            or value["estimated_savings_usd"] is not None):
        fail("AGENT_OBSERVATION_AUTHORITY_OR_QUALITY_FORGED")
    owners = value["owner_receipt_refs"]
    if type(owners) is not dict or (
        owners and (set(owners) != {"k02", "k04"}
                    or any(type(ref) is not str or not ref.startswith("TXR-")
                           or len(ref) > 128 for ref in owners.values()))
    ):
        fail("OWNER_RECEIPT_REFS_INVALID")
    if ((value["provenance_status"] in {"LINKED", "INCOMPLETE"} and not owners)
            or (value["provenance_status"] in {"NOT_RECORDED", "UNKNOWN"} and owners)):
        fail("OWNER_RECEIPTS_PROVENANCE_CONTRADICTION")
    if (type(value["source_revision"]) is not str
            or len(value["source_revision"]) > 256
            or type(value["provider_id"]) is not str
            or len(value["provider_id"]) > 128
            or type(value["model"]) is not str or len(value["model"]) > 256):
        fail("AGENT_OBSERVATION_IDENTITY_INVALID")
    inp = _count(value["observed_input_tokens"], 1_000_000_000)
    out = _count(value["observed_output_tokens"], 1_000_000_000)
    latency = _count(value["observed_latency_ms"], 86_400_000)
    if (value["status"] == "METRICS_UNAVAILABLE"
            and any(x is not None for x in (inp, out, latency))):
        fail("METRICS_UNAVAILABLE_CONTRADICTION")
    if value["status"] == "PROVENANCE_INCOMPLETE" and value["provenance_status"] != "INCOMPLETE":
        fail("PROVENANCE_INCOMPLETE_CONTRADICTION")
    if value["status"] == "OBSERVED" and all(x is None for x in (inp, out, latency)):
        fail("OBSERVED_WITHOUT_MEASUREMENT")
    return {
        "input_tokens": inp, "output_tokens": out, "latency_ms": latency,
        "host_model_name": value["model"],
        "host_provider_id": value["provider_id"],
        "host_reported_provenance_status": value["provenance_status"],
        "saved_graph_artifact_digest": value["source_revision"],
        "owner_receipt_ref_digests": {key: sha256(ref.encode("utf-8")).hexdigest()
                                      for key, ref in value["owner_receipt_refs"].items()},
    }


def _check_run(run, authorized_bytes: Mapping[str, bytes], task_bytes: bytes,
               result_bytes: bytes):
    if type(run) is not dict or set(run) != RUN_FIELDS:
        fail("RUN_FIELDS_CHANGED")
    if (type(run["run_id"]) is not str
            or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9._-]{0,63}", run["run_id"])):
        fail("RUN_ID_INVALID")
    if not (_hex(run["task_sha256"]) and _hex(run["result_sha256"])
            and _hex(run["model_digest"])):
        fail("MISSING_EXACT_TASK_RESULT_OR_MODEL_DIGEST")
    if (type(run["runtime_revision"]) is not str
            or not re.fullmatch(r"[a-zA-Z0-9._:/-]{1,120}", run["runtime_revision"])):
        fail("RUNTIME_REVISION_INVALID")
    if sha256(_bytes(task_bytes, MAX_TASK_BYTES)).hexdigest() != run["task_sha256"]:
        fail("TASK_BYTES_MISMATCH")
    if sha256(_bytes(result_bytes, MAX_RESULT_BYTES)).hexdigest() != run["result_sha256"]:
        fail("RESULT_BYTES_MISMATCH")
    manifest = run["source_manifest"]
    if type(manifest) is not list or not 1 <= len(manifest) <= MAX_SOURCES:
        fail("SOURCE_MANIFEST_INVALID")
    keys = set()
    observations = []
    for pin in manifest:
        if (type(pin) is not dict or set(pin) != {"ref", "revision"}
                or type(pin["ref"]) is not str or not 1 <= len(pin["ref"]) <= 256
                or not REVISION.fullmatch(str(pin["revision"]))
                or pin["ref"] in keys):
            fail("SOURCE_PIN_INVALID")
        keys.add(pin["ref"])
        data = authorized_bytes.get(pin["ref"])
        if sha256(_bytes(data, MAX_SOURCE_BYTES)).hexdigest() != pin["revision"][7:]:
            fail("SOURCE_REVISION_MISMATCH")
        observations.append({"source_ref_sha256": sha256(pin["ref"].encode("utf-8")).hexdigest(),
                             "revision": pin["revision"],
                             "bytes_checked": len(data)})
    obs = _observation(run["model_observation"])
    return {
        "run_id": run["run_id"],
        "task_sha256": run["task_sha256"],
        "result_sha256": run["result_sha256"],
        "model_digest": run["model_digest"],
        "runtime_revision": run["runtime_revision"],
        "source_manifest": sorted(observations, key=lambda x: x["source_ref_sha256"]),
        "reported_metrics": obs,
    }


def compare_saved_model_runs(
    baseline: dict, tested: dict, *,
    baseline_task_bytes: bytes, tested_task_bytes: bytes,
    baseline_result_bytes: bytes, tested_result_bytes: bytes,
    baseline_source_bytes: Mapping[str, bytes],
    tested_source_bytes: Mapping[str, bytes],
) -> dict:
    """Compare validated bytes, *not* whether the user obtained a better Result.

    No result is persisted. Source/Task/Result bytes remain in host memory and
    are never included in output; owners retain authority and model receipts.
    """
    a = _check_run(baseline, baseline_source_bytes, baseline_task_bytes,
                   baseline_result_bytes)
    b = _check_run(tested, tested_source_bytes, tested_task_bytes,
                   tested_result_bytes)
    if a["run_id"] == b["run_id"]:
        fail("DUPLICATE_RUN_ID")
    reasons = []
    for name, code in (
        ("task_sha256", "TASK_CHANGED"),
        ("model_digest", "MODEL_CHANGED"),
        ("runtime_revision", "RUNTIME_CHANGED"),
        ("source_manifest", "SOURCE_SET_CHANGED"),
    ):
        if a[name] != b[name]:
            reasons.append(code)
    if (am := a["reported_metrics"])["host_reported_provenance_status"] == "INCOMPLETE" or (
        b["reported_metrics"]["host_reported_provenance_status"] == "INCOMPLETE"
    ):
        reasons.append("OWNER_RECEIPT_LINK_INCOMPLETE")
    if (a["reported_metrics"]["host_provider_id"] != b["reported_metrics"]["host_provider_id"]
            or a["reported_metrics"]["host_model_name"] != b["reported_metrics"]["host_model_name"]):
        reasons.append("MODEL_IDENTITY_CHANGED")
    comparable = not reasons
    am = a["reported_metrics"]
    bm = b["reported_metrics"]
    differences = {}
    for metric in ("input_tokens", "output_tokens", "latency_ms"):
        av, bv = am[metric], bm[metric]
        differences[metric + "_delta"] = (bv - av if comparable and
                                          av is not None and bv is not None
                                          else None)
    return {
        "schema": SCHEMA,
        "status": "SOURCE_BOUND_PROCESSING_COMPARABLE" if comparable else "NOT_COMPARABLE",
        "reasons": reasons,
        "runs": [a, b],
        "deltas": differences,
        "source_lineage": "HOST_SUPPLIED_EXACT_BYTES_REHASHED",
        "quality": {
            "status": "NOT_MEASURED", "human_gold": False,
            "precision": None, "recall": None, "f1": None,
            "user_corrections": None, "skill_effect": "NOT_MEASURED",
            "memory_effect": "NOT_MEASURED",
            "agent_solution_effect": "NOT_MEASURED",
        },
        "resources": {
            "actual_cost_usd_delta": None, "router_cost_usd": None,
            "retries": None, "model_invocations_by_k05": 0,
            "source_reads_by_k05": 0, "result_readback_from_core": "NOT_TESTED",
        },
        "qualification": "HOST_REPORTED_MODEL_METRICS_NOT_INDEPENDENT_CORE_READBACK",
    }
