"""R3 read-only causal witness for three successive original Mesa Work cycles.

Consumes actual original Work/Result, agent observations and applied trace.
No Work, signature, role, identity, source, currency or event is introduced.
Only aggregate scientific categories leave the owner-private research view.
"""
from __future__ import annotations

from typing import Any, Mapping

WORK_SEQUENCE = ("w1", "w2", "w3")
ACCEPTED = "ACCEPTED_BY_ORIGINAL_RECIPIENT"


class MultiPeriodEvidenceError(ValueError):
    """The original Mesa trace cannot establish the proposed sequence."""


def original_three_period_evidence(
    output: Mapping[str, Any],
) -> dict[str, Any]:
    """Read actual transitions, never impute an absent period or payment."""
    if not isinstance(output, Mapping):
        raise MultiPeriodEvidenceError("R3_ORIGINAL_OUTPUT_REQUIRED")
    try:
        trace = output["trace"]
        works = output["works"]
        observations = output["decision_observations"]
        knowledge = output["general_akis_model"]["system_causal_cycle_feedback"]
        capacity = output["capability_dynamics"]
        profit = output["profit"]
    except (KeyError, TypeError) as exc:
        raise MultiPeriodEvidenceError("R3_ORIGINAL_EVIDENCE_MISSING") from exc
    if not isinstance(trace, list) or not isinstance(observations, list):
        raise MultiPeriodEvidenceError("R3_ORIGINAL_TRACE_REQUIRED")
    if profit.get("system_increment") != "UNKNOWN":
        raise MultiPeriodEvidenceError("R3_UNVERIFIED_REAL_PROFIT_NOT_ALLOWED")
    rows = []
    previous_accept_at = -1
    for work_id in WORK_SEQUENCE:
        work = works.get(work_id)
        request_events = [
            row for row in trace
            if row.get("action") == "request"
            and row.get("work") == work_id
            and row.get("outcome") == "APPLIED"
        ]
        accepted_events = [
            row for row in trace
            if row.get("action") == "accept"
            and row.get("work") == work_id
            and row.get("outcome") == "APPLIED"
        ]
        if len(request_events) > 1 or len(accepted_events) > 1:
            raise MultiPeriodEvidenceError("R3_DUPLICATE_ORIGINAL_WORK_EVENT")
        accepted = work is not None and work.get("result") == ACCEPTED
        if bool(accepted_events) != bool(accepted):
            raise MultiPeriodEvidenceError("R3_ACCEPTED_RESULT_NOT_IN_ORIGINAL_TRACE")
        if work_id in {"w1", "w2"} and not accepted:
            raise MultiPeriodEvidenceError("R3_PREVIOUS_ACTUAL_RESULT_REQUIRED")
        if accepted_events and (
            type(accepted_events[0].get("at")) is not int
            or accepted_events[0]["at"] <= previous_accept_at
        ):
            raise MultiPeriodEvidenceError("R3_ACCEPTED_RESULTS_NOT_CHRONOLOGICAL")
        if work_id != "w1" and request_events:
            if (type(request_events[0].get("at")) is not int
                    or request_events[0]["at"] <= previous_accept_at):
                raise MultiPeriodEvidenceError(
                    "R3_FUTURE_WORK_NOT_AFTER_PREVIOUS_ACCEPTED_RESULT"
                )
        if accepted_events:
            previous_accept_at = accepted_events[0]["at"]
        rows.append({
            "original_work": work_id,
            "original_request_applied": len(request_events) == 1,
            "original_result": work.get("result") if work is not None else "NOT_CREATED",
            "recipient_acceptance_applied": bool(accepted_events),
            "original_commit_applied": any(
                event.get("work") == work_id
                and event.get("action") == "commit"
                and event.get("outcome") == "APPLIED"
                for event in trace
            ),
        })
    if len(rows) != 3:
        raise MultiPeriodEvidenceError("R3_THREE_PERIODS_REQUIRED")
    third_observations = [
        row for row in observations
        if row.get("work") == "w3"
        and row.get("economic_position") in {
            "COOPERATION_PREFERRED", "OUTSIDE_PREFERRED", "UNKNOWN",
        }
    ]
    positions = sorted({row["economic_position"] for row in third_observations})
    reasons = sorted({
        row["economic_reason"] for row in third_observations
        if row.get("economic_reason")
    })
    return {
        "schema": "AKIS_R3_THREE_ORIGINAL_WORK_PERIODS_CAUSAL_VIEW/1.0",
        "engine": "ONE_ORIGINAL_MESA_3_5_2",
        "work_periods": rows,
        "third_period_owner_outlook_positions_model_only": positions,
        "third_period_owner_outlook_reasons_model_only": reasons,
        "original_owner_capability_adopted": (
            capacity.get("original_owner_adopted_count", 0) > 0
        ),
        "original_result_capability_cooperation_chain_witnessed": bool(
            knowledge.get(
                "same_original_causal_chain_includes_capability_and_institutional_change"
            )
        ),
        "previous_accepted_results_preserved": True,
        "owner_outlook_cannot_authorize_original_work": True,
        "original_cash_or_result_written_by_projection": False,
        "cash_or_source_identifiers_disclosed": False,
        "measured_incremental_network_value": "NOT_IDENTIFIABLE",
        "empirical_scientific_closure": False,
    }
