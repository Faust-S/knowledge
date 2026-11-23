"""R1/R2: one ORIGINAL Mesa, independent prospective alternative trajectories.

A pure read-only comparison of outputs produced by the existing simulate()
function. This module never creates a Work, subject, authorization, payment,
resource reservation, state machine, economic fact or Mesa scheduler.

The same initial subjects, original Work declarations, source evidence and
economic-claim ledger must be reused verbatim across trial arms. Only
prospective events and explicitly owner-owned research preferences may vary.

A declared Work-scoped economic counterfactual is NOT realized revenue.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping


class TrajectoryComparisonError(ValueError):
    """Unmatched initial conditions cannot establish a scientific contrast."""


BASELINE_FIELDS = (
    "institution", "subjects", "resources", "works",
    "cooperation_links", "context_evidence", "economic_claims",
    "work_counterfactuals", "general_akis",
)
MAX_ARMS = 8


def _fingerprint(value: Any) -> str:
    try:
        serialized = json.dumps(
            value, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise TrajectoryComparisonError(
            "COMPARATIVE_NON_JSON_ORIGINAL_SOURCE"
        ) from exc
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def compare_original_trajectories(
    scenarios: Mapping[str, Mapping[str, Any]],
    outputs: Mapping[str, Mapping[str, Any]], *,
    pilot_work: str,
    next_work: str,
) -> dict[str, Any]:
    """Compare observed original Work outcomes, never infer economic profit.

    Scenario variants may differ only in independent original future event
    choices, research profiles and explicit shocks. Every original starting
    document, economic ledger and work-scope counterfactual remains identical.
    Unknown, not zero, is the answer to realized causal economic value.
    """
    if (not isinstance(scenarios, Mapping) or not isinstance(outputs, Mapping)
            or not 2 <= len(scenarios) <= MAX_ARMS
            or set(scenarios) != set(outputs)
            or not all(isinstance(name, str) and name and len(name) <= 96
                       for name in scenarios)):
        raise TrajectoryComparisonError(
            "COMPARATIVE_TWO_TO_EIGHT_MATCHED_TRAJECTORIES_REQUIRED"
        )
    if (not isinstance(pilot_work, str) or not pilot_work
            or not isinstance(next_work, str) or not next_work
            or pilot_work == next_work):
        raise TrajectoryComparisonError(
            "COMPARATIVE_DIFFERENT_ORIGINAL_WORKS_REQUIRED"
        )
    reference_sha = None
    pilot_signature = None
    per_trial_comparison_statuses: set[str] = set()
    rows: list[dict[str, Any]] = []
    for name in sorted(scenarios):
        scenario = scenarios[name]
        output = outputs[name]
        if not isinstance(scenario, Mapping) or not isinstance(output, Mapping):
            raise TrajectoryComparisonError(
                "COMPARATIVE_ORIGINAL_SCENARIO_OUTPUT_REQUIRED"
            )
        if any(key not in scenario for key in BASELINE_FIELDS):
            raise TrajectoryComparisonError(
                "COMPARATIVE_COMPLETE_BASELINE_DECLARATIONS_REQUIRED"
            )
        initial = {key: scenario[key] for key in BASELINE_FIELDS}
        fingerprint = _fingerprint(initial)
        if reference_sha is not None and reference_sha != fingerprint:
            raise TrajectoryComparisonError(
                "COMPARATIVE_BASELINE_OR_ECONOMIC_SOURCES_CHANGED"
            )
        reference_sha = fingerprint
        original = output.get("works")
        if (not isinstance(original, Mapping) or pilot_work not in original
                or next_work not in original):
            raise TrajectoryComparisonError(
                "COMPARATIVE_ACTUAL_ORIGINAL_WORK_MISSING"
            )
        pilot = original[pilot_work]
        successor = original[next_work]
        if pilot.get("result") != "ACCEPTED_BY_ORIGINAL_RECIPIENT":
            raise TrajectoryComparisonError(
                "COMPARATIVE_HISTORICAL_ACCEPTED_RESULT_REQUIRED"
            )
        historic = (
            pilot.get("result"), pilot.get("result_ref"),
            pilot.get("commitment_org_revision"),
            tuple(pilot.get("consenting_principals", ())),
        )
        if pilot_signature is not None and pilot_signature != historic:
            raise TrajectoryComparisonError(
                "COMPARATIVE_HISTORICAL_RESULT_CHANGED_BY_INTERVENTION"
            )
        pilot_signature = historic
        econ = output.get("work_counterfactual_dynamics")
        matches = (
            [w for w in econ.get("works", ())
             if w.get("work") == next_work]
            if isinstance(econ, Mapping) else []
        )
        if len(matches) != 1:
            raise TrajectoryComparisonError(
                "COMPARATIVE_SINGLE_ORIGINAL_WORK_COUNTERFACTUAL_REQUIRED"
            )
        candidate = matches[0]
        # Eligibility of the source-declared arithmetic MAY depend on the
        # actual outcome (e.g. an unaccepted Result can invalidate reuse).
        # Compare its original source inputs, not an outcome-derived status.
        per_trial_comparison_statuses.add(str(candidate.get("status")))
        if (candidate.get("period") != scenario["economic_claims"].get("period")
                or candidate.get("currency") !=
                    scenario["economic_claims"].get("currency")):
            raise TrajectoryComparisonError(
                "COMPARATIVE_ORIGINAL_CASH_PERIOD_OR_CURRENCY_CHANGED"
            )
        trace = output.get("trace")
        if not isinstance(trace, list):
            raise TrajectoryComparisonError("COMPARATIVE_ORIGINAL_TRACE_REQUIRED")
        current = [
            row for row in trace
            if row.get("work") == next_work
            and row.get("action") in {
                "offer", "authorize", "consent", "commit",
                "start", "complete", "accept", "reject",
            }
        ]
        rows.append({
            "trial": name,
            "original_next_work_result": successor.get("result"),
            "original_next_work_obligation": successor.get("obligation"),
            "original_next_work_execution": successor.get("execution"),
            "accepted_by_original_recipient": (
                successor.get("result") == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            ),
            "original_consents": sorted(successor.get("consenting_principals", ())),
            "actual_original_work_applied_actions": [
                row.get("action") for row in current
                if row.get("outcome") == "APPLIED"
            ],
            "blocked_original_work_actions": [
                {"action": row.get("action"), "reason": row.get("reason")}
                for row in current if row.get("outcome") == "BLOCKED"
            ],
            "original_declared_counterfactual_status": candidate.get("status"),
            "declared_work_cash_comparison_is_available": (
                candidate.get("network_declared_external_cash_difference")
                is not None
            ),
            "claimed_cash_is_not_work_execution": True,
            "declared_counterfactual_is_not_realized_gain": True,
            "observed_realized_cash_gain": None,
            "observed_causal_network_value": None,
        })
    reference_claims = next(iter(scenarios.values()))["economic_claims"]
    return {
        "schema": "AKIS_ORIGINAL_MULTI_TRAJECTORY_COMPARISON/1.0",
        "research_status": "ORIGINAL_WORK_MECHANISM_COMPARISON_ONLY",
        "model": "MESA_3_5_2_ONE_EXISTING_QUALITATIVE_AKIS",
        "original_baseline_fingerprint_sha256": reference_sha,
        "pilot_work": pilot_work,
        "next_work": next_work,
        "historical_pilot_result_unchanged": True,
        "comparison_currency": reference_claims["currency"],
        "comparison_period": reference_claims["period"],
        "source_declared_counterfactual_statuses": sorted(
            per_trial_comparison_statuses
        ),
        "source_declared_economic_inputs_held_constant": True,
        "source_declared_comparison_value_not_exposed": True,
        "independent_choices_create_no_automatic_original_consents": True,
        "realized_caused_network_gain": "NOT_IDENTIFIABLE",
        "actual_profit": "UNKNOWN",
        "economic_hypothesis_scientifically_proven": False,
        "trials": rows,
        "accepted_next_work_count": sum(
            row["accepted_by_original_recipient"] for row in rows
        ),
        "observed_divergent_work_results": (
            len({row["original_next_work_result"] for row in rows}) > 1
        ),
    }
