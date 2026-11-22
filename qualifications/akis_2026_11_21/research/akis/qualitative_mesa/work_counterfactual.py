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
        if not isinstance(row, dict) or set(row) != required:
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
        history[work_id] = (claim, eq, owner_proofs)
    results = []
    raw_transfers = econ["transfers"]
    raw_resource_uses = econ["resource_uses"]
    bindings = econ.get("lifecycle_costs", {}).get("bindings", [])
    lifecycle_by_resource = {record["resource_use_id"]: record for record in bindings}
    modern = {b["resource_use_id"]: b for b in econ.get("modern_cost_bindings", [])}
    for work_id, (claim, eq, proofs) in history.items():
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
            for transfer in raw_transfers:
                if transfer["scenario"] != sc or transfer["work"] != work_id:
                    continue
                amt = Decimal(transfer["amount"])
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
                unallocated = [c for c in raw_resource_uses if c["scenario"] == sc
                               and c["work"] is None and c["owner"] == owner]
                cash = sum((Decimal(t["amount"]) * (1 if t["payee"] == owner else -1)
                            for t in transfers), Decimal(0))
                noncash = sum((Decimal(c["amount"]) for c in resource), Decimal(0))
                reasons = []
                if proof is None or not proof["complete"]:
                    reasons.append("ORIGINAL_OWNER_WORK_COST_SCOPE_NOT_COMPLETE_DECLARED")
                if proof is not None:
                    if not transfers and not proof["declared_zero_cash"]:
                        reasons.append("ZERO_CASH_NOT_OWNER_ATTESTED")
                    if not resource and not proof["declared_zero_noncash"]:
                        reasons.append("ZERO_NONCASH_COST_NOT_OWNER_ATTESTED")
                if owner not in economic_view["coverage_proof_sources"].get(sc, {}):
                    reasons.append("ORIGINAL_OWNER_GENERAL_ECONOMIC_COVERAGE_MISSING")
                if unallocated:
                    reasons.append("COMMON_NONCASH_COST_NOT_ATTRIBUTED_TO_WORK")
                if any(c["id"] not in lifecycle_by_resource for c in resource):
                    reasons.append("WORK_COST_NOT_LIFECYCLE_CLASSIFIED")
                outside = economic_view["per_subject"][owner]["outside_feasibility"]
                if outside != "FEASIBLE_DECLARED":
                    reasons.append("INDEPENDENT_ALTERNATIVE_NOT_FEASIBLE_DECLARED")
                stage_costs = {}
                for use in resource:
                    category = lifecycle_by_resource.get(use["id"], {}).get("stage")
                    if category is not None:
                        stage_costs[category] = stage_costs.get(category, Decimal(0)) + Decimal(use["amount"])
                onboarding_9 = sorted({modern[use["id"]]["category"] for use in resource
                                       if use["id"] in modern and
                                       modern[use["id"]]["category"] in ONBOARDING_CATEGORIES})
                party_data[owner] = {
                    "kind": state.subjects[owner].kind,
                    "original_work_cash_from_existing_transfers": _money(cash),
                    "original_work_noncash_resource_uses": _money(noncash),
                    "cash_row_count": len(transfers),
                    "noncash_row_count": len(resource),
                    "unallocated_common_cost_count": len(unallocated),
                    "declared_lifecycle_stage_costs": {k:_money(v) for k,v in sorted(stage_costs.items())},
                    "historical_nine_onboarding_categories_with_bound_rows": onboarding_9,
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
            }
        complete = not global_reasons and all(
            row["work_scope_research_status"] == "DECLARED_COMPARABLE_ONLY"
            for row in owner_comparison.values()
        )
        totals = {sc: Decimal(per_scenario[sc]["original_work_external_net_cash"]) for sc in SCENARIOS}
        results.append({
            "work": work_id, "reuse_claim": claim,
            "work_comparison_source": row["comparison_source"] if False else next(
                raw_row["comparison_source"] for raw_row in raw if raw_row["work"] == work_id),
            "period": econ["period"], "currency": econ["currency"],
            "source_equivalence_research_claim": eq,
            "per_scenario": per_scenario,
            "per_original_owner": owner_comparison,
            "operator_owner_ids": sorted(o for o in names if state.subjects[o].kind == "OPERATOR"),
            "participant_owner_ids": sorted(o for o in names if state.subjects[o].kind != "OPERATOR"),
            "network_declared_external_cash_difference": (
                _money(totals["COOPERATION"] - totals["INDEPENDENT_ALTERNATIVE"]) if complete else None),
            "network_sums_only_original_external_cash": True,
            "status": ("DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY" if complete
                       else "COUNTERFACTUAL_WORK_SCOPE_NOT_QUALIFIED"),
            "global_reasons": global_reasons,
            "original_internal_transfers_not_new_network_value": True,
            "real_profit_and_causal_competence_gain": "NOT_ESTABLISHED",
            "full_work_lifecycle_and_onboarding_nine_real_costs_verified": False,
        })
    return {
        "evidence": "MODEL_ONLY_OWNER_SOURCE_SCOPED_CASH_AND_NONCASH",
        "works": results,
        "declared_comparable_work_count": sum(r["status"] == "DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY" for r in results),
        "nine_historical_onboarding_categories": list(ONBOARDING_CATEGORIES),
        "contemporary_cost_exposures": list(MODERN_EXPOSURES),
        "cost_lifecycle_stages": list(STAGES),
        "individual_liquidity_not_derived_from_profit": True,
        "cash_and_resource_use_not_added_twice": True,
        "actual_profit": "UNKNOWN",
        "causal_transaction_savings": "NOT_IDENTIFIABLE",
        "new_money_or_original_result_created": False,
    }
