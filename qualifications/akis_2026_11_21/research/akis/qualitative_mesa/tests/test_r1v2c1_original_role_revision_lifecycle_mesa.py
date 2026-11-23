"""R1-V2C1: original independent sector/public/person role edition lifecycle.

This is the same QualitativeAKIS.subjects, trace, ContextBasis and Work.
No second IAM, scheduler, new legal claims or retroactive Result changes.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1v2b_extended_original_author_subjects_mesa import (
    case, KINDS,
)
from .test_r1l_post_result_original_reproduction_mesa import find


def role_case(form: str):
    d = case(form)
    _, name, _, _, _, _, core = KINDS[form]
    special = next(x for x in d["subjects"] if x["id"] == name)
    management = f"model://{name}/role-lifecycle"
    special["role_management_source_ref"] = management
    d["context_evidence"]["sources"].append({
        "id": management, "owner": name,
        "revision": "role-r1", "status": "CONFIRMED",
        "usable_by": [name], "core": core,
        "purposes": ["AKIS_ROLE_MANAGEMENT"],
        "operations": ["EXECUTE"],
        "valid_from": 0, "valid_until": 100,
    })
    # Make room between independent phase-8 responses (30-31) and the
    # second ORIGINAL work. All time and slot references remain coherent.
    for ev in d["events"]:
        if ev["at"] >= 34:
            ev["at"] += 14
            if isinstance(ev.get("prepared_at"), int) and ev["prepared_at"] >= 34:
                ev["prepared_at"] += 14
            if ev["action"] == "request" and ev["work_spec"]["id"] == "w2":
                ev["work_spec"]["slot_start"] += 14
                ev["work_spec"]["slot_end"] += 14
    d["model_horizon"] = 89
    return d


def update_source(t, name, source, old, new, status="CONFIRMED"):
    return {
        "at": t, "action": "source_update", "actor": name,
        "source": source, "status": status, "expected_revision": old,
        "new_revision": new,
    }


def role_event(t, name, old, new, state):
    return {
        "at": t, "action": "role_state_update", "actor": name,
        "role_target": name, "role_expected_revision": old,
        "role_new_revision": new, "role_new_state": state,
        "role_management_source_ref": f"model://{name}/role-lifecycle",
    }


def suspend_and_restore(form, *, restore=True):
    d = role_case(form)
    _, name, _, _, _, _, _ = KINDS[form]
    own = next(s for s in d["subjects"] if s["id"] == name)
    scope = own.get("mandate_source_ref", own.get("context_source_ref"))
    management = own["role_management_source_ref"]
    entries = [
        update_source(32, name, management, "role-r1", "role-r2"),
        role_event(33, name, "role-r1", "role-r2", "SUSPENDED"),
    ]
    if restore:
        entries.extend([
            update_source(35, name, management, "role-r2", "role-r3"),
            update_source(36, name, own["self_role_source_ref"],
                          "role-r1", "role-r3"),
            update_source(37, name, scope, "role-r1", "role-r3"),
            role_event(38, name, "role-r2", "role-r3", "ACTIVE"),
        ])
    d["events"].extend(entries)
    d["events"].sort(key=lambda row: row["at"])
    return d


@pytest.mark.parametrize("form", sorted(KINDS))
def test_owner_suspends_and_recovers_own_original_role_new_edition_second_result(form):
    d = suspend_and_restore(form)
    before = deepcopy(d)
    out = simulate(d)
    assert d == before
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"])
        for x in out["trace"] if x["outcome"] == "BLOCKED"
    ]
    _, name, _, _, _, _, _ = KINDS[form]
    events = find(out, "role_state_update", actor=name)
    assert [x["outcome"] for x in events] == ["APPLIED", "APPLIED"]
    assert [x["role_new_state"] for x in events] == ["SUSPENDED", "ACTIVE"]
    assert out["subjects"][name]["active_for_new_work"]
    assert out["subjects"][name]["original_role_source_revision"] == "role-r3"
    assert out["subjects"][name]["original_role_edition_history"] == [
        "role-r1", "role-r2", "role-r3"
    ]
    assert out["subjects"][name]["self_controllable_role_management_source"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "r1v1_original_author_form_eight_phase_accepted_result_count"
    ] == 1
    assert out == simulate(deepcopy(d))


@pytest.mark.parametrize("form", sorted(KINDS))
def test_owner_suspend_prevents_future_work_but_preserves_prior_result(form):
    d = suspend_and_restore(form, restore=False)
    out = simulate(d)
    _, name, _, _, _, _, _ = KINDS[form]
    assert find(out, "role_state_update", actor=name)[0]["outcome"] == "APPLIED"
    assert out["subjects"][name]["active_for_new_work"] is False
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert find(out, "request", work="w2")[0]["outcome"] == "BLOCKED"
    assert "w2" not in out["works"]


def test_external_operator_cannot_restore_person_own_role():
    d = suspend_and_restore("trace")
    attempted = role_event(39, "person", "role-r2", "role-r4", "ACTIVE")
    attempted["actor"] = "op"
    d["events"].append(attempted)
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert next(x for x in out["trace"]
                if x["action"] == "role_state_update" and x["at"] == 39)[
                    "reason"] == "ROLE_UPDATE_INDEPENDENT_ACTOR_REQUIRED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("form", sorted(KINDS))
def test_replay_old_role_edition_cannot_reactivate_lost_permission(form):
    d = suspend_and_restore(form)
    _, name, _, _, _, _, _ = KINDS[form]
    d["events"].append(role_event(
        40, name, "role-r1", "role-r2", "SUSPENDED"
    ))
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert next(x for x in out["trace"] if x["at"] == 40)["reason"] == (
        "ROLE_UPDATE_STALE_ORIGINAL_EDITION"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_person_restore_requires_own_source_requalified_in_same_context_basis():
    d = suspend_and_restore("trace")
    d["events"] = [
        e for e in d["events"]
        if not (e["at"] == 37 and e["action"] == "source_update")
    ]
    out = simulate(d)
    assert next(x for x in out["trace"] if x["at"] == 38)["reason"] == (
        "CONTEXT_REVISION_STALE"
    )
    assert out["subjects"]["person"]["active_for_new_work"] is False
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert "w2" not in out["works"]


def test_sector_role_cannot_silently_change_status_with_old_management_source():
    d = role_case("sector")
    d["events"].append(role_event(
        33, "sector", "role-r1", "role-r2", "SUSPENDED"
    ))
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert next(x for x in out["trace"] if x["at"] == 33)["reason"] == (
        "CONTEXT_REVISION_STALE"
    )
    assert out["subjects"]["sector"]["active_for_new_work"] is True
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_public_role_source_without_CAS_cannot_change_and_old_work_remains():
    d = role_case("macro")
    d["events"].append({
        "at": 32, "action": "source_update", "actor": "public",
        "source": "model://public/role-lifecycle",
        "status": "DISPROVED",
    })
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert next(x for x in out["trace"] if x["at"] == 32)["reason"] == (
        "CONTEXT_OWNER_RIGHTS_COMPARE_AND_SET_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_person_role_source_with_prohibited_operation_cannot_suspend():
    d = suspend_and_restore("trace", restore=False)
    source = next(s for s in d["context_evidence"]["sources"]
                  if s["id"] == "model://person/role-lifecycle")
    source["operations"] = ["READ"]
    out = simulate(d)
    assert next(x for x in out["trace"] if x["at"] == 33)["reason"] == (
        "CONTEXT_OPERATION_NOT_PERMITTED"
    )
    assert out["subjects"]["person"]["active_for_new_work"] is True
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
