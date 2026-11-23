"""R1-V2C2B: original sector actor registers own capacity after admission.

The existing subject registration and original resource registration must
succeed independently. No other newly admitted actor inherits a machine.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.source_registration import registration_fingerprint

from .test_r1v2c2_extended_subject_registration_mesa import prospective_case
from .test_r1u4_strict_original_source_rights_mesa import (
    registration_case, _original_rights, rows, accepted_result, e,
)


def registered_capacity_case(role="sector"):
    d = prospective_case(role)
    # Reuse the SAME resource events from the established enterprise path.
    previous = registration_case()
    extra = [deepcopy(ev) for ev in previous["events"]
             if ev["action"].startswith("resource_registration_")]
    d["events"].extend(extra)
    d["events"].sort(key=lambda ev: ev["at"])
    d["model_horizon"] = 30
    # Regenerate one strict ContextBasis for all decisions (including resource
    # registration) and restore independently declared author-role sources.
    author_sources = [
        deepcopy(source) for source in d["context_evidence"]["sources"]
        if source["id"] in {
            "model://c/original-role", "model://c/original-right",
            "model://c/original-role-management",
        }
    ]
    _original_rights(d)
    for source in d["context_evidence"]["sources"]:
        if source["owner"] == "c":
            source["core"] = (
                "personal" if role == "person" else "institutional"
            )
    for req in d["context_evidence"]["decision_requirements"]:
        if req["actor"] == "c":
            req["core"] = (
                "personal" if role == "person" else "institutional"
            )
    d["context_evidence"]["sources"].extend(author_sources)
    return d


def test_new_sector_role_can_register_own_original_capacity():
    d = registered_capacity_case()
    untouched = deepcopy(d)
    out = simulate(d)
    assert d == untouched
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"])
        for r in out["trace"] if r["outcome"] == "BLOCKED"
    ]
    assert accepted_result(out, "w1")
    assert out["subjects"]["c"]["kind"] == "SECTOR_BODY"
    assert out["resources"]["rc"]["owner"] == "c"
    assert out["resources"]["rc"]["basis"] == "OWNER_REGISTERED_MODEL_SOURCE"
    assert out["capacity"]["resources"]["rc"]["capacity_units"] == 1
    assert rows(out, "subject_registration_apply")[0]["outcome"] == "APPLIED"
    assert rows(out, "resource_registration_apply")[0]["outcome"] == "APPLIED"
    assert "w2" not in out["works"]
    assert out == simulate(deepcopy(d))


@pytest.mark.parametrize("role", ["public", "person"])
def test_public_and_person_roles_cannot_self_assign_production_capacity(role):
    d = registered_capacity_case(role)
    out = simulate(d)
    assert accepted_result(out, "w1")
    assert rows(out, "subject_registration_apply")[0]["outcome"] == "APPLIED"
    assert rows(out, "resource_registration_propose")[0]["reason"] == (
        "REGISTRATION_EXISTING_NEW_RESOURCE_OWNER_REQUIRED"
    )
    assert rows(out, "resource_registration_apply")[0]["outcome"] == "BLOCKED"
    assert "rc" not in out["resources"]


def test_sector_resource_registration_rechecks_expired_owner_mandate():
    d = registered_capacity_case()
    role_source = next(row for row in d["context_evidence"]["sources"]
                       if row["id"] == "model://c/original-right")
    role_source["valid_until"] = 13
    out = simulate(d)
    assert accepted_result(out, "w1")
    assert rows(out, "subject_registration_apply")[0]["outcome"] == "APPLIED"
    assert rows(out, "resource_registration_propose")[0]["outcome"] == "BLOCKED"
    assert "rc" not in out["resources"]


def test_sector_resource_registration_requires_applied_subject_registration():
    d = registered_capacity_case()
    d["events"] = [ev for ev in d["events"] if ev["action"] != "subject_registration_apply"]
    out = simulate(d)
    assert accepted_result(out, "w1")
    assert rows(out, "resource_registration_propose")[0]["outcome"] == "BLOCKED"
    assert "c" not in out["subjects"]
    assert "rc" not in out["resources"]


def test_sector_resource_decision_cannot_replace_prior_accepted_work_result():
    d = registered_capacity_case()
    apply = next(ev for ev in d["events"]
                 if ev["action"] == "resource_registration_apply")
    apply["resource_spec"]["owner"] = "a"
    out = simulate(d)
    assert accepted_result(out, "w1")
    assert rows(out, "resource_registration_apply")[0]["outcome"] == "BLOCKED"
    assert "rc" not in out["resources"]
