"""Cross-component cooperation relations in the ORIGINAL qualitative AKIS state.

A link groups existing independently consented works for scientific observation.
It never commits an obligation, grants an operator asset rights, aggregates
unrelated Results, or proves an economic effect. No new scheduler or store.
"""
from __future__ import annotations
from dataclasses import dataclass, replace
from typing import Any, Mapping, Sequence


class CooperationInputError(ValueError):
    """Ambiguous ownership or source of a proposed cooperation relation."""


@dataclass(frozen=True)
class CooperationLink:
    key: str
    purpose: str
    coordinator: str
    participants: tuple[str, ...]
    works: tuple[str, ...]
    mechanisms: tuple[str, ...]
    source_ref: str
    source_revision: str


def _id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise CooperationInputError(f"INVALID_COOPERATION_{field}")
    return value


def _names(raw: Any, field: str, *, minimum: int = 1, maximum: int = 256) -> tuple[str, ...]:
    if not isinstance(raw, list) or not minimum <= len(raw) <= maximum:
        raise CooperationInputError(f"INVALID_COOPERATION_{field}")
    names = tuple(_id(x, field) for x in raw)
    if len(set(names)) != len(names):
        raise CooperationInputError(f"DUPLICATE_COOPERATION_{field}")
    return names


def parse_cooperation_links(raw: Any, subjects: Mapping[str, Any],
                            works: Mapping[str, Any], resource_owners: Mapping[str, str],
                            operator: str) -> tuple[CooperationLink, ...]:
    """Source-declared relationship, not a super-contract or new author taxonomy.

    Mechanisms are open source-declared names. In particular joint purchasing,
    sourcing from partners, shared marketing and logistics are not all AKIS forms.
    """
    if raw is None:
        return ()
    if not isinstance(raw, list) or len(raw) > 256:
        raise CooperationInputError("INVALID_COOPERATION_LINK_COUNT")
    result: list[CooperationLink] = []
    seen: set[str] = set()
    fields = {"id", "purpose", "coordinator", "participants", "works",
              "mechanisms", "source_ref", "source_revision"}
    for row in raw:
        if not isinstance(row, dict) or set(row) != fields:
            raise CooperationInputError("INVALID_COOPERATION_LINK_FIELDS")
        key = _id(row["id"], "ID")
        if key in seen:
            raise CooperationInputError("DUPLICATE_COOPERATION_LINK")
        seen.add(key)
        purpose = _id(row["purpose"], "PURPOSE")
        coordinator = _id(row["coordinator"], "COORDINATOR")
        parties = _names(row["participants"], "PARTICIPANTS", minimum=2, maximum=128)
        work_ids = _names(row["works"], "WORKS")
        mechanisms = _names(row["mechanisms"], "MECHANISMS", maximum=128)
        if coordinator not in parties or not set(parties).issubset(subjects):
            raise CooperationInputError("COOPERATION_UNKNOWN_PARTICIPANT")
        if any(k not in works for k in work_ids):
            raise CooperationInputError("COOPERATION_UNKNOWN_WORK")
        # All original signatories are included, but this declaration itself
        # is NOT a vote, signed agreement, or permission to their assets.
        originals: set[str] = set()
        for w in work_ids:
            work = works[w]
            originals.add(work.customer)
            originals.update(resource_owners[n.resource] for n in work.resource_requirements)
        if not originals.issubset(parties) or not set(parties).issubset(originals | {operator}):
            raise CooperationInputError("COOPERATION_ORIGINAL_PARTICIPANTS_REQUIRED")
        ref = row["source_ref"]
        if (not isinstance(ref, str) or not ref.startswith("model://") or
                len(ref) <= 8 or len(ref) > 180):
            raise CooperationInputError("COOPERATION_MODEL_SOURCE_REQUIRED")
        rev = _id(row["source_revision"], "SOURCE_REVISION")
        result.append(CooperationLink(key, purpose, coordinator, parties,
                                      work_ids, mechanisms, ref, rev))
    return tuple(sorted(result, key=lambda x: x.key))


def cooperation_view(links: Sequence[CooperationLink], works: Mapping[str, Any],
                     resource_owners: Mapping[str, str], trace: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Dynamic view of the one original event trace; never a second Result."""
    out: list[dict[str, Any]] = []
    for link in links:
        originals: dict[str, list[str]] = {}
        missing: dict[str, list[str]] = {}
        for wid in link.works:
            w = works[wid]
            required = {w.customer} | {resource_owners[n.resource] for n in w.resource_requirements}
            originals[wid] = sorted(required)
            missing[wid] = sorted(required - set(w.consents)) if w.obligation == "NOT_ACCEPTED" else []
        states = [works[wid].result for wid in link.works]
        obligations = [works[wid].obligation for wid in link.works]
        if any(s == "REJECTED" for s in states):
            condition = "ORIGINAL_RESULT_CORRECTION_PENDING"
        elif any(s == "NOT_ACCEPTED" for s in obligations):
            condition = "FORMATION_NOT_FULLY_COMMITTED"
        elif all(s == "ACCEPTED_BY_ORIGINAL_RECIPIENT" for s in states):
            condition = "LINKED_MODEL_RESULTS_ACCEPTED"
        else:
            condition = "ORIGINAL_COMMITMENTS_ACTIVE"
        related = [e for e in trace if e.get("work") in link.works and e.get("outcome") == "BLOCKED"]
        out.append({
            "id": link.key, "purpose": link.purpose, "coordinator": link.coordinator,
            "original_participants": list(link.participants), "works": list(link.works),
            "declared_cooperation_mechanisms": list(link.mechanisms),
            "source_ref": link.source_ref, "source_revision": link.source_revision,
            "relation_state": condition, "original_signatories_by_work": originals,
            "missing_original_consents_by_work": missing,
            "work_results": {k: works[k].result for k in link.works},
            "blocked_event_reasons": sorted({e["reason"] for e in related}),
            "effects_by_mechanism": {name: "NOT_IDENTIFIABLE_WITHOUT_INDEPENDENT_ALTERNATIVE"
                                     for name in link.mechanisms},
            "legal_rights": "RETAINED_BY_ORIGINAL_PRINCIPALS",
            "result_role": "LINKED_ORIGINAL_RESULTS_NO_CONSOLIDATED_SECOND_RESULT",
        })
    return {"evidence": "MODEL_ONLY", "links": out,
            "organizational_form": "UNALTERED_OPERATOR_AKIS",
            "economic_additionality": "NOT_AUTOMATIC",
            "event_owner": "EXISTING_QUALITATIVE_AKIS_TRACE"}




AUTHOR_FORMATION_PHASES = (
    (1, "\u0426\u0435\u043b\u0435\u0432\u0430\u044f \u043f\u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430", "GOAL_MODEL"),
    (2, "\u0412\u044b\u0431\u043e\u0440 \u043f\u0440\u043e\u0446\u0435\u0441\u0441\u043e\u0432", "PROCESS_MAP"),
    (3, "\u0414\u0438\u0430\u0433\u043d\u043e\u0441\u0442\u0438\u043a\u0430 \u0433\u043e\u0442\u043e\u0432\u043d\u043e\u0441\u0442\u0438", "PROCESS_ADMISSION_MAP"),
    (4, "\u041a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u043d\u043e-\u043f\u0440\u043e\u0446\u0435\u0441\u0441\u043d\u0430\u044f \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430", "CONTEXT_PROCESS_BASIS"),
    (5, "\u041f\u0440\u043e\u0435\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u043e\u043d\u043d\u043e\u0433\u043e \u043a\u043e\u0434\u0430", "ORGANIZATIONAL_CODE_MATRIX"),
    (6, "\u041f\u0440\u043e\u0435\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0430\u0433\u0435\u043d\u0442\u043d\u044b\u0445 \u0444\u0443\u043d\u043a\u0446\u0438\u0439", "AGENT_FUNCTION_REGISTER"),
    (7, "\u041e\u043f\u044b\u0442\u043d\u044b\u0439 \u0437\u0430\u043f\u0443\u0441\u043a", "OPERATION_CHANGE_JOURNAL"),
    (8, "\u041e\u0446\u0435\u043d\u043a\u0430 \u0438 \u0440\u0430\u0437\u0432\u0438\u0442\u0438\u0435", "RISK_ADJUSTED_EFFECT_AND_PLAN"),
)


def latest_future_participation(trace: Sequence[Mapping[str, Any]],
                                link_id: str, original_party: str,
                                link_revision: str, org_revision: str) -> str:
    """Read only this principal's latest APPLIED model declaration.

    A pause is not legal exit, exclusion, resource seizure, or abandonment of
    prior obligations. Older revisions and BLOCKED messages never override.
    """
    for event in reversed(trace):
        if (event.get("action") != "participation_status" or
                event.get("outcome") != "APPLIED" or
                event.get("actor") != original_party or
                event.get("participation_link") != link_id):
            continue
        # A founder's code revision does NOT revoke an independent party's
        # previously declared pause. Only that party's new applied declaration
        # under the current relation source can resume future availability.
        if event.get("participation_relation_revision") == link_revision:
            return event["participation_value"]
    return "OPEN_TO_NEW_WORK"


def original_parties_for_work(work: Any, resource_owners: Mapping[str, str]) -> set[str]:
    return {work.customer} | {resource_owners[n.resource] for n in work.resource_requirements}


def formation_phase_evidence(*, link: CooperationLink, works: Sequence[Any],
                             modeled_events: Sequence[Mapping[str, Any]],
                             source_rules: set[tuple[str, str]],
                             declared_economic_channels: int) -> list[dict[str, Any]]:
    """Doctoral table 4.3 evidence inventory, NOT a lifecycle state machine.

    A model-only observation cannot qualify the actual deliverable. No phase
    automatically authorizes a later phase, an operator action or a Result.
    """
    any_events = any(row.get("outcome") == "APPLIED" for row in modeled_events)
    evidence = {
        1: "SOURCE_DECLARED_PURPOSE_NOT_VERIFIED",
        2: "MODEL_WORK_CONNECTIONS_NOT_VERIFIED",
        3: "RESOURCE_FEASIBILITY_PARTIAL_NOT_FIELD_QUALIFIED",
        4: "MODEL_ONLY_CONTEXT_RULES_PRESENT" if source_rules else "QUALIFIED_CONTEXT_BASIS_NOT_OBSERVED",
        5: "PARTIAL_OPERATOR_PROCEDURE_NOT_THIRTEEN_FIELDS",
        6: "AGENT_DELEGATION_NOT_QUALIFIED",
        7: "MODEL_EVENTS_NOT_FIELD_LAUNCH" if any_events else "FIELD_LAUNCH_NOT_OBSERVED",
        8: "DECLARED_ECONOMIC_CLAIMS_NOT_CAUSAL_EFFECT" if declared_economic_channels
           else "RISK_ADJUSTED_EFFECT_AND_PLAN_NOT_OBSERVED",
    }
    result = []
    for number, title, deliverable in AUTHOR_FORMATION_PHASES:
        result.append({"phase": number, "author_phase": title,
                       "expected_deliverable": deliverable,
                       "observed_basis": evidence[number],
                       "original_deliverable_qualified": False,
                       "evidence": "MODEL_ONLY",
                       "does_not_authorize_next_phase": True})
    return result


# These are research questions about a change to cooperative relations, NOT a
# new legal or organizational-code taxonomy or executable institutional engine.
COOPERATION_CHANGE_SUBJECT_SCOPES = frozenset({
    "ADD_FUTURE_PARTICIPANT", "REVIEW_FUTURE_PARTICIPATION", "REVISE_SHARED_FUNCTION",
    "REVISE_RESOURCE_COOPERATION", "REVISE_SOURCE_ACCESS", "REVISE_COST_SHARING",
})


def _model_reference(value: Any, reason: str) -> str:
    if (not isinstance(value, str) or not value.startswith("model://") or
            len(value) <= len("model://") or len(value) > 180):
        raise CooperationInputError(reason)
    return value


def _declared_link(links: Sequence[CooperationLink], identifier: Any) -> CooperationLink:
    if not isinstance(identifier, str):
        raise CooperationInputError("COOPERATION_CHANGE_LINK_UNKNOWN")
    link = next((item for item in links if item.key == identifier), None)
    if link is None:
        raise CooperationInputError("COOPERATION_CHANGE_LINK_UNKNOWN")
    return link


def _required_consultees(proposal: Mapping[str, Any], link: CooperationLink) -> set[str]:
    # A completed consultation belongs to the ORIGINAL subjects of the
    # proposal. Recomputing it from a later relation membership would rewrite
    # who had to consent historically. Older traces without an original
    # snapshot remain provisional, not a proof of completed consultation.
    original = proposal.get("original_consultees")
    if original is not None:
        if (not isinstance(original, (list, tuple)) or not original or
                any(not isinstance(x, str) or not x for x in original) or
                len(set(original)) != len(original)):
            raise CooperationInputError("COOPERATION_CHANGE_ORIGINAL_CONSULTEES_INVALID")
        return set(original)
    required = set(link.participants)
    if proposal["change_kind"] == "ADD_FUTURE_PARTICIPANT":
        required.add(proposal.get("proposed_subject"))
    return required


def original_cooperation_consultees(proposal: Mapping[str, Any],
                                   links: Sequence[CooperationLink]) -> tuple[str, ...]:
    """Freeze the originally necessary respondents in the SAME trace event.

    This list has no independent legal effect. Later changes to relationship
    membership can never overwrite the historical circle of consultation.
    """
    link = _declared_link(links, proposal.get("cooperation_link"))
    return tuple(sorted(_required_consultees(proposal, link)))


def propose_cooperation_change(event: Mapping[str, Any],
                               links: Sequence[CooperationLink],
                               subjects: Mapping[str, Any],
                               trace: Sequence[Mapping[str, Any]]) -> None:
    """Only an original participant may open a MODEL_ONLY consultation.

    The event is still recorded in the ORIGINAL trace; this cannot change
    future access, property, a contract, organizational code or any Result.
    """
    link = _declared_link(links, event.get("cooperation_link"))
    actor = event.get("actor")
    if actor not in link.participants or not subjects[actor].active:
        raise CooperationInputError("COOPERATION_CHANGE_ORIGINAL_PROPOSER_REQUIRED")
    if event.get("cooperation_source_revision") != link.source_revision:
        raise CooperationInputError("COOPERATION_CHANGE_SOURCE_REVISION_STALE")
    change = _id(event.get("change_id"), "CHANGE_ID")
    if any(row.get("change_id") == change and
           row.get("action") == "cooperation_change_propose" and
           row.get("outcome") == "APPLIED" for row in trace):
        raise CooperationInputError("COOPERATION_CHANGE_ID_ALREADY_USED")
    kind = event.get("change_kind")
    if not isinstance(kind, str) or kind not in COOPERATION_CHANGE_SUBJECT_SCOPES:
        raise CooperationInputError("COOPERATION_CHANGE_SCOPE_INVALID")
    channel = event.get("economic_channel")
    if not isinstance(channel, str) or channel not in link.mechanisms:
        raise CooperationInputError("COOPERATION_CHANGE_CHANNEL_NOT_DECLARED")
    _model_reference(event.get("change_source_ref"), "COOPERATION_CHANGE_MODEL_SOURCE_REQUIRED")
    candidate = event.get("proposed_subject")
    if kind == "ADD_FUTURE_PARTICIPANT":
        if (not isinstance(candidate, str) or candidate not in subjects or
                candidate in link.participants or not subjects[candidate].active or
                subjects[candidate].kind != "SME"):
            raise CooperationInputError("COOPERATION_CHANGE_NEW_PARTY_NOT_QUALIFIED")
    elif kind == "REVIEW_FUTURE_PARTICIPATION":
        if (not isinstance(candidate, str) or candidate not in link.participants or
                candidate == link.coordinator):
            raise CooperationInputError("COOPERATION_CHANGE_SUBJECT_NOT_ORIGINAL")
    elif candidate is not None:
        raise CooperationInputError("COOPERATION_CHANGE_SUBJECT_NOT_APPLICABLE")


def _applied_proposal(trace: Sequence[Mapping[str, Any]],
                      change: str) -> Mapping[str, Any] | None:
    for row in trace:
        if (row.get("action") == "cooperation_change_propose" and
                row.get("outcome") == "APPLIED" and row.get("change_id") == change):
            return row
    return None


def respond_to_cooperation_change(event: Mapping[str, Any],
                                  links: Sequence[CooperationLink],
                                  subjects: Mapping[str, Any],
                                  trace: Sequence[Mapping[str, Any]]) -> None:
    """Source-declared consultation, NOT contractual acceptance or a vote by OK."""
    change = _id(event.get("change_id"), "CHANGE_ID")
    proposal = _applied_proposal(trace, change)
    if proposal is None:
        raise CooperationInputError("COOPERATION_CHANGE_PROPOSAL_NOT_FOUND")
    link = _declared_link(links, event.get("cooperation_link"))
    if (proposal.get("cooperation_link") != link.key or
            proposal.get("cooperation_source_revision") != link.source_revision or
            event.get("cooperation_source_revision") != link.source_revision):
        raise CooperationInputError("COOPERATION_CHANGE_SOURCE_REVISION_STALE")
    if (event.get("org_revision") != proposal.get("org_revision")):
        raise CooperationInputError("COOPERATION_CHANGE_PROPOSAL_REVISION_STALE")
    if event.get("actor") not in _required_consultees(proposal, link):
        raise CooperationInputError("COOPERATION_CHANGE_ORIGINAL_CONSULTEE_REQUIRED")
    if event.get("change_decision") not in ("SUPPORT_MODEL_PROPOSAL", "OBJECT_MODEL_PROPOSAL"):
        raise CooperationInputError("COOPERATION_CHANGE_RESPONSE_INVALID")
    _model_reference(event.get("change_source_ref"), "COOPERATION_CHANGE_MODEL_SOURCE_REQUIRED")
    if (not isinstance(event.get("at"), int) or isinstance(event["at"], bool) or
            not isinstance(proposal.get("at"), int) or
            event["at"] <= proposal["at"]):
        raise CooperationInputError("COOPERATION_CHANGE_RESPONSE_MUST_FOLLOW_PROPOSAL")
    # Consulted subjects are independent of operator mandate and quorum.
    # An inactive principal may still contest a proposed revision of its rights.


# Exact thirteen ORIGINAL organizational-code fields (doctoral formula 3.4).
# This inventory is evidence-oriented, not a new rule schema or authorization.
ORIGINAL_ORGANIZATIONAL_CODE_FIELDS = (
    "\u0421", "\u0418\u0414", "\u0420\u043e\u043b", "\u041f\u0440", "\u0417\u0430\u043f\u0440",
    "\u0418\u0441\u0442", "\u0421\u043e\u0431\u044b\u0442", "\u041f\u0440\u0430\u0432", "\u0410\u0432\u0442", "\u042d\u0441\u043a",
    "\u041e\u0442\u0432", "\u0416\u0443\u0440\u043d", "\u041f\u0435\u0440\u0435\u0441\u043c",
)

# MODEL_ONLY signals are not documents capable of granting legal authority.
_AUTHOR_CODE_OBSERVATION = (
    "ORIGINAL_ACTORS_DECLARED_NOT_IDENTIFIED",
    "IDENTITY_NOT_AUTHENTICATED",
    "MODEL_ROLES_DECLARED_NOT_VERIFIED",
    "SOURCE_SCOPED_PERMISSIONS_NOT_QUALIFIED",
    "PARTIAL_CRITICAL_PROHIBITION_GATES_ONLY",
    "MODEL_ONLY_SOURCES_NOT_ORIGINAL_DOCUMENTS",
    "ORIGINAL_TRACE_EVENT_DECLARED",
    "APPLICABLE_DECISION_RULE_INCOMPLETE",
    "AGENT_AUTONOMY_AND_REVERSIBILITY_NOT_QUALIFIED",
    "MODEL_OBJECTIONS_NOT_A_DISPUTE_PROCEDURE",
    "RESPONSIBILITY_AND_COMPENSATION_NOT_QUALIFIED",
    "ONE_MODEL_TRACE_NOT_AUTHENTICATED_EVIDENCE",
    "CONSULTATION_ONLY_NO_LAWFUL_AMENDMENT",
)


def organizational_code_readiness(review: Mapping[str, Any]) -> dict[str, Any]:
    """Original 13-field completeness of a specific cooperative revision.

    No field can be called legally qualified by a MODEL_ONLY event. An
    apparently unanimous consultation is evidence about a hypothesis only.
    """
    fields = [
        {"original_field": code, "observed_model_basis": observation,
         "qualified_original_evidence": False}
        for code, observation in zip(
            ORIGINAL_ORGANIZATIONAL_CODE_FIELDS, _AUTHOR_CODE_OBSERVATION,
            strict=True,
        )
    ]
    return {
        "change_id": review["change_id"],
        "original_fields": fields,
        "original_field_count": len(fields),
        "qualified_original_field_count": 0,
        "legal_authorization": "NOT_ESTABLISHED",
        "consultation_status": review["review_status"],
        "stale_source_or_code_requires_requalification":
            review["requires_fresh_original_qualification"],
        "economic_alternatives_and_transition_costs": "NOT_CAUSALLY_VERIFIED",
        "permissions_and_delegation": "NOT_INFERRED_FROM_COOPERATION_MEMBERSHIP",
        "legal_effect": "NONE",
    }


def cooperation_change_reviews(links: Sequence[CooperationLink],
                               trace: Sequence[Mapping[str, Any]], *,
                               current_org_revision: str | None = None,
                               subjects: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
    """Reconstruct proposals and latest responses from the ONE historical trace.

    No mutable proposal ledger. Suppress individual responses in the common
    diagnostic view until real role-specific KPB projection is implemented.
    """
    by_link = {link.key: link for link in links}
    proposals = [row for row in trace if row.get("action") == "cooperation_change_propose"
                 and row.get("outcome") == "APPLIED"]
    out: list[dict[str, Any]] = []
    for proposal in proposals:
        link = by_link.get(proposal.get("cooperation_link"))
        if link is None:
            continue
        required = _required_consultees(proposal, link)
        latest: dict[str, str] = {}
        for row in trace:
            if (row.get("action") == "cooperation_change_response" and
                    row.get("outcome") == "APPLIED" and
                    row.get("change_id") == proposal["change_id"] and
                    row.get("cooperation_link") == link.key and
                    row.get("cooperation_source_revision") == proposal.get("cooperation_source_revision") and
                    row.get("org_revision") == proposal.get("org_revision") and
                    row.get("at", -1) > proposal.get("at", -1) and
                    row.get("actor") in required):
                latest[row["actor"]] = row["change_decision"]
        count_support = sum(decision == "SUPPORT_MODEL_PROPOSAL" for decision in latest.values())
        objections = sum(decision == "OBJECT_MODEL_PROPOSAL" for decision in latest.values())
        if objections:
            status = "SOURCE_DECLARED_OBJECTION_REQUIRES_REVIEW"
        elif len(latest) < len(required):
            status = "INDEPENDENT_CONSULTATION_INCOMPLETE"
        else:
            status = "MODEL_CONSULTATION_COMPLETE_NOT_LEGAL_AUTHORIZATION"
        historical_status = status
        if ("original_relation_participants" in proposal and
                set(proposal["original_relation_participants"]) != set(link.participants)):
            status = "MODEL_REVIEW_RELATION_MEMBERSHIP_CHANGED_REVALIDATION_REQUIRED"
        elif proposal.get("cooperation_source_revision") != link.source_revision:
            status = "MODEL_REVIEW_STALE_COOPERATION_SOURCE_REVALIDATION_REQUIRED"
        elif (current_org_revision is not None and
              proposal.get("org_revision") != current_org_revision):
            status = "MODEL_REVIEW_STALE_ORGANIZATIONAL_CODE_REVALIDATION_REQUIRED"
        elif subjects is not None and any(
            name not in subjects or not subjects[name].active for name in required
        ):
            status = "MODEL_REVIEW_PARTICIPANT_AVAILABILITY_REVALIDATION_REQUIRED"
        out.append({
            "historical_review_status": historical_status,
            "original_consultees_provenance": (
                "SNAPSHOT_IN_ORIGINAL_TRACE" if "original_consultees" in proposal
                else "LEGACY_RECONSTRUCTION_NOT_AUTHORITATIVE"
            ),
            "consultation_counts_originally_frozen": "original_consultees" in proposal,
            "original_relation_membership_frozen": "original_relation_participants" in proposal,
            "requires_fresh_original_qualification": status != historical_status,
            "consultation_source_revision": proposal.get("cooperation_source_revision"),
            "original_organizational_code_revision": proposal.get("org_revision"),
            "change_id": proposal["change_id"], "link": link.key,
            "change_scope": proposal["change_kind"],
            "economic_channel": proposal["economic_channel"],
            "original_source_revision": proposal["cooperation_source_revision"],
            "consulted_count": len(latest), "required_count": len(required),
            "supporting_model_declarations": count_support,
            "objecting_model_declarations": objections,
            "review_status": status,
            "individual_positions": "OWNER_SCOPED_NOT_REDISCLOSED",
            "new_participant_or_removed_rights": "NOT_AUTOMATIC",
            "old_work_obligations_and_results": "UNCHANGED",
            "transaction_costs_and_joint_economies": "REBASELINE_REQUIRED_NO_ASSUMED_SAVINGS",
            "organizational_code_authorization": "NOT_IMPLEMENTED",
            "actual_effect": "NOT_IDENTIFIABLE",
        })
    return out


def cooperation_reconfiguration_economics(
    *, change: Mapping[str, Any], link: CooperationLink,
    evidence: Mapping[str, Any],
) -> dict[str, Any]:
    """Source-bounded multi-principal *coverage*, never causal savings.

    Uses the existing economic_flow mechanism allocations and per_subject
    original alternatives. No second ledger, created prices, additive profit,
    or ex-post data masquerading as knowledge before the proposal event.
    """
    from decimal import Decimal

    original = set(link.participants)
    claims = [row for row in evidence.get("cooperation_cost_channels", {})
              .get("claimed_channels", ())
              if row.get("link") == link.key and row.get("channel") == change["economic_channel"]]
    comparable = [row for row in claims
                  if row.get("owner") in original and
                  row.get("comparison") == "DECLARED_SCOPE_ARITHMETIC_ONLY"]
    covered = {row["owner"] for row in comparable}
    subject_options = evidence.get("per_subject", {})
    declared_feasible = sum(subject_options.get(party, {}).get("outside_feasibility") ==
                            "FEASIBLE_DECLARED" for party in original)
    def neg(row: Mapping[str, Any]) -> bool:
        return any(Decimal(row[key]) < 0 for key in (
            "resource_cost_reduction_claim", "buyer_cash_outlay_reduction_claim",
        ) if row.get(key) is not None)
    negative = sum(neg(row) for row in comparable)
    return {
        "change_id": change["change_id"],
        "declared_mechanism": change["economic_channel"],
        "original_principals": len(original),
        "model_claims_for_mechanism": len(claims),
        "principals_with_comparable_claims": len(covered),
        "principals_with_declared_feasible_alternatives": declared_feasible,
        "channels_with_possible_disadvantage": negative,
        "requires_new_entrant_economic_basis": change["required_count"] > len(original),
        "transition_transaction_costs": "NOT_IDENTIFIED",
        "shared_purchasing_marketing_and_logistics_effect": "NOT_IDENTIFIABLE",
        "source_time_available_before_proposal": "NOT_QUALIFIED",
        "individual_costs": "ORIGINAL_OWNER_SCOPED_NOT_REDISCLOSED",
        "system_wide_net_gain": None,
        "counterfactual_joint_feasibility": "NOT_VERIFIED",
        "causal_economic_effect": "NOT_IDENTIFIABLE",
        "rights_from_alleged_saving": "NONE",
    }


def attach_requested_work(links: Sequence[CooperationLink], work: Any,
                          resource_owners: Mapping[str, str], *,
                          link_id: Any, expected_revision: Any,
                          trace: Sequence[Mapping[str, Any]] = (),
                          org_revision: str | None = None) -> tuple[CooperationLink, ...]:
    """Connect a newly requested ORIGINAL work to an already declared relation.

    The request is only a proposal from its original customer. It cannot add
    principals to an existing relationship, grant consent or replace any Result.
    Validation happens before the caller registers the new work: atomic or no-op.
    """
    if link_id is None and expected_revision is None:
        return tuple(links)
    if not isinstance(link_id, str) or not link_id or len(link_id) > 128:
        raise CooperationInputError("COOPERATION_LINK_REFERENCE_REQUIRED")
    if not isinstance(expected_revision, str) or not expected_revision or len(expected_revision) > 128:
        raise CooperationInputError("COOPERATION_SOURCE_REVISION_REQUIRED")
    match = next((link for link in links if link.key == link_id), None)
    if match is None:
        raise CooperationInputError("COOPERATION_LINK_UNKNOWN")
    if match.source_revision != expected_revision:
        raise CooperationInputError("COOPERATION_SOURCE_REVISION_STALE")
    originals = {work.customer} | {
        resource_owners[need.resource] for need in work.resource_requirements
    }
    if not originals.issubset(match.participants):
        raise CooperationInputError("COOPERATION_NEW_ORIGINAL_PARTY_REQUIRES_REVIEW")
    if org_revision is not None and any(
        latest_future_participation(trace, match.key, name, match.source_revision,
                                    org_revision) == "PAUSED_NEW_WORK"
        for name in originals
    ):
        raise CooperationInputError("COOPERATION_ORIGINAL_PARTY_PAUSED_NEW_WORK")
    if work.key in match.works:
        raise CooperationInputError("COOPERATION_WORK_ALREADY_LINKED")
    if len(match.works) >= 256:
        raise CooperationInputError("COOPERATION_WORK_LIMIT_REACHED")
    return tuple(replace(link, works=link.works + (work.key,)) if link.key == link_id
                 else link for link in links)


def cooperation_system_view(links: Sequence[CooperationLink], works: Mapping[str, Any],
                            resource_owners: Mapping[str, str], subjects: Mapping[str, Any],
                            institution: Any, trace: Sequence[Mapping[str, Any]],
                            *, economics: Mapping[str, Any] | None = None,
                            adaptation: Mapping[str, Any] | None = None,
                            context_basis: Any = None) -> dict[str, Any]:
    """One read-only nine-component causal research projection over ORIGINAL data.

    This is NOT a new state machine, an agent, a contract, or evidence of profit.
    Unknown or absent sources remain explicit; no review changes authority.
    """
    existing = cooperation_view(links, works, resource_owners, trace)
    econ = economics or {}
    channels = econ.get("cooperation_cost_channels", {}).get("claimed_channels", [])
    reviews = (adaptation or {}).get("cooperation_cost_review_signals", [])
    individually = econ.get("per_subject", {})
    components = ("Ц", "У", "А", "П", "КПБ", "ОК", "КЖ", "Э", "ЖЦ")
    change_reviews = cooperation_change_reviews(
        links, trace, current_org_revision=institution.revision, subjects=subjects
    )
    projections: list[dict[str, Any]] = []
    for link in links:
        base = next(row for row in existing["links"] if row["id"] == link.key)
        own_works = [works[key] for key in link.works]
        owner_active = {name: bool(subjects[name].active) for name in link.participants}
        linked_events = [row for row in trace if row.get("work") in link.works]
        applied = [row for row in linked_events if row.get("outcome") == "APPLIED"]
        owner_interest_updates = sum(row.get("action") == "interest_update"
                                     for row in applied)
        future_participation = {
            name: latest_future_participation(
                trace, link.key, name, link.source_revision, institution.revision
            ) for name in link.participants
        }
        last_at = applied[-1]["at"] if applied else None
        signed = all(w.obligation != "NOT_ACCEPTED" for w in own_works)
        accepted = all(w.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT" for w in own_works)
        source_rules = set() if context_basis is None else {
            (wid, action) for wid in link.works
            for (work, action) in context_basis.requirements if work == wid
        }
        own_channels = [row for row in channels if row["link"] == link.key]
        own_reviews = [row for row in reviews if row["link"] == link.key]
        own_changes = [row for row in change_reviews if row["link"] == link.key]
        original_code_checks = [
            organizational_code_readiness(row) for row in own_changes
        ]
        economic_change_evidence = [
            cooperation_reconfiguration_economics(change=row, link=link, evidence=econ)
            for row in own_changes
        ]
        linked_event_cost_evidence = next(
            (entry for entry in econ.get("cooperative_event_costs", {}).get("relations", ())
             if entry["link"] == link.key), None
        )
        coordination_observations = cooperative_coordination_observations(link, trace)
        comparable = sum(row["comparison"] == "DECLARED_SCOPE_ARITHMETIC_ONLY"
                         for row in own_channels)
        # Every original principal independently controls a usable alternative;
        # lack of an alternative is not equivalent to a negative gain.
        outside_claims = {party: individually.get(party, {}).get("outside_feasibility", "UNKNOWN")
                          for party in link.participants}
        scope_complete = all(value != "UNKNOWN" for value in outside_claims.values())
        cost_status = ("SOURCE_DECLARED_COMPARISON_ONLY" if comparable == len(own_channels)
                       and comparable > 0 else "INCOMPLETE_OR_NOT_IDENTIFIABLE")
        state_by_component = {
            "Ц": {"status": "SOURCE_DECLARED_GOAL_NOT_VERIFIED",
                  "purpose": link.purpose,
                  "outside_options": "OWNER_SCOPED_NOT_REDISCLOSED",
                  "outside_source_coverage": "DECLARED_PARTIAL_OR_COMPLETE" if scope_complete
                  else "INCOMPLETE_OR_UNKNOWN"},
            "У": {"status": "ORIGINAL_SUBJECTS_RETAIN_RIGHTS",
                  "active_for_new_work": owner_active,
                  "paused_for_new_cooperation_count": sum(
                      value == "PAUSED_NEW_WORK" for value in future_participation.values()
                  ),
                  "independent_participation_details": "OWNER_SCOPED_NOT_REDISCLOSED",
                  "pause_is_not_contract_exit": True,
                  "missing_original_consents": base["missing_original_consents_by_work"],
                  "independent_interest_updates_declared": owner_interest_updates},
            "А": {"status": "AUTHOR_PROGRAM_AGENT_NOT_IMPLEMENTED",
                  "economic_subject_is_not_software_agent": True},
            "П": {"status": "LINKED_ORIGINAL_WORKS_ONLY",
                  "future_cooperative_processes": (
                      "PARTICIPANT_AVAILABILITY_REVIEW_REQUIRED" if
                      any(v == "PAUSED_NEW_WORK" for v in future_participation.values())
                      else "MODEL_ONLY_INVITATION_POSSIBLE_NOT_AUTHORIZED"
                  ),
                  "original_works": list(link.works),
                  "all_original_obligations_accepted": signed},
            "КПБ": {"status": "MODEL_ONLY_PARTIAL_SOURCE_GATES" if source_rules else "SOURCE_RIGHTS_NOT_QUALIFIED",
                    "work_action_requirements": [list(row) for row in sorted(source_rules)],
                    "source_claim_authentication": "NOT_IMPLEMENTED"},
            "ОК": {"status": "OPERATOR_PROCEDURE_PARTIAL",
                  "mode": institution.mode, "revision": institution.revision,
                  "relation_delegation": "NOT_INFERRED",
                  "original_change_consultations": len(own_changes),
                  "original_thirteen_code_requirements": original_code_checks,
                  "change_consultation_is_not_authorization": True},
            "КЖ": {"status": "ORIGINAL_RESULT_AND_EVENT_TRACE_ONLY",
                  "results_by_work": base["work_results"],
                  "original_result_references": "OWNER_SCOPED_NOT_REDISCLOSED",
                  "last_applied_event_at": last_at,
                  "applied_event_count": len(applied),
                  "blocked_event_reasons": base["blocked_event_reasons"]},
            "Э": {"status": cost_status, "source_declared_channel_count": len(own_channels),
                  "comparable_declared_channel_count": comparable,
                  "profit": "NOT_IDENTIFIABLE",
                  "costs_after_participation_change": (
                      "REESTIMATE_TRANSACTION_COSTS_AND_SHARED_CAPABILITIES" if
                      any(v == "PAUSED_NEW_WORK" for v in future_participation.values())
                      else "NOT_IDENTIFIABLE_WITHOUT_ORIGINAL_COST_SOURCES"
                  ),
                  "cause_and_effect": "NOT_ESTABLISHED",
                  "ex_post_claims_cannot_drive_past_decisions": True,
                  "reconfiguration_costs": ("REBASELINE_REQUIRED" if own_changes
                                            else "NOT_ESTABLISHED"),
                  "reconfiguration_economic_evidence": economic_change_evidence,
                  "transaction_coordination_exposures": coordination_observations,
                  "original_event_cost_evidence": (
                      {"linked_cost_rows": linked_event_cost_evidence["resource_use_rows_already_in_original_ledger"],
                       "linked_events": linked_event_cost_evidence["distinct_original_events_with_cost_rows"],
                       "cost_claims": "OWNER_SCOPED_NOT_REDISCLOSED",
                       "actual_verified_cost": "NOT_VERIFIED"}
                      if linked_event_cost_evidence else None
                  )},
            "ЖЦ": {"status": "DERIVED_FROM_ORIGINAL_WORK_STATES",
                    "current_relation_condition": base["relation_state"],
                    "economic_review_signals": [r["signal"] for r in own_reviews],
                    "owner_interest_review_count": owner_interest_updates,
                    "reconfiguration_review": (
                        "ORIGINAL_PRINCIPALS_MUST_DECIDE" if
                        any(v == "PAUSED_NEW_WORK" for v in future_participation.values())
                        else "NOT_AUTOMATIC"
                    ),
                    "organizational_change": "NOT_AUTOMATIC",
                    "reconfiguration_reviews": [
                        {"change_id": row["change_id"], "status": row["review_status"],
                         "fresh_original_qualification_required":
                             row["requires_fresh_original_qualification"]}
                        for row in own_changes]},
        }
        # Causal transitions have their OWN epistemic scope: modeled succession
        # is not evidence that a cost change caused a new original consent.
        causal_checks = [
            {"relation": "Ц/У/ОК_TO_P", "status": "SOURCE_DECLARED_ONLY",
             "invariant": "NO_OPERATOR_COMMITMENT_WITHOUT_ORIGINAL_CONSENTS"},
            {"relation": "У/П_TO_KЖ", "status": ("ALL_MODEL_ORIGINAL_RESULT_CLAIMS_ACCEPTED"
               if accepted else "OUTSTANDING_OR_DISPUTED_ORIGINAL_RESULTS"),
             "invariant": "NO_SECOND_AGGREGATE_RESULT"},
            {"relation": "П/ОК/КПБ_TO_A", "status": "DELEGATION_NOT_MODELED",
             "invariant": "NO_AUTOMATIC_AGENT_RIGHT"},
            {"relation": "КЖ/Э_TO_ЖЦ", "status": ("NONBINDING_COST_REVIEW_CUE"
                if own_reviews else "ECONOMIC_OR_EVIDENCE_LINK_UNOBSERVED"),
             "invariant": "NO_AUTOMATIC_ORGANIZATIONAL_CHANGE"},
        ]
        projections.append({
            "link": link.key, "scope": "RESEARCH_PROJECTION_NOT_NEW_INSTITUTION",
            "source_ref": link.source_ref, "source_revision": link.source_revision,
            "original_works": list(link.works), "components": state_by_component,
            "proposed_cooperation_changes": len(own_changes),
            "author_formation_phases": formation_phase_evidence(
                link=link, works=own_works, modeled_events=linked_events,
                source_rules=source_rules, declared_economic_channels=len(own_channels),
            ),
            "causal_checks": causal_checks,
            "economic_claims": "OWNER_SCOPED_NOT_REDISCLOSED",
            "rights_filtered_participant_projection": "NOT_IMPLEMENTED",
            "audience": "RESEARCH_ONLY_NOT_FOR_MEMBER_DISTRIBUTION",
            "all_nine_components_fully_implemented": False,
            "causal_effect": "NOT_IDENTIFIABLE",
        })
    return {"evidence": "MODEL_ONLY", "source_authentication": "DECLARED_UNVERIFIED",
            "uses_only_original_event_trace": True, "component_ids": list(components),
            "relations": projections, "original_results_only": True,
            "not_a_second_core_or_scheduler": True}




_COORDINATION_ACTIONS = {
    "request": "SEARCH_AND_DISCOVERY",
    "offer": "SEARCH_AND_DISCOVERY",
    "authorize": "RIGHTS_AND_NEGOTIATION",
    "consent": "RIGHTS_AND_NEGOTIATION",
    "commit": "RIGHTS_AND_NEGOTIATION",
    "source_update": "INFORMATION_AND_VERIFICATION",
    "accept": "INFORMATION_AND_VERIFICATION",
    "reject": "INFORMATION_AND_VERIFICATION",
    "handoff_receive": "INFORMATION_AND_VERIFICATION",
    "handoff_quality": "INFORMATION_AND_VERIFICATION",
    "interest_update": "RENEGOTIATION_AND_ADAPTATION",
    "participation_status": "RENEGOTIATION_AND_ADAPTATION",
    "cooperation_change_propose": "RENEGOTIATION_AND_ADAPTATION",
    "cooperation_change_response": "RENEGOTIATION_AND_ADAPTATION",
}


def cooperative_coordination_observations(link: CooperationLink,
                                           trace: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Event exposures for empirical TC work, NOT transaction costs in money.

    Count only original events assigned to the relation through its work or
    source-declared relation reference. Work execution and material movement
    are separate original operations; they are not deemed transaction costs.
    """
    counts = {name: {"applied": 0, "blocked": 0} for name in
              sorted(set(_COORDINATION_ACTIONS.values()))}
    excluded_execution = 0
    unknown_events = 0
    for event in trace:
        related = (event.get("work") in link.works or
                   event.get("cooperation_link") == link.key or
                   event.get("participation_link") == link.key or
                   event.get("interest_relation") == link.key or
                   event.get("requested_cooperation_link") == link.key or
                   link.key in (event.get("cooperation_relations") or ()))
        if not related:
            continue
        bucket = _COORDINATION_ACTIONS.get(event.get("action"))
        if bucket is None:
            excluded_execution += 1
            continue
        outcome = event.get("outcome")
        if outcome not in ("APPLIED", "BLOCKED"):
            unknown_events += 1
            continue
        counts[bucket]["applied" if outcome == "APPLIED" else "blocked"] += 1
    return {
        "scope": "EXISTING_COOPERATIVE_RELATION_EVENTS_ONLY",
        "observed_coordination_events": counts,
        "original_execution_events_not_deemed_transaction_costs": excluded_execution,
        "events_without_qualified_outcome": unknown_events,
        "real_transaction_cost_amount": None,
        "counterfactual_avoided_transactions": "NOT_IDENTIFIABLE",
        "event_counts_are_monetary_costs": False,
        "causal_savings": "NOT_IDENTIFIABLE",
        "basis": "MODEL_ONLY_EVENT_EXPOSURE_NOT_ACTUAL_ACCOUNTING",
    }

def attribute_cooperative_event_costs(
    raw: Any, links: Sequence[CooperationLink], trace: Sequence[Mapping[str, Any]],
    sources: Mapping[str, Mapping[str, Any]],
    resource_uses: Mapping[str, Mapping[str, Any]],
    channels: Mapping[str, Any],
) -> dict[str, Any]:
    """Tie original modeled coordination events to EXISTING owner cost records.

    This is a reference-only extension of original economic_claims. It creates
    neither values nor rights, and cannot turn ex-post cost rows into ex-ante
    decisions, actual verified costs, or empirically identified savings.
    """
    from decimal import Decimal

    if not isinstance(raw, list) or len(raw) > 512:
        raise CooperationInputError("COOPERATION_EVENT_COST_BINDING_COUNT_INVALID")
    by_link = {link.key: link for link in links}
    by_time: dict[int, list[Mapping[str, Any]]] = {}
    for event in trace:
        at = event.get("at")
        if isinstance(at, int) and not isinstance(at, bool):
            by_time.setdefault(at, []).append(event)
    existing_channels = channels.get("claimed_channels", ())
    unique_cost_ids: set[str] = set()
    grouped: dict[str, dict[str, Any]] = {}
    counts: dict[str, dict[str, int]] = {}
    for obj in raw:
        required = {"link", "owner", "channel", "event_at", "resource_use_id", "source"}
        if not isinstance(obj, dict) or set(obj) != required:
            raise CooperationInputError("COOPERATION_EVENT_COST_BINDING_FIELDS_INVALID")
        link_id = obj["link"]
        if not isinstance(link_id, str) or link_id not in by_link:
            raise CooperationInputError("COOPERATION_EVENT_COST_LINK_UNKNOWN")
        link = by_link[link_id]
        owner = _id(obj["owner"], "EVENT_COST_OWNER")
        channel = _id(obj["channel"], "EVENT_COST_CHANNEL")
        if owner not in link.participants or channel not in link.mechanisms:
            raise CooperationInputError("COOPERATION_EVENT_COST_PARTY_OR_CHANNEL_UNKNOWN")
        src = _id(obj["source"], "EVENT_COST_SOURCE")
        if src not in sources or sources[src]["owner"] != owner:
            raise CooperationInputError("COOPERATION_EVENT_COST_SOURCE_OWNER_REQUIRED")
        at = obj["event_at"]
        if not isinstance(at, int) or isinstance(at, bool) or at < 0:
            raise CooperationInputError("COOPERATION_EVENT_COST_TIME_INVALID")
        if at not in by_time:
            raise CooperationInputError("COOPERATION_EVENT_COST_EVENT_NOT_IN_TRACE")
        if len(by_time[at]) != 1:
            raise CooperationInputError("COOPERATION_EVENT_COST_EVENT_AMBIGUOUS")
        event = by_time[at][0]
        action = event.get("action")
        if (action not in _COORDINATION_ACTIONS or
                event.get("outcome") not in {"APPLIED", "BLOCKED"}):
            raise CooperationInputError("COOPERATION_EVENT_COST_NOT_COORDINATION_EVENT")
        event_actor = event.get("actor")
        if event_actor not in link.participants:
            raise CooperationInputError("COOPERATION_EVENT_COST_EVENT_ACTOR_NOT_ORIGINAL")
        if owner not in {event_actor, link.coordinator}:
            raise CooperationInputError("COOPERATION_EVENT_COST_UNAUTHORIZED_CROSS_OWNER_ATTRIBUTION")
        event_related = (
            event.get("work") in link.works or
            event.get("cooperation_link") == link.key or
            event.get("participation_link") == link.key or
            event.get("interest_relation") == link.key or
            event.get("requested_cooperation_link") == link.key or
            link.key in (event.get("cooperation_relations") or ())
        )
        if not event_related:
            raise CooperationInputError("COOPERATION_EVENT_COST_EVENT_UNRELATED")
        record = _id(obj["resource_use_id"], "EVENT_RESOURCE_USE_ID")
        if record not in resource_uses:
            raise CooperationInputError("COOPERATION_EVENT_COST_RESOURCE_USE_UNKNOWN")
        if record in unique_cost_ids:
            raise CooperationInputError("COOPERATION_EVENT_COST_RESOURCE_DOUBLE_LINKED")
        use = resource_uses[record]
        if use.get("source") != src:
            raise CooperationInputError("COOPERATION_EVENT_COST_SOURCE_ROW_MISMATCH")
        if (use["owner"] != owner or use["scenario"] != "COOPERATION" or
                use["bucket"] not in {"COORDINATION", "PARTICIPANT_CONNECT", "FAILURE", "EXIT"}):
            raise CooperationInputError("COOPERATION_EVENT_COST_LEDGER_SCOPE_INVALID")
        if use.get("work") is not None:
            if use["work"] not in link.works or event.get("work") != use["work"]:
                raise CooperationInputError("COOPERATION_EVENT_COST_WORK_MISMATCH")
        applicable = [item for item in existing_channels
                      if item["link"] == link_id and item["owner"] == owner and
                      item["channel"] == channel and record in
                      item["ledger_record_ids"]["cooperation_resource_uses"]]
        if len(applicable) != 1:
            raise CooperationInputError("COOPERATION_EVENT_COST_NOT_IN_EXISTING_CHANNEL")
        unique_cost_ids.add(record)
        group = grouped.setdefault(link_id, {"owners": set(), "events": set(),
                                               "resources": [], "buckets": set()})
        group["owners"].add(owner)
        group["events"].add(at)
        group["resources"].append(use["decimal_amount"])
        group["buckets"].add(_COORDINATION_ACTIONS[action])
        counts.setdefault(link_id, {}).setdefault(_COORDINATION_ACTIONS[action], 0)
        counts[link_id][_COORDINATION_ACTIONS[action]] += 1
    output: list[dict[str, Any]] = []
    for link in links:
        record = grouped.get(link.key)
        if record is None:
            continue
        observed = cooperative_coordination_observations(link, trace)
        number_events = sum(sum(row.values()) for row in
                            observed["observed_coordination_events"].values())
        output.append({
            "link": link.key,
            "resource_use_rows_already_in_original_ledger": len(record["resources"]),
            "distinct_original_events_with_cost_rows": len(record["events"]),
            "owners_with_source_declared_cost_evidence": len(record["owners"]),
            "possible_cooperative_events_without_cost_binding":
                max(0, number_events - len(record["events"])),
            "coordination_categories_with_cost_links": sorted(record["buckets"]),
            "coordination_link_counts": dict(sorted(counts[link.key].items())),
            "declared_existing_resource_use_amount":
                f"{sum(record['resources'], Decimal('0')):.2f}",
            "value_kind": "SOURCE_DECLARED_RESOURCE_COST_ONLY",
            "individual_sources_and_amounts": "OWNER_SCOPED_NOT_REDISCLOSED",
            "original_cost_rows_not_duplicated": True,
            "resource_uses_additive_to_cash": False,
            "same_period_independent_alternative": "NOT_ESTABLISHED_BY_EVENT_BINDING",
            "event_source_availability_before_decision": "NOT_VERIFIED",
            "causal_cost_reduction": "NOT_IDENTIFIABLE",
            "real_transaction_cost_verified": False,
        })
    return {"evidence": "MODEL_ONLY_REFERENCES_TO_EXISTING_ECONOMIC_ROWS",
            "linked_cost_rows": len(unique_cost_ids),
            "relations": output,
            "economic_records_created": 0,
            "source_and_rights_authentication": "NOT_QUALIFIED",
            "independent_alternative_automatically_computed": False,
            "causal_effect": "NOT_IDENTIFIABLE"}


def latest_owner_interest_claim(trace: Sequence[Mapping[str, Any]], subject: str,
                                work: str, source_revision: str,
                                org_revision: str) -> tuple[str, str] | None:
    """Time-qualified ORIGINAL owner interest from the existing event trace.

    This is a modeled declaration, never a granted consent, validated forecast,
    or retrospective use of final period's economic_claims. Existing accepted
    obligations cannot be rewritten by later model-only preference changes.
    """
    for event in reversed(trace):
        if (event.get("action") != "interest_update" or event.get("outcome") != "APPLIED"
                or event.get("actor") != subject or event.get("work") != work):
            continue
        if (event.get("interest_source_revision") == source_revision and
                event.get("org_revision") == org_revision):
            return event["interest_willingness"], event["interest_outside_option"]
    return None


def evaluate_cooperation_cost_channels(raw: Any, links: Sequence[CooperationLink],
                                       sources: Mapping[str, Mapping[str, Any]],
                                       transfers: Mapping[str, Mapping[str, Any]],
                                       resource_uses: Mapping[str, Mapping[str, Any]],
                                       covered: Mapping[str, Mapping[str, str]],
                                       outside_feasibility: Mapping[str, str]) -> dict[str, Any]:
    """Attribute EXISTING economic records; never add them into a second ledger.

    Returns exact *claimed* cost differences by original principal and channel,
    separately for cash outlays and resource cost. Their sum is NOT defined:
    the same acquisition may be represented in both accounting perspectives.
    """
    from decimal import Decimal

    if not isinstance(raw, list) or len(raw) > 512:
        raise CooperationInputError("INVALID_COOPERATION_COST_CHANNEL_COUNT")
    link_by_id = {link.key: link for link in links}
    seen_ids: set[str] = set()
    assigned_records: set[str] = set()
    items = []
    required = {"id", "link", "owner", "channel", "source", "comparability_source", "comparability_state",
                "cooperation_scope_source", "outside_scope_source",
                "cooperation_resource_use_ids", "outside_resource_use_ids",
                "cooperation_cash_outflow_ids", "outside_cash_outflow_ids"}

    def check_source(source_id: Any, owner: str) -> str:
        sid = _id(source_id, "COST_SOURCE")
        if sid not in sources or sources[sid]["owner"] != owner:
            raise CooperationInputError("COOPERATION_COST_SOURCE_OWNER_REQUIRED")
        return sid

    def refs(raw_refs: Any, index: Mapping[str, Mapping[str, Any]],
             owner: str, scenario: str, mode: str, link: CooperationLink) -> tuple[Decimal, Decimal, list[str]]:
        names = _names(raw_refs, "COST_RECORD_IDS", minimum=0, maximum=512)
        claimed = Decimal("0")
        external = Decimal("0")
        for name in names:
            if name not in index:
                raise CooperationInputError("COOPERATION_COST_RECORD_NOT_IN_LEDGER")
            row = index[name]
            if row.get("work") is not None and row["work"] not in link.works:
                raise CooperationInputError("COOPERATION_COST_WORK_NOT_IN_LINK")
            if row["scenario"] != scenario:
                raise CooperationInputError("COOPERATION_COST_SCENARIO_MISMATCH")
            if mode == "cash":
                if row["payer"] != owner or row["payee"] not in set(link.participants) | {"EXTERNAL"}:
                    raise CooperationInputError("COOPERATION_PAYMENT_OWNER_OR_PARTNER_MISMATCH")
                if row["payee"] == "EXTERNAL":
                    external += row["decimal_amount"]
            elif row["owner"] != owner:
                raise CooperationInputError("COOPERATION_RESOURCE_USE_OWNER_MISMATCH")
            if name in assigned_records:
                raise CooperationInputError("COOPERATION_COST_RECORD_DOUBLE_ALLOCATED")
            assigned_records.add(name)
            claimed += row["decimal_amount"]
        return claimed, external, list(names)

    for obj in raw:
        if not isinstance(obj, dict) or set(obj) != required:
            raise CooperationInputError("INVALID_COOPERATION_COST_FIELDS")
        key = _id(obj["id"], "COST_ID")
        if key in seen_ids:
            raise CooperationInputError("DUPLICATE_COOPERATION_COST_CHANNEL")
        seen_ids.add(key)
        link_id = obj["link"]
        if not isinstance(link_id, str) or link_id not in link_by_id:
            raise CooperationInputError("COOPERATION_COST_UNKNOWN_LINK")
        link = link_by_id[link_id]
        owner = _id(obj["owner"], "COST_OWNER")
        channel = _id(obj["channel"], "COST_CHANNEL")
        if owner not in link.participants or channel not in link.mechanisms:
            raise CooperationInputError("COOPERATION_COST_CHANNEL_NOT_DECLARED")
        source_ref = check_source(obj["source"], owner)
        comparison_ref = check_source(obj["comparability_source"], owner)
        cooperation_scope_source = check_source(obj["cooperation_scope_source"], owner)
        outside_scope_source = check_source(obj["outside_scope_source"], owner)
        comparison_state = obj["comparability_state"]
        if comparison_state not in ("COMPARABLE_DECLARED", "UNKNOWN"):
            raise CooperationInputError("COOPERATION_COMPARABILITY_INVALID")
        coop_resource, _, cr = refs(obj["cooperation_resource_use_ids"], resource_uses,
                                    owner, "COOPERATION", "resource", link)
        outside_resource, _, ir = refs(obj["outside_resource_use_ids"], resource_uses,
                                      owner, "INDEPENDENT_ALTERNATIVE", "resource", link)
        coop_cash, coop_external, cc = refs(obj["cooperation_cash_outflow_ids"], transfers,
                                            owner, "COOPERATION", "cash", link)
        outside_cash, outside_external, ic = refs(obj["outside_cash_outflow_ids"], transfers,
                                                  owner, "INDEPENDENT_ALTERNATIVE", "cash", link)
        comparable = (owner in covered["COOPERATION"] and
                      owner in covered["INDEPENDENT_ALTERNATIVE"] and
                      outside_feasibility.get(owner) == "FEASIBLE_DECLARED" and
                      comparison_state == "COMPARABLE_DECLARED")
        f = lambda x: f"{x:.2f}"
        items.append({
            "id": key, "link": link_id, "owner": owner, "channel": channel,
            "source": source_ref, "comparability_source": comparison_ref,
            "cooperation_scope_source": cooperation_scope_source,
            "outside_scope_source": outside_scope_source,
            "comparability_state": comparison_state,
            "comparison": "DECLARED_SCOPE_ARITHMETIC_ONLY" if comparable else "NOT_IDENTIFIABLE",
            "cooperation_resource_cost_claim": f(coop_resource),
            "outside_resource_cost_claim": f(outside_resource),
            "cooperation_buyer_cash_outlay_claim": f(coop_cash),
            "outside_buyer_cash_outlay_claim": f(outside_cash),
            "cooperation_external_cash_outlay_claim": f(coop_external),
            "outside_external_cash_outlay_claim": f(outside_external),
            "resource_cost_reduction_claim": f(outside_resource - coop_resource) if comparable else None,
            "buyer_cash_outlay_reduction_claim": f(outside_cash - coop_cash) if comparable else None,
            "external_cash_outlay_reduction_claim": f(outside_external - coop_external) if comparable else None,
            "ledger_record_ids": {
                "cooperation_resource_uses": cr, "outside_resource_uses": ir,
                "cooperation_cash_outflows": cc, "outside_cash_outflows": ic,
            },
            "combined_savings": None,
            "causal_attribution": "NOT_IDENTIFIABLE",
            "right_to_internal_supply": "NOT_CREATED_BY_COST_COMPARISON",
        })
    return {"evidence": "MODEL_ONLY", "method": "ATTRIBUTION_OF_EXISTING_LEDGER_ROWS",
            "claimed_channels": items, "double_count_with_cash": "NOT_ADDED",
            "absence_of_claims_means_zero": False, "economic_effect": "NOT_EMPIRICALLY_IDENTIFIED"}


def cooperative_model_readiness(
    links: Sequence[CooperationLink], works: Mapping[str, Any],
    resource_owners: Mapping[str, str], institution: Any,
    decision_observations: Sequence[Mapping[str, Any]], *,
    work_id: str | None = None,
) -> list[dict[str, Any]]:
    """Current *nonbinding* readiness of original independent work principals.

    Only modeled responses captured at the current source and organizational
    revisions count. No historic response creates a signature, new contract,
    coalition admission or transferable right. No prices or private positions
    are redistributed by this diagnostic projection.
    """
    latest: dict[tuple[str, str, str, str], str] = {}
    for observation in decision_observations:
        if (observation.get("observation_kind") != "SIMULATED_SUBJECT_RESPONSE"
                or observation.get("evidence") != "MODEL_ONLY"
                or observation.get("effect") != "NO_AUTOMATIC_CONSENT"):
            continue
        subject, work = observation.get("subject"), observation.get("work")
        source, org = observation.get("work_source_revision"), observation.get("org_revision")
        assessment = observation.get("assessment")
        if all(isinstance(value, str) and value for value in
               (subject, work, source, org, assessment)):
            latest[(subject, work, source, org)] = assessment
    relation_count_by_work: dict[str, int] = {}
    for link in links:
        for item_work in link.works:
            relation_count_by_work[item_work] = relation_count_by_work.get(item_work, 0) + 1
    output: list[dict[str, Any]] = []
    for link in links:
        for item_work in link.works:
            if work_id is not None and item_work != work_id:
                continue
            work = works.get(item_work)
            if work is None:
                continue
            original = original_parties_for_work(work, resource_owners)
            replies = [latest.get((subject, item_work, work.source_revision,
                                   institution.revision)) for subject in sorted(original)]
            observed = [reply for reply in replies if reply is not None]
            if work.obligation != "NOT_ACCEPTED":
                status = "ORIGINAL_OBLIGATION_UNCHANGED"
            elif relation_count_by_work[item_work] > 1:
                # A generic work response cannot be treated as a choice of one
                # among several separate cooperative relationships.
                status = "MODEL_RELATION_CHOICE_AMBIGUOUS"
            elif work.proposal != "OFFERED":
                status = "MODEL_OFFER_NOT_CURRENT"
            elif any(reply in {"INDEPENDENT_DECLINE", "PREFERS_OUTSIDE_OPTION",
                                  "COOPERATION_FUTURE_PARTICIPATION_PAUSED"}
                     for reply in observed):
                status = "MODEL_INDEPENDENT_OPPOSITION"
            elif len(observed) < len(original):
                status = "MODEL_ORIGINAL_RESPONSE_INCOMPLETE"
            elif all(reply == "REVIEWABLE_NOT_CONSENTED" for reply in replies):
                status = "MODEL_READY_FOR_ORIGINAL_CONSENT_REVIEW"
            else:
                status = "MODEL_BLOCKED_OR_UNCERTAIN"
            output.append({
                "relation": link.key, "work": item_work,
                "original_principal_count": len(original),
                "current_source_model_responses": len(observed),
                "missing_current_source_responses": len(original) - len(observed),
                "status": status, "original_result": work.result,
                "original_obligation": work.obligation,
                "modelled_participant_positions": "OWNER_SCOPED_NOT_REDISCLOSED",
                "economic_advantage": "NOT_DERIVED_FROM_MODEL_RESPONSES",
                "original_consents_issued": False,
                "organizational_change": "NONE",
                "evidence": "MODEL_ONLY_CURRENT_STATE_RESPONSE",
            })
    return output


def cooperative_readiness_evolution(
    observations: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Reduce snapshots embedded in EXISTING response observations.

    This is a derived view, not an extra event journal or transition engine.
    Only changes in status or number of current independent assessments are
    reported. No observation is reconstructed with the FINAL state of a run.
    """
    previous: dict[tuple[str, str], tuple[str, int]] = {}
    changes: list[dict[str, Any]] = []
    for observation in observations:
        # A later event at the same logical time may already have changed the
        # state before this callback. Do not misattribute its consequences to
        # the earlier triggering event. The original response remains intact.
        if observation.get("source_event_state_is_current") is False:
            continue
        review = observation.get("cooperation_model_review")
        if not isinstance(review, list):
            continue
        for row in review:
            key = (row["relation"], row["work"])
            value = (row["status"], row["current_source_model_responses"])
            if previous.get(key) == value:
                continue
            previous[key] = value
            changes.append({
                "at": observation.get("at"),
                "source_trace_position": observation.get("source_trace_position"),
                "relation": row["relation"], "work": row["work"],
                "readiness": row["status"],
                "current_responses": row["current_source_model_responses"],
                "original_principals": row["original_principal_count"],
                "original_obligation": row["original_obligation"],
                "original_result": row["original_result"],
            })
    return {
        "evidence": "MODEL_ONLY_CAUSAL_RESPONSE_PROJECTION",
        "basis": "SAME_ORIGINAL_TRACE_AND_EXISTING_MESA_AGENT_RESPONSES",
        "changes": changes,
        "individual_willingness": "OWNER_SCOPED_NOT_REDISCLOSED",
        "prices_and_costs": "NOT_INFERRED",
        "actual_agreements_or_results_created": 0,
        "no_additional_scheduler_or_ledger": True,
    }
