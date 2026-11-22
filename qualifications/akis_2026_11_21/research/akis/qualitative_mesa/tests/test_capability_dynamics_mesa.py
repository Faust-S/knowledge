"""M4: original owner adopted future ability changes a later Work's feasibility.

All evidence and claimed capacities are MODEL_ONLY. This is neither actual
productivity, a legal IP licence, a payment nor an autonomous Mesa action.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_competence_measurement_mesa import measurement_case


def capability_case(*, with_adoption=True, with_commit=True, with_finish=True):
    d = measurement_case()
    d["works"].append({
        "id": "w3", "customer": "c", "resource": "rb",
        "source_revision": "d3", "slot_start": 12, "slot_end": 16,
        "requires_accepted": ["w2"],
        "resource_requirements": [{"resource": "rb", "units": 2}],
    })
    d["context_evidence"]["sources"] += [
        {"id": "b-capacity", "owner": "b", "revision": "bc1",
         "status": "CONFIRMED", "usable_by": ["b"],
         "core": "corporate", "purposes": ["capability-adoption"],
         "operations": ["DERIVE"], "valid_from": 0, "valid_until": 60},
        {"id": "a-follow-on", "owner": "a", "revision": "af1",
         "status": "CONFIRMED", "usable_by": ["a", "b"],
         "core": "corporate", "purposes": ["follow-on-capability"],
         "operations": ["SHARE"], "valid_from": 0, "valid_until": 60},
    ]
    d["capability_adoptions"] = [{
        "id": "capacity-b-1", "resource": "rb", "owner": "b",
        "reuse_claim": "reuse-1", "source_id": "b-capacity",
        "source_revision": "bc1", "source_ref": "model://b/prospective-capacity",
        "declared_units": 2, "initial_units": 1, "resource_unit": "team",
        "from_slot": 12, "to_slot": 16,
        "authorized_future_works": ["w3"],
        "future_use_source_id": "a-follow-on",
        "future_use_source_revision": "af1",
    }]
    d["events"] += [
        {"at": 24, "action": "offer", "actor": "op", "work": "w3"},
        {"at": 25, "action": "authorize", "actor": "op", "work": "w3"},
        {"at": 26, "action": "consent", "actor": "b", "work": "w3",
         "source_revision": "d3", "org_revision": "oc-1"},
        {"at": 27, "action": "consent", "actor": "c", "work": "w3",
         "source_revision": "d3", "org_revision": "oc-1"},
        {"at": 28, "action": "commit", "actor": "op", "work": "w3"},
    ]
    if with_adoption:
        d["events"].append({
            "at": 29, "action": "adopt_capability", "actor": "b",
            "resource": "rb", "capability": "capacity-b-1",
            "source_revision": "bc1", "org_revision": "oc-1",
            "expected_capacity_revision": "BASE",
        })
    if with_commit:
        d["events"].append({
            "at": 30, "action": "commit", "actor": "op", "work": "w3"
        })
    if with_finish:
        d["events"] += [
            {"at": 31, "action": "start", "actor": "b", "work": "w3"},
            {"at": 32, "action": "complete", "actor": "b", "work": "w3",
             "result_ref": "model://w3-result"},
            {"at": 33, "action": "accept", "actor": "c", "work": "w3"},
        ]
    return d


def test_owner_capability_event_changes_next_original_work_without_auto_productivity():
    d = capability_case()
    result = simulate(d)
    events = {(e["action"],e["at"]): e for e in result["trace"]}
    assert events[("commit",28)]["reason"] == "RESOURCE_CAPACITY_EXCEEDED"
    assert events[("adopt_capability",29)]["outcome"] == "APPLIED"
    assert events[("commit",30)]["outcome"] == "APPLIED"
    assert events[("start",31)]["outcome"] == "APPLIED"
    assert events[("accept",33)]["outcome"] == "APPLIED"
    assert result["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    cap = result["capability_dynamics"]
    assert cap["original_owner_adopted_count"] == 1
    assert cap["declarations"][0]["available_for_new_original_work"] is True
    assert cap["declarations"][0]["actual_resource_capacity_or_causal_learning_verified"] is False
    assert len(cap["read_only_evolution"]) >= 2
    assert result["capacity"]["resources"]["rb"]["capacity_units"] == 1
    assert result["capacity"]["resources"]["rb"]["future_owner_capability_projections"][0]["declared_capacity_units"] == 2
    assert result["capacity"]["resources"]["rb"]["future_owner_capability_projections"][0]["original_works_authorized_for_future_use"] == ["w3"]
    assert result["general_akis_model"]["capability_reproduction_feedback"]["model_owner_adopted_count"] == 1
    assert result["economics"]["profit"] == "UNKNOWN"
    assert result["work_counterfactual_dynamics"]["causal_transaction_savings"] == "NOT_IDENTIFIABLE"
    assert simulate(deepcopy(d)) == result


def test_no_owner_event_no_increased_capacity_or_automatic_commit():
    d = capability_case(with_adoption=False, with_commit=False, with_finish=False)
    out = simulate(d)
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert out["capability_dynamics"]["original_owner_adopted_count"] == 0
    assert out["capacity"]["resources"]["rb"]["capacity_units"] == 1
    assert out["trace"][-1]["reason"] == "RESOURCE_CAPACITY_EXCEEDED"
    assert all(e["action"] != "adopt_capability" for e in out["trace"])


@pytest.mark.parametrize("modifier,reason", [
    (lambda d: d["events"][ -5 if False else -5 ].update(actor="a"),
     "CAPABILITY_ORIGINAL_RESOURCE_OWNER_REQUIRED"),
    (lambda d: d["events"][-5].update(org_revision="oc-old"),
     "CAPABILITY_ORIGINAL_ORG_REVISION_REQUIRED"),
    (lambda d: d["events"][-5].update(expected_capacity_revision="UNKNOWN"),
     "CAPABILITY_STALE_EXPECTED_REVISION"),
    (lambda d: d["context_evidence"]["sources"][-2].update(status="UNKNOWN"),
     "CAPABILITY_SOURCE_NOT_USABLE"),
    (lambda d: d["context_evidence"]["sources"][-1].update(status="UNKNOWN"),
     "CAPABILITY_FOLLOW_ON_OWNER_SOURCE_NOT_SHARED"),
    (lambda d: d["context_evidence"]["sources"][-1].update(operations=["READ"]),
     "CAPABILITY_FOLLOW_ON_SOURCE_SCOPE_UNQUALIFIED"),
    (lambda d: d["competence_measurement_protocols"][0].update(uncertainty_after="2.5000"),
     "CAPABILITY_MEASUREMENT_NOT_SEPARATED_FROM_UNCERTAINTY"),
    (lambda d: d["competence_reuse_permissions"][0].update(work="w1"),
     "CAPABILITY_REUSE_SEQUENCE_UNQUALIFIED"),
])
def test_owner_permission_source_measurement_all_precede_capacity_use(modifier, reason):
    d=capability_case()
    modifier(d)
    out=simulate(d)
    event=next(e for e in out["trace"] if e["action"]=="adopt_capability")
    assert event["outcome"]=="BLOCKED"
    assert event["reason"]==reason
    assert out["works"]["w3"]["obligation"]=="NOT_ACCEPTED"
    assert out["capability_dynamics"]["original_owner_adopted_count"]==0
    assert not out["capacity"]["resources"]["rb"].get("future_owner_capability_projections")


def test_revoking_original_holder_follow_on_rights_preserves_commitment_but_blocks_start():
    d=capability_case(with_finish=False)
    d["events"] += [
        {"at":31,"action":"source_update","actor":"a","source":"a-follow-on",
         "status":"UNKNOWN","new_revision":"af2","usable_by":["a"]},
        {"at":32,"action":"start","actor":"b","work":"w3"},
    ]
    out=simulate(d)
    assert out["works"]["w3"]["obligation"]=="ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert out["works"]["w3"]["execution"]=="NOT_STARTED"
    assert out["trace"][-1]["reason"]=="RESOURCE_CALENDAR_CHANGED_AFTER_COMMIT"
    assert out["capability_dynamics"]["declarations"][0]["available_for_new_original_work"] is False
    assert out["capacity"]["resources"]["rb"]["future_owner_capability_projections"][0]["source_currently_usable"] is False
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_future_work_not_in_owner_authorized_scope_cannot_piggyback_on_increased_capacity():
    d=capability_case(with_commit=False,with_finish=False)
    d["works"].append({
        "id":"w4","customer":"c","resource":"rb",
        "source_revision":"d4","slot_start":12,"slot_end":16,
        "requires_accepted":["w2"],
        "resource_requirements":[{"resource":"rb","units":2}],
    })
    d["events"] += [
        {"at":30,"action":"offer","actor":"op","work":"w4"},
        {"at":31,"action":"authorize","actor":"op","work":"w4"},
        {"at":32,"action":"consent","actor":"b","work":"w4",
         "source_revision":"d4","org_revision":"oc-1"},
        {"at":33,"action":"consent","actor":"c","work":"w4",
         "source_revision":"d4","org_revision":"oc-1"},
        {"at":34,"action":"commit","actor":"op","work":"w4"},
    ]
    out=simulate(d)
    assert out["trace"][-1]["reason"]=="CAPABILITY_FUTURE_WORK_NOT_OWNER_AUTHORIZED"
    assert out["works"]["w4"]["obligation"]=="NOT_ACCEPTED"
    assert out["capability_dynamics"]["original_owner_adopted_count"]==1


@pytest.mark.parametrize("modifier", [
    lambda d: d["capability_adoptions"][0].update(initial_units=2),
    lambda d: d["capability_adoptions"][0].update(resource_unit="hours"),
    lambda d: d["capability_adoptions"][0].update(future_use_source_id=None),
    lambda d: d["capability_adoptions"][0].update(authorized_future_works=[]),
    lambda d: d["capability_adoptions"][0].update(from_slot=True),
    lambda d: d["capability_adoptions"][0].update(declared_units=1),
])
def test_malformed_or_unsupported_owner_capability_declaration_is_refused(modifier):
    d=capability_case()
    modifier(d)
    with pytest.raises(ValueError,match="CAPABILITY"):
        simulate(d)


def test_capability_declaration_cannot_rewrite_any_prior_reserved_interval():
    d=capability_case()
    d["capability_adoptions"][0]["from_slot"]=11  # overlaps original w2 reservation
    out=simulate(d)
    event=next(e for e in out["trace"] if e["action"]=="adopt_capability")
    assert event["reason"]=="CAPABILITY_CANNOT_RETROACTIVELY_CHANGE_RESERVED_WORK"
    assert out["works"]["w3"]["obligation"]=="NOT_ACCEPTED"
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_existing_m3_3_is_unchanged_when_capability_input_absent():
    d=capability_case()
    del d["capability_adoptions"]
    d["events"]=[e for e in d["events"] if e["action"]!="adopt_capability"]
    out=simulate(d)
    assert "capability_dynamics" not in out
    assert out["works"]["w3"]["obligation"]=="NOT_ACCEPTED"
    assert out["works"]["w2"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT"
