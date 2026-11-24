"""Work-specific original quality assurance inside one existing AKIS Work/Result.

Research MODEL_ONLY assertions are not laboratory measurements, accredited
certification, legal liability, a new Result, or proof of economic savings.
Original independent recipient assesses declared criteria against the current
submitted Result; any new submission needs fresh assessments.
"""
from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy

from .capacity import CapacityBlocked, ResourceNeed
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
            or any(ref in (row.get("cost_source_ref"), row.get("proposal_source"))
                   for row in work.wip_interruptions + work.wip_amendments)
            or any(ref in (lot.get("inspection_ref"), lot.get("claim_ref"),
                           lot.get("custody_dispatch_ref"), lot.get("custody_receipt_ref"),
                           lot.get("custody_quality_ref")) for lot in work.wip_lots)
            or any(ref in row.get("used_refs", {}) or
                   ref == row.get("terms", {}).get("original_operation_evidence") for row in
                   [*work.assurance_corrections,
                    *([work.assurance_correction_proposal]
                      if work.assurance_correction_proposal is not None else [])]))


def _fresh_source(state: Any, work: Any, ref: Any, owner: str, at: int) -> dict:
    revision = _owned_source(state, ref, owner, at)
    _require(not any(_ref_used(other, ref) for other in state.works.values()),
             "QUALITY_CORRECTION_SOURCE_ALREADY_USED")
    return {"owner": owner, "revision": revision}


def failed_criteria(work: Any) -> list[QualityCriterion]:
    return [c for c in work.assurance_criteria
            if work.assurance_reviews.get(c.key, {}).get("result_ref") == work.result_ref
            and work.assurance_reviews[c.key]["verdict"] == "DOES_NOT_MEET"]


def _current_reviews(work: Any) -> bool:
    return bool(work.assurance_criteria) and all(
        work.assurance_reviews.get(c.key, {}).get("result_ref") == work.result_ref
        and work.assurance_reviews[c.key]["work_revision"] == work.source_revision
        and work.assurance_reviews[c.key]["commitment_org_revision"] == work.commitment_org_revision
        for c in work.assurance_criteria
    )


def _terminal_operation(state: Any, work: Any, operation: Any) -> tuple[Any, str, str, int]:
    op = next((o for o in work.operations if o.key == operation), None)
    _require(op is not None and len(op.resource_requirements) == 1
             and op.resource_requirements[0].resource == op.primary_resource
             and not any(operation in o.requires_completed for o in work.operations)
             and not any(h.upstream == operation for h in work.handoffs),
             "QUALITY_CORRECTION_TERMINAL_SINGLE_RESOURCE_OPERATION_REQUIRED")
    resource = work.wip_operation_active_resources.get(op.key, op.primary_resource)
    return op, resource, state.resources[resource], op.resource_requirements[0].units


def _correction_sources_current(state: Any, row: Mapping[str, Any], at: int) -> None:
    for ref, info in {**row["terms"].get("prior_source_revisions", {}),
                      **row["used_refs"]}.items():
        _require(_owned_source(state, ref, info["owner"], at) == info["revision"],
                 "QUALITY_CORRECTION_SOURCE_REVISION_STALE")


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
    _, resource, owner, units = _terminal_operation(state, work, doc["operation"])
    _require((resource, owner, units) == (doc["resource"], doc["owner"], doc["units"]),
             "QUALITY_CORRECTION_ORIGINAL_RESOURCE_CHANGED")
    if work.assurance_responsibilities:
        assert_assurance_responsibility_current(state, work, at)
    _correction_sources_current(state, row, at)


def _check_approval(row: Mapping[str, Any]) -> None:
    _require(set(row["votes"]) == set(row["terms"]["required"]) and all(
        r["decision"] == "SUPPORT" for r in row["votes"].values()
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
        _require(actor == work.customer and work.assurance_correction_proposal is None
                 and work.execution == "DONE_WITH_EVIDENCE"
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
        operation = event.get("operation")
        _require(all(c.operation == operation for c in failed),
                 "QUALITY_CORRECTION_FAILED_OPERATION_SCOPE_REQUIRED")
        op, resource, owner, units = _terminal_operation(state, work, operation)
        _require(work.operation_states[operation] == "COMPLETED"
                 and operation in work.operation_evidence and owner != work.customer,
                 "QUALITY_CORRECTION_COMPLETED_INDEPENDENT_OPERATION_REQUIRED")
        if work.assurance_responsibilities:
            assert_assurance_responsibility_current(state, work, at)
        start, end = event.get("quality_correction_slot_start"), event.get("quality_correction_slot_end")
        expires = event.get("quality_correction_valid_until")
        _require(type(start) is int and type(end) is int and type(expires) is int
                 and at < expires <= start < end,
                 "QUALITY_CORRECTION_FUTURE_WINDOW_REQUIRED")
        amount = _fmt(_money(event.get("quality_correction_cost"),
                             "QUALITY_CORRECTION_ADDITIONAL_COST_REQUIRED", positive=True))
        currency = event.get("quality_correction_currency")
        _require(isinstance(currency, str) and len(currency) == 3
                 and currency.isascii() and currency.isupper() and currency.isalpha(),
                 "QUALITY_CORRECTION_CURRENCY_REQUIRED")
        source = event.get("quality_correction_source_ref")
        resource_ref = event.get("quality_correction_resource_ref")
        refs = {source: _fresh_source(state, work, source, work.customer, at),
                resource_ref: _fresh_source(state, work, resource_ref, owner, at)}
        prior = {}
        for criterion in work.assurance_criteria:
            for old_ref in (criterion.source_ref,
                            work.assurance_reviews[criterion.key]["model_ref"]):
                prior[old_ref] = {"owner": criterion.assessor,
                                  "revision": _owned_source(state, old_ref, criterion.assessor, at)}
        _require(source != resource_ref, "QUALITY_CORRECTION_DISTINCT_SOURCES_REQUIRED")
        required = sorted(set(work.consents) | {work.customer, owner}
                          | {c.assessor for c in work.assurance_criteria})
        doc = {
            "id": ident, "work": work.key, "rejected_result": work.result_ref,
            "scope": "TERMINAL_ORIGINAL_OPERATION_CORRECTION_ONLY",
            "operation": operation, "original_operation_evidence": work.operation_evidence[operation],
            "resource": resource, "owner": owner, "units": units,
            "start": start, "end": end, "expires": expires,
            "cost_claim": amount, "currency": currency,
            "source_ref": source, "resource_ref": resource_ref,
            "required": required, "reviews": deepcopy(work.assurance_reviews),
            "responsibilities": deepcopy(work.assurance_responsibilities),
            "source_revision": work.source_revision,
            "org_revision": state.institution.revision,
            "commitment_org_revision": work.commitment_org_revision,
            "source_revisions": deepcopy(refs), "prior_source_revisions": prior,
        }
        _resource_ready(state, work, doc, reserved=False)
        row = {"terms": doc, "fingerprint": fingerprint(doc), "votes": {},
               "used_refs": refs, "created_at": at, "status": "PROPOSED"}
        work.assurance_correction_proposal = row
        return {"quality_correction_id": ident, "quality_correction_fingerprint": row["fingerprint"],
                "quality_correction_required": required, "quality_correction_state": "PROPOSED"}
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
        _require(actor == work.customer and row["status"] == "PROPOSED"
                 and row["created_at"] < at <= doc["expires"]
                 and all(v["at"] < at for v in row["votes"].values())
                 and work.execution == "DONE_WITH_EVIDENCE"
                 and work.operation_states[doc["operation"]] == "COMPLETED"
                 and work.operation_evidence[doc["operation"]] == doc["original_operation_evidence"],
                 "QUALITY_CORRECTION_APPLY_STATE_INVALID")
        _check_approval(row)
        info = _fresh_source(state, work, source, actor, at)
        _resource_ready(state, work, doc, reserved=False)
        needs = [ResourceNeed(doc["resource"], doc["units"])]
        state.capacity_ledger.reserve_amendment(work.key, needs, doc["start"], doc["end"])
        state.allocations.append((doc["resource"], work.key, doc["start"], doc["end"]))
        row["used_refs"][source] = info
        row["status"] = "APPROVED"
        row["applied_at"] = at
        work.assurance_corrections.append(row)
        work.assurance_correction_proposal = None
        work.operation_states[doc["operation"]] = "CORRECTION_PLANNED"
        work.execution = "IN_PROGRESS"
    elif action == "quality_correction_start":
        _check_approval(row)
        _require(actor == doc["owner"] and row["status"] == "APPROVED"
                 and row["applied_at"] < at and doc["start"] <= at < doc["end"]
                 and work.operation_states[doc["operation"]] == "CORRECTION_PLANNED",
                 "QUALITY_CORRECTION_START_STATE_OR_WINDOW_INVALID")
        _resource_ready(state, work, doc, reserved=True)
        info = _fresh_source(state, work, source, actor, at)
        cost_ref = event.get("quality_correction_cost_ref")
        cost_info = _fresh_source(state, work, cost_ref, actor, at)
        _require(source != cost_ref and
                 _fmt(_money(event.get("quality_correction_cost"),
                             "QUALITY_CORRECTION_ACTUAL_COST_REQUIRED", positive=True)) == doc["cost_claim"],
                 "QUALITY_CORRECTION_COST_DIFFERS_FROM_AGREED_CLAIM")
        row["used_refs"].update({source: info, cost_ref: cost_info})
        row["status"] = "IN_PROGRESS"
        row["started_at"] = at
        row["additional_resource_use_claim"] = {
            "owner": actor, "source_ref": cost_ref, "source_revision": cost_info["revision"],
            "amount": doc["cost_claim"], "currency": doc["currency"],
            "at": at, "bank_payment_proved": False,
        }
        work.operation_states[doc["operation"]] = "CORRECTION_RUNNING"
    elif action == "quality_correction_complete":
        _check_approval(row)
        _require(actor == doc["owner"] and row["status"] == "IN_PROGRESS"
                 and row["started_at"] < at <= doc["end"]
                 and work.operation_states[doc["operation"]] == "CORRECTION_RUNNING",
                 "QUALITY_CORRECTION_COMPLETE_STATE_OR_WINDOW_INVALID")
        _resource_ready(state, work, doc, reserved=True)
        info = _fresh_source(state, work, source, actor, at)
        row["used_refs"][source] = info
        row["status"] = "COMPLETED"
        row["completed_at"] = at
        row["operation_evidence"] = source
        work.operation_states[doc["operation"]] = "COMPLETED"
        work.operation_evidence[doc["operation"]] = source
        work.execution = "DONE_WITH_EVIDENCE"
    else:
        raise AssuranceBlocked("QUALITY_CORRECTION_UNKNOWN_ACTION")
    return {"quality_correction_id": ident, "quality_correction_state": row["status"],
            "quality_correction_fingerprint": row["fingerprint"],
            "quality_correction_source_ref": source,
            "quality_correction_additional_resource_use_claim":
                deepcopy(row.get("additional_resource_use_claim")),
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
             and work.operation_evidence[row["terms"]["operation"]] == row["operation_evidence"],
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
        _require(fingerprint(physical["terms"]) == physical["fingerprint"]
                 and physical["status"] == "RESUBMITTED"
                 and work.operation_evidence.get(physical["terms"]["operation"]) ==
                     physical["operation_evidence"],
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
