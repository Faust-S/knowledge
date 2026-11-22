"""R1-J: four source-scoped KPB cores and 13 model OC elements are ACTIVE
formation constraints in the existing QualitativeAKIS Work event path.

Checks remain MODEL_ONLY and original independent business decisions prevail.
No second state machine, escrow, alternative Work/Result or legal signatures.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_org_code_mesa_integration import case as org_code_case
from .test_r1_formation_original_gates_mesa import formation_case, trace_for


CORES = (
    ("personal", "b", "b"),
    ("corporate", "a", "op"),
    ("operator", "op", "op"),
    ("institutional", "b", "op"),
)


def institutional_case():
    d = formation_case()
    d["events"][0]["work_spec"]["slot_start"] = 24
    d["events"][0]["work_spec"]["slot_end"] = 35
    g = d["general_akis"]
    g["enforce_model_org_code"] = True
    g["enforce_model_formation_context_code"] = True
    g["organizational_code"] = deepcopy(org_code_case()["general_akis"]["organizational_code"])
    for row in g["organizational_code"]:
        row["expires_at"] = 90
    for row in g["goals"] + g["formation_phases"]:
        row["expires_at"] = 90
    for phase, owner in ((4, "a"), (4, "b"), (4, "op"),
                         (5, "a"), (5, "b"), (5, "op")):
        g["formation_phases"].append({
            "phase": phase, "owner": owner,
            "source_ref": f"model://{owner}/formation-{phase}",
            "revision": "oc-1", "available_at": 0, "expires_at": 90,
        })
    g["context_cores"] = []
    d["context_evidence"] = {"strict": False, "sources": [], "requirements": []}
    for core, owner, recipient in CORES:
        sid = "basis-" + core
        g["context_cores"].append({
            "owner": owner, "source_ref": f"model://{owner}/core-{core}",
            "revision": "oc-1", "available_at": 0, "expires_at": 90,
            "core": core, "recipient": recipient, "purpose": "akis-formation",
            "operation": "READ", "basis_source": sid, "basis_revision": "source-r1",
        })
        d["context_evidence"]["sources"].append({
            "id": sid, "owner": owner, "revision": "source-r1",
            "status": "CONFIRMED", "usable_by": [recipient],
            "core": core, "purposes": ["akis-formation"],
            "operations": ["READ"], "valid_from": 0, "valid_until": 90,
        })
    d["context_evidence"]["sources"].append({
        "id": "commit-proof", "owner": "b", "revision": "commit-r1",
        "status": "CONFIRMED", "usable_by": ["op"], "core": "corporate",
        "purposes": ["decision-review"], "operations": ["ACCEPT"],
        "valid_from": 0, "valid_until": 90,
    })
    d["context_evidence"]["requirements"].append({
        "work": "w1", "action": "commit", "sources": ["commit-proof"],
        "expected_revisions": ["commit-r1"], "core": "corporate",
        "purpose": "decision-review", "operation": "ACCEPT",
    })
    d["events"] = d["events"][:4]
    for at, (core, owner, _) in enumerate(CORES, 5):
        d["events"].append({
            "at": at, "action": "formation_confirm", "actor": owner,
            "work": "w1", "phase": 4, "org_revision": "oc-1",
            "formation_source_ref": f"model://{owner}/formation-4",
            "formation_core": core, "formation_basis_source": "basis-" + core,
        })
    for at, owner in enumerate(("op", "a", "b"), 9):
        d["events"].append({
            "at": at, "action": "formation_confirm", "actor": owner,
            "work": "w1", "phase": 5, "org_revision": "oc-1",
            "formation_source_ref": f"model://{owner}/formation-5",
        })
    d["events"].extend([
        {"at": 12, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 13, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 14, "action": "consent", "actor": "a", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 15, "action": "consent", "actor": "b", "work": "w1",
         "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 16, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 25, "action": "start", "actor": "a", "work": "w1"},
        {"at": 26, "action": "complete", "actor": "a", "work": "w1",
         "result_ref": "model://w1-result"},
        {"at": 27, "action": "accept", "actor": "b", "work": "w1"},
    ])
    d["model_horizon"] = 38
    return d


def test_r1j_four_original_contexts_three_founders_and_original_work_result():
    d = institutional_case()
    copy = deepcopy(d)
    out = simulate(d)
    assert d == copy
    assert out["counts"] == {"applied": 19, "blocked": 0}, out["trace"]
    assert out["works"]["w1"]["obligation"] == "FULFILLED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["context_basis"]["authenticated_documents"] is False
    form = trace_for(out, "formation_confirm")
    assert [row["formation_core"] for row in form if row["phase"] == 4] == [
        "personal", "corporate", "operator", "institutional",
    ]
    assert [row["actor"] for row in form if row["phase"] == 5] == [
        "op", "a", "b",
    ]
    shared = out["general_akis_model"]
    assert shared["context_and_code_formation_model_gate"]["opted_in"] is True
    assert shared["context_and_code_formation_model_gate"][
        "four_original_context_core_confirmations"] == 4
    assert shared["context_and_code_formation_model_gate"][
        "original_founder_code_confirmations"] == 3
    assert all(not row["actual_formation_phase_completed"]
               for row in shared["formation_phases"])
    assert not shared["context_and_code_formation_model_gate"][
        "all_eight_author_phases_executable"]
    assert not shared["legal_consent_created"]
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out


def test_r1j_missing_fourth_core_blocks_original_commit_after_independent_consents():
    d = institutional_case()
    d["events"] = [e for e in d["events"] if not (
        e["action"] == "formation_confirm" and
        e.get("formation_core") == "institutional"
    )]
    out = simulate(d)
    assert trace_for(out, "commit")[0]["reason"] == (
        "FORMATION_KPB_ORIGINAL_CORE_CONFIRMATION_MISSING"
    )
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"
    assert [r["outcome"] for r in trace_for(out, "consent")] == [
        "APPLIED", "APPLIED"
    ]


@pytest.mark.parametrize("mutate,reason", [
    (lambda d: d["context_evidence"]["sources"][1].update(status="UNKNOWN"),
     "FORMATION_KPB_CONTEXT_SOURCE_UNKNOWN"),
    (lambda d: d["context_evidence"]["sources"][1].update(
        usable_by=["a"]), "FORMATION_KPB_CONTEXT_USE_NOT_PERMITTED"),
    (lambda d: d["context_evidence"]["sources"][1].update(
        revision="source-old"), "FORMATION_KPB_CONTEXT_REVISION_STALE"),
    (lambda d: d["context_evidence"]["sources"][1].update(
        valid_until=5), "FORMATION_KPB_CONTEXT_SOURCE_EXPIRED"),
    (lambda d: d["events"][5].update(
        actor="op"), "FORMATION_KPB_ORIGINAL_SOURCE_OWNER_REQUIRED"),
    (lambda d: d["events"][5].update(
        formation_basis_source="basis-personal"),
     "FORMATION_KPB_EXACT_ORIGINAL_CORE_CLAIM_REQUIRED"),
    (lambda d: d["events"][5].update(
        formation_core="unknown-core"), "FORMATION_KPB_AUTHOR_CORE_UNKNOWN"),
])
def test_r1j_no_unqualified_four_core_source_can_manufacture_phase_four(mutate, reason):
    d = institutional_case()
    mutate(d)
    out = simulate(d)
    assert trace_for(out, "formation_confirm")[4]["reason"] == reason
    assert trace_for(out, "commit")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_r1j_source_revocation_after_stage_four_invalidates_new_commit_only():
    d = institutional_case()
    d["events"].insert(-4, {
        "at": 16, "action": "source_update", "actor": "a",
        "source": "basis-corporate", "status": "UNKNOWN",
    })
    next(x for x in d["events"] if x["action"] == "commit")["at"] = 17
    out = simulate(d)
    assert [row["outcome"] for row in trace_for(out, "formation_confirm")
            if row["phase"] == 4] == ["APPLIED"] * 4
    assert trace_for(out, "source_update")[0]["outcome"] == "APPLIED"
    assert trace_for(out, "commit")[0]["reason"] == (
        "FORMATION_KPB_CORE_SOURCE_STALE_OR_REVOKED"
    )
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_r1j_founder_cannot_replace_another_founders_code_acknowledgement():
    d = institutional_case()
    d["events"] = [e for e in d["events"] if not (
        e["action"] == "formation_confirm" and e.get("phase") == 5 and
        e["actor"] == "b"
    )]
    out = simulate(d)
    assert trace_for(out, "commit")[0]["reason"] == (
        "FORMATION_PRIOR_OWNER_PHASE_CONFIRMATION_MISSING"
    )
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_r1j_stale_thirteen_code_sources_do_not_qualify_any_new_work():
    d = institutional_case()
    for row in d["general_akis"]["organizational_code"]:
        row["expires_at"] = 15
    out = simulate(d)
    assert trace_for(out, "commit")[0]["reason"] == "OC_SOURCE_STALE_OR_EXPIRED"
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_r1j_explicit_oc_denial_dominates_all_positive_formation_confirmations():
    d = institutional_case()
    denial = next(row for row in d["general_akis"]["organizational_code"]
                  if row["field"] == "Запр")
    denial["control"]["denied"][0]["items"].append("commit")
    out = simulate(d)
    assert trace_for(out, "commit")[0]["reason"] == "OC_EXPLICIT_PROHIBITION"
    assert out["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_r1j_unchecked_phase_four_five_never_becomes_automatic_formation():
    d = institutional_case()
    d["general_akis"]["enforce_model_formation_context_code"] = False
    out = simulate(d)
    denied = [row for row in trace_for(out, "formation_confirm")
              if row["phase"] >= 4]
    assert len(denied) == 7
    assert all(row["reason"] == "FORMATION_ONLY_FIRST_THREE_PHASES_EXECUTABLE"
               for row in denied)
    assert trace_for(out, "commit")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1j_cannot_enable_institutional_phases_without_original_oc_controls():
    d = institutional_case()
    del d["general_akis"]["enforce_model_org_code"]
    with pytest.raises(ValueError, match="FORMATION_CONTEXT_CODE_REQUIRES_PHASE_AND_OC_GATES"):
        simulate(d)


def test_r1j_original_accepted_result_survives_later_context_revocation():
    d = institutional_case()
    d["events"].append({
        "at": 28, "action": "source_update", "actor": "a",
        "source": "basis-corporate", "status": "DISPROVED",
    })
    out = simulate(d)
    assert trace_for(out, "source_update")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w1"]["obligation"] == "FULFILLED"


def two_cycle_case(*, second_code_complete=True):
    d = institutional_case()
    first = deepcopy(d["events"][0]["work_spec"])
    first.update({
        "id": "w2", "source_revision": "d-2", "slot_start": 70,
        "slot_end": 82, "requires_accepted": ["w1"],
    })
    d["general_akis"]["goals"].append({
        "owner": "b", "source_ref": "model://b/goal-w2",
        "revision": "oc-1", "available_at": 28, "expires_at": 90,
        "work": "w2", "work_revision": "d-2",
        "objective": "QUALITY", "priority": 2,
    })
    d["context_evidence"]["requirements"].append({
        "work": "w2", "action": "commit", "sources": ["commit-proof"],
        "expected_revisions": ["commit-r1"], "core": "corporate",
        "purpose": "decision-review", "operation": "ACCEPT",
    })
    d["events"].append({
        "at": 29, "action": "request", "actor": "b", "work_spec": first,
    })
    d["events"].extend([
        {"at": at, "action": "formation_confirm", "actor": owner,
         "work": "w2", "phase": phase, "org_revision": "oc-1",
         "formation_source_ref": f"model://{owner}/formation-{phase}"}
        for at, phase, owner in ((30, 1, "b"), (31, 2, "b"), (32, 3, "a"))
    ])
    d["events"].extend([
        {"at": at, "action": "formation_confirm", "actor": owner,
         "work": "w2", "phase": 4, "org_revision": "oc-1",
         "formation_source_ref": f"model://{owner}/formation-4",
         "formation_core": core, "formation_basis_source": "basis-" + core}
        for at, (core, owner, _) in enumerate(CORES, 33)
    ])
    d["events"].extend([
        {"at": at, "action": "formation_confirm", "actor": owner,
         "work": "w2", "phase": 5, "org_revision": "oc-1",
         "formation_source_ref": f"model://{owner}/formation-5"}
        for at, owner in enumerate(("op", "a", "b"), 37)
        if second_code_complete or owner != "b"
    ])
    d["events"].extend([
        {"at": 40, "action": "offer", "actor": "op", "work": "w2"},
        {"at": 41, "action": "authorize", "actor": "op", "work": "w2"},
        {"at": 42, "action": "consent", "actor": "a", "work": "w2",
         "source_revision": "d-2", "org_revision": "oc-1"},
        {"at": 43, "action": "consent", "actor": "b", "work": "w2",
         "source_revision": "d-2", "org_revision": "oc-1"},
        {"at": 44, "action": "commit", "actor": "op", "work": "w2"},
        {"at": 72, "action": "start", "actor": "a", "work": "w2"},
        {"at": 73, "action": "complete", "actor": "a", "work": "w2",
         "result_ref": "model://second-result"},
        {"at": 74, "action": "accept", "actor": "b", "work": "w2"},
    ])
    d["model_horizon"] = 85
    return d


def test_r1j_two_accepted_results_have_two_independent_original_institutional_formations():
    d = two_cycle_case()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, out["trace"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert len([e for e in trace_for(out, "formation_confirm")
                if e["work"] == "w2" and e["phase"] in (4, 5)]) == 7
    assert out["general_akis_model"]["context_and_code_formation_model_gate"][
        "four_original_context_core_confirmations"] == 8
    assert not out["general_akis_model"]["context_and_code_formation_model_gate"][
        "all_eight_author_phases_executable"]


def test_r1j_second_cycle_cannot_borrow_first_cycle_founder_acknowledgement():
    d = two_cycle_case(second_code_complete=False)
    out = simulate(d)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert trace_for(out, "commit")[-1]["reason"] == (
        "FORMATION_PRIOR_OWNER_PHASE_CONFIRMATION_MISSING"
    )
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
