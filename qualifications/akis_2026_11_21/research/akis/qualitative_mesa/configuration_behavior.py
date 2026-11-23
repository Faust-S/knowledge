"""Author-configured operating *applicability* over the original AKIS research state.

The six forms and nine morphology axes are authored scientific dimensions, not
new enterprise classes, governance modes, a delegation grant or a legal form.
This module inspects ONE QualitativeAKIS state and reports consequences for
original Work, subject rights, resource scope and required economic evidence.
It grants nothing and never mutates QualitativeAKIS or its original Results.
"""
from __future__ import annotations

from typing import Any, Mapping

# Source-specific economic questions, not scores, prices or verified effects.
ECONOMIC_QUESTIONS = {
    "intra": ("PROCESS_DEBT", "INTERNAL_COORDINATION", "STAFF_TIME"),
    "inter": ("INDEPENDENT_ALTERNATIVES", "TRANSACTION_COST", "INTERFIRM_RISK"),
    "operator": ("ONBOARDING_COST", "REUSED_PROCESSES", "EXPERIENCE_RETURN", "OPERATOR_SUSTAINABILITY", "CONTEXT_CAPTURE"),
    "sector": ("STANDARD_CONFORMANCE", "SOURCE_VERIFICATION", "ERROR_COST"),
    "macro": ("INSTITUTIONAL_RULES", "EXTERNALITIES", "PUBLIC_ACCOUNTABILITY"),
    "trace": ("CONTEXT_PORTABILITY", "OWNERSHIP_RIGHTS", "PRIVACY_RISK"),
}


def _original_principals(state: Any, work: Any) -> tuple[str, ...]:
    principals = {work.customer}
    needs = getattr(work, "resource_requirements", ())
    ledger = getattr(state, "capacity_ledger", None)
    if ledger is not None and needs:
        principals.update(ledger.original_owners(needs))
    else:
        owner = getattr(state, "resources", {}).get(getattr(work, "resource", None))
        if owner:
            principals.add(owner)
    return tuple(sorted(principals))


def _next_research_step(state: Any, configuration: str, work: Any,
                        principals: tuple[str, ...], missing_consents: list[str],
                        unavailable: list[str], applicability: str) -> str:
    """Recommend a research step from original states; never apply the step.

    The hierarchy protects standing obligations first. It does NOT infer
    permissions, owner signatures or a counterparty's economic preference.
    """
    result = getattr(work, "result", "NOT_SUBMITTED")
    obligation = getattr(work, "obligation", "NOT_ACCEPTED")
    if obligation == "FULFILLED" or result == "ACCEPTED_BY_ORIGINAL_RECIPIENT":
        return "PRESERVE_ORIGINAL_ACCEPTED_RESULT"
    if obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS":
        if result == "REJECTED":
            return "REQUIRE_ORIGINAL_PROVIDER_CORRECTION"
        if result == "SUBMITTED":
            return "AWAIT_ORIGINAL_RECIPIENT_RESULT_DECISION"
        return "CONTINUE_ORIGINAL_ACCEPTED_WORK"
    if unavailable:
        return "HOLD_NEW_WORK_UNAVAILABLE_ORIGINAL_PRINCIPAL"
    if applicability in {"INTERFIRM_ORIGINALS_OUTSIDE_INTRA_SCOPE",
                         "INTRA_STAFF_AND_DIVISIONS_NOT_MODELLED",
                         "SECTOR_STANDARD_AND_ORIGINAL_ROLES_NOT_QUALIFIED",
                         "PUBLIC_INSTITUTION_ORIGINAL_ROLES_NOT_QUALIFIED",
                         "PERSON_CONTEXT_RIGHTS_NOT_QUALIFIED",
                         "NO_INTERFIRM_ORIGINAL_WORK"}:
        return "RECONSIDER_AUTHOR_CONFIGURATION_AND_ORIGINAL_ROLES"
    if configuration == "operator" and getattr(state.institution, "mode", "UNSELECTED") == "UNSELECTED":
        return "QUALIFY_ORIGINAL_OPERATOR_GOVERNANCE"
    if not getattr(work, "admitted", False):
        return "PREPARE_ORIGINAL_AUTHORIZATION_REVIEW"
    if missing_consents:
        return "REQUEST_INDEPENDENT_ORIGINAL_PRINCIPAL_CONSULTATION"
    return "PREPARE_ORIGINAL_COMMIT_REVIEW_NO_AUTOMATIC_CONTRACT"


def _original_work_projection(state: Any, configuration: str) -> list[dict[str, Any]]:
    result = []
    for key, work in sorted(state.works.items()):
        principals = _original_principals(state, work)
        multi_owner = len(principals) > 1
        outside_original = [subject for subject in principals if subject not in state.subjects]
        active = [subject for subject in principals
                  if subject in state.subjects and state.subjects[subject].active]
        unavailable = sorted(set(principals) - set(active))
        obligations_accepted = getattr(work, "obligation", "NOT_ACCEPTED") in {"ACCEPTED_BY_ORIGINAL_PRINCIPALS", "FULFILLED"}
        existing_consent = sorted(getattr(work, "consents", {}))
        # The original affiliation at COMMIT is immutable. A later role
        # transfer changes future eligibility, never the classification of
        # an already accepted Work or the parent that originally consented.
        historical_affiliation = dict(
            getattr(work, "affiliation_at_commit", {})
        )
        if configuration == "intra":
            customer = state.subjects.get(work.customer)
            owner_parties = [state.subjects.get(k) for k in principals
                             if k != work.customer]
            internal = bool(
                customer is not None and customer.kind == "DIVISION"
                and owner_parties
                and all(
                    p is not None and p.kind == "EMPLOYEE"
                    and (
                        historical_affiliation.get(p.key, p.organization)
                        == historical_affiliation.get(
                            customer.key, customer.organization
                        )
                    )
                    for p in owner_parties
                )
            )
            applicability = (
                "ORIGINAL_INTRA_DIVISION_EMPLOYEE_WORK" if internal
                else "INTERFIRM_ORIGINALS_OUTSIDE_INTRA_SCOPE" if multi_owner
                else "INTRA_STAFF_AND_DIVISIONS_NOT_MODELLED"
            )
        elif configuration in {"inter", "operator"}:
            applicability = ("ORIGINAL_MULTI_PRINCIPAL_REVIEW_ONLY" if multi_owner
                             else "NO_INTERFIRM_ORIGINAL_WORK")
        elif configuration == "sector":
            owners = [state.subjects.get(p) for p in principals
                      if p != work.customer]
            customer = state.subjects.get(work.customer)
            applicability = (
                "ORIGINAL_SECTOR_BODY_SME_WORK"
                if customer is not None and customer.kind == "SME"
                and owners and all(p is not None and p.kind == "SECTOR_BODY"
                                   for p in owners)
                else "SECTOR_STANDARD_AND_ORIGINAL_ROLES_NOT_QUALIFIED"
            )
        elif configuration == "macro":
            customer = state.subjects.get(work.customer)
            owners = [state.subjects.get(p) for p in principals
                      if p != work.customer]
            applicability = (
                "ORIGINAL_PUBLIC_INSTITUTION_SME_WORK"
                if customer is not None and customer.kind == "PUBLIC_INSTITUTION"
                and owners and all(p is not None and p.kind == "SME"
                                   for p in owners)
                else "PUBLIC_INSTITUTION_ORIGINAL_ROLES_NOT_QUALIFIED"
            )
        else:
            customer = state.subjects.get(work.customer)
            owners = [state.subjects.get(p) for p in principals
                      if p != work.customer]
            applicability = (
                "ORIGINAL_NATURAL_PERSON_CONTEXT_SME_WORK"
                if customer is not None and customer.kind == "NATURAL_PERSON"
                and owners and all(p is not None and p.kind == "SME"
                                   for p in owners)
                else "PERSON_CONTEXT_RIGHTS_NOT_QUALIFIED"
            )
        pending_consents = (sorted(set(principals) - set(existing_consent))
                            if multi_owner and not obligations_accepted else [])
        next_step = _next_research_step(
            state, configuration, work, principals, pending_consents,
            unavailable, applicability)
        result.append({
            "work": key,
            "research_next_step": next_step,
            "research_step_changes_original_work": False,
            "original_principals": list(principals),
            "original_customer": work.customer,
            "original_affiliation_at_commit": dict(
                sorted(historical_affiliation.items())
            ),
            "active_original_principals": active,
            "missing_original_principals": outside_original,
            "original_consenters": existing_consent,
            "original_obligation": getattr(work, "obligation", "NOT_ACCEPTED"),
            "original_result": getattr(work, "result", "NOT_SUBMITTED"),
            "previous_obligation_preserved": True,
            "configuration_applicability": applicability,
            "legal_or_autonomous_action_authorized": False,
            "independent_consultation_required_for_new_work": multi_owner and not obligations_accepted,
            "unresolved_original_consultation": pending_consents,
        })
    return result



# R1-V1: a negative-only original Work commit gate. The author's form is
# not an operator-created subject type or a permission to sign for owners.
# The same original Work, principals, OC/KPB and independent consents govern.
# Forms needing employees, institutions, sector rules or persons fail closed
# until those actual subject classes are implemented in the original model.
ORIGINAL_FORM_MISSING_ACTOR_REASON: dict[str, str] = {}


def original_configuration_commit_gate(design: Any, state: Any,
                                       work: Any) -> str:
    """Can this actual original Work be committed under its selected form?

    Only inter-enterprise and operator-scoped original SME processes can be
    partially checked with the EXISTING actor types. This intentionally
    confers no new form, governance, institutional status or grant.
    """
    config = design.configuration
    if config == "sector":
        customer = state.subjects.get(work.customer)
        owners = set(_original_principals(state, work)) - {work.customer}
        if (customer is None or customer.kind != "SME" or not customer.active
                or not owners or any(
                    state.subjects[who].kind != "SECTOR_BODY"
                    or not state.subjects[who].active for who in owners
                )):
            return "FORMATION_AUTHOR_SECTOR_SME_STANDARD_BODY_REQUIRED"
        if (design.morphology["scale"] != "отраслевые"
                or design.morphology["knowledge"] != "отраслевой"):
            return "FORMATION_AUTHOR_SECTOR_SCOPE_STANDARD_REQUIRED"
        return "NONE"
    if config == "macro":
        customer = state.subjects.get(work.customer)
        owners = set(_original_principals(state, work)) - {work.customer}
        if (customer is None or customer.kind != "PUBLIC_INSTITUTION"
                or not customer.active or not owners or any(
                    state.subjects[who].kind != "SME"
                    or not state.subjects[who].active for who in owners
                )):
            return "FORMATION_AUTHOR_PUBLIC_INSTITUTION_SME_REQUIRED"
        if (design.morphology["scale"] not in {
                "региональные", "международные"}
                or design.morphology["data"] != "доверенные"):
            return "FORMATION_AUTHOR_PUBLIC_SCOPE_TRUSTED_CONTEXT_REQUIRED"
        return "NONE"
    if config == "trace":
        customer = state.subjects.get(work.customer)
        owners = set(_original_principals(state, work)) - {work.customer}
        if (customer is None or customer.kind != "NATURAL_PERSON"
                or not customer.active or not owners or any(
                    state.subjects[who].kind != "SME"
                    or not state.subjects[who].active for who in owners
                )):
            return "FORMATION_AUTHOR_PERSON_ORIGINAL_SME_PROCESS_REQUIRED"
        if design.morphology["data"] != "доверенные":
            return "FORMATION_AUTHOR_PERSON_TRUSTED_CONTEXT_REQUIRED"
        return "NONE"
    if config == "intra":
        if (design.morphology["scale"] != "Внутрифирменные"
                or design.morphology["governance"] not in {
                    "Централизованные", "смешанные",
                }):
            return "FORMATION_AUTHOR_INTRA_MORPHOLOGY_CONFLICT"
        customer = state.subjects.get(work.customer)
        if customer is None or customer.kind != "DIVISION":
            return "FORMATION_AUTHOR_INTRA_ORIGINAL_DIVISION_REQUIRED"
        enterprise = state.subjects.get(customer.organization)
        if enterprise is None or enterprise.kind != "SME" or not enterprise.active:
            return "FORMATION_AUTHOR_INTRA_PARENT_ENTERPRISE_INACTIVE"
        owners = state.capacity_ledger.original_owners(
            work.resource_requirements
        )
        if not owners or customer.key in owners:
            return "FORMATION_AUTHOR_INTRA_EMPLOYEE_RESOURCE_REQUIRED"
        for owner in owners:
            participant = state.subjects.get(owner)
            if (participant is None or participant.kind != "EMPLOYEE"
                    or participant.organization != customer.organization
                    or not participant.active):
                return "FORMATION_AUTHOR_INTRA_INDEPENDENT_EMPLOYEE_REQUIRED"
        for member in (customer, *(state.subjects[p] for p in sorted(owners))):
            if (not member.active or not member.affiliation_source_ref
                    or not member.affiliation_source_ref.startswith(
                        f"model://{customer.organization}/"
                    )
                    or not member.self_role_source_ref
                    or not member.self_role_source_ref.startswith(
                        f"model://{member.key}/"
                    )):
                return "FORMATION_AUTHOR_INTRA_ORIGINAL_ROLE_SOURCE_REQUIRED"
        # SOURCE_ONLY affiliation does not give employer power to sign
        # employee Work, or employee rights to own company assets.
        return "NONE"
    if config not in {"inter", "operator"}:
        return "FORMATION_AUTHOR_CONFIGURATION_NOT_QUALIFIED"
    parties = _original_principals(state, work)
    if (len(parties) < 2 or any(
            name not in state.subjects
            or state.subjects[name].kind != "SME"
            or not state.subjects[name].active
            for name in parties)):
        return "FORMATION_AUTHOR_INTERFIRM_INDEPENDENT_SMES_REQUIRED"
    if design.morphology["scale"] != "межфирменные":
        return "FORMATION_AUTHOR_INTERFIRM_SCALE_SOURCE_MISMATCH"
    if config == "inter":
        if design.morphology["governance"] == "операторские":
            return "FORMATION_AUTHOR_INTERFIRM_OPERATOR_MORPHOLOGY_CONFLICT"
    else:
        if design.morphology["governance"] != "операторские":
            return "FORMATION_AUTHOR_OPERATOR_GOVERNANCE_SOURCE_REQUIRED"
        operator = state.institution.operator
        if (operator not in state.subjects
                or state.subjects[operator].kind != "OPERATOR"
                or not state.subjects[operator].active
                or state.institution.mode not in {"SOLE", "MIXED", "COLLEGIAL"}):
            return "FORMATION_AUTHOR_ORIGINAL_OPERATOR_AUTHORITY_NOT_PRESENT"
    # The existing authorize, consent and commit steps remain mandatory.
    # A declared form is never equivalent to the original owners' agreement.
    return "NONE"


def _axis_consequences(design: Any, state: Any, current: Mapping[str, list[Mapping[str, Any]]],
                       works: list[dict[str, Any]], economic_status: str) -> dict[str, dict[str, Any]]:
    x = design.morphology
    multi_owner = any(len(w["original_principals"]) > 1 for w in works)
    has_operations = any(bool(getattr(w, "operations", ())) for w in state.works.values())
    active_cores = {row["core"] for row in current["context_cores"]}
    agent_claims = current["agent_functions"]
    result: dict[str, dict[str, Any]] = {}

    scale = x["scale"]
    if scale == "Внутрифирменные":
        def enterprise_root(name: str) -> str:
            party = state.subjects.get(name)
            return getattr(party, "organization", None) or name

        conflicting_enterprises = any(
            len({enterprise_root(name)
                 for name in row["original_principals"]}) > 1
            for row in works
        )
        is_role_scoped_intra = any(
            row["configuration_applicability"] ==
            "ORIGINAL_INTRA_DIVISION_EMPLOYEE_WORK" for row in works
        )
        scale_check = (
            "INTERFIRM_OWNER_SCOPE_CONFLICT" if conflicting_enterprises
            else "ORIGINAL_INTRA_ROLES_IN_ONE_ENTERPRISE"
            if is_role_scoped_intra else "INTERNAL_ROLES_UNMODELLED"
        )
    elif scale == "межфирменные":
        scale_check = "MULTI_OWNER_WORK_DECLARED" if multi_owner else "MULTI_OWNER_WORK_MISSING"
    else:
        matched_author_form = any(
            row["configuration_applicability"] in {
                "ORIGINAL_SECTOR_BODY_SME_WORK",
                "ORIGINAL_PUBLIC_INSTITUTION_SME_WORK",
                "ORIGINAL_NATURAL_PERSON_CONTEXT_SME_WORK",
            }
            for row in works
        )
        scale_check = (
            "ORIGINAL_EXTENDED_FORM_SCOPE_MODELLED_PARTIAL"
            if matched_author_form else "GEOGRAPHIC_OR_SECTOR_SCOPE_NOT_QUALIFIED"
        )
    result["scale"] = {"selected": scale, "observed": scale_check,
                       "operational_consequence": "NO_AUTOMATIC_EXPANSION_OF_ORIGINAL_SUBJECTS"}

    governance = x["governance"]
    gov_selected = getattr(state.institution, "mode", "UNSELECTED")
    if governance == "операторские":
        governance_check = ("EXPLICIT_OPERATOR_GOVERNANCE_PARTIAL" if
                            gov_selected in {"SOLE", "COLLEGIAL", "MIXED"} else
                            "ORGANIZATIONAL_MODE_NOT_SELECTED")
    elif governance in {"федеративные", "децентрализованные"}:
        governance_check = "INDEPENDENT_DISTRIBUTED_GOVERNANCE_NOT_ENFORCED"
    else:
        governance_check = "MORPHOLOGY_NOT_IDENTICAL_TO_SOLE_COLLEGIAL_MIXED"
    result["governance"] = {"selected": governance, "observed": governance_check,
                             "original_institution_mode": gov_selected,
                             "operational_consequence": "KEEP_ORIGINAL_MANDATES_AND_COUNCIL_RULES"}

    autonomy = x["autonomy"]
    declared_levels = sorted({row["autonomy"] for row in agent_claims})
    result["autonomy"] = {"selected": autonomy,
                           "declared_function_levels": declared_levels,
                           "observed": ("SELECTED_LEVEL_HAS_DECLARED_FUNCTION"
                                        if autonomy in declared_levels else
                                        "NO_CURRENT_FUNCTION_AT_SELECTED_LEVEL"),
                           "operational_consequence": "NO_PROGRAM_RUNTIME_OR_DELEGATED_EXECUTION"}

    process = x["process"]
    result["process"] = {"selected": process,
                         "observed": ("ORIGINAL_TECHNOLOGY_PRESENT" if has_operations else
                                      "ORIGINAL_OPERATION_GRAPH_UNSPECIFIED"),
                         "operational_consequence": (
                             "INTERFIRM_REPLAN_REQUIRES_ORIGINAL_NEW_WORK_AND_CONSENT"
                             if process in {"межфирменные", "пересобираемые", "проектные"} else
                             "NO_AUTOMATIC_CHANGE_TO_ORIGINAL_PROCESS")}

    knowledge = x["knowledge"]
    result["knowledge"] = {"selected": knowledge,
                           "observed": "ORIGINAL_CONTEXT_BASIS_PRESENT" if state.context_basis is not None
                           else "ORIGINAL_CONTEXT_BASIS_MISSING",
                           "operational_consequence": "ORIGINAL_CONTEXT_GATES_UNALTERED"}

    data = x["data"]
    result["data"] = {"selected": data, "current_core_claims": sorted(active_cores),
                      "observed": "MODEL_CORE_CLAIMS_NOT_AUTHENTICATED" if active_cores
                      else "CONTEXT_CORE_SOURCE_MISSING",
                      "operational_consequence": "NO_PERMISSION_TO_USE_OTHERS_CONTEXT"}

    result["platform"] = {"selected": x["platform"],
                           "observed": "INDEPENDENCE_AND_PORTABILITY_NOT_OBSERVED",
                           "operational_consequence": "NO_PLATFORM_SPECIFIC_RIGHTS_INFERRED"}

    result["economics"] = {"selected": x["economics"],
                            "observed": economic_status,
                            "required_questions": list(ECONOMIC_QUESTIONS[design.configuration]),
                            "operational_consequence": "NO_FICTITIOUS_ECONOMIC_ADVANTAGE_OR_TRANSFERS"}

    result["human"] = {"selected": x["human"],
                        "observed": "ORIGINAL_MANUAL_CONSENTS_AND_RESULT_ACCEPTANCE_ONLY",
                        "operational_consequence": "CANNOT_SILENTLY_REMOVE_HUMAN_REVIEW"}
    return result


def configuration_dynamics(design: Any, state: Any, *, at: float,
                           current: Mapping[str, list[Mapping[str, Any]]],
                           economic_status: str) -> dict[str, Any]:
    """Observe an author's chosen institutional form at one original model time.

    The output changes with Work / original decisions / source validity, but
    neither it nor a morphology label authorize a new event, contract or agent.
    """
    work_rows = _original_work_projection(state, design.configuration)
    all_principals = sorted({p for row in work_rows for p in row["original_principals"]})
    kinds = {key: state.subjects[key].kind for key in all_principals if key in state.subjects}
    cross_owner_work = sum(len(row["original_principals"]) >= 2 for row in work_rows)
    modeled_intra_roles = any(
        row["configuration_applicability"] ==
        "ORIGINAL_INTRA_DIVISION_EMPLOYEE_WORK"
        for row in work_rows
    )
    qualified_extended = any(
        row["configuration_applicability"] == {
            "sector": "ORIGINAL_SECTOR_BODY_SME_WORK",
            "macro": "ORIGINAL_PUBLIC_INSTITUTION_SME_WORK",
            "trace": "ORIGINAL_NATURAL_PERSON_CONTEXT_SME_WORK",
        }.get(design.configuration)
        for row in work_rows
    )
    unsupported_roles = {
        "intra": (() if modeled_intra_roles else ("DIVISION", "EMPLOYEE")),
        "inter": (), "operator": (),
        "sector": (() if qualified_extended else ("SECTOR_BODY", "SECTOR_STANDARD")),
        "macro": (() if qualified_extended else ("PUBLIC_INSTITUTION", "PUBLIC_MANDATE")),
        "trace": (() if qualified_extended else ("NATURAL_PERSON", "PERSONAL_CONTEXT_RIGHT")),
    }[design.configuration]
    if design.configuration == "inter":
        status = "MULTI_FIRM_PREPARATORY_SCOPE_ONLY" if cross_owner_work else "INTERFIRM_PROCESS_NOT_DECLARED"
    elif design.configuration == "operator":
        has_operator = getattr(state.institution, "operator", None) in state.subjects
        mode = getattr(state.institution, "mode", "UNSELECTED")
        status = ("ORIGINAL_OPERATOR_COORDINATION_PARTIAL" if
                  has_operator and cross_owner_work and
                  mode in {"SOLE", "COLLEGIAL", "MIXED"} else
                  "OPERATOR_GOVERNANCE_UNSELECTED" if
                  has_operator and cross_owner_work else
                  "OPERATOR_AND_INTERFIRM_SCOPE_UNQUALIFIED")
    elif design.configuration == "intra":
        status = (
            "ORIGINAL_INTRA_DIVISION_EMPLOYEE_WORK_PARTIAL"
            if any(
                w["configuration_applicability"] ==
                "ORIGINAL_INTRA_DIVISION_EMPLOYEE_WORK" for w in work_rows
            )
            else "INTRA_DIVISION_AND_EMPLOYEE_ROLES_NOT_EXECUTABLE"
        )
    elif design.configuration in {"sector", "macro", "trace"}:
        status = (
            {
                "sector": "ORIGINAL_SECTOR_SME_STANDARDS_WORK_PARTIAL",
                "macro": "ORIGINAL_PUBLIC_INSTITUTION_SME_WORK_PARTIAL",
                "trace": "ORIGINAL_PERSON_CONTEXT_SME_WORK_PARTIAL",
            }[design.configuration]
            if qualified_extended
            else "AUTHOR_EXTENDED_CONFIGURATION_ROLES_NOT_EXECUTABLE"
        )
    else:
        status = "AUTHOR_EXTENDED_CONFIGURATION_ROLES_NOT_EXECUTABLE"
    return {
        "configuration": design.configuration,
        "at": at,
        "original_principal_kinds": kinds,
        "cross_owner_original_work_count": cross_owner_work,
        "status": status,
        "required_but_unmodelled_roles": list(unsupported_roles),
        "original_work_scope": work_rows,
        "morphological_consequences": _axis_consequences(
            design, state, current, work_rows, economic_status),
        "source_dependent_current_economic_questions": list(ECONOMIC_QUESTIONS[design.configuration]),
        "verified_comparative_effect": False,
        "membership_reconfiguration_created": False,
        "original_principal_consent_preserved": True,
        "program_agent_execution_created": False,
    }