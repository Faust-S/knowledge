"""R1-V2C2: original source-scoped entry of a previously absent actor.

One original proposal/attest/review/apply path is reused; no second IAM,
new scheduler, alternative subject registry or synthetic Work/Result.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.source_registration import (
    registration_fingerprint,
)
from .test_r1u4_strict_original_source_rights_mesa import (
    registration_case, _original_rights, rows, accepted_result, e,
)

ROLES = {
    "sector": ("SECTOR_BODY", "institutional",
               "mandate_source_ref", "AKIS_SECTOR_ROLE",
               "AKIS_SECTOR_STANDARD"),
    "public": ("PUBLIC_INSTITUTION", "institutional",
               "mandate_source_ref", "AKIS_PUBLIC_ROLE",
               "AKIS_PUBLIC_MANDATE"),
    "person": ("NATURAL_PERSON", "personal",
               "context_source_ref", "AKIS_PERSON_ROLE",
               "AKIS_PERSON_CONTEXT_ACCESS"),
}


def prospective_case(role):
    kind, core, scope_field, role_purpose, scope_purpose = ROLES[role]
    d = registration_case()
    # The original accepted Work w1 is the required pilot. No future
    # resource or Work is registered on behalf of an unaccepted entrant.
    d["events"] = [
        x for x in d["events"]
        if x["action"].startswith("subject_registration_") or x["at"] <= 8
    ]
    d["model_horizon"] = 29
    first, scope, management = (
        "model://c/original-role",
        "model://c/original-right",
        "model://c/original-role-management",
    )
    spec = {
        "id": "c",
        "kind": kind,
        "self_role_source_ref": first,
        scope_field: scope,
        "role_management_source_ref": management,
        "role_source_revision": "role-r1",
    }
    proposal = next(x for x in d["events"]
                    if x["action"] == "subject_registration_propose")
    proposal["new_subject_kind"] = kind
    proposal["new_subject_spec"] = deepcopy(spec)
    record = {
        "subject_registration_id": proposal["subject_registration_id"],
        "new_subject": proposal["new_subject"],
        "new_subject_kind": kind,
        "pilot_work": proposal["pilot_work"],
        "pilot_result_ref": proposal["pilot_result_ref"],
        "pilot_decision_at": proposal["pilot_decision_at"],
        "new_subject_spec": deepcopy(spec),
    }
    digest = registration_fingerprint(record)
    for x in d["events"]:
        if x["action"].startswith("subject_registration_"):
            x["registration_fingerprint"] = digest
    _original_rights(d)

    # R1-U4 decision sources of the unregistered applicant retain owner c.
    # Their STRICT KPB domain is selected from the prospect's real author kind,
    # rather than pretending that public institutes and people are SMEs.
    basis = d["context_evidence"]
    for x in basis["sources"]:
        if x["owner"] == "c":
            x["core"] = core
    for x in basis["decision_requirements"]:
        if x["actor"] == "c":
            x["core"] = core
    for ref, purpose, operation, recipients in [
        (first, role_purpose, "ACCEPT", ["c"]),
        (scope, scope_purpose, "SHARE", ["c", "a"]),
        (management, "AKIS_ROLE_MANAGEMENT", "EXECUTE", ["c"]),
    ]:
        basis["sources"].append({
            "id": ref, "owner": "c", "revision": "role-r1",
            "status": "CONFIRMED", "usable_by": recipients,
            "core": core, "purposes": [purpose], "operations": [operation],
            "valid_from": 0, "valid_until": 90,
        })
    return d


@pytest.mark.parametrize("role", sorted(ROLES))
def test_original_self_attested_new_role_is_registered_only_after_independent_review(role):
    d = prospective_case(role)
    raw = deepcopy(d)
    out = simulate(d)
    assert d == raw
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"])
        for r in out["trace"] if r["outcome"] == "BLOCKED"
    ]
    kind, _, _, _, _ = ROLES[role]
    assert accepted_result(out, "w1")
    assert out["subjects"]["c"]["kind"] == kind
    assert out["subjects"]["c"]["active_for_new_work"]
    assert out["subjects"]["c"]["original_role_source_revision"] == "role-r1"
    assert out["subjects"]["c"]["original_role_edition_history"] == [
        "role-r1"
    ]
    assert out["subjects"]["c"]["self_controllable_role_management_source"]
    assert rows(out, "subject_registration_propose")[0]["outcome"] == "APPLIED"
    assert rows(out, "subject_registration_attest")[0]["outcome"] == "APPLIED"
    assert [r["outcome"] for r in rows(out, "subject_registration_review")] == [
        "APPLIED", "APPLIED",
    ]
    applied = rows(out, "subject_registration_apply")[0]
    assert applied["outcome"] == "APPLIED"
    assert applied["registered_original_subject"] == "c"
    assert applied["registered_original_subject_kind"] == kind
    assert applied["new_model_extended_role_with_self_owned_sources"]
    assert not applied["real_legal_identity_authenticated"]
    assert "w2" not in out["works"]
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert not out["context_basis"]["authenticated_documents"]
    assert out == simulate(deepcopy(d))


@pytest.mark.parametrize("role", sorted(ROLES))
def test_unregistered_self_attested_role_without_applied_registration_is_not_subject(role):
    d = prospective_case(role)
    d["events"] = [
        x for x in d["events"]
        if x["action"] != "subject_registration_apply"
    ]
    out = simulate(d)
    assert accepted_result(out, "w1")
    assert "c" not in out["subjects"]


@pytest.mark.parametrize("role", sorted(ROLES))
def test_original_self_source_revoked_before_apply_blocks_registration(role):
    d = prospective_case(role)
    for event in d["events"]:
        if event["at"] >= 13:
            event["at"] += 1
    d["events"].append(e(
        13, "source_update", "c",
        source="model://c/original-role",
        status="DISPROVED",
        expected_revision="role-r1", new_revision="role-r2",
    ))
    d["events"].sort(key=lambda event: event["at"])
    out = simulate(d)
    assert rows(out, "source_update")[0]["outcome"] == "APPLIED"
    assert rows(out, "subject_registration_apply")[0]["reason"] == (
        "CONTEXT_REVISION_STALE"
    )
    assert "c" not in out["subjects"]
    assert accepted_result(out, "w1")


@pytest.mark.parametrize("role", sorted(ROLES))
def test_original_extended_registration_requires_entrant_independent_consent(role):
    d = prospective_case(role)
    d["events"] = [
        x for x in d["events"]
        if x["action"] != "subject_registration_attest"
    ]
    out = simulate(d)
    assert rows(out, "subject_registration_apply")[0]["reason"] == (
        "REGISTRATION_ENTRANT_OWN_SOURCE_REQUIRED"
    )
    assert "c" not in out["subjects"]
    assert accepted_result(out, "w1")


@pytest.mark.parametrize("role", sorted(ROLES))
def test_formal_registration_without_owner_rights_cannot_create_actor(role):
    d = prospective_case(role)
    proposal = next(x for x in d["events"]
                    if x["action"] == "subject_registration_propose")
    proposal["source_rights_ref"] = "model://c/borrowed-operator-source"
    out = simulate(d)
    assert rows(out, "subject_registration_propose")[0]["outcome"] == "BLOCKED"
    assert rows(out, "subject_registration_apply")[0]["outcome"] == "BLOCKED"
    assert "c" not in out["subjects"]


@pytest.mark.parametrize("role", sorted(ROLES))
def test_role_description_cannot_be_changed_after_founder_reviews(role):
    d = prospective_case(role)
    proposal = next(x for x in d["events"]
                    if x["action"] == "subject_registration_propose")
    proposal["new_subject_spec"]["role_source_revision"] = "role-r2"
    out = simulate(d)
    assert rows(out, "subject_registration_propose")[0]["reason"] == (
        "REGISTRATION_SUBJECT_DOCUMENT_FINGERPRINT_MISMATCH"
    )
    assert "c" not in out["subjects"]


@pytest.mark.parametrize("role", sorted(ROLES))
def test_role_owner_recipients_not_granted_at_application_block(role):
    d = prospective_case(role)
    source = next(s for s in d["context_evidence"]["sources"]
                  if s["id"] == "model://c/original-right")
    source["usable_by"] = ["a"]
    out = simulate(d)
    assert rows(out, "subject_registration_apply")[0]["reason"] == (
        "CONTEXT_USE_NOT_PERMITTED"
    )
    assert "c" not in out["subjects"]


@pytest.mark.parametrize("role", sorted(ROLES))
def test_role_registration_once_not_repeated_without_new_consent(role):
    d = prospective_case(role)
    old = next(x for x in d["events"]
               if x["action"] == "subject_registration_apply")
    duplicate = deepcopy(old)
    duplicate["at"] = 14
    d["events"].append(duplicate)
    d["events"].sort(key=lambda x: x["at"])
    out = simulate(d)
    assert [x["outcome"] for x in rows(out, "subject_registration_apply")] == [
        "APPLIED", "BLOCKED",
    ]
    assert accepted_result(out, "w1")


@pytest.mark.parametrize("role", sorted(ROLES))
def test_registered_actor_uses_same_original_role_lifecycle_without_new_registry(role):
    d = prospective_case(role)
    d["events"].extend([
        e(14, "source_update", "c",
          source="model://c/original-role-management",
          expected_revision="role-r1", new_revision="role-r2",
          status="CONFIRMED"),
        e(15, "role_state_update", "c",
          role_target="c", role_expected_revision="role-r1",
          role_new_revision="role-r2", role_new_state="SUSPENDED",
          role_management_source_ref="model://c/original-role-management"),
        e(16, "source_update", "c",
          source="model://c/original-role-management",
          expected_revision="role-r2", new_revision="role-r3",
          status="CONFIRMED"),
        e(17, "source_update", "c",
          source="model://c/original-role",
          expected_revision="role-r1", new_revision="role-r3",
          status="CONFIRMED"),
        e(18, "source_update", "c",
          source="model://c/original-right",
          expected_revision="role-r1", new_revision="role-r3",
          status="CONFIRMED"),
        e(19, "role_state_update", "c",
          role_target="c", role_expected_revision="role-r2",
          role_new_revision="role-r3", role_new_state="ACTIVE",
          role_management_source_ref="model://c/original-role-management"),
    ])
    d["events"].sort(key=lambda x: x["at"])
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"])
        for x in out["trace"] if x["outcome"] == "BLOCKED"
    ]
    assert accepted_result(out, "w1")
    assert out["subjects"]["c"]["active_for_new_work"]
    assert out["subjects"]["c"]["original_role_edition_history"] == [
        "role-r1", "role-r2", "role-r3",
    ]
    assert [x["outcome"] for x in rows(out, "role_state_update")] == [
        "APPLIED", "APPLIED",
    ]
    # Registration plus restored status cannot manufacture a second Result.
    assert "w2" not in out["works"]
