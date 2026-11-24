"""Work-specific original quality assurance inside one existing AKIS Work/Result.

Research MODEL_ONLY assertions are not laboratory measurements, accredited
certification, legal liability, a new Result, or proof of economic savings.
Original independent recipient assesses declared criteria against the current
submitted Result; any new submission needs fresh assessments.
"""
from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy

from .capacity import CapacityBlocked, ResourceNeed, Reservation
from .material import MaterialState, material_view, assert_inbound_ready
from .wip import fingerprint, _money, _fmt, assert_assurance_responsibility_current
from typing import Any, Mapping, Sequence


class AssuranceInputError(ValueError):
    pass


class AssuranceBlocked(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


DIMENSIONS = frozenset({
    "DELIVERABLE_CONFORMITY", "PROCESS_SAFETY", "DOCUMENTATION",
    "DELIVERY_TIMELINESS", "MATERIAL_CONFORMITY", "SERVICE_LEVEL",
})
METHODS = frozenset({"INSPECTION", "MEASUREMENT", "FUNCTIONAL_TEST",
                     "DOCUMENT_REVIEW", "OBSERVATION"})


@dataclass(frozen=True)
class QualityCriterion:
    key: str
    dimension: str
    operation: str
    responsible_owner: str
    assessor: str
    method: str
    source_ref: str
    source_revision: str


def _identifier(value: Any, error: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise AssuranceInputError(error)
    return value


def parse_criteria(raw: Any, *, customer: str, primary_resource: str,
                   work_revision: str, operations: Sequence[Any],
                   resource_owners: Mapping[str, str]) -> tuple[QualityCriterion, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list) or not 1 <= len(raw) <= 32:
        raise AssuranceInputError("QUALITY_CRITERIA_REQUIRED_NONEMPTY_LIST")
    operations_by_id = {op.key: op for op in operations}
    seen: set[str] = set()
    result: list[QualityCriterion] = []
    fields = {"id", "dimension", "operation", "responsible_owner",
              "assessor", "method", "source_ref", "source_revision"}
    for item in raw:
        if not isinstance(item, dict) or set(item) != fields:
            raise AssuranceInputError("QUALITY_CRITERION_FIELDS_INVALID")
        key = _identifier(item["id"], "QUALITY_CRITERION_ID_INVALID")
        if key in seen:
            raise AssuranceInputError("QUALITY_CRITERION_DUPLICATE")
        seen.add(key)
        dimension = item["dimension"]
        if not isinstance(dimension, str) or dimension not in DIMENSIONS:
            raise AssuranceInputError("QUALITY_DIMENSION_INVALID")
        operation = _identifier(item["operation"], "QUALITY_OPERATION_INVALID")
        if operation != "WORK" and operation not in operations_by_id:
            raise AssuranceInputError("QUALITY_ORIGINAL_OPERATION_REQUIRED")
        if operation == "WORK":
            original_owner = resource_owners[primary_resource]
        else:
            original_owner = resource_owners[operations_by_id[operation].primary_resource]
        responsible = _identifier(item["responsible_owner"],
                                  "QUALITY_RESPONSIBLE_ORIGINAL_OWNER_REQUIRED")
        if responsible != original_owner:
            raise AssuranceInputError("QUALITY_RESPONSIBLE_ORIGINAL_OWNER_REQUIRED")
        assessor = _identifier(item["assessor"], "QUALITY_RECIPIENT_ASSESSOR_REQUIRED")
        if assessor != customer:
            raise AssuranceInputError("QUALITY_RECIPIENT_ASSESSOR_REQUIRED")
        if item["method"] not in METHODS:
            raise AssuranceInputError("QUALITY_VERIFICATION_METHOD_INVALID")
        source = item["source_ref"]
        if (not isinstance(source, str)
                or not source.startswith(f"model://{customer}/")
                or len(source) <= len(f"model://{customer}/") or len(source) > 180):
            raise AssuranceInputError("QUALITY_RECIPIENT_SOURCE_REQUIRED")
        if item["source_revision"] != work_revision:
            raise AssuranceInputError("QUALITY_WORK_SOURCE_REVISION_MISMATCH")
        result.append(QualityCriterion(
            key, dimension, operation, responsible, assessor,
            item["method"], source, work_revision,
        ))
    return tuple(sorted(result, key=lambda x: x.key))


def assess_result_quality(work: Any, event: Mapping[str, Any], *,
                          state: Any = None, at: int = 0) -> None:
    if not work.assurance_criteria:
        raise AssuranceBlocked("QUALITY_CRITERIA_NOT_DECLARED")
    if work.result != "SUBMITTED" or not work.result_ref:
        raise AssuranceBlocked("QUALITY_SUBMITTED_RESULT_REQUIRED")
    criterion = next((c for c in work.assurance_criteria
                      if c.key == event.get("criterion")), None)
    if criterion is None:
        raise AssuranceBlocked("QUALITY_CRITERION_NOT_FOUND")
    if event.get("actor") != criterion.assessor:
        raise AssuranceBlocked("QUALITY_ORIGINAL_RECIPIENT_REQUIRED")
    if event.get("source_revision") != work.source_revision:
        raise AssuranceBlocked("QUALITY_WORK_SOURCE_REVISION_STALE")
    if event.get("org_revision") != work.commitment_org_revision:
        raise AssuranceBlocked("QUALITY_ORIGINAL_COMMITMENT_CODE_REQUIRED")
    if event.get("result_ref") != work.result_ref:
        raise AssuranceBlocked("QUALITY_SUBMITTED_RESULT_REVISION_MISMATCH")
    responsibility = work.assurance_responsibilities.get(criterion.key)
    if responsibility is not None:
        if event.get("quality_expected_responsible_owner") != responsibility["effective_owner"]:
            raise AssuranceBlocked("QUALITY_EFFECTIVE_RESPONSIBLE_OWNER_REQUIRED")
        if event.get("quality_responsibility_revision") != responsibility["wip_id"]:
            raise AssuranceBlocked("QUALITY_EFFECTIVE_RESPONSIBILITY_REVISION_REQUIRED")
        if responsibility["assessor"] != criterion.assessor:
            raise AssuranceBlocked("QUALITY_ORIGINAL_ASSESSOR_CHANGED")
    elif ("quality_expected_responsible_owner" in event or
          "quality_responsibility_revision" in event):
        raise AssuranceBlocked("QUALITY_UNCHANGED_CRITERION_CANNOT_INFER_NEW_RESPONSIBILITY")
    verdict = event.get("quality_verdict")
    if not isinstance(verdict, str) or verdict not in {"MEETS_DECLARED_REQUIREMENT", "DOES_NOT_MEET"}:
        raise AssuranceBlocked("QUALITY_ASSESSMENT_VERDICT_INVALID")
    reference = event.get("quality_evidence_ref")
    if (not isinstance(reference, str) or
            not reference.startswith(f"model://{criterion.assessor}/")
            or len(reference) <= len(f"model://{criterion.assessor}/")
            or len(reference) > 180):
        raise AssuranceBlocked("QUALITY_INDEPENDENT_MODEL_EVIDENCE_REQUIRED")
    if (reference == work.result_ref or
            reference in work.assurance_refs or
            reference in work.operation_evidence.values()):
        raise AssuranceBlocked("QUALITY_UNIQUE_EVIDENCE_REQUIRED")
    previous = work.assurance_reviews.get(criterion.key)
    same_result = previous is not None and previous["result_ref"] == work.result_ref
    change_fields = {"quality_reassessment_of", "quality_reassessment_reason",
                     "quality_reassessment_ref"}
    correction = None
    if same_result:
        if not change_fields.issubset(event):
            raise AssuranceBlocked("QUALITY_EXPLICIT_REASSESSMENT_REQUIRED")
        if (event["quality_reassessment_of"] != previous["model_ref"] or
                not isinstance(event["quality_reassessment_reason"], str) or
                event["quality_reassessment_reason"] not in {
                    "MEASUREMENT_ERROR", "TRANSCRIPTION_ERROR"
                }):
            raise AssuranceBlocked("QUALITY_REASSESSMENT_ORIGINAL_ACT_AND_REASON_REQUIRED")
        error_ref = event["quality_reassessment_ref"]
        if error_ref == reference or _ref_used(work, error_ref):
            raise AssuranceBlocked("QUALITY_REASSESSMENT_NEW_ERROR_SOURCE_REQUIRED")
        error_revision = _owned_source(state, error_ref, criterion.assessor, at)
        new_revision = _owned_source(state, reference, criterion.assessor, at)
        correction = {
            "of": previous["model_ref"],
            "reason": event["quality_reassessment_reason"],
            "error_ref": error_ref, "error_source_revision": error_revision,
            "assessment_source_revision": new_revision,
            "physical_reexecution": False,
        }
    elif change_fields.intersection(event):
        raise AssuranceBlocked("QUALITY_REASSESSMENT_CURRENT_PRIOR_ACT_REQUIRED")
    if _ref_used(work, reference):
        raise AssuranceBlocked("QUALITY_UNIQUE_EVIDENCE_REQUIRED")
    physical = next((r for r in reversed(work.assurance_corrections)
                     if r.get("resubmitted_result_ref") == work.result_ref), None)
    assessment_revision = None
    if physical is not None:
        assessment_revision = _owned_source(state, reference, criterion.assessor, at)
    if state is not None and (same_result or physical is not None):
        _require(not any(_ref_used(other, reference)
                         for other in state.works.values()),
                 "QUALITY_UNIQUE_EVIDENCE_REQUIRED")
        if correction is not None:
            _require(not any(_ref_used(other, correction["error_ref"])
                             for other in state.works.values()),
                     "QUALITY_REASSESSMENT_NEW_ERROR_SOURCE_REQUIRED")
    # All checks before mutation. Keep each act, including negative acts,
    # in the SAME Work; the current review is only a projection.
    work.assurance_refs.add(reference)
    if correction is not None:
        work.assurance_refs.add(correction["error_ref"])
    review = {
        "result_ref": work.result_ref, "work_revision": work.source_revision,
        "commitment_org_revision": work.commitment_org_revision,
        "verdict": verdict, "model_ref": reference,
    }
    if responsibility is not None:
        review["effective_responsible_owner"] = responsibility["effective_owner"]
        review["responsibility_revision"] = responsibility["wip_id"]
    if correction is not None:
        review["reassessment"] = correction
    if physical is not None:
        review["physical_correction_id"] = physical["terms"]["id"]
        review["assessment_source_revision"] = assessment_revision
    work.assurance_reviews[criterion.key] = review
    work.assurance_review_history.append({
        "criterion": criterion.key, "at": at, **deepcopy(review),
    })


def acceptance_gate(work: Any) -> str:
    if not work.assurance_criteria:
        return "NONE"
    for criterion in work.assurance_criteria:
        evidence = work.assurance_reviews.get(criterion.key)
        if (not evidence or evidence["result_ref"] != work.result_ref
                or evidence["work_revision"] != work.source_revision
                or evidence["commitment_org_revision"] != work.commitment_org_revision):
            return "QUALITY_ORIGINAL_ASSESSMENT_MISSING"
        responsibility = work.assurance_responsibilities.get(criterion.key)
        if responsibility is not None and (
                evidence.get("effective_responsible_owner") != responsibility["effective_owner"]
                or evidence.get("responsibility_revision") != responsibility["wip_id"]):
            return "QUALITY_EFFECTIVE_RESPONSIBILITY_ASSESSMENT_STALE"
        if evidence["verdict"] != "MEETS_DECLARED_REQUIREMENT":
            return "QUALITY_DECLARED_CRITERION_FAILED"
    return "NONE"


def assurance_view(work: Any) -> dict[str, Any]:
    entries = []
    for c in work.assurance_criteria:
        review = work.assurance_reviews.get(c.key)
        responsibility = work.assurance_responsibilities.get(c.key)
        fresh = bool(
            review and work.result_ref and review["result_ref"] == work.result_ref
            and review["work_revision"] == work.source_revision
            and review["commitment_org_revision"] == work.commitment_org_revision
            and (responsibility is None or (
                review.get("effective_responsible_owner") == responsibility["effective_owner"]
                and review.get("responsibility_revision") == responsibility["wip_id"]
            ))
        )
        status = ("MODEL_ONLY_REPORTED_MEETS" if fresh and
                  review["verdict"] == "MEETS_DECLARED_REQUIREMENT" else
                  "MODEL_ONLY_REPORTED_DOES_NOT_MEET" if fresh else
                  "UNQUALIFIED_FOR_CURRENT_OR_UNSUBMITTED_RESULT")
        entries.append({
            "criterion": c.key, "dimension": c.dimension,
            "operation": c.operation, "responsible_original_owner": c.responsible_owner,
            "assessor_original_recipient": c.assessor,
            "verification_method_declared": c.method, "status": status,
            "original_source_revision": c.source_revision,
            "effective_future_execution_owner": (
                responsibility["effective_owner"] if responsibility else c.responsible_owner
            ),
            "effective_responsibility_revision": (
                responsibility["wip_id"] if responsibility else None
            ),
            "responsibility_scope": (
                responsibility["scope"] if responsibility else "ORIGINAL_CRITERION"
            ),
            "original_responsibility_history_preserved": True,
            "recipient_assessor_unchanged": True,
            "legal_liability_created": False,
            "actual_measurement_independently_verified": False,
        })
    return {
        "evidence": "MODEL_ONLY_UNAUTHENTICATED",
        "assessment_history": deepcopy(work.assurance_review_history),
        "open_correction": deepcopy(work.assurance_correction_proposal),
        "physical_corrections": deepcopy(work.assurance_corrections),
        **quality_dependency_view(work),
        "criteria": entries, "required_count": len(entries),
        "model_reported_met_count": sum(
            row["status"] == "MODEL_ONLY_REPORTED_MEETS" for row in entries
        ),
        "current_result_quality_gate": acceptance_gate(work),
        "work_result": work.result,
        "customer_acceptance_separate_from_assessment": True,
        "independent_real_quality_certification": "NOT_ESTABLISHED",
        "additional_transaction_cost_or_competence_effect": "NOT_IDENTIFIABLE",
    }


# R1-W2F: explicit correction of a rejected original Result. New actions
# reuse original Work, declared Operation, ContextBasis and CapacityLedger.
CORRECTION_ACTIONS = frozenset({
    "quality_correction_propose", "quality_correction_review",
    "quality_correction_apply", "quality_correction_cancel",
    "quality_correction_start", "quality_correction_complete",
})


def _require(condition: bool, reason: str) -> None:
    if not condition:
        raise AssuranceBlocked(reason)


def _owned_source(state: Any, ref: Any, owner: str, at: int) -> str | None:
    prefix = f"model://{owner}/"
    _require(isinstance(ref, str) and ref.startswith(prefix)
             and len(prefix) < len(ref) <= 180,
             "QUALITY_ORIGINAL_OWNER_SOURCE_REQUIRED")
    if state is None:
        return None
    _require(owner in state.subjects and state.subjects[owner].active,
             "QUALITY_ORIGINAL_SOURCE_OWNER_UNAVAILABLE")
    basis = state.context_basis
    if basis is None or not basis.strict:
        return None
    source = basis.sources.get(ref)
    _require(source is not None and source.owner == owner
             and source.status == "CONFIRMED" and owner in source.usable_by
             and (source.valid_until is None or at <= source.valid_until),
             "QUALITY_ORIGINAL_SOURCE_UNAVAILABLE")
    return source.revision


def _ref_used(work: Any, ref: Any) -> bool:
    if not isinstance(ref, str):
        return False
    return (ref == work.result_ref or ref in work.assurance_refs
            or ref in work.operation_evidence.values()
            or any(c.source_ref == ref for c in work.assurance_criteria)
            or any(row.get("model_ref") == ref for row in work.result_history)
            or any(ref in row.values() for row in work.handoff_evidence.values())
            or any(ref in (st.dispatch_ref, st.receipt_ref, st.quality_ref)
                   for st in work.material_states.values())
            or any(ref in (batch.origin_ref, batch.quality_spec_ref) for batch in work.material_batches)
            or any(ref in (row.get("cost_source_ref"), row.get("proposal_source"))
                   for row in work.wip_interruptions + work.wip_amendments)
            or any(ref in (lot.get("inspection_ref"), lot.get("claim_ref"),
                           lot.get("custody_dispatch_ref"), lot.get("custody_receipt_ref"),
                           lot.get("custody_quality_ref")) for lot in work.wip_lots)
            or any(ref in row.get("used_refs", {}) or
                   ref == row.get("terms", {}).get("original_operation_evidence") or
                   any(part["original_operation_evidence"] == ref
                       for part in row.get("terms", {}).get("plan", ())) or
                   any(ref in h["evidence"].values() for h in row.get("terms", {}).get("handoffs_before", ())) or
                   any(ref in (m.get("dispatch_ref"), m.get("receipt_ref"), m.get("quality_ref"),
                               m.get("origin_ref"), m.get("quality_spec_ref"))
                       for m in row.get("terms", {}).get("materials_before", ())) for row in
                   [*work.assurance_corrections,
                    *([work.assurance_correction_proposal]
                      if work.assurance_correction_proposal is not None else [])]))


def _fresh_source(state: Any, work: Any, ref: Any, owner: str, at: int) -> dict:
    revision = _owned_source(state, ref, owner, at)
    _require(not any(_ref_used(other, ref) for other in state.works.values()),
             "QUALITY_CORRECTION_SOURCE_ALREADY_USED")
    return {"owner": owner, "revision": revision}


def failed_criteria(work: Any) -> list[QualityCriterion]:
    if work.result_ref is None:
        return []
    return [c for c in work.assurance_criteria
            if (review := work.assurance_reviews.get(c.key)) is not None
            and review.get("result_ref") == work.result_ref
            and review["verdict"] == "DOES_NOT_MEET"]


def _current_reviews(work: Any) -> bool:
    return bool(work.assurance_criteria and work.result_ref) and all(
        work.assurance_reviews.get(c.key, {}).get("result_ref") == work.result_ref
        and work.assurance_reviews[c.key]["work_revision"] == work.source_revision
        and work.assurance_reviews[c.key]["commitment_org_revision"] == work.commitment_org_revision
        for c in work.assurance_criteria
    )


def quality_dependency_scope(work: Any, *, expand_inputs: bool = False) -> dict[str, Any]:
    """Calculate the least causal closure of current failed original criteria.

    Downstream operations cannot retain evidence produced from a corrected
    predecessor. Optional input expansion is a proposal scope, not execution.
    """
    roots = {c.operation for c in failed_criteria(work)}
    keys = {op.key for op in work.operations}
    _require(bool(roots) and roots <= keys,
             "QUALITY_CORRECTION_ORIGINAL_FAILED_OPERATIONS_REQUIRED")
    affected = set(roots)
    added_inputs = set()
    while True:
        before = set(affected)
        affected.update(op.key for op in work.operations
                        if affected.intersection(op.requires_completed))
        if expand_inputs:
            incoming = {h.upstream for h in work.handoffs
                        if h.downstream in affected and h.upstream not in affected}
            added_inputs.update(incoming)
            affected.update(incoming)
        if before == affected:
            break
    return {
        "failed_operations": sorted(roots),
        "affected_operations": [op.key for op in work.operations if op.key in affected],
        "unaffected_operations": [op.key for op in work.operations if op.key not in affected],
        "input_expansion_requested": expand_inputs,
        "additional_input_operations": sorted(added_inputs - roots),
        "internal_handoffs": [list(h.edge) for h in work.handoffs
                              if h.upstream in affected and h.downstream in affected],
        "boundary_inputs": [list(h.edge) for h in work.handoffs
                            if h.downstream in affected and h.upstream not in affected],
        "affected_material_batches": [b.key for b in work.material_batches
                                      if affected.intersection(b.edge)],
    }


def quality_dependency_view(work: Any) -> dict[str, Any]:
    failures = failed_criteria(work)
    if not work.operations or not failures or any(
            c.operation not in {op.key for op in work.operations} for c in failures):
        return {}
    scope = quality_dependency_scope(work)
    out = {"correction_dependency_scope": scope}
    if scope["boundary_inputs"]:
        out["correction_dependency_scope_with_input_reproduction"] = quality_dependency_scope(
            work, expand_inputs=True)
    return out


def _handoff_snapshot(work: Any, scope: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [{"edge": list(edge), "state": work.handoff_states[tuple(edge)],
             "evidence": deepcopy(work.handoff_evidence.get(tuple(edge), {}))}
            for edge in scope["internal_handoffs"]]


def _material_snapshot(work: Any, scope: Mapping[str, Any]) -> list[dict[str, Any]]:
    selected = set(scope["affected_material_batches"])
    return [row for row in material_view(work.material_batches, work.material_states)["batches"]
            if row["batch"] in selected]


def current_material_generation(work: Any, batch_key: str) -> dict[str, Any] | None:
    """Current generation is a projection of applied original Work history."""
    for row in reversed(work.assurance_corrections):
        if row["status"] == "CANCELLED":
            continue
        revision = next((m for m in row["terms"].get("material_revisions", ())
                         if m["batch"] == batch_key), None)
        if revision is not None:
            return {"correction_id": row["terms"]["id"],
                    "replacement_origin_ref": revision["replacement_origin_ref"],
                    "prior_generation": revision["prior_generation"],
                    "original_batch_identity_unchanged": True}
    return None


def _material_retry_snapshot(work: Any, ident: Any) -> dict[str, Any]:
    """A failed delivery can be replaced, but an active or unknown custody cannot."""
    old = work.assurance_corrections[-1] if work.assurance_corrections else None
    _require(isinstance(ident, str) and old is not None
             and old["terms"]["id"] == ident and old["status"] == "IN_PROGRESS"
             and bool(old["terms"].get("material_revisions"))
             and old["terms"]["rejected_result"] == work.result_ref
             and work.result == "REJECTED" and work.execution == "IN_PROGRESS",
             "QUALITY_CORRECTION_FAILED_MATERIAL_ATTEMPT_REQUIRED")
    scope = old["terms"]["dependency_scope"]
    _require(all(work.operation_states[key] in {"COMPLETED", "CORRECTION_PLANNED"}
                 for key in scope["affected_operations"]),
             "QUALITY_CORRECTION_RETRY_RUNNING_OPERATION")
    handoffs = _handoff_snapshot(work, scope)
    _require(all(h["state"] in {"NOT_DISPATCHED", "RECEIVED"} for h in handoffs),
             "QUALITY_CORRECTION_RETRY_MATERIAL_IN_TRANSIT")
    by_edge = {tuple(h["edge"]): h for h in handoffs}
    failures = []
    for batch in work.material_batches:
        if batch.key not in scope["affected_material_batches"]:
            continue
        st = work.material_states[batch.key]
        generation = current_material_generation(work, batch.key)
        _require(generation is not None and generation["correction_id"] == ident,
                 "QUALITY_CORRECTION_RETRY_GENERATION_MISMATCH")
        h = by_edge[batch.edge]
        if h["state"] == "NOT_DISPATCHED":
            _require(h["evidence"] == {} and st == MaterialState(),
                     "QUALITY_CORRECTION_RETRY_UNKNOWN_CUSTODY")
            continue
        _require(st.received is not None and st.accepted is not None
                 and st.rejected is not None and st.accepted + st.rejected == st.received
                 and st.receipt_ref == h["evidence"].get("receipt")
                 and st.dispatch_ref == h["evidence"].get("dispatch")
                 and st.quality_ref is not None
                 and any(e["action"] == "handoff_quality" and e["edge"] == list(batch.edge)
                         and e["source_ref"] == st.quality_ref for e in old["handoff_events"]),
                 "QUALITY_CORRECTION_RETRY_ALL_RECEIVED_MATERIAL_ASSESSED_REQUIRED")
        if st.accepted < batch.planned_quantity:
            failures.append({"batch": batch.key, "quality_ref": st.quality_ref,
                             "planned_quantity": str(batch.planned_quantity),
                             "accepted_quantity": str(st.accepted),
                             "rejected_quantity": str(st.rejected)})
    _require(bool(failures), "QUALITY_CORRECTION_RETRY_NEGATIVE_MATERIAL_ASSESSMENT_REQUIRED")
    return {
        "id": ident,
        "attempt_fingerprint": fingerprint(old),
        "dependency_scope": deepcopy(scope),
        "failed_batches": failures,
        "operation_states": {key: work.operation_states[key] for key in scope["affected_operations"]},
        "operation_evidence": {key: work.operation_evidence[key] for key in scope["affected_operations"]},
        "handoffs": handoffs,
        "materials": _material_snapshot(work, scope),
    }


def _material_revision_terms(state: Any, work: Any, event: Mapping[str, Any],
                             scope: Mapping[str, Any], refs: dict, at: int,
                             *, retry: bool = False) -> dict[str, Any]:
    _require(not scope["boundary_inputs"],
             "QUALITY_CORRECTION_BOUNDARY_INPUT_REPRODUCTION_REQUIRED")
    selected = scope["affected_material_batches"]
    raw = event.get("quality_correction_material_revisions", [])
    _require(isinstance(raw, list) and len(raw) == len(selected),
             "QUALITY_CORRECTION_EXACT_MATERIAL_GENERATIONS_REQUIRED")
    if not scope["internal_handoffs"] and not selected:
        return {}
    # The original Handoff receiver is immutable here. A WIP-transferred
    # performer needs the existing separate custody/responsibility redecision,
    # not an implicit reset of original sender/receiver.
    handoffs = {h.edge: h for h in work.handoffs}
    ops = {op.key: op for op in work.operations}
    before = _handoff_snapshot(work, scope)
    prior = {}
    owners = set()
    def prior_source(ref, owner):
        info = {"owner": owner, "revision": _owned_source(state, ref, owner, at)}
        _require(ref not in prior or prior[ref] == info,
                 "QUALITY_CORRECTION_ORIGINAL_MATERIAL_SOURCE_OWNER_CONFLICT")
        prior[ref] = info
    for row in before:
        edge = tuple(row["edge"])
        h = handoffs[edge]
        _require(all(work.wip_operation_active_resources.get(key, ops[key].primary_resource)
                     == ops[key].primary_resource for key in edge),
                 "QUALITY_CORRECTION_TRANSFERRED_HANDOFF_REDECISION_REQUIRED")
        if retry and row["state"] == "NOT_DISPATCHED":
            _require(row["evidence"] == {}, "QUALITY_CORRECTION_RETRY_UNKNOWN_CUSTODY")
        else:
            _require(row["state"] == "RECEIVED" and set(row["evidence"]) == {"dispatch", "receipt"},
                     "QUALITY_CORRECTION_ORIGINAL_HANDOFF_EVIDENCE_REQUIRED")
            prior_source(row["evidence"]["dispatch"], h.sender)
            prior_source(row["evidence"]["receipt"], h.receiver)
        owners.update((h.sender, h.receiver))
    batch_by_key = {b.key: b for b in work.material_batches}
    revisions = {}
    for item in raw:
        _require(isinstance(item, dict) and set(item) == {
            "batch", "prior_receipt_ref", "prior_quality_ref", "disposition",
            "disposition_ref", "replacement_origin_ref",
        }, "QUALITY_CORRECTION_MATERIAL_REVISION_FIELDS_INVALID")
        key = item["batch"]
        _require(isinstance(key, str) and key in selected and key not in revisions,
                 "QUALITY_CORRECTION_EXACT_MATERIAL_GENERATIONS_REQUIRED")
        batch = batch_by_key[key]
        h = handoffs[batch.edge]
        st = work.material_states[key]
        unissued = retry and work.handoff_states[batch.edge] == "NOT_DISPATCHED"
        if unissued:
            _require(st == MaterialState() and item["prior_receipt_ref"] is None
                     and item["prior_quality_ref"] is None,
                     "QUALITY_CORRECTION_RETRY_UNKNOWN_CUSTODY")
            disposition, disposition_owner = "NOT_DISPATCHED_GENERATION_CANCELLED", h.sender
        else:
            _require(st.received is not None and st.accepted is not None and st.rejected is not None
                     and (retry or (st.received == batch.planned_quantity
                                    and st.accepted == batch.planned_quantity))
                     and st.dispatch_ref is not None and st.receipt_ref is not None and st.quality_ref is not None
                     and item["prior_receipt_ref"] == st.receipt_ref
                     and item["prior_quality_ref"] == st.quality_ref,
                     "QUALITY_CORRECTION_ORIGINAL_MATERIAL_CUSTODY_REQUIRED")
            disposition, disposition_owner = "EXCLUDED_FROM_NEW_ATTEMPT", h.receiver
        _require(item["disposition"] == disposition,
                 "QUALITY_CORRECTION_PRIOR_MATERIAL_DISPOSITION_REQUIRED")
        generation = current_material_generation(work, key)
        prior_origin = generation["replacement_origin_ref"] if generation else batch.origin_ref
        for ref, owner in (
            (prior_origin, batch.origin_source_owner),
            (batch.quality_spec_ref, batch.quality_spec_owner),
        ):
            prior_source(ref, owner)
        if not unissued:
            for ref, owner in ((st.dispatch_ref, h.sender), (st.receipt_ref, h.receiver),
                               (st.quality_ref, h.receiver)):
                prior_source(ref, owner)
        for ref, owner in ((item["disposition_ref"], disposition_owner),
                           (item["replacement_origin_ref"], batch.origin_source_owner)):
            info = _fresh_source(state, work, ref, owner, at)
            _require(ref not in refs and ref not in prior,
                     "QUALITY_CORRECTION_DISTINCT_SOURCES_REQUIRED")
            refs[ref] = info
        owners.update((batch.declared_title_holder, batch.origin_source_owner, batch.quality_spec_owner))
        revisions[key] = {
            **item, "prior_generation": generation["correction_id"] if generation else "ORIGINAL",
            "prior_origin_ref": prior_origin, "original_origin_ref": batch.origin_ref,
            "quality_spec_ref": batch.quality_spec_ref, "planned_quantity": str(batch.planned_quantity),
            "prior_holder": None if unissued else h.receiver,
            "disposition_source_owner": disposition_owner,
            "declared_title_holder": batch.declared_title_holder,
            "replacement_origin_owner": batch.origin_source_owner,
            "no_title_or_payment_inferred": True,
        }
    _require(set(revisions) == set(selected), "QUALITY_CORRECTION_EXACT_MATERIAL_GENERATIONS_REQUIRED")
    _require(not set(refs).intersection(prior), "QUALITY_CORRECTION_DISTINCT_SOURCES_REQUIRED")
    return {
        "handoffs_before": before, "materials_before": _material_snapshot(work, scope),
        "material_revisions": [revisions[key] for key in selected],
        "material_principals": sorted(owners),
        "prior_material_source_revisions": prior,
    }


def _apply_material_generation(work: Any, row: dict[str, Any]) -> None:
    doc = row["terms"]
    if "handoffs_before" not in doc:
        return
    # Only the current projection is reset. The original immutable Handoff
    # and MaterialBatch declarations plus prior custody acts remain in terms.
    for entry in doc["handoffs_before"]:
        edge = tuple(entry["edge"])
        work.handoff_states[edge] = "NOT_DISPATCHED"
        work.handoff_evidence.pop(edge, None)
    for revision in doc["material_revisions"]:
        work.material_states[revision["batch"]] = MaterialState()
    row["handoff_events"] = []


def qualify_correction_handoff(state: Any, work: Any, event: Mapping[str, Any], at: int):
    """Before the existing _handoff_action, qualify the active generation."""
    bound = "quality_correction_id" in event or "quality_correction_fingerprint" in event
    if work.result != "REJECTED":
        _require(not bound, "QUALITY_CORRECTION_HANDOFF_ACTIVE_GENERATION_REQUIRED")
        return None
    row = work.assurance_corrections[-1] if work.assurance_corrections else None
    _require(row is not None and row["status"] == "IN_PROGRESS"
             and "handoffs_before" in row["terms"] and bound
             and event.get("quality_correction_id") == row["terms"]["id"]
             and event.get("quality_correction_fingerprint") == row["fingerprint"],
             "QUALITY_CORRECTION_HANDOFF_ACTIVE_GENERATION_REQUIRED")
    _proposal_current(state, work, row, at)
    _check_approval(row)
    edge = [event.get("from_operation"), event.get("to_operation")]
    _require(edge in row["terms"]["dependency_scope"]["internal_handoffs"],
             "QUALITY_CORRECTION_HANDOFF_OUTSIDE_DEPENDENCY_SCOPE")
    upstream, downstream = (row["operations"][key] for key in edge)
    _require(upstream["status"] == "COMPLETED" and upstream["completed_at"] < at
             and downstream["status"] == "PLANNED",
             "QUALITY_CORRECTION_HANDOFF_EXECUTION_ORDER_REQUIRED")
    next_part = next(p for p in row["terms"]["plan"] if p["operation"] == edge[1])
    _require(at < next_part["end"], "QUALITY_CORRECTION_HANDOFF_OUTSIDE_REMAINING_WINDOW")
    h = next(h for h in work.handoffs if list(h.edge) == edge)
    owner = h.sender if event["action"] == "handoff_dispatch" else h.receiver
    _require(event["actor"] == owner, "QUALITY_CORRECTION_ORIGINAL_HANDOFF_OWNER_REQUIRED")
    ref = event.get("result_ref")
    info = _fresh_source(state, work, ref, owner, at)
    return row, edge, ref, info


def record_correction_handoff(qualified: Any, event: Mapping[str, Any], at: int) -> dict[str, Any] | None:
    if qualified is None:
        return None
    row, edge, ref, info = qualified
    row["used_refs"][ref] = info
    row["handoff_events"].append({
        "edge": edge, "action": event["action"], "actor": event["actor"],
        "at": at, "source_ref": ref, "source_revision": info["revision"],
    })
    return {"quality_correction_id": row["terms"]["id"],
            "quality_correction_handoff_generation": row["terms"]["id"],
            "original_work_not_replaced": True}


def _material_generation_current(work: Any, row: Mapping[str, Any]) -> bool:
    doc = row["terms"]
    if "handoffs_before" not in doc:
        return True
    scope = doc["dependency_scope"]
    if (_handoff_snapshot(work, scope) != row.get("handoffs_after") or
            _material_snapshot(work, scope) != row.get("materials_after")):
        return False
    for edge in scope["internal_handoffs"]:
        entries = [e for e in row["handoff_events"] if e["edge"] == edge]
        batches = [b for b in work.material_batches if list(b.edge) == edge]
        expected = ["handoff_dispatch", "handoff_receive"] + (["handoff_quality"] if batches else [])
        if [e["action"] for e in entries] != expected:
            return False
        times = [row["operations"][edge[0]]["completed_at"],
                 *[e["at"] for e in entries], row["operations"][edge[1]]["started_at"]]
        if any(a >= b for a, b in zip(times, times[1:])):
            return False
        evidence = work.handoff_evidence.get(tuple(edge), {})
        if (work.handoff_states.get(tuple(edge)) != "RECEIVED"
                or entries[0]["source_ref"] != evidence.get("dispatch")
                or entries[1]["source_ref"] != evidence.get("receipt")):
            return False
        h = next(h for h in work.handoffs if list(h.edge) == edge)
        for i, entry in enumerate(entries):
            owner = h.sender if i == 0 else h.receiver
            if (entry["actor"] != owner or row["used_refs"].get(entry["source_ref"]) != {
                    "owner": owner, "revision": entry["source_revision"]}):
                return False
        for batch in batches:
            st = work.material_states[batch.key]
            if (st.dispatched != batch.planned_quantity or st.received != batch.planned_quantity
                    or st.accepted != batch.planned_quantity or st.rejected != 0
                    or st.dispatch_ref != entries[0]["source_ref"]
                    or st.receipt_ref != entries[1]["source_ref"]
                    or st.quality_ref != entries[2]["source_ref"]):
                return False
    return True


def _operation_resource(state: Any, work: Any, operation: Any) -> tuple[Any, str, str, int]:
    op = next((o for o in work.operations if o.key == operation), None)
    _require(op is not None and len(op.resource_requirements) == 1
             and op.resource_requirements[0].resource == op.primary_resource,
             "QUALITY_CORRECTION_SINGLE_RESOURCE_OPERATION_REQUIRED")
    resource = work.wip_operation_active_resources.get(op.key, op.primary_resource)
    return op, resource, state.resources[resource], op.resource_requirements[0].units


def _plan_parts(doc: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return list(doc["plan"]) if "plan" in doc else [doc]


def _execution_parts(row: Mapping[str, Any]):
    return [(part, row.get("operations", {}).get(part["operation"], {})) if "plan" in row["terms"]
            else (part, row) for part in _plan_parts(row["terms"])]


def correction_resource_claims(row: Mapping[str, Any]):
    """Read each actual resource-use assertion from the SAME correction."""
    for part, executed in _execution_parts(row):
        claim = executed.get("additional_resource_use_claim")
        if claim is not None:
            yield part["operation"], claim


def _plan_reservations(work: Any, doc: Mapping[str, Any]) -> list[Reservation]:
    return [Reservation(part["resource"], work.key, part["start"], part["end"], part["units"])
            for part in _plan_parts(doc)]


def _plan_ready(state: Any, work: Any, doc: Mapping[str, Any]) -> None:
    for part in _plan_parts(doc):
        state._require_resource_available(part["resource"])
    try:
        state.capacity_ledger.preview_plan(work.key, _plan_reservations(work, doc),
                                           append_to_original=True)
    except CapacityBlocked as exc:
        raise AssuranceBlocked(exc.reason) from exc


def _new_dependent_plan(state: Any, work: Any, event: Mapping[str, Any],
                        at: int, refs: dict, expires: int,
                        *, retry_snapshot: Mapping[str, Any] | None = None) -> dict[str, Any]:
    expand = event.get("quality_correction_expand_inputs", False)
    _require(type(expand) is bool, "QUALITY_CORRECTION_INPUT_EXPANSION_FLAG_INVALID")
    scope = quality_dependency_scope(work, expand_inputs=expand)
    if retry_snapshot is not None:
        _require(scope == retry_snapshot["dependency_scope"],
                 "QUALITY_CORRECTION_RETRY_EXACT_PREVIOUS_SCOPE_REQUIRED")
    _require(not scope["boundary_inputs"],
             "QUALITY_CORRECTION_BOUNDARY_INPUT_REPRODUCTION_REQUIRED")
    raw = event.get("quality_correction_plan")
    _require(isinstance(raw, list) and len(raw) == len(scope["affected_operations"]),
             "QUALITY_CORRECTION_EXACT_DEPENDENCY_CLOSURE_REQUIRED")
    plan_by_op = {}
    for item in raw:
        _require(isinstance(item, dict) and set(item) ==
                 {"operation", "slot_start", "slot_end", "resource_ref", "cost"},
                 "QUALITY_CORRECTION_PLAN_ROW_INVALID")
        key = item["operation"]
        _require(isinstance(key, str) and key in scope["affected_operations"]
                 and key not in plan_by_op, "QUALITY_CORRECTION_EXACT_DEPENDENCY_CLOSURE_REQUIRED")
        op, resource, owner, units = _operation_resource(state, work, key)
        allowed_states = {"COMPLETED", "CORRECTION_PLANNED"} if retry_snapshot is not None else {"COMPLETED"}
        _require(work.operation_states[key] in allowed_states and key in work.operation_evidence
                 and owner != work.customer, "QUALITY_CORRECTION_COMPLETED_INDEPENDENT_OPERATION_REQUIRED")
        start, end = item["slot_start"], item["slot_end"]
        _require(type(start) is int and type(end) is int and at < expires <= start < end,
                 "QUALITY_CORRECTION_FUTURE_WINDOW_REQUIRED")
        ref = item["resource_ref"]
        info = _fresh_source(state, work, ref, owner, at)
        _require(ref not in refs, "QUALITY_CORRECTION_DISTINCT_SOURCES_REQUIRED")
        refs[ref] = info
        plan_by_op[key] = {
            "operation": key, "original_operation_evidence": work.operation_evidence[key],
            "resource": resource, "owner": owner, "units": units,
            "start": start, "end": end, "resource_ref": ref,
            "cost_claim": _fmt(_money(item["cost"],
                          "QUALITY_CORRECTION_ADDITIONAL_COST_REQUIRED", positive=True)),
        }
    for key, part in plan_by_op.items():
        op = next(o for o in work.operations if o.key == key)
        _require(all(plan_by_op[pred]["end"] <= part["start"] for pred in op.requires_completed
                     if pred in plan_by_op), "QUALITY_CORRECTION_DEPENDENCY_WINDOW_ORDER_REQUIRED")
    _require(set(plan_by_op) == set(scope["affected_operations"]),
             "QUALITY_CORRECTION_EXACT_DEPENDENCY_CLOSURE_REQUIRED")
    plan = [plan_by_op[key] for key in scope["affected_operations"]]
    total = _fmt(sum((_money(p["cost_claim"], "QUALITY_CORRECTION_ADDITIONAL_COST_REQUIRED")
                      for p in plan), _money("0", "QUALITY_CORRECTION_ADDITIONAL_COST_REQUIRED")))
    if "quality_correction_cost" in event:
        _require(_fmt(_money(event["quality_correction_cost"],
                             "QUALITY_CORRECTION_ADDITIONAL_COST_REQUIRED", positive=True)) == total,
                 "QUALITY_CORRECTION_PLAN_TOTAL_MISMATCH")
    materials = _material_revision_terms(state, work, event, scope, refs, at,
                                         retry=retry_snapshot is not None)
    return {
        "scope": "DEPENDENT_ORIGINAL_OPERATIONS_CORRECTION",
        "dependency_scope": scope, "plan": plan, "cost_claim": total, **materials,
        **({"material_retry": deepcopy(retry_snapshot)} if retry_snapshot is not None else {}),
        "unaffected_evidence": {key: work.operation_evidence[key]
                                for key in scope["unaffected_operations"]},
    }


def _correction_execution_current(state: Any, work: Any, row: Mapping[str, Any]) -> bool:
    doc = row["terms"]
    if any(work.operation_states.get(key) != "COMPLETED" or
           work.operation_evidence.get(key) != ref
           for key, ref in doc.get("unaffected_evidence", {}).items()):
        return False
    for part, executed in _execution_parts(row):
        key = part["operation"]
        if (work.operation_states.get(key) != "COMPLETED"
                or work.operation_evidence.get(key) != executed.get("operation_evidence")
                or executed.get("started_at") is None or executed.get("completed_at") is None
                or not row["applied_at"] < executed["started_at"] < executed["completed_at"]
                or executed["started_at"] < part["start"] or executed["completed_at"] > part["end"]
                or executed.get("additional_resource_use_claim", {}).get("amount") != part["cost_claim"]
                or not any(r == Reservation(part["resource"], work.key, part["start"], part["end"], part["units"])
                           for r in state.capacity_ledger.reservations)):
            return False
    return _material_generation_current(work, row)


def _terminal_operation(state: Any, work: Any, operation: Any) -> tuple[Any, str, str, int]:
    op = next((o for o in work.operations if o.key == operation), None)
    _require(op is not None and len(op.resource_requirements) == 1
             and op.resource_requirements[0].resource == op.primary_resource
             and not any(operation in o.requires_completed for o in work.operations)
             and not any(h.upstream == operation for h in work.handoffs),
             "QUALITY_CORRECTION_TERMINAL_SINGLE_RESOURCE_OPERATION_REQUIRED")
    _require(not any(operation in batch.edge for batch in work.material_batches),
             "QUALITY_CORRECTION_MATERIAL_REDECISION_NOT_YET_QUALIFIED")
    resource = work.wip_operation_active_resources.get(op.key, op.primary_resource)
    return op, resource, state.resources[resource], op.resource_requirements[0].units


def _correction_sources_current(state: Any, row: Mapping[str, Any], at: int) -> None:
    for ref, info in {**row["terms"].get("prior_source_revisions", {}),
                      **row["used_refs"]}.items():
        _require(_owned_source(state, ref, info["owner"], at) == info["revision"],
                 "QUALITY_CORRECTION_SOURCE_REVISION_STALE")


def _correction_rights_current(state: Any, work: Any, row: Mapping[str, Any],
                               at: int) -> None:
    basis = state.context_basis
    if basis is None:
        return
    basis.assert_allowed(work.key, "quality_correction_propose", work.customer, at)
    for owner in row["votes"]:
        basis.assert_allowed(work.key, "quality_correction_review", owner, at)
    if row.get("applied_at") is not None:
        basis.assert_allowed(work.key, "quality_correction_apply", work.customer, at)
    if "plan" in row["terms"] and row.get("operations") is None:
        return
    for part, executed in _execution_parts(row):
        if executed.get("started_at") is not None:
            basis.assert_allowed(work.key, "quality_correction_start", part["owner"], at)
        if executed.get("completed_at") is not None:
            basis.assert_allowed(work.key, "quality_correction_complete", part["owner"], at)
    for entry in row.get("handoff_events", ()):
        basis.assert_allowed(work.key, entry["action"], entry["actor"], at)


def _proposal_current(state: Any, work: Any, row: Mapping[str, Any], at: int) -> None:
    doc = row["terms"]
    _require(fingerprint(doc) == row["fingerprint"] and
             doc["work"] == work.key and doc["rejected_result"] == work.result_ref
             and doc["source_revision"] == work.source_revision
             and doc["commitment_org_revision"] == work.commitment_org_revision
             and doc["org_revision"] == state.institution.revision
             and doc["reviews"] == work.assurance_reviews
             and doc["responsibilities"] == work.assurance_responsibilities
             and work.result == "REJECTED"
             and work.obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS",
             "QUALITY_CORRECTION_ORIGINAL_REVISION_CHANGED")
    if "plan" in doc:
        _require(quality_dependency_scope(work, expand_inputs=doc["dependency_scope"]["input_expansion_requested"])
                 == doc["dependency_scope"], "QUALITY_CORRECTION_DEPENDENCY_SCOPE_CHANGED")
        for part in doc["plan"]:
            _, resource, owner, units = _operation_resource(state, work, part["operation"])
            _require((resource, owner, units) == (part["resource"], part["owner"], part["units"]),
                     "QUALITY_CORRECTION_ORIGINAL_RESOURCE_CHANGED")
        _require(all(work.operation_states.get(key) == "COMPLETED" and
                     work.operation_evidence.get(key) == ref
                     for key, ref in doc["unaffected_evidence"].items()),
                 "QUALITY_CORRECTION_UNAFFECTED_OPERATION_CHANGED")
        if row["status"] == "PROPOSED" and "material_retry" in doc:
            retry = doc["material_retry"]
            _require(_material_retry_snapshot(work, retry["id"]) == retry,
                     "QUALITY_CORRECTION_FAILED_ATTEMPT_CHANGED_AFTER_CONSENT")
            old = work.assurance_corrections[-1]
            _proposal_current(state, work, old, at)
            _check_approval(old)
        if row["status"] == "PROPOSED" and "handoffs_before" in doc:
            _require(_handoff_snapshot(work, doc["dependency_scope"]) == doc["handoffs_before"] and
                     _material_snapshot(work, doc["dependency_scope"]) == doc["materials_before"],
                     "QUALITY_CORRECTION_ORIGINAL_MATERIAL_CHANGED_AFTER_CONSENT")
    else:
        _, resource, owner, units = _terminal_operation(state, work, doc["operation"])
        _require((resource, owner, units) == (doc["resource"], doc["owner"], doc["units"]),
                 "QUALITY_CORRECTION_ORIGINAL_RESOURCE_CHANGED")
    if work.assurance_responsibilities:
        assert_assurance_responsibility_current(state, work, at)
    _correction_sources_current(state, row, at)
    _correction_rights_current(state, work, row, at)


def _check_approval(row: Mapping[str, Any]) -> None:
    _require(set(row["votes"]) == set(row["terms"]["required"]) and all(
        vote["decision"] == "SUPPORT" and
        vote["source_ref"].startswith(f"model://{owner}/") and
        row["used_refs"].get(vote["source_ref"], {}).get("owner") == owner and
        vote["at"] > row["created_at"] and
        (row.get("applied_at") is None or vote["at"] < row["applied_at"])
        for owner, vote in row["votes"].items()
    ), "QUALITY_CORRECTION_INDEPENDENT_SUPPORT_REQUIRED")


def _resource_ready(state: Any, work: Any, doc: Mapping[str, Any], *, reserved: bool) -> None:
    state._require_resource_available(doc["resource"])
    needs = [ResourceNeed(doc["resource"], doc["units"])]
    start, end = doc["start"], doc["end"]
    if reserved:
        _require(any(r.work == work.key and r.resource == doc["resource"]
                     and r.start == start and r.end == end and r.units == doc["units"]
                     for r in state.capacity_ledger.reservations),
                 "QUALITY_CORRECTION_RESERVATION_MISSING")
        _require(state.capacity_ledger.planned_window_risk(
            needs, start, end, outstanding=state._outstanding_work_ids()) is None,
            "QUALITY_CORRECTION_CAPACITY_CHANGED")
    else:
        try:
            state.capacity_ledger.preview_amendment(work.key, needs, start, end)
        except CapacityBlocked as exc:
            raise AssuranceBlocked(exc.reason) from exc


def apply_quality_correction(state: Any, work: Any, event: Mapping[str, Any],
                             at: int) -> dict[str, Any]:
    action, actor = event["action"], event["actor"]
    _require(work.result == "REJECTED"
             and work.obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
             and event.get("result_ref") == work.result_ref
             and event.get("source_revision") == work.source_revision
             and event.get("org_revision") == state.institution.revision,
             "QUALITY_CORRECTION_REJECTED_ORIGINAL_RESULT_REQUIRED")
    ident = event.get("quality_correction_id")
    _require(isinstance(ident, str) and 0 < len(ident) <= 128,
             "QUALITY_CORRECTION_ID_REQUIRED")
    if action == "quality_correction_propose":
        retry_snapshot = None
        _require(actor == work.customer and work.assurance_correction_proposal is None,
                 "QUALITY_CORRECTION_ORIGINAL_CUSTOMER_AND_NO_OPEN_ATTEMPT_REQUIRED")
        if "quality_correction_retry_of" in event:
            retry_snapshot = _material_retry_snapshot(work, event["quality_correction_retry_of"])
            old = work.assurance_corrections[-1]
            _proposal_current(state, work, old, at)
            _check_approval(old)
            _require("quality_correction_plan" in event,
                     "QUALITY_CORRECTION_DEPENDENCY_PLAN_REQUIRED")
        else:
            _require(work.execution == "DONE_WITH_EVIDENCE"
                     and not any(r["status"] in {"APPROVED", "IN_PROGRESS", "COMPLETED"}
                                 for r in work.assurance_corrections),
                     "QUALITY_CORRECTION_ORIGINAL_CUSTOMER_AND_NO_OPEN_ATTEMPT_REQUIRED")
        _require(not any(r["terms"]["id"] == ident for w in state.works.values()
                         for r in [*w.assurance_corrections,
                                   *([w.assurance_correction_proposal]
                                     if w.assurance_correction_proposal else [])]),
                 "QUALITY_CORRECTION_ID_REUSED")
        failed = failed_criteria(work)
        _require(_current_reviews(work) and bool(failed),
                 "QUALITY_CORRECTION_ALL_ASSESSMENTS_AND_NEGATIVE_REQUIRED")
        if work.assurance_responsibilities:
            assert_assurance_responsibility_current(state, work, at)
        expires = event.get("quality_correction_valid_until")
        _require(type(expires) is int and at < expires, "QUALITY_CORRECTION_FUTURE_WINDOW_REQUIRED")
        currency = event.get("quality_correction_currency")
        _require(isinstance(currency, str) and len(currency) == 3
                 and currency.isascii() and currency.isupper() and currency.isalpha(),
                 "QUALITY_CORRECTION_CURRENCY_REQUIRED")
        source = event.get("quality_correction_source_ref")
        refs = {source: _fresh_source(state, work, source, work.customer, at)}
        if "quality_correction_plan" in event:
            scoped = _new_dependent_plan(state, work, event, at, refs, expires,
                                         retry_snapshot=retry_snapshot)
        else:
            _require("quality_correction_expand_inputs" not in event and
                     "quality_correction_material_revisions" not in event,
                     "QUALITY_CORRECTION_DEPENDENCY_PLAN_REQUIRED")
            operation = event.get("operation")
            _require(all(c.operation == operation for c in failed),
                     "QUALITY_CORRECTION_FAILED_OPERATION_SCOPE_REQUIRED")
            op, resource, owner, units = _terminal_operation(state, work, operation)
            _require(work.operation_states[operation] == "COMPLETED"
                     and operation in work.operation_evidence and owner != work.customer,
                     "QUALITY_CORRECTION_COMPLETED_INDEPENDENT_OPERATION_REQUIRED")
            start, end = event.get("quality_correction_slot_start"), event.get("quality_correction_slot_end")
            _require(type(start) is int and type(end) is int and at < expires <= start < end,
                     "QUALITY_CORRECTION_FUTURE_WINDOW_REQUIRED")
            amount = _fmt(_money(event.get("quality_correction_cost"),
                                 "QUALITY_CORRECTION_ADDITIONAL_COST_REQUIRED", positive=True))
            resource_ref = event.get("quality_correction_resource_ref")
            info = _fresh_source(state, work, resource_ref, owner, at)
            _require(resource_ref not in refs, "QUALITY_CORRECTION_DISTINCT_SOURCES_REQUIRED")
            refs[resource_ref] = info
            scoped = {
                "scope": "TERMINAL_ORIGINAL_OPERATION_CORRECTION_ONLY",
                "operation": operation, "original_operation_evidence": work.operation_evidence[operation],
                "resource": resource, "owner": owner, "units": units,
                "start": start, "end": end, "cost_claim": amount, "resource_ref": resource_ref,
            }
        prior = {}
        for criterion in work.assurance_criteria:
            for old_ref in (criterion.source_ref,
                            work.assurance_reviews[criterion.key]["model_ref"]):
                prior[old_ref] = {"owner": criterion.assessor,
                                  "revision": _owned_source(state, old_ref, criterion.assessor, at)}
        for ref, info in scoped.get("prior_material_source_revisions", {}).items():
            _require(ref not in prior or prior[ref] == info,
                     "QUALITY_CORRECTION_ORIGINAL_MATERIAL_SOURCE_OWNER_CONFLICT")
            prior[ref] = info
        required = sorted(set(work.consents) | {work.customer}
                          | set(scoped.get("material_principals", ()))
                          | {part["owner"] for part in _plan_parts(scoped)}
                          | {c.assessor for c in work.assurance_criteria})
        doc = {
            "id": ident, "work": work.key, "rejected_result": work.result_ref,
            **scoped, "expires": expires, "currency": currency, "source_ref": source,
            "required": required, "reviews": deepcopy(work.assurance_reviews),
            "responsibilities": deepcopy(work.assurance_responsibilities),
            "source_revision": work.source_revision,
            "org_revision": state.institution.revision,
            "commitment_org_revision": work.commitment_org_revision,
            "source_revisions": deepcopy(refs), "prior_source_revisions": prior,
        }
        _plan_ready(state, work, doc)
        row = {"terms": doc, "fingerprint": fingerprint(doc), "votes": {},
               "used_refs": refs, "created_at": at, "status": "PROPOSED"}
        work.assurance_correction_proposal = row
        return {"quality_correction_id": ident, "quality_correction_fingerprint": row["fingerprint"],
                "quality_correction_required": required, "quality_correction_state": "PROPOSED",
                **({"quality_correction_dependency_scope": doc["dependency_scope"]} if "plan" in doc else {})}
    if action in {"quality_correction_review", "quality_correction_apply",
                  "quality_correction_cancel"}:
        row = work.assurance_correction_proposal
    else:
        row = work.assurance_corrections[-1] if work.assurance_corrections else None
    _require(row is not None and row["terms"]["id"] == ident and
             row["fingerprint"] == event.get("quality_correction_fingerprint"),
             "QUALITY_CORRECTION_EXACT_PROPOSAL_REQUIRED")
    doc = row["terms"]
    source = event.get("quality_correction_source_ref")
    if action == "quality_correction_cancel":
        _require(actor == work.customer and at > row["created_at"],
                 "QUALITY_CORRECTION_ORIGINAL_CUSTOMER_REQUIRED")
        info = _fresh_source(state, work, source, actor, at)
        row["used_refs"][source] = info
        row["status"] = "CANCELLED"
        row["cancelled_at"] = at
        work.assurance_corrections.append(row)
        work.assurance_correction_proposal = None
        return {"quality_correction_id": ident, "quality_correction_state": "CANCELLED"}
    _proposal_current(state, work, row, at)
    if action == "quality_correction_review":
        _require(row["status"] == "PROPOSED" and row["created_at"] < at <= doc["expires"]
                 and actor in doc["required"] and actor not in row["votes"],
                 "QUALITY_CORRECTION_INDEPENDENT_REVIEW_REQUIRED")
        decision = event.get("quality_correction_decision")
        _require(isinstance(decision, str) and decision in {"SUPPORT", "OBJECT"},
                 "QUALITY_CORRECTION_REVIEW_DECISION_INVALID")
        info = _fresh_source(state, work, source, actor, at)
        row["used_refs"][source] = info
        row["votes"][actor] = {"decision": decision, "source_ref": source, "at": at}
    elif action == "quality_correction_apply":
        retry = doc.get("material_retry")
        expected_states = retry["operation_states"] if retry is not None else {
            part["operation"]: "COMPLETED" for part in _plan_parts(doc)}
        _require(actor == work.customer and row["status"] == "PROPOSED"
                 and row["created_at"] < at <= doc["expires"]
                 and all(v["at"] < at for v in row["votes"].values())
                 and work.execution == ("IN_PROGRESS" if retry is not None else "DONE_WITH_EVIDENCE")
                 and all(work.operation_states[part["operation"]] == expected_states[part["operation"]] and
                         work.operation_evidence[part["operation"]] == part["original_operation_evidence"]
                         for part in _plan_parts(doc)),
                 "QUALITY_CORRECTION_APPLY_STATE_INVALID")
        _check_approval(row)
        info = _fresh_source(state, work, source, actor, at)
        _plan_ready(state, work, doc)
        plan = _plan_reservations(work, doc)
        state.capacity_ledger.reserve_amendment_plan(work.key, plan)
        state.allocations.extend((r.resource, work.key, r.start, r.end) for r in plan)
        row["used_refs"][source] = info
        row["status"] = "APPROVED"
        row["applied_at"] = at
        if retry is not None:
            old = work.assurance_corrections[-1]
            old["status"] = "SUPERSEDED_BY_MATERIAL_RETRY"
            old["superseded_at"] = at
            old["superseded_by"] = doc["id"]
            old["failed_material_snapshot"] = deepcopy(retry)
        work.assurance_corrections.append(row)
        work.assurance_correction_proposal = None
        if "plan" in doc:
            row["operations"] = {part["operation"]: {"status": "PLANNED"}
                                 for part in doc["plan"]}
        for part in _plan_parts(doc):
            work.operation_states[part["operation"]] = "CORRECTION_PLANNED"
        _apply_material_generation(work, row)
        work.execution = "IN_PROGRESS"
    elif action in {"quality_correction_start", "quality_correction_complete"}:
        _check_approval(row)
        operation = event.get("operation", doc.get("operation"))
        part = next((part for part in _plan_parts(doc) if part["operation"] == operation), None)
        _require(part is not None, "QUALITY_CORRECTION_PLANNED_OPERATION_REQUIRED")
        executed = row["operations"][operation] if "plan" in doc else row
        _require(actor == part["owner"], "QUALITY_CORRECTION_ORIGINAL_OPERATION_OWNER_REQUIRED")
        if action == "quality_correction_start":
            _require(row["status"] in {"APPROVED", "IN_PROGRESS"}
                     and row["applied_at"] < at and part["start"] <= at < part["end"]
                     and work.operation_states[operation] == "CORRECTION_PLANNED"
                     and executed.get("started_at") is None,
                     "QUALITY_CORRECTION_START_STATE_OR_WINDOW_INVALID")
            op = next(o for o in work.operations if o.key == operation)
            _require(all(work.operation_states[pred] == "COMPLETED"
                         for pred in op.requires_completed), "QUALITY_CORRECTION_PREDECESSOR_INCOMPLETE")
            _require(all(work.handoff_states[h.edge] == "RECEIVED" for h in work.handoffs
                         if h.downstream == operation), "QUALITY_CORRECTION_NEW_HANDOFF_RECEIPT_REQUIRED")
            if state.material_strict:
                assert_inbound_ready(work.material_batches, work.material_states, operation)
            _resource_ready(state, work, part, reserved=True)
            info = _fresh_source(state, work, source, actor, at)
            cost_ref = event.get("quality_correction_cost_ref")
            cost_info = _fresh_source(state, work, cost_ref, actor, at)
            _require(source != cost_ref and
                     _fmt(_money(event.get("quality_correction_cost"),
                                 "QUALITY_CORRECTION_ACTUAL_COST_REQUIRED", positive=True)) == part["cost_claim"],
                     "QUALITY_CORRECTION_COST_DIFFERS_FROM_AGREED_CLAIM")
            row["used_refs"].update({source: info, cost_ref: cost_info})
            row["status"] = "IN_PROGRESS"
            row.setdefault("started_at", at)
            executed["status"] = "IN_PROGRESS"
            executed["started_at"] = at
            executed["additional_resource_use_claim"] = {
                "owner": actor, "source_ref": cost_ref, "source_revision": cost_info["revision"],
                "amount": part["cost_claim"], "currency": doc["currency"],
                "at": at, "bank_payment_proved": False,
            }
            work.operation_states[operation] = "CORRECTION_RUNNING"
        else:
            _require(row["status"] == "IN_PROGRESS" and executed.get("started_at") is not None
                     and executed["started_at"] < at <= part["end"]
                     and work.operation_states[operation] == "CORRECTION_RUNNING",
                     "QUALITY_CORRECTION_COMPLETE_STATE_OR_WINDOW_INVALID")
            _resource_ready(state, work, part, reserved=True)
            info = _fresh_source(state, work, source, actor, at)
            row["used_refs"][source] = info
            executed["status"] = "COMPLETED"
            executed["completed_at"] = at
            executed["operation_evidence"] = source
            work.operation_states[operation] = "COMPLETED"
            work.operation_evidence[operation] = source
            if all(work.operation_states[p["operation"]] == "COMPLETED" for p in _plan_parts(doc)):
                row["status"] = "COMPLETED"
                row["completed_at"] = at
                if "plan" in doc:
                    row["operation_evidence"] = {p["operation"]: row["operations"][p["operation"]]["operation_evidence"]
                                                 for p in doc["plan"]}
                if "handoffs_before" in doc:
                    row["handoffs_after"] = _handoff_snapshot(work, doc["dependency_scope"])
                    row["materials_after"] = _material_snapshot(work, doc["dependency_scope"])
                work.execution = "DONE_WITH_EVIDENCE"

    else:
        raise AssuranceBlocked("QUALITY_CORRECTION_UNKNOWN_ACTION")
    return {"quality_correction_id": ident, "quality_correction_state": row["status"],
            "quality_correction_fingerprint": row["fingerprint"],
            "quality_correction_source_ref": source,
            "quality_correction_additional_resource_use_claim": deepcopy(
                executed.get("additional_resource_use_claim")
                if action in {"quality_correction_start", "quality_correction_complete"} else None),
            **({"quality_correction_operation": operation} if "plan" in doc and
               action in {"quality_correction_start", "quality_correction_complete"} else {}),
            **({"quality_correction_retry_of": doc["material_retry"]["id"]}
               if "material_retry" in doc else {}),
            "original_work_not_replaced": True}


def qualified_resubmission(state: Any, work: Any, event: Mapping[str, Any],
                           at: int) -> dict[str, Any] | None:
    """A new Result reference is not evidence that failed work was corrected."""
    if not failed_criteria(work):
        return None
    row = work.assurance_corrections[-1] if work.assurance_corrections else None
    _require(row is not None and row["status"] == "COMPLETED"
             and row["terms"]["rejected_result"] == work.result_ref
             and event.get("quality_correction_id") == row["terms"]["id"]
             and event.get("quality_correction_fingerprint") == row["fingerprint"]
             and at > row["completed_at"]
             and _correction_execution_current(state, work, row),
             "QUALITY_FAILED_RESULT_REQUIRES_EXECUTED_CORRECTION")
    _proposal_current(state, work, row, at)
    _check_approval(row)
    return row


def assert_current_quality_evidence(state: Any, work: Any, at: int) -> None:
    """Current original rights are checked at acceptance, not retroactively."""
    physical = next((r for r in reversed(work.assurance_corrections)
                     if r.get("resubmitted_result_ref") == work.result_ref), None)
    if physical is not None:
        _correction_sources_current(state, physical, at)
        _correction_rights_current(state, work, physical, at)
        _require(fingerprint(physical["terms"]) == physical["fingerprint"]
                 and physical["status"] == "RESUBMITTED"
                 and _correction_execution_current(state, work, physical),
                 "QUALITY_CORRECTION_EXECUTED_ATTEMPT_NOT_CURRENT")
        _check_approval(physical)
    for criterion in work.assurance_criteria:
        review = work.assurance_reviews.get(criterion.key)
        if not review or review["result_ref"] != work.result_ref:
            continue
        change = review.get("reassessment")
        if change is not None:
            _require(_owned_source(state, change["error_ref"], criterion.assessor, at)
                     == change["error_source_revision"] and
                     _owned_source(state, review["model_ref"], criterion.assessor, at)
                     == change["assessment_source_revision"],
                     "QUALITY_REASSESSMENT_SOURCE_REVISION_STALE")
        if physical is not None:
            _require(review.get("physical_correction_id") == physical["terms"]["id"] and
                     _owned_source(state, review["model_ref"], criterion.assessor, at)
                     == review.get("assessment_source_revision"),
                     "QUALITY_CORRECTION_NEW_ASSESSMENT_SOURCE_STALE")
