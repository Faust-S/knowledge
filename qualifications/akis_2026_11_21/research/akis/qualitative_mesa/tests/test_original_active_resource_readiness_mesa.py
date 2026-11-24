"""Original Work remains active while required resources lose readiness."""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.capacity import original_execution_readiness_view
from .test_technology import world, signed, act
from .test_capacity_akis_integration import world as whole_world, progress
from .test_rules import apply


def status(s, at, resource, owner, value):
    return s.apply({"at": at, "action": "resource_status", "actor": owner,
                    "resource": resource, "availability": value}, at)


@pytest.mark.parametrize("value,reason", [
    ("UNAVAILABLE", "RESOURCE_NOT_AVAILABLE"), ("UNKNOWN", "RESOURCE_READINESS_UNKNOWN")])
def test_active_original_stage_requires_restored_resource_without_erasing_history(value, reason):
    s = QualitativeAKIS(world())
    signed(s)
    act(s, 7, "start_operation", "a", operation="cut")
    assert act(s, 8, "complete_operation", "a", operation="cut",
               result_ref="model://cut")["outcome"] == "APPLIED"
    assert act(s, 9, "start_operation", "b", operation="pack")["outcome"] == "APPLIED"
    old = tuple(s.capacity_ledger.reservations)
    assert status(s, 10, "rb", "b", value)["outcome"] == "APPLIED"
    assert status(s, 11, "rb", "op", "AVAILABLE")["reason"] == "RESOURCE_OWNER_REQUIRED"
    assert act(s, 12, "complete_operation", "b", operation="pack",
               result_ref="model://pack")["reason"] == reason
    assert s.works["w1"].operation_states == {"cut": "COMPLETED", "pack": "IN_PROGRESS"}
    assert s.works["w1"].operation_evidence == {"cut": "model://cut"}
    partial = s.snapshot()["works"]["w1"]["original_execution_readiness"]
    assert not partial["all_observed_readiness_interruptions_closed"]
    assert partial["any_required_resource_not_ready_model_ticks"] == 2
    assert status(s, 13, "rb", "b", "AVAILABLE")["outcome"] == "APPLIED"
    assert act(s, 14, "complete_operation", "b", operation="pack",
               result_ref="model://pack")["outcome"] == "APPLIED"
    # Readiness of completed stages is not retroactively re-evaluated.
    status(s, 15, "ra", "a", "UNAVAILABLE")
    assert act(s, 16, "complete", "a", result_ref="model://whole")["outcome"] == "APPLIED"
    assert act(s, 17, "accept", "c")["outcome"] == "APPLIED"
    assert tuple(s.capacity_ledger.reservations) == old
    view = s.snapshot()["works"]["w1"]["original_execution_readiness"]
    assert view["all_observed_readiness_interruptions_closed"]
    assert view["any_required_resource_not_ready_model_ticks"] == 3
    assert view["any_required_resource_declared_unavailable_model_ticks"] == (
        3 if value == "UNAVAILABLE" else 0)
    assert view["any_required_resource_unknown_readiness_model_ticks"] == (
        3 if value == "UNKNOWN" else 0)


def test_overlapping_required_resource_interruptions_are_not_double_counted():
    s = QualitativeAKIS(whole_world(strict=True))
    progress(s)
    apply(s, "consent", 5, "c", work="w1", source_revision="d-1", org_revision="oc-1")
    assert apply(s, "commit", 6, "op", work="w1")["outcome"] == "APPLIED"
    assert apply(s, "start", 7, "a", work="w1")["outcome"] == "APPLIED"
    status(s, 8, "ra", "a", "UNAVAILABLE")
    status(s, 9, "rb", "b", "UNKNOWN")
    status(s, 10, "ra", "a", "UNAVAILABLE")  # repeat, not a new interval
    status(s, 11, "ra", "a", "AVAILABLE")
    assert apply(s, "complete", 12, "a", work="w1",
                 result_ref="model://whole")["reason"] == "RESOURCE_READINESS_UNKNOWN"
    status(s, 13, "rb", "b", "AVAILABLE")
    assert apply(s, "complete", 14, "a", work="w1",
                 result_ref="model://whole")["outcome"] == "APPLIED"
    assert apply(s, "accept", 15, "c", work="w1")["outcome"] == "APPLIED"
    trace = deepcopy(s.trace)
    view = original_execution_readiness_view(trace, "w1", 15)
    assert trace == s.trace
    assert view["original_active_execution_readiness_change_count"] == 4
    assert view["any_required_resource_not_ready_model_ticks"] == 5
    assert view["any_required_resource_declared_unavailable_model_ticks"] == 3
    assert view["any_required_resource_unknown_readiness_model_ticks"] == 4
    assert view["all_observed_readiness_interruptions_closed"]
    clipped = original_execution_readiness_view(trace, "w1", 10)
    assert clipped["any_required_resource_not_ready_model_ticks"] == 2
    assert not clipped["all_observed_readiness_interruptions_closed"]
