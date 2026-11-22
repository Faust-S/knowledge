"""M3.3: work-scoped counterfactual over the ORIGINAL AKIS economic ledger.

No second payment ledger, financial account, invoice, new cost or profit.
A scoped arithmetic comparison is not a causal effect, even if it is positive.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping

from .modern_economic_evidence import ONBOARDING_CATEGORIES, MODERN_EXPOSURES
from .economic_lifecycle import STAGES


class WorkCounterfactualInputError(ValueError):
    pass


SCENARIOS = ("COOPERATION", "INDEPENDENT_ALTERNATIVE")


def _id(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 180:
        raise WorkCounterfactualInputError(code)
    return value


def _money(value: Decimal) -> str:
    return f"{value:.2f}"


def review_work_counterfactuals(raw: Any, *, state: Any,
                                 economic_claims: Mapping[str, Any] | None,
                                 economic_view: Mapping[str, Any] | None,
                                 reuse_view: Mapping[str, Any] | None) -> dict[str, Any]:
    """Compare original sources for each Work, owner, operator and network.

    Explicit owner proofs are still MODEL_ONLY claims. Missing/unallocated
    records, feasibility or equivalence never imply zero or realised profit.
    """
    if not isinstance(raw, list) or len(raw) > 128:
        raise WorkCounterfactualInputError("COUNTERFACTUAL_INVALID_LIST")
    if economic_claims is None or economic_view is None:
        raise WorkCounterfactualInputError("COUNTERFACTUAL_REQUIRES_ORIGINAL_ECONOMIC_LEDGER")
    sources = economic_view["declared_source_index"]
    econ = economic_claims
    if not isinstance(econ, Mapping):
        raise WorkCounterfactualInputError("COUNTERFACTUAL_INVALID_ECONOMIC_SOURCE")
    names = set(state.subjects)
    if len(names) > 128:
        raise WorkCounterfactualInputError("COUNTERFACTUAL_TOO_MANY_PRINCIPALS")
    reuse = {row["id"]: row for row in (reuse_view or {}).get("links", [])}
    history = {}
    for row in raw:
        required = {"work", "reuse_claim", "comparison_source", "equivalence", "owner_scope"}
        if (not isinstance(row, dict) or
                set(row) not in (required, required | {"onboarding_zero_proofs"})):
            raise WorkCounterfactualInputError("COUNTERFACTUAL_FIELDS_INVALID")
        work_id = _id(row["work"], "COUNTERFACTUAL_WORK_INVALID")
        if work_id not in state.works or work_id in history:
            raise WorkCounterfactualInputError("COUNTERFACTUAL_UNKNOWN_OR_DUPLICATE_WORK")
        work = state.works[work_id]
        claim = row["reuse_claim"]
        if claim is not None:
            _id(claim, "COUNTERFACTUAL_REUSE_CLAIM_INVALID")
            if claim not in reuse or reuse[claim]["later_work"] != work_id:
                raise WorkCounterfactualInputError("COUNTERFACTUAL_REUSE_WORK_LINK_INVALID")
        proof_source = _id(row["comparison_source"], "COUNTERFACTUAL_COMPARISON_SOURCE_INVALID")
        if sources.get(proof_source, {}).get("owner") != work.customer:
            raise WorkCounterfactualInputError("COUNTERFACTUAL_CUSTOMER_SOURCE_REQUIRED")
        eq = row["equivalence"]
        if not isinstance(eq, dict) or set(eq) != {"deliverable", "quantity", "quality", "risk", "horizon"}:
            raise WorkCounterfactualInputError("COUNTERFACTUAL_EQUIVALENCE_FIELDS_INVALID")
        if any(type(value) is not bool for value in eq.values()):
            raise WorkCounterfactualInputError("COUNTERFACTUAL_EQUIVALENCE_MUST_BE_BOOLEAN")
        proofs = row["owner_scope"]
        if not isinstance(proofs, dict) or set(proofs) != set(SCENARIOS):
            raise WorkCounterfactualInputError("COUNTERFACTUAL_SCOPE_SCENARIOS_REQUIRED")
        owner_proofs = {}
        for sc in SCENARIOS:
            mapped = proofs[sc]
            if not isinstance(mapped, dict) or not set(mapped) <= names:
                raise WorkCounterfactualInputError("COUNTERFACTUAL_SCOPE_OWNER_UNKNOWN")
            owner_proofs[sc] = {}
            for owner, proof in mapped.items():
                if not isinstance(proof, dict) or set(proof) != {
                    "source", "complete", "declared_zero_cash", "declared_zero_noncash"
                }:
                    raise WorkCounterfactualInputError("COUNTERFACTUAL_OWNER_PROOF_FIELDS_INVALID")
                src = _id(proof["source"], "COUNTERFACTUAL_OWNER_SOURCE_INVALID")
                if sources.get(src, {}).get("owner") != owner:
                    raise WorkCounterfactualInputError("COUNTERFACTUAL_OWNER_SOURCE_MISMATCH")
                if any(type(proof[k]) is not bool for k in (
                    "complete", "declared_zero_cash", "declared_zero_noncash"
                )):
                    raise WorkCounterfactualInputError("COUNTERFACTUAL_OWNER_PROOF_BOOLEANS_REQUIRED")
                owner_proofs[sc][owner] = proof
        # Explicit per-original-owner category attestations: absence of a
        # classified resource cost is UNKNOWN, never an inferred zero.
        zero = row.get("onboarding_zero_proofs")
        zero_by_scenario = {sc: {} for sc in SCENARIOS}
        if zero is not None:
            if not isinstance(zero, dict) or set(zero) != set(SCENARIOS):
                raise WorkCounterfactualInputError("COUNTERFACTUAL_NINE_ZERO_SCENARIOS_REQUIRED")
            for sc in SCENARIOS:
                mapped = zero[sc]
                if not isinstance(mapped, dict) or not set(mapped) <= names:
                    raise WorkCounterfactualInputError("COUNTERFACTUAL_NINE_ZERO_OWNER_INVALID")
                for owner, proofs_for_categories in mapped.items():
                    if owner not in owner_proofs[sc]:
                        raise WorkCounterfactualInputError("COUNTERFACTUAL_NINE_ZERO_OWNER_SCOPE_MISSING")
                    if not isinstance(proofs_for_categories, dict):
                        raise WorkCounterfactualInputError("COUNTERFACTUAL_NINE_ZERO_CATEGORY_MAP_INVALID")
                    verified = {}
                    for category, source in proofs_for_categories.items():
                        if category not in ONBOARDING_CATEGORIES:
                            raise WorkCounterfactualInputError("COUNTERFACTUAL_NINE_ZERO_CATEGORY_INVALID")
                        if not isinstance(source, str) or sources.get(source, {}).get("owner") != owner:
                            raise WorkCounterfactualInputError("COUNTERFACTUAL_NINE_ZERO_OWNER_SOURCE_INVALID")
                        verified[category] = source
                    zero_by_scenario[sc][owner] = verified
        history[work_id] = (claim, eq, owner_proofs, proof_source, zero_by_scenario)
    results = []
    raw_transfers = econ["transfers"]
    raw_resource_uses = econ["resource_uses"]
    bindings = econ.get("lifecycle_costs", {}).get("bindings", [])
    lifecycle_by_resource = {record["resource_use_id"]: record for record in bindings}
    time_evidence = economic_view.get("lifecycle_resource_costs", {}).get(
        "original_work_event_timing"
    )
    timeline_by_work = time_evidence.get("by_original_work", {}) if time_evidence else {}
    modern = {b["resource_use_id"]: b for b in econ.get("modern_cost_bindings", [])}
    allocation = economic_view.get("common_work_allocations")
    by_work = allocation["by_work"] if allocation is not None else {}
    remainders = allocation["unallocated_remainders"] if allocation is not None else {}

    def unassigned(original: Mapping[str, Any]) -> bool:
        # Full assignment to any other original Work is NOT an additional
        # unattributed expense for this Work; partial assignment is UNKNOWN.
        return Decimal(remainders.get(original["id"], original["amount"])) > 0
    for work_id, (claim, eq, proofs, comparison_source, zero_by_scenario) in history.items():
        work = state.works[work_id]
        actor_status = {}
        per_scenario = {}
        global_reasons = []
        if not all(eq.values()):
            global_reasons.append("COMPARABLE_QUANTITY_QUALITY_RISK_SCOPE_NOT_DECLARED")
        if work.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT":
            global_reasons.append("WORK_RESULT_NOT_ACCEPTED")
        if claim is not None and reuse[claim]["model_claim_status"] != "MODEL_REPORTED_COMPARABLE_REUSE_SEQUENCE":
            global_reasons.append("REUSE_SEQUENCE_OR_OWNER_PERMISSION_NOT_QUALIFIED")
        for sc in SCENARIOS:
            party_data = {}
            external = Decimal("0")
            internal = 0
            common_slices = by_work.get(work_id, {}).get(sc, {})
            cash_slices = common_slices.get("TRANSFER", {})
            noncash_slices = common_slices.get("RESOURCE_USE", {})
            for transfer in raw_transfers:
                if transfer["scenario"] != sc:
                    continue
                if transfer["work"] == work_id:
                    amt = Decimal(transfer["amount"])
                elif transfer["work"] is None and transfer["id"] in cash_slices:
                    amt = Decimal(cash_slices[transfer["id"]])
                else:
                    continue
                if transfer["payer"] == "EXTERNAL":
                    external += amt
                elif transfer["payee"] == "EXTERNAL":
                    external -= amt
                else:
                    internal += 1
            for owner in sorted(names):
                proof = proofs[sc].get(owner)
                transfers = [t for t in raw_transfers if t["scenario"] == sc
                             and t["work"] == work_id and owner in (t["payer"], t["payee"])]
                resource = [c for c in raw_resource_uses if c["scenario"] == sc
                            and c["work"] == work_id and c["owner"] == owner]
                allocated_transfers = [t for t in raw_transfers if t["scenario"] == sc
                                       and t["work"] is None and
                                       t["id"] in cash_slices and
                                       owner in (t["payer"], t["payee"])]
                allocated_resource = [c for c in raw_resource_uses if c["scenario"] == sc
                                      and c["work"] is None and
                                      c["id"] in noncash_slices and c["owner"] == owner]
                unallocated = [c for c in raw_resource_uses if c["scenario"] == sc
                               and c["work"] is None and c["owner"] == owner
                               and unassigned(c)]
                unallocated_cash = [t for t in raw_transfers if t["scenario"] == sc
                                    and t["work"] is None and
                                    owner in (t["payer"], t["payee"]) and unassigned(t)]
                cash = sum((Decimal(t["amount"]) * (1 if t["payee"] == owner else -1)
                            for t in transfers), Decimal(0))
                cash += sum((Decimal(cash_slices[t["id"]]) *
                             (1 if t["payee"] == owner else -1)
                             for t in allocated_transfers), Decimal(0))
                noncash = sum((Decimal(c["amount"]) for c in resource), Decimal(0))
                noncash += sum((Decimal(noncash_slices[c["id"]])
                                for c in allocated_resource), Decimal(0))
                reasons = []
                if proof is None or not proof["complete"]:
                    reasons.append("ORIGINAL_OWNER_WORK_COST_SCOPE_NOT_COMPLETE_DECLARED")
                if proof is not None:
                    if not transfers and not allocated_transfers and not proof["declared_zero_cash"]:
                        reasons.append("ZERO_CASH_NOT_OWNER_ATTESTED")
                    if not resource and not allocated_resource and not proof["declared_zero_noncash"]:
                        reasons.append("ZERO_NONCASH_COST_NOT_OWNER_ATTESTED")
                if owner not in economic_view["coverage_proof_sources"].get(sc, {}):
                    reasons.append("ORIGINAL_OWNER_GENERAL_ECONOMIC_COVERAGE_MISSING")
                if unallocated:
                    reasons.append("COMMON_NONCASH_COST_NOT_ATTRIBUTED_TO_WORK")
                if unallocated_cash:
                    # Work-specific comparison may not silently discard shared
                    # original cash flows (operator overhead, settlement, etc.).
                    # Unknown allocation is not zero and cannot establish a
                    # complete owner/network Work counterfactual.
                    reasons.append("COMMON_CASH_FLOW_NOT_ATTRIBUTED_TO_WORK")
                if any(c["id"] not in lifecycle_by_resource
                       for c in resource + allocated_resource):
                    reasons.append("WORK_COST_NOT_LIFECYCLE_CLASSIFIED")
                outside = economic_view["per_subject"][owner]["outside_feasibility"]
                if outside != "FEASIBLE_DECLARED":
                    reasons.append("INDEPENDENT_ALTERNATIVE_NOT_FEASIBLE_DECLARED")
                stage_costs = {}
                for use in resource + allocated_resource:
                    category = lifecycle_by_resource.get(use["id"], {}).get("stage")
                    if category is not None:
                        cost_amount = (Decimal(noncash_slices[use["id"]])
                                       if use["id"] in noncash_slices
                                       else Decimal(use["amount"]))
                        stage_costs[category] = stage_costs.get(category, Decimal(0)) + cost_amount
                scoped_costs = {}
                unclassified_onboarding_ids = []
                legacy_unqualified_ids = []
                for use in resource + allocated_resource:
                    original_id = use["id"]
                    classification = modern.get(original_id, {}).get("category")
                    if classification in ONBOARDING_CATEGORIES:
                        amount = (Decimal(noncash_slices[original_id])
                                  if original_id in noncash_slices
                                  else Decimal(use["amount"]))
                        scoped_costs[classification] = (
                            scoped_costs.get(classification, Decimal(0)) + amount
                        )
                    elif classification in {
                        "context_process_basis", "rights_and_permissions",
                        "access_configuration", "training"
                    }:
                        legacy_unqualified_ids.append(original_id)
                    elif (lifecycle_by_resource.get(original_id, {}).get("stage")
                          == "ONBOARDING_AND_INTEGRATION"):
                        # An original onboarding use with no exact author
                        # category cannot disappear behind an explicit zero.
                        unclassified_onboarding_ids.append(original_id)
                zero_sources = zero_by_scenario[sc].get(owner, {})
                collisions = sorted(set(scoped_costs) & set(zero_sources))
                if collisions:
                    raise WorkCounterfactualInputError(
                        "COUNTERFACTUAL_NINE_ZERO_CONTRADICTS_ORIGINAL_USE"
                    )
                by_author_category = {}
                missing = []
                for category in ONBOARDING_CATEGORIES:
                    if category in scoped_costs:
                        amount = _money(scoped_costs[category])
                        kind = "ORIGINAL_SOURCE_DECLARED_NONCASH_RESOURCE_COST"
                    elif category in zero_sources:
                        amount = "0.00"
                        kind = "OWNER_SOURCE_ASSERTED_CATEGORY_ZERO_MODEL_ONLY"
                    else:
                        amount = None
                        kind = "CATEGORY_COST_OR_DECLARED_ZERO_UNKNOWN"
                        missing.append(category)
                    by_author_category[category] = {
                        "status": kind,
                        "noncash_original_resource_cost": amount,
                    }
                if unclassified_onboarding_ids:
                    reasons.append("ORIGINAL_ONBOARDING_USES_WITHOUT_EXACT_NINE_CATEGORY")
                if legacy_unqualified_ids:
                    reasons.append("HISTORICAL_LEGACY_TAG_IS_NOT_EXACT_AUTHOR_COST")
                onboarding_9 = sorted(scoped_costs)
                time_events = (
                    timeline_by_work.get(work_id, {})
                    .get("per_original_scenario_owner", {})
                    .get(sc, {}).get(owner, [])
                )
                allocated_or_original = {
                    item["id"] for item in resource + allocated_resource
                }
                timed_ids = {event["resource_use_id"] for event in time_events}
                # Timing is an optional original-source gate. Even when
                # supplied, source-declared event alignment is NOT a clocked
                # bank payment or proof of cost incurrence.
                untimed_ids = (
                    sorted(allocated_or_original - timed_ids)
                    if time_evidence is not None else None
                )
                nine_complete = not missing and not reasons
                private_liquidity = economic_view.get("cash_timing", {}).get(
                    "per_original_owner_private_research_projection", {}
                )
                payment_rows = economic_view.get("work_payment_causality", {}).get(
                    "bindings", []
                )
                scoped_payment = [
                    payment for payment in payment_rows
                    if payment.get("original_work") == work_id
                ]
                party_data[owner] = {
                    "kind": state.subjects[owner].kind,
                    "original_work_cash_from_existing_transfers": _money(cash),
                    "original_work_noncash_resource_uses": _money(noncash),
                    "cash_row_count": len(transfers),
                    "noncash_row_count": len(resource),
                    "allocated_original_common_cash_row_count": len(allocated_transfers),
                    "allocated_original_common_noncash_row_count": len(allocated_resource),
                    "unallocated_common_cost_count": len(unallocated),
                    "unallocated_common_cash_count": len(unallocated_cash),
                    "declared_lifecycle_stage_costs": {k:_money(v) for k,v in sorted(stage_costs.items())},
                    "historical_nine_onboarding_categories_with_bound_rows": onboarding_9,
                    "onboarding_nine_author_category_costs": by_author_category,
                    "onboarding_nine_missing_category_proofs": missing,
                    "onboarding_nine_unknown_category_count": len(missing),
                    "onboarding_nine_exact_source_scope_complete": nine_complete,
                    "onboarding_nine_original_noncash_total_separate_from_cash": (
                        _money(sum(scoped_costs.values(), Decimal(0)))
                        if nine_complete else None
                    ),
                    "original_work_model_timed_lifecycle_costs": [
                        {
                            "stage": event["stage"],
                            "original_applied_work_event_at": event["original_event_at"],
                            "original_resource_use_id": event["resource_use_id"],
                            "original_cost_slice": event[
                                "source_declared_noncash_original_work_cost"
                            ],
                            "is_not_verified_actual_incurrence": True,
                            "outside_not_executed": event[
                                "outside_option_action_was_not_executed"
                            ],
                        } for event in time_events
                    ],
                    "original_work_model_timed_cost_count": len(time_events),
                    "original_work_costs_without_event_timing": untimed_ids,
                    "original_work_timed_cost_coverage": (
                        "ALL_ORIGINAL_WORK_RESOURCE_ROWS_SOURCE_EVENT_ALIGNED_MODEL_ONLY"
                        if untimed_ids == [] else
                        "PARTIAL_OR_UNKNOWN_ORIGINAL_WORK_EVENT_TIMING"
                    ),
                    "onboarding_nine_legacy_unqualified_original_use_count": len(legacy_unqualified_ids),
                    "onboarding_nine_unclassified_original_use_count": len(unclassified_onboarding_ids),
                    "owner_private_declared_liquidity_status": private_liquidity.get(
                        owner, {}
                    ).get("status", "NOT_QUALIFIED"),
                    "work_payment_model_source_claim_count": len(scoped_payment),
                    "work_payment_claims_do_not_prove_bank_settlement": True,
                    "status": ("MODEL_WORK_SCOPE_ARITHMETIC_ELIGIBLE" if not reasons
                               else "WORK_ECONOMIC_SOURCE_SCOPE_INCOMPLETE"),
                    "reasons": reasons,
                }
            per_scenario[sc] = {
                "owners": party_data,
                "original_work_external_net_cash": _money(external),
                "original_work_internal_transfer_count": internal,
                "network_internal_transfers_cancel": True,
            }
        owner_comparison = {}
        for owner in sorted(names):
            c = per_scenario["COOPERATION"]["owners"][owner]
            alt = per_scenario["INDEPENDENT_ALTERNATIVE"]["owners"][owner]
            okay = not global_reasons and c["status"] == alt["status"] == "MODEL_WORK_SCOPE_ARITHMETIC_ELIGIBLE"
            nine_comparable = (
                okay and c["onboarding_nine_exact_source_scope_complete"]
                and alt["onboarding_nine_exact_source_scope_complete"]
            )
            nine_by_category = (
                {
                    category: _money(
                        Decimal(alt["onboarding_nine_author_category_costs"][
                            category]["noncash_original_resource_cost"]) -
                        Decimal(c["onboarding_nine_author_category_costs"][
                            category]["noncash_original_resource_cost"])
                    )
                    for category in ONBOARDING_CATEGORIES
                } if nine_comparable else None
            )
            owner_comparison[owner] = {
                "kind": state.subjects[owner].kind,
                "declared_work_cash_difference_cooperation_minus_alternative": (
                    _money(Decimal(c["original_work_cash_from_existing_transfers"]) -
                           Decimal(alt["original_work_cash_from_existing_transfers"]))
                    if okay else None
                ),
                "declared_work_noncash_cost_difference_separate_from_cash": (
                    _money(Decimal(c["original_work_noncash_resource_uses"]) -
                           Decimal(alt["original_work_noncash_resource_uses"]))
                    if okay else None
                ),
                "costs_and_cash_are_not_added_as_profit": True,
                "work_scope_research_status": (
                    "DECLARED_COMPARABLE_ONLY" if okay else "NOT_IDENTIFIABLE"
                ),
                "liquidity_proven_by_cash_difference": False,
                "nine_onboarding_declared_scope_comparable": nine_comparable,
                "nine_onboarding_independent_minus_cooperation_noncash_by_category": nine_by_category,
                "nine_onboarding_independent_minus_cooperation_noncash_total": (
                    _money(sum(
                        (Decimal(value) for value in nine_by_category.values()),
                        Decimal(0)
                    )) if nine_by_category is not None else None
                ),
                "nine_onboarding_not_cash_or_real_profit": True,
            }
        complete = not global_reasons and all(
            row["work_scope_research_status"] == "DECLARED_COMPARABLE_ONLY"
            for row in owner_comparison.values()
        )
        totals = {sc: Decimal(per_scenario[sc]["original_work_external_net_cash"]) for sc in SCENARIOS}
        original_rework_events = timeline_by_work.get(work_id, {}).get(
            "original_applied_quality_rework_signal_count"
        ) if time_evidence is not None else None
        referenced_rework_cost_events = sum(
            event["stage"] == "CLAIMS_AND_REWORK"
            for scenario in per_scenario.values()
            for row in scenario["owners"].values()
            for event in row["original_work_model_timed_lifecycle_costs"]
        )
        nine_all_owners = complete and all(
            comparison["nine_onboarding_declared_scope_comparable"]
            for comparison in owner_comparison.values()
        )
        nine_net = (
            sum(
                (Decimal(comparison["nine_onboarding_independent_minus_cooperation_noncash_total"])
                 for comparison in owner_comparison.values()), Decimal(0)
            ) if nine_all_owners else None
        )
        results.append({
            "work": work_id, "reuse_claim": claim,
            "work_comparison_source": comparison_source,
            "period": econ["period"], "currency": econ["currency"],
            "source_equivalence_research_claim": eq,
            "per_scenario": per_scenario,
            "per_original_owner": owner_comparison,
            "operator_owner_ids": sorted(o for o in names if state.subjects[o].kind == "OPERATOR"),
            "participant_owner_ids": sorted(o for o in names if state.subjects[o].kind != "OPERATOR"),
            "network_declared_external_cash_difference": (
                _money(totals["COOPERATION"] - totals["INDEPENDENT_ALTERNATIVE"]) if complete else None),
            "network_sums_only_original_external_cash": True,
            "network_nine_onboarding_noncash_difference_outside_minus_cooperation": (
                _money(nine_net) if nine_net is not None else None
            ),
            "operator_nine_onboarding_noncash_difference_outside_minus_cooperation": (
                _money(sum(
                    (Decimal(v["nine_onboarding_independent_minus_cooperation_noncash_total"])
                     for owner, v in owner_comparison.items()
                     if state.subjects[owner].kind == "OPERATOR"), Decimal(0)
                )) if nine_all_owners else None
            ),
            "nine_onboarding_complete_original_owner_count": sum(
                row["nine_onboarding_declared_scope_comparable"]
                for row in owner_comparison.values()
            ),
            "nine_onboarding_model_comparability": (
                "SOURCE_DECLARED_NINE_AUTHOR_COST_ARITHMETIC_ONLY"
                if nine_all_owners else "NOT_IDENTIFIABLE_FROM_COMPLETE_ORIGINAL_OWNER_SOURCES"
            ),
            "nine_cost_categories_not_a_second_ledger": True,
            "original_work_quality_rejection_or_rework_event_count": original_rework_events,
            "source_declared_rework_noncash_cost_event_binding_count": referenced_rework_cost_events,
            "rework_cost_evidence_status": (
                "ORIGINAL_APPLIED_REWORK_SIGNAL_COST_SOURCE_MISSING_OR_PARTIAL"
                if original_rework_events and not referenced_rework_cost_events else
                "ORIGINAL_REWORK_EVENT_AND_SOURCE_COST_ANCHORED_MODEL_ONLY"
                if referenced_rework_cost_events else "REWORK_COST_EVENT_EVIDENCE_UNKNOWN"
            ),
            "rework_not_real_damage_payment_or_causal_profit": True,
            "status": ("DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY" if complete
                       else "COUNTERFACTUAL_WORK_SCOPE_NOT_QUALIFIED"),
            "global_reasons": global_reasons,
            "original_internal_transfers_not_new_network_value": True,
            "shared_costs_only_original_owner_declared_views": True,
            "real_profit_and_causal_competence_gain": "NOT_ESTABLISHED",
            "full_work_lifecycle_and_onboarding_nine_real_costs_verified": False,
        })
    return {
        "evidence": "MODEL_ONLY_OWNER_SOURCE_SCOPED_CASH_AND_NONCASH",
        "works": results,
        "declared_comparable_work_count": sum(r["status"] == "DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY" for r in results),
        "model_declared_nine_onboarding_comparable_work_count": sum(
            r["nine_onboarding_model_comparability"]
            == "SOURCE_DECLARED_NINE_AUTHOR_COST_ARITHMETIC_ONLY" for r in results
        ),
        "independent_scenario_original_nine_categories_supported": True,
        "original_event_timed_rework_cost_work_count": sum(
            w["source_declared_rework_noncash_cost_event_binding_count"] > 0
            for w in results
        ),
        "event_time_alignment_not_real_cost_incurrence": True,
        "operator_and_original_participant_costs_not_combined_with_cash": True,
        "nine_historical_onboarding_categories": list(ONBOARDING_CATEGORIES),
        "contemporary_cost_exposures": list(MODERN_EXPOSURES),
        "cost_lifecycle_stages": list(STAGES),
        "individual_liquidity_not_derived_from_profit": True,
        "cash_and_resource_use_not_added_twice": True,
        "actual_profit": "UNKNOWN",
        "causal_transaction_savings": "NOT_IDENTIFIABLE",
        "new_money_or_original_result_created": False,
    }
