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
# An original operator Work is valid without a declared cooperative link.
OPTIONAL_ORIGINAL_FIELDS = {"cooperation_links"}
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
        if any(
            key not in scenario
            for key in BASELINE_FIELDS
            if key not in OPTIONAL_ORIGINAL_FIELDS
        ):
            raise TrajectoryComparisonError(
                "COMPARATIVE_COMPLETE_BASELINE_DECLARATIONS_REQUIRED"
            )
        initial = {
            key: scenario.get(key, []) if key in OPTIONAL_ORIGINAL_FIELDS
            else scenario[key]
            for key in BASELINE_FIELDS
        }
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
        accepted = successor.get("result") == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        accepted_events = [
            row for row in current
            if row.get("action") == "accept"
            and row.get("outcome") == "APPLIED"
        ]
        if bool(accepted_events) != accepted or len(accepted_events) > 1:
            raise TrajectoryComparisonError(
                "COMPARATIVE_ACCEPTED_RESULT_LACKS_ORIGINAL_EVENT_PROOF"
            )
        if output.get("profit", {}).get("system_increment") != "UNKNOWN":
            raise TrajectoryComparisonError(
                "COMPARATIVE_UNOBSERVED_NETWORK_PROFIT_MUST_REMAIN_UNKNOWN"
            )
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


# R2/R4: compare two independently EXECUTED original Work routes, rather
# than interpreting a projected alternative in a single run as execution.
# This is a research reader of the original Mesa and original economic
# projections, not a second executor, monetary ledger, IAM or optimizer.

def compare_executed_original_routes(
    scenarios: Mapping[str, Mapping[str, Any]], *,
    cooperative_work: str, outside_work: str, relation: str,
    prior_works: tuple[str, ...], split_at: int,
    joint_owner_economics: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Run two matched trajectories and compare their source-declared economics.

    Each arm contains one active original economic ledger, using its existing
    COOPERATION slot for the executed route (not a claim of link membership).
    Inputs for the two actualized routes may differ after the common prefix:
    owner-declared transfers, classified resource-use rows and their evidence.
    This is a controlled MODEL_ONLY contrast, not a causal estimator. The
    private research view is never automatically shared with participants.
    """
    from copy import deepcopy
    from decimal import Decimal
    from .mesa_model import simulate

    active = "COOPERATION"
    inactive = "INDEPENDENT_ALTERNATIVE"
    accepted = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    arms = {"cooperation": cooperative_work, "outside": outside_work}
    if (not isinstance(scenarios, Mapping) or set(scenarios) != set(arms)
            or any(not isinstance(value, str) or not value for value in
                   (cooperative_work, outside_work, relation))
            or not isinstance(prior_works, tuple) or not prior_works
            or any(not isinstance(value, str) or not value for value in prior_works)
            or len(set((*prior_works, cooperative_work, outside_work)))
               != len(prior_works) + 2
            or type(split_at) is not int or split_at < 0):
        raise TrajectoryComparisonError("EXECUTED_ROUTE_MATCHED_DESIGN_REQUIRED")

    reference = None
    reference_finance = None
    reference_prior_finance = None
    cumulative_scope = None
    common_prefix = None
    for name, selected in arms.items():
        doc = scenarios[name]
        if not isinstance(doc, Mapping):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_SCENARIO_REQUIRED")
        multiple = "strict_economic_source_works" in doc
        if (multiple and (
                doc.get("strict_economic_source_work") is not None
                or doc["strict_economic_source_works"] != [*prior_works, selected]
            ) or not multiple and doc.get("strict_economic_source_work") != selected):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_STRICT_SELECTED_WORK_REQUIRED")
        if cumulative_scope is not None and cumulative_scope != multiple:
            raise TrajectoryComparisonError("EXECUTED_ROUTE_ECONOMIC_SCOPE_CHANGED")
        cumulative_scope = multiple
        baseline = {k: v for k, v in doc.items()
                    if k not in {"events", "economic_claims",
                                 "strict_economic_source_work",
                                 "strict_economic_source_works"}}
        if reference is not None and reference != baseline:
            raise TrajectoryComparisonError("EXECUTED_ROUTE_INITIAL_STATE_CHANGED")
        reference = baseline
        events = doc.get("events")
        if not isinstance(events, list) or any(
            not isinstance(row, Mapping) or type(row.get("at")) is not int
            for row in events
        ):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_ORIGINAL_EVENTS_REQUIRED")
        prefix = [row for row in events if row["at"] <= split_at]
        if common_prefix is not None and common_prefix != prefix:
            raise TrajectoryComparisonError("EXECUTED_ROUTE_COMMON_PREFIX_CHANGED")
        common_prefix = prefix
        # Only the selected Work's later decisions and execution may differ.
        # Exogenous shocks need a separately controlled experiment.
        if any(row.get("work") != selected for row in events
               if row["at"] > split_at):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_OTHER_POST_SPLIT_EVENT")
        money = doc.get("economic_claims")
        if not isinstance(money, Mapping):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_ORIGINAL_MONEY_REQUIRED")
        timing = money.get("cash_timing")
        lifecycle = money.get("lifecycle_costs")
        if not isinstance(timing, Mapping) or not isinstance(lifecycle, Mapping):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_COST_AND_TIME_SCOPE_REQUIRED")
        financial_baseline = {
            "period": money.get("period"), "currency": money.get("currency"),
            "sources": money.get("sources"), "coverage": money.get("coverage"),
            "outside_feasibility": money.get("outside_feasibility"),
            "opening_positions": timing.get("owner_positions"),
            "horizon": timing.get("horizon_end"),
            "resource_scope_proofs": lifecycle.get("scope_proofs"),
        }
        if reference_finance is not None and reference_finance != financial_baseline:
            raise TrajectoryComparisonError("EXECUTED_ROUTE_ECONOMIC_BASELINE_CHANGED")
        reference_finance = financial_baseline
        if (type(doc.get("model_horizon")) is not int
                or timing.get("horizon_end") != doc["model_horizon"]):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_MATCHED_HORIZON_REQUIRED")
        allowed_works = {selected, *prior_works} if multiple else {selected}
        if "recipient_use_value_evidence" in money:
            values = money["recipient_use_value_evidence"]
            if (not multiple or not isinstance(values, list) or len(values) != 1
                    or not isinstance(values[0], Mapping) or values[0].get("work") != selected):
                raise TrajectoryComparisonError("EXECUTED_ROUTE_SELECTED_RECIPIENT_VALUE_SCOPE_REQUIRED")
        prior_records = {}
        for field in ("transfers", "resource_uses"):
            rows = money.get(field)
            if not isinstance(rows, list) or any(
                not isinstance(row, Mapping) or row.get("scenario") != active
                or row.get("work") not in allowed_works for row in rows
            ):
                raise TrajectoryComparisonError("EXECUTED_ROUTE_ONLY_SELECTED_ORIGINAL_ROWS")
            if multiple:
                if {row.get("work") for row in rows} != allowed_works:
                    raise TrajectoryComparisonError("EXECUTED_ROUTE_PRIOR_ECONOMIC_SCOPE_INCOMPLETE")
                prior_records[field] = [row for row in rows if row["work"] in prior_works]
        if multiple:
            # Prior cash, costs, terms and all their evidence must be the
            # SAME original declarations in both counterfactual runs.
            # This first cumulative experiment ends prior cash windows and
            # due-date hypotheses within the common observed prefix.
            if set(money) - {
                "period", "currency", "sources", "transfers", "resource_uses",
                "coverage", "outside_feasibility", "cash_timing", "lifecycle_costs",
                "work_payment_conditions", "work_payment_settlement_claims",
                "work_payment_due_amendments", "recipient_use_value_evidence",
            } or set(lifecycle) - {"bindings", "scope_proofs", "event_bindings"}:
                raise TrajectoryComparisonError("EXECUTED_ROUTE_PRIOR_EVIDENCE_SCOPE_UNSUPPORTED")
            prior_transfers = {row["id"] for row in prior_records["transfers"]}
            prior_costs = {row["id"] for row in prior_records["resource_uses"]}
            for field, rows, key, identifiers, clock_fields in (
                ("windows", timing.get("transfer_windows"), "transfer_id",
                 prior_transfers, ("at", "late_at")),
                ("terms", money.get("work_payment_conditions"), "transfer_id",
                 prior_transfers, ("due_at",)),
                ("settlements", money.get("work_payment_settlement_claims", []),
                 "transfer_id", prior_transfers, ("at",)),
                ("amendments", money.get("work_payment_due_amendments", []),
                 "transfer_id", prior_transfers, ("agreed_at", "new_due_at")),
                ("classification", lifecycle.get("bindings"), "resource_use_id",
                 prior_costs, ()),
                ("cost_events", lifecycle.get("event_bindings"), "resource_use_id",
                 prior_costs, ("at",)),
            ):
                if not isinstance(rows, list) or any(
                        not isinstance(row, Mapping) for row in rows):
                    raise TrajectoryComparisonError("EXECUTED_ROUTE_PRIOR_EVIDENCE_SCOPE_INCOMPLETE")
                attached = [row for row in rows if row.get(key) in identifiers]
                if any(type(row[k]) is not int or row[k] > split_at
                       for row in attached for k in clock_fields if k in row):
                    raise TrajectoryComparisonError("EXECUTED_ROUTE_PRIOR_EVIDENCE_AFTER_SPLIT")
                prior_records[field] = attached
            if reference_prior_finance is not None and prior_records != reference_prior_finance:
                raise TrajectoryComparisonError("EXECUTED_ROUTE_PRIOR_FINANCIAL_HISTORY_CHANGED")
            reference_prior_finance = prior_records

    # The controlled prefix already contains the original outside request.
    # There is no caller-supplied output to forge: both runs execute the
    # existing Mesa, then original strict KPB and original R2 projections.
    initial = reference["subjects"]
    owner_ids = {row["id"] for row in initial}
    links = [row for row in reference.get("cooperation_links", [])
             if row["id"] == relation]
    if len(links) != 1 or outside_work in links[0]["works"]:
        raise TrajectoryComparisonError("EXECUTED_ROUTE_FIXED_COOPERATION_BOUNDARY_REQUIRED")
    initial_link = links[0]
    dynamically_linked = cooperative_work not in initial_link["works"]
    if dynamically_linked:
        original_requests = [
            row for row in common_prefix
            if row.get("action") == "request"
            and row.get("work_spec", {}).get("id") == cooperative_work
        ]
        if (len(original_requests) != 1
                or original_requests[0].get("cooperation_link") != relation
                or original_requests[0].get("cooperation_source_revision")
                    != initial_link["source_revision"]):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_FIXED_COOPERATION_BOUNDARY_REQUIRED")
    members = set(initial_link["participants"])
    if not members or not members < owner_ids:
        raise TrajectoryComparisonError("EXECUTED_ROUTE_DISTINCT_CONSOLIDATION_BOUNDARIES_REQUIRED")
    original_specs = list(reference["works"])
    original_specs += [
        row["work_spec"] for row in common_prefix if row.get("action") == "request"
    ]
    specs = {row["id"]: row for row in original_specs}
    if not {cooperative_work, outside_work}.issubset(specs):
        raise TrajectoryComparisonError("EXECUTED_ROUTE_BOTH_ORIGINAL_WORK_DECLARATIONS_REQUIRED")
    coop_spec, out_spec = specs[cooperative_work], specs[outside_work]
    if (coop_spec["customer"] not in members or out_spec["customer"] in members
            or out_spec["customer"] not in owner_ids
            or any(coop_spec.get(k) != out_spec.get(k)
                   for k in ("resource", "slot_start", "slot_end", "requires_accepted"))):
        raise TrajectoryComparisonError("EXECUTED_ROUTE_DECLARED_PLAN_SCOPE_MISMATCH")

    def criteria(spec):
        return sorted(
            (row["id"], row["dimension"], row["operation"],
             row["responsible_owner"], row["method"])
            for row in spec.get("assurance_criteria", [])
        )

    if not criteria(coop_spec) or criteria(coop_spec) != criteria(out_spec):
        raise TrajectoryComparisonError("EXECUTED_ROUTE_DECLARED_QUALITY_BASIS_MISMATCH")

    frozen = deepcopy(scenarios)
    outputs = {name: simulate(deepcopy(scenarios[name])) for name in arms}
    if frozen != scenarios:
        raise TrajectoryComparisonError("EXECUTED_ROUTE_INPUT_MUTATED")
    prefix_output = None
    history = None
    reasons: set[str] = set()
    routes: dict[str, Any] = {}
    private: dict[str, Any] = {}
    projections: dict[str, Any] = {}

    def money(value):
        return f"{value:.2f}"

    def total(values):
        return sum((Decimal(v) for v in values), Decimal(0))

    for name, selected in arms.items():
        result = outputs[name]
        doc = scenarios[name]["economic_claims"]
        trace, works = result["trace"], result["works"]
        if result.get("profit", {}).get("system_increment") != "UNKNOWN":
            raise TrajectoryComparisonError("EXECUTED_ROUTE_EMPIRICAL_PROFIT_NOT_IDENTIFIED")
        if set(result["subjects"]) != owner_ids:
            raise TrajectoryComparisonError("EXECUTED_ROUTE_SUBJECT_BOUNDARY_CHANGED")
        prefix = [row for row in trace if row["at"] <= split_at]
        if prefix_output is not None and prefix_output != prefix:
            raise TrajectoryComparisonError("EXECUTED_ROUTE_APPLIED_PREFIX_CHANGED")
        prefix_output = prefix
        # R1-P may form the third Work only after accepted original Results.
        # Its link must really have been applied by the original scheduler,
        # not merely declared in one experimental arm.
        current_links = [
            row for row in result.get("cooperation", {}).get("links", [])
            if row.get("id") == relation
        ]
        if (len(current_links) != 1
                or set(current_links[0]["original_participants"]) != members
                or current_links[0]["source_revision"] != initial_link["source_revision"]
                or cooperative_work not in current_links[0]["works"]
                or outside_work in current_links[0]["works"]):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_FIXED_COOPERATION_BOUNDARY_REQUIRED")
        if dynamically_linked and sum(
            row.get("action") == "request" and row.get("outcome") == "APPLIED"
            and row.get("work") == cooperative_work
            and row.get("requested_cooperation_link") == relation
            and row.get("requested_cooperation_source_revision")
                == initial_link["source_revision"]
            for row in prefix
        ) != 1:
            raise TrajectoryComparisonError("EXECUTED_ROUTE_ORIGINAL_REQUEST_NOT_APPLIED")
        historical = [works[key] for key in prior_works if key in works]
        if (len(historical) != len(prior_works)
                or any(row["result"] != accepted for row in historical)
                or any(sum(row.get("action") == "accept"
                           and row.get("work") == key
                           and row.get("outcome") == "APPLIED"
                           for row in prefix) != 1 for key in prior_works)):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_PRIOR_ACCEPTED_HISTORY_REQUIRED")
        if history is not None and history != historical:
            raise TrajectoryComparisonError("EXECUTED_ROUTE_HISTORICAL_RESULT_CHANGED")
        history = historical
        if not set(arms.values()).issubset(works):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_ORIGINAL_REQUEST_NOT_APPLIED")
        requirements = result.get("capacity", {}).get("requirements", {})
        if (not requirements.get(cooperative_work)
                or requirements.get(cooperative_work) != requirements.get(outside_work)):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_CAPACITY_SCOPE_MISMATCH")
        if not any(row.get("action") == "request" and row.get("outcome") == "APPLIED"
                   and row.get("work") == outside_work
                   and isinstance(row.get("outside_work_origin"), Mapping)
                   for row in prefix):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_ORIGINAL_OUTSIDE_LINEAGE_REQUIRED")
        inactive_work = arms["outside" if name == "cooperation" else "cooperation"]
        if (works[inactive_work]["obligation"] != "NOT_ACCEPTED"
                or works[inactive_work]["result"] != "NOT_SUBMITTED"):
            raise TrajectoryComparisonError("EXECUTED_ROUTE_INCOMPATIBLE_WORK_ALSO_ACCEPTED")
        chosen = works[selected]
        current = [row for row in trace if row.get("work") == selected
                   and row.get("outcome") == "APPLIED"]
        times = {
            action: [row["at"] for row in current if row["action"] == action]
            for action in ("commit", "start", "complete", "accept")
        }
        executed = (
            chosen["result"] == accepted
            and chosen["obligation"] == "FULFILLED"
            and all(len(seq) == 1 for seq in times.values())
            and times["commit"][0] < times["start"][0] < times["complete"][0]
                < times["accept"][0]
            and chosen.get("assurance", {}).get("current_result_quality_gate") == "NONE"
        )
        econ = result["economics"]
        strict = econ.get("original_strict_context_source_qualification", {})
        costs = econ.get("lifecycle_resource_costs", {})
        pay = econ.get("work_payment_causality", {})
        cash = econ.get("cash_timing", {})
        route_reasons = []
        if not executed:
            route_reasons.append("SELECTED_ORIGINAL_RESULT_NOT_QUALIFIED")
        if (not result.get("context_basis", {}).get("strict")
                or strict.get("status") != "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED"):
            route_reasons.append("STRICT_ORIGINAL_SOURCE_SCOPE_INCOMPLETE")
        if name == "outside" and not strict.get(
                "outside_work_original_offer_purchase_transfer_price_matched"):
            route_reasons.append("ORIGINAL_OUTSIDE_PRICE_NOT_QUALIFIED")
        if (not doc["transfers"]
                or pay.get("source_declared_consistent_count") != econ["transfers_count"]
                or pay.get("status") != "DECLARED_CAUSAL_PAYMENT_ORDER_ONLY_NOT_SETTLEMENT"):
            route_reasons.append("ORIGINAL_PAYMENT_TERMS_OR_CAUSAL_ORDER_INCOMPLETE")
        if (not doc["resource_uses"]
                or strict.get("source_scoped_original_cost_event_count")
                   != econ["resource_uses_count"]
                or costs.get("classified_original_record_count") != econ["resource_uses_count"]):
            route_reasons.append("ORIGINAL_COST_CLASSIFICATION_OR_EVENT_SOURCES_INCOMPLETE")
        if cash.get("missing_transfer_window_count") != 0:
            route_reasons.append("ORIGINAL_CASH_TIME_SCOPE_INCOMPLETE")

        owner_rows = {}
        for owner in sorted(owner_ids):
            balance = econ.get("per_subject", {}).get(owner, {}).get(
                "complete_cash_balance_from_claims", {}
            ).get(active)
            cost = costs.get("owner_scoped_details", {}).get(owner, {}).get(
                "scenarios", {}
            ).get(active, {})
            path = cash.get("per_original_owner_private_research_projection", {}).get(
                owner, {}
            ).get("scenario_paths", {}).get(active, {})
            expected = path.get("expected", {})
            delayed = path.get("declared_late_case", {})
            if (balance is None or not cost.get("declared_resource_scope_complete_not_audited")
                    or expected.get("end_of_horizon_cash_from_declared_transfers") is None
                    or delayed.get("status") is None):
                route_reasons.append("ORIGINAL_OWNER_CASH_COST_OR_RESERVE_SCOPE_INCOMPLETE")
                continue
            owner_rows[owner] = {
                "declared_net_cash": balance,
                "declared_noncash_by_nature": cost["noncash_use_by_nature"],
                "declared_noncash_total": money(total(cost["noncash_use_by_nature"].values())),
                "expected_liquidity": expected["status"],
                "late_receipt_liquidity": delayed["status"],
            }
        route_reasons = sorted(set(route_reasons))
        reasons.update(route_reasons)
        routes[name] = {
            "selected_original_result": chosen["result"],
            "original_recipient_quality_gate_passed": executed,
            "original_acceptance_tick": times["accept"][0] if executed else None,
            "execution_model_ticks": times["complete"][0]-times["start"][0] if executed else None,
            "source_matched_full_transfer_count": pay.get("settlement_progress", {}).get(
                "source_claimed_full_transfer_count", 0),
            "bank_payment_verified": False,
            "economic_scope_status": "QUALIFIED_MODEL_ONLY" if not route_reasons else "UNKNOWN",
            "reasons": route_reasons,
        }
        if not route_reasons:
            whole = total(row["declared_net_cash"] for row in owner_rows.values())
            original_external = econ["complete_consolidated_external_balance_from_claims"][active]
            if original_external is None or whole != Decimal(original_external):
                raise TrajectoryComparisonError("EXECUTED_ROUTE_ORIGINAL_CASH_NOT_CONSERVED")
            # A fixed subset's net boundary cash equals the sum of original
            # member balances. Internal payments cancel exactly. No new
            # transfer, cost or separate consolidated money register.
            subset = total(owner_rows[owner]["declared_net_cash"] for owner in members)
            projections[name] = {
                "fixed_cooperation_boundary_net_cash": money(subset),
                "whole_original_subject_boundary_net_cash": money(whole),
                "whole_original_noncash_total": money(total(
                    row["declared_noncash_total"] for row in owner_rows.values())),
                "whole_original_transaction_noncash": money(total(
                    row["declared_noncash_by_nature"].get("TRANSACTION", "0")
                    for row in owner_rows.values())),
            }
            private[name] = owner_rows

    # No economic zero or winner is manufactured when one route is incomplete.
    qualified = not reasons and set(projections) == set(arms)
    comparison = None
    private_delta = None
    if qualified:
        coop, outside = projections["cooperation"], projections["outside"]
        comparison = {
            "fixed_cooperation_cash_cooperation_minus_outside": money(
                Decimal(coop["fixed_cooperation_boundary_net_cash"])
                - Decimal(outside["fixed_cooperation_boundary_net_cash"])),
            "whole_subject_cash_cooperation_minus_outside": money(
                Decimal(coop["whole_original_subject_boundary_net_cash"])
                - Decimal(outside["whole_original_subject_boundary_net_cash"])),
            "whole_noncash_outside_minus_cooperation": money(
                Decimal(outside["whole_original_noncash_total"])
                - Decimal(coop["whole_original_noncash_total"])),
            "whole_transaction_noncash_outside_minus_cooperation": money(
                Decimal(outside["whole_original_transaction_noncash"])
                - Decimal(coop["whole_original_transaction_noncash"])),
        }
        private_delta = {
            owner: {
                "cash_cooperation_minus_outside": money(
                    Decimal(private["cooperation"][owner]["declared_net_cash"])
                    - Decimal(private["outside"][owner]["declared_net_cash"])),
                "noncash_outside_minus_cooperation": money(
                    Decimal(private["outside"][owner]["declared_noncash_total"])
                    - Decimal(private["cooperation"][owner]["declared_noncash_total"])),
            }
            for owner in sorted(owner_ids)
        }

    joint = None
    recipient = None
    has_value = any("recipient_use_value_evidence" in scenarios[arm]["economic_claims"] for arm in arms)
    if joint_owner_economics is not None or has_value:
        supplier = next(row["owner"] for row in reference["resources"]
                        if row["id"] == coop_spec["resource"])
        operator = reference["institution"]["operator"]
        if joint_owner_economics is not None:
            joint = _review_joint_owner_service_economics(
                joint_owner_economics, scenarios=scenarios, projections=private if qualified else None,
                supplier=supplier, operator=operator, members=members,
            )
        if has_value:
            recipient = _review_matched_recipient_use_values(
                scenarios=scenarios, outputs=outputs, arms=arms, qualified=qualified,
                joint=joint, supplier=supplier, operator=operator,
            )
    return {
        "schema": "AKIS_MATCHED_EXECUTED_ORIGINAL_ROUTE_ECONOMICS/1.0",
        **({"joint_owner_service_economics": joint} if joint is not None else {}),
        **({"selected_recipient_use_value_comparison": recipient} if recipient is not None else {}),
        "status": ("MODEL_EXECUTED_ROUTES_DECLARED_ECONOMIC_CONTRAST"
                   if qualified else "NOT_IDENTIFIABLE_FROM_EXECUTED_ROUTE_SCOPE"),
        "common_initial_state_and_applied_prefix_verified": True,
        "previous_original_results_preserved": True,
        **({
            "original_financial_scope": "COMMON_PRIOR_WORKS_AND_SELECTED_EXECUTED_ROUTE",
            "prior_economic_history_same_in_both_runs": True,
            "prior_economic_work_count": len(prior_works),
            "opening_cash_is_at_start_of_common_history": True,
            "prior_cash_windows_are_model_claims_not_bank_balances": True,
        } if cumulative_scope else {}),
        "declared_resource_calendar_and_quality_criteria_matched": True,
        "distinct_original_recipients_not_equal_measured_utility": True,
        "actual_physical_equivalence_and_causal_additionality_verified": False,
        "original_bank_payment_verified": False,
        "cash_and_noncash_are_not_added": True,
        "separate_incompatible_runs_not_summed": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
        "routes": routes,
        "reasons": sorted(reasons),
        "local_research_only": {
            "boundary_projections": projections if qualified else None,
            "boundary_and_cost_contrast": comparison,
            "original_owner_projections": private if qualified else None,
            "original_owner_contrasts": private_delta,
            "automatically_shared_with_participants": False,
        },
    }




def _review_matched_recipient_use_values(*, scenarios, outputs, arms, qualified, joint, supplier, operator):
    """Extend the existing matched-route contrast, not the business ledger.

    The distinct buyers each declare incremental noncash use value against
    their OWN no-order baseline. Shared prior owner costs cancel in the
    contrast. No measured interpersonal utility or causal welfare claim.
    """
    from decimal import Decimal

    limits = {
        "distinct_original_recipients_not_same_person_or_measured_utility": True,
        "each_recipient_compared_to_own_declared_no_order_baseline": True,
        "unmeasured_external_effects_excluded": True,
        "no_new_value_cash_or_consent_created": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }

    def direction(value):
        return "POSITIVE" if value > 0 else "ZERO" if value == 0 else "NEGATIVE"

    unknown = {**limits, "status": "UNKNOWN_RECIPIENT_VALUE_SCOPE", "local_research_only": None}
    if not qualified:
        return unknown
    rows = {}
    for arm, work in arms.items():
        view = outputs[arm]["economics"].get("original_recipient_use_value", {})
        private = view.get("local_research_only", {}).get(work)
        if private is None:
            return unknown
        rows[arm] = {"recipient": outputs[arm]["works"][work]["original_customer"], **private}
    surpluses = {arm: Decimal(row["recipient_model_surplus_vs_declared_no_order"])
                 for arm, row in rows.items()}
    verdict = {**limits,
        "status": "MODEL_SELECTED_RECIPIENT_OWN_USE_VALUE_CONTRAST",
        "recipient_surplus_directions": {arm: direction(v) for arm, v in surpluses.items()},
        "both_selected_recipients_positive_vs_own_declared_no_order": all(v > 0 for v in surpluses.values()),
        "whole_selected_route_value_contrast_status": "UNKNOWN",
        "local_research_only": {"selected_recipients": rows},
    }
    if joint is None or joint["local_research_only"] is None:
        return verdict
    for arm, work in arms.items():
        allowed = {supplier, operator, rows[arm]["recipient"]}
        if len(allowed) != 3:
            return verdict
        money = scenarios[arm]["economic_claims"]
        if (any({t["payer"], t["payee"]} - {"EXTERNAL"} - allowed
                for t in money["transfers"] if t["work"] == work)
                or any(r["owner"] not in allowed for r in money["resource_uses"] if r["work"] == work)):
            return verdict
    common_delta = Decimal(joint["local_research_only"]["joint_cooperative_minus_outside_contribution"])
    delta = common_delta + surpluses["cooperation"] - surpluses["outside"]
    verdict["whole_selected_route_value_contrast_status"] = "MODEL_ONLY_SCOPED_INCREMENTAL_VALUE_CONTRAST"
    verdict["whole_selected_route_value_contrast_direction"] = direction(delta)
    reserve = outputs["cooperation"]["economics"]["cash_timing"][
        "per_original_owner_private_research_projection"][rows["cooperation"]["recipient"]][
        "scenario_paths"]["COOPERATION"]
    verdict["cooperative_common_owners_and_recipient_viability_criteria_met"] = (
        joint["status"] == "BOTH_COMMON_OWNERS_MODEL_CONTRIBUTION_AND_RESERVE_CRITERIA_MET"
        and surpluses["cooperation"] > 0
        and all(reserve[key]["status"] == "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
                for key in ("expected", "declared_late_case"))
    )
    verdict["local_research_only"]["common_owner_plus_selected_recipient_delta"] = f"{delta:.2f}"
    return verdict


def _review_joint_owner_service_economics(
    raw: Mapping[str, Any], *, scenarios: Mapping[str, Mapping[str, Any]],
    projections: Mapping[str, Any] | None, supplier: str, operator: str,
    members: set[str],
) -> dict[str, Any]:
    """Two common original owners, independently scoped model contribution.

    Only qualified executed route projections may be used.  Both owners'
    complete original transfer/resource rows must be covered by distinct
    owner-held nonoverlap declarations in the existing strict economic
    document.  A modeled fee cap is independently supplied by its payer.
    Nothing here changes a payment, establishes a price or proves buyer value.
    """
    from decimal import Decimal
    from .economic_flow import (_record, _flow_ref, _bounded_list,
                                _identifier, _amount, EconomicInputError)

    limits = {
        "model_contribution_not_accounting_profit": True,
        "original_distinct_recipient_value_not_measured": True,
        "no_automatic_consent_or_fee_change": True,
        "fee_cap_is_not_real_willingness_or_contract": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    if projections is None:
        return {
            **limits, "status": "UNKNOWN_EXECUTED_ROUTE_SCOPE",
            "local_research_only": None,
        }
    _record(raw, {"supplier", "operator", "scopes", "fee_cap"}, "JOINT_OWNER_ECONOMICS")
    if (raw["supplier"] != supplier or raw["operator"] != operator
            or supplier == operator or not {supplier, operator}.issubset(members)):
        raise TrajectoryComparisonError("JOINT_OWNER_ORIGINAL_ROLES_REQUIRED")
    if not isinstance(raw["scopes"], Mapping) or set(raw["scopes"]) != set(scenarios):
        raise TrajectoryComparisonError("JOINT_OWNER_BOTH_EXECUTED_SCOPES_REQUIRED")

    def keys(values):
        ids = [_identifier(key, "JOINT_OWNER_ROW")
               for key in _bounded_list(values, "JOINT_OWNER_ROW")]
        if len(ids) != len(set(ids)):
            raise TrajectoryComparisonError("JOINT_OWNER_DUPLICATE_ORIGINAL_ROW")
        return set(ids)

    def owner_source(source, owner, source_map, excluded):
        key = _flow_ref(source, source_map, {owner})
        ref = source_map[key]["reference"]
        if ref in excluded:
            raise TrajectoryComparisonError("JOINT_OWNER_SEPARATE_ORIGINAL_SOURCE_REQUIRED")
        return ref

    def direction(value):
        return "POSITIVE" if value > 0 else "ZERO" if value == 0 else "NEGATIVE"

    def amount(value):
        return f"{value:.2f}"

    contributions = {}
    fee_amounts = {}
    all_excluded = set()
    try:
        for arm in ("cooperation", "outside"):
            document = scenarios[arm]
            if not document.get("strict_economic_source_works"):
                raise TrajectoryComparisonError("JOINT_OWNER_ORIGINAL_MULTIPERIOD_SCOPE_REQUIRED")
            money = document["economic_claims"]
            source_map = {row["id"]: row for row in money["sources"]}
            scopes = raw["scopes"][arm]
            if not isinstance(scopes, Mapping) or set(scopes) != {supplier, operator}:
                raise TrajectoryComparisonError("JOINT_OWNER_BOTH_OWNER_SCOPES_REQUIRED")
            contributions[arm] = {}
            used_refs = set()
            for owner in (supplier, operator):
                record = _record(scopes[owner], {"source", "transfer_ids", "resource_use_ids"},
                                 "JOINT_OWNER_NONOVERLAP")
                transfers = {row["id"]: row for row in money["transfers"]
                             if owner in {row["payer"], row["payee"]}}
                resources = {row["id"]: row for row in money["resource_uses"]
                             if row["owner"] == owner}
                if (not transfers or not resources
                        or keys(record["transfer_ids"]) != set(transfers)
                        or keys(record["resource_use_ids"]) != set(resources)):
                    raise TrajectoryComparisonError("JOINT_OWNER_FULL_ORIGINAL_ROW_SCOPE_REQUIRED")
                # Reject aliases of the original terms, scope, timed costs,
                # and payment witnesses.  The distinct document declares
                # that these resource costs are not paid by any listed cash row.
                excluded = {source_map[row["source"]]["reference"]
                            for row in (*transfers.values(), *resources.values())}
                for key in (money["coverage"]["COOPERATION"][owner],
                            money["lifecycle_costs"]["scope_proofs"]["COOPERATION"][owner]):
                    excluded.add(source_map[key]["reference"])
                for row in money["lifecycle_costs"]["event_bindings"]:
                    if row["resource_use_id"] in resources:
                        excluded.add(row["cost_evidence_ref"])
                for row in money.get("work_payment_settlement_claims", []):
                    if row["transfer_id"] in transfers:
                        excluded.update(row.get("evidence_refs", {}).values())
                ref = owner_source(record["source"], owner, source_map, excluded | used_refs)
                used_refs.add(ref)
                all_excluded.update(excluded | {ref})
                view = projections[arm][owner]
                contributions[arm][owner] = (
                    Decimal(view["declared_net_cash"]) - Decimal(view["declared_noncash_total"]))
            operator_receipts = [row for row in money["transfers"] if row["payee"] == operator]
            if not operator_receipts or any(row["payer"] != supplier for row in operator_receipts):
                raise TrajectoryComparisonError("JOINT_OWNER_SINGLE_ORIGINAL_FEE_PAYER_SCOPE_REQUIRED")
            fee_amounts[arm] = sum((_amount(row["amount"]) for row in operator_receipts), Decimal(0))

        cap_record = _record(raw["fee_cap"], {"owner", "source", "maximum_total_fee"},
                             "JOINT_OWNER_FEE_CAP")
        if cap_record["owner"] != supplier:
            raise TrajectoryComparisonError("JOINT_OWNER_ORIGINAL_FEE_PAYER_REQUIRED")
        owner_source(cap_record["source"], supplier, source_map, all_excluded)
        cap = _amount(cap_record["maximum_total_fee"])
    except EconomicInputError as exc:
        raise TrajectoryComparisonError(f"JOINT_OWNER_{exc}") from exc

    rows = {}
    failures = []
    reserve_ok = "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    for role, owner in (("supplier", supplier), ("operator", operator)):
        coop = contributions["cooperation"][owner]
        outside = contributions["outside"][owner]
        delta = coop - outside
        reserve = projections["cooperation"][owner]
        if coop <= 0:
            failures.append(f"{role.upper()}_NONPOSITIVE_COOPERATIVE_CONTRIBUTION")
        if delta <= 0:
            failures.append(f"{role.upper()}_NO_POSITIVE_ALTERNATIVE_ADVANTAGE")
        if (reserve["expected_liquidity"] != reserve_ok
                or reserve["late_receipt_liquidity"] != reserve_ok):
            failures.append(f"{role.upper()}_DECLARED_RESERVE_NOT_ROBUST")
        rows[role] = {
            "cooperative_contribution": amount(coop),
            "outside_contribution": amount(outside),
            "cooperative_minus_outside_contribution": amount(delta),
            "cooperative_expected_reserve_status": reserve["expected_liquidity"],
            "cooperative_late_receipt_reserve_status": reserve["late_receipt_liquidity"],
        }
    if fee_amounts["cooperation"] > cap:
        failures.append("SUPPLIER_DECLARED_FEE_CAP_EXCEEDED")
    joint = {arm: sum(values.values(), Decimal(0))
             for arm, values in contributions.items()}
    return {
        **limits,
        "status": ("BOTH_COMMON_OWNERS_MODEL_CONTRIBUTION_AND_RESERVE_CRITERIA_MET"
                   if not failures else "COMMON_OWNER_MODEL_VIABILITY_CRITERIA_NOT_MET"),
        "original_two_common_owners_only": True,
        "complete_declared_nonoverlap_owner_scopes": True,
        "cooperative_contribution_directions": {
            role: direction(Decimal(row["cooperative_contribution"]))
            for role, row in rows.items()},
        "cooperative_alternative_advantage_directions": {
            role: direction(Decimal(row["cooperative_minus_outside_contribution"]))
            for role, row in rows.items()},
        "joint_contribution_advantage_direction": direction(joint["cooperation"] - joint["outside"]),
        "failure_reasons": sorted(failures),
        "local_research_only": {
            "owners": rows,
            "cooperative_total_original_fee": amount(fee_amounts["cooperation"]),
            "outside_total_original_fee": amount(fee_amounts["outside"]),
            "supplier_declared_maximum_total_fee": amount(cap),
            "joint_cooperative_contribution": amount(joint["cooperation"]),
            "joint_outside_contribution": amount(joint["outside"]),
            "joint_cooperative_minus_outside_contribution": amount(joint["cooperation"] - joint["outside"]),
        },
    }

def compare_original_preparation_modes(
    scenarios: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """S0/S1/S2 controlled preparation comparison on one original Mesa.

    Only the mode of preparing the same packet and its reconciled original
    resource-use amount may differ. This is a micro-process experiment;
    it is NOT an assertion that whole S0/S1/S2 organizations were simulated.
    """
    from copy import deepcopy
    from decimal import Decimal
    from .mesa_model import simulate
    from .process_preparation import (
        PREPARATION_MODES, PREPARATION_ACTIVITY_UNITS,
        evaluate_preparation_diagnostic, preparation_source_fingerprint,
    )

    if (not isinstance(scenarios, Mapping)
            or set(scenarios) not in (set(PREPARATION_MODES), set(PREPARATION_MODES) | {"ADAPTIVE"})):
        raise TrajectoryComparisonError("PREPARATION_COMPARISON_THREE_MODES_REQUIRED")
    arms = (*PREPARATION_MODES, "ADAPTIVE") if "ADAPTIVE" in scenarios else PREPARATION_MODES
    baseline = None
    reference_works = None
    reference_trace = None
    reference_capacity = None
    rows = {}
    for mode in arms:
        doc = deepcopy(scenarios[mode])
        try:
            money = doc["economic_claims"]
            lifecycle = money["lifecycle_costs"]
            bindings = lifecycle["preparation_activity_bindings"]
            identifiers = {row["resource_use_id"] for row in bindings}
            if len(identifiers) != len(bindings) or not identifiers:
                raise TrajectoryComparisonError("PREPARATION_COMPARISON_COST_BINDINGS_REQUIRED")
            scope = doc["strict_economic_source_works"]
            if not isinstance(scope, list) or not scope or len(set(scope)) != len(scope):
                raise TrajectoryComparisonError("PREPARATION_COMPARISON_STRICT_WORK_SCOPE_REQUIRED")
            normalized = deepcopy(doc)
            prepared = []
            for event in normalized["events"]:
                if event["action"] == "function_prepare":
                    if "preparation_pattern" in event:
                        raise TrajectoryComparisonError(
                            "PREPARATION_COMPARISON_PATTERN_REQUIRES_MATCHED_PATTERN_EXPERIMENT")
                    selected = event.pop("preparation_mode", None)
                    if (selected not in PREPARATION_MODES
                            or (mode != "ADAPTIVE" and selected != mode)
                            or (mode == "ADAPTIVE" and "preparation_diagnostic" not in event)):
                        raise TrajectoryComparisonError("PREPARATION_COMPARISON_MODE_MISMATCH")
                    prepared.append(event.get("work"))
            if sorted(prepared) != sorted(scope):
                raise TrajectoryComparisonError("PREPARATION_COMPARISON_ONE_PACKET_PER_SCOPED_WORK")
            for row in normalized["economic_claims"]["resource_uses"]:
                if row["id"] in identifiers:
                    row["amount"] = "MATCHED_ACTIVITY_COST"
        except (KeyError, TypeError) as exc:
            raise TrajectoryComparisonError("PREPARATION_COMPARISON_ORIGINAL_DOCUMENT_REQUIRED") from exc
        fingerprint = _fingerprint(normalized)
        if baseline is not None and fingerprint != baseline:
            raise TrajectoryComparisonError("PREPARATION_COMPARISON_ORIGINAL_BASELINE_CHANGED")
        baseline = fingerprint
        result = simulate(doc)
        works = result["works"]
        trace = deepcopy(result["trace"])
        for event in trace:
            event.pop("model_preparation_activity", None)
            if "model_preparation_economic_choice" in event:
                event["model_preparation_economic_choice"].pop("selected_mode")
                event["model_preparation_economic_choice"].pop("selection_minimizes_declared_expected_cost")
        if (reference_works is not None and works != reference_works
                or reference_trace is not None and trace != reference_trace
                or reference_capacity is not None and result["capacity"] != reference_capacity):
            raise TrajectoryComparisonError("PREPARATION_COMPARISON_ORIGINAL_OUTCOMES_CHANGED")
        reference_works, reference_trace, reference_capacity = works, trace, result["capacity"]
        econ = result["economics"]
        strict = econ.get("original_strict_context_source_qualification", {})
        costs = econ.get("lifecycle_resource_costs", {})
        activity = costs.get("original_preparation_activity_costs", {})
        if (result["counts"]["blocked"]
                or any(works[key]["result"] != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                       or works[key]["obligation"] != "FULFILLED" for key in scope)
                or strict.get("status") != "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED"
                or strict.get("source_scoped_original_cost_event_count") != econ["resource_uses_count"]
                or costs.get("classified_original_record_count") != econ["resource_uses_count"]
                or activity.get("original_cost_count") != len(scope)
                or activity.get("status") != "MODEL_ORIGINAL_PACKET_ACTIVITY_COST_RECONCILED"
                or econ["work_payment_causality"]["source_declared_consistent_count"] != econ["transfers_count"]
                or result["profit"]["system_increment"] != "UNKNOWN"):
            raise TrajectoryComparisonError("PREPARATION_COMPARISON_ORIGINAL_SCOPE_NOT_QUALIFIED")
        expected_cost, chosen_modes, minimum_count = Decimal(0), {}, 0
        diagnostic_count = 0
        for item in activity["items"]:
            position = item["original_trace_position"]
            original_event = doc["events"][position]
            actual_event = result["trace"][position]
            diagnostic = original_event.get("preparation_diagnostic")
            chosen_modes[item["work"]] = item["mode"]
            if diagnostic is None:
                continue
            assessment = evaluate_preparation_diagnostic(
                diagnostic, actual_event["model_preparation_activity"])
            review = actual_event.get("model_preparation_economic_choice", {})
            if (review.get("source_document_fingerprint") != preparation_source_fingerprint(diagnostic)
                    or review.get("recommended_mode") != assessment["recommended_mode"]
                    or review.get("selected_mode") != item["mode"]):
                raise TrajectoryComparisonError("PREPARATION_COMPARISON_ORIGINAL_REVIEW_REQUIRED")
            expected_cost += assessment["modes"][item["mode"]]["risk_adjusted_expected_cost"]
            minimum_count += int(item["mode"] == assessment["recommended_mode"])
            diagnostic_count += 1
        if diagnostic_count not in (0, len(scope)):
            raise TrajectoryComparisonError("PREPARATION_COMPARISON_DIAGNOSTIC_SCOPE_INCOMPLETE")
        rows[mode] = {
            "accepted_original_work_count": len(scope),
            "selected_modes_by_original_work": chosen_modes,
            "source_reviewed_risk_adjusted_expected_cost": (
                f"{expected_cost:.2f}" if diagnostic_count else None),
            "economically_minimizing_owner_selection_count": minimum_count,
            "original_diagnostic_review_count": diagnostic_count,
            "applied_original_customer_reviews": sum(
                event["action"] == "function_review" and event["outcome"] == "APPLIED"
                and event.get("work") in scope and event.get("human_decision") == "APPROVE"
                for event in trace),
            "modeled_activity_units": {
                unit: sum(item["units"][unit] for item in activity["items"])
                for unit in PREPARATION_ACTIVITY_UNITS
            },
            "declared_preparation_resource_cost": activity["total_declared_resource_cost"],
        }
    def delta(left, right):
        return f"{Decimal(rows[left]['declared_preparation_resource_cost']) - Decimal(rows[right]['declared_preparation_resource_cost']):.2f}"
    adaptive = {}
    if "ADAPTIVE" in rows:
        fixed = min(PREPARATION_MODES, key=lambda mode: (
            Decimal(rows[mode]["source_reviewed_risk_adjusted_expected_cost"]),
            PREPARATION_MODES.index(mode),
        ))
        adaptive = {
            "best_fixed_mode_by_declared_expected_cost": fixed,
            "best_fixed_minus_adaptive_expected_cost": f"{Decimal(rows[fixed]['source_reviewed_risk_adjusted_expected_cost']) - Decimal(rows['ADAPTIVE']['source_reviewed_risk_adjusted_expected_cost']):.2f}",
        }
    return {
        "schema": "AKIS_ORIGINAL_PREPARATION_MODES_COST_COMPARISON/1.1",
        "status": "MODEL_MATCHED_PREPARATION_ACTIVITY_COST_CONTRAST",
        "original_baseline_fingerprint_sha256": baseline,
        "same_original_works_results_consents_and_cash": True,
        "same_original_capacity_and_event_sequence": True,
        "currency": next(iter(scenarios.values()))["economic_claims"]["currency"],
        "local_research_only": {
            "modes": rows,
            "S0_minus_S1_preparation_cost": delta("S0", "S1"),
            "S1_minus_S2_preparation_cost": delta("S1", "S2"),
            "S0_minus_S2_preparation_cost": delta("S0", "S2"),
            **adaptive,
        },
        "full_S0_S1_S2_organizational_experiment": False,
        "actual_labor_time_and_agent_runtime_measured": False,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
        "profit": "UNKNOWN",
    }


def compare_original_preparation_pattern_reuse(
    scenarios: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Original operator structural capital: build again versus actual reuse.

    Both arms execute the SAME original digital preparation mode, same Work,
    sources, human review, capacity, price and cost unit rates. Only the
    independent choice to rebuild or reuse the owner's qualified structural
    pattern and the corresponding reconciled resource amount can differ.
    """
    from copy import deepcopy
    from decimal import Decimal
    from .mesa_model import simulate

    if not isinstance(scenarios, Mapping) or set(scenarios) != {"REBUILD", "REUSE"}:
        raise TrajectoryComparisonError("PREPARATION_PATTERN_MATCHED_TWO_ARMS_REQUIRED")
    baseline = None
    reference = None
    rows = {}
    for arm in ("REBUILD", "REUSE"):
        doc = deepcopy(scenarios[arm])
        try:
            normalized = deepcopy(doc)
            scope = normalized["strict_economic_source_works"]
            lifecycle = normalized["economic_claims"]["lifecycle_costs"]
            cost_ids = {row["resource_use_id"] for row in lifecycle["preparation_activity_bindings"]}
            if (not isinstance(scope, list) or len(scope) < 2
                    or len(set(scope)) != len(scope) or len(cost_ids) != len(scope)):
                raise TrajectoryComparisonError("PREPARATION_PATTERN_ORIGINAL_MULTIWORK_SCOPE_REQUIRED")
            prepared = []
            modes = set()
            for event in normalized["events"]:
                if event["action"] == "function_prepare":
                    modes.add(event["preparation_mode"])
                    claim = event["preparation_pattern"]
                    prepared.append(event["work"])
                    event["preparation_pattern"] = {
                        key: claim[key] for key in ("source_ref", "source_revision")
                    }
            if sorted(prepared) != sorted(scope) or len(modes) != 1 or not modes <= {"S1", "S2"}:
                raise TrajectoryComparisonError("PREPARATION_PATTERN_SAME_DIGITAL_SCOPE_REQUIRED")
            for row in normalized["economic_claims"]["resource_uses"]:
                if row["id"] in cost_ids:
                    row["amount"] = "MATCHED_PATTERN_ACTIVITY_COST"
        except (KeyError, TypeError) as exc:
            raise TrajectoryComparisonError("PREPARATION_PATTERN_ORIGINAL_DOCUMENT_REQUIRED") from exc
        fingerprint = _fingerprint(normalized)
        if baseline is not None and fingerprint != baseline:
            raise TrajectoryComparisonError("PREPARATION_PATTERN_ORIGINAL_BASELINE_CHANGED")
        baseline = fingerprint
        out = simulate(doc)
        trace = deepcopy(out["trace"])
        patterns = []
        for event in trace:
            pattern = event.pop("model_preparation_pattern", None)
            if pattern is not None:
                patterns.append(pattern)
            event.pop("model_preparation_activity", None)
        invariant = (out["works"], trace, out["capacity"])
        if reference is not None and invariant != reference:
            raise TrajectoryComparisonError("PREPARATION_PATTERN_ORIGINAL_OUTCOMES_CHANGED")
        reference = invariant
        econ = out["economics"]
        costs = econ["lifecycle_resource_costs"]
        activity = costs["original_preparation_activity_costs"]
        strict = econ.get("original_strict_context_source_qualification", {})
        if (out["counts"]["blocked"] or len(patterns) != len(scope)
                or strict.get("status") != "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED"
                or strict.get("source_scoped_original_cost_event_count") != econ["resource_uses_count"]
                or costs.get("classified_original_record_count") != econ["resource_uses_count"]
                or activity["original_cost_count"] != len(scope)
                or econ["work_payment_causality"]["source_declared_consistent_count"] != econ["transfers_count"]
                or any(out["works"][key]["result"] != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                       for key in scope)):
            raise TrajectoryComparisonError("PREPARATION_PATTERN_ORIGINAL_SCOPE_NOT_QUALIFIED")
        # Optional joint observation of direct pattern costs and independently
        # declared risk. The exact same selected procedure, diagnostic
        # sources and rates must be present in both executed arms.
        from .process_preparation import (
            evaluate_selected_pattern_preparation_diagnostic, preparation_source_fingerprint,
        )
        diagnostic_count = 0
        expected_loss = Decimal(0)
        expected_total = Decimal(0)
        for item in activity["items"]:
            pos = item["original_trace_position"]
            event = doc["events"][pos]
            actual = out["trace"][pos]
            diagnostic = event.get("preparation_diagnostic")
            if diagnostic is None:
                continue
            assessment = evaluate_selected_pattern_preparation_diagnostic(
                diagnostic, actual["model_preparation_activity"])
            selected = assessment["selected"]
            review = actual.get("model_preparation_economic_choice", {})
            if (review.get("status") != "MODEL_ORIGINAL_SELECTED_PREPARATION_AND_PATTERN_RISK_REVIEW"
                    or review.get("source_document_fingerprint") != preparation_source_fingerprint(diagnostic)
                    or review.get("selected_mode") != item["mode"]
                    or not review.get("no_mode_ranking_or_automatic_decision")
                    or selected["declared_resource_cost"] != Decimal(item["declared_resource_cost"])):
                raise TrajectoryComparisonError("PREPARATION_PATTERN_RISK_ORIGINAL_REVIEW_REQUIRED")
            diagnostic_count += 1
            expected_loss += selected["expected_error_loss"]
            expected_total += selected["risk_adjusted_expected_cost"]
        if diagnostic_count not in (0, len(scope)):
            raise TrajectoryComparisonError("PREPARATION_PATTERN_RISK_SCOPE_INCOMPLETE")
        builds = sum(row["operation"] == "BUILD" for row in patterns)
        reuses = sum(row["operation"] == "REUSE" for row in patterns)
        if (builds + reuses != len(scope)
                or (arm == "REBUILD" and reuses != 0)
                or (arm == "REUSE" and (builds != 1 or reuses != len(scope) - 1))):
            raise TrajectoryComparisonError("PREPARATION_PATTERN_INDEPENDENT_APPLICATIONS_NOT_WITNESSED")
        rows[arm] = {
            "accepted_original_work_count": len(scope),
            "original_pattern_build_count": builds,
            "original_pattern_reuse_count": reuses,
            "original_pattern_distinct_reused_count": len({
                row["pattern_id"] for row in patterns if row["operation"] == "REUSE"
            }),
            "scoped_reuse_ratio": f"{Decimal(reuses) / Decimal(len(scope)):.4f}",
            "human_validation_units": sum(item["units"]["human_validation"] for item in activity["items"]),
            "declared_preparation_resource_cost": activity["total_declared_resource_cost"],
            **({"original_pattern_risk_review_count": diagnostic_count,
                "declared_expected_error_loss_not_posted": f"{expected_loss:.2f}",
                "declared_risk_adjusted_expected_cost": f"{expected_total:.2f}"}
               if diagnostic_count else {}),
        }
    joint = {}
    if "original_pattern_risk_review_count" in rows["REBUILD"]:
        if (rows["REBUILD"]["original_pattern_risk_review_count"] != rows["REUSE"].get(
                "original_pattern_risk_review_count")
                or rows["REBUILD"]["declared_expected_error_loss_not_posted"] != rows["REUSE"][
                    "declared_expected_error_loss_not_posted"]):
            raise TrajectoryComparisonError("PREPARATION_PATTERN_RISK_BASELINE_CHANGED")
        joint = {
            "rebuild_minus_reuse_risk_adjusted_expected_cost": f"{Decimal(rows['REBUILD']['declared_risk_adjusted_expected_cost']) - Decimal(rows['REUSE']['declared_risk_adjusted_expected_cost']):.2f}",
            "same_declared_error_risk_not_assumed_to_improve_from_reuse": True,
            "expected_error_loss_not_an_added_original_resource_cost": True,
            "no_new_mode_ranking_or_automatic_decision": True,
        }
    return {
        "schema": "AKIS_ORIGINAL_PREPARATION_PATTERN_REUSE_COMPARISON/1.0",
        "status": "MODEL_ORIGINAL_STRUCTURAL_PATTERN_REUSE_COST_CONTRAST",
        "original_baseline_fingerprint_sha256": baseline,
        "same_original_works_results_consents_and_cash": True,
        "same_original_capacity_and_event_sequence": True,
        "local_research_only": {
            "arms": rows,
            "rebuild_minus_reuse_declared_preparation_cost": f"{Decimal(rows['REBUILD']['declared_preparation_resource_cost']) - Decimal(rows['REUSE']['declared_preparation_resource_cost']):.2f}",
            **joint,
        },
        "full_author_standardization_and_experience_return_ratios_established": False,
        "empirical_operator_capital_value": "NOT_IDENTIFIABLE",
        "profit": "UNKNOWN",
    }


def compare_original_market_formation_outcomes(
    scenarios: Mapping[str, Mapping[str, Any]], *, work: str, prior_works: tuple[str, ...],
) -> dict[str, Any]:
    """Controlled MODEL_ONLY acceptance/refusal comparison, same original Mesa.

    The failed formation carries its independently declared noncash costs,
    not an assumed free or financially verified alternative. Compare only
    matched original histories, opening positions, and common preparation
    rows. No new scheduler, legal agreement, accounting profit or empirical
    estimator is introduced.
    """
    from copy import deepcopy
    from decimal import Decimal
    from .mesa_model import simulate

    if (not isinstance(scenarios, Mapping) or set(scenarios) != {"accepted", "refused"}
            or not isinstance(work, str) or not isinstance(prior_works, tuple) or not prior_works
            or len(set((*prior_works, work))) != len(prior_works)+1):
        raise TrajectoryComparisonError("FORMATION_CONTRAST_MATCHED_DESIGN_REQUIRED")
    a, b = (scenarios[key] for key in ("accepted", "refused"))
    if any(d.get("strict_economic_source_works") != [*prior_works, work] for d in (a, b)):
        raise TrajectoryComparisonError("FORMATION_CONTRAST_STRICT_WORK_SCOPE_REQUIRED")
    if ({k: v for k, v in a.items() if k not in {"events", "economic_claims"}} !=
            {k: v for k, v in b.items() if k not in {"events", "economic_claims"}}):
        raise TrajectoryComparisonError("FORMATION_CONTRAST_INITIAL_STATE_CHANGED")
    am, bm = a["economic_claims"], b["economic_claims"]
    raw = bm.get("uncommitted_order_cost_evidence", {})
    if raw.get("work") != work or am.get("market_order_economics", {}).get("work") != work:
        raise TrajectoryComparisonError("FORMATION_CONTRAST_SELECTED_SCOPE_REQUIRED")
    refusing = raw.get("refusing_owner")
    split = raw.get("refusal_at")
    expected_events = deepcopy(a["events"])
    interest = [e for e in expected_events if e.get("work") == work
                and e["action"] == "interest_update" and e["actor"] == refusing and e["at"] == split]
    consents = [e for e in expected_events if e.get("work") == work
                and e["action"] == "consent" and e["actor"] == refusing and e["at"] > split]
    if len(interest) != 1 or len(consents) != 1 or interest[0]["new_willingness"] != "WILLING":
        raise TrajectoryComparisonError("FORMATION_CONTRAST_ONLY_ORIGINAL_REFUSAL_MAY_CHANGE")
    interest[0]["new_willingness"] = "DECLINES"
    expected_events.remove(consents[0])
    if expected_events != b["events"]:
        raise TrajectoryComparisonError("FORMATION_CONTRAST_ONLY_ORIGINAL_REFUSAL_MAY_CHANGE")
    allowed = {"period", "currency", "sources", "transfers", "resource_uses", "coverage",
               "outside_feasibility", "cash_timing", "lifecycle_costs", "work_payment_conditions",
               "work_payment_settlement_claims", "work_payment_due_amendments",
               "recipient_use_value_evidence", "market_order_economics", "uncommitted_order_cost_evidence"}
    if any(set(m) - allowed or set(m["lifecycle_costs"]) - {"bindings", "scope_proofs", "event_bindings"}
           for m in (am, bm)):
        raise TrajectoryComparisonError("FORMATION_CONTRAST_UNSUPPORTED_FINANCIAL_SCOPE")
    for field in ("period", "currency", "sources", "coverage", "outside_feasibility"):
        if am.get(field) != bm.get(field):
            raise TrajectoryComparisonError("FORMATION_CONTRAST_FINANCIAL_BASELINE_CHANGED")
    for field in ("horizon_end", "owner_positions"):
        if am["cash_timing"].get(field) != bm["cash_timing"].get(field):
            raise TrajectoryComparisonError("FORMATION_CONTRAST_FINANCIAL_BASELINE_CHANGED")
    if am["lifecycle_costs"]["scope_proofs"] != bm["lifecycle_costs"]["scope_proofs"]:
        raise TrajectoryComparisonError("FORMATION_CONTRAST_FINANCIAL_BASELINE_CHANGED")
    if any(t["work"] not in prior_works for t in bm["transfers"]):
        raise TrajectoryComparisonError("FORMATION_CONTRAST_UNCOMMITTED_TRANSFERS_FORBIDDEN")
    prior = {t["id"] for t in bm["transfers"]}
    kept = {r["id"] for r in bm["resource_uses"]}
    if ([t for t in am["transfers"] if t["work"] in prior_works] != bm["transfers"]
            or [r for r in am["resource_uses"] if r["id"] in kept] != bm["resource_uses"]
            or [r for r in am["resource_uses"] if r["work"] in prior_works] !=
               [r for r in bm["resource_uses"] if r["work"] in prior_works]):
        raise TrajectoryComparisonError("FORMATION_CONTRAST_COMMON_FINANCIAL_HISTORY_CHANGED")
    for field in ("work_payment_conditions", "work_payment_settlement_claims", "work_payment_due_amendments"):
        if [r for r in am.get(field, []) if r["transfer_id"] in prior] != bm.get(field, []):
            raise TrajectoryComparisonError("FORMATION_CONTRAST_COMMON_FINANCIAL_HISTORY_CHANGED")
    if ([r for r in am["cash_timing"]["transfer_windows"] if r["transfer_id"] in prior]
            != bm["cash_timing"]["transfer_windows"]):
        raise TrajectoryComparisonError("FORMATION_CONTRAST_COMMON_FINANCIAL_HISTORY_CHANGED")
    for field in ("bindings", "event_bindings"):
        if [r for r in am["lifecycle_costs"][field] if r["resource_use_id"] in kept] != bm["lifecycle_costs"][field]:
            raise TrajectoryComparisonError("FORMATION_CONTRAST_COMMON_FINANCIAL_HISTORY_CHANGED")
    # All shared preparation costs must remain in both arms, not just a
    # convenient subset. Prior works and actual precommit attempts are fixed.
    commit_tick = next(e["at"] for e in a["events"] if e.get("work") == work and e["action"] == "commit")
    expected_shared_costs = {r["resource_use_id"] for r in am["lifecycle_costs"]["event_bindings"]
                             if r["work"] != work or r["at"] < commit_tick}
    if kept != expected_shared_costs:
        raise TrajectoryComparisonError("FORMATION_CONTRAST_COMMON_FINANCIAL_HISTORY_CHANGED")
    value = am["recipient_use_value_evidence"]
    if len(value) != 1 or value[0]["work"] != work:
        raise TrajectoryComparisonError("FORMATION_CONTRAST_SELECTED_RECIPIENT_VALUE_REQUIRED")
    obs = raw["recipient_no_order_observation"]
    if (any(obs[field] != value[0][field] for field in ("unit", "basis", "valuation_horizon"))
            or obs["quantity"] != value[0]["baseline"]["quantity"]):
        raise TrajectoryComparisonError("FORMATION_CONTRAST_RECIPIENT_NO_ORDER_QUANTITY_NOT_MATCHED")
    frozen = deepcopy(scenarios)
    oa, ob = simulate(deepcopy(a)), simulate(deepcopy(b))
    if frozen != scenarios:
        raise TrajectoryComparisonError("FORMATION_CONTRAST_INPUT_MUTATED")
    if ([e for e in oa["trace"] if e["at"] < split] != [e for e in ob["trace"] if e["at"] < split]
            or any(oa["works"][key] != ob["works"][key]
                   or oa["works"][key]["result"] != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                   for key in prior_works)):
        raise TrajectoryComparisonError("FORMATION_CONTRAST_HISTORICAL_ORIGINAL_RESULT_CHANGED")
    left = oa["economics"].get("original_market_order_economics", {})
    right = ob["economics"].get("original_uncommitted_order_costs", {})
    if (left.get("status") != "MODEL_ORIGINAL_ACCEPTED_ORDER_ECONOMICS"
            or right.get("status") != "MODEL_ORIGINAL_UNCOMMITTED_ORDER_COST_SCOPE"):
        return {"status": "UNKNOWN_ORIGINAL_FORMATION_ECONOMIC_SCOPE",
                "empirical_network_additionality": "NOT_IDENTIFIABLE"}
    accepted_value = Decimal(left["local_research_only"]["consolidated_model_contribution"])
    refused_value = -Decimal(right["local_research_only"]["total_exclusive_precommit_resource_cost"])
    delta = accepted_value - refused_value
    return {
        "schema": "AKIS_MATCHED_ORIGINAL_MARKET_FORMATION_OUTCOMES/1.0",
        "status": "MODEL_MATCHED_ORIGINAL_FORMATION_VALUE_CONTRAST",
        "common_prior_and_precommit_costs_preserved": True,
        "recipient_declared_no_order_quantity_matched": True,
        "original_accepted_route_and_independent_refusal_executed_separately": True,
        "no_order_cash_zero_independently_declared_not_assumed": True,
        "buyer_no_order_observation_is_model_only": True,
        "model_contribution_contrast_direction": "POSITIVE" if delta > 0 else "ZERO" if delta == 0 else "NEGATIVE",
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
        "local_research_only": {
            "accepted_selected_model_contribution": f"{accepted_value:.2f}",
            "refused_selected_model_contribution": f"{refused_value:.2f}",
            "accepted_minus_refused_model_contribution": f"{delta:.2f}",
        },
    }


def _compare_qualified_activity_efficiency(arms: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    """Read-only decomposition of given, independently executed matched arms."""
    from decimal import Decimal
    from itertools import combinations
    fields = ("gross_incremental_recipient_use_value", "external_declared_transfer_inflows",
              "external_declared_transfer_outflows", "exclusive_noncash_resource_cost",
              "external_outflows_plus_exclusive_resource_cost", "model_economic_contribution")

    def difference(left, right, keys):
        return {k: f"{Decimal(left[k])-Decimal(right[k]):.2f}" for k in keys}

    contrasts = []
    for left, right in combinations(sorted(arms), 2):
        a, b = arms[left], arms[right]
        if (set(a["per_original_work"]) != set(b["per_original_work"])
                or set(a["reserved_capacity_unit_ticks_by_resource"])
                    != set(b["reserved_capacity_unit_ticks_by_resource"])):
            raise TrajectoryComparisonError("ACTIVITY_EFFICIENCY_MATCHED_ORIGINAL_SCOPE_MISMATCH")
        total = difference(a["consolidated"], b["consolidated"], fields)
        by_work = {k: difference(a["per_original_work"][k], b["per_original_work"][k], fields)
                   for k in sorted(a["per_original_work"])}
        if (sum((Decimal(v["model_economic_contribution"]) for v in by_work.values()), Decimal(0))
                    != Decimal(total["model_economic_contribution"])
                or Decimal(total["gross_incremental_recipient_use_value"])
                    + Decimal(total["external_declared_transfer_inflows"])
                    - Decimal(total["external_outflows_plus_exclusive_resource_cost"])
                    != Decimal(total["model_economic_contribution"])):
            raise TrajectoryComparisonError("ACTIVITY_EFFICIENCY_MATCHED_ORIGINAL_CONSOLIDATION_MISMATCH")
        contrasts.append({
            "left": left, "right": right,
            "left_minus_right_consolidated": total,
            "left_minus_right_by_original_work": by_work,
            "left_minus_right_exclusive_resource_cost_by_stage": difference(
                a["exclusive_resource_cost_by_stage"], b["exclusive_resource_cost_by_stage"],
                sorted(a["exclusive_resource_cost_by_stage"])),
            "left_minus_right_exclusive_resource_cost_by_nature": difference(
                a["exclusive_resource_cost_by_nature"], b["exclusive_resource_cost_by_nature"],
                sorted(a["exclusive_resource_cost_by_nature"])),
            "left_minus_right_accepted_work_count": (
                a["accepted_original_work_count"]-b["accepted_original_work_count"]),
            "left_minus_right_reserved_capacity_unit_ticks_by_resource": {
                k: a["reserved_capacity_unit_ticks_by_resource"][k]
                   - b["reserved_capacity_unit_ticks_by_resource"][k]
                for k in sorted(a["reserved_capacity_unit_ticks_by_resource"])},
        })
    return {"schema": "AKIS_MATCHED_ORIGINAL_ACTIVITY_EFFICIENCY/1.0",
            "arms": dict(arms), "pairwise": contrasts,
            "only_observation_of_independently_executed_arms": True,
            "no_route_search_ranking_or_owner_decision": True}


def compare_original_competing_market_routes(
    scenarios: Mapping[str, Mapping[str, Any]], *, work: str,
    prior_works: tuple[str, ...], split_at: int, secondary_work: str | None = None,
) -> dict[str, Any]:
    """Execute matched competing production plans for ONE original recipient.

    One existing Mesa per counterfactual arm, never two simultaneous claims
    on the same demand. Identical pre-decision events, sources, capacity,
    history and opening reserves. Only selected route decisions and their
    original Work economics may differ. No optimization over undisclosed
    alternatives, no consent, payment, new ledger or real causal inference.
    """
    from copy import deepcopy
    from decimal import Decimal
    from itertools import combinations
    from .mesa_model import simulate

    if (not isinstance(scenarios, Mapping) or not 2 <= len(scenarios) <= MAX_ARMS
            or any(not isinstance(k, str) or not k or len(k) > 64 for k in scenarios)
            or not isinstance(work, str) or not work
            or not isinstance(prior_works, tuple) or not prior_works
            or len(set((*prior_works, work))) != len(prior_works)+1
            or type(split_at) is not int or split_at < 0):
        raise TrajectoryComparisonError("COMPETING_MARKET_MATCHED_DESIGN_REQUIRED")
    portfolio = secondary_work is not None
    if portfolio and (not isinstance(secondary_work, str) or not secondary_work
                      or secondary_work in {*prior_works, work}):
        raise TrajectoryComparisonError("PORTFOLIO_DISTINCT_SECONDARY_WORK_REQUIRED")
    selected_keys = {work, secondary_work} if portfolio else {work}
    strict_keys = [*prior_works, work] + ([secondary_work] if portfolio else [])
    names = sorted(scenarios)
    ref = None
    designs, plans = {}, {}
    second_valuation = None
    second_executed_economics = None
    accepted = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    allowed = {"period", "currency", "sources", "transfers", "resource_uses",
               "coverage", "outside_feasibility", "cash_timing", "lifecycle_costs",
               "work_payment_conditions", "work_payment_settlement_claims",
               "work_payment_due_amendments", "recipient_use_value_evidence",
               "market_order_economics"}
    if portfolio:
        allowed |= {"portfolio_scope_evidence", "uncommitted_order_cost_evidence"}

    for name in names:
        doc = scenarios[name]
        if (not isinstance(doc, Mapping)
                or doc.get("strict_economic_source_works") != strict_keys
                or doc.get("strict_economic_source_work") is not None):
            raise TrajectoryComparisonError("COMPETING_MARKET_ORIGINAL_STRICT_SCOPE_REQUIRED")
        baseline = {k: v for k, v in doc.items() if k not in {"events", "economic_claims"}}
        events = doc.get("events")
        if not isinstance(events, list) or any(
                not isinstance(e, Mapping) or type(e.get("at")) is not int for e in events):
            raise TrajectoryComparisonError("COMPETING_MARKET_ORIGINAL_EVENTS_REQUIRED")
        prefix = [e for e in events if e["at"] <= split_at]
        later = [e for e in events if e["at"] > split_at]
        secondary = {}
        if portfolio:
            secondary_events = [e for e in later if e.get("work", e.get("work_spec", {}).get("id")) == secondary_work]
            later = [e for e in later if e not in secondary_events]
            second_requests = [e for e in secondary_events if e["action"] == "request"]
            second_commits = [e for e in secondary_events if e["action"] == "commit"]
            if len(second_requests) != 1 or len(second_commits) != 1:
                raise TrajectoryComparisonError("PORTFOLIO_ORIGINAL_SECONDARY_REQUEST_AND_COMMIT_REQUIRED")
            second_request = second_requests[0]
            origin = second_request.get("outside_work_origin", {})
            if set(origin) != {"outside_demand_id", "outside_offer_id", "outside_buyer_response_id"}:
                raise TrajectoryComparisonError("PORTFOLIO_INDEPENDENT_SECONDARY_ORIGIN_REQUIRED")
            signals = [e for e in prefix if e["action"] in {
                "outside_demand_signal", "outside_supplier_offer", "outside_buyer_offer_response"}
                and e.get("outside_demand_id") == origin["outside_demand_id"]]
            if (len(signals) != 3 or {e["action"] for e in signals} != {
                    "outside_demand_signal", "outside_supplier_offer", "outside_buyer_offer_response"}
                    or signals[0].get("outside_candidate_work") != work
                    or not signals[0].get("outside_candidate_operation")):
                raise TrajectoryComparisonError("PORTFOLIO_SECONDARY_COMMON_PREDECISION_MARKET_REQUIRED")
            secondary = {"events": secondary_events, "request": second_request,
                         "commit_at": second_commits[0]["at"], "market_signals": signals}
        if any((e.get("work") != work
                and not (e["action"] == "request" and e.get("work_spec", {}).get("id") == work)
                and not (e["action"] == "technology_route_propose"
                         and e.get("technology_route_work") == work)
                and e["action"] != "technology_route_response")
               for e in later):
            raise TrajectoryComparisonError("COMPETING_MARKET_OTHER_POST_SPLIT_EVENT")
        proposals = [e for e in later if e["action"] == "technology_route_propose"]
        requests = [e for e in later if e["action"] == "request"]
        commits = [e for e in later if e["action"] == "commit"]
        if not len(proposals) == len(requests) == len(commits) == 1:
            raise TrajectoryComparisonError("COMPETING_MARKET_ONE_ORIGINAL_ROUTE_PER_ARM_REQUIRED")
        proposal, request, commit = proposals[0], requests[0], commits[0]
        spec = request["work_spec"]
        route = proposal.get("technology_route_id")
        market = proposal.get("technology_route_market_scope")
        if (not isinstance(market, Mapping) or not isinstance(route, str)
                or proposal.get("technology_route_work_spec") != spec
                or request.get("technology_route_id") != route
                or not split_at < proposal["at"] < request["at"] < commit["at"]
                or any(e.get("technology_route_id") != route for e in later
                       if e["action"] == "technology_route_response")
                or any(e.get("technology_route_market_scope") != market for e in (request, commit))):
            raise TrajectoryComparisonError("COMPETING_MARKET_ORIGINAL_ROUTE_BINDING_REQUIRED")
        # Same technological problem, not identical equipment assignments.
        # Each operation uses one original primary resource; preserve DAG,
        # required units, planned slots, criteria and recipient. Material
        # substitution and risk equivalence are separate experiments.
        operations = spec.get("operations", [])
        if (not isinstance(operations, list) or len(operations) < 2
                or any(len(o["resource_requirements"]) != 1
                       or o["resource_requirements"][0]["resource"] != o["primary_resource"]
                       for o in operations)):
            raise TrajectoryComparisonError("COMPETING_MARKET_COMPARABLE_STAGE_PLAN_REQUIRED")
        criteria = spec.get("assurance_criteria", [])
        if not criteria or spec.get("material_batches"):
            raise TrajectoryComparisonError("COMPETING_MARKET_COMPARABLE_QUALITY_SCOPE_REQUIRED")
        problem = {
            "work": {k: v for k, v in spec.items()
                     if k not in {"resource", "resource_requirements", "operations", "assurance_criteria"}},
            "operations": sorted(
                (o["id"], tuple(sorted(o["requires_completed"])), o["slot_start"],
                 o["slot_end"], o["resource_requirements"][0]["units"]) for o in operations),
            "criteria": sorted(
                (c["id"], c["dimension"], c["operation"], c["assessor"],
                 c["method"], c["source_ref"], c["source_revision"]) for c in criteria),
            "market": market,
            "relation": (proposal.get("cooperation_link"), proposal.get("cooperation_source_revision"),
                         proposal.get("pilot_work"), proposal.get("pilot_result_ref"),
                         proposal.get("technology_route_model_code_change_id")),
        }
        commercial = proposal.get("technology_route_commercial_terms")
        if commercial is not None:
            if (not isinstance(commercial, Mapping) or any(
                    e.get("technology_route_commercial_terms") != commercial for e in (request, commit))):
                raise TrajectoryComparisonError("COMPETING_MARKET_ORIGINAL_COMMERCIAL_BINDING_REQUIRED")
            problem["commercial_budget_basis"] = {k: commercial[k] for k in
                ("work", "work_revision", "buyer", "currency", "buyer_maximum_payment", "buyer_source")}
        plans[name] = tuple(sorted((o["id"], o["primary_resource"]) for o in operations))
        money = doc.get("economic_claims")
        if (not isinstance(money, Mapping) or set(money) - allowed
                or set(money.get("lifecycle_costs", {})) - {"bindings", "scope_proofs", "event_bindings"}
                or set(money.get("cash_timing", {})) - {"horizon_end", "owner_positions", "transfer_windows"}):
            raise TrajectoryComparisonError("COMPETING_MARKET_UNSUPPORTED_FINANCIAL_SCOPE")
        life, timing = money["lifecycle_costs"], money["cash_timing"]
        if timing["horizon_end"] != doc.get("model_horizon") or split_at >= timing["horizon_end"]:
            raise TrajectoryComparisonError("COMPETING_MARKET_MATCHED_HORIZON_REQUIRED")
        all_values = money.get("recipient_use_value_evidence", [])
        value = [v for v in all_values if v.get("work") == work] if portfolio else all_values
        if (len(value) != 1 or value[0].get("work") != work
                or value[0].get("owner") != spec["customer"]
                or money.get("market_order_economics", {}).get("work") != work):
            raise TrajectoryComparisonError("COMPETING_MARKET_SELECTED_RECIPIENT_VALUE_REQUIRED")
        # Valuation basis and rate are held fixed; outcome may genuinely
        # differ after execution. A different buyer/rate is not this contrast.
        valuation = {k: value[0][k] for k in
                     ("owner", "work_revision", "basis", "unit", "valuation_horizon", "baseline", "rate")}
        finance = {k: money.get(k) for k in
                   ("period", "currency", "sources", "coverage", "outside_feasibility")}
        finance.update(horizon=timing["horizon_end"], openings=timing["owner_positions"],
                       resource_scope=life["scope_proofs"])
        historical = {}
        for field in ("transfers", "resource_uses"):
            rows = money[field]
            if any(r.get("work") not in set(strict_keys)
                   or r.get("scenario") != "COOPERATION" for r in rows):
                raise TrajectoryComparisonError("COMPETING_MARKET_ONLY_ORIGINAL_ORDER_ROWS_REQUIRED")
            historical[field] = [r for r in rows if r["work"] in prior_works]
        tids = {r["id"] for r in historical["transfers"]}
        cids = {r["id"] for r in historical["resource_uses"]}
        for field, rows, key, ids, clocks in (
            ("windows", timing["transfer_windows"], "transfer_id", tids, ("at", "late_at")),
            ("terms", money.get("work_payment_conditions", []), "transfer_id", tids, ("due_at",)),
            ("settlements", money.get("work_payment_settlement_claims", []), "transfer_id", tids, ("at",)),
            ("amendments", money.get("work_payment_due_amendments", []), "transfer_id", tids,
             ("agreed_at", "new_due_at")),
            ("bindings", life["bindings"], "resource_use_id", cids, ()),
            ("cost_events", life["event_bindings"], "resource_use_id", cids, ("at",)),
        ):
            attached = [r for r in rows if r[key] in ids]
            if any(type(r[t]) is not int or r[t] > split_at for r in attached for t in clocks if t in r):
                raise TrajectoryComparisonError("COMPETING_MARKET_PRIOR_EVIDENCE_AFTER_SPLIT")
            historical[field] = attached
        # No selected-route cost or transfer may be moved into the shared
        # history. A separately executed common preparation experiment is
        # needed if the choice itself incurred earlier costs.
        if (any(r["work"] == work and r["at"] <= split_at for r in life["event_bindings"])
                or any(r["transfer_id"] not in tids and r["at"] <= split_at
                       for r in timing["transfer_windows"])):
            raise TrajectoryComparisonError("COMPETING_MARKET_PRE_SPLIT_SELECTED_COST_UNSUPPORTED")
        if portfolio:
            if (money.get("portfolio_scope_evidence", {}).get("works") != [work, secondary_work]
                    or secondary["request"]["work_spec"]["customer"] == spec["customer"]):
                raise TrajectoryComparisonError("PORTFOLIO_DISTINCT_RECIPIENT_AND_FIXED_SCOPE_REQUIRED")
            second_values = [v for v in money.get("recipient_use_value_evidence", [])
                             if v.get("work") == secondary_work]
            no_order = money.get("uncommitted_order_cost_evidence", {})
            if len(second_values) == 1 and not no_order:
                v = second_values[0]
                second_baseline = {"quantity": v["baseline"]["quantity"], "unit": v["unit"],
                                   "basis": v["basis"], "valuation_horizon": v["valuation_horizon"]}
                secondary_valuation = {k: v[k] for k in ("owner", "work_revision", "baseline", "rate")}
                if second_valuation is not None and second_valuation != secondary_valuation:
                    raise TrajectoryComparisonError("PORTFOLIO_SECONDARY_VALUATION_BASIS_CHANGED")
                # Store separately from per-arm selected route descriptions.
                second_valuation = secondary_valuation
                # When both arms execute the independent order, its own
                # value and cost/payment basis must remain fixed. Changes
                # in independent production economics are separate trials.
                tr = [r for r in money["transfers"] if r["work"] == secondary_work]
                ru = [r for r in money["resource_uses"] if r["work"] == secondary_work]
                ti, ri = {r["id"] for r in tr}, {r["id"] for r in ru}
                executed = {"value": v, "transfers": tr, "resource_uses": ru,
                            "windows": [r for r in timing["transfer_windows"] if r["transfer_id"] in ti],
                            "terms": [r for r in money.get("work_payment_conditions", []) if r["transfer_id"] in ti],
                            "settlements": [r for r in money.get("work_payment_settlement_claims", []) if r["transfer_id"] in ti],
                            "amendments": [r for r in money.get("work_payment_due_amendments", []) if r["transfer_id"] in ti],
                            "bindings": [r for r in life["bindings"] if r["resource_use_id"] in ri],
                            "cost_events": [{k: val for k, val in r.items() if k != "trace_position"}
                                            for r in life["event_bindings"] if r["resource_use_id"] in ri]}
                if second_executed_economics is not None and second_executed_economics != executed:
                    raise TrajectoryComparisonError("PORTFOLIO_SECONDARY_EXECUTED_ECONOMICS_CHANGED")
                second_executed_economics = executed
            elif not second_values and no_order.get("work") == secondary_work and "capacity_block" in no_order:
                second_baseline = {k: no_order["recipient_no_order_observation"][k] for k in
                                   ("quantity", "unit", "basis", "valuation_horizon")}
            else:
                raise TrajectoryComparisonError("PORTFOLIO_SECONDARY_ACCEPTED_VALUE_OR_BLOCK_EVIDENCE_REQUIRED")
            if {v.get("work") for v in money.get("recipient_use_value_evidence", [])} != (
                    {work, secondary_work} if second_values else {work}):
                raise TrajectoryComparisonError("PORTFOLIO_UNRELATED_RECIPIENT_VALUE")
            secondary["valuation_baseline"] = second_baseline
            second_bindings = [b for b in life["event_bindings"]
                               if b["work"] == secondary_work and b["at"] < secondary["commit_at"]]
            second_pre_ids = {b["resource_use_id"] for b in second_bindings}
            secondary["precommit_costs"] = {
                "resource_rows": [r for r in money["resource_uses"] if r["id"] in second_pre_ids],
                "cost_anchors": [{k: v for k, v in b.items() if k != "trace_position"}
                                 for b in second_bindings],
                "classifications": [b for b in life["bindings"] if b["resource_use_id"] in second_pre_ids],
            }
        design = dict(baseline=baseline, prefix=prefix, problem=problem,
                      valuation=valuation, finance=finance, historical=historical, secondary=secondary)
        if ref is not None:
            for key, reason in (
                ("baseline", "INITIAL_STATE_CHANGED"), ("prefix", "COMMON_PREFIX_CHANGED"),
                ("problem", "DEMAND_OR_TECHNOLOGY_SCOPE_CHANGED"),
                ("valuation", "RECIPIENT_VALUATION_BASIS_CHANGED"),
                ("finance", "FINANCIAL_BASELINE_CHANGED"),
                ("historical", "PRIOR_FINANCIAL_HISTORY_CHANGED"),
                ("secondary", "SECONDARY_DEMAND_PREPARATION_OR_BASELINE_CHANGED"),
            ):
                if design[key] != ref[key]:
                    raise TrajectoryComparisonError("COMPETING_MARKET_" + reason)
        ref = design
        designs[name] = (route, spec, proposal["at"], commit["at"])
    if len(set(plans.values())) != len(plans):
        raise TrajectoryComparisonError("COMPETING_MARKET_DISTINCT_RESOURCE_PLANS_REQUIRED")

    if portfolio and second_valuation is None:
        raise TrajectoryComparisonError("PORTFOLIO_NO_EXECUTED_SECONDARY_ALTERNATIVE")
    frozen = deepcopy(scenarios)
    outputs = {name: simulate(deepcopy(scenarios[name])) for name in names}
    if scenarios != frozen:
        raise TrajectoryComparisonError("COMPETING_MARKET_INPUT_MUTATED")
    owner_ids = {r["id"] for r in ref["baseline"]["subjects"]}
    history = None
    observed_prefix = None
    owner_views, arm_views, reasons = {}, {}, set()
    efficiency_views = {}
    met = "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    for name in names:
        out, doc = outputs[name], scenarios[name]
        route, spec, proposed_at, committed_at = designs[name]
        trace = out["trace"]
        prefix = [e for e in trace if e["at"] <= split_at]
        prior = [out["works"].get(w) for w in prior_works]
        if (set(out["subjects"]) != owner_ids
                or any(r is None or r["result"] != accepted for r in prior)
                or any(sum(e.get("work") == w and e["action"] == "accept"
                           and e["outcome"] == "APPLIED" for e in prefix) != 1 for w in prior_works)
                or (history is not None and history != prior)
                or (observed_prefix is not None and observed_prefix != prefix)):
            raise TrajectoryComparisonError("COMPETING_MARKET_ORIGINAL_HISTORY_CHANGED")
        history, observed_prefix = prior, prefix
        econ = out["economics"]
        selected = out["works"].get(work, {})
        market = econ.get("original_market_order_economics", {})
        applied = [e for e in trace if e["outcome"] == "APPLIED" and e.get("work") == work]
        commits = [e for e in applied if e["action"] == "commit" and e["at"] == committed_at]
        if (selected.get("result") != accepted or selected.get("obligation") != "FULFILLED"
                or len(commits) != 1 or sum(e["action"] == "accept" for e in applied) != 1
                or not any(e["action"] == "technology_route_propose"
                           and e.get("technology_route_id") == route and e["at"] == proposed_at
                           and e["outcome"] == "APPLIED" for e in trace)
                or not commits[0].get("technology_route_market_feasibility", {}).get(
                    "selected_cooperative_plan_preview_feasible")
                or market.get("status") != "MODEL_ORIGINAL_ACCEPTED_ORDER_ECONOMICS"):
            reasons.add("ORIGINAL_SELECTED_ROUTE_OR_ECONOMICS_INCOMPLETE")
            continue
        if (not out.get("context_basis", {}).get("strict")
                or econ.get("original_strict_context_source_qualification", {}).get("status")
                   != "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED"
                or out.get("profit", {}).get("system_increment") != "UNKNOWN"):
            reasons.add("ORIGINAL_STRICT_SCOPE_OR_EMPIRICAL_BOUNDARY_INCOMPLETE")
            continue
        if ("commercial_budget_basis" in ref["problem"] and not
                market.get("original_precommit_commercial_terms_matched_to_payment_conditions")):
            reasons.add("ORIGINAL_PRECOMMIT_COMMERCIAL_TERMS_NOT_QUALIFIED")
            continue
        if portfolio:
            pv = econ.get("original_portfolio_economics", {})
            if pv.get("status") != "MODEL_ORIGINAL_MULTI_ORDER_PORTFOLIO_ECONOMICS":
                reasons.add("ORIGINAL_PORTFOLIO_ECONOMICS_INCOMPLETE")
                continue
            second = out["works"].get(secondary_work, {})
            second_result = second.get("result") == accepted and second.get("obligation") == "FULFILLED"
            if (not second_result and not econ.get("original_uncommitted_order_costs", {}).get(
                    "original_capacity_conflict_applied")):
                reasons.add("ORIGINAL_SECONDARY_CAPACITY_OUTCOME_INCOMPLETE")
                continue
            if not second_result and doc["economic_claims"]["uncommitted_order_cost_evidence"][
                    "capacity_block"]["competing_work"] != work:
                raise TrajectoryComparisonError("PORTFOLIO_SECONDARY_CONFLICT_NOT_FROM_SELECTED_ROUTE")
            local = pv["local_research_only"]
            amounts = {o: Decimal(v["model_contribution"]) for o, v in local["per_owner"].items()}
            if set(amounts) != owner_ids or sum(amounts.values(), Decimal(0)) != Decimal(
                    local["consolidated_model_contribution"]):
                raise TrajectoryComparisonError("PORTFOLIO_FIXED_OWNER_CONSOLIDATION_MISMATCH")
            owner_views[name] = amounts
            efficiency_views[name] = local["activity_efficiency"]
            arm_views[name] = {
                "consolidated_model_contribution": local["consolidated_model_contribution"],
                "gross_recipient_use_value": local["gross_incremental_recipient_use_value"],
                "per_owner_model_contribution": {o: f"{v:.2f}" for o, v in amounts.items()},
                "accepted_original_order_count": pv["original_accepted_order_count"],
                "secondary_order_accepted": second_result,
                "secondary_order_blocked_by_capacity": not second_result,
                "all_owner_declared_reserves_met": pv["all_owner_declared_reserves_met"],
                "all_owner_nonnegative_model_contribution_and_reserves": (
                    all(v >= 0 for v in amounts.values()) and pv["all_owner_declared_reserves_met"]),
            }
            continue
        local = market["local_research_only"]
        amounts = {}
        reserves = {}
        # Fixed original population: a displaced enterprise is not silently
        # omitted from the comparison. Explicit owner-wide monetary and cost
        # coverage plus no selected order rows qualify a zero FOR THIS ORDER.
        # That is never its outside business income or zero opportunity cost.
        for owner in sorted(owner_ids):
            owned = local["per_owner"].get(owner)
            money = doc["economic_claims"]
            if owned is None:
                if (not econ["per_subject"][owner]["declared_complete"]["COOPERATION"]
                        or not econ["lifecycle_resource_costs"]["owner_scoped_details"][owner][
                            "scenarios"]["COOPERATION"]["declared_resource_scope_complete_not_audited"]
                        or any(t["work"] == work and owner in {t["payer"], t["payee"]}
                               for t in money["transfers"])
                        or any(r["work"] == work and owner == r["owner"] for r in money["resource_uses"])):
                    reasons.add("ORIGINAL_DISPLACED_OWNER_ZERO_ORDER_SCOPE_INCOMPLETE")
                    continue
            amounts[owner] = Decimal(owned["model_contribution"]) if owned else Decimal(0)
            path = econ.get("cash_timing", {}).get("per_original_owner_private_research_projection", {}).get(
                owner, {}).get("scenario_paths", {}).get("COOPERATION", {})
            reserves[owner] = all(path.get(k, {}).get("status") == met
                                  for k in ("expected", "declared_late_case"))
            if any(path.get(k, {}).get("status") in (None, "NOT_IDENTIFIABLE")
                   for k in ("expected", "declared_late_case")):
                reasons.add("ORIGINAL_OWNER_RESERVE_SCOPE_INCOMPLETE")
        if set(amounts) != owner_ids:
            continue
        total = Decimal(local["consolidated_model_contribution"])
        if sum(amounts.values(), Decimal(0)) != total:
            raise TrajectoryComparisonError("COMPETING_MARKET_CONSOLIDATION_MISMATCH")
        owner_views[name] = amounts
        efficiency_views[name] = local["activity_efficiency"]
        arm_views[name] = {
            "consolidated_model_contribution": f"{total:.2f}",
            "gross_recipient_use_value": local["gross_incremental_recipient_use_value"],
            "per_owner_model_contribution": {k: f"{v:.2f}" for k, v in amounts.items()},
            "original_owner_reserves_met": reserves,
            "participating_owners": sorted(local["per_owner"]),
            "all_participating_owners_positive_and_reserves": market[
                "all_owner_positive_contribution_and_reserves"],
        }
    if portfolio:
        output = {
            "schema": "AKIS_MATCHED_ORIGINAL_MULTI_ORDER_PORTFOLIOS/1.0",
            "status": "UNKNOWN" if reasons else "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS",
            "original_route_count": len(names), "qualified_route_count": len(arm_views),
            "original_owner_count": len(owner_ids), "reasons": sorted(reasons),
            "same_original_secondary_demand_offer_response_and_preparation": True,
            "fixed_owner_boundary_and_historical_liquidity": True,
            "secondary_accepted_or_actual_original_capacity_block_required": True,
            "no_fictitious_lost_receipts_or_duplicate_opportunity_cost": True,
            "empirical_network_additionality": "NOT_IDENTIFIABLE",
        }
        if reasons:
            return output
        pairwise, summaries = [], []
        for left, right in combinations(names, 2):
            delta = {o: owner_views[left][o] - owner_views[right][o] for o in sorted(owner_ids)}
            total = sum(delta.values(), Decimal(0))
            pairwise.append({"left": left, "right": right, "left_minus_right_model_contribution": f"{total:.2f}",
                             "per_original_owner_left_minus_right": {o: f"{v:.2f}" for o, v in delta.items()}})
            summaries.append({"left": left, "right": right,
                              "left_weak_pareto_improvement_on_portfolio": total > 0 and all(v >= 0 for v in delta.values()),
                              "right_weak_pareto_improvement_on_portfolio": total < 0 and all(v <= 0 for v in delta.values()),
                              "left_secondary_result_accepted": arm_views[left]["secondary_order_accepted"],
                              "right_secondary_result_accepted": arm_views[right]["secondary_order_accepted"]})
        viable = [name for name in names if arm_views[name]["all_owner_nonnegative_model_contribution_and_reserves"]]
        best = []
        if viable:
            highest = max(sum(owner_views[n].values(), Decimal(0)) for n in viable)
            best = [n for n in viable if sum(owner_views[n].values(), Decimal(0)) == highest]
        return output | {"pairwise_contrasts": summaries,
                         "best_model_contribution_among_executed_portfolio_viable_routes": best,
                         "recommendation_does_not_replace_independent_selection_or_consents": True,
                         "local_research_only": {"arms": arm_views, "pairwise": pairwise,
                                                 "activity_efficiency": _compare_qualified_activity_efficiency(
                                                     efficiency_views)}}
    output = {
        "schema": "AKIS_MATCHED_ORIGINAL_COMPETING_MARKET_ROUTES/1.0",
        "status": "UNKNOWN" if reasons else "MODEL_MATCHED_EXECUTED_COMPETING_MARKET_ROUTES",
        "original_route_count": len(names),
        "qualified_route_count": len(arm_views),
        "original_owner_count": len(owner_ids),
        "reasons": sorted(reasons),
        "same_recipient_demand_catalogue_and_declared_quality_scope": True,
        "original_trajectories_executed_separately_not_duplicate_orders": True,
        "displaced_owner_zero_only_for_selected_order_not_outside_income": True,
        "actual_equal_product_quality_risk_and_market_profit_not_verified": True,
        **({"same_original_buyer_budget_and_precommit_commercial_terms_required": True}
           if "commercial_budget_basis" in ref["problem"] else {}),
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    if reasons:
        return output
    def direction(v):
        return "POSITIVE" if v > 0 else "NEGATIVE" if v < 0 else "ZERO"
    contrasts, summaries = [], []
    for left, right in combinations(names, 2):
        delta = {owner: owner_views[left][owner] - owner_views[right][owner]
                 for owner in sorted(owner_ids)}
        total = sum(delta.values(), Decimal(0))
        contrasts.append({
            "left": left, "right": right,
            "left_minus_right_model_contribution": f"{total:.2f}",
            "per_original_owner_left_minus_right": {k: f"{v:.2f}" for k, v in delta.items()},
        })
        summaries.append({
            "left": left, "right": right, "consolidated_direction": direction(total),
            "left_owner_gain_count": sum(v > 0 for v in delta.values()),
            "left_owner_loss_count": sum(v < 0 for v in delta.values()),
            "left_owner_equal_count": sum(v == 0 for v in delta.values()),
            "left_weak_pareto_improvement_on_selected_order": total > 0 and all(v >= 0 for v in delta.values()),
            "right_weak_pareto_improvement_on_selected_order": total < 0 and all(v <= 0 for v in delta.values()),
        })
    viable = [name for name in names if arm_views[name]["all_participating_owners_positive_and_reserves"]]
    best = []
    if viable:
        highest = max(sum(owner_views[name].values(), Decimal(0)) for name in viable)
        best = [name for name in viable if sum(owner_views[name].values(), Decimal(0)) == highest]
    output.update({
        "pairwise_contrasts": summaries,
        "qualified_participant_viable_route_count": len(viable),
        "best_model_contribution_among_executed_participant_viable_routes": best,
        "recommendation_does_not_replace_independent_selection_or_consents": True,
        "local_research_only": {"arms": arm_views, "pairwise": contrasts,
                                "activity_efficiency": _compare_qualified_activity_efficiency(
                                    efficiency_views)},
    })
    return output



def _fixed_timing_commercial_price_interval(doc, *, work, transfer, lower, upper, others_ok,
                                              qualified_outside_ceiling=None):
    """Intersect comparative value, original buyer budget and conservative liquidity.

    The candidate is only a price sensitivity over the existing owner-private
    timing arithmetic. No settlement claims, amended dates, credit, new Work,
    signed offer or future revenue are manufactured by this review.
    """
    from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
    from .economic_liquidity import evaluate_cash_timing

    base = {
        "status": "UNKNOWN",
        "fixed_original_payment_conditions_and_windows": True,
        "new_offer_and_fresh_consents_still_required": True,
        "actual_financing_not_verified": True,
        "private_owner_reserves_not_redisclosed": True,
    }
    buyer, seller = transfer["payer"], transfer["payee"]
    if qualified_outside_ceiling is None:
        proposals = [e for e in doc["events"] if e["action"] == "technology_route_propose"
                     and e.get("technology_route_work") == work]
        commercial = proposals[0].get("technology_route_commercial_terms") if len(proposals) == 1 else None
        if not commercial:
            return {**base, "reason": "ORIGINAL_INDEPENDENT_BUYER_BUDGET_NOT_QUALIFIED"}
        if commercial["buyer"] != buyer or len([o for o in commercial["offers"] if o["payee"] == seller]) != 1:
            return {**base, "reason": "ORIGINAL_PURCHASE_QUOTE_NOT_QUALIFIED"}
        fixed = sum((Decimal(o["amount"]) for o in commercial["offers"] if o["payee"] != seller), Decimal(0))
        budget_max = Decimal(commercial["buyer_maximum_payment"]) - fixed
    else:
        # This ceiling is the buyer's OWN original demand declaration,
        # qualified by the caller's executed portfolio review; it is not
        # a total budget, financing promise or consent to a revised offer.
        budget_max = qualified_outside_ceiling
    lo = int((lower * 100).to_integral_value(rounding=ROUND_CEILING))
    hi = int((min(upper, budget_max) * 100).to_integral_value(rounding=ROUND_FLOOR))
    private = {
        ("buyer_budget_available_for_selected_purchase" if qualified_outside_ceiling is None
         else "original_independent_demand_price_ceiling"): f"{budget_max:.2f}",
        "minimum_purchase_price": None, "maximum_purchase_price": None,
    }
    if not others_ok or lo > hi:
        return {**base, "status": "NO_PRICE_SATISFIES_VALUE_AND_BUYER_BUDGET",
                "local_research_only": private}
    money = doc["economic_claims"]
    sources = {s["id"]: s for s in money["sources"]}
    owners = {s["id"]: s for s in doc["subjects"]}
    due = {t["transfer_id"]: t["due_at"] for t in money.get("work_payment_conditions", [])}
    target = transfer["id"]
    cache = {}
    met = "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"

    def cash_at(cents):
        if cents not in cache:
            index = {t["id"]: {**t, "decimal_amount": (
                Decimal(cents) / 100 if t["id"] == target else Decimal(t["amount"]))}
                for t in money["transfers"]}
            paths = evaluate_cash_timing(
                money["cash_timing"], sources=sources, transfer_index=index,
                coverage=money["coverage"], subjects=owners, outside={},
                original_payment_due=due,
            )["per_original_owner_private_research_projection"]
            result = {}
            for owner, view in paths.items():
                path = view["scenario_paths"]["COOPERATION"]
                if path["status"] != "SOURCE_DECLARED_TIMING_ARITHMETIC_ONLY":
                    return None
                result[owner] = all(path[k]["status"] == met for k in ("expected", "declared_late_case"))
            cache[cents] = result
        return cache[cents]

    at_low, at_high = cash_at(lo), cash_at(hi)
    if at_low is None or at_high is None:
        return {**base, "reason": "ORIGINAL_CASH_TIMING_SCOPE_INCOMPLETE"}
    # Buyer reserve feasibility is nonincreasing in price, seller
    # nondecreasing, all other owner cash paths invariant. Search exact cents.
    if (not at_low[buyer] or not at_high[seller] or
            not all(v for k, v in at_low.items() if k not in {buyer, seller})):
        return {**base, "status": "NO_PRICE_SATISFIES_ALL_OWNER_RESERVES_AT_FIXED_TIMING",
                "local_research_only": private}
    left, right = lo, hi
    while left < right:
        mid = (left + right) // 2
        if cash_at(mid)[seller]:
            right = mid
        else:
            left = mid + 1
    reserve_min = left
    left, right = lo, hi
    while left < right:
        mid = (left + right + 1) // 2
        if cash_at(mid)[buyer]:
            left = mid
        else:
            right = mid - 1
    reserve_max = left
    if reserve_min > reserve_max:
        return {**base, "status": "NO_PRICE_SATISFIES_ALL_OWNER_RESERVES_AT_FIXED_TIMING",
                "local_research_only": private}
    assert all(cash_at(reserve_min).values()) and all(cash_at(reserve_max).values())
    private.update(minimum_purchase_price=f"{Decimal(reserve_min)/100:.2f}",
                   maximum_purchase_price=f"{Decimal(reserve_max)/100:.2f}")
    return {**base, "status": "MODEL_VALUE_BUDGET_AND_RESERVE_PRICE_INTERVAL",
            "exact_cent_endpoints_qualified_in_expected_and_late_paths": True,
            "local_research_only": private}


def review_competing_market_price_interval(
    scenarios: Mapping[str, Mapping[str, Any]], *, work: str,
    prior_works: tuple[str, ...], split_at: int, candidate: str,
    comparator: str, transfer_id: str,
) -> dict[str, Any]:
    """Bound a single existing purchase price, holding all other rows fixed.

    Against the executed comparator, no original owner may lose on this
    selected order. The displaced enterprise's other opportunities are
    unknown. No automatic repricing, redistribution, consent or cash
    feasibility: the new terms require new original decisions and timing.
    """
    from decimal import Decimal
    result = compare_original_competing_market_routes(
        scenarios, work=work, prior_works=prior_works, split_at=split_at)
    if candidate == comparator or candidate not in scenarios or comparator not in scenarios:
        raise TrajectoryComparisonError("COMPETING_PRICE_DISTINCT_ORIGINAL_ARMS_REQUIRED")
    base = {"schema": "AKIS_COMPETING_MARKET_SINGLE_PRICE_INTERVAL/1.0",
            "selected_order_only_not_full_owner_outside_option": True,
            "new_price_requires_independent_terms_consent_and_reserve_recheck": True,
            "no_original_price_or_obligation_changed": True,
            "empirical_network_additionality": "NOT_IDENTIFIABLE"}
    if result["status"] != "MODEL_MATCHED_EXECUTED_COMPETING_MARKET_ROUTES":
        return {**base, "status": "UNKNOWN"}
    a, b = (result["local_research_only"]["arms"][k] for k in (candidate, comparator))
    doc = scenarios[candidate]
    buyer = doc["economic_claims"]["recipient_use_value_evidence"][0]["owner"]
    selected = [t for t in doc["economic_claims"]["transfers"]
                if t["id"] == transfer_id and t["work"] == work and t["payer"] == buyer]
    if len(selected) != 1 or selected[0]["payee"] not in a["participating_owners"]:
        raise TrajectoryComparisonError("COMPETING_PRICE_ORIGINAL_BUYER_PURCHASE_REQUIRED")
    transfer = selected[0]
    seller = transfer["payee"]
    if seller == doc["institution"].get("operator"):
        raise TrajectoryComparisonError("COMPETING_PRICE_ORIGINAL_SUPPLIER_REQUIRED")
    price = Decimal(transfer["amount"])
    delta = {owner: Decimal(v) - Decimal(b["per_owner_model_contribution"][owner])
             for owner, v in a["per_owner_model_contribution"].items()}
    # price' = price + x; the supplier gains x and the buyer loses x.
    lower = max(Decimal(0), price - delta[seller])
    upper = price + delta[buyer]
    others_ok = all(v >= 0 for k, v in delta.items() if k not in {buyer, seller})
    feasible = others_ok and lower <= upper
    return {**base,
            "status": ("MODEL_NONNEGATIVE_INDIVIDUAL_PRICE_INTERVAL" if feasible
                       else "NO_SINGLE_PRICE_CAN_MAKE_ALL_ORIGINAL_OWNERS_NO_WORSE"),
            "other_original_owners_no_worse": others_ok,
            "candidate_current_reserve_paths_met": all(a["original_owner_reserves_met"].values()),
            "fixed_timing_commercial_negotiation": _fixed_timing_commercial_price_interval(
                doc, work=work, transfer=transfer, lower=lower, upper=upper, others_ok=others_ok),
            "local_research_only": {
                "current_purchase_price": f"{price:.2f}",
                "minimum_purchase_price": f"{lower:.2f}" if feasible else None,
                "maximum_purchase_price": f"{upper:.2f}" if feasible else None,
                "supplier_minimum_vs_comparator": f"{lower:.2f}",
                "buyer_maximum_vs_comparator": f"{upper:.2f}",
                "unresolved_model_value_gap": f"{max(Decimal(0), lower-upper):.2f}",
            }}


def _competing_market_stress_design(doc, *, work):
    """Only independently declared stress parameters may vary across cases.

    The copies are equality projections, never executable scenario inputs.
    Past ledger, physical plan, original commitments/terms, owner population,
    scoped source universe and valuation basis remain identical.
    """
    from copy import deepcopy

    frozen = deepcopy(doc)
    money = frozen["economic_claims"]
    parameter = "__DECLARED_STRESS_PARAMETER__"
    for row in money["transfers"]:
        if row["work"] == work and row["payee"] == "EXTERNAL":
            row["amount"] = parameter
    for row in money["resource_uses"]:
        if row["work"] == work:
            row["amount"] = parameter
    for row in money["cash_timing"]["owner_positions"]:
        row["opening_cash"] = parameter
        row["reserve_cash"] = parameter
    for row in money["recipient_use_value_evidence"]:
        if row["work"] == work:
            row["outcome"]["quantity"] = parameter
    for event in frozen["events"]:
        terms = event.get("technology_route_commercial_terms")
        if terms and terms["work"] == work:
            terms["buyer_maximum_payment"] = parameter
        if event.get("technology_route_commercial_fingerprint") and (
                event.get("work") == work or event.get("technology_route_work") == work
                or event.get("work_spec", {}).get("id") == work
                or event["action"] == "technology_route_response"):
            # The original binding in EVERY executable case is independently
            # qualified before this cross-case equality comparison.
            event["technology_route_commercial_fingerprint"] = parameter
    return frozen


def review_robust_competing_market_price_interval(
    stress_cases: Mapping[str, Mapping[str, Mapping[str, Any]]], *,
    work: str, prior_works: tuple[str, ...], split_at: int,
    candidate: str, comparator: str, transfer_id: str,
) -> dict[str, Any]:
    """Find ONE common price for all declared same-problem stress scenarios.

    Every case separately executes both alternatives on original Mesa.
    Cross-case changes are restricted to prospective external cash costs,
    exclusive resource costs, original owner reserves, buyer budget and
    observed use quantity. There is no probability estimate, inferred risk
    distribution, future knowledge at original decision time or auto-consent.
    """
    from copy import deepcopy
    from decimal import Decimal

    if (not isinstance(stress_cases, Mapping) or not 2 <= len(stress_cases) <= 16
            or any(not isinstance(k, str) or not k or len(k) > 64 for k in stress_cases)):
        raise TrajectoryComparisonError("COMPETING_STRESS_BOUNDED_DECLARED_CASES_REQUIRED")
    frozen = deepcopy(stress_cases)
    base = {
        "schema": "AKIS_COMPETING_MARKET_ROBUST_SINGLE_PRICE/1.0",
        "declared_stress_case_count": len(stress_cases),
        "no_probability_or_empirical_risk_distribution_inferred": True,
        "only_declared_stress_set_not_all_future_market_states": True,
        "one_new_price_still_requires_fresh_original_terms_and_consents": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    reference = None
    statuses, bounds = {}, {}
    for label, scenarios in sorted(stress_cases.items()):
        if not isinstance(scenarios, Mapping) or set(scenarios) != {candidate, comparator}:
            raise TrajectoryComparisonError("COMPETING_STRESS_SAME_TWO_ORIGINAL_ROUTES_REQUIRED")
        report = review_competing_market_price_interval(
            scenarios, work=work, prior_works=prior_works, split_at=split_at,
            candidate=candidate, comparator=comparator, transfer_id=transfer_id)
        if report["status"] == "UNKNOWN":
            statuses[label] = "UNKNOWN"
            continue
        view = report["fixed_timing_commercial_negotiation"]
        if view["status"] == "UNKNOWN":
            statuses[label] = "UNKNOWN"
            continue
        design = {name: _competing_market_stress_design(doc, work=work)
                  for name, doc in scenarios.items()}
        if reference is not None and design != reference:
            raise TrajectoryComparisonError("COMPETING_STRESS_NONPARAMETER_ORIGINAL_SCOPE_CHANGED")
        reference = design
        statuses[label] = view["status"]
        if view["status"] == "MODEL_VALUE_BUDGET_AND_RESERVE_PRICE_INTERVAL":
            local = view["local_research_only"]
            bounds[label] = (Decimal(local["minimum_purchase_price"]), Decimal(local["maximum_purchase_price"]))
    if stress_cases != frozen:
        raise TrajectoryComparisonError("COMPETING_STRESS_INPUT_MUTATED")
    result = {**base, "case_statuses": statuses,
              "qualified_stress_case_count": sum(v != "UNKNOWN" for v in statuses.values()),
              "individually_feasible_stress_case_count": len(bounds)}
    if "UNKNOWN" in statuses.values():
        return {**result, "status": "UNKNOWN"}
    if len(bounds) != len(stress_cases):
        return {**result, "status": "NO_COMMON_PRICE_IN_DECLARED_STRESS_SET"}
    low = max(v[0] for v in bounds.values())
    high = min(v[1] for v in bounds.values())
    if low > high:
        return {**result, "status": "NO_COMMON_PRICE_IN_DECLARED_STRESS_SET",
                "all_cases_individually_feasible_but_intersection_empty": True}
    return {**result, "status": "MODEL_COMMON_PRICE_INTERVAL_ACROSS_DECLARED_STRESS_SET",
            "single_price_satisfies_value_budget_and_fixed_timing_reserves_in_all_cases": True,
            "local_research_only": {
                "minimum_purchase_price": f"{low:.2f}", "maximum_purchase_price": f"{high:.2f}",
                "case_intervals": {k: [f"{v[0]:.2f}", f"{v[1]:.2f}"] for k, v in bounds.items()},
            }}


def review_original_portfolio_outside_price_interval(
    scenarios: Mapping[str, Mapping[str, Any]], *, work: str, secondary_work: str,
    prior_works: tuple[str, ...], split_at: int, candidate: str, comparator: str,
    transfer_id: str,
) -> dict[str, Any]:
    """Retrospective sensitivity of ONE independent second-order purchase.

    The counterfactual includes BOTH original orders and all owners, not just
    the supplier's displaced revenue. The declared buyer demand ceiling and
    original cumulative timing are constraints, never evidence of a new
    offer, consent, financing or future profitability.
    """
    from decimal import Decimal

    if candidate == comparator or candidate not in scenarios or comparator not in scenarios:
        raise TrajectoryComparisonError("PORTFOLIO_PRICE_DISTINCT_ORIGINAL_ARMS_REQUIRED")
    base = {
        "schema": "AKIS_ORIGINAL_MULTI_ORDER_OUTSIDE_PRICE_INTERVAL/1.0",
        "whole_selected_portfolio_not_single_order_comparison": True,
        "declared_independent_demand_ceiling_not_total_budget": True,
        "new_price_requires_new_original_offer_response_consents_and_reserve_recheck": True,
        "no_original_price_or_obligation_changed": True,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
    }
    report = compare_original_competing_market_routes(
        scenarios, work=work, secondary_work=secondary_work,
        prior_works=prior_works, split_at=split_at)
    if report["status"] != "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS":
        return {**base, "status": "UNKNOWN"}
    a, b = (report["local_research_only"]["arms"][k] for k in (candidate, comparator))
    if not a["secondary_order_accepted"]:
        raise TrajectoryComparisonError("PORTFOLIO_PRICE_EXECUTED_SECONDARY_ORDER_REQUIRED")
    doc = scenarios[candidate]
    money = doc["economic_claims"]
    requests = [e for e in doc["events"] if e["action"] == "request"
                and e.get("work_spec", {}).get("id") == secondary_work]
    if len(requests) != 1:
        raise TrajectoryComparisonError("PORTFOLIO_PRICE_ORIGINAL_SECONDARY_REQUEST_REQUIRED")
    request = requests[0]
    origin = request["outside_work_origin"]
    buyer = request["work_spec"]["customer"]
    demands = [e for e in doc["events"] if e["action"] == "outside_demand_signal"
               and e.get("outside_demand_id") == origin["outside_demand_id"]]
    offers = [e for e in doc["events"] if e["action"] == "outside_supplier_offer"
              and e.get("outside_offer_id") == origin["outside_offer_id"]]
    if len(demands) != 1 or len(offers) != 1:
        raise TrajectoryComparisonError("PORTFOLIO_PRICE_INDEPENDENT_DEMAND_AND_QUOTE_REQUIRED")
    demand, offer = demands[0], offers[0]
    # Existing single-posting price sensitivity cannot reallocate agreed
    # instalment amounts or ignore their time-dependent reserve requirements.
    if "outside_offer_installments" in offer:
        return {**base, "status": "INSTALLMENT_REPRICING_REQUIRES_NEW_SCHEDULE_AND_OFFER"}
    seller = offer["actor"]
    selected = [t for t in money["transfers"] if t["id"] == transfer_id and t["work"] == secondary_work
                and t["payer"] == buyer and t["payee"] == seller]
    if (len(selected) != 1 or buyer != demand["actor"] or seller != demand["outside_supplier"]
            or Decimal(selected[0]["amount"]) != Decimal(offer["outside_offer_price"])
            or seller == doc["institution"].get("operator")):
        raise TrajectoryComparisonError("PORTFOLIO_PRICE_ORIGINAL_SECONDARY_PURCHASE_REQUIRED")
    transfer = selected[0]
    price = Decimal(transfer["amount"])
    ceiling = Decimal(demand["outside_price_ceiling"])
    delta = {o: Decimal(v) - Decimal(b["per_owner_model_contribution"][o])
             for o, v in a["per_owner_model_contribution"].items()}
    lower = max(Decimal(0), price-delta[seller])
    upper = price+delta[buyer]
    others_ok = all(v >= 0 for o, v in delta.items() if o not in {buyer, seller})
    interval = _fixed_timing_commercial_price_interval(
        doc, work=secondary_work, transfer=transfer, lower=lower, upper=upper,
        others_ok=others_ok, qualified_outside_ceiling=ceiling)
    mapped = {
        "MODEL_VALUE_BUDGET_AND_RESERVE_PRICE_INTERVAL": "MODEL_PORTFOLIO_VALUE_CEILING_AND_RESERVE_PRICE_INTERVAL",
        "NO_PRICE_SATISFIES_VALUE_AND_BUYER_BUDGET": "NO_PRICE_SATISFIES_PORTFOLIO_VALUE_AND_DEMAND_CEILING",
    }
    interval["status"] = mapped.get(interval["status"], interval["status"])
    return {**base, "status": interval["status"],
            "other_original_owners_no_worse": others_ok,
            "candidate_current_cumulative_reserves_met": a["all_owner_declared_reserves_met"],
            "fixed_timing_independent_negotiation": interval,
            "local_research_only": {
                "current_purchase_price": f"{price:.2f}",
                "supplier_minimum_vs_whole_portfolio_comparator": f"{lower:.2f}",
                "buyer_maximum_vs_whole_portfolio_comparator": f"{upper:.2f}",
            }}
