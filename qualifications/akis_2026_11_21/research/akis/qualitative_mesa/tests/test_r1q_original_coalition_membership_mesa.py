"""AKIS R1-Q: immutable original relationship + prospective revised membership.

No legal admission or rights created. One original QualitativeAKIS, one trace,
original Work/Result, independent proposed entrant/exit review and fresh consent.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import QualitativeAKIS
from .test_cooperation_change_to_work_mesa import prepare, accept_first_work


def membership_case(*, change="ADD_FUTURE_PARTICIPANT",
                    responses=None, applied=True, second_work=True):
    d = prepare()
    d["subjects"].append({"id": "c", "kind": "SME"})
    d["resources"].append({"id": "rc", "owner": "c"})
    d["resources"].append({"id": "rb", "owner": "b"})
    entrant = change == "ADD_FUTURE_PARTICIPANT"
    candidate = "c" if entrant else "a"
    next_parties = ("a", "b", "op", "c") if entrant else ("b", "op")
    work_resource = "rc" if entrant else "rb"
    first = accept_first_work()
    consultation = [{
        "at": 9, "action": "cooperation_change_propose", "actor": "b",
        "cooperation_link": "net", "cooperation_source_revision": "n-1",
        "org_revision": "oc-1", "change_id": "member-1",
        "change_kind": change, "proposed_subject": candidate,
        "economic_channel": "TRANSACTION_COST",
        "change_source_ref": "model://b/membership-proposal-after-result",
    }]
    subjects = ("a", "b", "op", "c") if entrant else ("a", "b", "op")
    decisions = responses or {}
    for i, actor in enumerate(subjects):
        consultation.append({
            "at": 10 + i, "action": "cooperation_change_response",
            "actor": actor, "cooperation_link": "net",
            "cooperation_source_revision": "n-1",
            "org_revision": "oc-1", "change_id": "member-1",
            "change_decision": decisions.get(actor, "SUPPORT_MODEL_PROPOSAL"),
            "change_source_ref": f"model://{actor}/membership-review-{i}",
        })
    t = 14
    adoption = {
        "at": t, "action": "cooperation_membership_apply", "actor": "b",
        "cooperation_link": "net", "cooperation_source_revision": "n-1",
        "org_revision": "oc-1", "change_id": "member-1",
        "pilot_work": "w1", "pilot_result_ref": "model://a/first-execution",
        "pilot_decision_at": 8,
        "new_link_id": "net-2", "new_link_revision": "n-2",
        "new_link_source_ref": "model://b/net-2-source",
    }
    if applied:
        consultation.append(adoption)
    fresh = []
    if second_work:
        fresh = [
            {"at": 15, "action": "request", "actor": "b",
             "cooperation_link": "net-2", "cooperation_source_revision": "n-2",
             "work_spec": {
                 "id": "w2", "customer": "b", "resource": work_resource,
                 "source_revision": "d-2", "slot_start": 20, "slot_end": 30,
                 "requires_accepted": ["w1"],
             }},
            {"at": 16, "action": "offer", "actor": "op", "work": "w2"},
            {"at": 17, "action": "authorize", "actor": "op", "work": "w2"},
            {"at": 18, "action": "consent", "actor": "b", "work": "w2",
             "source_revision": "d-2", "org_revision": "oc-1"},
            {"at": 19, "action": "consent", "actor": candidate if entrant else "b",
             "work": "w2", "source_revision": "d-2", "org_revision": "oc-1"},
            {"at": 20, "action": "commit", "actor": "op", "work": "w2"},
            {"at": 21, "action": "start", "actor": work_resource == "rc" and "c" or "b",
             "work": "w2"},
            {"at": 22, "action": "complete", "actor": work_resource == "rc" and "c" or "b",
             "work": "w2", "result_ref": "model://w2-result"},
            {"at": 23, "action": "accept", "actor": "b", "work": "w2"},
        ]
    # Do not create duplicate second consent if customer also owns resource.
    if not entrant:
        fresh = [row for row in fresh if row["at"] != 19]
    d["events"] = first + consultation + fresh
    d["model_horizon"] = 28
    return d


def reports(output, action):
    return [r for r in output["trace"] if r["action"] == action]


def test_r1q_new_entrant_and_separate_new_original_work_in_revised_relation():
    d = membership_case()
    untouched = deepcopy(d)
    out = simulate(d)
    assert untouched == d
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"]) for r in out["trace"]
        if r["outcome"] == "BLOCKED"
    ]
    event = reports(out, "cooperation_membership_apply")[0]
    assert event["outcome"] == "APPLIED"
    assert event["previous_participants"] == ["a", "b", "op"]
    assert event["successor_participants"] == ["a", "b", "op", "c"]
    assert event["newly_admitted_model_party"] == "c"
    assert event["pilot_work"] == "w1"
    links = {r["id"]: r for r in out["cooperation"]["links"]}
    assert links["net"]["original_participants"] == ["a", "b", "op"]
    assert links["net"]["works"] == ["w1"]
    assert links["net"]["succeeded_for_future_model_work_by"] == "net-2"
    assert links["net-2"]["prospective_successor_of"] == "net"
    assert links["net-2"]["original_participants"] == ["a", "b", "op", "c"]
    assert links["net-2"]["works"] == ["w2"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["consenting_principals"] == ["b", "c"]
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert event["legal_membership_or_IP_rights_authenticated"] is False
    assert simulate(deepcopy(d)) == out


def test_r1q_exit_creates_successor_without_removing_old_resource_owner():
    d = membership_case(change="REVIEW_FUTURE_PARTICIPATION")
    out = simulate(d)
    assert out["counts"]["blocked"] == 0
    event = reports(out, "cooperation_membership_apply")[0]
    assert event["former_model_party"] == "a"
    assert event["previous_participants"] == ["a", "b", "op"]
    assert event["successor_participants"] == ["b", "op"]
    old = next(l for l in out["cooperation"]["links"] if l["id"] == "net")
    new = next(l for l in out["cooperation"]["links"] if l["id"] == "net-2")
    assert old["original_participants"] == ["a", "b", "op"]
    assert old["work_results"]["w1"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert new["original_participants"] == ["b", "op"]
    assert out["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert out["works"]["w2"]["consenting_principals"] == ["b"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["subjects"]["a"]["active_for_new_work"] is True  # not expelled


@pytest.mark.parametrize("response,reason", [
    ({"c": "OBJECT_MODEL_PROPOSAL"},
     "COOPERATION_MEMBERSHIP_INDEPENDENT_SUPPORT_INCOMPLETE"),
    ({"a": "OBJECT_MODEL_PROPOSAL"},
     "COOPERATION_MEMBERSHIP_INDEPENDENT_SUPPORT_INCOMPLETE"),
])
def test_r1q_original_or_new_entrant_independent_objection_blocks_revision(response, reason):
    d = membership_case(responses=response, second_work=False)
    out = simulate(d)
    assert reports(out, "cooperation_membership_apply")[0]["reason"] == reason
    assert [l["id"] for l in out["cooperation"]["links"]] == ["net"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1q_source_wrong_pilot_revision_and_consent_cannot_be_laundered():
    for mutate, expected in [
        (lambda ev: ev.update(pilot_decision_at=7),
         "COOPERATION_MEMBERSHIP_PILOT_DECISION_MISMATCH"),
        (lambda ev: ev.update(new_link_source_ref="model://op/foreign"),
         "COOPERATION_MEMBERSHIP_SOURCE_MUST_BELONG_TO_PROPOSER"),
        (lambda ev: ev.update(cooperation_source_revision="n-old"),
         "COOPERATION_MEMBERSHIP_PARENT_REVISION_STALE"),
        (lambda ev: ev.update(new_link_revision="n-1"),
         "COOPERATION_MEMBERSHIP_SUCCESSOR_REVISION_UNCHANGED"),
    ]:
        d = membership_case(second_work=False)
        ev = next(r for r in d["events"] if r["action"] == "cooperation_membership_apply")
        mutate(ev)
        out = simulate(d)
        assert reports(out, "cooperation_membership_apply")[0]["reason"] == expected
        assert [l["id"] for l in out["cooperation"]["links"]] == ["net"]


def test_r1q_proposal_before_accepted_original_result_cannot_create_successor():
    d = membership_case(second_work=False)
    next(e for e in d["events"] if e["action"] == "accept" and
         e["work"] == "w1")["at"] = 9
    next(e for e in d["events"] if e["action"] ==
         "cooperation_change_propose")["at"] = 8
    next(e for e in d["events"] if e["action"] ==
         "cooperation_membership_apply")["pilot_decision_at"] = 9
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert reports(out, "cooperation_change_propose")[0]["outcome"] == "APPLIED"
    assert reports(out, "cooperation_membership_apply")[0]["reason"] == (
        "COOPERATION_MEMBERSHIP_PILOT_DECISION_MISMATCH"
    )
    assert [l["id"] for l in out["cooperation"]["links"]] == ["net"]


def test_r1q_prior_relation_cannot_accept_new_work_after_successor_revision():
    d = membership_case(second_work=False)
    d["events"].append({
        "at": 15, "action": "request", "actor": "b",
        "cooperation_link": "net", "cooperation_source_revision": "n-1",
        "work_spec": {
            "id": "w2", "customer": "b", "resource": "ra",
            "source_revision": "d-2", "slot_start": 20, "slot_end": 30,
            "requires_accepted": ["w1"],
        },
    })
    out = simulate(d)
    assert reports(out, "request")[0]["reason"] == (
        "COOPERATION_OLD_RELATION_RETIRED_FOR_NEW_WORK"
    )
    assert "w2" not in out["works"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1q_neither_new_membership_nor_old_consent_allocates_foreign_resources():
    d = membership_case(second_work=False)
    d["events"].extend([
        {"at": 15, "action": "request", "actor": "b",
         "cooperation_link": "net-2", "cooperation_source_revision": "n-2",
         "work_spec": {
             "id": "w2", "customer": "b", "resource": "ra",
             "source_revision": "d-2", "slot_start": 20, "slot_end": 30,
             "requires_accepted": ["w1"],
         }},
        {"at": 16, "action": "offer", "actor": "op", "work": "w2"},
        {"at": 17, "action": "authorize", "actor": "op", "work": "w2"},
        {"at": 18, "action": "consent", "actor": "c", "work": "w2",
         "source_revision": "d-2", "org_revision": "oc-1"},
    ])
    out = simulate(d)
    assert reports(out, "cooperation_membership_apply")[0]["outcome"] == "APPLIED"
    assert reports(out, "consent")[-1]["reason"] == "NOT_AN_ORIGINAL_OBLIGATION_OWNER"
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1q_duplicate_application_and_multiple_successor_from_same_parent_blocked():
    d = membership_case(second_work=False)
    original = next(ev for ev in d["events"]
                    if ev["action"] == "cooperation_membership_apply")
    double = deepcopy(original)
    double.update(at=15, new_link_id="net-3", new_link_revision="n-3",
                  new_link_source_ref="model://b/net-3")
    d["events"].append(double)
    out = simulate(d)
    assert [r["outcome"] for r in reports(out, "cooperation_membership_apply")] == [
        "APPLIED", "BLOCKED"
    ]
    assert reports(out, "cooperation_membership_apply")[-1]["reason"] == (
        "COOPERATION_MEMBERSHIP_PARENT_ALREADY_SUCCEEDED"
    )
    assert sorted(l["id"] for l in out["cooperation"]["links"]) == ["net", "net-2"]


def test_r1q_nine_component_model_only_counts_successor_after_later_accepted_result():
    from .test_general_system_mesa_integration import design
    d = membership_case()
    d["general_akis"] = design()
    out = simulate(d)
    summary = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert summary["source_scoped_original_coalition_successions_with_accepted_work"] == 1
    assert summary["source_scoped_original_coalition_successions_without_accepted_work"] == 0
    assert summary["source_scoped_membership_successors_are_not_legal_membership"] is True
    witness = out["general_akis_private_cycle_evidence"][
        "original_coalition_membership_successions"
    ]
    assert len(witness) == 1
    assert witness[0]["original_accepted_pilot_work"] == "w1"
    assert witness[0]["new_original_accepted_work_ids"] == ["w2"]
    assert witness[0]["successor_membership_frozen_in_original_event"] is True
    assert witness[0]["new_legal_membership_or_original_asset_rights_verified"] is False
    assert summary["all_nine_component_original_causal_closure_proven"] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_r1q_consultation_or_successor_without_new_work_does_not_prove_reproduction():
    from .test_general_system_mesa_integration import design
    d = membership_case(second_work=False)
    d["general_akis"] = design()
    out = simulate(d)
    summary = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert summary["source_scoped_original_coalition_successions_with_accepted_work"] == 0
    assert summary["source_scoped_original_coalition_successions_without_accepted_work"] == 1
    assert out["general_akis_private_cycle_evidence"][
        "original_coalition_membership_successions"
    ][0]["source_scoped_model_membership_reproduction"] == (
        "NO_QUALIFIED_SUCCESSOR_WORK"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert "w2" not in out["works"]
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_r1q_exit_new_relation_and_prior_relation_are_two_distinct_original_model_epochs():
    d = membership_case(change="REVIEW_FUTURE_PARTICIPATION")
    model = QualitativeAKIS({k: deepcopy(v) for k, v in d.items()
                            if k not in {"model_horizon"}})
    # Consecutive ORIGINAL events create the successor; at no time does
    # leaving the NEW relation remove the former owner from old Work.
    before = model.works["w1"]
    initial_parties = next(x.participants for x in model.cooperation_links
                           if x.key == "net")
    for event in d["events"]:
        result = model.apply(event, event["at"])
        assert result["outcome"] == "APPLIED"
        assert before is model.works["w1"]
        assert next(x.participants for x in model.cooperation_links
                    if x.key == "net") == initial_parties
        if event["action"] == "cooperation_membership_apply":
            assert before.obligation == "FULFILLED"
            assert before.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            assert next(x.participants for x in model.cooperation_links
                        if x.key == "net-2") == ("b", "op")
    assert model.works["w2"].result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def two_membership_revisions_case(*, exit_vote="SUPPORT_MODEL_PROPOSAL"):
    d = membership_case()
    d["events"].extend([
        {
            "at": 24, "action": "cooperation_change_propose",
            "actor": "b", "cooperation_link": "net-2",
            "cooperation_source_revision": "n-2", "org_revision": "oc-1",
            "change_id": "member-2", "change_kind": "REVIEW_FUTURE_PARTICIPATION",
            "proposed_subject": "c", "economic_channel": "TRANSACTION_COST",
            "change_source_ref": "model://b/after-second-result-exit-review",
        },
        *[
            {
                "at": t, "action": "cooperation_change_response",
                "actor": actor, "cooperation_link": "net-2",
                "cooperation_source_revision": "n-2", "org_revision": "oc-1",
                "change_id": "member-2",
                "change_decision": (exit_vote if actor == "c"
                                    else "SUPPORT_MODEL_PROPOSAL"),
                "change_source_ref": f"model://{actor}/second-consultation-{t}",
            }
            for t, actor in ((25, "a"), (26, "b"), (27, "op"), (28, "c"))
        ],
        {
            "at": 29, "action": "cooperation_membership_apply", "actor": "b",
            "cooperation_link": "net-2", "cooperation_source_revision": "n-2",
            "org_revision": "oc-1", "change_id": "member-2",
            "pilot_work": "w2", "pilot_result_ref": "model://w2-result",
            "pilot_decision_at": 23,
            "new_link_id": "net-3", "new_link_revision": "n-3",
            "new_link_source_ref": "model://b/third-relation",
        },
        {"at": 30, "action": "request", "actor": "b",
         "cooperation_link": "net-3", "cooperation_source_revision": "n-3",
         "work_spec": {
             "id": "w3", "customer": "b", "resource": "ra",
             "source_revision": "d-3", "slot_start": 40, "slot_end": 50,
             "requires_accepted": ["w2"],
         }},
        {"at": 31, "action": "offer", "actor": "op", "work": "w3"},
        {"at": 32, "action": "authorize", "actor": "op", "work": "w3"},
        {"at": 33, "action": "consent", "actor": "a", "work": "w3",
         "source_revision": "d-3", "org_revision": "oc-1"},
        {"at": 34, "action": "consent", "actor": "b", "work": "w3",
         "source_revision": "d-3", "org_revision": "oc-1"},
        {"at": 35, "action": "commit", "actor": "op", "work": "w3"},
        {"at": 36, "action": "start", "actor": "a", "work": "w3"},
        {"at": 37, "action": "complete", "actor": "a", "work": "w3",
         "result_ref": "model://w3-result"},
        {"at": 38, "action": "accept", "actor": "b", "work": "w3"},
    ])
    d["model_horizon"] = 42
    return d


def test_r1q_multiple_original_membership_eras_entry_then_exit_then_three_results():
    from .test_general_system_mesa_integration import design
    d = two_membership_revisions_case()
    d["general_akis"] = design()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"]) for r in out["trace"]
        if r["outcome"] == "BLOCKED"
    ]
    revisions = reports(out, "cooperation_membership_apply")
    assert [r["successor_link"] for r in revisions] == ["net-2", "net-3"]
    assert [r["change_kind"] for r in revisions] == [
        "ADD_FUTURE_PARTICIPANT", "REVIEW_FUTURE_PARTICIPATION"
    ]
    links = {r["id"]: r for r in out["cooperation"]["links"]}
    assert links["net"]["original_participants"] == ["a", "b", "op"]
    assert links["net-2"]["original_participants"] == ["a", "b", "op", "c"]
    assert links["net-3"]["original_participants"] == ["a", "b", "op"]
    assert [links[l]["works"] for l in ("net", "net-2", "net-3")] == [
        ["w1"], ["w2"], ["w3"]
    ]
    assert [out["works"][w]["consenting_principals"]
            for w in ("w1", "w2", "w3")] == [
        ["a", "b"], ["b", "c"], ["a", "b"]
    ]
    assert all(out["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1", "w2", "w3"))
    evidence = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert evidence["source_scoped_original_coalition_successions_with_accepted_work"] == 2
    assert evidence["all_nine_component_original_causal_closure_proven"] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out == simulate(deepcopy(d))


def test_r1q_new_entrant_refuses_later_exit_and_old_two_results_stay_accepted():
    d = two_membership_revisions_case(exit_vote="OBJECT_MODEL_PROPOSAL")
    out = simulate(d)
    revisions = reports(out, "cooperation_membership_apply")
    assert revisions[0]["outcome"] == "APPLIED"
    assert revisions[1]["reason"] == (
        "COOPERATION_MEMBERSHIP_INDEPENDENT_SUPPORT_INCOMPLETE"
    )
    assert sorted(link["id"] for link in out["cooperation"]["links"]) == [
        "net", "net-2"
    ]
    assert reports(out, "request")[-1]["reason"] == "COOPERATION_LINK_UNKNOWN"
    assert "w3" not in out["works"]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
