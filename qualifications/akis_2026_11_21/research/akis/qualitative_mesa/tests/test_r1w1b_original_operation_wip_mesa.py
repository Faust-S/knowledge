"""R1-W1B: interrupted ORIGINAL Operation with original Handoff/MaterialBatch.

No second Work, Result, Store, capacity scheduler or inferred legal title.
The signed originally declared material and operation remain in one Mesa 3.5.2.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_technology import world, op


def scenario():
    d = world()
    d["subjects"].append({"id": "d", "kind": "SME"})
    d["resources"] = [
        {"id": "ra", "owner": "a", "availability": "AVAILABLE",
         "capacity_units": 1, "capacity_unit": "machine", "site": "plant-a"},
        {"id": "rb", "owner": "b", "availability": "AVAILABLE",
         "capacity_units": 1, "capacity_unit": "machine", "site": "plant-b"},
        {"id": "rd", "owner": "d", "availability": "AVAILABLE",
         "capacity_units": 1, "capacity_unit": "machine", "site": "plant-d"},
    ]
    d["handoff_strict"] = True
    d["material_strict"] = True
    d["works"] = [{
        "id": "w1", "customer": "c", "resource": "ra",
        "source_revision": "d1", "slot_start": 0, "slot_end": 12,
        "operations": [
            op("source", "ra", 0, 4),
            op("form", "rb", 4, 8, ("source",)),
            op("finish", "ra", 8, 12, ("form",)),
        ],
        "material_batches": [
            {"id": "mat-in", "from_operation": "source", "to_operation": "form",
             "material_id": "steel", "planned_quantity": "5", "unit": "unit",
             "declared_title_holder": "a", "origin_source_owner": "a",
             "origin_ref": "model://a/mat-in-origin", "quality_spec_owner": "c",
             "quality_spec_ref": "model://c/mat-in-quality"},
            {"id": "mat-out", "from_operation": "form", "to_operation": "finish",
             "material_id": "steel", "planned_quantity": "5", "unit": "unit",
             "declared_title_holder": "b", "origin_source_owner": "b",
             "origin_ref": "model://b/mat-out-origin", "quality_spec_owner": "a",
             "quality_spec_ref": "model://a/mat-out-quality"},
        ],
    }]
    # The receiving enterprise has its own prospective Work, as in R1-W1.
    # Its resource is not inserted into the original technological DAG.
    d["works"].append({
        "id": "w2", "customer": "c", "resource": "rd",
        "source_revision": "d2", "slot_start": 40, "slot_end": 46,
    })
    d["cooperation_links"] = [{
        "id": "net", "coordinator": "op", "purpose": "one original production chain",
        "participants": ["op", "a", "b", "c", "d"], "works": ["w1", "w2"],
        "mechanisms": ["SHARED_LOGISTICS"],
        "source_ref": "model://op/network-r1w1b",
        "source_revision": "net-r1",
    }]
    return d


def ev(at, action, actor, **values):
    return {"at": at, "action": action, "actor": actor, "work": "w1", **values}


def send(state, at, action, actor, **values):
    return state.apply(ev(at, action, actor, **values), at)


def applied(state, at, action, actor, **values):
    result = send(state, at, action, actor, **values)
    assert result["outcome"] == "APPLIED", result
    return result


def baseline():
    return [
        ev(1, "offer", "op"),
        ev(2, "authorize", "op"),
        *[
            ev(at, "consent", actor, source_revision="d1", org_revision="oc-1")
            for at, actor in ((3, "a"), (4, "b"), (5, "c"))
        ],
        ev(6, "commit", "op"),
        ev(7, "start_operation", "a", operation="source"),
        ev(8, "complete_operation", "a", operation="source",
           result_ref="model://a/source-completed"),
        ev(9, "handoff_dispatch", "a", from_operation="source",
           to_operation="form", source_revision="d1", org_revision="oc-1",
           material_quantities=[{"batch": "mat-in", "quantity": "5"}],
           result_ref="model://a/material-out-1"),
        ev(10, "handoff_receive", "b", from_operation="source",
           to_operation="form", source_revision="d1", org_revision="oc-1",
           dispatch_ref="model://a/material-out-1",
           material_quantities=[{"batch": "mat-in", "quantity": "5"}],
           result_ref="model://b/material-in-1"),
        ev(11, "handoff_quality", "b", from_operation="source",
           to_operation="form", source_revision="d1", org_revision="oc-1",
           receipt_ref="model://b/material-in-1",
           quality_quantities=[{
               "batch": "mat-in", "accepted": "5", "rejected": "0",
           }],
           result_ref="model://b/material-accepted-1"),
        ev(12, "start_operation", "b", operation="form"),
        ev(13, "resource_status", "b", resource="rb",
           availability="UNAVAILABLE"),
        ev(14, "wip_interrupt", "b", source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_material_batch="mat-out",
           cost_source_ref="model://b/form-attempt-1-cost",
           prior_cost_claim="60000.00"),
    ]


def terms(*, total=5, produced=3, usable=2, material="7000.00",
          handling="1500.00", claim="5000.00", full="60000.00",
          owner="b", ref="ACT-01"):
    return {
        "total_units": total, "produced_units": produced,
        "usable_units": usable, "material_value": material,
        "handling_cost": handling, "claim_amount": claim,
        "next_full_cost": full,
        "inspection_ref": f"model://{owner}/{ref}",
        "claim_ref": f"model://{owner}/claim-{ref}" if claim != "0.00" else "",
    }


def proposal(*, at=15, decision="TRANSFER", target="rd", valid_until=40,
             window=(20, 27), inspection=None, amendment_id="wip-form-1"):
    return ev(
        at, "wip_propose", "c", source_revision="d1", org_revision="oc-1",
        wip_operation="form", wip_material_batch="mat-out",
        wip_id=amendment_id, work_interruption_at=14,
        wip_decision=decision,
        wip_source_ref="model://c/form-proposal-" + amendment_id,
        wip_target_resource=target if decision != "TERMINATE" else None,
        wip_cooperation_link="net" if decision == "TRANSFER" else None,
        wip_cooperation_revision="net-r1" if decision == "TRANSFER" else None,
        wip_slot_start=window[0] if decision != "TERMINATE" else None,
        wip_slot_end=window[1] if decision != "TERMINATE" else None,
        wip_capacity_units=1 if decision != "TERMINATE" else None,
        wip_valid_until=valid_until,
        wip_terms=inspection or terms(),
    )


def state_to_interruption():
    state = QualitativeAKIS(scenario())
    for event in baseline():
        result = state.apply(event, event["at"])
        assert result["outcome"] == "APPLIED", (event, result)
    assert state.works["w1"].operation_states["form"] == "PAUSED"
    assert state.works["w1"].material_states["mat-in"].accepted == 5
    assert state.works["w1"].material_states["mat-out"].dispatched is None
    return state


def independent_votes(state, fingerprint, *, start=16, objector=None):
    for at, subject in enumerate(("a", "b", "c", "d"), start=start):
        result = send(
            state, at, "wip_review", subject, source_revision="d1",
            org_revision="oc-1", wip_operation="form",
            wip_id="wip-form-1", wip_fingerprint=fingerprint,
            wip_position="OBJECT" if subject == objector else "SUPPORT",
            wip_source_ref=f"model://{subject}/wip-review-{at}",
        )
        assert result["outcome"] == "APPLIED", result


def approved_transfer():
    state = state_to_interruption()
    p = proposal()
    assert state.apply(p, p["at"])["outcome"] == "APPLIED"
    record = state.works["w1"].wip_proposal
    digest = record["fingerprint"]
    assert record["required"] == ["a", "b", "c", "d"]
    independent_votes(state, digest)
    result = send(
        state, 20, "wip_apply", "c", wip_operation="form",
        source_revision="d1", org_revision="oc-1",
        wip_id="wip-form-1", wip_fingerprint=digest,
        wip_source_ref="model://c/form-apply",
    )
    assert result["outcome"] == "APPLIED", result
    return state


def custody(state):
    common = {
        "wip_operation": "form", "wip_material_batch": "mat-out",
        "wip_id": "wip-form-1", "source_revision": "d1",
        "org_revision": "oc-1",
    }
    applied(state, 21, "wip_handoff_dispatch", "b", **common,
            wip_source_ref="model://b/form-custody-dispatch")
    applied(state, 22, "wip_handoff_receive", "d", **common,
            wip_dispatch_ref="model://b/form-custody-dispatch",
            wip_source_ref="model://d/form-custody-receipt")
    applied(state, 23, "wip_handoff_quality", "d", **common,
            wip_receipt_ref="model://d/form-custody-receipt",
            wip_accepted_units=2,
            wip_source_ref="model://d/form-custody-quality")


def test_original_started_operation_and_existing_material_are_indispensable():
    state = QualitativeAKIS(scenario())
    for event in baseline()[:6]:
        assert state.apply(event, event["at"])["outcome"] == "APPLIED"
    before = deepcopy(state.works["w1"].operation_states)
    result = send(state, 7, "wip_interrupt", "b", source_revision="d1",
                  org_revision="oc-1", wip_operation="form",
                  wip_material_batch="mat-out",
                  cost_source_ref="model://b/early-cost",
                  prior_cost_claim="60000.00")
    assert result["reason"] == "WIP_ORIGINAL_OPERATION_NOT_EXCLUSIVELY_STARTED"
    assert state.works["w1"].operation_states == before


def test_transfer_requires_original_title_quality_and_downstream_independent_consents():
    state = state_to_interruption()
    assert state.apply(proposal(), 15)["outcome"] == "APPLIED"
    p = state.works["w1"].wip_proposal
    assert p["required"] == ["a", "b", "c", "d"]
    assert p["material"]["batch"] == "mat-out"
    assert p["material"]["inbound_receipt_ref"] == "model://b/material-in-1"
    assert p["material"]["inbound_quality_ref"] == "model://b/material-accepted-1"
    assert p["material"]["declared_title_holder"] == "b"
    assert p["lot"]["future_resource_cost"] == "29000.00"
    digest = p["fingerprint"]
    assert send(state, 16, "wip_apply", "c", source_revision="d1",
                org_revision="oc-1", wip_operation="form",
                wip_id="wip-form-1", wip_fingerprint=digest,
                wip_source_ref="model://c/no-votes")["reason"] == (
                    "WIP_INDEPENDENT_SUPPORT_MISSING")
    independent_votes(state, digest, objector="a")
    blocked = send(state, 20, "wip_apply", "c", source_revision="d1",
                   org_revision="oc-1", wip_operation="form",
                   wip_id="wip-form-1", wip_fingerprint=digest,
                   wip_source_ref="model://c/blocked")
    assert blocked["reason"] == "WIP_INDEPENDENT_SUPPORT_MISSING"
    assert not state.works["w1"].wip_lots
    assert "rd" not in [r.resource for r in state.capacity_ledger.reservations]


def test_original_operation_transfer_is_reserved_without_fictional_delivery():
    state = approved_transfer()
    work = state.works["w1"]
    assert work.resource == "ra"
    assert work.operation_states["form"] == "PAUSED"
    assert work.operation_states["source"] == "COMPLETED"
    assert work.operation_states["finish"] == "NOT_STARTED"
    assert len(work.wip_lots) == 1
    lot = work.wip_lots[0]
    assert lot["status"] == "RESERVED"
    assert lot["holder"] == "b"
    assert lot["custody_state"] == "AWAITING_DISPATCH"
    assert lot["material_batch"] == "mat-out"
    assert next(batch for batch in work.material_batches if batch.key == "mat-out").declared_title_holder == "b"
    assert work.material_states["mat-in"].accepted == 5
    assert work.material_states["mat-out"].dispatched is None
    assert work.wip_operation_active_resources == {"form": "rd"}
    assert [(r.resource, r.start, r.end) for r in state.capacity_ledger.reservations
            if r.work == "w1"] == [
                ("ra", 0, 4), ("rb", 4, 8), ("ra", 8, 12), ("rd", 20, 27),
            ]
    assert send(state, 21, "wip_resume", "d",
                source_revision="d1", org_revision="oc-1",
                wip_operation="form",
                wip_source_ref="model://d/premature-resume")["reason"] == (
                    "WIP_ORIGINAL_PHYSICAL_CUSTODY_QUALITY_REQUIRED")
    assert lot["holder"] == "b" and lot["used_at"] is None


def test_custody_receiver_and_independent_quality_before_resumption():
    state = approved_transfer()
    common = {
        "wip_operation": "form", "wip_material_batch": "mat-out",
        "wip_id": "wip-form-1", "source_revision": "d1", "org_revision": "oc-1",
    }
    assert send(state, 21, "wip_handoff_receive", "d", **common,
                wip_dispatch_ref="model://b/not-dispatched",
                wip_source_ref="model://d/forged-receipt")["outcome"] == "BLOCKED"
    applied(state, 21, "wip_handoff_dispatch", "b", **common,
            wip_source_ref="model://b/form-custody-dispatch")
    assert send(state, 22, "wip_handoff_receive", "a", **common,
                wip_dispatch_ref="model://b/form-custody-dispatch",
                wip_source_ref="model://a/forged-receipt")["outcome"] == "BLOCKED"
    applied(state, 22, "wip_handoff_receive", "d", **common,
            wip_dispatch_ref="model://b/form-custody-dispatch",
            wip_source_ref="model://d/form-custody-receipt")
    lot = state.works["w1"].wip_lots[0]
    assert lot["holder"] == "d" and lot["status"] == "RESERVED"
    assert send(state, 23, "wip_handoff_quality", "d", **common,
                wip_receipt_ref="model://d/wrong-receipt",
                wip_accepted_units=2,
                wip_source_ref="model://d/forged-quality")["outcome"] == "BLOCKED"
    assert send(state, 23, "wip_handoff_quality", "d", **common,
                wip_receipt_ref="model://d/form-custody-receipt",
                wip_accepted_units=1,
                wip_source_ref="model://d/insufficient-quality")["reason"] == (
                    "WIP_REVISED_MATERIAL_QUALITY_REQUIRES_NEW_CONSENT")
    applied(state, 23, "wip_handoff_quality", "d", **common,
            wip_receipt_ref="model://d/form-custody-receipt",
            wip_accepted_units=2, wip_source_ref="model://d/form-custody-quality")
    assert lot["custody_state"] == "QUALITY_ACCEPTED"
    assert lot["status"] == "RESERVED"


def test_full_operation_handoff_material_and_original_work_result_are_preserved():
    state = approved_transfer()
    custody(state)
    applied(state, 24, "wip_resume", "d",
            source_revision="d1", org_revision="oc-1",
            wip_operation="form",
            wip_source_ref="model://d/form-resume")
    work = state.works["w1"]
    assert work.operation_states["form"] == "IN_PROGRESS"
    assert work.wip_lots[-1]["status"] == "CONSUMED"
    assert work.wip_lots[-1]["holder"] == "d"
    assert work.material_states["mat-out"].dispatched is None
    assert send(state, 25, "complete_operation", "b",
                operation="form", result_ref="model://b/form-pretended")["reason"] == (
                    "ORIGINAL_OPERATION_PERFORMER_REQUIRED")
    applied(state, 25, "complete_operation", "d",
            operation="form", result_ref="model://d/form-completed")
    assert send(state, 26, "handoff_dispatch", "b",
                from_operation="form", to_operation="finish",
                source_revision="d1", org_revision="oc-1",
                material_quantities=[{"batch": "mat-out", "quantity": "5"}],
                result_ref="model://b/forged-dispatch")["reason"] == (
                    "HANDOFF_ORIGINAL_SENDER_REQUIRED")
    applied(state, 26, "handoff_dispatch", "d",
            from_operation="form", to_operation="finish",
            source_revision="d1", org_revision="oc-1",
            material_quantities=[{"batch": "mat-out", "quantity": "5"}],
            result_ref="model://d/outgoing-dispatch")
    applied(state, 27, "handoff_receive", "a",
            from_operation="form", to_operation="finish",
            source_revision="d1", org_revision="oc-1",
            dispatch_ref="model://d/outgoing-dispatch",
            material_quantities=[{"batch": "mat-out", "quantity": "5"}],
            result_ref="model://a/outgoing-receipt")
    applied(state, 28, "handoff_quality", "a",
            from_operation="form", to_operation="finish",
            source_revision="d1", org_revision="oc-1",
            receipt_ref="model://a/outgoing-receipt",
            quality_quantities=[{
                "batch": "mat-out", "accepted": "5", "rejected": "0",
            }],
            result_ref="model://a/outgoing-quality")
    applied(state, 29, "start_operation", "a", operation="finish")
    applied(state, 30, "complete_operation", "a",
            operation="finish", result_ref="model://a/finish-completed")
    applied(state, 31, "complete", "a",
            result_ref="model://a/original-work-result")
    applied(state, 32, "accept", "c")
    assert work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert work.resource == "ra"
    assert work.obligation == "FULFILLED"
    assert len(state.works) == 2
    assert state.works["w2"].result == "NOT_SUBMITTED"
    assert state.works["w2"].obligation == "NOT_ACCEPTED"
    view = state.snapshot()["works"]["w1"]
    technology = view["technology"]
    form = next(row for row in technology["operations"] if row["id"] == "form")
    assert form["declared_performer_owner"] == "b"
    assert form["effective_performer_owner"] == "d"
    handoff = next(
        row for row in technology["handoffs"]["required_edges"]
        if row["from_operation"] == "form"
    )
    assert handoff["sender"] == "b"
    assert handoff["effective_sender"] == "d"
    assert handoff["effective_source_site"] == "plant-d"
    assert next(row for row in technology["materials"]["batches"] if row["batch"] == "mat-out")["declared_title_holder"] == "b"
    assert view["unfinished_production"]["material_original_batches_unchanged"]
    assert view["unfinished_production"]["no_second_work_or_result"]


def test_original_work_cannot_complete_while_technological_operation_paused():
    state = approved_transfer()
    assert send(state, 21, "complete", "a",
                result_ref="model://a/ghost-result")["outcome"] == "BLOCKED"
    assert send(state, 21, "complete_operation", "d",
                operation="form", result_ref="model://d/premature")["outcome"] == "BLOCKED"
    assert state.works["w1"].result == "NOT_SUBMITTED"


def test_termination_preserves_original_material_and_does_not_create_result():
    state = state_to_interruption()
    p = proposal(decision="TERMINATE")
    assert state.apply(p, 15)["outcome"] == "APPLIED"
    digest = state.works["w1"].wip_proposal["fingerprint"]
    for at, owner in enumerate(("a", "b", "c"), start=16):
        applied(state, at, "wip_review", owner,
                source_revision="d1", org_revision="oc-1",
                wip_operation="form", wip_id="wip-form-1",
                wip_fingerprint=digest, wip_position="SUPPORT",
                wip_source_ref=f"model://{owner}/terminate-vote")
    applied(state, 20, "wip_apply", "c",
            source_revision="d1", org_revision="oc-1",
            wip_operation="form", wip_id="wip-form-1",
            wip_fingerprint=digest, wip_source_ref="model://c/terminate-apply")
    work = state.works["w1"]
    assert work.execution == "STOPPED"
    assert work.operation_states["form"] == "STOPPED"
    assert work.wip_lots[-1]["status"] == "HELD"
    assert work.material_states["mat-in"].accepted == 5
    assert work.material_states["mat-out"].dispatched is None
    assert work.result == "NOT_SUBMITTED"


def test_real_mesa_352_scheduler_qualifies_technological_interruption():
    d = scenario()
    direct = QualitativeAKIS(deepcopy(d))
    initial = baseline()
    for event in initial:
        assert direct.apply(event, event["at"])["outcome"] == "APPLIED"
    offered = proposal()
    assert direct.apply(offered, 15)["outcome"] == "APPLIED"
    fingerprint = direct.works["w1"].wip_proposal["fingerprint"]
    events = initial + [offered] + [
        ev(at, "wip_review", actor, source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_id="wip-form-1", wip_fingerprint=fingerprint,
           wip_position="SUPPORT",
           wip_source_ref=f"model://{actor}/vote-native")
        for at, actor in enumerate(("a", "b", "c", "d"), start=16)
    ] + [
        ev(20, "wip_apply", "c", source_revision="d1", org_revision="oc-1",
           wip_operation="form", wip_id="wip-form-1",
           wip_fingerprint=fingerprint,
           wip_source_ref="model://c/apply-native"),
        ev(21, "wip_handoff_dispatch", "b", source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_id="wip-form-1", wip_material_batch="mat-out",
           wip_source_ref="model://b/custody-dispatch-native"),
        ev(22, "wip_handoff_receive", "d", source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_id="wip-form-1", wip_material_batch="mat-out",
           wip_dispatch_ref="model://b/custody-dispatch-native",
           wip_source_ref="model://d/custody-receipt-native"),
        ev(23, "wip_handoff_quality", "d", source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_id="wip-form-1", wip_material_batch="mat-out",
           wip_receipt_ref="model://d/custody-receipt-native",
           wip_accepted_units=2,
           wip_source_ref="model://d/custody-quality-native"),
        ev(24, "wip_resume", "d", source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_source_ref="model://d/resume-native"),
    ]
    d["events"] = events
    d["model_horizon"] = 28
    result = simulate(d)
    blocked = [row for row in result["trace"] if row["outcome"] == "BLOCKED"]
    assert not blocked, blocked
    assert result["works"]["w1"]["unfinished_production"]["material_lots"][0][
        "status"] == "CONSUMED"
    assert result["works"]["w1"]["technology"]["operations"][1]["execution"] == "IN_PROGRESS"
    assert result["works"]["w1"]["resource_owner"] == "a"
    assert simulate(deepcopy(d)) == result
