"""Read-only Agent 0.6 owner-port adapter for K05 effectiveness.

Requires the *installed* Agent TaskCell/ToolRuntime to perform their original
durable readback and artifact/receipt validation. Never reads a foreign Store,
bypasses Core validation, invokes tools or accesses model providers. This
module is public and contains no copied private Agent source or credentials.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from hashlib import sha256
import re

from k05_agent06_effectiveness import (
    K05EffectivenessHold, observe_run,
)

CONTRACT = "IWXA_K05_AGENT06_OWNER_READBACK/0.1"
EXECUTION_CONTRACT = "IWXA_K05_AGENT06_EXECUTION_RECEIPT_OBSERVATION/0.1"
AGENT_OBSERVATION = "IWXA_K05_AGENT06_VERIFIED_ACCEPTED_OBSERVATION/0.1"
HEX = re.compile(r"^[0-9a-f]{64}$")
TASK_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
EXEC_RECEIPT = re.compile(r"^TXR-[A-Za-z0-9_-]{1,100}$")


def _need(ok, code):
    if not ok:
        raise K05EffectivenessHold("K05_AGENT06_" + code)


def _hex(value):
    return type(value) is str and HEX.fullmatch(value) is not None


def _ref(value, kind, digest=None):
    _need(type(value) is dict and value.get("ref_kind") == kind and
          type(value.get("ref_id")) is str and bool(value["ref_id"]) and
          _hex(value.get("digest_sha256")) and
          value.get("digest_profile") == "IWXA_CANONICAL_JSON_SHA256_V1",
          "TYPED_REF_INVALID")
    if digest is not None:
        _need(value["digest_sha256"] == digest, "TYPED_REF_DIGEST_MISMATCH")
    return value["digest_sha256"]


def read_agent_accepted_task(task_cell, task_id: str) -> dict:
    """Use TaskCell.read_task/accepted_artifact/task_digest, never raw files.

    accepted_artifact() uses original Agent _verify_state_artifacts to check
    exact bound Review, Result, accepted artifact and Task state history.
    A rejected or still-open Task is not an accepted Result.
    """
    _need(type(task_id) is str and TASK_ID.fullmatch(task_id) is not None,
          "TASK_ID_INVALID")
    _need(all(callable(getattr(task_cell, method, None)) for method in (
        "read_task", "accepted_artifact", "task_digest",
    )), "TASK_OWNER_PORT_REQUIRED")
    row = task_cell.read_task(task_id)
    _need(type(row) is dict and type(row.get("task")) is dict and
          type(row.get("state")) is dict and row.get("task_path") is not None,
          "TASK_OWNER_READBACK_INVALID")
    task, state = row["task"], row["state"]
    _need(task.get("task_id") == task_id and state.get("task_id") == task_id,
          "TASK_IDENTITY_MISMATCH")
    actual_digest = task_cell.task_digest(row["task_path"])
    _need(_hex(actual_digest) and state.get("task_digest") == actual_digest,
          "TASK_DIGEST_MISMATCH")
    _need(state.get("status") == "closed" and
          state.get("accepted_artifact_ref") is not None,
          "TASK_NOT_ACCEPTED")
    result_ref, review_ref, accepted_ref = (
        state.get("result_ref"), state.get("review_ref"),
        state["accepted_artifact_ref"],
    )
    _ref(result_ref, "result")
    _ref(review_ref, "review")
    _ref(accepted_ref, "accepted_artifact")
    accepted = task_cell.accepted_artifact(task_id)
    _need(type(accepted) is dict and
          accepted.get("acceptance_kind") == "HUMAN_ACCEPTED_DRAFT" and
          accepted.get("artifact_digest") == accepted_ref["digest_sha256"] and
          accepted.get("accepted_artifact_id") == accepted_ref["ref_id"],
          "ACCEPTED_ARTIFACT_INVALID")
    task_ref = accepted.get("task_ref")
    _ref(task_ref, "task", actual_digest)
    _need(task_ref["ref_id"] == task_id and
          accepted.get("result_ref") == result_ref and
          accepted.get("review_ref") == review_ref,
          "ACCEPTED_ARTIFACT_RELATIONS_CHANGED")
    return {
        "schema": CONTRACT,
        "status": "HUMAN_ACCEPTED_DRAFT_OWNER_PORT",
        "task_sha256": actual_digest,
        "result_record_sha256": result_ref["digest_sha256"],
        "review_record_sha256": review_ref["digest_sha256"],
        "accepted_artifact_sha256": accepted_ref["digest_sha256"],
        "accepted_artifact_id_sha256": sha256(accepted_ref["ref_id"].encode()).hexdigest(),
        "task_result_identity": "AGENT_CANONICAL_JSON_SHA256",
        "graph_full_text_identity": "SEPARATE_NOT_VERIFIED",
        "external_effect_status": "NOT_VERIFIED",
        "owner_port_qualification": "HOST_SUPPLIED_ORIGINAL_CORE_READBACK",
    }


def observe_accepted_agent_run(
    run, *, task_cell, task_id, source_bytes, owner_verify,
) -> dict:
    """Gate K05 metrics against the actual TaskCell owner acceptance.

    Owner_verify must still revalidate individual metrics and source evidence.
    A graph full-text digest is NOT the result JSON digest. A later Graph
    observer can separately bind text using its original artifact verifier.
    """
    accepted = read_agent_accepted_task(task_cell, task_id)
    result = observe_run(run, source_bytes=source_bytes, owner_verify=owner_verify)
    _need(result["task_sha256"] == accepted["task_sha256"] and
          result["result_sha256"] == accepted["result_record_sha256"],
          "RUN_OWNER_TASK_RESULT_MISMATCH")
    _need(result["acceptance"] == "ACCEPTED",
          "RUN_ACCEPTANCE_NOT_VERIFIED")
    return {
        "schema": AGENT_OBSERVATION,
        "status": "ACCEPTED_DRAFT_SOURCE_BOUND",
        "task_witness": accepted,
        "effectiveness": result,
        "external_effect_status": "NOT_VERIFIED",
        "observational_only": True,
    }


def _date(value):
    _need(type(value) is str, "RECEIPT_TIME_INVALID")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise K05EffectivenessHold("K05_AGENT06_RECEIPT_TIME_INVALID") from exc
    _need(parsed.tzinfo is not None and parsed.utcoffset() is not None,
          "RECEIPT_TIME_INVALID")
    return parsed


def read_agent_execution_receipts(*, task_cell, task_id: str,
                                  tool_runtime, receipt_ids: list) -> dict:
    """Read original TXR/plan by ID; bind to same accepted Task and artifact.

    ToolRuntime.read_execution_receipt and read_execution_plan MUST be
    original validating owner methods. TRR has no Task binding and is not
    admitted here. No status proves the final business result was achieved.
    """
    accepted = read_agent_accepted_task(task_cell, task_id)
    _need(type(accepted) is dict and accepted.get("schema") == CONTRACT and
          accepted.get("status") == "HUMAN_ACCEPTED_DRAFT_OWNER_PORT" and
          _hex(accepted.get("task_sha256")) and
          _hex(accepted.get("accepted_artifact_sha256")),
          "ACCEPTED_OWNER_WITNESS_REQUIRED")
    _need(all(callable(getattr(tool_runtime, method, None)) for method in (
        "read_execution_receipt", "read_execution_plan"
    )), "TOOL_RUNTIME_PORT_REQUIRED")
    _need(type(receipt_ids) is list and len(receipt_ids) <= 128 and
          all(type(x) is str and EXEC_RECEIPT.fullmatch(x) for x in receipt_ids) and
          len(receipt_ids) == len(set(receipt_ids)),
          "RECEIPT_IDS_INVALID")
    counts = {"SUCCEEDED": 0, "FAILED": 0, "INPUT_REQUIRED": 0}
    effects = {"ACKNOWLEDGED": 0, "NONE": 0, "UNKNOWN": 0}
    idempotency_keys = set()
    durations = []
    for receipt_id in receipt_ids:
        receipt = tool_runtime.read_execution_receipt(receipt_id)
        _need(type(receipt) is dict and
              receipt.get("receipt_id") == receipt_id and
              receipt.get("status") in counts and
              receipt.get("external_effect_state") in effects,
              "EXECUTION_RECEIPT_INVALID")
        plan_id = receipt.get("plan_id")
        _need(type(plan_id) is str and
              re.fullmatch(r"TPLAN-[A-Za-z0-9_-]{1,100}", plan_id) is not None,
              "EXECUTION_PLAN_ID_INVALID")
        plan = tool_runtime.read_execution_plan(plan_id)
        _need(type(plan) is dict and plan.get("plan_id") == plan_id and
              _hex(plan.get("plan_digest")) and
              plan["plan_digest"] == receipt.get("plan_digest"),
              "EXECUTION_PLAN_DIGEST_MISMATCH")
        _ref(plan.get("task_ref"), "task", accepted["task_sha256"])
        _need(plan["task_ref"]["ref_id"] == task_id, "EXECUTION_TASK_ID_MISMATCH")
        _ref(plan.get("accepted_artifact_ref"), "accepted_artifact",
             accepted["accepted_artifact_sha256"])
        _need(sha256(plan["accepted_artifact_ref"]["ref_id"].encode()).hexdigest()
              == accepted["accepted_artifact_id_sha256"],
              "EXECUTION_ACCEPTED_ID_MISMATCH")
        for field in (
            "tool_id", "tool_descriptor_digest", "provider_slot",
            "provider_id", "provider_binding_digest", "idempotency_key",
        ):
            _need(plan.get(field) == receipt.get(field),
                  "EXECUTION_PLAN_RECEIPT_MISMATCH")
        _need(type(receipt.get("idempotency_key")) is str and
              bool(receipt["idempotency_key"]),
              "RECEIPT_IDEMPOTENCY_INVALID")
        idempotency_keys.add(receipt["idempotency_key"])
        start, end = _date(receipt.get("started_at")), _date(receipt.get("finished_at"))
        delta = end - start
        elapsed_us = delta.days * 86400000000 + delta.seconds * 1000000 + delta.microseconds
        _need(0 <= elapsed_us <= 86400000000, "RECEIPT_TIME_ORDER_INVALID")
        durations.append(elapsed_us)
        counts[receipt["status"]] += 1
        effects[receipt["external_effect_state"]] += 1
    return {
        "schema": EXECUTION_CONTRACT,
        "status": "OWNER_READBACK_RECEIPTS_LINKED",
        "receipt_count": len(receipt_ids),
        "succeeded": counts["SUCCEEDED"],
        "failed": counts["FAILED"],
        "input_required": counts["INPUT_REQUIRED"],
        "effect_acknowledged": effects["ACKNOWLEDGED"],
        "effect_none": effects["NONE"],
        "effect_unknown": effects["UNKNOWN"],
        "retry_receipt_count": len(receipt_ids) - len(idempotency_keys),
        "sum_receipt_duration_us": sum(durations),
        "sum_receipt_duration_ms": str(Decimal(sum(durations)) / Decimal(1000)),
        "end_to_end_duration_ms": None,
        "accepted_business_result": "NOT_VERIFIED",
        "raw_arguments_shared": False,
    }
