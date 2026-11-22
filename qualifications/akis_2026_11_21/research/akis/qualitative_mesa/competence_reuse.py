"""M3.2 read-only capability-reuse evidence over original Work, Result and ledger.

All input claims remain MODEL_ONLY. A signed Result, a stated use of experience,
or a favourable before/after metric is not independently verified learning,
causality, profit or a new right to reuse someone else's intellectual property.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re
from typing import Any, Mapping, Sequence

from .work_assurance import acceptance_gate


class ReuseInputError(ValueError):
    """Malformed source-bound research claim, not an original Work rejection."""


KINDS = frozenset({"TECHNOLOGY", "PROCESS", "QUALITY", "ORGANIZATION"})
METRICS = frozenset({"RESOURCE_PER_UNIT", "LABOR_TIME_PER_UNIT", "LEAD_TIME",
                     "DEFECT_RATE", "SERVICE_LEVEL", "SOURCE_DECLARED_COST_PER_UNIT"})
DIRECTIONS = frozenset({"LOWER_IS_BETTER", "HIGHER_IS_BETTER"})
AMOUNT = re.compile(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,4})?\Z")
MAX_CLAIMS = 128


def _text(value: Any, code: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 180:
        raise ReuseInputError(code)
    return value


def _number(value: Any) -> Decimal:
    if not isinstance(value, str) or not AMOUNT.fullmatch(value):
        raise ReuseInputError("REUSE_MEASUREMENT_MUST_BE_EXACT_NONNEGATIVE_STRING")
    try:
        return Decimal(value)
    except InvalidOperation as exc:
        raise ReuseInputError("REUSE_MEASUREMENT_INVALID") from exc


def _measurement(raw: Any, owner: str) -> dict[str, Any]:
    fields = {"source_ref", "source_revision", "value", "unit", "quantity",
              "scope", "quality_basis"}
    if not isinstance(raw, dict) or set(raw) != fields:
        raise ReuseInputError("REUSE_MEASUREMENT_FIELDS_INVALID")
    reference = _text(raw["source_ref"], "REUSE_MEASUREMENT_SOURCE_INVALID")
    if not reference.startswith(f"model://{owner}/"):
        raise ReuseInputError("REUSE_MEASUREMENT_OWNER_SOURCE_REQUIRED")
    for field in ("source_revision", "unit", "scope", "quality_basis"):
        _text(raw[field], "REUSE_MEASUREMENT_" + field.upper() + "_INVALID")
    return {**raw, "_number": _number(raw["value"]),
            "_quantity": _number(raw["quantity"])}


def _original_owners(state: Any, work: Any) -> set[str]:
    return state.capacity_ledger.original_owners(work.resource_requirements)


def _original_event_at(trace: Sequence[Mapping[str, Any]], work: str,
                       action: str) -> int | None:
    times = [row["at"] for row in trace if row.get("work") == work and
             row.get("action") == action and row.get("outcome") == "APPLIED"]
    return max(times) if times else None


def _source_status(state: Any, claim: Mapping[str, Any]) -> str:
    basis = state.context_basis
    if basis is None:
        return "CONTEXT_SOURCE_NOT_QUALIFIED"
    item = basis.sources.get(claim["source_id"])
    if item is None or item.owner != claim["actor"]:
        return "CONTEXT_SOURCE_OWNER_NOT_QUALIFIED"
    if item.revision != claim["source_revision"]:
        return "CONTEXT_SOURCE_REVISION_CHANGED"
    if item.status != "CONFIRMED" or claim["actor"] not in item.usable_by:
        return "CONTEXT_SOURCE_NOT_CURRENTLY_USABLE"
    if item.valid_until is not None and item.valid_until < claim["applied_at"]:
        return "CONTEXT_SOURCE_EXPIRED_BEFORE_REUSE"
    if item.scope is not None:
        # A narrowed KPB context is not an automatic intellectual-property grant.
        from .scope_policy import check_scope
        scope = item.scope
        reason = check_scope(scope, core=scope.core, purpose="competence-reuse",
                             operation="DERIVE", at=claim["applied_at"])
        if reason != "MODEL_SOURCE_SCOPE_CONSISTENT":
            return "CONTEXT_SOURCE_SCOPE_NOT_QUALIFIED"
    return "MODEL_SOURCE_CURRENT_UNAUTHENTICATED"


def evaluate_competence_reuse(raw: Any, state: Any, *,
                              economics: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Conservative end-of-run projection over ONE original trace and economics.

    A claimed use must precede the later original start and follow acceptance of
    the preceding Result. No original Work, consent, cash or Result is changed.
    """
    if not isinstance(raw, list) or len(raw) > MAX_CLAIMS:
        raise ReuseInputError("REUSE_CLAIMS_INVALID_COUNT")
    fields = {"id", "prior_work", "later_work", "actor", "prior_result_ref",
              "competence_ref", "source_id", "source_revision", "applied_at",
              "kind", "metric", "direction", "independent_baseline",
              "subsequent_observation"}
    seen: set[str] = set()
    rows: list[dict[str, Any]] = []
    for claim in raw:
        if not isinstance(claim, dict) or set(claim) != fields:
            raise ReuseInputError("REUSE_CLAIM_FIELDS_INVALID")
        key = _text(claim["id"], "REUSE_CLAIM_ID_INVALID")
        if key in seen:
            raise ReuseInputError("REUSE_CLAIM_DUPLICATE")
        seen.add(key)
        prior_id = _text(claim["prior_work"], "REUSE_PRIOR_WORK_INVALID")
        later_id = _text(claim["later_work"], "REUSE_LATER_WORK_INVALID")
        owner = _text(claim["actor"], "REUSE_OWNER_INVALID")
        if prior_id == later_id or prior_id not in state.works or later_id not in state.works:
            raise ReuseInputError("REUSE_REQUIRES_TWO_ORIGINAL_WORKS")
        if owner not in state.subjects:
            raise ReuseInputError("REUSE_UNKNOWN_ORIGINAL_OWNER")
        if claim["kind"] not in KINDS or claim["metric"] not in METRICS or claim["direction"] not in DIRECTIONS:
            raise ReuseInputError("REUSE_KIND_OR_METRIC_INVALID")
        at = claim["applied_at"]
        if type(at) is not int or at < 0 or at > 10000:
            raise ReuseInputError("REUSE_APPLICATION_TIME_INVALID")
        _text(claim["source_id"], "REUSE_SOURCE_ID_INVALID")
        _text(claim["source_revision"], "REUSE_SOURCE_REVISION_INVALID")
        prior_ref = _text(claim["prior_result_ref"], "REUSE_PRIOR_RESULT_REF_INVALID")
        competence_ref = _text(claim["competence_ref"], "REUSE_COMPETENCE_REF_INVALID")
        if not competence_ref.startswith(f"model://{owner}/"):
            raise ReuseInputError("REUSE_COMPETENCE_ORIGINAL_OWNER_SOURCE_REQUIRED")
        baseline = _measurement(claim["independent_baseline"], owner)
        observed = _measurement(claim["subsequent_observation"], owner)
        old, new = state.works[prior_id], state.works[later_id]
        old_accept = _original_event_at(state.trace, prior_id, "accept")
        new_start = min((row["at"] for row in state.trace
                         if row.get("work") == later_id and row.get("action") in ("start", "start_operation")
                         and row.get("outcome") == "APPLIED"), default=None)
        new_accept = _original_event_at(state.trace, later_id, "accept")
        source_status = _source_status(state, claim)
        same_scope = all(baseline[x] == observed[x] for x in
                         ("unit", "quantity", "scope", "quality_basis"))
        original_owner = (owner in _original_owners(state, old) and
                          owner in _original_owners(state, new))
        reasons: list[str] = []
        if not original_owner:
            reasons.append("NO_CONTINUOUS_ORIGINAL_COMPETENCE_OWNER")
        if prior_id not in new.requires_accepted:
            reasons.append("NO_PREDECLARED_RESULT_DEPENDENCY")
        if old.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT" or old.result_ref != prior_ref or old_accept is None or old_accept >= at:
            reasons.append("PRIOR_ORIGINAL_RESULT_NOT_ACCEPTED_BEFORE_APPLICATION")
        if new_start is None or new_start <= at:
            reasons.append("NO_SUBSEQUENT_ORIGINAL_EXECUTION_AFTER_APPLICATION")
        if new.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT" or new_accept is None or (new_start is not None and new_accept <= new_start):
            reasons.append("SUBSEQUENT_ORIGINAL_RESULT_NOT_ACCEPTED")
        if source_status != "MODEL_SOURCE_CURRENT_UNAUTHENTICATED":
            reasons.append(source_status)
        if not same_scope or baseline["_quantity"] == 0:
            reasons.append("INDEPENDENT_COMPARATOR_NOT_EQUIVALENT")
        if old.assurance_criteria and acceptance_gate(old) != "NONE":
            reasons.append("PRIOR_QUALITY_ASSESSMENT_NOT_CURRENT")
        if new.assurance_criteria and acceptance_gate(new) != "NONE":
            reasons.append("SUBSEQUENT_QUALITY_ASSESSMENT_NOT_CURRENT")
        if old.customer != new.customer:
            reasons.append("CUSTOMER_REQUIREMENTS_DIFFER_NOT_INDEPENDENTLY_NORMALIZED")
        sufficient = not reasons
        signed_difference = ((baseline["_number"] - observed["_number"])
                             if claim["direction"] == "LOWER_IS_BETTER"
                             else (observed["_number"] - baseline["_number"]))
        rows.append({
            "id": key, "prior_work": prior_id, "later_work": later_id,
            "original_competence_owner": owner, "kind": claim["kind"],
            "metric": claim["metric"], "unit": baseline["unit"],
            "application_at_declared": at, "source_at_end": source_status,
            "prior_accepted_at": old_accept, "later_started_at": new_start,
            "later_accepted_at": new_accept,
            "model_claim_status": ("MODEL_REPORTED_COMPARABLE_REUSE_SEQUENCE" if sufficient
                                   else "REUSE_OR_COMPARABILITY_NOT_QUALIFIED"),
            "unqualified_reasons": reasons,
            "declared_metric_change_favourable_positive": (f"{signed_difference:.4f}" if sufficient else None),
            "source_measurement_refs": {"baseline": baseline["source_ref"],
                                        "subsequent": observed["source_ref"],
                                        "application": competence_ref},
            "prior_accepted_result_proves_causal_learning": False,
            "difference_proves_cooperation_effect": False,
            "legally_qualified_competence_licence": False,
        })
    statuses = economics.get("per_subject", {}) if economics else {}
    return {
        "evidence": "MODEL_ONLY_SOURCE_DECLARED_NOT_INDEPENDENTLY_AUTHENTICATED",
        "links": rows, "claimed_count": len(rows),
        "comparable_sequence_count": sum(r["model_claim_status"] == "MODEL_REPORTED_COMPARABLE_REUSE_SEQUENCE" for r in rows),
        "original_economic_ledger_reused": economics is not None,
        "independent_owner_comparison_available": {owner: item.get("cash_comparison") == "DECLARED_SCOPE_ARITHMETIC_ONLY"
                                                    for owner, item in statuses.items()},
        "operator_original_economic_comparison": {owner: item.get("cash_comparison", "NOT_IDENTIFIABLE")
                                                   for owner, item in statuses.items()
                                                   if state.subjects[owner].kind == "OPERATOR"},
        "network_declared_cash_comparison_available": bool(economics and economics.get("consolidated_comparable_declared")),
        "comparable_economic_scope_is_specific_to_reused_work": False,
        "original_cash_and_resource_uses_added": 0,
        "causal_competence_effect": "NOT_IDENTIFIABLE",
        "measured_productivity_in_field": False,
        "new_original_work_or_consent_created": False,
        "single_original_result_trace": True,
    }
