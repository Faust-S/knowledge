"""Cross-component AKIS adversarial invariants: source and resource scopes.

Regression tests are intended to fail against M4.1 until the audited bugs
are corrected. Only MODEL_ONLY capacity claims, no actual physical output.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.capacity import (
    CapacityLedger, FutureCapacityClaim, ResourceCapacity, ResourceNeed,
    CapacityBlocked,
)
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_capability_dynamics_mesa import capability_case


def _ledger(allowed=("licensed",), *, capacity=1, future=2):
    capacity_ledger = CapacityLedger({
        "rb": ResourceCapacity("rb", "b", capacity, "team", None, "MODEL_DECLARED")
    })
    capacity_ledger.declare_future_capacity(FutureCapacityClaim(
        "owner-adoption", "rb", "b-source", "rev-1", 40, 44,
        future, allowed,
    ))
    return capacity_ledger


def test_baseline_occupant_and_licensed_increment_can_share_resource():
    """A baseline Work uses the original unit; a granted Work uses increment."""
    ledger = _ledger()
    ledger.reserve("baseline", (ResourceNeed("rb", 1),), 40, 44)
    ledger.reserve("licensed", (ResourceNeed("rb", 1),), 40, 44)
    assert len(ledger.reservations) == 2
    assert ledger._capacity_at("rb", 41) == 2
    assert not ledger.reservation_risks()


def test_unlicensed_increment_cannot_use_the_extra_unit():
    ledger = _ledger()
    with pytest.raises(CapacityBlocked, match="CAPABILITY_FUTURE_WORK_NOT_OWNER_AUTHORIZED"):
        ledger.reserve("unlicensed", (ResourceNeed("rb", 2),), 40, 44)


def test_baseline_and_granted_work_cannot_overbook_total_capacity():
    ledger = _ledger()
    ledger.reserve("baseline", (ResourceNeed("rb", 1),), 40, 44)
    with pytest.raises(CapacityBlocked, match="RESOURCE_CAPACITY_EXCEEDED"):
        ledger.reserve("licensed", (ResourceNeed("rb", 2),), 40, 44)
    assert len(ledger.reservations) == 1


def test_owner_future_capacity_requires_explicit_source_scope():
    """An owner-declared source without DERIVE / capability purpose is not a grant."""
    d = capability_case()
    own = next(s for s in d["context_evidence"]["sources"]
               if s["id"] == "b-capacity")
    for key in ("core", "purposes", "operations", "valid_from"):
        own.pop(key)
    out = simulate(d)
    adoption = next(row for row in out["trace"] if row["action"] == "adopt_capability")
    assert adoption["outcome"] == "BLOCKED"
    assert adoption["reason"] == "CAPABILITY_OWNER_EXPLICIT_PURPOSE_SCOPE_REQUIRED"
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_owner_wrong_purpose_does_not_authorize_extra_capacity():
    d = capability_case()
    own = next(s for s in d["context_evidence"]["sources"]
               if s["id"] == "b-capacity")
    own["purposes"] = ["quality-verification"]
    out = simulate(d)
    adoption = next(row for row in out["trace"] if row["action"] == "adopt_capability")
    assert adoption["outcome"] == "BLOCKED"
    assert adoption["reason"] == "CAPABILITY_SOURCE_SCOPE_NOT_QUALIFIED"


def test_no_change_to_original_legacy_model_without_optional_capability():
    d = capability_case()
    d.pop("capability_adoptions")
    d["events"] = [e for e in d["events"] if e["action"] != "adopt_capability"]
    original = simulate(d)
    assert "capability_dynamics" not in original
    assert original["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert simulate(deepcopy(d)) == original
