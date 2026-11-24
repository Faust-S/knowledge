"""Source-scoped transaction-cost life cycle on the ONE original cost ledger.

The original economic_flow.resource_uses remain the sole monetary-valued
noncash resource records. This module only classifies their cost origin, can
compare declared scopes, and NEVER promotes any stage label to a new expense,
payment, owner consent, or causally proven saving.
"""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
import re
from typing import Any, Mapping

from .process_preparation import PREPARATION_MODES, PREPARATION_ACTIVITY_UNITS

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
# Source-declared costs without qualified trace anchors remain time-UNKNOWN.
# A future-participation pause may CONTEXTUALIZE exit/switching costs only;
# it can never be interpreted as actual contractual withdrawal.
STAGE_WORK_EVENT_ACTIONS = {
    "PARTNER_SEARCH": frozenset({"request", "offer"}),
    "SOURCE_AND_IDENTITY_VERIFICATION": frozenset({"request", "authorize", "consent"}),
    "NEGOTIATION": frozenset({"offer", "consent", "interest_update"}),
    "CONTRACT_AND_PERMISSIONS": frozenset({"authorize", "consent", "commit"}),
    "ONBOARDING_AND_INTEGRATION": frozenset({"request", "offer", "authorize", "consent", "commit"}),
    "PRODUCTION_COORDINATION": frozenset({
        "commit", "start", "start_operation", "complete_operation",
        "handoff_dispatch", "handoff_receive", "complete", "function_prepare",
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
FUTURE_PARTICIPATION_EVENT_COST_FIELDS = EVENT_COST_FIELDS | {"cooperation_link"}


def review_timed_original_lifecycle_costs(
    raw: Any, *, original_bindings: Mapping[str, Mapping[str, str]],
    sources: Mapping[str, Any], resource_index: Mapping[str, Any],
    works: Mapping[str, Any], trace: tuple[Mapping[str, Any], ...] | list[Mapping[str, Any]],
    allocated_by_work: Mapping[str, Any] | None,
    cooperation_links: tuple[Any, ...] | list[Any] = (),
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
    future_pause_costs = 0
    link_index = {link.key: link for link in cooperation_links}
    for row in raw:
        # Optional revision pin for original owner evidence. This does not
        # create a new expense: it strengthens strict ContextBasis inspection
        # of the same source-declared resource use and original Work event.
        allowed_sets = (
            EVENT_COST_FIELDS,
            FUTURE_PARTICIPATION_EVENT_COST_FIELDS,
            EVENT_COST_FIELDS | {"cost_evidence_revision"},
            FUTURE_PARTICIPATION_EVENT_COST_FIELDS | {"cost_evidence_revision"},
        )
        if not isinstance(row, dict) or set(row) not in allowed_sets:
            raise LifecycleInputError("INVALID_LIFECYCLE_TIMED_BINDING_FIELDS")
        if "cost_evidence_revision" in row:
            revision = row["cost_evidence_revision"]
            if not isinstance(revision, str) or not revision.strip() or len(revision) > 128:
                raise LifecycleInputError(
                    "LIFECYCLE_TIMED_COST_EVIDENCE_REVISION_INVALID"
                )
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
        if row["work_source_revision"] != work.source_revision:
            raise LifecycleInputError("LIFECYCLE_TIMED_WORK_REVISION_MISMATCH")
        position = row["trace_position"]
        if type(position) is not int or position < 0 or position >= len(trace):
            raise LifecycleInputError("LIFECYCLE_TIMED_TRACE_POSITION_INVALID")
        anchor = trace[position]
        stage = binding["stage"]
        contextual_pause = (stage == "RENEWAL_EXIT_AND_SWITCHING" and
                            "cooperation_link" in row)
        if contextual_pause:
            # Existing relation-wide participation event, NOT a new Work
            # event, legal exit or release of any accepted obligation.
            link_id = row.get("cooperation_link")
            if (not isinstance(link_id, str) or link_id not in link_index):
                raise LifecycleInputError("LIFECYCLE_EXIT_ORIGINAL_RELATION_REQUIRED")
            link = link_index[link_id]
            if (work_id not in link.works or owner not in link.participants):
                raise LifecycleInputError("LIFECYCLE_EXIT_WORK_OR_MEMBER_NOT_IN_ORIGINAL_RELATION")
            if (original["scenario"] != "COOPERATION" or
                    original["bucket"] != "EXIT" or original["work"] != work_id):
                raise LifecycleInputError("LIFECYCLE_EXIT_ORIGINAL_COOPERATIVE_OWNER_COST_REQUIRED")
            if action != "participation_status":
                raise LifecycleInputError("LIFECYCLE_EXIT_ONLY_ORIGINAL_FUTURE_PARTICIPATION_PAUSE")
            if anchor.get("action") != "participation_status":
                raise LifecycleInputError("LIFECYCLE_EXIT_ORIGINAL_PARTICIPATION_ACTION_REQUIRED")
            if anchor.get("outcome") != "APPLIED":
                raise LifecycleInputError("LIFECYCLE_EXIT_APPLIED_PARTICIPATION_PAUSE_REQUIRED")
            if (anchor.get("actor") != owner or
                    anchor.get("participation_link") != link_id or
                    anchor.get("participation_relation_revision") != link.source_revision or
                    anchor.get("participation_value") != "PAUSED_NEW_WORK"):
                raise LifecycleInputError("LIFECYCLE_EXIT_ORIGINAL_OWNER_PAUSE_AND_REVISION_REQUIRED")
            earlier_commit = any(
                event.get("outcome") == "APPLIED" and
                event.get("work") == work_id and
                event.get("action") == "commit" and
                event.get("at", -1) < anchor.get("at", -1)
                for event in trace[:position]
            )
            if not earlier_commit or getattr(work, "commitment_org_revision", None) is None:
                raise LifecycleInputError("LIFECYCLE_EXIT_CANNOT_PRECEDE_ORIGINAL_WORK_COMMITMENT")
        else:
            if "cooperation_link" in row:
                raise LifecycleInputError("LIFECYCLE_EXIT_RELATION_ONLY_FOR_FUTURE_PAUSE_STAGE")
            allowed_actions = STAGE_WORK_EVENT_ACTIONS[stage]
            if not allowed_actions:
                raise LifecycleInputError("LIFECYCLE_STAGE_HAS_NO_ORIGINAL_WORK_TIME_EVENT")
            if (anchor.get("outcome") != "APPLIED"
                    or anchor.get("work") != work_id):
                raise LifecycleInputError("LIFECYCLE_TIMED_APPLIED_ORIGINAL_WORK_EVENT_REQUIRED")
            if (anchor.get("action") != action
                    or type(row["at"]) is not int or row["at"] != anchor.get("at")):
                raise LifecycleInputError("LIFECYCLE_TIMED_ORIGINAL_EVENT_ACTION_OR_TIME_MISMATCH")
            if action not in allowed_actions:
                raise LifecycleInputError("LIFECYCLE_TIMED_STAGE_ACTION_CONTRADICTION")
            if (stage == "CLAIMS_AND_REWORK" and action == "assess_result_quality"
                    and anchor.get("quality_verdict") != "DOES_NOT_MEET"):
                raise LifecycleInputError("LIFECYCLE_REWORK_REQUIRES_ORIGINAL_FAILURE_OR_CORRECTION")
        if (anchor.get("action") != action
                or type(row["at"]) is not int or row["at"] != anchor.get("at")):
            raise LifecycleInputError("LIFECYCLE_TIMED_ORIGINAL_EVENT_ACTION_OR_TIME_MISMATCH")
        if row["org_revision"] != anchor.get("org_revision"):
            raise LifecycleInputError("LIFECYCLE_TIMED_ORG_REVISION_MISMATCH")
        proof = row["cost_evidence_ref"]
        prefix = f"model://{owner}/"
        if (not isinstance(proof, str) or not proof.startswith(prefix)
                or len(proof) <= len(prefix) or len(proof) > 180):
            raise LifecycleInputError("LIFECYCLE_TIMED_INDEPENDENT_OWNER_COST_SOURCE_REQUIRED")
        if contextual_pause and proof == anchor.get("participation_source_ref"):
            raise LifecycleInputError(
                "LIFECYCLE_EXIT_COST_PROOF_MUST_DIFFER_FROM_PARTICIPATION_NOTICE"
            )
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
            "relation_future_pause_context_only": contextual_pause,
            "future_pause_does_not_prove_legal_exit_switching_or_contract_discharge": True,
            "original_accepted_work_obligations_unchanged": True,
        }
        indexed.append(item)
        by_work.setdefault(work_id, {}).setdefault(scenario, {}).setdefault(
            owner, []
        ).append(item)
        if stage == "CLAIMS_AND_REWORK":
            rework_qualified += 1
        if contextual_pause:
            future_pause_costs += 1
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
        "model_future_pause_exit_switching_cost_context_count": future_pause_costs,
        "future_pause_never_certifies_actual_exit_or_old_contract_release": True,
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


def review_original_preparation_activity_costs(
    raw: Any, *, original_bindings: Mapping[str, Any],
    event_bindings: list, resource_index: Mapping[str, Any], trace: list | tuple,
) -> dict[str, Any]:
    """Reconcile exact activity x unit-rate with existing original costs.

    Rate cards are modeled source declarations belonging to the SAME cost
    owner and evidence as the lifecycle record. No cash or resource row is
    posted here; this is a strict check of its amount. All applied tagged
    preparation events in the economic Work scope need one and only one row.
    """
    if not isinstance(raw, list) or not 1 <= len(raw) <= 500:
        raise LifecycleInputError("PREPARATION_ACTIVITY_BINDINGS_REQUIRED")
    if not isinstance(event_bindings, list):
        raise LifecycleInputError("PREPARATION_ACTIVITY_ORIGINAL_EVENT_BINDINGS_REQUIRED")
    timed = {row["resource_use_id"]: row for row in event_bindings}
    works = {row["work"] for row in resource_index.values() if row["work"] is not None}
    expected = {
        pos for pos, event in enumerate(trace)
        if event.get("action") == "function_prepare" and event.get("outcome") == "APPLIED"
        and event.get("work") in works and "model_preparation_activity" in event
    }
    used_ids, used_positions = set(), set()
    items = []
    for binding in raw:
        if not isinstance(binding, dict) or set(binding) != {"resource_use_id", "unit_rates_by_mode"}:
            raise LifecycleInputError("PREPARATION_ACTIVITY_BINDING_FIELDS_INVALID")
        rid = binding["resource_use_id"]
        if not isinstance(rid, str) or rid in used_ids:
            raise LifecycleInputError("PREPARATION_ACTIVITY_COST_ROW_DUPLICATE")
        resource = resource_index.get(rid)
        classified = original_bindings.get(rid)
        anchor = timed.get(rid)
        if (resource is None or classified is None or anchor is None
                or resource["scenario"] != "COOPERATION"
                or resource["bucket"] != "COORDINATION"
                or classified["stage"] != "PRODUCTION_COORDINATION"
                or classified["nature"] != "TRANSACTION"
                or anchor["action"] != "function_prepare"):
            raise LifecycleInputError("PREPARATION_ACTIVITY_ORIGINAL_COST_REQUIRED")
        pos = anchor["trace_position"]
        if pos not in expected or pos in used_positions:
            raise LifecycleInputError("PREPARATION_ACTIVITY_ORIGINAL_EVENT_NOT_UNIQUE")
        event = trace[pos]
        if (event.get("actor") != resource["owner"]
                or event.get("work") != resource["work"]):
            raise LifecycleInputError("PREPARATION_ACTIVITY_ORIGINAL_OWNER_MISMATCH")
        activity = event["model_preparation_activity"]
        rates = binding["unit_rates_by_mode"]
        if not isinstance(rates, dict) or set(rates) != set(PREPARATION_MODES):
            raise LifecycleInputError("PREPARATION_ACTIVITY_MATCHED_RATE_CARD_REQUIRED")
        for card in rates.values():
            if (not isinstance(card, dict) or set(card) != set(PREPARATION_ACTIVITY_UNITS)
                    or any(not isinstance(value, str)
                           or re.fullmatch(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?", value) is None
                           for value in card.values())):
                raise LifecycleInputError("PREPARATION_ACTIVITY_EXACT_UNIT_RATES_REQUIRED")
        mode = activity["mode"]
        cost = sum((Decimal(rates[mode][unit]) * activity["units"][unit]
                    for unit in PREPARATION_ACTIVITY_UNITS), Decimal("0"))
        if resource["decimal_amount"] != cost:
            raise LifecycleInputError("PREPARATION_ACTIVITY_COST_AMOUNT_MISMATCH")
        used_ids.add(rid)
        used_positions.add(pos)
        items.append({
            "resource_use_id": rid, "work": resource["work"],
            "original_owner": resource["owner"], "mode": mode,
            "original_trace_position": pos, "units": dict(activity["units"]),
            "declared_resource_cost": _amount(cost),
        })
    if expected != used_positions:
        raise LifecycleInputError("PREPARATION_ACTIVITY_APPLIED_SCOPE_INCOMPLETE")
    return {
        "status": "MODEL_ORIGINAL_PACKET_ACTIVITY_COST_RECONCILED",
        "original_cost_count": len(items),
        "total_declared_resource_cost": _amount(sum(
            (Decimal(item["declared_resource_cost"]) for item in items), Decimal("0"))),
        "items": sorted(items, key=lambda item: item["original_trace_position"]),
        "same_original_cost_records_not_added_again": True,
        "actual_time_or_causal_profit_verified": False,
    }


def classify_lifecycle_costs(
    raw: Any, *, sources: Mapping[str, Any], resource_index: Mapping[str, Any],
    subjects: Mapping[str, Any], outside: Mapping[str, str],
    works: Mapping[str, Any] | None = None,
    trace: tuple[Mapping[str, Any], ...] | list[Mapping[str, Any]] = (),
    allocated_by_work: Mapping[str, Any] | None = None,
    cooperation_links: tuple[Any, ...] | list[Any] = (),
) -> dict[str, Any]:
    """Provide independent scoped owner comparisons but NO new money.

    Nature is separate from stage: not all onboarding/quality/security costs
    are transactions. Only source-declared original non-cash resource records
    can be attributed; missing records are UNKNOWN rather than zero.
    """
    if (not isinstance(raw, dict) or
            set(raw) not in ({"bindings", "scope_proofs"},
                             {"bindings", "scope_proofs", "event_bindings"},
                             {"bindings", "scope_proofs", "event_bindings",
                              "preparation_activity_bindings"})):
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
            cooperation_links=cooperation_links,
        )
    if "preparation_activity_bindings" in raw:
        response["original_preparation_activity_costs"] = review_original_preparation_activity_costs(
            raw["preparation_activity_bindings"], original_bindings=original_binding_index,
            event_bindings=raw["event_bindings"], resource_index=resource_index, trace=trace,
        )
    return response
