"""Source-declared production calendars; no empirical claims or fake Mesa PASS."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from random import Random
import json

import pytest

from research.akis.qualitative_mesa.capacity import (
    CapacityLedger, CapacityBlocked, CapacityInputError, ResourceNeed,
    parse_resource_capacity, parse_resource_calendar,
)
from research.akis.qualitative_mesa.rules import QualitativeAKIS, InputError
from research.akis.qualitative_mesa.portfolio import review_cues
from research.akis.qualitative_mesa.participant_response import (
    DecisionProfile, assess_principal,
)

ROOT = Path(__file__).resolve().parents[1]


def calendar(revision="r1", windows=None, source="model://a-calendar"):
    return {
        "revision": revision, "source": source,
        "windows": windows if windows is not None else [
            {"start": 0, "end": 10, "units": 2},
            {"start": 10, "end": 12, "units": 0},
            {"start": 12, "end": 30, "units": 1},
        ],
    }


def resource(identifier="ra", *, cap=2, cal=None):
    result = {"id": identifier, "owner": "a", "availability": "AVAILABLE",
              "capacity_units": cap, "capacity_unit": "machines", "site": "a-site"}
    if cal is not None:
        result["calendar"] = cal
    return result


def scenario():
    return json.loads((ROOT / "fixtures/owner_calendar_revision_model_only.json").read_text())


def apply(state, action, at, actor, **kw):
    return state.apply({"action": action, "actor": actor, **kw}, at)


def test_calendar_half_open_boundaries_and_research_source_are_explicit():
    cap = parse_resource_capacity(resource(cal=calendar()))
    assert cap.calendar is not None
    assert [cap.calendar.available_at(t) for t in (-1, 0, 9, 10, 11, 12, 29, 30)] == [0, 2, 2, 0, 0, 1, 1, 0]
    assert cap.owner == "a" and cap.site == "a-site"
    assert cap.basis == "MODEL_DECLARED"


@pytest.mark.parametrize("bad,reason", [
    ({}, "INVALID_RESOURCE_CALENDAR_FIELDS"),
    ({"revision": "r1", "source": "model://x", "windows": []}, "INVALID_CALENDAR_WINDOW_COUNT"),
    ({"revision": "r1", "source": "model://x", "windows": None}, "INVALID_CALENDAR_WINDOW_COUNT"),
    (calendar(windows=[{"start": 1, "end": 1, "units": 1}]), "INVALID_CALENDAR_WINDOW_TIME"),
    (calendar(windows=[{"start": False, "end": 1, "units": 1}]), "INVALID_CALENDAR_WINDOW_TIME"),
    (calendar(windows=[{"start": 0, "end": 2, "units": 3}]), "CALENDAR_EXCEEDS_RESOURCE_CAPACITY"),
    (calendar(windows=[{"start": 0, "end": 1, "units": True}]), "INVALID_CALENDAR_WINDOW_UNITS"),
    (calendar(windows=[{"start": 0, "end": 3, "units": 1}, {"start": 2, "end": 4, "units": 1}]), "CALENDAR_WINDOWS_OVERLAP_OR_UNSORTED"),
    (calendar(windows=[{"start": 4, "end": 6, "units": 1}, {"start": 0, "end": 3, "units": 1}]), "CALENDAR_WINDOWS_OVERLAP_OR_UNSORTED"),
    (calendar(source="https://user.example.com/data"), "CALENDAR_SOURCE_MUST_BE_MODEL_ONLY"),
    (calendar(windows=[{"start": 0, "end": 3, "units": 1, "extra": "x"}]), "INVALID_CALENDAR_WINDOW_FIELDS"),
])
def test_reject_ambiguous_calendar_declarations(bad, reason):
    with pytest.raises(CapacityInputError, match=reason):
        parse_resource_calendar(bad, 2)


def test_calendar_requires_explicit_units_to_avoid_blessing_legacy_capacity():
    with pytest.raises(CapacityInputError, match="CALENDAR_REQUIRES_EXPLICIT_CAPACITY"):
        parse_resource_capacity({"id": "r", "owner": "a", "calendar": calendar()})


def test_closed_time_blocks_new_commit_and_other_resources_are_not_reserved():
    specs = {"ra": parse_resource_capacity(resource("ra", cal=calendar())),
             "rb": parse_resource_capacity(resource("rb", cal=calendar(windows=[{"start": 0, "end": 8, "units": 2}]))) }
    ledger = CapacityLedger(specs)
    before = deepcopy(ledger.snapshot())
    with pytest.raises(CapacityBlocked, match="RESOURCE_CALENDAR_CAPACITY_EXCEEDED") as exc:
        ledger.reserve("w1", [ResourceNeed("ra", 1), ResourceNeed("rb", 1)], 7, 9)
    assert exc.value.resource == "rb"
    assert ledger.snapshot() == before


def test_calendar_capacity_can_vary_without_optimizing_or_inventing_productivity():
    ledger = CapacityLedger({"ra": parse_resource_capacity(resource(cal=calendar()))})
    ledger.reserve("w1", [ResourceNeed("ra", 1)], 0, 10)
    ledger.reserve("w2", [ResourceNeed("ra", 1)], 0, 10)
    with pytest.raises(CapacityBlocked, match="RESOURCE_CALENDAR_CAPACITY_EXCEEDED"):
        ledger.reserve("w3", [ResourceNeed("ra", 1)], 0, 10)
    with pytest.raises(CapacityBlocked):
        ledger.reserve("w4", [ResourceNeed("ra", 1)], 9, 13)
    ledger.reserve("w5", [ResourceNeed("ra", 1)], 12, 20)
    view = ledger.snapshot()
    assert view["economic_productivity"] == "NOT_IDENTIFIABLE"
    assert view["planned_slot_axis"] == "SEPARATE_FROM_EVENT_DECISION_CLOCK"
    assert view["resources"]["ra"]["calendar"]["source_authenticity"] == "DECLARED_UNVERIFIED"


def test_unrelated_new_commit_not_blocked_by_old_calendar_risk_elsewhere():
    ledger = CapacityLedger({"ra": parse_resource_capacity(resource(cal=calendar(
        windows=[{"start": 0, "end": 20, "units": 2}])))})
    ledger.reserve("old", [ResourceNeed("ra", 2)], 3, 6)
    ledger.update_calendar("ra", parse_resource_calendar(calendar(
        revision="r2", windows=[{"start": 0, "end": 7, "units": 1},
                                {"start": 7, "end": 20, "units": 2}]), 2))
    assert ledger.reservation_risks()[0]["works"] == ["old"]
    ledger.reserve("future", [ResourceNeed("ra", 1)], 8, 10)
    assert {r.work for r in ledger.reservations} == {"old", "future"}


def test_owner_calendar_declaration_preserves_old_reservation_as_risk():
    ledger = CapacityLedger({"ra": parse_resource_capacity(resource(cal=calendar()))})
    ledger.reserve("w1", [ResourceNeed("ra", 1)], 0, 8)
    old = deepcopy(ledger.reservations)
    risks = ledger.update_calendar("ra", parse_resource_calendar(calendar(
        revision="r2", windows=[{"start": 0, "end": 4, "units": 1},
                                {"start": 4, "end": 8, "units": 0}]), 2))
    assert ledger.reservations == old
    assert ledger.is_work_at_risk("w1") == "ra"
    assert risks[0]["start"] == 4 and risks[0]["available_units"] == 0
    assert ledger.snapshot()["reservation_risks"] == risks


def test_property_small_calendar_vs_independent_slot_oracle():
    """Deterministic logical stress test, not a company case or a statistical model."""
    rng = Random(6151)
    for _ in range(75):
        ceiling = rng.randrange(1, 5)
        windows = [{"start": i, "end": i+1, "units": rng.randrange(0, ceiling+1)}
                   for i in range(20)]
        ledger = CapacityLedger({"ra": parse_resource_capacity(resource(
            cap=ceiling, cal=calendar(windows=windows)))})
        accepted: list[tuple[int, int, int]] = []
        for index in range(15):
            a = rng.randrange(0, 20)
            b = rng.randrange(a+1, 21)
            units = rng.randrange(1, ceiling+1)
            expected = all(units + sum(q for x,y,q in accepted if x <= t < y)
                           <= windows[t]["units"] for t in range(a,b))
            before = ledger.snapshot()
            try:
                ledger.reserve(f"w{index}", [ResourceNeed("ra",units)], a,b)
            except CapacityBlocked:
                assert not expected
                assert ledger.snapshot() == before
            else:
                assert expected
                accepted.append((a,b,units))


def test_strict_calendar_missing_is_not_source_confirmed_capacity():
    base = scenario()
    del base["resources"][1]["calendar"]
    s = QualitativeAKIS(base)
    for event in base["events"][:5]:
        assert s.apply(event,event["at"])["outcome"] == "APPLIED"
    blocked = s.apply(base["events"][5],6)
    assert blocked["reason"] == "RESOURCE_CALENDAR_UNSUPPORTED"
    assert blocked["blocking_resource"] == "workers_b"
    assert not s.capacity_ledger.reservations


def test_calendar_strict_must_be_bool():
    base = scenario()
    base["calendar_strict"] = "yes"
    with pytest.raises(InputError, match="CALENDAR_STRICT_MUST_BE_BOOLEAN"):
        QualitativeAKIS(base)


def test_owner_updates_produce_risk_and_do_not_cancel_original_obligation():
    base = scenario()
    state = QualitativeAKIS(base)
    for e in base["events"][:8]:
        outcome = state.apply(e, e["at"])
    assert outcome["reason"] == "RESOURCE_CALENDAR_CHANGED_AFTER_COMMIT"
    assert state.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    update = state.trace[6]
    assert update["outcome"] == "APPLIED"
    assert update["calendar_revision"] == "cal-b-2"
    assert update["calendar_source"] == "model://owner-b-declared-break"
    assert update["reservation_risks"][0]["works"] == ["w1"]
    assert any(c["signal"] == "CAPACITY_CALENDAR_REVISED" for c in review_cues(state.trace))
    assert state.capacity_ledger.is_work_at_risk("w1") == "workers_b"


def test_wrong_owner_stale_revision_and_reuse_cannot_update_calendar():
    base = scenario()
    state=QualitativeAKIS(base)
    for e in base["events"][:11]:
        state.apply(e,e["at"])
    assert [e["reason"] for e in state.trace if e["outcome"] == "BLOCKED"] == [
        "RESOURCE_CALENDAR_CHANGED_AFTER_COMMIT",
        "RESOURCE_OWNER_REQUIRED", "STALE_RESOURCE_CALENDAR_REVISION"]
    assert state.resource_specs["workers_b"].calendar.revision == "cal-b-3"
    old = deepcopy(state.capacity_ledger.snapshot())
    reuse=apply(state,"resource_calendar_update",25,"b",resource="workers_b",
        expected_calendar_revision="cal-b-3",calendar=calendar("cal-b-2",[
            {"start": 0, "end": 30, "units": 1}],source="model://reused"))
    assert reuse["reason"] == "RESOURCE_CALENDAR_REVISION_REUSED"
    assert state.capacity_ledger.snapshot() == old


def test_main_calendar_scenario_allows_renewed_independent_work_and_no_profits():
    base = scenario()
    state = QualitativeAKIS(base)
    for event in base["events"]:
        state.apply(event, event["at"])
    result = state.snapshot()
    assert result["counts"] == {"applied":21, "blocked":3}
    assert [(e["at"], e["reason"]) for e in result["trace"] if e["outcome"]=="BLOCKED"] == [
        (8, "RESOURCE_CALENDAR_CHANGED_AFTER_COMMIT"),
        (9, "RESOURCE_OWNER_REQUIRED"),
        (10, "STALE_RESOURCE_CALENDAR_REVISION")]
    assert all(result["works"][key]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for key in ("w1","w2"))
    assert len(result["capacity"]["reservations"]) == 4
    assert result["capacity"]["reservation_risks"] == []
    assert result["institution"]["mode"] == "SOLE"
    assert result["profit"]["operator"] == "UNKNOWN"
    assert result["portfolio"]["institutional_change"] == "NO_AUTOMATIC_CHANGE"


def test_nonbinding_principal_reacts_to_declared_calendar_shortfall():
    base=scenario()
    state=QualitativeAKIS(base)
    apply(state,"offer",1,"op",work="w1")
    apply(state,"authorize",2,"op",work="w1")
    prof = DecisionProfile("a","w1","d-1","oc-1","WILLING","COOPERATION_PREFERRED")
    profiles={('a','w1'):prof}
    assert assess_principal(state,profiles,'a','w1')['assessment']=='REVIEWABLE_NOT_CONSENTED'
    event=base["events"][6]
    state.apply(event,7)
    assert assess_principal(state,profiles,'a','w1')['assessment']=='RESOURCE_CALENDAR_CAPACITY_EXCEEDED'
    assert state.works['w1'].consents == {}


def test_actual_mesa_scheduler_has_only_one_event_queue_and_no_automatic_consent():
    mesa = pytest.importorskip("mesa",reason="Official Mesa 3.5.2 required")
    from research.akis.qualitative_mesa.mesa_model import simulate
    case=scenario()
    case["decision_profiles"]=[{"subject":"a","work":"w1","source_revision":"d-1",
          "org_revision":"oc-1","willingness":"WILLING","outside_option":"COOPERATION_PREFERRED"}]
    output=simulate(case)
    assert output["counts"]=={"applied":21,"blocked":3}
    assert output["capacity"]["reservation_risks"] == []
    assert any(o["trigger"] == "resource_calendar_update" for o in output["decision_observations"])
    assert {i["signal"] for i in output["adaptation"]["event_inquiries"]} == {
        c["signal"] for c in output["portfolio"]["review_cues"]}
    assert all(i["decision"] == "INQUIRY_ONLY_NOT_PROPOSAL"
               for i in output["adaptation"]["event_inquiries"])
    assert output["profit"]["operator"] == "UNKNOWN"


def test_completed_original_result_not_retroactively_revoked_by_later_calendar():
    base=scenario()
    state=QualitativeAKIS(base)
    for event in base['events']:
        state.apply(event,event['at'])
    old_history=deepcopy(state.works['w1'].result_history)
    updated=apply(state,'resource_calendar_update',25,'b',resource='workers_b',
        expected_calendar_revision='cal-b-3',calendar=calendar('cal-b-4',[
            {'start':0,'end':8,'units':1},
            {'start':8,'end':11,'units':0},
            {'start':11,'end':30,'units':1}],source='model://late-owner-report'))
    assert updated['outcome']=='APPLIED'
    assert updated['reservation_risks']==[]  # both original results already accepted
    assert state.works['w1'].obligation=='FULFILLED'
    assert state.works['w1'].result_history==old_history
    assert state.snapshot()['capacity']['reservation_risks']==[]


def test_calendar_update_cannot_legitimize_implicit_legacy_capacity():
    base=scenario()
    del base['resources'][1]['capacity_units']
    del base['resources'][1]['capacity_unit']
    del base['resources'][1]['calendar']
    state=QualitativeAKIS(base)
    event=apply(state,'resource_calendar_update',1,'b',resource='workers_b',
        expected_calendar_revision='NONE', calendar=calendar('cal-b-1',[
            {'start':0,'end':30,'units':1}],source='model://implicit-capacity'))
    assert event['reason']=='RESOURCE_CAPACITY_UNSUPPORTED'
    assert not state.capacity_ledger.specs['workers_b'].calendar


def test_calendar_update_invalid_payload_does_not_corrupt_accepted_ledger():
    base=scenario()
    state=QualitativeAKIS(base)
    for event in base['events'][:6]:
        state.apply(event,event['at'])
    previous=deepcopy(state.capacity_ledger.snapshot())
    invalid=apply(state,'resource_calendar_update',7,'b',resource='workers_b',
        expected_calendar_revision='cal-b-1',calendar={'revision':'bad','source':'http://not-model',
            'windows':[{'start':0,'end':30,'units':1}]})
    assert invalid['reason']=='CALENDAR_SOURCE_MUST_BE_MODEL_ONLY'
    assert state.capacity_ledger.snapshot()==previous


def test_malformed_unknown_resource_calendar_event_is_denied_not_crashed():
    state=QualitativeAKIS(scenario())
    result=apply(state,'resource_calendar_update',1,'a',resource=['unhashable'],
        expected_calendar_revision='NONE',calendar=calendar())
    assert result['reason']=='UNKNOWN_RESOURCE'
