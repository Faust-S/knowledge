"""R1: executable *diagnostic* of the author's six cross-component edges.

Uses ONLY the original QualitativeAKIS state, real (MODEL_ONLY) event trace,
original economic claims, and the canonical author's concept map. It does
not add a second model, events, a software agent, permission, or profit.
"""
from __future__ import annotations

from typing import Any, Mapping

# Public qualification may contain only the public author taxonomy, not
# the closed full doctorate/monograph map. These six previously verified
# original relations are deliberately fixed here and cross-checked against
# the full original concept map when the latter is available locally.
AUTHOR_EDGES = (
    ("Ц", "П", "NEED_CHANGES_PROCESS"),
    ("П,ОК,КПБ", "А", "AGENT_FUNCTION_IS_DERIVED"),
    ("У,П", "RESOURCE_FEASIBILITY", "SCOPED_RESOURCES_NEED_OWNER_CONFIRMATION"),
    ("П,А,У", "КЖ", "WORK_AND_ACCEPTANCE_ARE_SEPARATE_OWNER_EVENTS"),
    ("КЖ,REAL_RESOURCES", "Э", "REAL_EVENTS_SUPPORT_SPECIFIC_ECONOMIC_OBSERVATIONS"),
    ("Э,КЖ,w_t", "ЖЦ,ОК,П", "PROPOSE_REVISION_NOT_AUTOMATIC_OVERRIDE_OF_OWNERS"),
)

class CausalContractInputError(ValueError):
    pass


def assess_author_causal_edges(
    design: Any, original: Any, general_view: Mapping[str, Any], *,
    economics: Mapping[str, Any] | None = None,
    work_counterfactual: Mapping[str, Any] | None = None,
    at: float,
) -> dict[str, Any]:
    source_model = design.catalog.get("integrated_operator_model", {})
    revision = source_model.get("dynamics_revision_2026_11_20", {})
    original_edges = revision.get("dependency_relations")
    if original_edges is not None and (
        not isinstance(original_edges, list) or
        tuple((v.get("from"), v.get("to"), v.get("meaning"))
              for v in original_edges) != AUTHOR_EDGES
    ):
        raise CausalContractInputError("AKIS_AUTHOR_ORIGINAL_CAUSAL_LINKS_CHANGED")
    edges = [{"from": from_component, "to": to_component, "meaning": meaning}
             for from_component, to_component, meaning in AUTHOR_EDGES]
    # Source time belongs to the ORIGINAL decision event, not to the final
    # observation time. Late declarations and expired goal sources cannot be
    # projected backwards onto a historic customer request.
    original_trace = original.trace
    applied = [row for row in original_trace if row.get("outcome") == "APPLIED"]
    requested = {
        row["work"] for row in applied
        if row.get("action") == "request"
        and row.get("work") in original.works
        and row.get("actor") == original.works[row["work"]].customer
    }
    claimed_goals = {row["work"] for row in design.declarations["goals"]}
    goal_to_work: set[str] = set()
    for goal in design.declarations["goals"]:
        work = original.works.get(goal["work"])
        if (work is None or work.customer != goal["owner"] or
                work.source_revision != goal["work_revision"]):
            continue
        request_rows = (original.original_request_rows(goal["work"])
                        if getattr(original, "network_scale", False) else applied)
        for event in request_rows:
            if event.get("outcome") != "APPLIED":
                continue
            event_at = event.get("at")
            if (event.get("action") == "request" and
                    event.get("work") == goal["work"] and
                    event.get("actor") == goal["owner"] and
                    type(event_at) is int and
                    goal["available_at"] <= event_at < goal["expires_at"] and
                    goal["revision"] == event.get("org_revision")):
                goal_to_work.add(goal["work"])
                break
    accepted = {
        row["work"] for row in applied
        if row.get("action") == "accept"
        and row.get("work") in original.works
        and row.get("actor") == original.works[row["work"]].customer
        and original.works[row["work"]].result
            == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    }
    committed = {
        row["work"] for row in applied
        if row.get("action") == "commit"
        and row.get("work") in original.works
        and original.works[row["work"]].obligation in {
            "ACCEPTED_BY_ORIGINAL_PRINCIPALS", "FULFILLED"
        }
    }
    # Capacity of an unrelated enterprise must not qualify a different Work.
    model_capacity_commits = {
        key for key in committed
        if original.works[key].resource_requirements and all(
            getattr(original.capacity_ledger.specs.get(need.resource), "basis", None)
                == "MODEL_DECLARED"
            for need in original.works[key].resource_requirements
        )
    }
    approved_works = committed
    with_model_capacity = bool(model_capacity_commits)
    prepared_agents = int(
        general_view["components"]["А"].get("bounded_process_computations", 0)
    )
    # Financial statements may have a customer-declared period-wide balance,
    # but cannot supply the missing Work-level economic causal effect.
    original_allocations = ((economics or {}).get("common_work_allocations") or {})
    scoped_bilateral_cash_slices = original_allocations.get(
        "model_bilateral_internal_transfer_slices", 0
    )
    comparable_accepted_work = {
        row.get("work") for row in (work_counterfactual or {}).get("works", [])
        if row.get("status")
            == "DECLARED_WORK_SCOPE_CASH_AND_RESOURCE_ARITHMETIC_ONLY"
        and row.get("work") in accepted
    }
    full_counterfactual = bool(comparable_accepted_work)
    links = [
        {
            "status": "MODEL_ORIGINAL_REQUEST_LINKED_TO_GOAL"
                      if goal_to_work else "MODEL_GOAL_TO_REQUEST_NOT_OBSERVED",
            "same_original_work_model_request_count": len(goal_to_work),
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
            "original_committed_work_count": len(approved_works),
            "committed_work_with_its_own_model_capacity_count": len(model_capacity_commits),
            "resource_capacity_independently_verified": False,
        },
        {
            "status": "MODEL_ACCEPTED_ORIGINAL_RESULT_WITH_SEPARATE_OWNER_ACTION"
                      if accepted else "NO_ACCEPTED_ORIGINAL_RESULT",
            "accepted_original_result_work_count": len(accepted),
            "real_program_agent_action_not_demonstrated": True,
            "real_customer_acceptance_authenticated": False,
        },
        {
            "status": "MODEL_WORK_ARITHMETIC_NOT_REAL_ECONOMIC_CAUSALITY"
                      if accepted and full_counterfactual
                      else "WORK_SPECIFIC_REAL_COST_AND_RESULT_NOT_QUALIFIED",
            "original_economic_records_present": economics is not None,
            "model_comparable_work_arithmetic": full_counterfactual,
            "same_accepted_original_work_counterfactual_count":
                len(comparable_accepted_work),
            "original_model_payer_payee_common_cash_slices": scoped_bilateral_cash_slices,
            "paired_owner_sources_restrict_work_economic_attribution": True,
            "bilateral_claims_are_not_verified_real_signatures": True,
            "original_internal_transfers_are_not_network_value_added": True,
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
    # R1-H: typed scientific transition contract over the SAME original state.
    # Explicitly distinguish original Mesa's event guards from evidence-only
    # author claims; this neither installs a second engine nor grants rights.
    core = getattr(original, "context_basis", None)
    model_code = getattr(original, "model_org_policy", None)
    revision_events = sum(
        r.get("action") in {"adopt_capability", "cooperation_change_propose"}
        for r in applied
    )
    component_contract = [
        ("Ц", "HISTORIC_OWNER_GOAL_SOURCE_AND_REQUEST" if goal_to_work else
         "NO_TIME_QUALIFIED_ORIGINAL_GOAL_REQUEST", "CUSTOMER_REQUEST_GUARD_GOAL_DIAGNOSTIC"),
        ("У", "ORIGINAL_PRINCIPAL_COMMIT" if committed else "NO_ORIGINAL_COMMIT",
         "ORIGINAL_OWNER_CONSENT_AND_ACTIVE_SUBJECT_GUARDS"),
        ("А", "BOUNDED_SOURCE_PREPARATION" if prepared_agents else "NOT_EXECUTABLE",
         "NO_AUTONOMOUS_AUTHORITY"),
        ("П", "ORIGINAL_WORK_REQUEST_AND_COMMIT" if requested and committed
         else "PARTIAL_ORIGINAL_WORK", "ORIGINAL_WORK_ACTION_GUARDS"),
        ("КПБ", "MODEL_CONTEXT_SOURCE_SCOPED" if core is not None
         else "NO_ORIGINAL_CONTEXT_BASIS",
         "OPTIONAL_ORIGINAL_SOURCE_SCOPE_GUARD" if core is not None
         else "NO_SOURCE_SCOPE_GUARD"),
        ("ОК", "MODEL_THIRTEEN_CONTROLS_CONFIGURED" if model_code is not None
         else "ORIGINAL_GOVERNANCE_PARTIAL", "ORIGINAL_GOVERNANCE_AND_OPTIONAL_MODEL_OC"),
        ("КЖ", "ORIGINAL_CUSTOMER_ACCEPTED_RESULT" if accepted
         else "NO_ORIGINAL_ACCEPTED_RESULT", "ORIGINAL_RESULT_QUALITY_AND_RECIPIENT_GUARDS"),
        ("Э", "SAME_ACCEPTED_WORK_COUNTERFACTUAL" if full_counterfactual
         else "NO_SAME_WORK_ECONOMIC_CAUSAL_WITNESS", "NONBINDING_DIAGNOSTIC_ONLY"),
        ("ЖЦ", "ORIGINAL_OWNER_REVISION_EVENT" if revision_events
         else "NO_OWNER_REVISION_EVENT", "NO_FULL_FORMATION_LIFECYCLE_GATE"),
    ]
    component_contract_rows = [
        {"component": name, "model_transition_witness": witness,
         "original_model_guard_class": guard,
         "author_full_component_transition_implemented": False}
        for name, witness, guard in component_contract
    ]
    if tuple(row["component"] for row in component_contract_rows) != components:
        raise CausalContractInputError("AKIS_R1H_COMPONENT_CONTRACT_ORDER_INVALID")
    blocked = [r for r in original_trace if r.get("outcome") == "BLOCKED"]
    return {
        "evidence": "SOURCE_DECLARED_MODEL_ONLY_SIX_AUTHOR_RELATIONS",
        "full_private_author_map_crosschecked": original_edges is not None,
        "public_taxonomy_only_falls_back_to_preverified_original_edges": original_edges is None,
        "author_original_nine_components": list(components),
        "six_author_original_dependency_relations": items,
        "declared_goals_without_time_qualified_original_request_count":
            len(claimed_goals - goal_to_work),
        "historical_goal_to_original_request_source_match_count": len(goal_to_work),
        "original_blocked_event_count": len(blocked),
        "nine_component_typed_transition_contract": {
            "schema": "AKIS_R1H_ORIGINAL_MODEL_TRANSITION_CONTRACT/0.1",
            "components": component_contract_rows,
            "original_model_event_trace_is_only_business_transition_source": True,
            "goal_source_must_be_valid_at_original_request_not_final_snapshot": True,
            "source_revision_and_owner_must_match_same_original_work": True,
            "economic_work_must_be_originally_accepted_and_same_scoped_work": True,
            "model_original_event_guards_not_real_authenticated_rights": True,
            "all_original_six_configurations_executable": False,
            "all_author_13_OC_and_four_KPB_active_grants": False,
            "all_eight_formational_transitions_executable": False,
            "complete_author_agent_A_F_P_OC_KPB": False,
            "full_original_nine_component_dynamics": False,
            "private_work_source_or_actor_identifiers_redisclosed": False,
        },
        "original_owner_decisions_not_synthesized": True,
        "technical_modelled_links_not_real_economic_or_institutional_causality": True,
        "software_delegation_A_still_absent": True,
        "outside_w_t_market_process_not_endogenously_modelled": True,
        "original_13_OC_and_eight_phases_not_automatically_qualified": True,
        "nine_component_causal_closure_scientifically_proved": False,
        "next_required_work":
            "R1_H_ORIGINAL_NINE_COMPONENT_ACTIVE_GATES_AND_R3_GLOBAL_DYNAMICS",
    }
