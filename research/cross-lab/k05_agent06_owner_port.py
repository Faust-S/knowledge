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
from k05_agent06_admission import compare_verified_task_runs

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
    # Record state identity BEFORE the original Core acceptance readback.
    # An owner may advance its state chain between these two calls.
    first_state_digest = state.get("state_digest")
    _need(_hex(first_state_digest), "TASK_STATE_DIGEST_INVALID")
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
    # Atomicity of two separate owner reads is NOT assumed. Recheck the
    # original TaskCell state digest and canonical Task record after Core
    # validated the accepted artifact, with no write or lock bypass.
    fresh = task_cell.read_task(task_id)
    _need(type(fresh) is dict and type(fresh.get("state")) is dict
          and type(fresh.get("task")) is dict
          and str(fresh.get("task_path")) == str(row["task_path"])
          and fresh["task"].get("task_id") == task_id
          and fresh["state"].get("status") == "closed"
          and fresh["state"].get("state_digest") == first_state_digest
          and fresh["state"].get("accepted_artifact_ref") == accepted_ref
          and fresh["state"].get("result_ref") == result_ref
          and fresh["state"].get("review_ref") == review_ref
          and task_cell.task_digest(fresh["task_path"]) == actual_digest,
          "TASK_CHANGED_DURING_OWNER_READBACK")
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


def _human_accepted_candidate_keys(task_cell, task_id, witness):
    """Original TaskCell verifies AcceptedArtifact + accepted action refs.

    ToolRuntime._accepted_candidate performs the same admission before
    execution. K05 must enforce it again on historical read-only evidence:
    a foreign or unaccepted candidate must not count toward Task efficiency.
    Do not export candidate IDs, names, arguments or raw source records.
    """
    accepted = task_cell.accepted_artifact(task_id)
    _need(type(accepted) is dict
          and accepted.get("acceptance_kind") == "HUMAN_ACCEPTED_DRAFT"
          and accepted.get("artifact_digest") == witness["accepted_artifact_sha256"]
          and type(accepted.get("accepted_artifact_id")) is str
          and sha256(accepted["accepted_artifact_id"].encode()).hexdigest()
              == witness["accepted_artifact_id_sha256"]
          and type(accepted.get("action_candidate_refs")) is list,
          "HUMAN_ACCEPTED_CANDIDATE_OWNER_REQUIRED")
    keys = set()
    for candidate in accepted["action_candidate_refs"]:
        _ref(candidate, "action_candidate")
        identity = (candidate["ref_id"], candidate["digest_sha256"])
        _need(identity not in keys, "DUPLICATE_HUMAN_ACCEPTED_CANDIDATE")
        keys.add(identity)
    return keys


def _require_accepted_execution_candidate(plan, accepted_keys):
    candidate = plan.get("candidate_ref")
    _ref(candidate, "action_candidate")
    _need((candidate["ref_id"], candidate["digest_sha256"]) in accepted_keys,
          "EXECUTION_CANDIDATE_NOT_HUMAN_ACCEPTED")


def _original_receipt_plan(tool_runtime, receipt_id: str) -> tuple[dict, dict]:
    """Require original Agent ToolExecution V1, never legacy TXR 0.12.

    The original ToolRuntime.read_execution_receipt validates receipt schema
    and digest; read_execution_plan validates original plan schema and digest.
    K05 only checks cross-record identity and owner-reported classification.
    """
    receipt = tool_runtime.read_execution_receipt(receipt_id)
    _need(type(receipt) is dict and receipt.get("receipt_id") == receipt_id
          and receipt.get("schema_version") == "1.0.0"
          and receipt.get("execution_contract") == "PA.CONTRACT.TOOL_EXECUTION@1.0.0"
          and _hex(receipt.get("receipt_digest")),
          "EXECUTION_RECEIPT_INVALID")
    plan_ref = receipt.get("plan_ref")
    _need(type(plan_ref) is dict and set(plan_ref) == {
        "kind", "ref_id", "digest_sha256",
    } and plan_ref.get("kind") == "tool_execution_plan"
          and type(plan_ref.get("ref_id")) is str
          and re.fullmatch(r"TPLAN-[A-Za-z0-9_-]{1,100}",
                           plan_ref["ref_id"]) is not None
          and _hex(plan_ref.get("digest_sha256")),
          "EXECUTION_PLAN_REF_INVALID")
    plan = tool_runtime.read_execution_plan(plan_ref["ref_id"])
    _need(type(plan) is dict and plan.get("plan_id") == plan_ref["ref_id"]
          and plan.get("schema_version") == "1.0.0"
          and plan.get("plan_contract") == "PA.CONTRACT.TOOL_PLANNING@1.0.0"
          and _hex(plan.get("plan_digest"))
          and plan_ref["digest_sha256"] == plan["plan_digest"],
          "EXECUTION_PLAN_DIGEST_MISMATCH")
    _ref(receipt.get("approval_ref"), "approval")
    for key in ("tool_id", "tool_descriptor_digest", "provider_slot",
                "provider_id", "provider_binding_digest", "idempotency_key"):
        _need(plan.get(key) == receipt.get(key),
              "EXECUTION_PLAN_RECEIPT_MISMATCH")
    _need(type(receipt.get("idempotency_key")) is str
          and re.fullmatch(r"IWXA-TIDK-[0-9a-f]{40}",
                           receipt["idempotency_key"]) is not None,
          "RECEIPT_IDEMPOTENCY_INVALID")
    status, effect, contract_state = (
        receipt.get("status"), receipt.get("external_effect_state"),
        receipt.get("contract_state"),
    )
    _need(status in {"SUCCEEDED", "FAILED", "INPUT_REQUIRED"}
          and effect in {"ACKNOWLEDGED", "NONE", "UNKNOWN"}
          and contract_state in {
              "SUCCEEDED", "FAILED_KNOWN",
              "UNKNOWN_RECONCILIATION_REQUIRED",
          }, "EXECUTION_RECEIPT_INVALID")
    expected_state = (
        "UNKNOWN_RECONCILIATION_REQUIRED" if effect == "UNKNOWN" else
        "FAILED_KNOWN" if status == "FAILED" else "SUCCEEDED"
    )
    _need(contract_state == expected_state,
          "EXECUTION_STATE_INCONSISTENT")
    return receipt, plan


def read_agent_execution_receipts(*, task_cell, task_id: str,
                                  tool_runtime, receipt_ids: list) -> dict:
    """Read original ToolExecution V1 receipt/plan by exact durable ID.

    This compatibility gate does not claim receipt_ids contain the *complete*
    Task history. Prefer read_agent_task_execution_history() for monitoring.
    TRR read receipts are not admitted as task-bound execution receipts.
    """
    accepted = read_agent_accepted_task(task_cell, task_id)
    allowed_candidates = _human_accepted_candidate_keys(task_cell, task_id, accepted)
    _need(all(callable(getattr(tool_runtime, m, None)) for m in (
        "read_execution_receipt", "read_execution_plan",
    )), "TOOL_RUNTIME_PORT_REQUIRED")
    _need(type(receipt_ids) is list and len(receipt_ids) <= 128
          and all(type(x) is str and EXEC_RECEIPT.fullmatch(x)
                  for x in receipt_ids)
          and len(receipt_ids) == len(set(receipt_ids)),
          "RECEIPT_IDS_INVALID")
    counts = {"SUCCEEDED": 0, "FAILED": 0, "INPUT_REQUIRED": 0}
    effects = {"ACKNOWLEDGED": 0, "NONE": 0, "UNKNOWN": 0}
    contract_states = {"SUCCEEDED": 0, "FAILED_KNOWN": 0,
                       "UNKNOWN_RECONCILIATION_REQUIRED": 0}
    keys = set()
    durations_us = []
    for rid in receipt_ids:
        receipt, plan = _original_receipt_plan(tool_runtime, rid)
        _require_accepted_execution_candidate(plan, allowed_candidates)
        _ref(plan.get("task_ref"), "task", accepted["task_sha256"])
        _need(plan["task_ref"]["ref_id"] == task_id,
              "EXECUTION_TASK_ID_MISMATCH")
        _ref(plan.get("accepted_artifact_ref"), "accepted_artifact",
             accepted["accepted_artifact_sha256"])
        _need(sha256(plan["accepted_artifact_ref"]["ref_id"].encode()).hexdigest()
              == accepted["accepted_artifact_id_sha256"],
              "EXECUTION_ACCEPTED_ID_MISMATCH")
        start, end = _date(receipt.get("started_at")), _date(
            receipt.get("finished_at"))
        delta = end - start
        elapsed_us = (delta.days * 86400000000 +
                      delta.seconds * 1000000 + delta.microseconds)
        _need(0 <= elapsed_us <= 86400000000,
              "RECEIPT_TIME_ORDER_INVALID")
        durations_us.append(elapsed_us)
        counts[receipt["status"]] += 1
        effects[receipt["external_effect_state"]] += 1
        contract_states[receipt["contract_state"]] += 1
        keys.add(receipt["idempotency_key"])
    final_task = read_agent_accepted_task(task_cell, task_id)
    _need(all(final_task[key] == accepted[key] for key in (
        "task_sha256", "result_record_sha256", "review_record_sha256",
        "accepted_artifact_sha256", "accepted_artifact_id_sha256",
    )), "TASK_CHANGED_DURING_RECEIPT_READBACK")
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
        "contract_succeeded": contract_states["SUCCEEDED"],
        "contract_failed_known": contract_states["FAILED_KNOWN"],
        "contract_outcome_unknown": contract_states["UNKNOWN_RECONCILIATION_REQUIRED"],
        # Repeated idempotency keys are not proof of a repeated invocation.
        "same_idempotency_key_additional_receipts": (
            len(receipt_ids) - len(keys)),
        "retry_count": None,
        "retry_status": "UNKNOWN_WITHOUT_ORIGINAL_ATTEMPT_EVIDENCE",
        "sum_receipt_duration_us": sum(durations_us),
        "sum_receipt_duration_ms": str(
            Decimal(sum(durations_us)) / Decimal(1000)),
        "end_to_end_duration_ms": None,
        "accepted_business_result": "NOT_VERIFIED",
        "raw_arguments_shared": False,
        "receipt_list_completeness": "NOT_ATTESTED_USE_TASK_EXECUTION_HISTORY",
    }



APPROVAL_CONTRACT = "PA.K05.HISTORICAL_EXECUTION_APPROVAL/0.1.0"


def _historical_execution_approvals(tool_runtime, receipts: list,
                                    *, require_owner: bool) -> dict:
    """Original Agent owner extension, not a new K05 approval system.

    The installed ToolRuntime must re-read immutable ApprovalCell records and
    compare scope, plan, revocation timing, and receipt's execution start.
    An absent owner extension stays UNKNOWN. No current execution authority
    is ever inferred from historical approval validity.
    """
    owner = getattr(tool_runtime, "read_historical_execution_approval", None)
    if owner is None or not callable(owner):
        _need(not require_owner, "HISTORICAL_APPROVAL_OWNER_PORT_REQUIRED")
        return {
            "status": "NOT_VERIFIED_OWNER_PORT_UNAVAILABLE",
            "owner_verified_receipts": 0,
            "historical_approval_current_authority": False,
            "no_provider_reinvocation": True,
        }
    verified = 0
    revoked_later = 0
    rejected_later = 0
    for receipt in receipts:
        original = owner(receipt["receipt_id"])
        pref = receipt["plan_ref"]
        aref = receipt["approval_ref"]
        _need(type(original) is dict and
              original.get("contract") == APPROVAL_CONTRACT and
              original.get("status") == "HISTORICAL_APPROVAL_BOUND" and
              original.get("receipt_id") == receipt["receipt_id"] and
              original.get("receipt_digest") == receipt["receipt_digest"] and
              original.get("plan_id") == pref["ref_id"] and
              original.get("plan_digest") == pref["digest_sha256"] and
              original.get("approval_id") == aref["ref_id"] and
              original.get("approval_digest") == aref["digest_sha256"] and
              original.get("historically_valid") is True and
              original.get("current_execution_authority") is False and
              original.get("provider_invoked") is False and
              original.get("read_only") is True and
              type(original.get("revoked_after_execution")) is bool and
              type(original.get("rejected_after_execution")) is bool,
              "HISTORICAL_APPROVAL_OWNER_PROOF_MISMATCH")
        verified += 1
        revoked_later += int(original["revoked_after_execution"])
        rejected_later += int(original["rejected_after_execution"])
    return {
        "status": ("OWNER_HISTORICAL_APPROVALS_VERIFIED" if receipts
                   else "NO_EXECUTION_RECEIPTS"),
        "owner_verified_receipts": verified,
        "revoked_after_execution_count": revoked_later,
        "rejected_after_execution_count": rejected_later,
        "historical_approval_current_authority": False,
        "no_provider_reinvocation": True,
    }


HISTORY_CONTRACT = "IWXA_K05_AGENT06_TASK_TOOL_EXECUTION_HISTORY/0.1"


def _history_identity(plans: list, receipts: list) -> tuple[tuple, tuple]:
    """Check owner snapshots for duplicate IDs and stable identity/digests."""
    _need(type(plans) is list and type(receipts) is list
          and len(plans) <= 128 and len(receipts) <= 128,
          "TASK_EXECUTION_HISTORY_SIZE_INVALID")
    for row, identity, digest in (
        (plans, "plan_id", "plan_digest"),
        (receipts, "receipt_id", "receipt_digest"),
    ):
        _need(all(type(p) is dict and type(p.get(identity)) is str
                  and _hex(p.get(digest)) for p in row)
              and len({p[identity] for p in row}) == len(row),
              "TASK_EXECUTION_HISTORY_IDENTITY_INVALID")
    return (
        tuple(sorted((p["plan_id"], p["plan_digest"]) for p in plans)),
        tuple(sorted((r["receipt_id"], r["receipt_digest"]) for r in receipts)),
    )


def read_agent_task_execution_history(*, task_cell, task_id: str,
                                      tool_runtime,
                                      require_historical_approval: bool = False) -> dict:
    """Use original Agent ToolRuntime.task_execution_history (no manual TXR IDs).

    Original history owner searches the whole Task history rather than a
    recent N-row global list. Original execution_states_for_plans detects
    durable orphan intents/outcome uncertainty where no TXR was returned.
    K05 performs two readbacks and holds on change, without writing anything.
    """
    _need(type(require_historical_approval) is bool,
          "HISTORICAL_APPROVAL_FLAG_INVALID")
    accepted = read_agent_accepted_task(task_cell, task_id)
    allowed_candidates = _human_accepted_candidate_keys(task_cell, task_id, accepted)
    _need(all(callable(getattr(tool_runtime, method, None)) for method in (
        "task_execution_history", "execution_states_for_plans",
        "read_execution_receipt", "read_execution_plan",
    )), "TOOL_HISTORY_OWNER_PORT_REQUIRED")
    initial = tool_runtime.task_execution_history(task_id,
                                                   accepted["task_sha256"])
    _need(type(initial) is tuple and len(initial) == 2,
          "TASK_EXECUTION_HISTORY_SHAPE_INVALID")
    plans, receipts = initial
    initial_key = _history_identity(plans, receipts)
    plan_ids = set()
    for plan in plans:
        plan_id = plan["plan_id"]
        _require_accepted_execution_candidate(plan, allowed_candidates)
        _need(re.fullmatch(r"TPLAN-[A-Za-z0-9_-]{1,100}", plan_id) is not None,
              "TASK_HISTORY_PLAN_ID_INVALID")
        _need(plan.get("plan_contract") == "PA.CONTRACT.TOOL_PLANNING@1.0.0"
              and plan.get("schema_version") == "1.0.0",
              "TASK_HISTORY_PLAN_CONTRACT_INVALID")
        _ref(plan.get("task_ref"), "task", accepted["task_sha256"])
        _need(plan["task_ref"]["ref_id"] == task_id,
              "TASK_HISTORY_PLAN_FOREIGN_TASK")
        _ref(plan.get("accepted_artifact_ref"), "accepted_artifact",
             accepted["accepted_artifact_sha256"])
        _need(sha256(plan["accepted_artifact_ref"]["ref_id"].encode()).hexdigest()
              == accepted["accepted_artifact_id_sha256"],
              "TASK_HISTORY_PLAN_FOREIGN_ACCEPTED_ARTIFACT")
        current = tool_runtime.read_execution_plan(plan_id)
        _need(current == plan, "TASK_EXECUTION_PLAN_CHANGED_DURING_READBACK")
        plan_ids.add(plan_id)
    for receipt in receipts:
        pref = receipt.get("plan_ref")
        _need(type(pref) is dict and pref.get("kind") == "tool_execution_plan"
              and pref.get("ref_id") in plan_ids,
              "TASK_HISTORY_RECEIPT_FOREIGN_PLAN")
        current = tool_runtime.read_execution_receipt(receipt["receipt_id"])
        _need(current == receipt,
              "TASK_EXECUTION_RECEIPT_CHANGED_DURING_READBACK")
    receipt_projection = read_agent_execution_receipts(
        task_cell=task_cell, task_id=task_id,
        tool_runtime=tool_runtime,
        receipt_ids=[r["receipt_id"] for r in receipts])
    historical_approval = _historical_execution_approvals(
        tool_runtime, receipts, require_owner=require_historical_approval)
    states = tool_runtime.execution_states_for_plans(plans)
    _need(type(states) is dict and set(states) == plan_ids,
          "TASK_HISTORY_STATES_MISSING")
    counts = {"SUCCEEDED": 0, "ATTEMPTED": 0,
              "OUTCOME_UNKNOWN": 0, "NOT_STARTED": 0}
    by_id = {r["receipt_id"]: r for r in receipts}
    by_plan = {p["plan_id"]: p for p in plans}
    for pid, status in states.items():
        _need(type(status) is dict
              and status.get("state") in counts
              and (status.get("receipt_id") is None
                   or status["receipt_id"] in by_id),
              "TASK_HISTORY_STATE_INVALID")
        state = status["state"]
        plan = by_plan[pid]
        same_key = [r for r in receipts
                    if r.get("idempotency_key") == plan["idempotency_key"]]
        selected = status.get("receipt_id")
        _need(selected is None or
              by_id[selected].get("idempotency_key") == plan["idempotency_key"],
              "TASK_HISTORY_STATE_FOREIGN_RECEIPT")
        _need(not (state == "NOT_STARTED" and same_key)
              and not (state == "ATTEMPTED" and not same_key)
              and not (state == "SUCCEEDED" and not any(
                  r.get("status") == "SUCCEEDED" for r in same_key)),
              "TASK_HISTORY_STATE_CONTRADICTS_RECEIPTS")
        # Unknown state may have no receipt when durable intent exists.
        counts[state] += 1
    later = tool_runtime.task_execution_history(task_id,
                                                 accepted["task_sha256"])
    _need(type(later) is tuple and len(later) == 2
          and _history_identity(*later) == initial_key,
          "TASK_EXECUTION_HISTORY_CHANGED_DURING_READBACK")
    final_states = tool_runtime.execution_states_for_plans(later[0])
    _need(final_states == states, "TASK_EXECUTION_INTENT_STATE_CHANGED")
    # Historical decisions and revocations may change independently of TXR
    # history. Recheck the original owner projection before returning.
    confirmed_again = _historical_execution_approvals(
        tool_runtime, later[1], require_owner=require_historical_approval)
    _need(confirmed_again == historical_approval,
          "HISTORICAL_APPROVAL_CHANGED_DURING_READBACK")
    stable = read_agent_accepted_task(task_cell, task_id)
    _need(all(stable[key] == accepted[key] for key in (
        "task_sha256", "result_record_sha256", "review_record_sha256",
        "accepted_artifact_sha256", "accepted_artifact_id_sha256",
    )), "TASK_CHANGED_DURING_HISTORY_READBACK")
    return {
        "schema": HISTORY_CONTRACT,
        "status": "OWNER_HISTORY_STABLE_READBACK_NOT_COLD_VERIFIED",
        "plan_count": len(plans),
        "execution_receipts": receipt_projection,
        "historical_approvals": historical_approval,
        "plan_states": {k.lower(): v for k, v in counts.items()},
        "uncertain_execution_plan_count": counts["OUTCOME_UNKNOWN"],
        "receipt_list_completeness": "FULL_OWNER_TASK_HISTORY_SNAPSHOT",
        "snapshot_atomicity": "NOT_ATTESTED",
        "cold_restart_readback": "NOT_TESTED",
        "human_accepted_draft": True,
        "business_effect_verified": False,
        "read_only": True,
    }


def compare_two_agent_accepted_task_instances(
    baseline_run: dict, alternative_run: dict, *,
    task_cell, baseline_task_id: str, alternative_task_id: str,
    source_bytes, owner_verify, task_equivalence_evidence: dict | None,
) -> dict:
    """One read-only installed Agent consumer path for two original Tasks.

    The installed owner must supply exact, independent Task evidence; K05
    never creates Tasks, reuses foreign IDs, grants execution or ranks prose.
    Unlike mock tests, the real TaskCell validates the immutable owner chain.
    """
    _need(type(baseline_task_id) is str and type(alternative_task_id) is str
          and baseline_task_id != alternative_task_id,
          "TWO_DISTINCT_TASK_IDS_REQUIRED")
    first = observe_accepted_agent_run(
        baseline_run, task_cell=task_cell, task_id=baseline_task_id,
        source_bytes=source_bytes, owner_verify=owner_verify)
    second = observe_accepted_agent_run(
        alternative_run, task_cell=task_cell, task_id=alternative_task_id,
        source_bytes=source_bytes, owner_verify=owner_verify)
    pair = compare_verified_task_runs(
        baseline_run, alternative_run, source_bytes=source_bytes,
        owner_verify=owner_verify,
        task_equivalence_evidence=task_equivalence_evidence)
    # Completion and acceptance of each Task have been checked by original
    # TaskCell, but the equivalence certificate is still owner-attested.
    return {
        "schema": "IWXA_K05_AGENT06_TWO_ACCEPTED_TASK_INSTANCES/0.1",
        "status": (
            "TWO_ACCEPTED_TASKS_SOURCE_COMPARABLE"
            if pair["accepted_result_comparison_status"] ==
            "TWO_HUMAN_OR_DOMAIN_ACCEPTED_RESULTS"
            else "TWO_ACCEPTED_TASKS_NOT_COMPARABLE"
        ),
        "baseline_witness": first["task_witness"],
        "alternative_witness": second["task_witness"],
        "comparison": pair,
        "installed_agent_qualification": "NOT_TESTED_WITH_ORIGINAL_AGENT",
        "effects_readback": "NOT_VERIFIED",
        "causal_effect": "NOT_MEASURABLE",
    }
