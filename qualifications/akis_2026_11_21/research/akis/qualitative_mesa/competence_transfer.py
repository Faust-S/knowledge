"""AKIS M3.3: scoped owner permission evidence. MODEL_ONLY, never a legal licence."""
from __future__ import annotations

from typing import Any, Mapping, Sequence
from .scope_policy import check_scope


class CompetencePermissionInputError(ValueError):
    pass


FIELDS = {"claim_id", "holder", "recipient", "competence_ref", "source_id",
          "source_revision", "grant_ref", "recipient_ack_ref", "work", "metric",
          "valid_from", "valid_until"}


def _id(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 180:
        raise CompetencePermissionInputError("REUSE_PERMISSION_INVALID_ID")
    return value


def review_permissions(raw: Any, state: Any,
                       claims: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    if not isinstance(raw, list) or len(raw) > 128:
        raise CompetencePermissionInputError("REUSE_PERMISSION_INVALID_LIST")
    declared = {row["id"]: row for row in claims}
    grants: dict[str, dict] = {}
    for row in raw:
        if not isinstance(row, dict) or set(row) != FIELDS:
            raise CompetencePermissionInputError("REUSE_PERMISSION_INVALID_FIELDS")
        key = _id(row["claim_id"])
        if key not in declared or key in grants:
            raise CompetencePermissionInputError("REUSE_PERMISSION_UNKNOWN_OR_DUPLICATE_CLAIM")
        for field in FIELDS - {"valid_from", "valid_until"}:
            _id(row[field])
        h, r = row["holder"], row["recipient"]
        if h not in state.subjects or r not in state.subjects:
            raise CompetencePermissionInputError("REUSE_PERMISSION_UNKNOWN_PRINCIPAL")
        if not row["grant_ref"].startswith(f"model://{h}/") or not row["recipient_ack_ref"].startswith(f"model://{r}/"):
            raise CompetencePermissionInputError("REUSE_PERMISSION_OWNER_EVIDENCE_MISMATCH")
        a,b=row["valid_from"],row["valid_until"]
        if type(a) is not int or type(b) is not int or not 0 <= a < b <= 10000:
            raise CompetencePermissionInputError("REUSE_PERMISSION_INVALID_INTERVAL")
        grants[key]=row
    out={}
    for key, claim in declared.items():
        h,r=claim["actor"],claim.get("recipient",claim["actor"])
        if h==r:
            if key in grants:
                raise CompetencePermissionInputError("REUSE_PERMISSION_NO_INTERFIRM_TRANSFER")
            out[key]={"status":"MODEL_SELF_USE", "qualified":True,
                      "legal_licence_verified":False,"reasons":[]}
            continue
        reasons=[]
        grant=grants.get(key)
        if grant is None:
            reasons.append("REUSE_INTERFIRM_OWNER_PERMISSION_MISSING")
        else:
            if (grant["holder"],grant["recipient"],grant["competence_ref"],
                grant["work"],grant["metric"]) != (h,r,claim["competence_ref"],
                                                    claim["later_work"],claim["metric"]):
                reasons.append("REUSE_PERMISSION_SCOPE_MISMATCH")
            if not grant["valid_from"] <= claim["applied_at"] < grant["valid_until"]:
                reasons.append("REUSE_PERMISSION_TIME_INVALID")
            source=(state.context_basis.sources.get(grant["source_id"])
                    if state.context_basis is not None else None)
            if source is None or source.owner != h:
                reasons.append("REUSE_PERMISSION_ORIGINAL_SOURCE_MISSING")
            else:
                if source.revision != grant["source_revision"]:
                    reasons.append("REUSE_PERMISSION_SOURCE_REVISION_STALE")
                if source.status != "CONFIRMED" or not {h,r} <= set(source.usable_by):
                    reasons.append("REUSE_PERMISSION_SOURCE_NOT_USABLE_BY_BOTH")
                if source.valid_until is not None and source.valid_until < claim["applied_at"]:
                    reasons.append("REUSE_PERMISSION_SOURCE_EXPIRED")
                if source.scope is None:
                    reasons.append("REUSE_PERMISSION_EXPLICIT_SOURCE_SCOPE_REQUIRED")
                elif check_scope(
                    source.scope, core=source.scope.core,
                    purpose="competence-reuse", operation="SHARE",
                    at=claim["applied_at"]
                ) != "MODEL_SOURCE_SCOPE_CONSISTENT":
                    reasons.append("REUSE_PERMISSION_CONTEXT_SCOPE_MISMATCH")
        out[key]={"status":("MODEL_SOURCE_SCOPED_OWNER_TRANSFER" if not reasons
                             else "MODEL_PERMISSION_NOT_QUALIFIED"),
                  "qualified":not reasons,"legal_licence_verified":False,
                  "original_participant_consents_unchanged":True,"reasons":reasons}
    return out
