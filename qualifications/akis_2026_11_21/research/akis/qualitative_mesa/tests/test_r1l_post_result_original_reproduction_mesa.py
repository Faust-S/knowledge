"""R1-L: original Result -> each owner's source-identified judgment ->
original participation choice -> independently initiated next Work/Result.

Research-only. Quality and economics are not fabricated, shared profit is
never inferred, and failures cannot undo obligations or claim legal exit.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1k_agent_original_review_mesa import agent_case
from .test_r1_formation_original_gates_mesa import trace_for


def two_cycle_lifecycle_case(*, adverse=False, failed_result=False):
    d = agent_case()
    general = d["general_akis"]
    general["enforce_model_formation_lifecycle"] = True
    # Pre-existing uncommitted, independently owned Work grounds a declared
    # real research relation. It carries NO invented Result or consent.
    baseline = deepcopy(d["events"][0]["work_spec"])
    baseline.update(id="w0", source_revision="d-0",
                    slot_start=5, slot_end=10)
    d["works"].append(baseline)
    d["cooperation_links"] = [{
        "id": "l1", "purpose": "repeat-original-service",
        "coordinator": "op", "participants": ["op", "a", "b"],
        "works": ["w0"], "mechanisms": ["TRANSACTION_COST"],
        "source_ref": "model://op/l1", "source_revision": "rel-1",
    }]
    d["events"][0].update(cooperation_link="l1",
                          cooperation_source_revision="rel-1")
    for owner, phase in (("b", 7), ("a", 8), ("b", 8)):
        general["formation_phases"].append({
            "owner": owner,
            "source_ref": f"model://{owner}/formation-{phase}",
            "revision": "oc-1", "available_at": 0, "expires_at": 90,
            "phase": phase,
        })
    second = deepcopy(d["events"][0]["work_spec"])
    second.update(
        id="w2", source_revision="d-2", slot_start=56, slot_end=66,
        requires_accepted=["w1"]
    )
    general["goals"].append({
        "owner": "b", "source_ref": "model://b/goal-w2",
        "revision": "oc-1", "available_at": 30, "expires_at": 90,
        "work": "w2", "work_revision": "d-2",
        "objective": "RESILIENCE", "priority": 2,
    })
    general["agent_functions"].append({
        **deepcopy(general["agent_functions"][0]),
        "id": "approval-w2", "work": "w2", "work_revision": "d-2",
        "source_ref": "model://op/packet-approval-w2",
    })
    d["context_evidence"]["requirements"].append({
        "work": "w2", "action": "commit", "sources": ["commit-proof"],
        "expected_revisions": ["commit-r1"], "core": "corporate",
        "purpose": "decision-review", "operation": "ACCEPT",
    })
    if failed_result:
        next(ev for ev in d["events"] if ev["action"] == "accept")[
            "action"] = "reject"
    for t, owner, verdict, future in (
        (30, "a", "ADVERSE_DECLARED" if adverse else "FAVOURABLE_DECLARED",
         "PAUSED_NEW_WORK" if adverse else "OPEN_TO_NEW_WORK"),
        (31, "b", "UNKNOWN_DECLARED", "OPEN_TO_NEW_WORK"),
    ):
        d["events"].append({
            "at": t, "action": "participation_status", "actor": owner,
            "org_revision": "oc-1", "cooperation_link": "l1",
            "cooperation_source_revision": "rel-1",
            "new_participation": future, "economic_channel": "TRANSACTION_COST",
            "participation_evidence_ref": f"model://{owner}/owner-evaluation-w1",
            "evaluated_work": "w1", "evaluated_work_revision": "d-1",
            "evaluated_result_ref": "model://w1-result",
            "evaluated_decision_at": 29, "evaluation_verdict": verdict,
            "formation_phase_source_ref": f"model://{owner}/formation-8",
        })
    d["events"].append({
        "at": 34, "action": "request", "actor": "b", "work_spec": second,
        "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
        "pilot_work": "w1",
    })
    for source in d["events"][:]:
        if not (2 <= source["at"] <= 18):
            continue
        event = deepcopy(source)
        event["at"] += 33
        if event.get("work") == "w1":
            event["work"] = "w2"
        if event.get("source_revision") == "d-1":
            event["source_revision"] = "d-2"
        if event.get("function_id") == "approval-w1":
            event["function_id"] = "approval-w2"
        if event.get("function_source_ref") == "model://op/packet-approval-w1":
            event["function_source_ref"] = "model://op/packet-approval-w2"
        if event.get("review_source_ref") == "model://b/independent-review-w1":
            event["review_source_ref"] = "model://b/independent-review-w2"
        if event.get("prepared_at") == 12:
            event["prepared_at"] = 45
        d["events"].append(event)
    d["events"].extend([
        {"at": 57, "action": "start", "actor": "a", "work": "w2"},
        {"at": 58, "action": "complete", "actor": "a", "work": "w2",
         "result_ref": "model://w2-result"},
        {"at": 59, "action": "accept", "actor": "b", "work": "w2"},
    ])
    d["events"].sort(key=lambda e: e["at"])
    d["model_horizon"] = 70
    return d


def find(out, action, *, work=None, actor=None):
    return [x for x in trace_for(out, action)
            if (work is None or x.get("work") == work)
            and (actor is None or x.get("actor") == actor)]


def test_r1l_full_positive_result_owner_feedback_new_request_and_second_accepted_result():
    d = two_cycle_lifecycle_case()
    before = deepcopy(d)
    out = simulate(d)
    assert d == before
    assert out["counts"]["blocked"] == 0, out["trace"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert find(out, "request", work="w2")[0]["outcome"] == "APPLIED"
    owner_judgments = find(out, "participation_status")
    assert [(r["actor"], r["evaluated_work"], r["evaluation_verdict"])
            for r in owner_judgments] == [
        ("a", "w1", "FAVOURABLE_DECLARED"),
        ("b", "w1", "UNKNOWN_DECLARED"),
    ]
    gate = out["general_akis_model"]["post_result_lifecycle_model_gate"]
    assert gate["opted_in"] is True
    assert gate["independent_owner_post_result_evaluations"] == 2
    assert gate["accepted_followup_work_requests"] == 1
    assert gate["real_economic_effect_established"] is False
    assert gate["all_eight_author_phases_executable"] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out == simulate(deepcopy(d))


def test_r1l_missing_independent_owner_evaluation_cannot_form_next_work():
    d = two_cycle_lifecycle_case()
    d["events"] = [e for e in d["events"] if not (
        e["action"] == "participation_status" and e["actor"] == "a")]
    out = simulate(d)
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_FOLLOWUP_EACH_ORIGINAL_OWNER_EVALUATION_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert "w2" not in out["works"]


def test_r1l_adverse_owner_economic_judgment_can_pause_own_future_participation():
    d = two_cycle_lifecycle_case(adverse=True)
    out = simulate(d)
    assert find(out, "participation_status", actor="a")[0]["outcome"] == "APPLIED"
    assert find(out, "request", work="w2")[0]["reason"] == (
        "COOPERATION_ORIGINAL_PARTY_PAUSED_NEW_WORK"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert "w2" not in out["works"]
    gate = out["general_akis_model"]["post_result_lifecycle_model_gate"]
    assert gate["adverse_owner_economic_judgments"] == 1
    assert gate["real_economic_effect_established"] is False


def test_r1l_rejected_pilot_result_allows_negative_feedback_but_not_fabricated_next_cycle():
    d = two_cycle_lifecycle_case(adverse=True, failed_result=True)
    out = simulate(d)
    assert out["works"]["w1"]["result"] == "REJECTED"
    assert all(r["outcome"] == "APPLIED"
               for r in find(out, "participation_status"))
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_FOLLOWUP_ACCEPTED_PILOT_RESULT_REQUIRED"
    )
    assert "w2" not in out["works"]
    assert out["works"]["w1"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"


@pytest.mark.parametrize("change,reason", [
    (lambda d: next(e for e in d["events"]
        if e["action"] == "participation_status" and e["actor"] == "a")
        .update(evaluated_result_ref="model://wrong"),
     "FORMATION_EVALUATION_PILOT_RESULT_REFERENCE_MISMATCH"),
    (lambda d: next(e for e in d["events"]
        if e["action"] == "participation_status" and e["actor"] == "a")
        .update(evaluated_decision_at=20),
     "FORMATION_EVALUATION_ORIGINAL_DECISION_TIME_MISMATCH"),
    (lambda d: next(e for e in d["events"]
        if e["action"] == "participation_status" and e["actor"] == "a")
        .update(evaluated_work_revision="d-old"),
     "FORMATION_EVALUATION_PILOT_WORK_REVISION_STALE"),
    (lambda d: next(e for e in d["events"]
        if e["action"] == "participation_status" and e["actor"] == "a")
        .update(formation_phase_source_ref="model://b/formation-8"),
     "FORMATION_EVALUATION_OWNER_EIGHTH_PHASE_SOURCE_REQUIRED"),
    (lambda d: next(e for e in d["events"]
        if e["action"] == "participation_status" and e["actor"] == "a")
        .update(evaluation_verdict="PROVEN_PROFIT"),
     "FORMATION_EVALUATION_OWNER_ECONOMIC_VERDICT_REQUIRED"),
    (lambda d: next(e for e in d["events"]
        if e["action"] == "participation_status" and e["actor"] == "a")
        .update(participation_evidence_ref="model://op/forged"),
     "FORMATION_EVALUATION_ORIGINAL_OWNER_SOURCE_REQUIRED"),
])
def test_r1l_forged_stale_or_unproved_feedback_cannot_unlock_followup(change, reason):
    d = two_cycle_lifecycle_case()
    change(d)
    out = simulate(d)
    assert find(out, "participation_status", actor="a")[0]["reason"] == reason
    assert find(out, "request", work="w2")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert "w2" not in out["works"]


def test_r1l_no_pilot_reference_cannot_borrow_other_link_results():
    d = two_cycle_lifecycle_case()
    next(e for e in d["events"] if e["action"] == "request"
         and e["at"] == 34).pop("pilot_work")
    out = simulate(d)
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_FOLLOWUP_LATEST_ACCEPTED_PILOT_REFERENCE_REQUIRED"
    )
    assert "w2" not in out["works"]


def test_r1l_followup_work_must_depend_on_same_accepted_original_result():
    d = two_cycle_lifecycle_case()
    next(e for e in d["events"] if e["action"] == "request"
         and e["at"] == 34)["work_spec"].pop("requires_accepted")
    out = simulate(d)
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_FOLLOWUP_ACCEPTED_RESULT_DEPENDENCY_REQUIRED"
    )


def test_r1l_expired_evaluation_source_cannot_permit_future_work():
    d = two_cycle_lifecycle_case()
    next(p for p in d["general_akis"]["formation_phases"]
         if p["phase"] == 8 and p["owner"] == "a")["expires_at"] = 33
    out = simulate(d)
    assert find(out, "participation_status", actor="a")[0]["outcome"] == "APPLIED"
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_FOLLOWUP_OWNER_EVALUATION_SOURCE_EXPIRED"
    )


def test_r1l_failed_customer_result_decision_cannot_forge_pilot_success():
    d = two_cycle_lifecycle_case()
    d["events"] = [e for e in d["events"] if not (
        e["action"] == "accept" and e["work"] == "w1")]
    out = simulate(d)
    assert all(row["outcome"] == "BLOCKED"
               for row in find(out, "participation_status"))
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_FOLLOWUP_ACCEPTED_PILOT_RESULT_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "SUBMITTED"


def test_r1l_lifecycle_is_explicit_optional_research_gate_not_automatic_rewrite():
    d = two_cycle_lifecycle_case()
    d["general_akis"]["enforce_model_formation_lifecycle"] = False
    out = simulate(d)
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_model"]["post_result_lifecycle_model_gate"][
        "opted_in"] is False


def test_r1l_cannot_enable_lifecycle_without_formational_human_review():
    d = two_cycle_lifecycle_case()
    d["general_akis"]["enforce_model_formation_agent_review"] = False
    with pytest.raises(ValueError, match="FORMATION_LIFECYCLE_REQUIRES_ORIGINAL_AGENT_REVIEW"):
        simulate(d)


def quality_lifecycle_case(*, deficient=False, missing_assessment=False):
    """Evidence-grounded quality gate, not automatically accepted Result."""
    d = two_cycle_lifecycle_case(adverse=deficient)
    work_specs = {
        "w1": next(x for x in d["events"]
                   if x["action"] == "request" and x["at"] == 1)["work_spec"],
        "w2": next(x for x in d["events"]
                   if x["action"] == "request" and x["at"] == 34)["work_spec"],
    }
    for key, spec in work_specs.items():
        spec["assurance_criteria"] = [{
            "id": "quality-criterion", "dimension": "DELIVERABLE_CONFORMITY",
            "operation": "WORK", "responsible_owner": "a", "assessor": "b",
            "method": "FUNCTIONAL_TEST",
            "source_ref": f"model://b/criterion-{key}",
            "source_revision": spec["source_revision"],
        }]
    # A result assessment must precede each independent customer decision.
    for row in d["events"]:
        if row["at"] >= 29:
            row["at"] += 1
        if row["action"] == "participation_status":
            row["evaluated_decision_at"] = 30
    d["events"].append({
        "at": 29, "action": "assess_result_quality", "actor": "b",
        "work": "w1", "criterion": "quality-criterion",
        "quality_verdict": (
            "DOES_NOT_MEET" if deficient else "MEETS_DECLARED_REQUIREMENT"
        ),
        "quality_evidence_ref": "model://b/quality-w1-inspection",
        "result_ref": "model://w1-result",
        "source_revision": "d-1", "org_revision": "oc-1",
    }) if not missing_assessment else None
    # Existing second result now arrives at 59 and would be accepted at 60.
    next(row for row in d["events"]
         if row["action"] == "accept" and row["work"] == "w2")["at"] = 61
    d["events"].append({
        "at": 60, "action": "assess_result_quality", "actor": "b",
        "work": "w2", "criterion": "quality-criterion",
        "quality_verdict": "MEETS_DECLARED_REQUIREMENT",
        "quality_evidence_ref": "model://b/quality-w2-inspection",
        "result_ref": "model://w2-result",
        "source_revision": "d-2", "org_revision": "oc-1",
    })
    if deficient:
        next(row for row in d["events"]
             if row["action"] == "accept" and row["work"] == "w1")[
                 "action"] = "reject"
    d["events"].sort(key=lambda event: event["at"])
    d["model_horizon"] = 72
    return d


def test_r1l_two_cycles_require_separate_customer_quality_assessments():
    d = quality_lifecycle_case()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (row["at"], row["action"], row["reason"])
        for row in out["trace"] if row["outcome"] == "BLOCKED"
    ]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert [row["work"] for row in trace_for(out, "assess_result_quality")] == [
        "w1", "w2"
    ]
    assert out["works"]["w1"]["assurance"]["model_reported_met_count"] == 1
    assert out["works"]["w2"]["assurance"]["model_reported_met_count"] == 1
    assert out["works"]["w1"]["assurance"][
        "independent_real_quality_certification"] == "NOT_ESTABLISHED"
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out == simulate(deepcopy(d))


def test_r1l_failed_original_quality_can_trigger_rejection_and_independent_pause():
    d = quality_lifecycle_case(deficient=True)
    out = simulate(d)
    assert out["counts"]["blocked"] >= 1, out["trace"]
    assert find(out, "assess_result_quality", work="w1")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "REJECTED"
    assert find(out, "participation_status", actor="a")[0][
        "participation_value"] == "PAUSED_NEW_WORK"
    assert find(out, "request", work="w2")[0]["outcome"] == "BLOCKED"
    assert "w2" not in out["works"]
    assert out["works"]["w1"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_r1l_unverified_quality_blocks_acceptance_and_cannot_qualify_next_cycle():
    d = quality_lifecycle_case(missing_assessment=True)
    out = simulate(d)
    assert find(out, "accept", work="w1")[0]["reason"] == (
        "QUALITY_ORIGINAL_ASSESSMENT_MISSING"
    )
    assert out["works"]["w1"]["result"] == "SUBMITTED"
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_FOLLOWUP_ACCEPTED_PILOT_RESULT_REQUIRED"
    )
    assert "w2" not in out["works"]
