"""R1-V2C3: transfer original employee/division affiliation between SMEs.

Pure independent-decision qualification over ONE original QualitativeAKIS.
There is no personnel registry, workforce IAM, resource transfer, surrogate
Work or Result. Accepted obligations retain their original principals.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping


class AffiliationBlocked(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def affiliation_fingerprint(value: Any) -> str:
    try:
        encoded = json.dumps(
            value, sort_keys=True, ensure_ascii=False,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise AffiliationBlocked("AFFILIATION_DOCUMENT_INVALID") from exc
    return hashlib.sha256(encoded).hexdigest()


def _ref(value: Any, owner: str, reason: str) -> str:
    prefix = f"model://{owner}/"
    if (not isinstance(value, str) or not value.startswith(prefix)
            or not len(prefix) < len(value) <= 128):
        raise AffiliationBlocked(reason)
    return value


def _name(value: Any, reason: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 128:
        raise AffiliationBlocked(reason)
    return value


def _proposal(trace: Any, ident: Any) -> Mapping[str, Any]:
    ident = _name(ident, "AFFILIATION_TRANSFER_ID_REQUIRED")
    rows = [row for row in trace
            if row.get("action") == "affiliation_transfer_propose"
            and row.get("outcome") == "APPLIED"
            and row.get("affiliation_transfer_id") == ident]
    if len(rows) != 1:
        raise AffiliationBlocked("AFFILIATION_ORIGINAL_SELF_PROPOSAL_REQUIRED")
    return rows[0]


def _document(ev: Mapping[str, Any]) -> dict[str, Any]:
    fields = (
        "affiliation_transfer_id", "role_target", "from_enterprise",
        "to_enterprise", "old_affiliation_source_ref",
        "new_affiliation_source_ref", "self_role_source_ref",
        "pilot_work", "pilot_result_ref", "pilot_decision_at",
        "org_revision",
    )
    return {key: ev.get(key) for key in fields}


def qualify_affiliation_transfer(
    state: Any, ev: Mapping[str, Any], at: int
) -> dict[str, Any]:
    """Verify proposer, prior result, both independently deciding enterprises."""
    action = ev["action"]
    ins = state.institution
    if ev.get("org_revision") != ins.revision:
        raise AffiliationBlocked("AFFILIATION_ORIGINAL_CODE_REVISION_STALE")
    ident = _name(
        ev.get("affiliation_transfer_id"),
        "AFFILIATION_TRANSFER_ID_REQUIRED",
    )
    if action == "affiliation_transfer_propose":
        subject = ev.get("role_target")
        role = state.subjects.get(subject) if isinstance(subject, str) else None
        if (role is None or role.kind not in {"EMPLOYEE", "DIVISION"}
                or not role.active or ev["actor"] != subject):
            raise AffiliationBlocked("AFFILIATION_ORIGINAL_ROLE_SELF_DECISION_REQUIRED")
        previous = role.organization
        target = ev.get("to_enterprise")
        new_parent = (
            state.subjects.get(target) if isinstance(target, str) else None
        )
        if (previous != ev.get("from_enterprise")
                or previous == target or new_parent is None
                or new_parent.kind != "SME" or not new_parent.active):
            raise AffiliationBlocked("AFFILIATION_OLD_NEW_ENTERPRISE_REQUIRED")
        _ref(ev.get("old_affiliation_source_ref"), previous,
             "AFFILIATION_PRIOR_ENTERPRISE_SOURCE_REQUIRED")
        _ref(ev.get("new_affiliation_source_ref"), target,
             "AFFILIATION_NEW_ENTERPRISE_SOURCE_REQUIRED")
        _ref(ev.get("self_role_source_ref"), subject,
             "AFFILIATION_ORIGINAL_SELF_ROLE_SOURCE_REQUIRED")
        if (ev["old_affiliation_source_ref"] != role.affiliation_source_ref
                or ev["self_role_source_ref"] != role.self_role_source_ref):
            raise AffiliationBlocked("AFFILIATION_ORIGINAL_SOURCE_REVISION_CHANGED")
        _ref(ev.get("transfer_source_ref"), subject,
             "AFFILIATION_SELF_DECISION_SOURCE_REQUIRED")
        pilot = state.works.get(ev.get("pilot_work"))
        accepted = [
            row for row in state.trace
            if row.get("action") == "accept"
            and row.get("outcome") == "APPLIED"
            and row.get("work") == ev.get("pilot_work")
            and row.get("at") == ev.get("pilot_decision_at")
            and type(row.get("at")) is int and row["at"] < at
        ]
        if (pilot is None or pilot.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                or pilot.result_ref != ev.get("pilot_result_ref")
                or subject not in (
                    state.capacity_ledger.original_owners(
                        pilot.resource_requirements
                    ) | {pilot.customer}
                )
                or len(accepted) != 1):
            raise AffiliationBlocked("AFFILIATION_ACCEPTED_ORIGINAL_ROLE_PILOT_REQUIRED")
        expiry = ev.get("transfer_valid_until")
        if type(expiry) is not int or not at < expiry <= 10000:
            raise AffiliationBlocked("AFFILIATION_FRESH_DECISION_WINDOW_REQUIRED")
        if any(row.get("action") == action and row.get("outcome") == "APPLIED"
               and (row.get("affiliation_transfer_id") == ident
                    or row.get("role_target") == subject
                    and not any(applied.get("action") == "affiliation_transfer_apply"
                                and applied.get("outcome") == "APPLIED"
                                and applied.get("affiliation_transfer_id") ==
                                    row.get("affiliation_transfer_id")
                                for applied in state.trace))
               for row in state.trace):
            raise AffiliationBlocked("AFFILIATION_PENDING_OR_DUPLICATE_ROLE_TRANSFER")
        document = _document(ev)
        sha = affiliation_fingerprint(document)
        if ev.get("transfer_fingerprint") != sha:
            raise AffiliationBlocked("AFFILIATION_ORIGINAL_DOCUMENT_FINGERPRINT_MISMATCH")
        return {
            **document,
            "transfer_fingerprint": sha,
            "transfer_valid_until": expiry,
            "transfer_source_ref": ev["transfer_source_ref"],
            "original_role_not_transferred_by_proposal": True,
        }
    proposal = _proposal(state.trace, ident)
    if (ev.get("transfer_fingerprint") != proposal["transfer_fingerprint"]
            or type(proposal.get("at")) is not int
            or not proposal["at"] < at < proposal["transfer_valid_until"]):
        raise AffiliationBlocked("AFFILIATION_ORIGINAL_SOURCE_CONTENT_OR_TIME_STALE")
    subject = proposal["role_target"]
    role = state.subjects.get(subject)
    if (role is None or not role.active or
            role.organization != proposal["from_enterprise"] or
            role.affiliation_source_ref != proposal["old_affiliation_source_ref"]):
        raise AffiliationBlocked("AFFILIATION_ORIGINAL_PARENT_OR_ROLE_CHANGED")
    if action == "affiliation_transfer_review":
        actor = ev["actor"]
        if actor not in {
            proposal["from_enterprise"], proposal["to_enterprise"]
        } or not state.subjects[actor].active:
            raise AffiliationBlocked("AFFILIATION_INDEPENDENT_ENTERPRISE_REQUIRED")
        expected_ref = (
            proposal["old_affiliation_source_ref"]
            if actor == proposal["from_enterprise"]
            else proposal["new_affiliation_source_ref"]
        )
        if ev.get("transfer_parent_source_ref") != expected_ref:
            raise AffiliationBlocked("AFFILIATION_PARENT_SOURCE_DOES_NOT_MATCH_PROPOSAL")
        _ref(ev.get("transfer_decision_source_ref"), actor,
             "AFFILIATION_OWNER_DECISION_SOURCE_REQUIRED")
        if ev.get("transfer_decision") not in {
            "SUPPORT_ORIGINAL_TRANSFER", "OBJECT_ORIGINAL_TRANSFER",
        }:
            raise AffiliationBlocked("AFFILIATION_INDEPENDENT_POSITION_REQUIRED")
        if any(row.get("action") == action and row.get("outcome") == "APPLIED"
               and row.get("affiliation_transfer_id") == ident
               and row.get("actor") == actor for row in state.trace):
            raise AffiliationBlocked("AFFILIATION_DUPLICATE_ENTERPRISE_DECISION")
        return {
            "affiliation_transfer_id": ident, "role_target": subject,
            "transfer_decision": ev["transfer_decision"],
            "transfer_parent_source_ref": expected_ref,
            "transfer_decision_source_ref": ev["transfer_decision_source_ref"],
            "original_independent_enterprise_review": True,
        }
    if action != "affiliation_transfer_apply" or ev["actor"] != ins.operator:
        raise AffiliationBlocked("AFFILIATION_OPERATOR_APPLY_ONLY_AFTER_REVIEWS")
    if any(row.get("action") == action and row.get("outcome") == "APPLIED"
           and row.get("affiliation_transfer_id") == ident for row in state.trace):
        raise AffiliationBlocked("AFFILIATION_ALREADY_APPLIED")
    expected = {proposal["from_enterprise"], proposal["to_enterprise"]}
    positions = {
        row["actor"]: row["transfer_decision"]
        for row in state.trace
        if row.get("action") == "affiliation_transfer_review"
        and row.get("outcome") == "APPLIED"
        and row.get("affiliation_transfer_id") == ident
        and row.get("transfer_fingerprint") ==
            proposal["transfer_fingerprint"]
        and proposal["at"] < row["at"] < at and row.get("actor") in expected
    }
    if set(positions) != expected:
        raise AffiliationBlocked("AFFILIATION_BOTH_ENTERPRISE_DECISIONS_REQUIRED")
    if any(v != "SUPPORT_ORIGINAL_TRANSFER" for v in positions.values()):
        raise AffiliationBlocked("AFFILIATION_OLD_OR_NEW_ENTERPRISE_OBJECTED")
    # New membership cannot eliminate previously accepted, unfinished Work.
    for work in state.works.values():
        if (work.obligation != "NOT_ACCEPTED"
                and work.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                and subject in (
                    state.capacity_ledger.original_owners(
                        work.resource_requirements
                    ) | {work.customer}
                )):
            raise AffiliationBlocked("AFFILIATION_UNFINISHED_ORIGINAL_OBLIGATION")
    return {
        "affiliation_transfer_id": ident,
        "role_target": subject,
        "original_from_enterprise": proposal["from_enterprise"],
        "original_to_enterprise": proposal["to_enterprise"],
        "old_affiliation_source_ref": proposal["old_affiliation_source_ref"],
        "new_affiliation_source_ref": proposal["new_affiliation_source_ref"],
        "original_prior_Work_Result_and_obligation_immutable": True,
        "new_organization_for_future_work_only": True,
        "no_enterprise_resource_property_transfer": True,
    }
