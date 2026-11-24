"""Read bounded causal observations from actual native Mesa Result traces.

This projector has no execution, authority, capacity or financial effects.
The native clock, scope and economic claims are intentionally not equated
with browser days, stage release or modeled cash expenses.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping


SCHEMA = "IWXA_AKIS_R1W2G_ASSURANCE_CAUSAL_PARITY/0.1"


def _trace_row(snapshot, labels, key):
    return snapshot["trace"][labels[key]]


def _blocked(snapshot, labels, key):
    return _trace_row(snapshot, labels, key)["outcome"] == "BLOCKED"


def _accepted(snapshot, labels):
    work = snapshot["works"]["w1"]
    event = _trace_row(snapshot, labels, "accept_original")
    return (work["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            and event["outcome"] == "APPLIED"
            and event["actor"] == work["original_customer"])


def _one_work(snapshot):
    return (list(snapshot["works"]) == ["w1"]
            and all(row["work"] == "w1" for row in snapshot["capacity"]["reservations"]))


def project_native_r1w2g(
    reassessment: Mapping[str, Any], reexecution: Mapping[str, Any],
    labels_reassessment: Mapping[str, int], labels_reexecution: Mapping[str, int],
) -> dict[str, Any]:
    r, p = reassessment, reexecution
    lr, lp = labels_reassessment, labels_reexecution
    rw, pw = r["works"]["w1"], p["works"]["w1"]
    ra, pa = rw["assurance"], pw["assurance"]
    h, acts = ra["assessment_history"], pa["assessment_history"]
    negative, updated = h[1], h[-1]
    change = updated.get("reassessment", {})
    review_attempts = ra["physical_corrections"]
    r_common = {
        "negative_blocks_acceptance": _blocked(r, lr, "accept_negative"),
        "unqualified_overwrite_blocked": _blocked(r, lr, "overwrite"),
        "prior_negative_act_preserved": (
            negative["verdict"] == "DOES_NOT_MEET" and
            change.get("of") == negative["model_ref"]),
        "same_execution_anchor": (
            rw["result_ref"] == negative["result_ref"] == updated["result_ref"]
            and len(r["capacity"]["reservations"]) == 2
            and sum(row["action"] == "complete_operation" and row["outcome"] == "APPLIED"
                    for row in r["trace"]) == 2
            and not any(row["action"] == "resubmit" and row["outcome"] == "APPLIED"
                        for row in r["trace"])),
        "distinct_error_and_new_act": (
            change.get("physical_reexecution") is False
            and len({negative["model_ref"], change.get("error_ref"),
                     updated["model_ref"]}) == 3),
        "assessment_count": len(h),
        "physical_attempt_count": len(review_attempts),
        "additional_resource_amounts_rub": [
            int(Decimal(row["additional_resource_use_claim"]["amount"]))
            for row in review_attempts if row.get("additional_resource_use_claim")],
        "one_original_work": _one_work(r),
        "wrong_recipient_blocked": _blocked(r, lr, "accept_wrong"),
        "accepted_by_original_recipient": _accepted(r, lr),
    }

    rows = [row for row in pa["physical_corrections"] if row["status"] == "RESUBMITTED"]
    required = {c["criterion"] for c in pa["criteria"]}
    claims = [row["additional_resource_use_claim"] for row in rows]
    def assessments(row):
        return [act for act in acts if act.get("physical_correction_id") == row["terms"]["id"]]

    p_common = {
        "negative_blocks_acceptance": _blocked(p, lp, "accept_negative"),
        "application_without_all_votes_blocked": all(
            _blocked(p, lp, f"early_apply_{i}") for i in range(1, len(rows)+1)),
        "all_independent_votes_before_application": all(
            set(row["votes"]) == set(row["terms"]["required"])
            and all(vote["decision"] == "SUPPORT"
                    and vote["source_ref"].startswith(f"model://{owner}/")
                    and row["created_at"] < vote["at"] < row["applied_at"]
                    for owner, vote in row["votes"].items())
            for row in rows),
        "additional_resource_claim_absent_at_application": all(
            _trace_row(p, lp, f"apply_{i}")["quality_correction_additional_resource_use_claim"] is None
            for i in range(1, len(rows)+1)),
        "execution_before_fresh_assessment": all(
            row["applied_at"] < row["started_at"] < row["completed_at"]
            < row["resubmitted_at"]
            and all(act["at"] > row["resubmitted_at"]
                    and act["result_ref"] == row["resubmitted_result_ref"]
                    for act in assessments(row))
            for row in rows),
        "all_original_criteria_reassessed": all(
            {act["criterion"] for act in assessments(row)} == required for row in rows),
        "acceptance_before_fresh_review_blocked": all(
            _blocked(p, lp, f"accept_missing_{i}")
            and _blocked(p, lp, f"accept_partial_{i}") for i in range(1, len(rows)+1)),
        "previous_negative_acts_preserved": sum(
            act["verdict"] == "DOES_NOT_MEET" for act in acts) == 2,
        "assessment_count": len(acts), "physical_attempt_count": len(rows),
        "additional_resource_amounts_rub": [int(Decimal(c["amount"])) for c in claims],
        "distinct_resource_occurrence_per_attempt": (
            len({c["source_ref"] for c in claims}) == len(rows)
            and all(sum(event["action"] == "quality_correction_start"
                        and event["outcome"] == "APPLIED"
                        and event.get("quality_correction_id") == row["terms"]["id"]
                        for event in p["trace"]) == 1 for row in rows)),
        "original_responsibility_preserved": all(
            c["responsible_original_owner"] == c["effective_future_execution_owner"] == row["terms"]["owner"]
            and c["assessor_original_recipient"] == pw["original_customer"]
            for c in pa["criteria"] for row in rows),
        "one_original_work": _one_work(p),
        "wrong_recipient_blocked": _blocked(p, lp, "accept_wrong"),
        "accepted_by_original_recipient": _accepted(p, lp),
    }
    return {"common": {"reassessment": r_common, "reexecution": p_common},
            "boundary": {
                "execution_scope": "TERMINAL_OPERATION_AFTER_SUBMITTED_RESULT",
                "currency_semantics": "DECLARED_NONCASH_RESOURCE_USE_CLAIM",
                "actual_principal_counts": [len(row["terms"]["required"]) for row in rows],
                "physical_review_windows": [[row["terms"]["start"], row["terms"]["end"]]
                                            for row in rows],
                "bank_payment_proved": any(c["bank_payment_proved"] for c in claims),
            }}
