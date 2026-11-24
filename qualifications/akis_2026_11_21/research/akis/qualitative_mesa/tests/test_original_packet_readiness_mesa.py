"""Post-event readiness uses the original preparation gate, not a new authority."""
from copy import deepcopy
import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_original_delegation_recovery_mesa import (
    renewal_routes, authority_points, authority_time, original_applied,
)
from .test_original_bounded_delegation_mesa import delegated_route, event
from .test_original_preparation_pattern_revision_mesa import without_costs

READY = "current_consumed_phase_six_ready"
WAIT = "current_consumed_awaiting_customer_review"
STALE = "current_consumed_packet_not_ready"
UNUSED = "current_unused_mandate"
NONE = "without_current_mandate"


def readiness_time(out):
    return out["general_akis_model"]["agent_function_formation_model_gate"][
        "original_packet_readiness_model_time"]


def point(out, at):
    return authority_points(out)[at]["packet_readiness"]


@pytest.mark.parametrize("patterns", [False, True])
def test_original_packet_readiness_follows_independent_review_and_recovery(patterns):
    doc = renewal_routes(patterns=patterns)["RECOVERED"]
    frozen = deepcopy(doc)
    out = simulate(doc)
    assert doc == frozen
    g1,g2 = original_applied(out,"function_delegate")
    p1,p2 = original_applied(out,"function_prepare")
    r1,r2 = original_applied(out,"function_review")
    change = next(row for row in out["trace"] if row["action"]=="source_update"
                  and row["at"] > r1["at"] and row["at"] < g2["at"])
    commit = original_applied(out,"commit")[0]
    for row, state in ((g1,UNUSED),(p1,WAIT),(r1,READY),(change,NONE),
                       (g2,UNUSED),(p2,WAIT),(r2,READY)):
        assert point(out,row["at"])[state] == 1
    assert point(out,commit["at"])[READY] == 0
    time = readiness_time(out)
    values = time["pending_work_model_ticks_by_state"]
    assert values[UNUSED] == p1["at"]-g1["at"]+p2["at"]-g2["at"]
    assert values[WAIT] == r1["at"]-p1["at"]+r2["at"]-p2["at"]
    assert values[READY] == change["at"]-r1["at"]+commit["at"]-r2["at"]
    assert values[NONE] == g2["at"]-change["at"]
    assert values[STALE] == 0
    assert sum(values.values()) == time["pending_work_model_ticks"]
    assert time["pending_work_model_ticks"] == authority_time(out)["pending_work_model_ticks_after_first_mandate"]
    assert time["phase_six_ready_is_not_full_commit_permission"]
    assert out == simulate(deepcopy(doc))


def test_rejected_packet_does_not_become_ready_with_current_consumed_mandate():
    doc = without_costs(delegated_route(patterns=False))
    review = event(doc,"function_review","w3")
    review["human_decision"] = "REJECT"
    doc["events"] = [row for row in doc["events"] if row["at"] <= review["at"]]
    doc["model_horizon"] = review["at"]+3
    out = simulate(doc)
    assert point(out,review["at"])[STALE] == 1
    assert point(out,review["at"])[READY] == 0
    assert point(out,review["at"])["current_consumed_packet_failure_reasons"] == {
        "FORMATION_AGENT_ORIGINAL_CUSTOMER_REJECTED":1}
    assert readiness_time(out)["pending_work_model_ticks_by_state"][STALE] == 3
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"


def test_function_basis_expiry_invalidates_packet_without_invalidating_mandate():
    doc = without_costs(delegated_route(patterns=False))
    review = event(doc,"function_review","w3")
    fn = next(row for row in doc["general_akis"]["agent_functions"]
              if row["work"]=="w3" and row["id"]==review["function_id"])
    src = next(row for row in doc["context_evidence"]["sources"]
               if row["id"]==fn["basis_source"])
    src["valid_until"] = review["at"]+2
    expiry = src["valid_until"]+1
    doc["events"] = [row for row in doc["events"] if row["at"] <= review["at"]]
    doc["model_horizon"] = expiry+3
    out = simulate(doc)
    assert point(out,review["at"])[READY] == 1
    assert point(out,expiry)[STALE] == 1
    assert point(out,expiry)[NONE] == 0
    assert not any(row["at"]==expiry for row in out["trace"])
    assert readiness_time(out)["pending_work_model_ticks_by_state"][STALE] == 3
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"


def test_ready_packet_is_not_capacity_or_actual_commit():
    from .test_original_portfolio_delegation_mesa import blocked_portfolio_mandate_routes
    from .test_r4_original_outside_work_mesa import OUTSIDE
    doc = blocked_portfolio_mandate_routes()["DELEGATED"]
    out = simulate(doc)
    review = event(doc,"function_review",OUTSIDE)
    assert point(out,review["at"])[READY] == 1
    assert out["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"
    assert readiness_time(out)["phase_six_ready_is_not_full_commit_permission"]
