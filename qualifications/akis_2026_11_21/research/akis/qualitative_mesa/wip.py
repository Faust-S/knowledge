"""R1-W1: interrupted ORIGINAL Work and sourced unfinished production.

Every amendment remains inside one QualitativeAKIS Work, original trace and
CapacityLedger. MODEL_ONLY costs are attributed claims, not paid invoices,
ownership titles or bank transfers. No second Work, Result or material store.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import re
from typing import Any, Mapping

from .capacity import CapacityBlocked, ResourceNeed

MONEY = re.compile(r"(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,2})?\Z")
ACTIONS = frozenset({
    "wip_interrupt", "wip_propose", "wip_review", "wip_apply",
    "wip_cancel", "wip_resume", "wip_handoff_dispatch",
    "wip_handoff_receive", "wip_handoff_quality",
})
TERMS = {
    "total_units", "produced_units", "usable_units", "material_value",
    "handling_cost", "claim_amount", "inspection_ref", "claim_ref",
    "next_full_cost",
}
CENT = Decimal("0.01")


class WipBlocked(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def _fail(reason: str) -> None:
    raise WipBlocked(reason)


def _money(raw: Any, reason: str, *, positive: bool = False) -> Decimal:
    if not isinstance(raw, str) or MONEY.fullmatch(raw) is None:
        _fail(reason)
    value = Decimal(raw)
    if positive and value == 0:
        _fail(reason)
    return value


def _fmt(amount: Decimal) -> str:
    return str(amount.quantize(CENT))


def _source(raw: Any, owner: str, reason: str) -> str:
    prefix = f"model://{owner}/"
    if not isinstance(raw, str) or not raw.startswith(prefix) or (
        len(raw) <= len(prefix) or len(raw) > 180
    ):
        _fail(reason)
    return raw


def _original_source_revision(state: Any, ref: str, owner: str,
                              at: int) -> str | None:
    """Recheck current original-owner source, never mint an authorization.

    Exact revision fingerprints are captured at proposal and checked before
    application. ContextBasis itself remains the only authority for rights.
    """
    basis = state.context_basis
    if basis is None or not basis.strict:
        return None
    source = basis.sources.get(ref)
    if (source is None or source.owner != owner or
            source.status != "CONFIRMED" or owner not in source.usable_by or
            source.valid_until is not None and source.valid_until < at):
        _fail("WIP_ORIGINAL_EVIDENCE_SOURCE_UNAVAILABLE")
    return source.revision


def _check_source_snapshots(state: Any, revisions: Mapping[str, Any],
                            at: int) -> None:
    for ref, row in revisions.items():
        current = _original_source_revision(state, ref, row["owner"], at)
        if current != row["revision"]:
            _fail("WIP_ORIGINAL_EVIDENCE_SOURCE_REVISION_STALE")


def _original_transfer_link(state: Any, work: Any, owner: str,
                            target_owner: str, link_id: Any,
                            revision: Any) -> dict[str, str]:
    if not isinstance(link_id, str) or not isinstance(revision, str):
        _fail("WIP_ORIGINAL_COOPERATION_REVISION_REQUIRED")
    link = next((row for row in state.cooperation_links
                 if row.key == link_id), None)
    if (link is None or link.source_revision != revision or
            work.key not in link.works or
            not {owner, target_owner, work.customer}.issubset(link.participants)):
        _fail("WIP_ORIGINAL_COOPERATION_SOURCE_OR_PARTICIPANTS_CHANGED")
    return {"id": link.key, "revision": link.source_revision,
            "source_ref": link.source_ref}


def _reference(raw: Any, reason: str) -> str:
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 128:
        _fail(reason)
    return raw


def _exact(raw: Any, fields: set[str], reason: str) -> Mapping[str, Any]:
    if not isinstance(raw, dict) or set(raw) != fields:
        _fail(reason)
    return raw


def _qty(value: Any, reason: str, *, minimum: int = 0) -> int:
    if type(value) is not int or not minimum <= value <= 1_000_000:
        _fail(reason)
    return value


def _operation_context(state: Any, work: Any, ev: Mapping[str, Any],
                       action: str) -> Any | None:
    """Identify the original operation without rewriting its DAG."""
    if not work.operations:
        if ev.get("wip_operation") is not None or ev.get("wip_material_batch") is not None:
            _fail("WIP_DIRECT_WORK_HAS_NO_ORIGINAL_OPERATION")
        return None
    if not state.handoff_strict or not state.material_strict:
        _fail("WIP_OPERATION_REQUIRES_ORIGINAL_HANDOFF_AND_MATERIAL")
    key = ev.get("wip_operation")
    if not isinstance(key, str):
        _fail("WIP_ORIGINAL_OPERATION_ID_REQUIRED")
    op = next((row for row in work.operations if row.key == key), None)
    if op is None:
        _fail("WIP_UNKNOWN_ORIGINAL_OPERATION")
    if (len(op.resource_requirements) != 1 or
            op.resource_requirements[0].resource != op.primary_resource):
        _fail("WIP_OPERATION_MULTI_RESOURCE_ROUTE_REQUIRES_SEPARATE_QUALIFICATION")
    if action == "wip_interrupt":
        if (work.operation_states[key] != "IN_PROGRESS" or
                sum(x == "IN_PROGRESS" for x in work.operation_states.values()) != 1):
            _fail("WIP_ORIGINAL_OPERATION_NOT_EXCLUSIVELY_STARTED")
    else:
        latest = work.wip_interruptions[-1] if work.wip_interruptions else None
        if latest is None or latest.get("operation") != key:
            _fail("WIP_ORIGINAL_OPERATION_CHANGED")
    return op


def _operation_material(state: Any, work: Any, op: Any,
                        raw_batch: Any) -> dict[str, Any]:
    """Use one existing inbound QA and undispatched outbound MaterialBatch."""
    inbound = [row for row in work.material_batches if row.edge[1] == op.key]
    outgoing = [row for row in work.material_batches if row.edge[0] == op.key]
    if len(inbound) != 1 or len(outgoing) != 1:
        _fail("WIP_OPERATION_ONE_ORIGINAL_MATERIAL_STREAM_REQUIRED")
    in_batch, batch = inbound[0], outgoing[0]
    if (raw_batch != batch.key or in_batch.unit != batch.unit or
            in_batch.material != batch.material):
        _fail("WIP_ORIGINAL_MATERIAL_BATCH_OR_UNIT_MISMATCH")
    incoming = work.material_states[in_batch.key]
    outgoing_state = work.material_states[batch.key]
    if (incoming.accepted is None or
            incoming.accepted < in_batch.planned_quantity or
            incoming.received is None or
            incoming.received < in_batch.planned_quantity or
            incoming.quality_ref is None or incoming.receipt_ref is None):
        _fail("WIP_ORIGINAL_INBOUND_MATERIAL_NOT_QUALIFIED")
    if (outgoing_state.dispatched is not None or
            outgoing_state.received is not None or
            outgoing_state.accepted is not None):
        _fail("WIP_ORIGINAL_OUTBOUND_MATERIAL_ALREADY_DISPATCHED")
    if (batch.planned_quantity != in_batch.planned_quantity or
            batch.planned_quantity != batch.planned_quantity.to_integral_value()):
        _fail("WIP_OPERATION_MATERIAL_QUANTITIES_NOT_COMPARABLE")
    return {
        "batch": batch.key, "inbound_batch": in_batch.key,
        "material_id": batch.material, "unit": batch.unit,
        "planned_quantity": str(batch.planned_quantity),
        "outbound_edge": list(batch.edge), "inbound_edge": list(in_batch.edge),
        "declared_title_holder": batch.declared_title_holder,
        "origin_source_owner": batch.origin_source_owner,
        "origin_ref": batch.origin_ref,
        "quality_spec_owner": batch.quality_spec_owner,
        "quality_spec_ref": batch.quality_spec_ref,
        "inbound_receipt_ref": incoming.receipt_ref,
        "inbound_quality_ref": incoming.quality_ref,
        "inbound_receiver_owner": next(
            h.receiver for h in work.handoffs if h.edge == in_batch.edge
        ),
        "inbound_origin_ref": in_batch.origin_ref,
        "inbound_origin_source_owner": in_batch.origin_source_owner,
        "inbound_quality_spec_ref": in_batch.quality_spec_ref,
        "inbound_quality_spec_owner": in_batch.quality_spec_owner,
    }


def _current_executor(state: Any, work: Any, op: Any | None = None) -> tuple[str, str]:
    resource = (work.wip_active_resource or work.resource) if op is None else (
        work.wip_operation_active_resources.get(op.key, op.primary_resource)
    )
    return resource, state.resources[resource]


def fingerprint(document: Mapping[str, Any]) -> str:
    return hashlib.sha256(json.dumps(
        document, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")).hexdigest()


def _lot(state: Any, work: Any, raw: Any, prior: Mapping[str, Any],
         decision: str) -> dict[str, Any]:
    terms = _exact(raw, TERMS, "WIP_ORIGINAL_INSPECTION_FIELDS_REQUIRED")
    total = _qty(terms["total_units"], "WIP_TOTAL_UNITS_REQUIRED", minimum=1)
    if work.wip_amendments and total != work.wip_amendments[-1]["lot"]["remaining_units"]:
        _fail("WIP_LATEST_ATTEMPT_QUANTITY_MISMATCH")
    produced = _qty(terms["produced_units"], "WIP_PRODUCED_UNITS_INVALID")
    usable = _qty(terms["usable_units"], "WIP_USABLE_UNITS_INVALID")
    if not 0 <= usable <= produced <= total or usable == total:
        _fail("WIP_UNFINISHED_QUANTITY_REQUIRED")
    material = _money(terms["material_value"], "WIP_MATERIAL_VALUE_INVALID")
    handling = _money(terms["handling_cost"], "WIP_HANDLING_COST_INVALID")
    claim = _money(terms["claim_amount"], "WIP_RECOVERY_CLAIM_INVALID")
    future = _money(terms["next_full_cost"], "WIP_FUTURE_COST_INVALID",
                    positive=decision != "TERMINATE")
    prior_cost = Decimal(prior["prior_cost_claim"])
    # An inspected lot is not a complete Result; one physical unit cannot
    # simultaneously be used as completed output and a new resource.
    unit_credit = (future * usable / total).quantize(
        CENT, rounding=ROUND_HALF_UP,
    )
    credit = unit_credit + material
    if credit > prior_cost or credit > future:
        _fail("WIP_REUSE_EXCEEDS_ORIGINAL_OR_FUTURE_RESOURCE")
    if handling > prior_cost or claim > prior_cost - credit:
        _fail("WIP_DOUBLE_COUNTED_OR_UNBOUNDED_RECOVERY")
    original_owner = prior["owner"]
    inspection = terms["inspection_ref"]
    claim_source = terms["claim_ref"]
    if usable or material:
        _source(inspection, original_owner, "WIP_ORIGINAL_INSPECTION_SOURCE_REQUIRED")
        if any(row.get("inspection_ref") == inspection for row in work.wip_lots):
            _fail("WIP_INSPECTION_SOURCE_ALREADY_CONSUMED")
    elif inspection not in ("", None):
        _source(inspection, original_owner, "WIP_ORIGINAL_INSPECTION_SOURCE_REQUIRED")
    if claim:
        _source(claim_source, original_owner, "WIP_ORIGINAL_CLAIM_SOURCE_REQUIRED")
        if any(row.get("claim_ref") == claim_source for row in work.wip_lots):
            _fail("WIP_RECOVERY_SOURCE_ALREADY_USED")
    elif claim_source not in ("", None):
        _source(claim_source, original_owner, "WIP_ORIGINAL_CLAIM_SOURCE_REQUIRED")
    return {
        "total_units": total, "produced_units": produced,
        "usable_units": usable, "remaining_units": total - usable,
        "inspection_ref": inspection or None, "claim_ref": claim_source or None,
        "material_value": _fmt(material), "handling_cost": _fmt(handling),
        "claim_amount": _fmt(claim), "original_cost_claim": _fmt(prior_cost),
        "next_full_cost": _fmt(future),
        "unit_credit": _fmt(unit_credit), "reusable_resources": _fmt(credit),
        "future_resource_cost": _fmt(future - credit) if decision != "TERMINATE" else None,
        "reference_gain_vs_complete_redo": (
            _fmt(credit - handling) if decision != "TERMINATE" else None
        ),
        "cash_recovery": "NOT_RECORDED",
        "cost_origin": "SOURCE_DECLARED_NOT_CASH_VERIFIED",
    }


def _recheck_voters(state: Any, proposal: Mapping[str, Any], at: int) -> None:
    if set(proposal["votes"]) != set(proposal["required"]):
        _fail("WIP_INDEPENDENT_SUPPORT_MISSING")
    basis = state.context_basis
    for subject in proposal["required"]:
        vote = proposal["votes"].get(subject)
        if (not vote or vote["decision"] != "SUPPORT" or
                vote["at"] <= proposal["created_at"] or vote["at"] >= at or
                not state.subjects[subject].active):
            _fail("WIP_INDEPENDENT_SUPPORT_MISSING")
        _source(vote["source_ref"], subject, "WIP_VOTE_OWNER_SOURCE_INVALID")
        if (_original_source_revision(state, vote["source_ref"], subject, at)
                != vote["source_revision"]):
            _fail("WIP_ORIGINAL_VOTE_SOURCE_STALE")


def apply(state: Any, work: Any, ev: Mapping[str, Any], at: int) -> dict[str, Any]:
    action, actor = ev["action"], ev["actor"]
    if action not in ACTIONS:
        _fail("WIP_UNKNOWN_ACTION")
    op = _operation_context(state, work, ev, action)
    if (work.obligation != "ACCEPTED_BY_ORIGINAL_PRINCIPALS" or
            work.result != "NOT_SUBMITTED"):
        _fail("WIP_REQUIRES_ORIGINAL_OPEN_OBLIGATION")
    if ev.get("source_revision") != work.source_revision:
        _fail("WIP_ORIGINAL_WORK_SOURCE_STALE")
    if ev.get("org_revision") != state.institution.revision:
        _fail("WIP_ORIGINAL_ORG_REVISION_STALE")
    resource, owner = _current_executor(state, work, op)
    if action == "wip_interrupt":
        if actor != owner or work.execution != "IN_PROGRESS":
            _fail("WIP_STARTED_ORIGINAL_EXECUTOR_REQUIRED")
        if state.resource_availability[resource] != "UNAVAILABLE":
            _fail("WIP_REQUIRES_ORIGINAL_RESOURCE_LOSS")
        prior_cost = _money(ev.get("prior_cost_claim"),
                            "WIP_PRIOR_COST_SOURCE_AMOUNT_REQUIRED", positive=True)
        source = _source(ev.get("cost_source_ref"), actor,
                         "WIP_ORIGINAL_COST_SOURCE_REQUIRED")
        source_revision = _original_source_revision(state, source, actor, at)
        if any(p["cost_source_ref"] == source for p in work.wip_interruptions):
            _fail("WIP_PRIOR_COST_SOURCE_ALREADY_USED")
        # A repeated interruption must refer to the exact most recent redo
        # declared cost, without reclassifying an older spent attempt.
        if work.wip_amendments:
            latest = work.wip_amendments[-1]
            if (latest["decision"] == "TERMINATE" or
                    _fmt(prior_cost) != latest["lot"]["future_resource_cost"]):
                _fail("WIP_LATEST_ATTEMPT_COST_MISMATCH")
        material = (_operation_material(
            state, work, op, ev.get("wip_material_batch")
        ) if op is not None else None)
        pause = {
            "number": len(work.wip_interruptions) + 1,
            "at": at, "resource": resource, "owner": actor,
            "cost_source_ref": source, "cost_source_revision": source_revision,
            "prior_cost_claim": _fmt(prior_cost), "state": "PAUSED",
            "operation": op.key if op else None, "material": material,
        }
        work.wip_interruptions.append(pause)
        if op is not None:
            work.operation_states[op.key] = "PAUSED"
        work.execution = "PAUSED"
        return {"wip_phase": "INTERRUPTED", "wip_attempt": pause["number"],
                "original_resource_cost_claim": pause["prior_cost_claim"]}
    pause = work.wip_interruptions[-1] if work.wip_interruptions else None
    if pause is None or work.execution != "PAUSED":
        _fail("WIP_ORIGINAL_INTERRUPTION_REQUIRED")
    if action == "wip_propose":
        if actor != work.customer or work.wip_proposal is not None:
            _fail("WIP_CUSTOMER_OR_OPEN_PROPOSAL_REQUIRED")
        if ev.get("work_interruption_at") != pause["at"]:
            _fail("WIP_LATEST_INTERRUPTION_REQUIRED")
        decision = ev.get("wip_decision")
        if decision not in {"TRANSFER", "REWORK", "TERMINATE"}:
            _fail("WIP_DECISION_INVALID")
        source = _source(ev.get("wip_source_ref"), actor,
                         "WIP_CUSTOMER_PROPOSAL_SOURCE_REQUIRED")
        source_revision = _original_source_revision(state, source, actor, at)
        proposal_id = _reference(ev.get("wip_id"), "WIP_AMENDMENT_ID_REQUIRED")
        if (any(row["id"] == proposal_id for row in work.wip_amendments) or
                any(row.get("wip_id") == proposal_id and
                    row.get("action") == "wip_propose" and
                    row.get("outcome") == "APPLIED" for row in state.trace)):
            _fail("WIP_AMENDMENT_ALREADY_APPLIED")
        expiry = ev.get("wip_valid_until")
        if type(expiry) is not int or not at < expiry <= 10000:
            _fail("WIP_VALID_REVIEW_WINDOW_REQUIRED")
        new_resource = ev.get("wip_target_resource")
        collaboration = None
        if decision == "TERMINATE":
            if new_resource is not None:
                _fail("WIP_TERMINATION_CANNOT_ASSIGN_EXECUTOR")
            target_owner = None
            next_window = None
            capacity_units = 0
        else:
            if not isinstance(new_resource, str) or new_resource not in state.resources:
                _fail("WIP_ORIGINAL_TARGET_RESOURCE_REQUIRED")
            target_owner = state.resources[new_resource]
            if ((decision == "TRANSFER") != (target_owner != owner)):
                _fail("WIP_TRANSFER_MUST_CHANGE_ORIGINAL_ENTERPRISE")
            if not state.subjects[target_owner].active:
                _fail("WIP_NEW_EXECUTOR_UNAVAILABLE")
            if state.resource_specs[new_resource].basis != "MODEL_DECLARED":
                _fail("WIP_EXPLICIT_ORIGINAL_CAPACITY_REQUIRED")
            if decision == "TRANSFER":
                collaboration = _original_transfer_link(
                    state, work, owner, target_owner,
                    ev.get("wip_cooperation_link"),
                    ev.get("wip_cooperation_revision"),
                )
            start, end = ev.get("wip_slot_start"), ev.get("wip_slot_end")
            if (type(start) is not int or type(end) is not int or
                    not max(at, work.slot_end) <= start < end):
                _fail("WIP_NEW_PLANNED_WINDOW_REQUIRED")
            capacity_units = _qty(ev.get("wip_capacity_units"),
                                  "WIP_CAPACITY_UNITS_REQUIRED", minimum=1)
            next_window = [start, end]
        lot = _lot(state, work, ev.get("wip_terms"), pause, decision)
        material = None
        if op is not None:
            material = _operation_material(
                state, work, op, ev.get("wip_material_batch")
            )
            if material != pause["material"]:
                _fail("WIP_ORIGINAL_MATERIAL_SOURCE_CHANGED")
            if lot["total_units"] > int(material["planned_quantity"]):
                _fail("WIP_OPERATION_EXCEEDS_ORIGINAL_BATCH_QUANTITY")
            if (not work.wip_amendments and
                    lot["total_units"] != int(material["planned_quantity"])):
                _fail("WIP_FIRST_OPERATION_ATTEMPT_MUST_COVER_ORIGINAL_BATCH")
            if decision != "TERMINATE":
                old_spec = state.resource_specs[resource]
                new_spec = state.resource_specs[new_resource]
                if (new_spec.unit != old_spec.unit or
                        new_spec.site is None):
                    _fail("WIP_OPERATION_RESOURCE_UNIT_OR_SITE_MISMATCH")
            if (work.assurance_criteria and
                    any(criterion.operation == op.key
                        for criterion in work.assurance_criteria) and
                    decision == "TRANSFER"):
                _fail("WIP_OPERATION_ASSURANCE_RESPONSIBILITY_REQUIRES_NEW_REVIEW")
        if decision == "TERMINATE" and lot["future_resource_cost"] is not None:
            _fail("WIP_TERMINATION_HAS_NO_NEXT_EXECUTION")
        required_owners = {owner, work.customer} | ({target_owner} if target_owner else set())
        if material is not None:
            required_owners |= {
                material["declared_title_holder"],
                material["origin_source_owner"],
                material["quality_spec_owner"],
                material["inbound_origin_source_owner"],
                material["inbound_quality_spec_owner"],
                material["inbound_receiver_owner"],
            }
            required_owners |= {
                h.receiver for h in work.handoffs if h.upstream == op.key
            }
        required = sorted(required_owners)
        evidence = [(pause["cost_source_ref"], owner),
                    (source, work.customer)]
        for key in ("inspection_ref", "claim_ref"):
            if lot[key]:
                evidence.append((lot[key], owner))
        if material is not None:
            evidence.extend((
                (material["origin_ref"], material["origin_source_owner"]),
                (material["quality_spec_ref"], material["quality_spec_owner"]),
                (material["inbound_origin_ref"], material["inbound_origin_source_owner"]),
                (material["inbound_quality_spec_ref"], material["inbound_quality_spec_owner"]),
                (material["inbound_receipt_ref"], material["inbound_receiver_owner"]),
                (material["inbound_quality_ref"], material["inbound_receiver_owner"]),
            ))
        if len({ref for ref, _ in evidence}) != len(evidence):
            _fail("WIP_ORIGINAL_EVIDENCE_REFERENCES_MUST_BE_DISTINCT")
        snapshots = {
            ref: {"owner": subject,
                  "revision": _original_source_revision(state, ref, subject, at)}
            for ref, subject in evidence
        }
        if snapshots[pause["cost_source_ref"]]["revision"] != pause["cost_source_revision"]:
            _fail("WIP_ORIGINAL_INTERRUPTION_COST_SOURCE_CHANGED")
        doc = {
            "id": proposal_id, "work": work.key, "decision": decision,
            "original_resource": resource, "target_resource": new_resource,
            "work_source_revision": work.source_revision,
            "org_revision": state.institution.revision,
            "interruption_at": pause["at"], "cost_source_ref": pause["cost_source_ref"],
            "owner": owner, "lot": lot, "capacity_units": capacity_units,
            "next_window": next_window, "proposal_source": source,
            "proposal_source_revision": source_revision,
            "source_revisions": snapshots, "cooperation": collaboration,
            "operation": op.key if op else None, "material": material,
        }
        proposal = {
            **doc, "fingerprint": fingerprint(doc), "created_at": at,
            "valid_until": expiry, "required": required, "votes": {},
        }
        work.wip_proposal = proposal
        return {"wip_phase": "PROPOSED", "wip_id": proposal_id,
                "wip_fingerprint": proposal["fingerprint"],
                "wip_reviewers": required, "wip_lot": lot}
    proposal = work.wip_proposal
    if action in {"wip_handoff_dispatch", "wip_handoff_receive",
                  "wip_handoff_quality"}:
        if op is None:
            _fail("WIP_HANDOFF_REQUIRES_ORIGINAL_OPERATION")
        latest = work.wip_amendments[-1] if work.wip_amendments else None
        if (latest is None or latest["interruption_at"] != pause["at"] or
                latest["decision"] != "TRANSFER" or
                latest["operation"] != op.key or proposal is not None or
                ev.get("wip_id") != latest["id"]):
            _fail("WIP_APPROVED_OPERATION_TRANSFER_REQUIRED")
        lot = work.wip_lots[-1]
        if ev.get("wip_material_batch") != latest["material"]["batch"]:
            _fail("WIP_MATERIAL_HANDOFF_BATCH_MISMATCH")
        _check_source_snapshots(state, latest["source_revisions"], at)
        _recheck_voters(state, latest, at)
        source = _source(ev.get("wip_source_ref"), actor,
                         "WIP_CUSTODY_OWN_SOURCE_REQUIRED")
        _original_source_revision(state, source, actor, at)
        refs = {lot.get("custody_dispatch_ref"), lot.get("custody_receipt_ref"),
                lot.get("custody_quality_ref")}
        if (source in refs or
                source in work.operation_evidence.values() or
                source == work.result_ref or
                any(source in entry.values() for entry in work.handoff_evidence.values()) or
                any(source in (state.dispatch_ref, state.receipt_ref,
                               state.quality_ref)
                    for state in work.material_states.values()) or
                any(source in (
                    prior.get("inspection_ref"), prior.get("claim_ref"),
                    prior.get("custody_dispatch_ref"), prior.get("custody_receipt_ref"),
                    prior.get("custody_quality_ref")
                ) for prior in work.wip_lots)):
            _fail("WIP_CUSTODY_SOURCE_ALREADY_USED")
        if lot["status"] != "RESERVED":
            _fail("WIP_CUSTODY_ONLY_RESERVED_MATERIAL")
        phase = lot.get("custody_state")
        if action == "wip_handoff_dispatch":
            if actor != pause["owner"] or phase != "AWAITING_DISPATCH":
                _fail("WIP_ORIGINAL_MATERIAL_SENDER_REQUIRED")
            lot["custody_state"] = "DISPATCHED"
            lot["custody_dispatch_ref"] = source
        elif action == "wip_handoff_receive":
            if (actor != state.resources[latest["target_resource"]] or
                    phase != "DISPATCHED" or
                    ev.get("wip_dispatch_ref") != lot.get("custody_dispatch_ref")):
                _fail("WIP_ORIGINAL_MATERIAL_RECEIVER_OR_DISPATCH_REQUIRED")
            lot["custody_state"] = "RECEIVED"
            lot["custody_receipt_ref"] = source
            lot["holder"] = actor
        else:
            if (actor != state.resources[latest["target_resource"]] or
                    phase != "RECEIVED" or
                    ev.get("wip_receipt_ref") != lot.get("custody_receipt_ref")):
                _fail("WIP_MATERIAL_RECEIPT_AND_RECEIVER_QUALITY_REQUIRED")
            accepted = _qty(ev.get("wip_accepted_units"),
                            "WIP_QUALITY_ACCEPTED_UNITS_REQUIRED")
            if accepted != lot["usable_units"]:
                _fail("WIP_REVISED_MATERIAL_QUALITY_REQUIRES_NEW_CONSENT")
            lot["custody_state"] = "QUALITY_ACCEPTED"
            lot["custody_quality_ref"] = source
        return {
            "wip_phase": lot["custody_state"], "wip_id": latest["id"],
            "wip_operation": op.key, "wip_material_batch": lot["material_batch"],
            "title_not_transferred": True,
            "external_delivery_not_authenticated": True,
        }
    if action == "wip_cancel":
        if proposal is None or actor != work.customer:
            _fail("WIP_ONLY_ORIGINAL_CUSTOMER_CAN_CANCEL")
        _source(ev.get("wip_source_ref"), actor,
                "WIP_CANCELLATION_SOURCE_REQUIRED")
        work.wip_proposal = None
        return {"wip_phase": "CANCELLED", "wip_id": proposal["id"]}
    if action == "wip_resume":
        latest = work.wip_amendments[-1] if work.wip_amendments else None
        if (proposal is not None or latest is None or
                latest["interruption_at"] != pause["at"] or
                latest["decision"] == "TERMINATE" or
                actor != state.resources[latest["target_resource"]]):
            _fail("WIP_APPROVED_NEW_EXECUTOR_REQUIRED")
        _source(ev.get("wip_source_ref"), actor,
                "WIP_EXECUTOR_RESUME_SOURCE_REQUIRED")
        _original_source_revision(
            state, ev["wip_source_ref"], actor, at
        )
        if op is not None:
            _check_source_snapshots(state, latest["source_revisions"], at)
            _recheck_voters(state, latest, at)
        start, end = latest["next_window"]
        if not start <= at < end:
            _fail("WIP_RESUME_OUTSIDE_APPROVED_WINDOW")
        if state.resource_availability[latest["target_resource"]] != "AVAILABLE":
            _fail("WIP_NEW_EXECUTOR_RESOURCE_NOT_AVAILABLE")
        if state.capacity_ledger.is_work_at_risk(
                work.key, outstanding=state._outstanding_work_ids()
        ) is not None:
            _fail("WIP_SOURCE_DECLARED_RESOURCE_OVERBOOKED")
        lot = work.wip_lots[-1]
        expected_holder = pause["owner"]
        if op is not None and latest["decision"] == "TRANSFER":
            expected_holder = actor
            if (lot.get("custody_state") != "QUALITY_ACCEPTED" or
                    not lot.get("custody_quality_ref")):
                _fail("WIP_ORIGINAL_PHYSICAL_CUSTODY_QUALITY_REQUIRED")
        if (lot["amendment"] != latest["id"] or lot["status"] != "RESERVED" or
                lot["holder"] != expected_holder):
            _fail("WIP_RESERVED_LOT_MUST_REMAIN_WITH_ORIGINAL_HOLDER")
        if op is not None and work.operation_states[op.key] != "PAUSED":
            _fail("WIP_ORIGINAL_OPERATION_NO_LONGER_PAUSED")
        lot["status"] = "CONSUMED"
        lot["holder"] = actor
        lot["used_at"] = at
        if op is not None:
            work.operation_states[op.key] = "IN_PROGRESS"
        work.execution = "IN_PROGRESS"
        return {"wip_phase": "RESUMED", "wip_id": latest["id"],
                "wip_lot_status": "CONSUMED", "original_work_preserved": True}
    if proposal is None:
        _fail("WIP_NO_OPEN_ORIGINAL_PROPOSAL")
    if (ev.get("wip_id") != proposal["id"] or
            ev.get("wip_fingerprint") != proposal["fingerprint"] or
            proposal["interruption_at"] != pause["at"] or
            not proposal["created_at"] < at < proposal["valid_until"]):
        _fail("WIP_SOURCE_OR_DECISION_WINDOW_STALE")
    if action == "wip_review":
        if actor not in proposal["required"] or actor in proposal["votes"]:
            _fail("WIP_INDEPENDENT_REVIEWER_REQUIRED")
        decision = ev.get("wip_position")
        if decision not in {"SUPPORT", "OBJECT"}:
            _fail("WIP_REVIEW_POSITION_REQUIRED")
        source = _source(ev.get("wip_source_ref"), actor,
                         "WIP_INDEPENDENT_REVIEW_SOURCE_REQUIRED")
        item = {"decision": decision, "source_ref": source, "at": at,
                "source_revision": None}
        item["source_revision"] = _original_source_revision(
            state, source, actor, at
        )
        proposal["votes"][actor] = item
        return {"wip_phase": "REVIEWED", "wip_id": proposal["id"],
                "wip_position": decision, "independent_subject": actor}
    if action != "wip_apply" or actor != work.customer:
        _fail("WIP_ONLY_ORIGINAL_CUSTOMER_CAN_APPLY")
    applied_source = _source(
        ev.get("wip_source_ref"), actor, "WIP_APPLY_SOURCE_REQUIRED"
    )
    _original_source_revision(state, applied_source, actor, at)
    _check_source_snapshots(state, proposal["source_revisions"], at)
    if op is not None:
        material = _operation_material(
            state, work, op, proposal["material"]["batch"]
        )
        if material != proposal["material"]:
            _fail("WIP_ORIGINAL_MATERIAL_CHANGED_AFTER_CONSENT")
        if work.operation_states[op.key] != "PAUSED":
            _fail("WIP_ORIGINAL_OPERATION_CHANGED_AFTER_CONSENT")
    if (proposal["org_revision"] != state.institution.revision or
            proposal["work_source_revision"] != work.source_revision):
        _fail("WIP_PROPOSAL_ORIGINAL_REVISION_CHANGED")
    _recheck_voters(state, proposal, at)
    target = proposal["target_resource"]
    if proposal["decision"] == "TRANSFER":
        collaboration = proposal["cooperation"]
        actual = _original_transfer_link(
            state, work, proposal["owner"],
            state.resources[target], collaboration["id"],
            collaboration["revision"],
        )
        if actual != collaboration:
            _fail("WIP_COOPERATION_ORIGINAL_SOURCE_CHANGED")
    if target is not None:
        if (state.resource_availability[target] != "AVAILABLE" or
                not state.subjects[state.resources[target]].active):
            _fail("WIP_TARGET_RESOURCE_NO_LONGER_AVAILABLE")
        start, end = proposal["next_window"]
        if start < at:
            _fail("WIP_APPLY_CANNOT_RESERVE_EXPIRED_WINDOW")
        needs = (ResourceNeed(target, proposal["capacity_units"]),)
        try:
            state.capacity_ledger.preview_amendment(work.key, needs, start, end)
        except CapacityBlocked as exc:
            _fail("WIP_ORIGINAL_CAPACITY_CONFLICT:" + exc.reason)
    else:
        needs = ()
    if target is not None:
        # Reserve on the SAME original ledger, after all source/vote checks.
        state.capacity_ledger.reserve_amendment(work.key, needs, start, end)
        state.allocations.append((target, work.key, start, end))
        if op is None:
            work.wip_active_resource = target
        else:
            work.wip_operation_active_resources[op.key] = target
    lot = {
        **proposal["lot"], "amendment": proposal["id"],
        "source_owner": pause["owner"], "holder": pause["owner"],
        "target_holder": state.resources[target] if target is not None else None,
        "status": "HELD" if target is None else "RESERVED",
        "consumed_by": None, "used_at": None, "applied_at": at,
        "cash_recovery_claim": "PENDING_NOT_CASH" if
            Decimal(proposal["lot"]["claim_amount"]) else "NONE",
        "operation": op.key if op else None,
        "material_batch": proposal["material"]["batch"] if op is not None else None,
        "original_material": proposal["material"],
        "custody_state": (
            "AWAITING_DISPATCH" if op is not None and
            proposal["decision"] == "TRANSFER" else "NO_NEW_HANDOFF"
        ),
        "custody_dispatch_ref": None, "custody_receipt_ref": None,
        "custody_quality_ref": None,
    }
    amendment = {
        **{k: v for k, v in proposal.items() if k != "votes"},
        "votes": {k: dict(v) for k, v in proposal["votes"].items()},
        "applied_at": at,
        "status": "APPLIED",
        "source_agreement_is_not_bank_payment": True,
    }
    work.wip_lots.append(lot)
    work.wip_amendments.append(amendment)
    work.wip_proposal = None
    pause["state"] = "AMENDED"
    if target is None:
        work.execution = "STOPPED"
        if op is not None:
            work.operation_states[op.key] = "STOPPED"
    return {
        "wip_phase": "APPLIED", "wip_id": amendment["id"],
        "wip_decision": amendment["decision"], "wip_lot_status": lot["status"],
        "wip_reuse_credited": proposal["lot"]["reusable_resources"],
        "wip_new_cost_claim": proposal["lot"]["future_resource_cost"],
        "prior_original_obligation_preserved": True,
        "real_payment_authorized": False,
    }
