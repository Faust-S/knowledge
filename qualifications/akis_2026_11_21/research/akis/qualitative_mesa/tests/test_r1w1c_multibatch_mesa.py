"""R1-W1C: one original Work with several independently inspected material batches.

The native MaterialBatch, Handoff, Work and CapacityLedger remain authoritative.
The economic total belongs to one original Work amendment, not each batch.
"""
from copy import deepcopy
import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1w1b_original_operation_wip_mesa import (
    scenario, baseline, proposal, ev, send, applied, independent_votes,
    strict_scenario,
)


BATCHES = ("mat-out-1", "mat-out-2")


def multibatch_scenario(*, strict=False):
    d = strict_scenario() if strict else scenario()
    batches = []
    for suffix, count in (("1", "3"), ("2", "2")):
        batches.extend([
            {
                "id": f"mat-in-{suffix}",
                "from_operation": "source", "to_operation": "form",
                "material_id": "steel", "planned_quantity": count,
                "unit": "unit", "declared_title_holder": "a",
                "origin_source_owner": "a",
                "origin_ref": f"model://a/mat-in-{suffix}-origin",
                "quality_spec_owner": "c",
                "quality_spec_ref": f"model://c/mat-in-{suffix}-quality",
            },
            {
                "id": f"mat-out-{suffix}",
                "from_operation": "form", "to_operation": "finish",
                "material_id": "steel", "planned_quantity": count,
                "unit": "unit", "declared_title_holder": "b",
                "origin_source_owner": "b",
                "origin_ref": f"model://b/mat-out-{suffix}-origin",
                "quality_spec_owner": "a",
                "quality_spec_ref": f"model://a/mat-out-{suffix}-quality",
            },
        ])
    d["works"][0]["material_batches"] = batches
    if strict:
        sources = d["context_evidence"]["sources"]
        for batch in batches:
            for ref_key, owner_key in (
                ("origin_ref", "origin_source_owner"),
                ("quality_spec_ref", "quality_spec_owner"),
            ):
                sources.append({
                    "id": batch[ref_key], "owner": batch[owner_key],
                    "revision": "source-r1", "status": "CONFIRMED",
                    "usable_by": [batch[owner_key]], "valid_until": 100,
                })
        for suffix in ("1", "2"):
            sources.append({
                "id": f"model://b/w1c-inspection-{suffix}",
                "owner": "b", "revision": "source-r1",
                "status": "CONFIRMED", "usable_by": ["b"],
                "valid_until": 100,
            })
    return d


def multibatch_baseline():
    result = deepcopy(baseline())
    for event in result:
        if event["action"] in {"handoff_dispatch", "handoff_receive"}:
            event["material_quantities"] = [
                {"batch": "mat-in-1", "quantity": "3"},
                {"batch": "mat-in-2", "quantity": "2"},
            ]
        elif event["action"] == "handoff_quality":
            event["quality_quantities"] = [
                {"batch": "mat-in-1", "accepted": "3", "rejected": "0"},
                {"batch": "mat-in-2", "accepted": "2", "rejected": "0"},
            ]
        elif event["action"] == "wip_interrupt":
            del event["wip_material_batch"]
            event["wip_material_batches"] = list(BATCHES)
    return result


def multibatch_proposal(*, inspections=None):
    p = proposal(window=(20, 40), valid_until=50)
    del p["wip_material_batch"]
    p["wip_material_batches"] = list(BATCHES)
    p["wip_batch_inspections"] = (
        inspections if inspections is not None else [
            {
                "batch": "mat-out-1", "total_units": 3,
                "produced_units": 2, "usable_units": 1,
                "inspection_ref": "model://b/w1c-inspection-1",
            },
            {
                "batch": "mat-out-2", "total_units": 2,
                "produced_units": 1, "usable_units": 1,
                "inspection_ref": "model://b/w1c-inspection-2",
            },
        ]
    )
    return p


def interrupted(*, strict=False):
    state = QualitativeAKIS(multibatch_scenario(strict=strict))
    for event in multibatch_baseline():
        result = state.apply(event, event["at"])
        assert result["outcome"] == "APPLIED", (event, result)
    work = state.works["w1"]
    assert work.operation_states["form"] == "PAUSED"
    assert work.material_states["mat-in-1"].accepted == 3
    assert work.material_states["mat-in-2"].accepted == 2
    assert all(work.material_states[k].dispatched is None for k in BATCHES)
    return state


def approved(*, strict=False):
    state = interrupted(strict=strict)
    p = multibatch_proposal()
    assert state.apply(p, 15)["outcome"] == "APPLIED"
    record = state.works["w1"].wip_proposal
    assert record["required"] == ["a", "b", "c", "d"]
    independent_votes(state, record["fingerprint"])
    applied(state, 20, "wip_apply", "c",
            source_revision="d1", org_revision="oc-1",
            wip_operation="form", wip_id="wip-form-1",
            wip_fingerprint=record["fingerprint"],
            wip_source_ref="model://c/form-apply")
    return state


def custody(state, key, begin, *, acceptable=1):
    suffix = key[-1]
    common = {
        "source_revision": "d1", "org_revision": "oc-1",
        "wip_operation": "form", "wip_material_batch": key,
        "wip_id": "wip-form-1",
    }
    dispatch = f"model://b/w1c-dispatch-{suffix}"
    receipt = f"model://d/w1c-receipt-{suffix}"
    applied(state, begin, "wip_handoff_dispatch", "b",
            **common, wip_source_ref=dispatch)
    applied(state, begin + 1, "wip_handoff_receive", "d",
            **common, wip_dispatch_ref=dispatch,
            wip_source_ref=receipt)
    result = send(state, begin + 2, "wip_handoff_quality", "d",
                  **common, wip_receipt_ref=receipt,
                  wip_accepted_units=acceptable,
                  wip_source_ref=f"model://d/w1c-quality-{suffix}")
    return result


def resume(state, at):
    return send(state, at, "wip_resume", "d", source_revision="d1",
                org_revision="oc-1", wip_operation="form",
                wip_source_ref="model://d/w1c-resume")


def test_two_original_material_streams_are_snapshotted_without_second_ledger():
    state = approved()
    work = state.works["w1"]
    assert len(work.wip_lots) == 2
    assert {row["material_batch"] for row in work.wip_lots} == set(BATCHES)
    assert {row["original_material"]["inbound_batch"] for row in work.wip_lots} == {
        "mat-in-1", "mat-in-2",
    }
    assert all(row["status"] == "RESERVED" for row in work.wip_lots)
    assert all("original_cost_claim" not in row and "future_resource_cost" not in row
               for row in work.wip_lots)
    assert work.wip_amendments[0]["lot"]["original_cost_claim"] == "60000.00"
    assert work.wip_amendments[0]["lot"]["future_resource_cost"] == "29000.00"
    assert all(batch.declared_title_holder == "b" for batch in work.material_batches
               if batch.key in BATCHES)
    assert {row.resource for row in state.capacity_ledger.reservations
            if row.work == "w1"} == {"ra", "rb", "rd"}


def test_all_independent_custody_quality_required_before_atomic_resumption():
    state = approved()
    assert custody(state, "mat-out-1", 21)["outcome"] == "APPLIED"
    blocked = resume(state, 24)
    assert blocked["reason"] == "WIP_ORIGINAL_PHYSICAL_CUSTODY_QUALITY_REQUIRED"
    assert all(row["status"] == "RESERVED" for row in state.works["w1"].wip_lots)
    first = next(x for x in state.works["w1"].wip_lots
                 if x["material_batch"] == "mat-out-1")
    assert first["custody_state"] == "QUALITY_ACCEPTED"
    assert custody(state, "mat-out-2", 25)["outcome"] == "APPLIED"
    assert resume(state, 28)["outcome"] == "APPLIED"
    assert all(row["status"] == "CONSUMED" and row["holder"] == "d"
               for row in state.works["w1"].wip_lots)
    assert state.works["w1"].operation_states["form"] == "IN_PROGRESS"
    assert state.works["w1"].material_states["mat-out-2"].dispatched is None


def test_negative_batch_quality_does_not_release_any_reserved_material():
    state = approved()
    assert custody(state, "mat-out-1", 21)["outcome"] == "APPLIED"
    rejected = custody(state, "mat-out-2", 25, acceptable=0)
    assert rejected["outcome"] == "APPLIED"
    assert rejected["quality_revision_required"] is True
    second = next(x for x in state.works["w1"].wip_lots
                  if x["material_batch"] == "mat-out-2")
    assert second["custody_state"] == "QUALITY_REVIEW_REQUIRED"
    assert second["observed_accepted_units"] == 0
    assert second["custody_quality_ref"] == "model://d/w1c-quality-2"
    assert second["holder"] == "d"
    assert resume(state, 28)["reason"] == "WIP_ORIGINAL_PHYSICAL_CUSTODY_QUALITY_REQUIRED"
    # A second optimistic quality report cannot erase the contrary source.
    attempt = send(state, 29, "wip_handoff_quality", "d",
                   source_revision="d1", org_revision="oc-1",
                   wip_operation="form", wip_material_batch="mat-out-2",
                   wip_id="wip-form-1",
                   wip_receipt_ref="model://d/w1c-receipt-2",
                   wip_accepted_units=1,
                   wip_source_ref="model://d/forged-positive-after-negative")
    assert attempt["reason"] == "WIP_CUSTODY_ONLY_RESERVED_MATERIAL" or (
        attempt["reason"] == "WIP_MATERIAL_RECEIPT_AND_RECEIVER_QUALITY_REQUIRED")
    assert state.works["w1"].result == "NOT_SUBMITTED"
    assert all(row["status"] == "RESERVED" for row in state.works["w1"].wip_lots)


@pytest.mark.parametrize("mutate,reason", [
    (lambda p: p["wip_material_batches"].append("mat-out-1"),
     "WIP_MULTI_BATCH_ORIGINAL_SELECTION_REQUIRED"),
    (lambda p: p["wip_batch_inspections"][1].update({"produced_units": 2, "usable_units": 2}),
     "WIP_MULTI_BATCH_TOTALS_DO_NOT_RECONCILE"),
    (lambda p: p["wip_batch_inspections"][1].update(
        {"inspection_ref": "model://b/w1c-inspection-1"}),
     "WIP_MULTI_BATCH_INSPECTIONS_NOT_INDEPENDENT"),
    (lambda p: p["wip_batch_inspections"][0].update({"total_units": 2}),
     "WIP_MULTI_BATCH_ORIGINAL_QUANTITY_CHANGED"),
])
def test_invalid_batch_set_or_inspection_never_creates_new_reservation(mutate, reason):
    state = interrupted()
    p = multibatch_proposal()
    mutate(p)
    before = list(state.capacity_ledger.reservations)
    attempted = state.apply(p, 15)
    assert attempted["reason"] == reason
    assert state.capacity_ledger.reservations == before
    assert state.works["w1"].wip_proposal is None
    assert state.works["w1"].wip_lots == []


def test_same_original_handoff_completes_all_batches_after_resumption():
    state = approved()
    assert custody(state, "mat-out-1", 21)["outcome"] == "APPLIED"
    assert custody(state, "mat-out-2", 24)["outcome"] == "APPLIED"
    assert resume(state, 27)["outcome"] == "APPLIED"
    applied(state, 28, "complete_operation", "d", operation="form",
            result_ref="model://d/w1c-completed-form")
    common = dict(from_operation="form", to_operation="finish",
                  source_revision="d1", org_revision="oc-1")
    quantities = [
        {"batch": "mat-out-1", "quantity": "3"},
        {"batch": "mat-out-2", "quantity": "2"},
    ]
    applied(state, 29, "handoff_dispatch", "d", **common,
            material_quantities=quantities,
            result_ref="model://d/w1c-both-dispatched")
    applied(state, 30, "handoff_receive", "a", **common,
            dispatch_ref="model://d/w1c-both-dispatched",
            material_quantities=quantities,
            result_ref="model://a/w1c-both-received")
    applied(state, 31, "handoff_quality", "a", **common,
            receipt_ref="model://a/w1c-both-received",
            quality_quantities=[
                {"batch": "mat-out-1", "accepted": "3", "rejected": "0"},
                {"batch": "mat-out-2", "accepted": "2", "rejected": "0"},
            ], result_ref="model://a/w1c-both-accepted")
    applied(state, 32, "start_operation", "a", operation="finish")
    applied(state, 33, "complete_operation", "a", operation="finish",
            result_ref="model://a/w1c-finish")
    applied(state, 34, "complete", "a",
            result_ref="model://a/w1c-original-work-result")
    applied(state, 35, "accept", "c")
    work = state.works["w1"]
    assert work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert len(state.works) == 2
    assert work.resource == "ra"
    assert all(work.material_states[key].accepted is not None for key in BATCHES)
    assert all(work.material_states[key].accepted == (3 if key.endswith("1") else 2)
               for key in BATCHES)


def test_strict_original_quality_source_change_blocks_all_batches_before_apply():
    state = interrupted(strict=True)
    p = multibatch_proposal()
    assert state.apply(p, 15)["outcome"] == "APPLIED"
    digest = state.works["w1"].wip_proposal["fingerprint"]
    independent_votes(state, digest)
    applied(state, 20, "source_update", "a",
            source="model://a/mat-out-2-quality",
            status="DISPROVED", expected_revision="source-r1",
            new_revision="source-r2")
    before = list(state.capacity_ledger.reservations)
    attempted = send(state, 21, "wip_apply", "c",
                     source_revision="d1", org_revision="oc-1",
                     wip_operation="form", wip_id="wip-form-1",
                     wip_fingerprint=digest,
                     wip_source_ref="model://c/form-apply")
    assert attempted["reason"] == "WIP_ORIGINAL_EVIDENCE_SOURCE_UNAVAILABLE"
    assert state.capacity_ledger.reservations == before
    assert state.works["w1"].wip_lots == []


def test_native_mesa_scheduler_uses_same_original_multi_batch_state():
    d = multibatch_scenario()
    direct = interrupted()
    p = multibatch_proposal()
    applied(direct, 15, "wip_propose", "c",
            **{k: v for k, v in p.items()
               if k not in {"at", "action", "actor", "work"}})
    digest = direct.works["w1"].wip_proposal["fingerprint"]
    future = [
        ev(at, "wip_review", actor,
           source_revision="d1", org_revision="oc-1",
           wip_operation="form", wip_id="wip-form-1",
           wip_fingerprint=digest, wip_position="SUPPORT",
           wip_source_ref=f"model://{actor}/w1c-vote-{at}")
        for at, actor in enumerate(("a", "b", "c", "d"), start=16)
    ] + [
        ev(20, "wip_apply", "c", source_revision="d1", org_revision="oc-1",
           wip_operation="form", wip_id="wip-form-1",
           wip_fingerprint=digest, wip_source_ref="model://c/form-apply"),
    ]
    d["events"] = multibatch_baseline() + [p] + future
    d["model_horizon"] = 24
    result = simulate(d)
    assert not [x for x in result["trace"] if x["outcome"] == "BLOCKED"]
    lots = result["works"]["w1"]["unfinished_production"]["material_lots"]
    assert len(lots) == 2
    assert {x["material_batch"] for x in lots} == set(BATCHES)
    assert simulate(deepcopy(d)) == result


@pytest.mark.parametrize("changed,expected", [
    ("both-materials", "WIP_MULTI_BATCH_MIXED_MATERIAL_ECONOMICS_NOT_COMPARABLE"),
    ("unmatched-inbound-unit", "WIP_MULTI_BATCH_TRANSFORMATION_REQUIRES_SEPARATE_QUALIFICATION"),
])
def test_independent_batch_group_cannot_invent_material_conversion(changed, expected):
    d = multibatch_scenario()
    for batch in d["works"][0]["material_batches"]:
        if changed == "both-materials" and batch["id"].endswith("-2"):
            batch["material_id"] = "aluminium"
        elif changed == "unmatched-inbound-unit" and batch["id"] == "mat-in-2":
            batch["unit"] = "kg"
    state = QualitativeAKIS(d)
    events = multibatch_baseline()
    for event in events[:-1]:
        result = state.apply(event, event["at"])
        assert result["outcome"] == "APPLIED", (event, result)
    before = list(state.capacity_ledger.reservations)
    attempted = state.apply(events[-1], events[-1]["at"])
    assert attempted["reason"] == expected
    assert state.works["w1"].wip_interruptions == []
    assert state.works["w1"].operation_states["form"] == "IN_PROGRESS"
    assert state.capacity_ledger.reservations == before
