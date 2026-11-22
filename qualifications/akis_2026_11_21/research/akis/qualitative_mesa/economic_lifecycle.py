"""Source-scoped transaction-cost life cycle on the ONE original cost ledger.

The original economic_flow.resource_uses remain the sole monetary-valued
noncash resource records. This module only classifies their cost origin, can
compare declared scopes, and NEVER promotes any stage label to a new expense,
payment, owner consent, or causally proven saving.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any, Mapping

class LifecycleInputError(ValueError):
    """An attempted cost assignment lacks original owner/source/scope."""

STAGES = (
    "PARTNER_SEARCH", "SOURCE_AND_IDENTITY_VERIFICATION",
    "NEGOTIATION", "CONTRACT_AND_PERMISSIONS", "ONBOARDING_AND_INTEGRATION",
    "PRODUCTION_COORDINATION", "MONITORING_AND_QUALITY",
    "CLAIMS_AND_REWORK", "ADAPTATION_AND_RENEGOTIATION",
    "RENEWAL_EXIT_AND_SWITCHING", "LEARNING_AND_REUSE",
    "SECURITY_DATA_AND_AI_GOVERNANCE", "FINANCING_CARRY_COST",
)
NATURES = (
    "TRANSACTION", "DIRECT_RESOURCE", "FINANCING",
    "DATA_SECURITY_GOVERNANCE", "SHARED_OPERATOR_CAPABILITY",
)
_SCENARIOS = ("COOPERATION", "INDEPENDENT_ALTERNATIVE")


# Only actual ORIGINAL Work actions can anchor an expense in the research
# timeline. Some economic stages have no Work-scoped action in this Mesa.
# Such source-declared costs remain classified but their dates stay UNKNOWN.
STAGE_WORK_EVENT_ACTIONS = {
    "PARTNER_SEARCH": frozenset({"request", "offer"}),
    "SOURCE_AND_IDENTITY_VERIFICATION": frozenset({"request", "authorize", "consent"}),
    "NEGOTIATION": frozenset({"offer", "consent", "interest_update"}),
    "CONTRACT_AND_PERMISSIONS": frozenset({"authorize", "consent", "commit"}),
    "ONBOARDING_AND_INTEGRATION": frozenset({"request", "offer", "authorize", "consent", "commit"}),
    "PRODUCTION_COORDINATION": frozenset({
        "commit", "start", "start_operation", "complete_operation",
        "handoff_dispatch", "handoff_receive", "complete",
    }),
    "MONITORING_AND_QUALITY": frozenset({
        "complete_operation", "handoff_quality", "assess_result_quality",
        "accept", "reject",
    }),
    "CLAIMS_AND_REWORK": frozenset({"reject", "resubmit", "assess_result_quality"}),
    "ADAPTATION_AND_RENEGOTIATION": frozenset({
        "interest_update", "cooperation_change_propose", "cooperation_change_response",
    }),
    "RENEWAL_EXIT_AND_SWITCHING": frozenset(),
    "LEARNING_AND_REUSE": frozenset({"accept"}),
    "SECURITY_DATA_AND_AI_GOVERNANCE": frozenset({"authorize", "consent"}),
    "FINANCING_CARRY_COST": frozenset({"commit", "complete", "accept", "reject"}),
}
EVENT_COST_FIELDS = frozenset({
    "resource_use_id", "work", "owner", "source", "work_source_revision",
    "trace_position", "at", "action", "org_revision", "cost_evidence_ref",
})


def review_timed_original_lifecycle_costs(
    raw: Any, *, original_bindings: Mapping[str, Mapping[str, str]],
    sources: Mapping[str, Any], resource_index: Mapping[str, Any],
    works: Mapping[str, Any], trace: tuple[Mapping[str, Any], ...] | list[Mapping[str, Any]],
    allocated_by_work: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Qualify source assertions against ONE original trace, never post new cash.

    An APPLIED Work event is a causal *anchor*, not evidence the cost was
    incurred or paid. An outside-option row cannot become historical execution
    of a counterfactual alternative merely by sharing the demand reference.
    """
    if not isinstance(raw, list) or len(raw) > 4096:
        raise LifecycleInputError("INVALID_LIFECYCLE_TIMED_BINDING_COUNT")
    if not isinstance(trace, (tuple, list)):
        raise LifecycleInputError("LIFECYCLE_ORIGINAL_TRACE_REQUIRED")
    used_pairs: set[tuple[str, str]] = set()
    used_sources: set[str] = set()
    by_work: dict[str, dict[str, dict[str, list[dict[str, Any]]]]] = {}
    indexed: list[dict[str, Any]] = []
    rework_qualified = 0
    for row in raw:
        if not isinstance(row, dict) or set(row) != EVENT_COST_FIELDS:
            raise LifecycleInputError("INVALID_LIFECYCLE_TIMED_BINDING_FIELDS")
        rid = _identifier(row["resource_use_id"], "INVALID_LIFECYCLE_TIMED_RESOURCE")
        work_id = _identifier(row["work"], "INVALID_LIFECYCLE_TIMED_WORK")
        owner = _identifier(row["owner"], "INVALID_LIFECYCLE_TIMED_OWNER")
        source = _identifier(row["source"], "INVALID_LIFECYCLE_TIMED_SOURCE")
        action = _identifier(row["action"], "INVALID_LIFECYCLE_TIMED_ACTION")
        if (rid, work_id) in used_pairs:
            raise LifecycleInputError("DUPLICATE_LIFECYCLE_ORIGINAL_WORK_EVENT_COST")
        used_pairs.add((rid, work_id))
        original = resource_index.get(rid)
        binding = original_bindings.get(rid)
        work = works.get(work_id)
        if original is None or binding is None:
            raise LifecycleInputError("LIFECYCLE_TIMED_COST_NOT_ORIGINAL_CLASSIFIED_RESOURCE")
        if work is None:
            raise LifecycleInputError("LIFECYCLE_TIMED_UNKNOWN_ORIGINAL_WORK")
        if (original["owner"] != owner or original["source"] != source
                or sources.get(source, {}).get("owner") != owner):
            raise LifecycleInputError("LIFECYCLE_TIMED_OWNER_OR_SOURCE_MISMATCH")
        if row["work_source_revision"] != work.source_revision:
            raise LifecycleInputError("LIFECYCLE_TIMED_WORK_REVISION_MISMATCH")
        if original["work"] is not None:
            if original["work"] != work_id:
                raise LifecycleInputError("LIFECYCLE_TIMED_WRONG_ORIGINAL_WORK")
            amount = original["decimal_amount"]
        else:
            slices = (
                (allocated_by_work or {}).get(work_id, {})
                .get(original["scenario"], {}).get("RESOURCE_USE", {})
            )
            if rid not in slices:
                raise LifecycleInputError("LIFECYCLE_TIMED_COMMON_COST_NOT_ALLOCATED_TO_WORK")
            amount = Decimal(slices[rid])
            if amount <= 0 or amount > original["decimal_amount"]:
                raise LifecycleInputError("LIFECYCLE_TIMED_COMMON_COST_ALLOCATION_INVALID")
        position = row["trace_position"]
        if type(position) is not int or position < 0 or position >= len(trace):
            raise LifecycleInputError("LIFECYCLE_TIMED_TRACE_POSITION_INVALID")
        anchor = trace[position]
        if (anchor.get("outcome") != "APPLIED"
                or anchor.get("work") != work_id):
            raise LifecycleInputError("LIFECYCLE_TIMED_APPLIED_ORIGINAL_WORK_EVENT_REQUIRED")
        if (anchor.get("action") != action
                or type(row["at"]) is not int or row["at"] != anchor.get("at")):
            raise LifecycleInputError("LIFECYCLE_TIMED_ORIGINAL_EVENT_ACTION_OR_TIME_MISMATCH")
        if row["org_revision"] != anchor.get("org_revision"):
            raise LifecycleInputError("LIFECYCLE_TIMED_ORG_REVISION_MISMATCH")
        stage = binding["stage"]
        allowed_actions = STAGE_WORK_EVENT_ACTIONS[stage]
        if not allowed_actions:
            raise LifecycleInputError("LIFECYCLE_STAGE_HAS_NO_ORIGINAL_WORK_TIME_EVENT")
        if action not in allowed_actions:
            raise LifecycleInputError("LIFECYCLE_TIMED_STAGE_ACTION_CONTRADICTION")
        if (stage == "CLAIMS_AND_REWORK" and action == "assess_result_quality"
                and anchor.get("quality_verdict") != "DOES_NOT_MEET"):
            raise LifecycleInputError("LIFECYCLE_REWORK_REQUIRES_ORIGINAL_FAILURE_OR_CORRECTION")
        proof = row["cost_evidence_ref"]
        prefix = f"model://{owner}/"
        if (not isinstance(proof, str) or not proof.startswith(prefix)
                or len(proof) <= len(prefix) or len(proof) > 180):
            raise LifecycleInputError("LIFECYCLE_TIMED_INDEPENDENT_OWNER_COST_SOURCE_REQUIRED")
        if (proof in used_sources
                or proof == sources[source]["reference"]):
            raise LifecycleInputError("LIFECYCLE_TIMED_COST_EVIDENCE_NOT_UNIQUE")
        used_sources.add(proof)
        scenario = original["scenario"]
        item = {
            "resource_use_id": rid, "work": work_id, "owner": owner,
            "scenario": scenario, "stage": stage,
            "original_trace_position": position,
            "original_applied_action": action, "original_event_at": row["at"],
            "source_declared_noncash_original_work_cost": _amount(amount),
            "cost_model_evidence_ref": proof,
            "anchor_is_not_cost_incurrence_or_cash_settlement_proof": True,
            "outside_option_action_was_not_executed": scenario == "INDEPENDENT_ALTERNATIVE",
        }
        indexed.append(item)
        by_work.setdefault(work_id, {}).setdefault(scenario, {}).setdefault(
            owner, []
        ).append(item)
        if stage == "CLAIMS_AND_REWORK":
            rework_qualified += 1
    rework_by_work = {
        work_id: sum(
            event.get("work") == work_id
            and event.get("outcome") == "APPLIED"
            and (event.get("action") in {"reject", "resubmit"}
                 or (event.get("action") == "assess_result_quality"
                     and event.get("quality_verdict") == "DOES_NOT_MEET"))
            for event in trace
        )
        for work_id in sorted(works)
    }
    return {
        "evidence": "MODEL_ONLY_ORIGINAL_APPLIED_WORK_EVENT_AND_RESOURCE_REFERENCES",
        "original_lifecycle_timed_record_count": len(indexed),
        "timed_distinct_original_work_count": len(by_work),
        "source_declared_quality_rework_cost_record_count": rework_qualified,
        "original_applied_quality_rework_signal_count": sum(rework_by_work.values()),
        "source_declared_event_time_is_not_verified_cost_incurrence": True,
        "outside_alternative_has_no_original_executed_process_trace": True,
        "no_added_money_resource_cost_or_original_event": True,
        "by_original_work": {
            work: {
                "original_applied_quality_rework_signal_count": rework_by_work[work],
                "per_original_scenario_owner": {
                    scenario: {
                        owner: sorted(items, key=lambda x: (
                            x["original_event_at"], x["original_trace_position"],
                            x["resource_use_id"],
                        ))
                        for owner, items in sorted(owners.items())
                    }
                    for scenario, owners in sorted(by_work.get(work, {}).items())
                },
            }
            for work in sorted(works)
        },
    }

def _identifier(value: Any, error: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        raise LifecycleInputError(error)
    return value

def _amount(value: Decimal) -> str:
    return f"{value:.2f}"

def classify_lifecycle_costs(
    raw: Any, *, sources: Mapping[str, Any], resource_index: Mapping[str, Any],
    subjects: Mapping[str, Any], outside: Mapping[str, str],
    works: Mapping[str, Any] | None = None,
    trace: tuple[Mapping[str, Any], ...] | list[Mapping[str, Any]] = (),
    allocated_by_work: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Provide independent scoped owner comparisons but NO new money.

    Nature is separate from stage: not all onboarding/quality/security costs
    are transactions. Only source-declared original non-cash resource records
    can be attributed; missing records are UNKNOWN rather than zero.
    """
    if (not isinstance(raw, dict) or
            set(raw) not in ({"bindings", "scope_proofs"},
                             {"bindings", "scope_proofs", "event_bindings"})):
        raise LifecycleInputError("INVALID_LIFECYCLE_FIELDS")
    bindings = raw["bindings"]
    proofs = raw["scope_proofs"]
    if not isinstance(bindings, list) or len(bindings) > 4096:
        raise LifecycleInputError("INVALID_LIFECYCLE_BINDING_COUNT")
    if not isinstance(proofs, dict) or set(proofs) != set(_SCENARIOS):
        raise LifecycleInputError("INVALID_LIFECYCLE_PROOF_MAP")
    verified: dict[str, dict[str, str]] = {}
    for scenario in _SCENARIOS:
        owners = proofs[scenario]
        if not isinstance(owners, dict) or len(owners) > len(subjects):
            raise LifecycleInputError("INVALID_LIFECYCLE_OWNER_COVERAGE")
        verified[scenario] = {}
        for owner, source in owners.items():
            _identifier(owner, "INVALID_LIFECYCLE_OWNER")
            src = _identifier(source, "INVALID_LIFECYCLE_SOURCE")
            if owner not in subjects or sources.get(src, {}).get("owner") != owner:
                raise LifecycleInputError("LIFECYCLE_SCOPE_SOURCE_NOT_OWNER_QUALIFIED")
            verified[scenario][owner] = src
    classified: dict[str, dict[str, dict[str, list[Decimal]]]] = {
        sc: {owner: defaultdict(list) for owner in sorted(subjects)} for sc in _SCENARIOS
    }
    by_stage: dict[str, dict[str, dict[str, list[Decimal]]]] = {
        sc: {owner: defaultdict(list) for owner in sorted(subjects)} for sc in _SCENARIOS
    }
    seen: set[str] = set()
    original_binding_index: dict[str, Mapping[str, str]] = {}
    for record in bindings:
        if not isinstance(record, dict) or set(record) != {
            "resource_use_id", "owner", "source", "stage", "nature",
        }:
            raise LifecycleInputError("INVALID_LIFECYCLE_COST_BINDING")
        key = _identifier(record["resource_use_id"], "INVALID_LIFECYCLE_RESOURCE")
        owner = _identifier(record["owner"], "INVALID_LIFECYCLE_OWNER")
        source = _identifier(record["source"], "INVALID_LIFECYCLE_SOURCE")
        stage = _identifier(record["stage"], "INVALID_LIFECYCLE_STAGE")
        nature = _identifier(record["nature"], "INVALID_LIFECYCLE_NATURE")
        if stage not in STAGES or nature not in NATURES:
            raise LifecycleInputError("UNKNOWN_LIFECYCLE_STAGE_OR_NATURE")
        if key in seen:
            raise LifecycleInputError("DUPLICATE_LIFECYCLE_ORIGINAL_RESOURCE")
        original = resource_index.get(key)
        if original is None:
            raise LifecycleInputError("LIFECYCLE_REFERENCE_NOT_IN_ORIGINAL_RESOURCE_LEDGER")
        if (owner not in subjects or
            original["owner"] != owner or original["source"] != source or
            sources.get(source, {}).get("owner") != owner):
            raise LifecycleInputError("LIFECYCLE_ORIGINAL_OWNER_SOURCE_MISMATCH")
        seen.add(key)
        original_binding_index[key] = record
        scenario = original["scenario"]
        classified[scenario][owner][nature].append(original["decimal_amount"])
        by_stage[scenario][owner][stage].append(original["decimal_amount"])
    result: dict[str, Any] = {}
    count_comparable = 0
    for owner in sorted(subjects):
        scenarios: dict[str, Any] = {}
        for scenario in _SCENARIOS:
            original_ids = {
                key for key, row in resource_index.items()
                if row["owner"] == owner and row["scenario"] == scenario
            }
            bound_ids = {
                key for key, row in resource_index.items()
                if row["owner"] == owner and row["scenario"] == scenario and key in seen
            }
            proof = owner in verified[scenario]
            complete = proof and original_ids == bound_ids
            scenarios[scenario] = {
                "status": (
                    "DECLARED_RESOURCE_SCOPE_MATCHED_UNVERIFIED"
                    if complete else
                    "SOURCE_SCOPE_PROOF_MISSING" if not proof else
                    "UNCLASSIFIED_ORIGINAL_RESOURCE_USES_REMAIN"
                ),
                "classified_count": len(bound_ids),
                "unclassified_original_count": len(original_ids - bound_ids),
                "noncash_use_by_stage": {
                    stage: _amount(sum(values, Decimal("0")))
                    for stage, values in sorted(by_stage[scenario][owner].items())
                },
                "noncash_use_by_nature": {
                    nature: _amount(sum(values, Decimal("0")))
                    for nature, values in sorted(classified[scenario][owner].items())
                },
                "declared_resource_scope_complete_not_audited": complete,
            }
        comparable = (all(scenarios[x]["declared_resource_scope_complete_not_audited"]
                          for x in _SCENARIOS)
                      and outside.get(owner) == "FEASIBLE_DECLARED")
        difference = None
        if comparable:
            total_outside = sum(
                (v for vals in classified["INDEPENDENT_ALTERNATIVE"][owner].values()
                 for v in vals), Decimal("0"))
            total_coop = sum(
                (v for vals in classified["COOPERATION"][owner].values()
                 for v in vals), Decimal("0"))
            difference = _amount(total_outside - total_coop)
            count_comparable += 1
        result[owner] = {
            "status": "DECLARED_RESOURCE_COST_COMPARISON_ONLY"
                      if comparable else "NOT_IDENTIFIABLE_FROM_ORIGINAL_SOURCE_SCOPE",
            "original_owner_nature": getattr(subjects[owner], "kind", "UNKNOWN"),
            "scenarios": scenarios,
            "outside_minus_cooperation_noncash_resource_cost": difference,
            "transaction_saving_causal_effect": "NOT_ESTABLISHED",
            "cash_payments_added_again": False,
            "original_owner_private_costs_not_for_automatic_publication": True,
        }
    response = {
        "evidence": "MODEL_ONLY_CLASSIFICATION_OF_ORIGINAL_RESOURCE_USES",
        "stages": list(STAGES),
        "natures": list(NATURES),
        "original_record_count": len(resource_index),
        "classified_original_record_count": len(seen),
        "unclassified_original_record_count": len(resource_index)-len(seen),
        "owners_with_source_declared_scope_comparison": count_comparable,
        "owner_scoped_details": result,
        "unique_original_record_constraint": True,
        "resource_use_is_not_a_cash_transfer": True,
        "same_resource_may_be_tagged_elsewhere_but_not_added_again": True,
        "full_real_transaction_cost_and_causal_gain": "NOT_ESTABLISHED",
        "original_work_consent_organization_unchanged": True,
    }
    if "event_bindings" in raw:
        response["original_work_event_timing"] = review_timed_original_lifecycle_costs(
            raw["event_bindings"], original_bindings=original_binding_index,
            sources=sources, resource_index=resource_index,
            works=works or {}, trace=trace,
            allocated_by_work=allocated_by_work,
        )
    return response
