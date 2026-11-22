"""R1-O: pilot Result -> independent phase-8 judgments -> original
model-only cooperation review -> new owner goal and interest -> Work/Result.

All sources remain MODEL_ONLY. No membership mutation, fake profit or
new permissions follow from the consultation, and old obligations persist.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1n_post_result_independent_owner_interest_mesa import r1n_case
from .test_r1l_post_result_original_reproduction_mesa import find
from .test_r1_formation_original_gates_mesa import trace_for


def r1o_case(*, response_b="SUPPORT_MODEL_PROPOSAL",
             include_proposal=True, include_change=True):
    d = r1n_case()
    d["general_akis"]["enforce_model_result_conditioned_reconfiguration"] = True
    # Existing customer request and second Work require no special legal
    # authority. Shift the ORIGINAL second cycle, not a second scheduler.
    for ev in d["events"]:
        if ev["at"] >= 34:
            ev["at"] += 4
        if ev["action"] == "function_review" and ev.get("work") == "w2":
            ev["prepared_at"] += 4
        if ev["action"] == "request" and ev["work_spec"]["id"] == "w2":
            if include_change:
                ev["change_id"] = "chg-w1"
    if include_proposal:
        d["events"].append({
            "at": 33, "action": "cooperation_change_propose", "actor": "a",
            "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
            "org_revision": "oc-1", "change_id": "chg-w1",
            "change_kind": "REVISE_RESOURCE_COOPERATION",
            "economic_channel": "TRANSACTION_COST",
            "change_source_ref": "model://a/after-result-cooperation-review",
            "pilot_work": "w1", "pilot_result_ref": "model://w1-result",
            "pilot_decision_at": 29,
        })
        for at, actor, decision in [
            (34, "a", "SUPPORT_MODEL_PROPOSAL"),
            (35, "b", response_b),
            (36, "op", "SUPPORT_MODEL_PROPOSAL"),
        ]:
            d["events"].append({
                "at": at, "action": "cooperation_change_response",
                "actor": actor, "org_revision": "oc-1",
                "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
                "change_id": "chg-w1", "change_decision": decision,
                "change_source_ref": f"model://{actor}/review-chg-w1-{at}",
            })
    d["events"].sort(key=lambda ev: ev["at"])
    d["model_horizon"] = 83
    return d


def test_r1o_full_original_result_owner_assessments_consultation_interests_and_two_results():
    d = r1o_case()
    saved = deepcopy(d)
    out = simulate(d)
    assert d == saved
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"])
        for r in out["trace"] if r["outcome"] == "BLOCKED"
    ]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    proposal = trace_for(out, "cooperation_change_propose")[0]
    assert proposal["pilot_work"] == "w1"
    assert proposal["pilot_result_ref"] == "model://w1-result"
    assert proposal["at"] > max(
        x["at"] for x in trace_for(out, "participation_status")
    )
    assert [x["actor"] for x in trace_for(out, "cooperation_change_response")] == [
        "a", "b", "op"
    ]
    followup = find(out, "request", work="w2")[0]
    assert followup["request_linked_change_id"] == "chg-w1"
    assert followup["request_fresh_consent_and_org_code_required"] is True
    assert followup["outcome"] == "APPLIED"
    assert [x["actor"] for x in find(out, "interest_update", work="w2")] == ["a","b"]
    gate = out["general_akis_model"]["post_result_cooperation_reconfiguration"]
    assert gate["opted_in"] is True
    assert gate["original_result_conditioned_proposals"] == 1
    assert gate["work_requests_citing_prior_original_review"] == 1
    assert gate["new_membership_or_legal_rights_created_by_consultation"] is False
    assert gate["real_transaction_savings_established"] is False
    cycle = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert cycle["original_post_result_institutional_reproduction_link_count"] == 1
    assert cycle["same_original_causal_chain_includes_capability_and_institutional_change"] is False
    private = out["general_akis_private_cycle_evidence"][
        "original_post_result_institutional_reproduction_links"
    ]
    assert len(private) == 1
    assert private[0]["all_original_pilot_principals_evaluated_before_change"]
    assert private[0]["original_consultation_complete_before_request"]
    assert private[0]["individual_interests_and_fresh_consents_confirmed"]
    assert private[0]["second_original_result_accepted_after_new_commit"]
    assert private[0]["model_institutional_reproduction_witness"] != "NOT_CAUSALLY_QUALIFIED"
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out == simulate(deepcopy(d))


def test_r1o_no_original_consultation_cannot_form_next_work():
    d = r1o_case(include_proposal=False)
    out = simulate(d)
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_RECONFIGURATION_POST_RESULT_PROPOSAL_REQUIRED"
    )
    assert "w2" not in out["works"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1o_successful_consultation_without_original_request_reference_does_not_create_work():
    d = r1o_case(include_change=False)
    out = simulate(d)
    assert all(x["outcome"] == "APPLIED"
               for x in trace_for(out, "cooperation_change_response"))
    assert find(out, "request", work="w2")[0]["reason"] == (
        "FORMATION_RECONFIGURATION_ORIGINAL_CONSULTATION_REQUIRED"
    )
    assert "w2" not in out["works"]


@pytest.mark.parametrize("change,reason", [
    (lambda ev: ev.update(pilot_result_ref="model://w0-fabricated"),
     "FORMATION_RECONFIGURATION_PILOT_RESULT_REFERENCE_MISMATCH"),
    (lambda ev: ev.update(pilot_decision_at=28),
     "FORMATION_RECONFIGURATION_PILOT_DECISION_TIME_MISMATCH"),
    (lambda ev: ev.update(change_source_ref="model://op/foreign-source"),
     "FORMATION_RECONFIGURATION_ORIGINAL_PROPOSER_SOURCE_REQUIRED"),
    (lambda ev: ev.update(pilot_work="w0"),
     "FORMATION_RECONFIGURATION_ACCEPTED_PILOT_REQUIRED"),
])
def test_r1o_early_change_cannot_borrow_unrelated_source_or_pilot_result(change, reason):
    d = r1o_case()
    proposal = next(e for e in d["events"]
                    if e["action"] == "cooperation_change_propose")
    change(proposal)
    out = simulate(d)
    assert trace_for(out, "cooperation_change_propose")[0]["reason"] == reason
    assert find(out, "request", work="w2")[0]["outcome"] == "BLOCKED"
    assert "w2" not in out["works"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1o_any_original_member_objection_blocks_new_cycle_without_erasing_result():
    d = r1o_case(response_b="OBJECT_MODEL_PROPOSAL")
    out = simulate(d)
    assert trace_for(out, "cooperation_change_response")[1]["outcome"] == "APPLIED"
    assert find(out, "request", work="w2")[0]["reason"] == (
        "COOPERATION_CHANGE_INDEPENDENT_CONSULTATION_NOT_COMPLETE"
    )
    assert "w2" not in out["works"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1o_late_original_member_objection_blocks_commit_even_after_consents():
    d = r1o_case()
    commit = next(e for e in d["events"]
                  if e["action"] == "commit" and e["work"] == "w2")
    t = commit["at"]
    # Insert one distinct event AFTER the original consents. The one
    # original Work event clock remains strictly increasing.
    for ev in d["events"]:
        if ev["at"] >= t:
            ev["at"] += 1
    d["events"].append({
        "at": t, "action": "cooperation_change_response", "actor": "b",
        "org_revision": "oc-1",
        "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
        "change_id": "chg-w1", "change_decision": "OBJECT_MODEL_PROPOSAL",
        "change_source_ref": "model://b/late-independent-objection",
    })
    d["events"].sort(key=lambda ev: ev["at"])
    out = simulate(d)
    assert all(x["outcome"] == "APPLIED"
               for x in find(out, "consent", work="w2"))
    assert find(out, "commit", work="w2")[0]["reason"] == (
        "FORMATION_RECONFIGURATION_INDEPENDENT_REVIEW_NO_LONGER_CURRENT"
    )
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_r1o_original_member_missing_result_evaluation_cannot_open_model_consultation():
    d = r1o_case()
    d["events"] = [e for e in d["events"] if not (
        e["action"] == "participation_status" and e["actor"] == "a"
    )]
    out = simulate(d)
    assert trace_for(out, "cooperation_change_propose")[0]["reason"] == (
        "FORMATION_RECONFIGURATION_EACH_ORIGINAL_OWNER_EVALUATION_REQUIRED"
    )
    assert find(out, "request", work="w2")[0]["outcome"] == "BLOCKED"
    assert "w2" not in out["works"]


def test_r1o_optout_does_not_redefine_existing_original_cooperation_consultation():
    d = r1o_case()
    d["general_akis"]["enforce_model_result_conditioned_reconfiguration"] = False
    out = simulate(d)
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_model"]["post_result_cooperation_reconfiguration"][
        "opted_in"
    ] is False


def test_r1o_optin_requires_previous_independent_interest_step():
    d = r1o_case()
    d["general_akis"]["enforce_model_result_conditioned_interests"] = False
    with pytest.raises(ValueError, match="FORMATION_RECONFIGURATION_REQUIRES_INDIVIDUAL_INTERESTS"):
        simulate(d)


def test_r1o_retracted_late_objection_without_new_consents_still_blocks_commit():
    d = r1o_case()
    commitment = next(ev for ev in d["events"]
                      if ev["action"] == "commit" and ev["work"] == "w2")
    time = commitment["at"]
    commitment["at"] = time + 2
    for at, decision, source in (
        (time, "OBJECT_MODEL_PROPOSAL", "objection"),
        (time + 1, "SUPPORT_MODEL_PROPOSAL", "reconsideration"),
    ):
        d["events"].append({
            "at": at, "action": "cooperation_change_response", "actor": "b",
            "org_revision": "oc-1", "change_id": "chg-w1",
            "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
            "change_decision": decision,
            "change_source_ref": "model://b/" + source,
        })
    d["events"].sort(key=lambda ev: ev["at"])
    out = simulate(d)
    assert find(out, "request", work="w2")[0]["outcome"] == "APPLIED"
    assert [x["change_decision"] for x in
            trace_for(out, "cooperation_change_response")][-2:] == [
        "OBJECT_MODEL_PROPOSAL", "SUPPORT_MODEL_PROPOSAL"
    ]
    assert find(out, "commit", work="w2")[0]["reason"] == (
        "FORMATION_RECONFIGURATION_FRESH_CONSENT_AFTER_REVIEW_REQUIRED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"


def test_r1o_after_reconsideration_both_original_owners_must_reconsent():
    d = r1o_case()
    commitment = next(ev for ev in d["events"]
                      if ev["action"] == "commit" and ev["work"] == "w2")
    time = commitment["at"]
    commitment["at"] = time + 4
    events = []
    for at, decision in ((time, "OBJECT_MODEL_PROPOSAL"),
                         (time + 1, "SUPPORT_MODEL_PROPOSAL")):
        events.append({
            "at": at, "action": "cooperation_change_response", "actor": "b",
            "org_revision": "oc-1", "change_id": "chg-w1",
            "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
            "change_decision": decision,
            "change_source_ref": f"model://b/new-assessment-{at}",
        })
    for at, owner in ((time + 2, "a"), (time + 3, "b")):
        events.append({
            "at": at, "action": "consent", "actor": owner,
            "work": "w2", "source_revision": "d-2", "org_revision": "oc-1",
        })
    d["events"].extend(events)
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (row["at"], row["action"], row["reason"]) for row in out["trace"]
        if row["outcome"] == "BLOCKED"
    ]
    assert [x["actor"] for x in find(out, "consent", work="w2")] == [
        "a", "b", "a", "b"
    ]
    assert find(out, "commit", work="w2")[0]["outcome"] == "APPLIED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out == simulate(deepcopy(d))


def test_r1o_nine_component_witness_rejects_coincidental_late_objection_and_blocked_second_result():
    d = r1o_case()
    commit = next(ev for ev in d["events"] if ev["action"] == "commit"
                  and ev["work"] == "w2")
    at = commit["at"]
    for event in d["events"]:
        if event["at"] >= at:
            event["at"] += 1
    d["events"].append({
        "at": at, "action": "cooperation_change_response", "actor": "b",
        "org_revision": "oc-1", "change_id": "chg-w1",
        "cooperation_link": "l1", "cooperation_source_revision": "rel-1",
        "change_decision": "OBJECT_MODEL_PROPOSAL",
        "change_source_ref": "model://b/late-against-second-work",
    })
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "original_post_result_institutional_reproduction_link_count"
    ] == 0
    proof = out["general_akis_private_cycle_evidence"][
        "original_post_result_institutional_reproduction_links"
    ]
    assert len(proof) == 1
    assert proof[0]["model_institutional_reproduction_witness"] == (
        "NOT_CAUSALLY_QUALIFIED"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
