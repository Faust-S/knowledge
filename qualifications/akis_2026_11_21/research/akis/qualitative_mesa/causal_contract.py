"""R1: executable *diagnostic* of the author's six cross-component edges.

Uses ONLY the original QualitativeAKIS state, real (MODEL_ONLY) event trace,
original economic claims, and the canonical author's concept map. It does
not add a second model, events, a software agent, permission, or profit.
"""
from __future__ import annotations

from typing import Any, Mapping

EXPECTED_MEANINGS = (
    "NEED_CHANGES_PROCESS", "AGENT_FUNCTION_IS_DERIVED",
    "SCOPED_RESOURCES_NEED_OWNER_CONFIRMATION",
    "WORK_AND_ACCEPTANCE_ARE_SEPARATE_OWNER_EVENTS",
    "REAL_EVENTS_SUPPORT_SPECIFIC_ECONOMIC_OBSERVATIONS",
    "PROPOSE_REVISION_NOT_AUTOMATIC_OVERRIDE_OF_OWNERS",
)

class CausalContractInputError(ValueError):
    pass


def assess_author_causal_edges(
    design: Any, original: Any, general_view: Mapping[str, Any], *,
    economics: Mapping[str, Any] | None = None,
    work_counterfactual: Mapping[str, Any] | None = None,
    at: float,
) -> dict[str, Any]:
    model = design.catalog["integrated_operator_model"]["dynamics_revision_2026_11_20"]
    edges = model["dependency_relations"]
    if not isinstance(edges, list) or tuple(x.get("meaning") for x in edges) != EXPECTED_MEANINGS:
        raise CausalContractInputError("AKIS_AUTHOR_ORIGINAL_CAUSAL_LINKS_CHANGED")
    original_trace = original.trace
    applied = [x for x in original_trace if x.get("outcome") == "APPLIED"]
    accepted = {k for k,v in original.works.items()
                if v.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"}
    claimed_goals = {v["work"] for v in design.declarations["goals"]}
    valid_goals = {v["work"] for v in design.declarations["goals"]
                   if (v["revision"] == original.institution.revision and
                       v["available_at"] <= at < v["expires_at"])}
    requested = {r.get("work") for r in applied if r.get("action") == "request"}
    goal_to_work = valid_goals & requested
    approved_works = {
        k for k,v in original.works.items()
        if v.obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    }
    with_model_capacity = bool(original.capacity_ledger.specs) and any(
        spec.basis == "MODEL_DECLARED"
        for spec in original.capacity_ledger.specs.values()
    )
    prepared_agents = int(
        general_view["components"]["А"].get("bounded_process_computations", 0)
    )
    # Financial statements may have a customer-declared period-wide balance,
    # but cannot supply the missing Work-level economic causal effect.
    full_counterfactual = bool(work_counterfactual) and any(
        v["status"] == "DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
        for v in work_counterfactual.get("works", [])
    )
    links = [
        {
            "status": "MODEL_ORIGINAL_REQUEST_LINKED_TO_GOAL"
                      if goal_to_work else "MODEL_GOAL_TO_REQUEST_NOT_OBSERVED",
            "source_work_ids": sorted(goal_to_work),
            "independent_owner_goal_revision_created": False,
        },
        {
            "status": "MODEL_BOUNDED_PREPARATION_NOT_DELEGATION"
                      if prepared_agents else "AUTHOR_SOFTWARE_AGENT_NOT_IMPLEMENTED",
            "bounded_existing_work_preparations": prepared_agents,
            "real_A_equals_F_P_OK_KPB_qualified": False,
        },
        {
            "status": "MODEL_ORIGINAL_CAPACITY_AND_CONSENT_PREDICATE"
                      if approved_works and with_model_capacity
                      else "ORIGINAL_OWNER_RESOURCE_OR_CONSENT_NOT_QUALIFIED",
            "original_committed_work_ids": sorted(approved_works),
            "resource_capacity_independently_verified": False,
        },
        {
            "status": "MODEL_ACCEPTED_ORIGINAL_RESULT_WITH_SEPARATE_OWNER_ACTION"
                      if accepted else "NO_ACCEPTED_ORIGINAL_RESULT",
            "accepted_original_result_work_ids": sorted(accepted),
            "real_program_agent_action_not_demonstrated": True,
            "real_customer_acceptance_authenticated": False,
        },
        {
            "status": "MODEL_WORK_ARITHMETIC_NOT_REAL_ECONOMIC_CAUSALITY"
                      if accepted and full_counterfactual
                      else "WORK_SPECIFIC_REAL_COST_AND_RESULT_NOT_QUALIFIED",
            "original_economic_records_present": economics is not None,
            "model_comparable_work_arithmetic": full_counterfactual,
            "real_economic_effect_identified": False,
        },
        {
            "status": "MODEL_ORIGINAL_OWNER_REVISION_ACTION_NOT_AUTO_CHANGE"
                      if any(r.get("action") in {"adopt_capability",
                                               "cooperation_change_propose"}
                             for r in applied)
                      else "ORIGINAL_REVISION_DECISION_NOT_OBSERVED",
            "new_enterprise_need_or_contract_automatically_created": False,
            "outside_market_change_w_t_empirically_verified": False,
        },
    ]
    items = [{
        "from": row["from"], "to": row["to"], "meaning": row["meaning"],
        **projection,
    } for row, projection in zip(edges, links, strict=True)]
    components = tuple(general_view["components"])
    if components != ("Ц","У","А","П","КПБ","ОК","КЖ","Э","ЖЦ"):
        raise CausalContractInputError("AKIS_AUTHOR_NINE_COMPONENTS_MISSING")
    return {
        "evidence": "SOURCE_DECLARED_MODEL_ONLY_SIX_AUTHOR_RELATIONS",
        "author_original_nine_components": list(components),
        "six_author_original_dependency_relations": items,
        "declared_current_goals_without_original_request": sorted(claimed_goals - requested),
        "original_owner_decisions_not_synthesized": True,
        "technical_modelled_links_not_real_economic_or_institutional_causality": True,
        "software_delegation_A_still_absent": True,
        "outside_w_t_market_process_not_endogenously_modelled": True,
        "original_13_OC_and_eight_phases_not_automatically_qualified": True,
        "nine_component_causal_closure_scientifically_proved": False,
        "next_required_work": "R1_ORIGINAL_ACTOR_GATES_AND_R2_OWNER_COST_ORIGINALS",
    }
