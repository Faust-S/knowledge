"""R1-T4: source-checked NEW actor / own resource events on the ORIGINAL Mesa.

Pure qualification over QualitativeAKIS's existing subjects, resources and
original trace. There is no secondary identity registry, IAM, Work, Result,
scheduler, economic ledger or legally verified corporate identity.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping

from .capacity import CapacityInputError, parse_resource_capacity
from .context_basis import ContextBlocked


class RegistrationBlocked(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def registration_fingerprint(value: Any) -> str:
    try:
        payload = json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise RegistrationBlocked("REGISTRATION_MODEL_DOCUMENT_INVALID") from exc
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _src(v: Any, actor: str) -> None:
    prefix = f"model://{actor}/"
    if (not isinstance(v, str) or not v.startswith(prefix)
            or not len(prefix) < len(v) <= 180):
        raise RegistrationBlocked("REGISTRATION_INDEPENDENT_SOURCE_OWNER_REQUIRED")


def _id(v: Any) -> bool:
    return isinstance(v, str) and 0 < len(v.strip()) <= 128


def _proposal(trace: Any, action: str, key: Any, field: str):
    if not _id(key):
        raise RegistrationBlocked("REGISTRATION_ID_REQUIRED")
    rows = [r for r in trace
            if r.get("action") == action and r.get("outcome") == "APPLIED"
            and r.get(field) == key]
    if len(rows) != 1:
        raise RegistrationBlocked("REGISTRATION_ORIGINAL_PROPOSAL_REQUIRED")
    return rows[0]


def _original_reviewers(state: Any, entrant: str) -> set[str]:
    result = {p for p in state.institution.founders
              if p != state.institution.operator and p != entrant
              and p in state.subjects and state.subjects[p].active
              and state.subjects[p].kind == "SME"}
    if not result:
        raise RegistrationBlocked("REGISTRATION_INDEPENDENT_EXISTING_REVIEWERS_REQUIRED")
    return result


def _founder_positions(state: Any, proposal: Mapping[str, Any],
                       event_action: str, id_field: str,
                       fingerprint_field: str, at: int) -> None:
    expected = _original_reviewers(state, proposal["new_subject"])
    found: dict[str, str] = {}
    for item in state.trace:
        if (item.get("action") == event_action
                and item.get("outcome") == "APPLIED"
                and item.get(id_field) == proposal[id_field]
                and item.get(fingerprint_field) == proposal[fingerprint_field]
                and item.get("actor") in expected
                and proposal["at"] < item["at"] < at):
            found[item["actor"]] = item["registration_decision"]
    if set(found) != expected:
        raise RegistrationBlocked("REGISTRATION_ALL_INDEPENDENT_REVIEWS_REQUIRED")
    if any(x != "SUPPORT_MODEL_SOURCE" for x in found.values()):
        raise RegistrationBlocked("REGISTRATION_INDEPENDENT_REVIEW_OBJECTION")


def _current(state: Any, ev: Mapping[str, Any], proposal: Mapping[str, Any],
             at: int, fingerprint_field: str) -> None:
    if (ev.get("org_revision") != state.institution.revision
            or proposal.get("org_revision") != state.institution.revision
            or ev.get(fingerprint_field) != proposal.get(fingerprint_field)
            or type(proposal.get("at")) is not int
            or not proposal["at"] < at < proposal["registration_valid_until"]):
        raise RegistrationBlocked("REGISTRATION_SOURCE_CONTENT_OR_TIME_STALE")


def qualify_subject_registration(state: Any, ev: Mapping[str, Any],
                                 at: int) -> dict[str, Any]:
    action = ev["action"]
    operator = state.institution.operator
    if state.context_basis is not None and state.context_basis.strict:
        basis = state.context_basis
        if not basis.decision_requirements:
            raise RegistrationBlocked(
                "REGISTRATION_STRICT_CONTEXT_SOURCE_RIGHTS_NOT_QUALIFIED"
            )
        try:
            basis.assert_original_decision_rights(ev, at)
            if action.endswith("_apply"):
                basis.assert_original_decision_lineage(
                    state.trace, action,
                    ev.get("subject_registration_id" if action.startswith("subject_")
                           else "resource_registration_id"), at
                )
        except ContextBlocked as exc:
            raise RegistrationBlocked(exc.reason) from exc
    if ev.get("org_revision") != state.institution.revision:
        raise RegistrationBlocked("REGISTRATION_ORIGINAL_ORGANIZATIONAL_REVISION_REQUIRED")
    reg = ev.get("subject_registration_id")
    if not _id(reg):
        raise RegistrationBlocked("REGISTRATION_ID_REQUIRED")
    if action == "subject_registration_propose":
        subject = ev.get("new_subject")
        if (ev.get("actor") != operator or not _id(subject)
                or subject in state.subjects or subject == "COUNCIL"
                or len(state.subjects) >= 128
                or ev.get("new_subject_kind") != "SME"
                or any(row.get("subject_registration_id") == reg
                       and row.get("action") == action
                       and row.get("outcome") == "APPLIED"
                       for row in state.trace)):
            raise RegistrationBlocked("REGISTRATION_NEW_ORIGINAL_SME_REQUIRED")
        _src(ev.get("registration_source_ref"), operator)
        pilot = state.works.get(ev.get("pilot_work"))
        if (pilot is None or pilot.result != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                or ev.get("pilot_result_ref") != pilot.result_ref
                or not any(r.get("action") == "accept"
                           and r.get("outcome") == "APPLIED"
                           and r.get("work") == pilot.key
                           and r.get("at") == ev.get("pilot_decision_at")
                           and type(r.get("at")) is int and r["at"] < at
                           for r in state.trace)):
            raise RegistrationBlocked("REGISTRATION_ACCEPTED_ORIGINAL_PILOT_REQUIRED")
        expiry = ev.get("registration_valid_until")
        if type(expiry) is not int or not at < expiry <= 10000:
            raise RegistrationBlocked("REGISTRATION_FUTURE_VALIDITY_REQUIRED")
        record = {
            "subject_registration_id": reg,
            "new_subject": subject, "new_subject_kind": "SME",
            "pilot_work": pilot.key, "pilot_result_ref": pilot.result_ref,
            "pilot_decision_at": ev["pilot_decision_at"],
        }
        digest = registration_fingerprint(record)
        if ev.get("registration_fingerprint") != digest:
            raise RegistrationBlocked("REGISTRATION_SUBJECT_DOCUMENT_FINGERPRINT_MISMATCH")
        return {
            "new_subject": subject,
            "registration_valid_until": expiry,
            "registration_source_ref": ev["registration_source_ref"],
            "registration_fingerprint": digest,
            "pilot_work": pilot.key, "pilot_result_ref": pilot.result_ref,
            "pilot_decision_at": ev["pilot_decision_at"],
            "original_new_subject_not_yet_created": True,
        }
    proposal = _proposal(state.trace, "subject_registration_propose",
                         reg, "subject_registration_id")
    _current(state, ev, proposal, at, "registration_fingerprint")
    entrant = proposal["new_subject"]
    if entrant in state.subjects:
        raise RegistrationBlocked("REGISTRATION_DUPLICATE_OR_PREEXISTING_SUBJECT")
    if action == "subject_registration_attest":
        if ev.get("actor") != entrant:
            raise RegistrationBlocked("REGISTRATION_APPLICANT_SELF_ATTESTATION_REQUIRED")
        for field in ("registration_self_ref", "registration_goal_source_ref",
                      "registration_alternative_source_ref"):
            _src(ev.get(field), entrant)
        if ev.get("registration_willingness") not in {"WILLING", "DECLINES", "UNKNOWN"}:
            raise RegistrationBlocked("REGISTRATION_INDEPENDENT_PROSPECTIVE_POSITION_REQUIRED")
        if any(r.get("action") == action and r.get("outcome") == "APPLIED"
               and r.get("subject_registration_id") == reg for r in state.trace):
            raise RegistrationBlocked("REGISTRATION_DUPLICATE_INDEPENDENT_SELF_ATTESTATION")
        return {
            "new_subject": entrant, "registration_willingness":
                ev["registration_willingness"],
            "registration_self_ref": ev["registration_self_ref"],
            "registration_goal_source_ref": ev["registration_goal_source_ref"],
            "registration_alternative_source_ref":
                ev["registration_alternative_source_ref"],
            "unregistered_actor_self_claim_not_verified_identity": True,
        }
    if action == "subject_registration_review":
        actor = ev["actor"]
        if actor not in _original_reviewers(state, entrant):
            raise RegistrationBlocked("REGISTRATION_INDEPENDENT_ORIGINAL_REVIEWER_REQUIRED")
        _src(ev.get("registration_decision_source_ref"), actor)
        if ev.get("registration_decision") not in {
            "SUPPORT_MODEL_SOURCE", "OBJECT_MODEL_SOURCE"
        }:
            raise RegistrationBlocked("REGISTRATION_REVIEW_POSITION_REQUIRED")
        return {
            "new_subject": entrant,
            "registration_decision": ev["registration_decision"],
            "registration_decision_source_ref":
                ev["registration_decision_source_ref"],
        }
    if action != "subject_registration_apply" or ev["actor"] != operator:
        raise RegistrationBlocked("REGISTRATION_ORIGINAL_OPERATOR_APPLY_REQUIRED")
    own = [r for r in state.trace
           if r.get("action") == "subject_registration_attest"
           and r.get("outcome") == "APPLIED"
           and r.get("subject_registration_id") == reg
           and r.get("registration_fingerprint") ==
               proposal["registration_fingerprint"]
           and r.get("actor") == entrant
           and proposal["at"] < r["at"] < at]
    if len(own) != 1:
        raise RegistrationBlocked("REGISTRATION_ENTRANT_OWN_SOURCE_REQUIRED")
    if own[0]["registration_willingness"] != "WILLING":
        raise RegistrationBlocked("REGISTRATION_ENTRANT_UNWILLING")
    _founder_positions(state, proposal, "subject_registration_review",
                       "subject_registration_id", "registration_fingerprint", at)
    if len(state.subjects) >= 128:
        raise RegistrationBlocked("REGISTRATION_ORIGINAL_SUBJECT_LIMIT_REACHED")
    return {
        "new_subject": entrant,
        "registered_original_subject": entrant,
        "new_model_sme_with_own_sources": True,
        "real_legal_identity_authenticated": False,
    }


def qualify_resource_registration(state: Any, ev: Mapping[str, Any],
                                  at: int) -> dict[str, Any]:
    action = ev["action"]
    operator = state.institution.operator
    if state.context_basis is not None and state.context_basis.strict:
        basis = state.context_basis
        if not basis.decision_requirements:
            raise RegistrationBlocked(
                "REGISTRATION_STRICT_CONTEXT_SOURCE_RIGHTS_NOT_QUALIFIED"
            )
        try:
            basis.assert_original_decision_rights(ev, at)
            if action.endswith("_apply"):
                basis.assert_original_decision_lineage(
                    state.trace, action,
                    ev.get("subject_registration_id" if action.startswith("subject_")
                           else "resource_registration_id"), at
                )
        except ContextBlocked as exc:
            raise RegistrationBlocked(exc.reason) from exc
    if ev.get("org_revision") != state.institution.revision:
        raise RegistrationBlocked("REGISTRATION_ORIGINAL_ORGANIZATIONAL_REVISION_REQUIRED")
    reg = ev.get("resource_registration_id")
    if not _id(reg):
        raise RegistrationBlocked("REGISTRATION_ID_REQUIRED")
    if action == "resource_registration_propose":
        subject = ev.get("actor")
        if (subject not in state.subjects
                or state.subjects[subject].kind != "SME"
                or not state.subjects[subject].active):
            raise RegistrationBlocked("REGISTRATION_EXISTING_NEW_RESOURCE_OWNER_REQUIRED")
        if not any(r.get("action") == "subject_registration_apply"
                   and r.get("outcome") == "APPLIED"
                   and r.get("new_subject") == subject
                   for r in state.trace):
            raise RegistrationBlocked("REGISTRATION_ORIGINAL_NEW_SUBJECT_REQUIRED")
        document = ev.get("resource_spec")
        if not isinstance(document, dict) or set(document) != {
            "id", "owner", "availability", "capacity_units",
            "capacity_unit", "site"
        } or document.get("owner") != subject:
            raise RegistrationBlocked("REGISTRATION_COMPLETE_NEW_OWNER_RESOURCE_REQUIRED")
        try:
            parsed = parse_resource_capacity(document)
        except CapacityInputError as exc:
            raise RegistrationBlocked(
                "REGISTRATION_SOURCE_DECLARED_ORIGINAL_CAPACITY_REQUIRED"
            ) from exc
        if (parsed.key in state.resources or len(state.resources) >= 256
                or parsed.site is None
                or document["availability"] not in {"AVAILABLE", "UNAVAILABLE", "UNKNOWN"}
                or any(r.get("action") == action and r.get("outcome") == "APPLIED"
                       and (r.get("resource_registration_id") == reg
                            or r.get("registered_resource") == parsed.key)
                       for r in state.trace)):
            raise RegistrationBlocked("REGISTRATION_NEW_ORIGINAL_RESOURCE_REQUIRED")
        _src(ev.get("registration_resource_source_ref"), subject)
        expiry = ev.get("registration_valid_until")
        if type(expiry) is not int or not at < expiry <= 10000:
            raise RegistrationBlocked("REGISTRATION_FUTURE_VALIDITY_REQUIRED")
        digest = registration_fingerprint(document)
        if ev.get("resource_fingerprint") != digest:
            raise RegistrationBlocked("REGISTRATION_RESOURCE_FINGERPRINT_MISMATCH")
        return {
            "new_subject": subject,
            "registered_resource": parsed.key,
            "resource_spec": document,
            "resource_fingerprint": digest,
            "registration_valid_until": expiry,
            "registration_resource_source_ref": ev["registration_resource_source_ref"],
            "independent_real_property_rights_not_proven": True,
        }
    proposal = _proposal(state.trace, "resource_registration_propose",
                         reg, "resource_registration_id")
    _current(state, ev, proposal, at, "resource_fingerprint")
    entrant = proposal["new_subject"]
    if (entrant not in state.subjects or not state.subjects[entrant].active
            or proposal["registered_resource"] in state.resources):
        raise RegistrationBlocked("REGISTRATION_RESOURCE_ALREADY_EXISTS_OR_OWNER_MISSING")
    if action == "resource_registration_review":
        actor = ev["actor"]
        if actor not in _original_reviewers(state, entrant):
            raise RegistrationBlocked("REGISTRATION_INDEPENDENT_ORIGINAL_REVIEWER_REQUIRED")
        _src(ev.get("registration_decision_source_ref"), actor)
        if ev.get("registration_decision") not in {
            "SUPPORT_MODEL_SOURCE", "OBJECT_MODEL_SOURCE"
        }:
            raise RegistrationBlocked("REGISTRATION_REVIEW_POSITION_REQUIRED")
        return {
            "new_subject": entrant,
            "registered_resource": proposal["registered_resource"],
            "registration_decision": ev["registration_decision"],
            "registration_decision_source_ref":
                ev["registration_decision_source_ref"],
        }
    if action != "resource_registration_apply" or ev["actor"] != operator:
        raise RegistrationBlocked("REGISTRATION_ORIGINAL_OPERATOR_APPLY_REQUIRED")
    document = ev.get("resource_spec")
    if (not isinstance(document, dict)
            or registration_fingerprint(document) != proposal["resource_fingerprint"]
            or document != proposal["resource_spec"]):
        raise RegistrationBlocked("REGISTRATION_RESOURCE_CHANGED_AFTER_INDEPENDENT_REVIEW")
    _founder_positions(state, proposal, "resource_registration_review",
                       "resource_registration_id", "resource_fingerprint", at)
    try:
        parsed = parse_resource_capacity(document)
    except CapacityInputError as exc:
        raise RegistrationBlocked("REGISTRATION_ORIGINAL_CAPACITY_INVALID") from exc
    if (parsed.key in state.capacity_ledger.specs
            or parsed.owner != entrant or len(state.resources) >= 256):
        raise RegistrationBlocked("REGISTRATION_FOREIGN_OR_DUPLICATE_CAPACITY")
    return {
        "new_subject": entrant,
        "registered_resource": parsed.key,
        "resource_spec": document,
        "resource_fingerprint": proposal["resource_fingerprint"],
        "new_capacity_uses_original_single_capacity_ledger": True,
        "real_ownership_source_not_authenticated": True,
    }
