"""R1-W1C: independently observed negative quality creates a new WIP decision.

Original MaterialBatch, Handoff, CapacityLedger, Work and accepted Result
history remain unchanged. A revised economic claim supersedes, not adds to,
the previous projection. No new physical shipment or capacity booking.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1w1b_original_operation_wip_mesa import ev, send, applied, terms
from .test_r1w1c_multibatch_mesa import (
    approved, custody, resume, multibatch_scenario,
    multibatch_baseline, multibatch_proposal,
)


def disputed():
    state = approved()
    assert custody(state, "mat-out-1", 21)["outcome"] == "APPLIED"
    different = custody(state, "mat-out-2", 24, acceptable=0)
    assert different["outcome"] == "APPLIED"
    assert different["quality_revision_required"] is True
    return state


def revision_proposal():
    p = multibatch_proposal()
    p.update({
        "at": 27, "wip_id": "wip-form-2",
        "wip_quality_revision_of": "wip-form-1",
        "wip_source_ref": "model://c/form-proposal-wip-form-2",
        "wip_terms": terms(total=5, produced=3, usable=1,
                           material="7000.00", handling="1500.00",
                           claim="5000.00", full="60000.00",
                           ref="REV-ACT-02"),
        "wip_batch_inspections": [
            {"batch": "mat-out-1", "total_units": 3,
             "produced_units": 2, "usable_units": 1,
             "inspection_ref": "model://b/w1c-inspection-1-v2"},
            {"batch": "mat-out-2", "total_units": 2,
             "produced_units": 1, "usable_units": 0,
             "inspection_ref": "model://b/w1c-inspection-2-v2"},
        ],
    })
    return p


def new_votes(state, digest, *, dissent=None):
    for at, subject in enumerate(("a", "b", "c", "d"), start=28):
        applied(state, at, "wip_review", subject,
                source_revision="d1", org_revision="oc-1",
                wip_operation="form", wip_id="wip-form-2",
                wip_fingerprint=digest,
                wip_position="OBJECT" if subject == dissent else "SUPPORT",
                wip_source_ref=f"model://{subject}/w1c-quality-revote-{at}")


def revise(state):
    p = revision_proposal()
    assert state.apply(p, 27)["outcome"] == "APPLIED"
    digest = state.works["w1"].wip_proposal["fingerprint"]
    new_votes(state, digest)
    return send(state, 32, "wip_apply", "c",
                source_revision="d1", org_revision="oc-1",
                wip_operation="form", wip_id="wip-form-2",
                wip_fingerprint=digest,
                wip_source_ref="model://c/w1c-quality-revision-apply")


def test_negative_qa_is_preserved_and_original_decision_cannot_be_replayed():
    state = disputed()
    old = state.works["w1"].wip_amendments[0]
    assert old["status"] == "APPLIED"
    negative = next(row for row in state.works["w1"].wip_lots
                    if row["material_batch"] == "mat-out-2")
    assert negative["custody_state"] == "QUALITY_REVIEW_REQUIRED"
    assert negative["observed_accepted_units"] == 0
    assert negative["custody_quality_ref"] == "model://d/w1c-quality-2"
    assert resume(state, 27)["reason"] == "WIP_ORIGINAL_PHYSICAL_CUSTODY_QUALITY_REQUIRED"
    retry = send(state, 28, "wip_handoff_quality", "d",
                 source_revision="d1", org_revision="oc-1",
                 wip_operation="form", wip_material_batch="mat-out-2",
                 wip_id="wip-form-1",
                 wip_receipt_ref="model://d/w1c-receipt-2",
                 wip_accepted_units=1,
                 wip_source_ref="model://d/later-optimistic-quality")
    assert retry["outcome"] == "BLOCKED"
    assert negative["observed_accepted_units"] == 0


def test_renegotiated_quality_is_one_new_edition_without_double_capacity():
    state = disputed()
    before = tuple(state.capacity_ledger.reservations)
    before_alloc = tuple(state.allocations)
    outcome = revise(state)
    assert outcome["outcome"] == "APPLIED", outcome
    assert outcome["wip_quality_revision_of"] == "wip-form-1"
    assert outcome["wip_existing_capacity_reused"] is True
    assert tuple(state.capacity_ledger.reservations) == before
    assert tuple(state.allocations) == before_alloc
    work = state.works["w1"]
    assert len(work.wip_amendments) == 2
    old, revised = work.wip_amendments
    assert old["status"] == "SUPERSEDED_BY_QUALITY_REVISION"
    assert old["superseded_by"] == "wip-form-2"
    assert revised["status"] == "APPLIED"
    assert revised["quality_revision_of"] == "wip-form-1"
    assert revised["lot"]["original_cost_claim"] == "60000.00"
    assert old["lot"]["future_resource_cost"] == "29000.00"
    assert revised["lot"]["future_resource_cost"] == "41000.00"
    old_lots = [x for x in work.wip_lots if x["amendment"] == "wip-form-1"]
    new_lots = [x for x in work.wip_lots if x["amendment"] == "wip-form-2"]
    assert len(old_lots) == len(new_lots) == 2
    assert all(x["status"] == "SUPERSEDED_BY_QUALITY_REVISION" for x in old_lots)
    assert all(x["status"] == "RESERVED" and
               x["holder"] == "d" and x["custody_state"] == "QUALITY_ACCEPTED"
               for x in new_lots)
    assert {x["material_batch"]: x["observed_accepted_units"] for x in new_lots} == {
        "mat-out-1": 1, "mat-out-2": 0,
    }
    assert len([r for r in before if r.work == "w1" and r.resource == "rd"]) == 1
    assert work.material_states["mat-out-1"].dispatched is None
    assert work.material_states["mat-out-2"].dispatched is None


def test_revised_quality_restores_the_same_original_operation_and_result():
    state = disputed()
    assert revise(state)["outcome"] == "APPLIED"
    assert resume(state, 33)["outcome"] == "APPLIED"
    work = state.works["w1"]
    assert work.operation_states["form"] == "IN_PROGRESS"
    assert all(row["status"] == "CONSUMED" for row in work.wip_lots
               if row["amendment"] == "wip-form-2")
    applied(state, 34, "complete_operation", "d", operation="form",
            result_ref="model://d/revised-form")
    quantities = [{"batch": "mat-out-1", "quantity": "3"},
                  {"batch": "mat-out-2", "quantity": "2"}]
    common = dict(from_operation="form", to_operation="finish",
                  source_revision="d1", org_revision="oc-1")
    applied(state, 35, "handoff_dispatch", "d", **common,
            material_quantities=quantities,
            result_ref="model://d/revised-dispatch")
    applied(state, 36, "handoff_receive", "a", **common,
            dispatch_ref="model://d/revised-dispatch",
            material_quantities=quantities,
            result_ref="model://a/revised-receipt")
    applied(state, 37, "handoff_quality", "a", **common,
            receipt_ref="model://a/revised-receipt",
            quality_quantities=[
                {"batch": "mat-out-1", "accepted": "3", "rejected": "0"},
                {"batch": "mat-out-2", "accepted": "2", "rejected": "0"},
            ], result_ref="model://a/revised-quality")
    applied(state, 38, "start_operation", "a", operation="finish")
    applied(state, 39, "complete_operation", "a", operation="finish",
            result_ref="model://a/revised-finish")
    applied(state, 40, "complete", "a",
            result_ref="model://a/revised-one-work-result")
    applied(state, 41, "accept", "c")
    assert work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert work.resource == "ra"
    assert len(state.works) == 2


@pytest.mark.parametrize("change,reason", [
    (lambda p: p.update({"wip_target_resource": "rb"}),
     "WIP_QUALITY_REVISION_MUST_KEEP_APPROVED_RESOURCE"),
    (lambda p: p.update({"wip_slot_end": 39}),
     "WIP_NEW_PLANNED_WINDOW_REQUIRED"),
    (lambda p: p.update({"wip_quality_revision_of": "forged"}),
     "WIP_QUALITY_REVISION_REQUIRES_LAST_ORIGINAL_TRANSFER"),
    (lambda p: p["wip_batch_inspections"][1].update({"usable_units": 1}),
     "WIP_QUALITY_REVISION_MUST_MATCH_RECORDED_RECEIPT"),
    (lambda p: p["wip_terms"].update({"inspection_ref": "model://b/ACT-01"}),
     "WIP_INSPECTION_SOURCE_ALREADY_CONSUMED"),
])
def test_quality_revision_cannot_forge_custody_money_or_capacity(change, reason):
    state = disputed()
    before = tuple(state.capacity_ledger.reservations)
    p = revision_proposal()
    change(p)
    attempt = state.apply(p, 27)
    assert attempt["reason"] == reason, attempt
    assert tuple(state.capacity_ledger.reservations) == before
    assert state.works["w1"].wip_proposal is None


def test_quality_revision_requires_all_owner_votes_and_new_fingerprint():
    state = disputed()
    p = revision_proposal()
    applied(state, 27, "wip_propose", "c",
            **{k: v for k, v in p.items()
               if k not in {"at", "action", "actor", "work"}})
    digest = state.works["w1"].wip_proposal["fingerprint"]
    for at, subject in enumerate(("a", "b", "c"), start=28):
        applied(state, at, "wip_review", subject, source_revision="d1",
                org_revision="oc-1", wip_operation="form",
                wip_id="wip-form-2", wip_fingerprint=digest,
                wip_position="SUPPORT",
                wip_source_ref=f"model://{subject}/w1c-partial-revote-{at}")
    reservations = tuple(state.capacity_ledger.reservations)
    attempt = send(state, 31, "wip_apply", "c",
                   source_revision="d1", org_revision="oc-1",
                   wip_operation="form", wip_id="wip-form-2",
                   wip_fingerprint=digest,
                   wip_source_ref="model://c/w1c-quality-revision-apply")
    assert attempt["reason"] == "WIP_INDEPENDENT_SUPPORT_MISSING"
    assert tuple(state.capacity_ledger.reservations) == reservations
    assert state.works["w1"].wip_amendments[0]["status"] == "APPLIED"


def test_native_mesa_scheduler_runs_revised_quality_without_extra_work():
    d = multibatch_scenario()
    direct = approved()
    # Construct a deterministic original event stream and actual fingerprint
    # for the revised documentary edition after observed independent QA.
    initial = multibatch_proposal()
    initial_state = approved()
    fingerprint_initial = initial_state.works["w1"].wip_amendments[0]["fingerprint"]
    initial_votes = [
        ev(at, "wip_review", actor,
           source_revision="d1", org_revision="oc-1",
           wip_operation="form", wip_id="wip-form-1",
           wip_fingerprint=fingerprint_initial, wip_position="SUPPORT",
           wip_source_ref=f"model://{actor}/wip-review-{at}")
        for at, actor in enumerate(("a", "b", "c", "d"), start=16)
    ]
    initial_apply = ev(
        20, "wip_apply", "c", source_revision="d1", org_revision="oc-1",
        wip_operation="form", wip_id="wip-form-1",
        wip_fingerprint=fingerprint_initial,
        wip_source_ref="model://c/form-apply",
    )
    custody_events = []
    for suffix, start, count in (("1", 21, 1), ("2", 24, 0)):
        key = f"mat-out-{suffix}"
        common = dict(source_revision="d1", org_revision="oc-1",
                      wip_operation="form", wip_material_batch=key,
                      wip_id="wip-form-1")
        custody_events.extend([
            ev(start, "wip_handoff_dispatch", "b", **common,
               wip_source_ref=f"model://b/w1c-dispatch-{suffix}"),
            ev(start+1, "wip_handoff_receive", "d", **common,
               wip_dispatch_ref=f"model://b/w1c-dispatch-{suffix}",
               wip_source_ref=f"model://d/w1c-receipt-{suffix}"),
            ev(start+2, "wip_handoff_quality", "d", **common,
               wip_receipt_ref=f"model://d/w1c-receipt-{suffix}",
               wip_accepted_units=count,
               wip_source_ref=f"model://d/w1c-quality-{suffix}"),
        ])
    for event in custody_events:
        assert direct.apply(event, event["at"])["outcome"] == "APPLIED"
    revised = revision_proposal()
    applied(direct, 27, "wip_propose", "c",
            **{k: v for k, v in revised.items()
               if k not in {"at", "action", "actor", "work"}})
    digest = direct.works["w1"].wip_proposal["fingerprint"]
    votes = [
        ev(at, "wip_review", actor, source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_id="wip-form-2", wip_fingerprint=digest,
           wip_position="SUPPORT",
           wip_source_ref=f"model://{actor}/w1c-quality-revote-{at}")
        for at, actor in enumerate(("a", "b", "c", "d"), start=28)
    ]
    finish = [
        ev(32, "wip_apply", "c", source_revision="d1", org_revision="oc-1",
           wip_operation="form", wip_id="wip-form-2",
           wip_fingerprint=digest,
           wip_source_ref="model://c/w1c-quality-revision-apply"),
        ev(33, "wip_resume", "d", source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_source_ref="model://d/w1c-resume"),
    ]
    d["events"] = (
        multibatch_baseline() + [initial] + initial_votes +
        [initial_apply] + custody_events + [revised] + votes + finish
    )
    d["model_horizon"] = 36
    result = simulate(d)
    assert not [row for row in result["trace"] if row["outcome"] == "BLOCKED"]
    assert len(result["works"]["w1"]["unfinished_production"]["applied_amendments"]) == 2
    assert result["works"]["w1"]["technology"]["operations"][1]["execution"] == "IN_PROGRESS"
    assert simulate(deepcopy(d)) == result
