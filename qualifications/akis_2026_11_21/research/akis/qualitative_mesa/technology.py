"""Source-declared multi-operation production plan within one AKIS work.

This is a bounded MODEL_ONLY process decomposition, not a production optimizer,
measured duration, accepted Result, or alternative event scheduler.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Mapping, Sequence

from .capacity import ResourceNeed, Reservation, parse_resource_needs, CapacityInputError

MAX_OPERATIONS = 32  # bounded input handling, not a scientific capacity limit


class TechnologyInputError(ValueError):
    """Invalid source-declared operation graph."""


@dataclass(frozen=True)
class Operation:
    key: str
    primary_resource: str
    requires_completed: tuple[str, ...]
    resource_requirements: tuple[ResourceNeed, ...]
    slot_start: int
    slot_end: int


def _id(v: Any, label: str) -> str:
    if not isinstance(v, str) or not v.strip() or len(v) > 128:
        raise TechnologyInputError(f"INVALID_{label.upper()}")
    return v


def parse_operations(
    raw: Any, *, work_primary: str, work_start: int, work_end: int,
    resources: Mapping[str, str],
) -> tuple[Operation, ...]:
    """Validate a DAG and planned precedence; no inferred logistics or duration."""
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_OPERATIONS:
        raise TechnologyInputError("INVALID_OPERATION_LIST")
    ops: dict[str, Operation] = {}
    expected_fields = {"id", "primary_resource", "requires_completed",
                       "resource_requirements", "slot_start", "slot_end"}
    for row in raw:
        if not isinstance(row, dict) or set(row) != expected_fields:
            raise TechnologyInputError("INVALID_OPERATION_FIELDS")
        oid = _id(row["id"], "operation_id")
        if oid in ops:
            raise TechnologyInputError("DUPLICATE_OPERATION")
        primary = _id(row["primary_resource"], "operation_resource")
        if primary not in resources:
            raise TechnologyInputError("UNKNOWN_OPERATION_RESOURCE")
        start, end = row["slot_start"], row["slot_end"]
        if (type(start) is not int or type(end) is not int or
                start < work_start or end > work_end or start >= end):
            raise TechnologyInputError("INVALID_OPERATION_SLOT")
        predecessors = row["requires_completed"]
        if (not isinstance(predecessors, list) or len(predecessors) > MAX_OPERATIONS or
                any(not isinstance(x, str) or not x.strip() or len(x) > 128 for x in predecessors)):
            raise TechnologyInputError("INVALID_OPERATION_PREDECESSORS")
        if len(set(predecessors)) != len(predecessors):
            raise TechnologyInputError("DUPLICATE_OPERATION_PREDECESSOR")
        if oid in predecessors:
            raise TechnologyInputError("OPERATION_SELF_DEPENDENCY")
        try:
            needs = parse_resource_needs(row, primary, resources)
        except CapacityInputError as exc:
            raise TechnologyInputError(str(exc)) from exc
        ops[oid] = Operation(oid, primary, tuple(predecessors), needs, start, end)
    if not any(any(need.resource == work_primary for need in op.resource_requirements)
               for op in ops.values()):
        raise TechnologyInputError("WORK_PRIMARY_MUST_BE_IN_OPERATIONS")
    visited: set[str] = set()
    active: set[str] = set()

    def check(key: str) -> None:
        if key in active:
            raise TechnologyInputError("CYCLIC_OPERATION_DEPENDENCY")
        if key in visited:
            return
        active.add(key)
        op = ops[key]
        for pred in op.requires_completed:
            if pred not in ops:
                raise TechnologyInputError("UNKNOWN_OPERATION_PREDECESSOR")
            check(pred)
        active.remove(key)
        visited.add(key)
    for oid in sorted(ops):
        check(oid)
    for op in ops.values():
        for pred in op.requires_completed:
            if ops[pred].slot_end > op.slot_start:
                raise TechnologyInputError("OPERATION_PLAN_PRECEDENCE_CONFLICT")
    return tuple(ops[key] for key in sorted(ops))


def owners_summary(operations: Sequence[Operation]) -> tuple[ResourceNeed, ...]:
    """Owner enumeration only: max declared demand per resource, not booking."""
    units: dict[str, int] = {}
    for op in operations:
        for n in op.resource_requirements:
            units[n.resource] = max(units.get(n.resource, 0), n.units)
    return tuple(ResourceNeed(key, qty) for key, qty in sorted(units.items()))


def operation_reservations(work: str, operations: Sequence[Operation]) -> tuple[Reservation, ...]:
    """Reserve each operation's planned interval; parallel operations may overlap."""
    return tuple(Reservation(n.resource, work, op.slot_start, op.slot_end, n.units)
                 for op in operations for n in op.resource_requirements)


def technology_view(operations: Sequence[Operation], states: Mapping[str, str],
                    evidence: Mapping[str, str], owners: Mapping[str, str]) -> dict[str, Any]:
    original_owners = sorted({owners[n.resource] for op in operations
                              for n in op.resource_requirements})
    return {
        "evidence": "MODEL_ONLY", "planned_time": "SYMBOLIC_SEPARATE_FROM_EVENT_CLOCK",
        "physical_productivity": "NOT_IDENTIFIABLE",
        "resource_summary_role": "OWNER_ENUMERATION_NOT_WHOLE_WORK_RESERVATION",
        "original_resource_owners": original_owners,
        "cross_owner_capability_structure": ("MULTIPLE_ORIGINAL_OWNERS" if len(original_owners) > 1
                                            else "SINGLE_ORIGINAL_OWNER"),
        "operations": [
            {"id": op.key, "primary_resource": op.primary_resource,
             "declared_performer_owner": owners[op.primary_resource],
             "requires_completed": list(op.requires_completed),
             "slot_start": op.slot_start, "slot_end": op.slot_end,
             "resource_requirements": [{"resource": n.resource, "units": n.units}
                                       for n in op.resource_requirements],
             "execution": states[op.key], "model_evidence": evidence.get(op.key)}
            for op in operations
        ],
    }


# R1-T3: strictly prospective change of a future original Work's technology
# after an accepted predecessor Result and a source-qualified R1-T2 role change.
# This reuses the original technology DAG, Handoff, Assurance and Capacity
# Ledger; it is NOT an independent Work, contract, scheduling or Result engine.

class TechnologyRouteBlocked(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def technology_route_fingerprint(plan: Any) -> str:
    """Identity of the entire proposed future Work including QA and resources."""
    try:
        payload = json.dumps(
            plan, sort_keys=True, ensure_ascii=False,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_SOURCE_INVALID"
        ) from exc
    return hashlib.sha256(payload).hexdigest()


def _route_source(source: Any, actor: Any) -> None:
    prefix = f"model://{actor}/"
    if (not isinstance(source, str)
            or not isinstance(actor, str)
            or not source.startswith(prefix)
            or not len(prefix) < len(source) <= 180):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_OWN_SOURCE_REQUIRED"
        )


def _route_proposal(trace: Sequence[Mapping[str, Any]], route_id: Any
                    ) -> Mapping[str, Any]:
    if (not isinstance(route_id, str) or not route_id
            or len(route_id) > 128):
        raise TechnologyRouteBlocked("ORIGINAL_TECHNOLOGY_ROUTE_ID_REQUIRED")
    proposals = [
        row for row in trace
        if row.get("action") == "technology_route_propose"
        and row.get("outcome") == "APPLIED"
        and row.get("technology_route_id") == route_id
    ]
    if len(proposals) != 1:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_PROPOSAL_NOT_QUALIFIED"
        )
    return proposals[0]


def _route_principals(state: Any, work: Any) -> set[str]:
    return state.capacity_ledger.original_owners(
        work.resource_requirements
    ) | {work.customer}



def _assert_original_route_decision_source(state: Any, event: Mapping[str, Any], at: int) -> None:
    basis = getattr(state, "context_basis", None)
    if basis is not None and basis.strict:
        if not getattr(basis, "decision_requirements", None):
            raise TechnologyRouteBlocked("TECHNOLOGY_ROUTE_SOURCE_RIGHTS_NOT_QUALIFIED")
        # Existing original ContextBasis, not a new route-specific IAM.
        basis.assert_original_decision_rights(event, at)


def qualify_original_technology_route_proposal(
    state: Any, ev: Mapping[str, Any], at: int,
) -> dict[str, Any]:
    """No future Work is created by declaring a route or reviewing it."""
    _assert_original_route_decision_source(state, ev, at)
    route = ev.get("technology_route_id")
    if not isinstance(route, str) or not route or len(route) > 128:
        raise TechnologyRouteBlocked("ORIGINAL_TECHNOLOGY_ROUTE_ID_REQUIRED")
    if any(row.get("action") == "technology_route_propose"
           and row.get("outcome") == "APPLIED"
           and (row.get("technology_route_id") == route
                or row.get("technology_route_work") == ev.get(
                    "technology_route_work"))
           for row in state.trace):
        raise TechnologyRouteBlocked("ORIGINAL_TECHNOLOGY_ROUTE_PROPOSAL_EXISTS")
    if ev.get("org_revision") != state.institution.revision:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_STALE_ORGANIZATIONAL_CODE"
        )
    if (state.formation_policy is None or
            not all((
                state.formation_policy.design.enforce_model_result_conditioned_goals,
                state.formation_policy.design.enforce_model_result_conditioned_interests,
                state.formation_policy.design.enforce_model_result_conditioned_reconfiguration,
                state.formation_policy.design.enforce_model_result_conditioned_capability_cooperation,
            ))):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_STRICT_ORIGINAL_FORMATION_REQUIRED"
        )
    if not state.handoff_strict:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_CROSS_OWNER_HANDOFF_REQUIRED"
        )
    source = ev.get("technology_route_source_ref")
    _route_source(source, ev.get("actor"))
    valid_until = ev.get("technology_route_valid_until")
    if type(valid_until) is not int or valid_until <= at:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_FUTURE_VALIDITY_REQUIRED"
        )
    plan = ev.get("technology_route_work_spec")
    if not isinstance(plan, dict):
        raise TechnologyRouteBlocked("ORIGINAL_TECHNOLOGY_ROUTE_WORK_PLAN_REQUIRED")
    # Existing Work/technology/quality parsers remain the single authority.
    # This call constructs a candidate object only: no Work registry change.
    try:
        candidate = state._parse_work(plan)
    except (ValueError, KeyError, TypeError) as exc:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_WORK_PLAN_INVALID"
        ) from exc
    if (candidate.key != ev.get("technology_route_work")
            or candidate.key in state.works
            or candidate.customer != ev.get("actor")
            or not state.subjects[candidate.customer].active):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_FUTURE_CUSTOMER_REQUIRED"
        )
    if ev.get("technology_route_fingerprint") != technology_route_fingerprint(plan):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_PLAN_FINGERPRINT_MISMATCH"
        )
    original = state.works.get(ev.get("pilot_work"))
    if (original is None
            or original.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            or original.result_ref != ev.get("pilot_result_ref")
            or original.key not in candidate.requires_accepted):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_PRIOR_ACCEPTED_RESULT_REQUIRED"
        )
    # An independent accepted Result and a subsequent R1-T2 function/role
    # revision are necessary: a model title alone does not change production.
    applied = [
        row for row in state.trace
        if row.get("action") == "model_code_apply"
        and row.get("outcome") == "APPLIED"
        and row.get("model_code_change_id") ==
            ev.get("technology_route_model_code_change_id")
        and row.get("model_code_function_change_applied") is True
        and row.get("new_model_edition") ==
            state.model_org_code_edition
        and type(row.get("at")) is int
        and row["at"] < at
    ]
    if len(applied) != 1:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_FUNCTION_REVISION_REQUIRED"
        )
    link = next((
        item for item in state.cooperation_links
        if item.key == ev.get("cooperation_link")
        and item.source_revision == ev.get("cooperation_source_revision")
    ), None)
    if link is None or candidate.key in link.works:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_SUCCESSOR_RELATION_REQUIRED"
        )
    lineage = [
        row for row in state.trace
        if row.get("action") == "cooperation_membership_apply"
        and row.get("outcome") == "APPLIED"
        and row.get("successor_link") == link.key
        and row.get("successor_revision") == link.source_revision
        and row.get("pilot_work") == original.key
        and row.get("pilot_result_ref") == original.result_ref
        and row.get("at", at) < applied[0]["at"]
    ]
    if len(lineage) != 1:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_ACCEPTED_SUCCESSOR_LINEAGE_REQUIRED"
        )
    if candidate.resource != original.resource:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_ORIGINAL_PRIMARY_RESOURCE_REQUIRED"
        )
    principals = _route_principals(state, candidate)
    old_owners = state.capacity_ledger.original_owners(
        original.resource_requirements
    )
    performers = {
        state.resources[op.primary_resource] for op in candidate.operations
    }
    if (len(candidate.operations) < 2 or len(performers) < 2
            or not (performers - old_owners)
            or not old_owners.issubset(principals)
            or not principals.issubset(set(link.participants))
            or not candidate.handoffs
            or not candidate.assurance_criteria):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_REAL_CROSS_OWNER_STAGES_REQUIRED"
        )
    # Each actual stage must have a customer-assessed criterion whose
    # responsible model owner matches its original resource owner.
    if any(
        not any(c.operation == op.key
                and c.responsible_owner == state.resources[op.primary_resource]
                and c.assessor == candidate.customer
                for c in candidate.assurance_criteria)
        for op in candidate.operations
    ):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_STAGE_QUALITY_OWNER_REQUIRED"
        )
    market = {}
    if "technology_route_market_scope" in ev:
        raw = ev["technology_route_market_scope"]
        market = {
            "technology_route_market_scope_fingerprint": technology_route_fingerprint(raw),
            "technology_route_market_feasibility": review_original_route_market_scope(state, candidate, raw, at),
        }
    return {
        **market,
        "route_original_work": candidate.key,
        "route_source_revision": candidate.source_revision,
        "route_original_principals": sorted(principals),
        "route_independent_stage_owners": sorted(performers),
        "route_handoff_edges": len(candidate.handoffs),
        "route_quality_criteria": len(candidate.assurance_criteria),
        "route_historical_pilot": original.key,
        "route_direct_successor_link": link.key,
        "route_new_operation_plan_does_not_transfer_resource_ownership": True,
    }


def qualify_original_technology_route_response(
    state: Any, ev: Mapping[str, Any], at: int,
) -> None:
    _assert_original_route_decision_source(state, ev, at)
    proposal = _route_proposal(
        state.trace, ev.get("technology_route_id")
    )
    _assert_original_route_decision_source(state, proposal, at)
    if (ev.get("org_revision") != state.institution.revision
            or ev.get("technology_route_fingerprint") != proposal.get(
                "technology_route_fingerprint")
            or type(proposal.get("at")) is not int
            or not proposal["at"] < at < proposal["technology_route_valid_until"]):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_RESPONSE_SOURCE_OR_TIME_STALE"
        )
    party = ev.get("actor")
    if (party not in proposal["route_original_principals"]
            or party not in state.subjects
            or not state.subjects[party].active):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_PRINCIPAL_INDEPENDENCE_REQUIRED"
        )
    if ev.get("technology_route_decision") not in {
        "SUPPORT_ORIGINAL_TECHNOLOGY", "OBJECT_ORIGINAL_TECHNOLOGY"
    }:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_INDEPENDENT_POSITION_REQUIRED"
        )
    _route_source(ev.get("technology_route_decision_source_ref"), party)


def qualify_original_technology_route_request(
    state: Any, ev: Mapping[str, Any], work: Any, at: int,
) -> dict[str, Any] | None:
    proposals = [
        row for row in state.trace
        if row.get("action") == "technology_route_propose"
        and row.get("outcome") == "APPLIED"
        and row.get("technology_route_work") == work.key
    ]
    if not proposals and ev.get("technology_route_id") is None:
        if "technology_route_market_scope" in ev:
            raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_PROPOSAL_REQUIRED")
        return None
    if len(proposals) != 1:
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_PROPOSAL_NOT_QUALIFIED"
        )
    proposal = proposals[0]
    if ev.get("technology_route_id") != proposal.get("technology_route_id"):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_EXPLICIT_REQUEST_REFERENCE_REQUIRED"
        )
    if (ev.get("org_revision") != state.institution.revision
            or ev.get("technology_route_fingerprint") != proposal.get(
                "technology_route_fingerprint")
            or technology_route_fingerprint(ev.get("work_spec")) != proposal.get(
                "technology_route_fingerprint")
            or not proposal["at"] < at < proposal["technology_route_valid_until"]
            or ev.get("cooperation_link") != proposal.get("cooperation_link")
            or ev.get("cooperation_source_revision") != proposal.get(
                "cooperation_source_revision")
            or ev.get("change_id") is None
            or work.customer != proposal.get("actor")
            or work.source_revision != proposal.get("route_source_revision")):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_ORIGINAL_WORK_BINDING_STALE"
        )
    if (state.model_org_code_edition != proposal.get("model_org_edition")
            or not any(row.get("action") == "model_code_apply"
                       and row.get("outcome") == "APPLIED"
                       and row.get("model_code_change_id") ==
                            proposal.get("technology_route_model_code_change_id")
                       and row.get("model_code_function_change_applied") is True
                       and row.get("new_model_edition") ==
                            state.model_org_code_edition
                       for row in state.trace)):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_ORIGINAL_FUNCTION_REVISION_STALE"
        )
    latest: dict[str, Mapping[str, Any]] = {}
    for row in state.trace:
        if (row.get("action") == "technology_route_response"
                and row.get("outcome") == "APPLIED"
                and row.get("technology_route_id") == ev["technology_route_id"]
                and row.get("technology_route_fingerprint") ==
                    proposal["technology_route_fingerprint"]
                and type(row.get("at")) is int
                and proposal["at"] < row["at"] < at):
            latest[row["actor"]] = row
    if set(latest) != set(proposal["route_original_principals"]):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_ALL_PRINCIPALS_RESPONSE_REQUIRED"
        )
    if any(row.get("technology_route_decision") !=
           "SUPPORT_ORIGINAL_TECHNOLOGY" for row in latest.values()):
        raise TechnologyRouteBlocked(
            "ORIGINAL_TECHNOLOGY_ROUTE_ORIGINAL_PRINCIPAL_OBJECTED"
        )
    _assert_original_route_decision_source(state, proposal, at)
    for response in latest.values():
        _assert_original_route_decision_source(state, response, at)
    market = _review_bound_market_scope(state, work, ev, proposal, at)
    return {
        **market,
        "technology_route_original_source_qualified": True,
        **({"technology_route_strict_original_decision_sources_qualified": True}
           if state.context_basis is not None and state.context_basis.strict else {}),
        "technology_route_id": ev["technology_route_id"],
        "technology_route_fingerprint": proposal["technology_route_fingerprint"],
        "technology_route_previous_accepted_work": proposal["pilot_work"],
        "technology_route_new_stage_owners": proposal["route_independent_stage_owners"],
        "technology_route_original_work_consent_still_required": True,
        "technology_route_real_rights_and_measured_gain_not_assumed": True,
    }


def qualify_original_technology_route_commit(state: Any, work: Any, event: Mapping[str, Any],
                                             at: int) -> dict[str, Any] | None:
    """Recheck source rights and optional market scope before original commitment."""
    if state.context_basis is None or not state.context_basis.strict:
        if "technology_route_market_scope" in event:
            raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_STRICT_CONTEXT_REQUIRED")
        return None
    requests = [
        row for row in state.trace
        if row.get("action") == "request" and row.get("outcome") == "APPLIED"
        and row.get("work") == work.key
        and row.get("technology_route_id") is not None
    ]
    if not requests:
        if "technology_route_market_scope" in event:
            raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_PROPOSAL_REQUIRED")
        return None
    if len(requests) != 1 or not requests[0].get("technology_route_strict_original_decision_sources_qualified"):
        raise TechnologyRouteBlocked("ORIGINAL_TECHNOLOGY_ROUTE_STRICT_REQUEST_REQUIRED")
    request = requests[0]
    proposal = _route_proposal(state.trace, request["technology_route_id"])
    if (at >= proposal["technology_route_valid_until"]
            or state.institution.revision != request["org_revision"]
            or state.model_org_code_edition != proposal["model_org_edition"]
            or not any(link.key == proposal["cooperation_link"]
                       and link.source_revision == proposal["cooperation_source_revision"]
                       and work.key in link.works for link in state.cooperation_links)):
        raise TechnologyRouteBlocked("ORIGINAL_TECHNOLOGY_ROUTE_COMMIT_SOURCE_OR_SCOPE_STALE")
    latest = {}
    for row in state.trace:
        if (row.get("action") == "technology_route_response" and row.get("outcome") == "APPLIED"
                and row.get("technology_route_id") == request["technology_route_id"]
                and row.get("technology_route_fingerprint") == proposal["technology_route_fingerprint"]
                and proposal["at"] < row["at"] < at):
            latest[row["actor"]] = row
    if (set(latest) != _route_principals(state, work)
            or any(row["technology_route_decision"] != "SUPPORT_ORIGINAL_TECHNOLOGY"
                   for row in latest.values())):
        raise TechnologyRouteBlocked("ORIGINAL_TECHNOLOGY_ROUTE_COMMIT_INDEPENDENT_SUPPORT_REQUIRED")
    _assert_original_route_decision_source(state, proposal, at)
    for response in latest.values():
        _assert_original_route_decision_source(state, response, at)
    return _review_bound_market_scope(state, work, event, proposal, at) or None


def review_original_route_market_scope(state: Any, work: Any, raw: Any, at: int) -> dict[str, Any]:
    """Does a cooperative technology expand the disclosed feasible order set?

    Reuse original partner-discovery offer declarations and original capacity
    previews. Buyer specifies compatible resources per operation; each owner
    supplies its own offer and scope document. The search never changes Work,
    schedules, ownership, technology, money or consent. A missing catalogue
    or an unqualified source is UNKNOWN, not proof of a missing alternative.
    This bounded model cannot establish real market absence.
    """
    from itertools import product
    from .capacity import CapacityBlocked, CapacityInputError
    from .context_basis import ContextBlocked
    from .partner_discovery import DiscoveryInputError, parse_discovery

    basis = getattr(state, "context_basis", None)
    if basis is None or not basis.strict:
        raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_STRICT_CONTEXT_REQUIRED")
    fields = {"work", "work_revision", "deliverable", "buyer_source",
              "requirements", "offers", "offer_revisions", "owner_scopes"}
    if not isinstance(raw, dict) or set(raw) != fields:
        raise TechnologyRouteBlocked("MARKET_SCOPE_FIELDS_INVALID")
    if (raw["work"] != work.key or raw["work_revision"] != work.source_revision
            or not isinstance(raw["deliverable"], str) or not 0 < len(raw["deliverable"]) <= 128):
        raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_DEMAND_REQUIRED")
    owners = {key for key, party in state.subjects.items() if party.kind == "SME" and party.active}
    if work.customer not in owners:
        raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_ENTERPRISE_CUSTOMER_REQUIRED")
    if (len(work.operations) < 2 or any(len(op.resource_requirements) != 1
            or op.resource_requirements[0].resource != op.primary_resource for op in work.operations)):
        raise TechnologyRouteBlocked("MARKET_SCOPE_SINGLE_PRIMARY_RESOURCE_PER_STAGE_REQUIRED")

    def check_source(owner, source_ref, revision):
        basis.assert_original_form_role_source(
            owner, source_ref, revision, core="corporate",
            purpose="AKIS_TECHNOLOGY_MARKET_EVIDENCE", operation="READ",
            recipients={work.customer}, at=at,
        )

    buyer = raw["buyer_source"]
    if not isinstance(buyer, dict) or set(buyer) != {"reference", "revision"}:
        raise TechnologyRouteBlocked("MARKET_SCOPE_BUYER_SOURCE_REQUIRED")
    try:
        check_source(work.customer, buyer["reference"], buyer["revision"])
    except ContextBlocked as exc:
        raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_BUYER_SOURCE_NOT_QUALIFIED") from exc
    requirements = raw["requirements"]
    if not isinstance(requirements, list) or len(requirements) != len(work.operations):
        raise TechnologyRouteBlocked("MARKET_SCOPE_ALL_ORIGINAL_STAGES_REQUIRED")
    stages = {op.key: op for op in work.operations}
    needs = {}
    for row in requirements:
        if (not isinstance(row, dict) or set(row) != {
                "operation", "capability", "capacity_unit", "compatible_resources"}
                or not all(isinstance(row[key], str) and 0 < len(row[key]) <= 128
                           for key in ("operation", "capability", "capacity_unit"))):
            raise TechnologyRouteBlocked("MARKET_SCOPE_STAGE_REQUIREMENT_INVALID")
        key = row["operation"]
        resources = row["compatible_resources"]
        if (key not in stages or key in needs or not isinstance(resources, list)
                or not 1 <= len(resources) <= 128 or any(not isinstance(r, str) for r in resources)
                or len(set(resources)) != len(resources) or not set(resources) <= set(state.resources)
                or stages[key].primary_resource not in resources):
            raise TechnologyRouteBlocked("MARKET_SCOPE_BUYER_COMPATIBILITY_SCOPE_INVALID")
        needs[key] = row
    try:
        _, offers = parse_discovery({"demands": [], "offers": raw["offers"]},
                                    state.subjects, state.works, state.resources)
    except DiscoveryInputError as exc:
        raise TechnologyRouteBlocked(str(exc)) from exc
    revisions = raw["offer_revisions"]
    scopes = raw["owner_scopes"]
    if (not isinstance(revisions, dict) or set(revisions) != {o.key for o in offers}
            or not isinstance(scopes, dict) or not set(scopes) <= owners):
        raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_OFFER_AND_OWNER_SCOPE_REQUIRED")
    complete = {}
    uncertain = set()
    used_sources = set()
    for owner, row in scopes.items():
        if (not isinstance(row, dict) or set(row) != {"source_ref", "source_revision", "complete"}
                or type(row["complete"]) is not bool
                or not isinstance(row["source_ref"], str)):
            raise TechnologyRouteBlocked("MARKET_SCOPE_OWNER_COVERAGE_INVALID")
        if (row["source_ref"] == buyer["reference"] or row["source_ref"] in used_sources
                or any(o.source == row["source_ref"] for o in offers)):
            raise TechnologyRouteBlocked("MARKET_SCOPE_DISTINCT_COVERAGE_SOURCE_REQUIRED")
        used_sources.add(row["source_ref"])
        try:
            check_source(owner, row["source_ref"], row["source_revision"])
            complete[owner] = row["complete"]
        except ContextBlocked:
            uncertain.add(owner)
    if len({o.source for o in offers}) != len(offers):
        raise TechnologyRouteBlocked("MARKET_SCOPE_DISTINCT_OFFER_SOURCE_REQUIRED")
    usable = []
    for offer in offers:
        if offer.owner not in owners or not offer.available_at <= at < offer.expires_at:
            continue
        try:
            check_source(offer.owner, offer.source, revisions[offer.key])
        except ContextBlocked:
            uncertain.add(offer.owner)
            continue
        spec = state.resource_specs.get(offer.resource)
        availability = state.resource_availability.get(offer.resource)
        if (spec is None or spec.basis != "MODEL_DECLARED"
                or spec.unit != offer.capacity_unit
                or state.resource_availability_origin.get(offer.resource) not in {"MODEL_INPUT", "MODEL_EVENT"}
                or availability == "UNKNOWN"):
            uncertain.add(offer.owner)
            continue
        if availability == "AVAILABLE":
            usable.append(offer)

    def matching(stage, offer):
        row = needs[stage.key]
        return (offer.capability == row["capability"] and offer.capacity_unit == row["capacity_unit"]
                and offer.resource in row["compatible_resources"])

    def reservations(resources):
        return tuple(Reservation(resource, work.key, op.slot_start, op.slot_end,
                                 op.resource_requirements[0].units)
                     for op, resource in zip(work.operations, resources))

    selected = tuple(op.primary_resource for op in work.operations)
    joint_feasible = all(any(o.resource == resource and matching(op, o) for o in usable)
                         for op, resource in zip(work.operations, selected))
    selected_preview_attempted = joint_feasible
    if joint_feasible:
        try:
            state.capacity_ledger.preview_plan(work.key, reservations(selected))
        except (CapacityBlocked, CapacityInputError):
            joint_feasible = False
    counts = {"FEASIBLE": 0, "NO_FEASIBLE_IN_DECLARED_SCOPE": 0, "UNKNOWN": 0}
    searched = 0
    for owner in sorted(owners):
        options = [sorted({o.resource for o in usable if o.owner == owner and matching(op, o)})
                   for op in work.operations]
        count = 1
        for choices in options:
            count *= len(choices)
        feasible = False
        limited = count > 256
        if count and not limited:
            for combination in product(*options):
                searched += 1
                try:
                    state.capacity_ledger.preview_plan(work.key, reservations(combination))
                    feasible = True
                    break
                except CapacityBlocked:
                    continue
                except CapacityInputError:
                    uncertain.add(owner)
        status = ("FEASIBLE" if feasible else "UNKNOWN"
                  if limited or owner in uncertain or not complete.get(owner)
                  else "NO_FEASIBLE_IN_DECLARED_SCOPE")
        counts[status] += 1
    if not joint_feasible:
        status = "SELECTED_COOPERATIVE_PLAN_NOT_QUALIFIED"
    elif counts["FEASIBLE"]:
        status = "SINGLE_OWNER_ALTERNATIVE_EXISTS"
    elif counts["UNKNOWN"]:
        status = "SINGLE_OWNER_ALTERNATIVE_NOT_IDENTIFIABLE"
    else:
        status = "COOPERATIVE_PLAN_EXPANDS_DECLARED_FEASIBLE_ORDER_SET"
    # The expansion relative to a single enterprise is different from
    # exclusivity of the selected coalition. Check the remaining qualified
    # cross-owner combinations on the SAME capacity ledger without bookings.
    # Never conclude absence or minimality from a truncated search.
    choices = [sorted({o.resource for o in usable if matching(stage, o)})
               for stage in work.operations]
    combination_count = 1
    for alternatives in choices:
        combination_count *= len(alternatives)
    selection_owners = frozenset(state.resources[r] for r in selected)
    feasible_owner_sets = set()
    coalition_previews = 0
    alternative_resource_plans = 0
    complete_catalogue = all(complete.get(owner) and owner not in uncertain for owner in owners)
    bounded_search_complete = combination_count <= 256
    if joint_feasible:
        feasible_owner_sets.add(selection_owners)
    if bounded_search_complete:
        for combination in product(*choices):
            if combination == selected:
                continue
            coalition_previews += 1
            try:
                state.capacity_ledger.preview_plan(work.key, reservations(combination))
            except CapacityBlocked:
                continue
            except CapacityInputError:
                bounded_search_complete = False
                continue
            alternative_resource_plans += 1
            feasible_owner_sets.add(frozenset(state.resources[r] for r in combination))
    alternative_sets = feasible_owner_sets - {selection_owners}
    absence_qualified = bounded_search_complete and complete_catalogue
    competitor_status = ("ALTERNATIVE_OWNER_SET_EXISTS" if alternative_sets else
                         "NO_OTHER_OWNER_SET_IN_DECLARED_SCOPE" if absence_qualified else
                         "ALTERNATIVE_OWNER_SET_NOT_IDENTIFIABLE")
    minimal_sets = {candidate for candidate in feasible_owner_sets
                    if not any(other < candidate for other in feasible_owner_sets)}
    minimality = ("SELECTED_OWNER_SET_NOT_FEASIBLE" if not joint_feasible else
                  "SMALLER_FEASIBLE_SUBSET_EXISTS" if selection_owners not in minimal_sets else
                  "MINIMAL_IN_DECLARED_SCOPE" if absence_qualified else "NOT_IDENTIFIABLE")
    return {
        "status": status, "selected_cooperative_plan_preview_feasible": joint_feasible,
        "original_competing_owner_sets": {
            "status": competitor_status,
            "selected_owner_set_size": len(selection_owners),
            "observed_feasible_alternative_resource_plan_count": alternative_resource_plans,
            "observed_distinct_feasible_owner_set_count": len(feasible_owner_sets),
            "observed_minimal_feasible_owner_set_count": len(minimal_sets),
            "observed_minimum_feasible_owner_count": min(map(len, feasible_owner_sets), default=None),
            "selected_owner_set_minimality": minimality,
            "all_declared_combinations_examined": bounded_search_complete,
            "all_active_enterprise_catalogue_scopes_qualified": complete_catalogue,
            "qualified_absence_limited_to_declared_catalogues": True,
            "technical_preview_not_independent_willingness_or_agreement": True,
        },
        "original_declared_stage_count": len(work.operations),
        "registered_active_enterprise_count": len(owners),
        "single_owner_feasibility_counts": counts,
        "original_capacity_previews_attempted": searched + int(selected_preview_attempted) + coalition_previews,
        "buyer_compatibility_and_owner_scope_are_declared_not_physically_verified": True,
        "no_original_capacity_reserved_or_owner_consent_created": True,
        "actual_market_absence_or_additional_revenue_verified": False,
    }


def _review_bound_market_scope(state, work, event, proposal, at):
    original = proposal.get("technology_route_market_scope_fingerprint")
    supplied = event.get("technology_route_market_scope")
    if original is None:
        if supplied is not None:
            raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_PROPOSAL_REQUIRED")
        return {}
    if supplied is None or technology_route_fingerprint(supplied) != original:
        raise TechnologyRouteBlocked("MARKET_SCOPE_ORIGINAL_SOURCE_FINGERPRINT_MISMATCH")
    return {
        "technology_route_market_scope_fingerprint": original,
        "technology_route_market_feasibility": review_original_route_market_scope(state, work, supplied, at),
    }
