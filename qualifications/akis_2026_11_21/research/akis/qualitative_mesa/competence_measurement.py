"""AKIS M3.3: source-scoped measurement protocol and declared uncertainty.

A measurement protocol supplied by a synthetic owner is not an independent
calibration, technical standard, laboratory report or causal research design.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Mapping, Sequence
from .competence_reuse import _number
from .scope_policy import check_scope


class MeasurementProtocolInputError(ValueError):
    pass


FIELDS = {
    "claim_id", "assessor", "source_id", "source_revision",
    "standard_ref", "method_ref", "calibration_chain_ref",
    "uncertainty_before", "uncertainty_after", "assessment_at",
}


def review_measurement_protocols(raw: Any, state: Any,
                                 original_claims: Sequence[Mapping[str, Any]],
                                 reuse_view: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, list) or len(raw) > 128:
        raise MeasurementProtocolInputError("MEASUREMENT_PROTOCOL_INVALID_LIST")
    claims = {row["id"]: row for row in original_claims}
    reuse = {row["id"]: row for row in reuse_view["links"]}
    rows = []
    seen = set()
    for proof in raw:
        if not isinstance(proof, dict) or set(proof) != FIELDS:
            raise MeasurementProtocolInputError("MEASUREMENT_PROTOCOL_FIELDS_INVALID")
        key=proof["claim_id"]
        if not isinstance(key,str) or key not in claims or key in seen:
            raise MeasurementProtocolInputError("MEASUREMENT_PROTOCOL_UNKNOWN_OR_DUPLICATE_CLAIM")
        seen.add(key)
        claim=claims[key]
        current=reuse[key]
        assessor=proof["assessor"]
        if not isinstance(assessor,str) or assessor not in state.subjects:
            raise MeasurementProtocolInputError("MEASUREMENT_PROTOCOL_UNKNOWN_ASSESSOR")
        for name in ("standard_ref", "method_ref", "calibration_chain_ref"):
            ref=proof[name]
            if not isinstance(ref,str) or not ref.startswith(f"model://{assessor}/") or len(ref)>180:
                raise MeasurementProtocolInputError("MEASUREMENT_PROTOCOL_REF_NOT_ASSESSOR_SOURCE")
        if not isinstance(proof["source_id"],str) or not isinstance(proof["source_revision"],str):
            raise MeasurementProtocolInputError("MEASUREMENT_PROTOCOL_SOURCE_FIELDS_INVALID")
        at=proof["assessment_at"]
        if type(at) is not int or not 0 <= at <= 10000:
            raise MeasurementProtocolInputError("MEASUREMENT_PROTOCOL_TIME_INVALID")
        try:
            before=_number(proof["uncertainty_before"])
            after=_number(proof["uncertainty_after"])
        except Exception as exc:
            raise MeasurementProtocolInputError("MEASUREMENT_PROTOCOL_UNCERTAINTY_INVALID") from exc
        reasons=[]
        later=state.works[claim["later_work"]]
        if assessor != later.customer or assessor in (claim["actor"], claim.get("recipient",claim["actor"])):
            reasons.append("MEASUREMENT_ASSESSOR_NOT_INDEPENDENT_RECIPIENT")
        if current["model_claim_status"]!="MODEL_REPORTED_COMPARABLE_REUSE_SEQUENCE":
            reasons.append("MEASUREMENT_ORIGINAL_REUSE_SEQUENCE_UNQUALIFIED")
        if later.result!="ACCEPTED_BY_ORIGINAL_RECIPIENT" or current["later_accepted_at"] is None or at <= current["later_accepted_at"]:
            reasons.append("MEASUREMENT_AFTER_ACCEPTED_RESULT_NOT_DECLARED")
        source=(state.context_basis.sources.get(proof["source_id"])
                if state.context_basis is not None else None)
        if source is None or source.owner != assessor:
            reasons.append("MEASUREMENT_ASSESSOR_SOURCE_NOT_QUALIFIED")
        else:
            if source.revision != proof["source_revision"]:
                reasons.append("MEASUREMENT_SOURCE_REVISION_CHANGED")
            if source.status!="CONFIRMED" or assessor not in source.usable_by:
                reasons.append("MEASUREMENT_SOURCE_NOT_CURRENTLY_USABLE")
            if source.valid_until is not None and source.valid_until < at:
                reasons.append("MEASUREMENT_SOURCE_EXPIRED_AT_REVIEW")
            if source.scope is not None and check_scope(
                source.scope, core=source.scope.core,
                purpose="quality-verification",operation="ACCEPT",at=at
            )!="MODEL_SOURCE_SCOPE_CONSISTENT":
                reasons.append("MEASUREMENT_SOURCE_SCOPE_NOT_QUALIFIED")
        old=claim["independent_baseline"]
        new=claim["subsequent_observation"]
        delta=(Decimal(old["value"])-Decimal(new["value"])
               if claim["direction"]=="LOWER_IS_BETTER" else
               Decimal(new["value"])-Decimal(old["value"]))
        bound=before+after
        status=("MODEL_DECLARED_DIFFERENCE_ABOVE_SUMMED_UNCERTAINTY" if delta>bound
                else "MODEL_DECLARED_DIFFERENCE_NOT_SEPARATED_BY_UNCERTAINTY")
        if reasons:
            status="MEASUREMENT_PROTOCOL_SOURCE_OR_SEQUENCE_UNQUALIFIED"
        rows.append({
            "claim_id":key,
            "assessor_original_customer":assessor,
            "model_status":status,
            "declared_favourable_metric_difference":f"{delta:.4f}" if not reasons else None,
            "declared_sum_uncertainty":f"{bound:.4f}",
            "individual_declared_uncertainties":{"before":f"{before:.4f}","after":f"{after:.4f}"},
            "standard_ref":proof["standard_ref"],
            "method_ref":proof["method_ref"],
            "calibration_chain_claim_ref":proof["calibration_chain_ref"],
            "measurement_source":proof["source_id"],
            "model_scope_reasons":reasons,
            "accredited_lab_or_real_traceability_verified":False,
            "statistical_significance_or_causality_established":False,
        })
    return {
        "status":"RESEARCH_CLAIMED_PROTOCOLS_NOT_INDEPENDENT_FIELD_MEASUREMENTS",
        "protocols":rows,"original_result_history_unchanged":True,
        "real_standards_compliance": "NOT_ESTABLISHED",
        "measurements_independently_authenticated":False,
        "actual_competence_causal_effect":"NOT_IDENTIFIABLE",
    }
