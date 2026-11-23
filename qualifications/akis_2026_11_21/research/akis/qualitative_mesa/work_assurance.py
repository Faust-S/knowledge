"""Work-specific original quality assurance inside one existing AKIS Work/Result.

Research MODEL_ONLY assertions are not laboratory measurements, accredited
certification, legal liability, a new Result, or proof of economic savings.
Original independent recipient assesses declared criteria against the current
submitted Result; any new submission needs fresh assessments.
"""
from __future__ import annotations

from dataclasses import dataclass
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


def assess_result_quality(work: Any, event: Mapping[str, Any]) -> None:
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
    if verdict not in {"MEETS_DECLARED_REQUIREMENT", "DOES_NOT_MEET"}:
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
    # All checks before mutation: a blocked event never changes an assessment.
    work.assurance_refs.add(reference)
    review = {
        "result_ref": work.result_ref, "work_revision": work.source_revision,
        "commitment_org_revision": work.commitment_org_revision,
        "verdict": verdict, "model_ref": reference,
    }
    if responsibility is not None:
        review["effective_responsible_owner"] = responsibility["effective_owner"]
        review["responsibility_revision"] = responsibility["wip_id"]
    work.assurance_reviews[criterion.key] = review


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
