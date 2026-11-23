"""R1-W1C first native step: independent parallel Operation survives WIP pause.

One original Work, immutable technology DAG and original CapacityLedger.
"""
from .test_r1w1b_original_operation_wip_mesa import (
    scenario, op, ev, send, applied, proposal, independent_votes,
)
from research.akis.qualitative_mesa.rules import QualitativeAKIS


def parallel_scenario():
    d = scenario()
    d["works"][0]["operations"].append(
        op("side", "ra", 4, 8, ("source",))
    )
    return d


def parallel_state(*, side_before_interrupt):
    state = QualitativeAKIS(parallel_scenario())
    for event in [
        ev(1, "offer", "op"),
        ev(2, "authorize", "op"),
        *[ev(at, "consent", owner, source_revision="d1", org_revision="oc-1")
          for at, owner in [(3, "a"), (4, "b"), (5, "c")]],
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
           quality_quantities=[{"batch": "mat-in", "accepted": "5", "rejected": "0"}],
           result_ref="model://b/material-accepted-1"),
        ev(12, "start_operation", "b", operation="form"),
    ]:
        result = state.apply(event, event["at"])
        assert result["outcome"] == "APPLIED", (event, result)
    if side_before_interrupt:
        applied(state, 13, "start_operation", "a", operation="side")
    applied(state, 14, "resource_status", "b",
            resource="rb", availability="UNAVAILABLE")
    applied(state, 15, "wip_interrupt", "b",
            source_revision="d1", org_revision="oc-1",
            wip_operation="form", wip_material_batch="mat-out",
            cost_source_ref="model://b/form-attempt-1-cost",
            prior_cost_claim="60000.00")
    return state


def test_parallel_operation_remains_active_after_other_branch_interrupts():
    state = parallel_state(side_before_interrupt=True)
    work = state.works["w1"]
    assert work.execution == "IN_PROGRESS"
    assert work.operation_states["form"] == "PAUSED"
    assert work.operation_states["side"] == "IN_PROGRESS"
    applied(state, 16, "complete_operation", "a",
            operation="side", result_ref="model://a/side-completed")
    assert work.execution == "PAUSED"
    assert work.operation_states["side"] == "COMPLETED"
    assert work.material_states["mat-in"].accepted == 5
    assert work.material_states["mat-out"].dispatched is None
    assert work.result == "NOT_SUBMITTED"


def test_original_independent_operation_can_start_after_neighbor_pauses():
    state = parallel_state(side_before_interrupt=False)
    work = state.works["w1"]
    assert work.execution == "PAUSED"
    applied(state, 16, "start_operation", "a", operation="side")
    assert work.execution == "IN_PROGRESS"
    assert work.operation_states["form"] == "PAUSED"
    applied(state, 17, "complete_operation", "a",
            operation="side", result_ref="model://a/side-completed")
    assert work.execution == "PAUSED"
    assert work.operation_states["form"] == "PAUSED"


def test_parallel_branch_does_not_block_original_transfer_after_completion():
    state = parallel_state(side_before_interrupt=True)
    applied(state, 16, "complete_operation", "a",
            operation="side", result_ref="model://a/side-completed")
    offer = proposal(at=17, window=(26, 33), valid_until=40)
    offer["work_interruption_at"] = 15
    applied(state, 17, "wip_propose", "c",
            **{k: v for k, v in offer.items()
               if k not in {"at", "action", "actor", "work"}})
    digest = state.works["w1"].wip_proposal["fingerprint"]
    independent_votes(state, digest, start=18)
    applied(state, 22, "wip_apply", "c",
            source_revision="d1", org_revision="oc-1",
            wip_operation="form", wip_id="wip-form-1",
            wip_fingerprint=digest,
            wip_source_ref="model://c/w1c-parallel-apply")
    work = state.works["w1"]
    assert work.operation_states["side"] == "COMPLETED"
    assert work.operation_states["form"] == "PAUSED"
    assert work.execution == "PAUSED"
    assert work.wip_operation_active_resources == {"form": "rd"}
    assert any(res.work == "w1" and res.resource == "rd"
               and res.start == 26 and res.end == 33
               for res in state.capacity_ledger.reservations)


def test_second_parallel_interruption_explicitly_rejected():
    state = parallel_state(side_before_interrupt=True)
    applied(state, 16, "resource_status", "a",
            resource="ra", availability="UNAVAILABLE")
    attempt = send(state, 17, "wip_interrupt", "a",
                   source_revision="d1", org_revision="oc-1",
                   wip_operation="side",
                   cost_source_ref="model://a/side-cost",
                   prior_cost_claim="1000.00")
    assert attempt["outcome"] == "BLOCKED"
    assert attempt["reason"] == "WIP_ANOTHER_ORIGINAL_OPERATION_ALREADY_PAUSED"
    assert len(state.works["w1"].wip_interruptions) == 1
