"""R1-V2: original employee and division, same original Mesa Work and Result.

Source-bound intrafirm actors are not SME, owners of their employer's
legal property, public entities, signatures or a new internal scheduler.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_r1l_post_result_original_reproduction_mesa import (
    two_cycle_lifecycle_case, find,
)


def intrafirm_case():
    d = two_cycle_lifecycle_case()
    # The actual original researcher-owned subject registry acquires two
    # independently identifiable human/organizational role subjects.
    d["subjects"].extend([
        {
            "id": "dept", "kind": "DIVISION", "organization": "a",
            "affiliation_source_ref": "model://a/division-dept-authority",
            "self_role_source_ref": "model://dept/own-division-position",
        },
        {
            "id": "worker", "kind": "EMPLOYEE", "organization": "a",
            "affiliation_source_ref": "model://a/worker-affiliation",
            "self_role_source_ref": "model://worker/own-work-position",
        },
    ])
    for resource in d["resources"]:
        if resource["id"] == "ra":
            resource["owner"] = "worker"
    for w in d["works"]:
        if w["customer"] == "b":
            w["customer"] = "dept"
    for link in d["cooperation_links"]:
        link["participants"] = [
            "op", "dept", "worker"
        ]
    g = d["general_akis"]
    g["configuration"] = "intra"
    g["morphology"]["scale"] = "Внутрифирменные"
    g["morphology"]["governance"] = "Централизованные"
    g["enforce_model_author_configuration_work_scope"] = True
    # Extend the ORIGINAL thirteen-part organizational code. New kinds
    # acquire no general SME rights: dept is only CUSTOMER and worker only
    # RESOURCE_OWNER on their individually consented original Work.
    code = {row["field"]: row["control"]
            for row in g["organizational_code"]}
    code["С"]["subjects"].extend(["dept", "worker"])
    code["ИД"]["model_identified"].extend(["dept", "worker"])
    code["Рол"]["role_bindings"].extend([
        {"subject": "dept", "items": ["CUSTOMER"]},
        {"subject": "worker", "items": ["RESOURCE_OWNER"]},
    ])
    responsibility = next(
        row for row in code["Отв"]["responsibilities"]
        if row["action"] == "commit"
    )
    responsibility["original_principals"] = ["dept", "worker"]
    for goal in g["goals"]:
        if goal["owner"] == "b":
            goal["owner"] = "dept"
            goal["source_ref"] = goal["source_ref"].replace(
                "model://b/", "model://dept/"
            )
    for phase in g["formation_phases"]:
        old = phase["owner"]
        step = phase["phase"]
        new = ("dept" if old == "b" and step in {1, 2, 7, 8}
               else "worker" if old == "a" and step in {3, 8}
               else old)
        if new != old:
            phase["owner"] = new
            phase["source_ref"] = phase["source_ref"].replace(
                f"model://{old}/", f"model://{new}/"
            )
    for event in d["events"]:
        action = event["action"]
        if action == "request":
            event["actor"] = "dept"
            event["work_spec"]["customer"] = "dept"
        elif action == "formation_confirm":
            phase, old = event["phase"], event["actor"]
            new = ("dept" if old == "b" and phase in {1, 2, 7}
                   else "worker" if old == "a" and phase == 3
                   else old)
            if new != old:
                event["actor"] = new
                event["formation_source_ref"] = event[
                    "formation_source_ref"
                ].replace(f"model://{old}/", f"model://{new}/")
        elif action in {"consent", "start", "complete", "accept"}:
            event["actor"] = {
                "a": "worker", "b": "dept",
            }.get(event["actor"], event["actor"])
        elif action == "function_review":
            event["actor"] = "dept"
            event["review_source_ref"] = event["review_source_ref"].replace(
                "model://b/", "model://dept/"
            )
        elif action == "participation_status":
            old = event["actor"]
            new = {"a": "worker", "b": "dept"}[old]
            event["actor"] = new
            event["participation_evidence_ref"] = event[
                "participation_evidence_ref"
            ].replace(f"model://{old}/", f"model://{new}/")
            event["formation_phase_source_ref"] = event[
                "formation_phase_source_ref"
            ].replace(f"model://{old}/", f"model://{new}/")
    return d


def test_intrafirm_division_employee_own_original_two_work_results_and_phases():
    d = intrafirm_case()
    before = deepcopy(d)
    out = simulate(d)
    assert d == before
    assert out["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e["reason"])
        for e in out["trace"] if e["outcome"] == "BLOCKED"
    ]
    assert out["subjects"]["dept"]["kind"] == "DIVISION"
    assert out["subjects"]["worker"]["kind"] == "EMPLOYEE"
    assert out["subjects"]["dept"]["original_enterprise"] == "a"
    assert out["subjects"]["worker"]["original_enterprise"] == "a"
    assert out["resources"]["ra"]["owner"] == "worker"
    assert [out["works"][w]["result"] for w in ("w1", "w2")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT",
        "ACCEPTED_BY_ORIGINAL_RECIPIENT",
    ]
    for work in ("w1", "w2"):
        assert out["works"][work]["consenting_principals"] == [
            "dept", "worker"
        ]
    assert [r["actor"] for r in find(out, "participation_status")] == [
        "worker", "dept"
    ]
    conf = out["general_akis_model"]["configuration_dynamics"]
    assert conf["status"] == "ORIGINAL_INTRA_DIVISION_EMPLOYEE_WORK_PARTIAL"
    assert all(
        row["model_scope_result"] == "NONE"
        for row in conf["original_commit_form_gate"]["original_work_checks"]
    )
    assert not conf["original_commit_form_gate"][
        "all_six_author_organizational_forms_implemented"
    ]
    witness = out["general_akis_private_cycle_evidence"][
        "original_author_form_eight_phase_reproduction"
    ]
    assert len(witness) == 1
    assert witness[0]["author_selected_form"] == "intra"
    assert witness[0]["original_phase_8_independent_principals"] == [
        "dept", "worker"
    ]
    assert witness[0]["original_pilot_work"] == "w1"
    assert witness[0]["followup_original_work"] == "w2"
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "r1v1_original_author_form_eight_phase_accepted_result_count"
    ] == 1
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out == simulate(deepcopy(d))


@pytest.mark.parametrize("role,field,value", [
    ("dept", "affiliation_source_ref", "model://b/foreign-division"),
    ("worker", "self_role_source_ref", "model://dept/borrowed-work"),
    ("worker", "organization", "missing"),
])
def test_role_identity_cannot_be_forged_or_unbound(role, field, value):
    d = intrafirm_case()
    row = next(x for x in d["subjects"] if x["id"] == role)
    row[field] = value
    if field == "organization":
        # First make the affiliation internally consistent; only then
        # qualify whether the purported parent is an ORIGINAL SME.
        row["affiliation_source_ref"] = "model://missing/affiliation"
    with pytest.raises(InputError, match=(
        "INTRAFIRM_ROLE_OWNER_SOURCE_INVALID"
        if field.endswith("_ref") else
        "INTRAFIRM_ROLE_REQUIRES_REAL_ORIGINAL_SME"
    )):
        simulate(d)


def test_original_role_without_independent_self_source_rejected():
    d = intrafirm_case()
    next(s for s in d["subjects"] if s["id"] == "worker").pop(
        "self_role_source_ref"
    )
    with pytest.raises(InputError, match="INTRAFIRM_ROLE_REQUIRES_ORIGINAL_SOURCES"):
        simulate(d)


def test_division_cannot_become_founder_or_replace_enterprise():
    d = intrafirm_case()
    d["institution"]["founders"][1] = "dept"
    with pytest.raises(InputError, match=(
        "INTRAFIRM_ROLE_CANNOT_ACT_AS_ORIGINAL_FOUNDER"
    )):
        simulate(d)


def test_original_employee_under_wrong_enterprise_cannot_be_work_owner_for_division():
    d = intrafirm_case()
    worker = next(x for x in d["subjects"] if x["id"] == "worker")
    worker["organization"] = "b"
    worker["affiliation_source_ref"] = "model://b/worker-affiliation"
    out = simulate(d)
    assert find(out, "commit", work="w1")[0]["reason"] == (
        "FORMATION_AUTHOR_INTRA_INDEPENDENT_EMPLOYEE_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"
    assert out["resources"]["ra"]["owner"] == "worker"


def test_intrafirm_original_role_work_denied_without_form_gate():
    d = intrafirm_case()
    # Original legacy Work without general_AKIS has no formation policy.
    # The core must still reject role Work, even in this opt-out input.
    d.pop("general_akis")
    out = simulate(d)
    assert find(out, "request", work="w1")[0]["reason"] == (
        "INTRAFIRM_ORIGINAL_ROLE_REQUIRES_SELECTED_FORM_GATE"
    )
    assert "w1" not in out["works"]


def test_intrafirm_employee_cannot_use_interfirm_form_to_skip_independent_role_gate():
    d = intrafirm_case()
    d["general_akis"]["configuration"] = "inter"
    d["general_akis"]["morphology"]["scale"] = "межфирменные"
    d["general_akis"]["morphology"]["governance"] = "децентрализованные"
    out = simulate(d)
    assert find(out, "request", work="w1")[0]["reason"] == (
        "INTRAFIRM_ORIGINAL_ROLE_REQUIRES_SELECTED_FORM_GATE"
    )


def test_role_owner_refusal_cannot_be_replaced_by_enterprise_vote():
    d = intrafirm_case()
    d["events"] = [
        ev for ev in d["events"]
        if not (ev["action"] == "consent"
                and ev["actor"] == "worker"
                and ev.get("work") == "w1")
    ]
    out = simulate(d)
    assert find(out, "commit", work="w1")[0]["reason"] == (
        "INDEPENDENT_ACCEPTANCE_MISSING"
    )
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_missing_original_employee_phase_eight_refuses_followup_not_old_result():
    d = intrafirm_case()
    d["events"] = [
        ev for ev in d["events"] if not (
            ev["action"] == "participation_status"
            and ev["actor"] == "worker"
        )
    ]
    out = simulate(d)
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_FOLLOWUP_EACH_ORIGINAL_OWNER_EVALUATION_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_private_cycle_evidence"][
        "original_author_form_eight_phase_reproduction"
    ] == []


def test_original_second_intrafirm_result_not_accepted_is_not_reproduction():
    d = intrafirm_case()
    d["events"] = [
        e for e in d["events"]
        if not (e["action"] == "accept" and e.get("work") == "w2")
    ]
    out = simulate(d)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "SUBMITTED"
    assert out["general_akis_private_cycle_evidence"][
        "original_author_form_eight_phase_reproduction"
    ] == []
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "r1v1_original_author_form_eight_phase_accepted_result_count"
    ] == 0
