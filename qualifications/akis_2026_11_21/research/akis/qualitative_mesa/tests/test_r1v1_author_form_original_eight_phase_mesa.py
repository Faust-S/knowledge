"""R1-V1: author six forms constrain original Work, no fictitious actors.

The operator and inter-SME original Work paths can proceed only through
already enforced phases 1-6, customer Result (7), each independent
original owner phase-8 assessment and a second accepted Work/Result.
All other forms require subject types still absent in the ORIGINAL Mesa.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError

from .test_r1l_post_result_original_reproduction_mesa import (
    two_cycle_lifecycle_case,
    find,
)

FORM_CONFIG = {
    "inter": ("межфирменные", "децентрализованные"),
    "operator": ("межфирменные", "операторские"),
}
UNSUPPORTED = ("sector", "macro", "trace")


def formed_case(form="operator"):
    data = two_cycle_lifecycle_case()
    config = data["general_akis"]
    config["configuration"] = form
    config["enforce_model_author_configuration_work_scope"] = True
    scale, governance = FORM_CONFIG.get(
        form, ("Внутрифирменные", "Централизованные")
    )
    config["morphology"]["scale"] = scale
    config["morphology"]["governance"] = governance
    return data


@pytest.mark.parametrize("form", ("inter", "operator"))
def test_original_source_qualified_SME_form_leads_from_phases_to_accepted_followup_work(form):
    data = formed_case(form)
    untouched = deepcopy(data)
    out = simulate(data)
    assert data == untouched
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"])
        for r in out["trace"] if r["outcome"] == "BLOCKED"
    ]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert find(out, "participation_status", actor="a")[0]["outcome"] == "APPLIED"
    assert find(out, "participation_status", actor="b")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert out["works"]["w2"]["consenting_principals"] == ["a", "b"]
    assert out["resources"]["ra"]["owner"] == "a"
    conf = out["general_akis_model"]["configuration_dynamics"]
    assert conf["configuration"] == form
    assert conf["original_commit_form_gate"]["enabled"]
    assert all(
        row["model_scope_result"] == "NONE"
        for row in conf["original_commit_form_gate"]["original_work_checks"]
    )
    assert not conf["original_commit_form_gate"][
        "all_six_author_organizational_forms_implemented"
    ]
    original_cycle = out["general_akis_private_cycle_evidence"][
        "original_author_form_eight_phase_reproduction"
    ]
    shared = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert len(original_cycle) == 1
    assert original_cycle[0]["author_selected_form"] == form
    assert original_cycle[0]["original_pilot_work"] == "w1"
    assert original_cycle[0]["followup_original_work"] == "w2"
    assert original_cycle[0]["original_phase_8_independent_principals"] == ["a", "b"]
    assert shared["r1v1_original_author_form_eight_phase_accepted_result_count"] == 1
    assert not shared["r1v1_original_author_form_scope_all_six_executable"]
    assert not out["general_akis_model"]["agent_function_formation_model_gate"]["full_author_A_F_P_OC_KPB_implemented"]
    assert simulate(deepcopy(data)) == out


@pytest.mark.parametrize("form", UNSUPPORTED)
def test_unsupported_author_subject_form_cannot_commit_original_SME_work(form):
    # Do not invent DIVISION, EMPLOYEE, PUBLIC_INSTITUTION, NATURAL_PERSON,
    # sector certification or a second actor engine merely to pass a test.
    data = formed_case(form)
    with pytest.raises(InputError, match=(
        "AUTHOR_FORM_ORIGINAL_SUBJECT_CLASSES_NOT_IMPLEMENTED"
    )):
        simulate(data)


def test_intra_selected_but_unrelated_original_enterprises_cannot_replace_division_and_employee():
    # R1-V2 adds real model role subjects. Selecting intra alone never
    # collapses earlier SMEs into a division or employee.
    data = formed_case("intra")
    out = simulate(data)
    assert find(out, "commit", work="w1")[0]["reason"] == (
        "FORMATION_AUTHOR_INTRA_ORIGINAL_DIVISION_REQUIRED"
    )
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


@pytest.mark.parametrize("form,morphology,reason", [
    ("operator", "Централизованные",
     "FORMATION_AUTHOR_OPERATOR_GOVERNANCE_SOURCE_REQUIRED"),
    ("inter", "операторские",
     "FORMATION_AUTHOR_INTERFIRM_OPERATOR_MORPHOLOGY_CONFLICT"),
])
def test_claimed_governance_cannot_silently_authorize_wrong_form(form, morphology, reason):
    data = formed_case(form)
    data["general_akis"]["morphology"]["governance"] = morphology
    out = simulate(data)
    first = find(out, "commit", work="w1")[0]
    assert first["outcome"] == "BLOCKED"
    assert first["reason"] == reason
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


@pytest.mark.parametrize("form", ["operator", "inter"])
def test_six_form_gate_requires_source_declared_interfirm_scale(form):
    data = formed_case(form)
    data["general_akis"]["morphology"]["scale"] = "региональные"
    out = simulate(data)
    first = find(out, "commit", work="w1")[0]
    assert first["reason"] == "FORMATION_AUTHOR_INTERFIRM_SCALE_SOURCE_MISMATCH"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_partial_original_form_guard_does_not_replace_owner_consent():
    data = formed_case("operator")
    data["events"] = [
        e for e in data["events"]
        if not (e["action"] == "consent" and
                e.get("work") == "w1" and e["actor"] == "a")
    ]
    out = simulate(data)
    assert find(out, "commit", work="w1")[0]["reason"] == (
        "INDEPENDENT_ACCEPTANCE_MISSING"
    )
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"
    assert out["resources"]["ra"]["owner"] == "a"


@pytest.mark.parametrize("removed_flag", [
    "enforce_model_formation_phases",
    "enforce_model_formation_context_code",
    "enforce_model_formation_agent_review",
    "enforce_model_formation_lifecycle",
])
def test_R1V_form_scope_cannot_enable_without_all_previous_original_gates(removed_flag):
    data = formed_case("operator")
    data["general_akis"][removed_flag] = False
    with pytest.raises(InputError):
        simulate(data)


def test_opt_out_keeps_original_legacy_author_forms_unchanged():
    data = formed_case("operator")
    data["general_akis"]["enforce_model_author_configuration_work_scope"] = False
    data["general_akis"]["morphology"]["scale"] = "региональные"
    out = simulate(data)
    assert out["counts"]["blocked"] == 0
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert not out["general_akis_model"]["configuration_dynamics"][
        "original_commit_form_gate"
    ]["enabled"]



def test_r1v1_original_author_catalog_has_all_nine_full_morphological_axes():
    # Public qualification vocabulary must retain all author-defined options,
    # not a two-value miniature that silently rejects valid original sources.
    from research.akis.qualitative_mesa.general_system import author_catalog
    taxonomy = author_catalog()["taxonomy"]
    assert len(taxonomy["morphological_axes"]) == 9
    axes = {a["key"]: a["values"] for a in taxonomy["morphological_axes"]}
    assert tuple(len(axes[k]) for k in [
        "scale", "governance", "autonomy", "process", "knowledge",
        "data", "platform", "economics", "human",
    ]) == (5, 5, 5, 5, 4, 6, 3, 5, 4)
    assert {"межфирменные", "региональные"} <= set(axes["scale"])
    assert {"операторские", "децентрализованные"} <= set(axes["governance"])
    assert [f["id"] for f in taxonomy["subject_configurations"]] == [
        "intra", "inter", "operator", "sector", "macro", "trace",
    ]
    assert [p["phase"] for p in taxonomy["formation_phases"]] == list(range(1, 9))


@pytest.mark.parametrize("form", ["inter", "operator"])
def test_r1v1_formation_without_second_original_accepted_result_is_not_reproduction(form):
    d = formed_case(form)
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
    assert not out["general_akis_model"]["system_causal_cycle_feedback"][
        "all_nine_component_original_causal_closure_proven"
    ]


def test_r1v1_owner_evaluation_missing_prevents_next_original_result_and_witness():
    d = formed_case("operator")
    d["events"] = [
        e for e in d["events"]
        if not (e["action"] == "participation_status" and e["actor"] == "a")
    ]
    out = simulate(d)
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_FOLLOWUP_EACH_ORIGINAL_OWNER_EVALUATION_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert "w2" not in out["works"]
    assert out["general_akis_private_cycle_evidence"][
        "original_author_form_eight_phase_reproduction"
    ] == []
