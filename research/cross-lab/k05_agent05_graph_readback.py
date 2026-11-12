"""Optional source-bound K05 check of saved Agent Graph model snapshots.

Receives exact, already-authorized Core-supplied bytes. Does not read Core,
call the model, execute Task, validate Graph authority or approve its Result.
The output never includes text, paths, prompts, models or raw owner receipts.
"""
from __future__ import annotations

import hashlib
import json
import re

from k05_agent05_observations import (
    AGENT_MODEL_OBSERVATION, AgentComparisonHold, compare_saved_model_runs,
    _observation,
)

CONTRACT = "IWXA_K05_AGENT05_GRAPH_OBSERVATION_PROOF/0.1"
PAIR_CONTRACT = "IWXA_K05_AGENT05_GRAPH_PAIRED_PROOF/0.1"
GRAPH_ARTIFACT_CONTRACT = "PA.CONTRACT.GRAPH_NODE_EXECUTOR@1.0.0"
GRAPH_CONFIG_CONTRACT = "PA.CONTRACT.GRAPH_NODE_CONFIG@1.0.0"
HEX = re.compile(r"^[a-f0-9]{64}$")
MAX_ARTIFACT_BYTES = 8_000_000
MAX_CONFIG_BYTES = 2_000_000


def _fail(message: str):
    raise AgentComparisonHold("K05_AGENT05_GRAPH_" + message)


def _nonduplicate_pairs(pairs):
    row = {}
    for key, value in pairs:
        if key in row:
            _fail("DUPLICATE_JSON_KEY")
        row[key] = value
    return row


def _parse(raw: bytes, limit: int):
    if type(raw) is not bytes or not 0 < len(raw) <= limit:
        _fail("BYTES_MISSING_OR_TOO_LARGE")
    try:
        decoded = raw.decode("utf-8", "strict")
        obj = json.loads(
            decoded, object_pairs_hook=_nonduplicate_pairs,
            parse_constant=lambda _: _fail("NONFINITE_NUMBER"),
        )
    except (UnicodeError, ValueError, TypeError, RecursionError) as exc:
        _fail("INVALID_JSON")
    if type(obj) is not dict:
        _fail("OBJECT_REQUIRED")
    return obj


def _digest(material):
    try:
        payload = json.dumps(material, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError, OverflowError, RecursionError):
        _fail("INVALID_CANONICAL_JSON")
    return hashlib.sha256(payload).hexdigest()


def _verify_record(row: dict, *, digest_key: str, contract: str, obj_type: str):
    if (row.get("contract") != contract or row.get("object_type") != obj_type
            or type(row.get(digest_key)) is not str
            or HEX.fullmatch(row[digest_key]) is None):
        _fail("ARTIFACT_OR_CONFIG_CONTRACT_CHANGED")
    material = dict(row)
    claimed = material.pop(digest_key)
    if _digest(material) != claimed:
        _fail("ARTIFACT_OR_CONFIG_DIGEST_MISMATCH")
    return claimed


def _observed_count(value, limit):
    # The Agent normalizes missing/invalid usage to UNKNOWN. Do not promote
    # invalid raw data to a usable metric even if host returned None.
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= limit:
        _fail("RAW_METRIC_INVALID")
    return value


def verify_saved_graph_model_observation(
    observation: dict, *,
    artifact_bytes: bytes, config_bytes: bytes,
) -> dict:
    """Check the saved byte snapshots against Agent's actual K05 observation.

    A matching digest proves only integrity of host-supplied snapshots, not
    independent Core readback, original model inference or receipt authority.
    """
    evidence = _observation(observation)
    artifact = _parse(artifact_bytes, MAX_ARTIFACT_BYTES)
    config = _parse(config_bytes, MAX_CONFIG_BYTES)
    artifact_digest = _verify_record(
        artifact, digest_key="artifact_digest",
        contract=GRAPH_ARTIFACT_CONTRACT, obj_type="GraphNodeOutputArtifact",
    )
    config_digest = _verify_record(
        config, digest_key="config_digest",
        contract=GRAPH_CONFIG_CONTRACT, obj_type="GraphNodeConfig",
    )
    if (artifact.get("node_type") != "MODEL_INVOCATION"
            or config.get("node_type") != "MODEL_INVOCATION"
            or artifact.get("external_effect_performed") is not False
            or artifact.get("contains_credentials") is not False
            or config.get("contains_credentials") is not False
            or config.get("grants_execution_authority") is not False
            or artifact.get("config_digest") != config_digest
            or artifact.get("config_ref") !=
               "graph-node-config:" + str(config.get("config_id", "")) + ":" + config_digest):
        _fail("GRAPH_NODE_OR_CONFIG_LINK_MISMATCH")
    if observation["source_revision"] != artifact_digest:
        _fail("GRAPH_OBSERVATION_DIGEST_MISMATCH")
    meta = artifact.get("provider_meta")
    spec = config.get("spec")
    if type(meta) is not dict or type(spec) is not dict:
        _fail("MODEL_METADATA_OR_CONFIG_MISSING")
    if (type(meta.get("provider_id")) is not str
            or not meta["provider_id"] or len(meta["provider_id"]) > 128
            or type(meta.get("model")) is not str
            or not meta["model"] or len(meta["model"]) > 256
            or observation["provider_id"] != meta["provider_id"]
            or observation["model"] != meta["model"]):
        _fail("MODEL_PROVIDER_IDENTITY_MISMATCH")
    usage = meta.get("usage") or {}
    if type(usage) is not dict:
        _fail("USAGE_NOT_OBJECT")
    token_counts = {
        "input_tokens": _observed_count(usage.get("input_tokens"), 1_000_000_000),
        "output_tokens": _observed_count(usage.get("output_tokens"), 1_000_000_000),
        "latency_ms": _observed_count(meta.get("elapsed_ms"), 86_400_000),
    }
    if any(token_counts[k] != evidence[k] for k in token_counts):
        _fail("GRAPH_METRICS_DISAGREE")
    local = spec.get("local_model")
    if local is not None:
        if (type(local) is not dict or type(local.get("digest")) is not str
                or not HEX.fullmatch(local["digest"])
                or local.get("name") != meta["model"]
                or meta.get("model_digest") != local["digest"]):
            _fail("PINNED_MODEL_IDENTITY_MISMATCH")
        model_pin = local["digest"]
    else:
        model_pin = None

    refs = artifact.get("source_refs")
    if type(refs) is not list or len(refs) > 128 or any(
        type(item) is not str or not item or len(item) > 512 for item in refs
    ) or len(refs) != len(set(refs)):
        _fail("GRAPH_SOURCE_REFS_INVALID")
    binding = meta.get("binding_digest")
    if type(binding) is not str or HEX.fullmatch(binding) is None or "model-binding:" + binding not in refs:
        _fail("MODEL_BINDING_REF_MISSING")
    choice = spec.get("model_choice")
    # Model invocation projects the already-pinned choice into provider_meta.
    # A self-consistent artifact with a *different* reported choice is not
    # trustworthy evidence of the configuration that authorized execution.
    if meta.get("model_choice") != choice:
        _fail("MODEL_CHOICE_ARTIFACT_CONFIG_DISAGREE")
    config_receipts = (choice.get("owner_receipts")
                       if type(choice) is dict else None)
    if config_receipts is not None:
        if (type(config_receipts) is not dict
                or set(config_receipts) != {"k02", "k04"}
                or any(type(v) is not str or not re.fullmatch(
                    r"TXR-[A-Za-z0-9_-]{1,100}", v
                ) for v in config_receipts.values())):
            _fail("CONFIG_RECEIPTS_INVALID")
        if config_receipts["k02"] == config_receipts["k04"]:
            _fail("CONFIG_RECEIPTS_INVALID")
        if observation["owner_receipt_refs"] != config_receipts:
            _fail("OWNER_RECEIPT_OBSERVATION_MISMATCH")
        linked = all("tool-receipt:" + ref in refs
                     for ref in config_receipts.values())
        expected_provenance = "LINKED" if linked else "INCOMPLETE"
    else:
        linked = False
        expected_provenance = "NOT_RECORDED"
        if observation["owner_receipt_refs"]:
            _fail("UNEXPECTED_RECEIPT_OBSERVATION")
    has_metrics = any(x is not None for x in token_counts.values())
    expected_status = (
        "PROVENANCE_INCOMPLETE" if expected_provenance == "INCOMPLETE"
        else "OBSERVED" if has_metrics else "METRICS_UNAVAILABLE"
    )
    if (observation["provenance_status"] != expected_provenance
            or observation["status"] != expected_status):
        _fail("OBSERVATION_STATUS_DISAGREE")
    if type(choice) is dict:
        if choice.get("binding_digest") != binding:
            _fail("CHOICE_BINDING_DIGEST_DISAGREE")
        if choice.get("provider_id") != meta["provider_id"]:
            _fail("CHOICE_PROVIDER_IDENTITY_DISAGREE")
    return {
        "schema": CONTRACT,
        "status": "GRAPH_SNAPSHOT_LINKED" if linked
                  else "GRAPH_SNAPSHOT_OWNER_LINKS_NOT_VERIFIED",
        "artifact_sha256": artifact_digest,
        "config_sha256": config_digest,
        "pinned_model_digest": model_pin,
        "model_provider_sha256": hashlib.sha256(
            meta["provider_id"].encode("utf-8")).hexdigest(),
        "model_name_sha256": hashlib.sha256(meta["model"].encode("utf-8")).hexdigest(),
        "metric_values": token_counts,
        "owner_receipt_refs_status": expected_provenance,
        "artifact_bytes_rehashed": len(artifact_bytes) + len(config_bytes),
        "core_readback_verified": False,
        "live_model_inference_verified": False,
        "human_quality_gold": False,
    }


def compare_saved_graph_model_runs(
    baseline: dict, tested: dict, *,
    baseline_task_bytes: bytes, tested_task_bytes: bytes,
    baseline_result_bytes: bytes, tested_result_bytes: bytes,
    baseline_source_bytes: dict, tested_source_bytes: dict,
    baseline_artifact_bytes: bytes, tested_artifact_bytes: bytes,
    baseline_config_bytes: bytes, tested_config_bytes: bytes,
) -> dict:
    """Gate an existing processing comparison on two digest-bound Graph outputs.

    Does not promote host-provided bytes to independent Core readback or
    any asserted user benefit; detached/partial owner links block comparison.
    """
    old = verify_saved_graph_model_observation(
        baseline["model_observation"], artifact_bytes=baseline_artifact_bytes,
        config_bytes=baseline_config_bytes)
    new = verify_saved_graph_model_observation(
        tested["model_observation"], artifact_bytes=tested_artifact_bytes,
        config_bytes=tested_config_bytes)
    pair = compare_saved_model_runs(
        baseline, tested, baseline_task_bytes=baseline_task_bytes,
        tested_task_bytes=tested_task_bytes,
        baseline_result_bytes=baseline_result_bytes,
        tested_result_bytes=tested_result_bytes,
        baseline_source_bytes=baseline_source_bytes,
        tested_source_bytes=tested_source_bytes)
    reasons = list(pair["reasons"])
    if (old["status"] != "GRAPH_SNAPSHOT_LINKED"
            or new["status"] != "GRAPH_SNAPSHOT_LINKED"):
        reasons.append("OWNER_RECEIPTS_NOT_LINKED")
    for run, readback in ((baseline, old), (tested, new)):
        if (readback["pinned_model_digest"] is None
                or run["model_digest"] != readback["pinned_model_digest"]):
            reasons.append("MODEL_PIN_NOT_VERIFIED")
    reasons = list(dict.fromkeys(reasons))
    if reasons:
        pair["status"] = "NOT_COMPARABLE"
        pair["reasons"] = reasons
        pair["deltas"] = {key: None for key in pair["deltas"]}
    return {
        "schema": PAIR_CONTRACT,
        "status": pair["status"],
        "reasons": pair["reasons"],
        "processing": pair,
        "graph_snapshots": [old, new],
        "additional_artifact_bytes_rehashed": (
            old["artifact_bytes_rehashed"] + new["artifact_bytes_rehashed"]),
        "graph_core_readback": "NOT_TESTED",
        "actual_model_calls_by_k05": 0,
        "human_quality_improvement": "NOT_MEASURED",
    }
