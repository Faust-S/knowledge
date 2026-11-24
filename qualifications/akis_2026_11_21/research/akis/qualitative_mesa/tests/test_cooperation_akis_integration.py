"""Integration checks for the single AKIS cooperation state and economic ledger.

Numbers are arithmetic test inputs, never prices or observations of real firms.
"""
from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.tests.test_technology import world, signed, act
from research.akis.qualitative_mesa.tests.test_economic_flow import (
    fixture as economic_fixture, subject_state, work_state, transfer, resource_use,
)
from research.akis.qualitative_mesa.economic_flow import evaluate_economic_claims, EconomicInputError
from research.akis.qualitative_mesa.cooperation import CooperationLink
import pytest


def linked_world():
    d = world()
    d["cooperation_links"] = [{
        "id": "network-1", "purpose": "joint access to complementary capabilities",
        "coordinator": "op", "participants": ["a", "b", "c", "op"],
        "works": ["w1"], "mechanisms": [
            "TRANSACTION_COST", "JOINT_PURCHASING", "MEMBER_SOURCING",
            "SHARED_MARKETING", "SHARED_LOGISTICS",
        ], "source_ref": "model://network-1", "source_revision": "nw-r1",
    }]
    return d


def test_derived_cooperation_state_preserves_each_original_work():
    s = QualitativeAKIS(linked_world())
    v = s.snapshot()["cooperation"]["links"][0]
    assert v["relation_state"] == "FORMATION_NOT_FULLY_COMMITTED"
    assert v["missing_original_consents_by_work"]["w1"] == ["a", "b", "c"]
    assert v["effects_by_mechanism"]["JOINT_PURCHASING"] == "NOT_IDENTIFIABLE_WITHOUT_INDEPENDENT_ALTERNATIVE"
    signed(s)
    v = s.snapshot()["cooperation"]["links"][0]
    assert v["relation_state"] == "ORIGINAL_COMMITMENTS_ACTIVE"
    assert v["missing_original_consents_by_work"]["w1"] == []
    assert s.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert s.works["w1"].result == "NOT_SUBMITTED"
    assert s.snapshot()["profit"]["system_increment"] == "UNKNOWN"


def test_cooperation_relation_cannot_exclude_original_supplier():
    d = linked_world()
    d["cooperation_links"][0]["participants"].remove("b")
    from research.akis.qualitative_mesa.rules import InputError
    with pytest.raises(InputError, match="COOPERATION_ORIGINAL_PARTICIPANTS_REQUIRED"):
        QualitativeAKIS(d)


def test_economic_flow_reuses_rows_and_preserves_nonaddition_of_resources():
    d = economic_fixture()
    d["resource_uses"] += [
        resource_use("outside-search", "INDEPENDENT_ALTERNATIVE", "b", "25.00", "COORDINATION", "b1"),
        resource_use("joint-search", "COOPERATION", "b", "10.00", "COORDINATION", "b1"),
    ]
    d["transfers"].append(transfer("coop-outlay", "COOPERATION", "b", "EXTERNAL", "80.00", "b1"))
    d["mechanism_allocations"] = [{
        "id": "cost-comparison-1", "link": "relation", "owner": "b",
        "channel": "TRANSACTION_COST", "source": "b1",
        "comparability_source": "b1", "comparability_state": "COMPARABLE_DECLARED",
        "cooperation_scope_source": "b1", "outside_scope_source": "b1",
        "cooperation_resource_use_ids": ["joint-search"],
        "outside_resource_use_ids": ["outside-search"],
        "cooperation_cash_outflow_ids": ["coop-outlay"],
        "outside_cash_outflow_ids": ["t6"],
    }]
    relation = CooperationLink(
        key="relation", purpose="reduce search and negotiation costs",
        coordinator="op", participants=("a", "b", "op"), works=("w1",),
        mechanisms=("TRANSACTION_COST",), source_ref="model://relation",
        source_revision="r1",
    )
    original = evaluate_economic_claims(economic_fixture(), subject_state(), work_state())
    out = evaluate_economic_claims(d, subject_state(), work_state(), (relation,))
    result = out["cooperation_cost_channels"]["claimed_channels"][0]
    assert result["resource_cost_reduction_claim"] == "15.00"
    assert result["buyer_cash_outlay_reduction_claim"] == "15.00"
    assert result["combined_savings"] is None
    assert out["resource_costs_additive_to_cash"] is False
    assert out["profit"] == original["profit"] == "UNKNOWN"
    assert out["economic_value_added"] == "NOT_IDENTIFIABLE"
    assert out["consolidated_cash_difference_claimed_scope"] is None


def test_economic_cost_link_does_not_rewrite_existing_result():
    d = economic_fixture()
    d["mechanism_allocations"] = []
    works = work_state()
    result = evaluate_economic_claims(d, subject_state(), works)
    assert result["cooperation_cost_channels"]["claimed_channels"] == []
    assert works["w1"].result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert works["w2"].result == "REJECTED"


def test_declared_costs_need_real_existing_relation():
    d = economic_fixture()
    d["mechanism_allocations"] = [{
        "id": "x", "link": "missing", "owner": "b", "channel": "TRANSACTION_COST",
        "source": "b1", "comparability_source": "b1", "comparability_state": "UNKNOWN",
        "cooperation_scope_source": "b1", "outside_scope_source": "b1",
        "cooperation_resource_use_ids": [], "outside_resource_use_ids": [],
        "cooperation_cash_outflow_ids": [], "outside_cash_outflow_ids": [],
    }]
    with pytest.raises(EconomicInputError, match="COOPERATION_COST_UNKNOWN_LINK"):
        evaluate_economic_claims(d, subject_state(), work_state())


def requested_work(resource="ra", key="w2"):
    return {
        "id": key, "customer": "c", "resource": resource,
        "source_revision": "request-r2", "slot_start": 8, "slot_end": 12,
    }


def test_existing_relation_can_receive_new_demand_without_erasing_earlier_commitments():
    s = QualitativeAKIS(linked_world()); signed(s)
    assert s.snapshot()["cooperation"]["links"][0]["relation_state"] == "ORIGINAL_COMMITMENTS_ACTIVE"
    event = act(s,7,"request","c",work_spec=requested_work(),
                cooperation_link="network-1",cooperation_source_revision="nw-r1")
    assert event["outcome"] == "APPLIED"
    assert event["cooperation_relations"] == ["network-1"]
    assert [w.key for w in s.works.values()] == ["w1","w2"]
    assert s.cooperation_links[0].works == ("w1","w2")
    assert s.snapshot()["cooperation"]["links"][0]["relation_state"] == "FORMATION_NOT_FULLY_COMMITTED"
    assert s.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert s.works["w2"].obligation == "NOT_ACCEPTED"
    assert act(s,8,"offer","op",work="w2")["outcome"] == "APPLIED"
    assert act(s,9,"authorize","op",work="w2")["outcome"] == "APPLIED"
    assert act(s,10,"consent","a",work="w2",source_revision="request-r2",
               org_revision="oc-1")["outcome"] == "APPLIED"
    assert act(s,11,"commit","op",work="w2")["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"
    assert act(s,12,"consent","c",work="w2",source_revision="request-r2",
               org_revision="oc-1")["outcome"] == "APPLIED"
    assert act(s,13,"commit","op",work="w2")["outcome"] == "APPLIED"
    assert s.snapshot()["cooperation"]["links"][0]["relation_state"] == "ORIGINAL_COMMITMENTS_ACTIVE"
    assert s.works["w2"].result == "NOT_SUBMITTED"
    assert s.works["w1"].commitment_org_revision == s.works["w2"].commitment_org_revision == "oc-1"


def test_wrong_relation_revision_or_unconsented_new_principal_cannot_join():
    d = linked_world()
    d["subjects"].append({"id":"d", "kind":"SME"})
    d["resources"].append({"id":"rd", "owner":"d", "availability":"AVAILABLE",
                           "capacity_units":1, "capacity_unit":"team", "site":"site-d"})
    s=QualitativeAKIS(d); signed(s)
    old=s.snapshot()["cooperation"]
    assert act(s,7,"request","c",work_spec=requested_work(key="w3"),
               cooperation_link="network-1",
               cooperation_source_revision="outdated")["reason"] == "COOPERATION_SOURCE_REVISION_STALE"
    assert act(s,8,"request","c",work_spec=requested_work(resource="rd"),
               cooperation_link="network-1",
               cooperation_source_revision="nw-r1")["reason"] == "COOPERATION_NEW_ORIGINAL_PARTY_REQUIRES_REVIEW"
    assert act(s,9,"request","a",work_spec=requested_work(key="w4"),
               cooperation_link="network-1",
               cooperation_source_revision="nw-r1")["reason"] == "ORIGINAL_CUSTOMER_REQUEST_REQUIRED"
    assert set(s.works) == {"w1"}
    assert s.snapshot()["cooperation"] == old
    assert s.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"


def test_nine_component_causal_view_is_not_economic_proof_or_second_result():
    from research.akis.qualitative_mesa.cooperation import cooperation_system_view
    s=QualitativeAKIS(linked_world());signed(s)
    result=cooperation_system_view(s.cooperation_links,s.works,s.resources,s.subjects,
                                   s.institution,s.trace,context_basis=s.context_basis)
    assert result["component_ids"] == ["Ц","У","А","П","КПБ","ОК","КЖ","Э","ЖЦ"]
    assert result["not_a_second_core_or_scheduler"] is True
    assert result["original_results_only"] is True
    item=result["relations"][0]
    assert item["components"]["П"]["all_original_obligations_accepted"] is True
    assert item["components"]["Э"]["profit"] == "NOT_IDENTIFIABLE"
    assert item["components"]["ЖЦ"]["organizational_change"] == "NOT_AUTOMATIC"
    assert item["components"]["А"]["status"] == "AUTHOR_PROGRAM_AGENT_NOT_IMPLEMENTED"


def test_native_mesa_includes_same_nine_component_projection():
    pytest.importorskip("mesa", reason="Only official native Mesa qualifies")
    from research.akis.qualitative_mesa.mesa_model import simulate
    d=linked_world()
    d["events"]=[
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2,"action":"authorize","actor":"op","work":"w1"},
        *[{"at":at,"action":"consent","actor":owner,"work":"w1",
           "source_revision":"d1","org_revision":"oc-1"}
          for at,owner in ((3,"a"),(4,"b"),(5,"c"))],
        {"at":6,"action":"commit","actor":"op","work":"w1"},
        {"at":7,"action":"request","actor":"c","work_spec":requested_work(),
         "cooperation_link":"network-1","cooperation_source_revision":"nw-r1"},
    ]
    observed=simulate(d)
    assert observed["counts"] == {"applied":7,"blocked":0}
    assert observed["cooperation"]["system_projection"]["relations"][0]["original_works"] == ["w1","w2"]
    assert observed["cooperation"]["system_projection"]["relations"][0]["components"]["ЖЦ"]["current_relation_condition"] == "FORMATION_NOT_FULLY_COMMITTED"


def original_interest_event(willingness="DECLINES", outside="OUTSIDE_PREFERRED",
                            ref="model://independent-basis", **overrides):
    return {
        "action":"interest_update", "actor":"a", "work":"w1",
        "source_revision":"d1", "org_revision":"oc-1",
        "cooperation_link":"network-1", "cooperation_source_revision":"nw-r1",
        "economic_channel":"TRANSACTION_COST", "new_willingness":willingness,
        "new_outside_option":outside, "interest_evidence_ref":ref,
        **overrides,
    }


def test_owner_interest_moves_after_new_source_event_not_as_an_automatic_consent():
    from research.akis.qualitative_mesa.participant_response import assess_principal
    s = QualitativeAKIS(linked_world())
    assert act(s,1,"offer","op")["outcome"] == "APPLIED"
    assert act(s,2,"authorize","op")["outcome"] == "APPLIED"
    assert assess_principal(s,{}, "a","w1")["assessment"] == "INTEREST_UNKNOWN"
    event = {"at":3, **original_interest_event()}
    assert s.apply(event, 3)["outcome"] == "APPLIED"
    first = assess_principal(s,{}, "a","w1")
    assert first["assessment"] == "INDEPENDENT_DECLINE"
    assert first["interest_basis"] == "ORIGINAL_OWNER_MODEL_ONLY_EVENT_NOT_CONSENT"
    assert s.works["w1"].consents == {}
    event = {"at":4, **original_interest_event(
        willingness="WILLING", outside="COOPERATION_PREFERRED",
        ref="model://new-reason")}
    assert s.apply(event, 4)["outcome"] == "APPLIED"
    assert assess_principal(s,{}, "a","w1")["assessment"] == "REVIEWABLE_NOT_CONSENTED"
    assert s.works["w1"].consents == {}


def test_wrong_actor_stale_relation_or_foreign_channel_cannot_assert_interest():
    s = QualitativeAKIS(linked_world())
    assert act(s,1,"offer","op")["outcome"] == "APPLIED"
    assert act(s,2,"authorize","op")["outcome"] == "APPLIED"
    for at,fields,reason in [
        (3,{"actor":"op"},"NOT_AN_ORIGINAL_OBLIGATION_OWNER"),
        (4,{"cooperation_source_revision":"old"},"COOPERATION_SOURCE_REVISION_STALE"),
        (5,{"economic_channel":"PRIVATE_COMPANY_ERP"},"COOPERATION_INTEREST_CHANNEL_NOT_DECLARED"),
        (6,{"interest_evidence_ref":"https://unverified"},"COOPERATION_INTEREST_MODEL_SOURCE_REQUIRED"),
    ]:
        r=s.apply({"at":at,**original_interest_event(**fields)},at)
        assert r["outcome"] == "BLOCKED"
        assert r["reason"] == reason
    assert not [e for e in s.trace if e["action"]=="interest_update" and e["outcome"]=="APPLIED"]


def test_existing_work_obligation_cannot_be_revoked_by_interest_change():
    s = QualitativeAKIS(linked_world());signed(s)
    prior=s.works["w1"].obligation
    event=s.apply({"at":7,**original_interest_event()},7)
    assert event["reason"] == "INTEREST_UPDATE_CANNOT_REWRITE_ACCEPTED_OBLIGATION"
    assert s.works["w1"].obligation == prior
    assert s.works["w1"].consents.keys() == {"a","b","c"}


def test_strict_context_requires_owner_qualified_interest_source():
    d=linked_world()
    d["context_evidence"]={"strict":True, "sources":[], "requirements":[]}
    s=QualitativeAKIS(d)
    result=s.apply({"at":1, **original_interest_event()}, 1)
    assert result["reason"] == "CONTEXT_REQUIREMENT_MISSING"
    assert s.works["w1"].consents == {}


def test_native_mesa_interest_updates_generate_responses_only_on_model_time():
    pytest.importorskip("mesa",reason="Official native Mesa is required")
    from research.akis.qualitative_mesa.mesa_model import simulate
    d=linked_world()
    d["events"]=[
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2,"action":"authorize","actor":"op","work":"w1"},
        {"at":3,**original_interest_event()},
    ]
    output=simulate(d)
    assert output["counts"] == {"applied":3,"blocked":0}
    responses=[o for o in output["decision_observations"] if o["subject"]=="a"]
    assert responses
    assert responses[-1]["assessment"] == "INDEPENDENT_DECLINE"
    assert responses[-1]["effect"] == "NO_AUTOMATIC_CONSENT"
    assert output["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_native_mesa_keeps_original_cost_binding_without_authorizing_interfirm_changes():
    pytest.importorskip("mesa", reason="Official native Mesa is required")
    from research.akis.qualitative_mesa.mesa_model import simulate
    from research.akis.qualitative_mesa.tests.test_cooperation_economic_flow_integration import case

    d=linked_world()
    doc,_,_,_,_=case()
    for row in doc["resource_uses"]:
        row["work"]="w1"
    doc["mechanism_allocations"][0]["link"]="network-1"
    doc["coordination_event_bindings"][0].update(link="network-1",event_at=3)
    d["economic_claims"]=doc
    d["events"]=[
        {"at":1,"action":"offer","actor":"op","work":"w1"},
        {"at":2,"action":"authorize","actor":"op","work":"w1"},
        {"at":3,"action":"consent","actor":"c","work":"w1",
         "source_revision":"d1","org_revision":"oc-1"},
    ]
    output=simulate(d)
    assert output["counts"] == {"applied":3,"blocked":0}
    assert output["economics"]["resource_uses_count"]==2
    assert output["economics"]["cooperative_event_costs"]["linked_cost_rows"]==1
    assert output["economics"]["comparative_causal_effect"]=="NOT_IDENTIFIABLE"
    relation=output["cooperation"]["system_projection"]["relations"][0]
    evidence=relation["components"]["Э"]["original_event_cost_evidence"]
    assert evidence["linked_cost_rows"]==1
    assert evidence["cost_claims"]=="OWNER_SCOPED_NOT_REDISCLOSED"
    assert "12.00" not in str(relation)
    assert relation["components"]["ЖЦ"]["organizational_change"]=="NOT_AUTOMATIC"
    assert output["works"]["w1"]["result"]=="NOT_SUBMITTED"


def test_mesa_original_interest_and_resource_changes_revise_cooperative_model_readiness():
    """Native Mesa only: endogenous responses, never fabricated signatures."""
    pytest.importorskip("mesa", reason="Official Mesa 3.5.2 required for causal run")
    from research.akis.qualitative_mesa.mesa_model import simulate

    scenario = linked_world()
    scenario["decision_profiles"] = [
        {"subject": owner, "work": "w1", "source_revision": "d1",
         "org_revision": "oc-1", "willingness": "WILLING",
         "outside_option": "COOPERATION_PREFERRED"}
        for owner in ("a", "b", "c")
    ]
    def interest(at, outside):
        return {"at": at, "action": "interest_update", "actor": "c", "work": "w1",
                "source_revision": "d1", "org_revision": "oc-1",
                "cooperation_link": "network-1",
                "cooperation_source_revision": "nw-r1",
                "economic_channel": "TRANSACTION_COST",
                "new_willingness": "WILLING", "new_outside_option": outside,
                "interest_evidence_ref": "model://original-c-interest-%s" % at}
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        interest(3, "OUTSIDE_PREFERRED"),
        interest(4, "COOPERATION_PREFERRED"),
        {"at": 5, "action": "resource_status", "actor": "a",
         "resource": "ra", "availability": "UNAVAILABLE"},
        {"at": 6, "action": "resource_status", "actor": "a",
         "resource": "ra", "availability": "AVAILABLE"},
    ]
    result = simulate(scenario)
    assert result["counts"] == {"applied": 6, "blocked": 0}
    changes = result["cooperation"]["model_decision_evolution"]["changes"]
    at_statuses = {}
    for change in changes:
        if change["work"] == "w1":
            at_statuses[change["at"]] = change["readiness"]
    assert at_statuses[2.0] == "MODEL_READY_FOR_ORIGINAL_CONSENT_REVIEW"
    assert at_statuses[3.0] == "MODEL_INDEPENDENT_OPPOSITION"
    assert at_statuses[4.0] == "MODEL_READY_FOR_ORIGINAL_CONSENT_REVIEW"
    assert at_statuses[5.0] == "MODEL_BLOCKED_OR_UNCERTAIN"
    assert at_statuses[6.0] == "MODEL_READY_FOR_ORIGINAL_CONSENT_REVIEW"
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert result["works"]["w1"]["consenting_principals"] == []
    assert result["works"]["w1"]["result"] == "NOT_SUBMITTED"
    assert all("subject" not in item for item in changes)
    assert result["cooperation"]["model_decision_evolution"]["actual_agreements_or_results_created"] == 0
    assert result["cooperation"]["model_decision_evolution"]["no_additional_scheduler_or_ledger"] is True


def test_mesa_prior_original_commitment_is_not_reopened_by_modelled_readiness():
    pytest.importorskip("mesa", reason="Official Mesa required")
    from research.akis.qualitative_mesa.mesa_model import simulate
    scenario = linked_world()
    scenario["decision_profiles"] = [
        {"subject": owner, "work": "w1", "source_revision": "d1",
         "org_revision": "oc-1", "willingness": "WILLING",
         "outside_option": "COOPERATION_PREFERRED"}
        for owner in ("a", "b", "c")
    ]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        *[
            {"at": at, "action": "consent", "actor": owner, "work": "w1",
             "source_revision": "d1", "org_revision": "oc-1"}
            for at, owner in [(3, "a"), (4, "b"), (5, "c")]
        ],
        {"at": 6, "action": "commit", "actor": "op", "work": "w1"},
    ]
    result = simulate(scenario)
    changes = result["cooperation"]["model_decision_evolution"]["changes"]
    assert changes[-1]["readiness"] == "ORIGINAL_OBLIGATION_UNCHANGED"
    assert result["works"]["w1"]["obligation"] == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert result["works"]["w1"]["result"] == "NOT_SUBMITTED"
