"""2026-evidence-aware economic interpretation of the ORIGINAL AKIS ledger.

The ten motives from the 2011 candidate thesis are *historical research
hypotheses*, not parameters, gains, institutional rights or empirical proof.
Modern source validation must establish each mechanism for a specific owner,
horizon, counterfactual, source and actual Result. This module never adds cash
or changes original Work, organisational code, resource use or delegation.
"""
from __future__ import annotations

from typing import Any, Mapping, Sequence


class ModernEconomicEvidenceError(ValueError):
    """A model-only cost attribution lacks an unambiguous original source."""


HISTORICAL_MOTIVES = (
    "transaction_cost_reduction",
    "specialized_information_infrastructure",
    "volume_related_discounts",
    "service_quality_from_knowledge",
    "extension_of_partner_services",
    "faster_projects_from_shared_resources",
    "organizational_and_logistics_innovation",
    "projects_impossible_for_single_member",
    "idle_resource_revenue",
    "access_to_new_markets",
)
# The author's original nine cost categories are kept as a HISTORICAL
# connection-cost decomposition. Naming them cannot establish completeness.
# Verified directly against doctorate Ch4, formula (4.6), primary DOCX
# printed p.17: Зинт + Зпасп + Здан + Зправ + Зшабл + Здоступ +
# Зтест + Зобуч + Звал. The labels denote independent cost sources.
ONBOARDING_CATEGORIES = (
    "interview",
    "participant_passport",
    "data_preparation",
    "rule_formalization",
    "process_templates",
    "access_rights_separation",
    "testing",
    "human_reviewer_training",
    "initial_validation",
)
# Earlier working-theory tags were too broad or inaccurately linked to the
# author's exact cost components. Retain as input for research compatibility,
# but NEVER count them as proved canonical cost categories: requalification
# of the original owner source is required.
LEGACY_UNQUALIFIED_TAGS = frozenset({
    "context_process_basis", "rights_and_permissions",
    "access_configuration", "training",
})
# Contemporary liabilities are additional dimensions, not a replacement
# of the nine author elements or a new author morphology axis.
MODERN_EXPOSURES = (
    "interoperability_and_semantics",
    "cybersecurity_and_incident_response",
    "data_usage_sovereignty",
    "portability_and_switching",
    "agent_identity_authorization_audit",
    "competition_and_information_separation",
    "regulatory_product_traceability",
    "financing_and_working_capital_carry_cost",
    "operator_governance_overhead",
)
CATEGORY_SET = set(ONBOARDING_CATEGORIES) | set(MODERN_EXPOSURES) | set(LEGACY_UNQUALIFIED_TAGS)
BINDING_FIELDS = frozenset({"owner", "category", "resource_use_id", "source"})
BINDING_SCOPED_FIELDS = BINDING_FIELDS | {"scenario"}
SCENARIOS = ("COOPERATION", "INDEPENDENT_ALTERNATIVE")
MAX_BINDINGS = 512  # parser bound, not an organizational/financial threshold

# These policy gates are deliberately narrower than the older blanket claims.
# This is a literature-motivated research map, not measured AKIS outcomes.
_MODERN_GATES = {
    "transaction_cost_reduction": "FULL_LIFECYCLE_CONTRACT_AND_COORDINATION_COST_COMPARISON",
    "specialized_information_infrastructure": "ALTERNATIVE_ARCHITECTURE_COST_AND_VIABLE_USE_CASE",
    "volume_related_discounts": "ORIGINAL_SUPPLIER_TIERS_NET_COST_AND_COMPETITION_REVIEW",
    "service_quality_from_knowledge": "ACCEPTED_RESULT_AND_LICENSED_REUSED_KNOWLEDGE",
    "extension_of_partner_services": "INDEPENDENT_MARKET_DEMAND_AND_QUALITY_CAPABILITY",
    "faster_projects_from_shared_resources": "SAME_SCOPE_SCHEDULE_RESILIENCE_AND_OPPORTUNITY_COST",
    "organizational_and_logistics_innovation": "PROCESS_ADOPTION_AND_VERIFIED_OUTCOME_MINUS_AI_COST_RISK",
    "projects_impossible_for_single_member": "TECHNOLOGY_COMPLEMENTARITY_RIGHTS_AND_LIQUIDITY",
    "idle_resource_revenue": "PAID_ORIGINAL_WORK_AND_FOREGONE_ALTERNATIVE",
    "access_to_new_markets": "REGULATORY_ACCESS_CHANNEL_COST_AND_PLATFORM_DEPENDENCE",
}


def _name(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        raise ModernEconomicEvidenceError(code)
    return value


def review_cost_attribution(
    raw: Any, *, sources: Mapping[str, Any], resource_index: Mapping[str, Any],
    subjects: Mapping[str, Any],
) -> dict[str, Any]:
    """Refer ONLY to original resource_uses for each independent scenario, never new money.

    Absence of a category proves neither zero cost nor high profitability.
    All source records in this original ledger are MODEL_ONLY; reference binding
    cannot authenticate invoice, reimbursement, cash, physical saving or right.
    """
    if not isinstance(raw, list) or len(raw) > MAX_BINDINGS:
        raise ModernEconomicEvidenceError("INVALID_MODERN_ECONOMIC_BINDING_COUNT")
    used: set[str] = set()
    by_owner: dict[str, dict[str, list[str]]] = {}
    by_owner_scenario: dict[str, dict[str, dict[str, list[str]]]] = {}
    for row in raw:
        if not isinstance(row, dict) or set(row) not in (BINDING_FIELDS, BINDING_SCOPED_FIELDS):
            raise ModernEconomicEvidenceError("INVALID_MODERN_ECONOMIC_BINDING")
        scenario = row.get("scenario", "COOPERATION")
        if scenario not in SCENARIOS:
            raise ModernEconomicEvidenceError("MODERN_ECONOMIC_SCENARIO_INVALID")
        owner = _name(row["owner"], "INVALID_MODERN_ECONOMIC_OWNER")
        cat = _name(row["category"], "INVALID_MODERN_ECONOMIC_CATEGORY")
        record_id = _name(row["resource_use_id"], "INVALID_MODERN_RESOURCE_ID")
        source = _name(row["source"], "INVALID_MODERN_SOURCE_ID")
        if owner not in subjects:
            raise ModernEconomicEvidenceError("MODERN_ECONOMIC_OWNER_UNKNOWN")
        if cat not in CATEGORY_SET:
            raise ModernEconomicEvidenceError("MODERN_ECONOMIC_CATEGORY_UNKNOWN")
        if record_id in used:
            raise ModernEconomicEvidenceError("DUPLICATE_MODERN_ECONOMIC_RESOURCE_ATTRIBUTION")
        resource = resource_index.get(record_id)
        if resource is None:
            raise ModernEconomicEvidenceError("MODERN_ECONOMIC_RESOURCE_NOT_IN_ORIGINAL_LEDGER")
        if (resource["scenario"] != scenario or
                resource["owner"] != owner or resource["source"] != source or
                sources.get(source, {}).get("owner") != owner):
            raise ModernEconomicEvidenceError("MODERN_ECONOMIC_OWNER_SOURCE_SCOPE_MISMATCH")
        used.add(record_id)
        by_owner.setdefault(owner, {}).setdefault(cat, []).append(record_id)
        by_owner_scenario.setdefault(owner, {}).setdefault(scenario, {}).setdefault(
            cat, []
        ).append(record_id)
    return {
        "evidence": "MODEL_ONLY_ORIGINAL_RESOURCE_USE_REFERENCE",
        "onboarding_9_historical_categories": list(ONBOARDING_CATEGORIES),
        "onboarding_primary_source": "DOCTORATE_CH4_FORMULA_4_6_VERIFIED_PRIMARY_DOCX",
        "legacy_tags_cannot_fill_author_categories": True,
        "modern_cost_and_risk_exposures": list(MODERN_EXPOSURES),
        "owners": {
            owner: {
                "categories_with_declared_non_cash_use": sorted(categories),
                "onboarding_missing_source_coverage": [
                    category for category in ONBOARDING_CATEGORIES if category not in categories
                ],
                "modern_exposure_unreported": [
                    category for category in MODERN_EXPOSURES if category not in categories
                ],
                "legacy_unqualified_tags_requiring_owner_source_review": sorted(
                    category for category in categories if category in LEGACY_UNQUALIFIED_TAGS
                ),
                "bound_original_use_count": sum(len(uses) for uses in categories.values()),
                "by_original_scenario": {
                    scenario: {
                        "categories_with_original_use": sorted(
                            by_owner_scenario.get(owner, {}).get(scenario, {})
                        ),
                        "nine_categories_not_bound_in_this_scenario": [
                            category for category in ONBOARDING_CATEGORIES
                            if category not in by_owner_scenario.get(owner, {}).get(
                                scenario, {}
                            )
                        ],
                        "zero_cost_not_inferred_from_absence": True,
                    }
                    for scenario in SCENARIOS
                },
                "amounts_not_added_again_to_cash_or_real_resource_uses": True,
                "missing_cost_is_not_zero": True,
                "full_lifecycle_cost_completeness": "NOT_ESTABLISHED",
            }
            for owner, categories in sorted(by_owner.items())
        },
        "distinct_original_resource_use_references": len(used),
        "no_new_cash_or_resource_use": True,
        "both_scenarios_only_existing_original_resource_uses": True,
        "no_established_total_onboarding_cost_or_saving": True,
        "no_company_data_sharing_right_derived": True,
    }


def modern_economic_review(
    subjects: Mapping[str, Any],
    *, economic_view: Mapping[str, Any] | None,
    joint_purchasing: Mapping[str, Any] | None = None,
    formation: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Cross-component interpretation with failure-to-prove by default.

    Only existing model outputs are interpreted. Operator, firms and network
    are separate perspectives. Internal transfers may cancel on consolidation,
    but claimed cash deltas NEVER establish causation or financial viability.
    """
    firms = sorted(key for key, v in subjects.items() if v.kind != "OPERATOR")
    operators = sorted(key for key, v in subjects.items() if v.kind == "OPERATOR")
    per_subject = economic_view.get("per_subject", {}) if economic_view else {}
    liquidity = economic_view.get("cash_timing", {}) if economic_view else {}
    lifecycle = economic_view.get("lifecycle_resource_costs", {}) if economic_view else {}
    private_liquidity = liquidity.get("per_original_owner_private_research_projection", {})
    private_statuses = {
        owner: {
            "comparison": per_subject.get(owner, {}).get(
                "cash_comparison", "NOT_IDENTIFIABLE"),
            "outside_feasibility": per_subject.get(owner, {}).get(
                "outside_feasibility", "UNKNOWN"),
            "liquidity_sufficiency": private_liquidity.get(owner, {}).get(
                "status", "NOT_ESTABLISHED_BY_CASH_DIFFERENCE"
            ),
            "transaction_cost_saving": "NOT_IDENTIFIABLE_WITHOUT_COMPARABLE_COST_CHAIN",
            "original_independent_consent": "NOT_INFERRED",
        } for owner in sorted(subjects)
    }
    network_comparison = (
        "DECLARED_EXTERNAL_CASH_ARITHMETIC_ONLY"
        if economic_view and economic_view.get("consolidated_comparable_declared")
        else "NOT_IDENTIFIABLE"
    )
    purchase_status = (
        "POSSIBLE_GROUP_REQUIRES_COMPETITION_AND_LEGAL_REVIEW"
        if joint_purchasing and any(
            row.get("status") == "UNIQUE_PROSPECTIVE_GROUP_NOT_CONSENTED"
            for row in joint_purchasing.get("proposals", [])
        ) else "NO_CURRENT_VOLUNTARY_GROUP_VERIFIED"
    )
    return {
        "scientific_status": "HISTORICAL_MOTIVES_CURRENTLY_CONDITIONAL_NOT_EFFICACY_CLAIMS",
        "current_world_evidence_evaluated_separately_from_this_model": True,
        "motives_2011": [
            {
                "id": key,
                "modernization": "CONDITIONALLY_RETAIN_OR_REFORMULATE_NOT_AUTOMATIC",
                "required_qualification": _MODERN_GATES[key],
                "realized_economic_effect": "NOT_ESTABLISHED_BY_MOTIVE",
            } for key in HISTORICAL_MOTIVES
        ],
        "historic_motive_count": len(HISTORICAL_MOTIVES),
        "onboarding_nine_historical_buckets": list(ONBOARDING_CATEGORIES),
        "modern_cost_exposures": list(MODERN_EXPOSURES),
        "per_original_subject": private_statuses,
        "firm_count": len(firms),
        "operator_count": len(operators),
        "operator_perspective": (
            "SEPARATE_DECLARED_CASH_NOT_PROOF_OF_SUSTAINABILITY"
            if operators and economic_view else "NOT_IDENTIFIABLE"
        ),
        "operator_declared_liquidity_gap_count": sum(
            private_liquidity.get(owner, {}).get("status")
            == "DECLARED_LIQUIDITY_GAP_IN_ONE_OR_MORE_CASES"
            for owner in operators
        ),
        "timed_cash_proof_counts_without_private_amounts": liquidity.get(
            "cross_owner_nonfinancial_status_counts", {}
        ),
        "timed_cash_owner_values_remain_private_not_for_interfirm_publication": True,
        "lifecycle_stages_defined": len(lifecycle.get("stages", [])),
        "lifecycle_original_records_classified": lifecycle.get(
            "classified_original_record_count", 0
        ),
        "lifecycle_owner_declared_comparison_count": lifecycle.get(
            "owners_with_source_declared_scope_comparison", 0
        ),
        "lifecycle_resource_cost_arithmetic_is_not_causal_economy": True,
        "network_perspective": network_comparison,
        "internal_transfers_added_as_external_value": False,
        "liquidity_proof_from_individual_claims": (
            "SOURCE_DECLARED_FORECAST_NOT_REAL_BANK_SOLVENCY"
            if liquidity else "NOT_ESTABLISHED"
        ),
        "bilateral_model_finance_state": (
            "PRESENT_MODEL_ONLY" if formation and "economic_choice" in formation
            else "NOT_QUALIFIED"
        ),
        "joint_purchasing": purchase_status,
        "competition_market_law": "REQUIRES_JURISDICTION_SPECIFIC_EVALUATION",
        "platform_dependence_and_exit_cost": "NOT_ZERO_BY_DEFAULT",
        "security_identity_and_data_usage_risks": "NOT_ZERO_BY_DEFAULT",
        "real_world_causal_savings": "NOT_ESTABLISHED",
        "new_original_events_or_legal_rights": False,
    }
