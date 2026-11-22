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


def test_interfirm_original_knowledge_requires_explicit_source_scope():
    from .test_competence_transfer_mesa import interfirm_case
    d = interfirm_case()
    source = next(x for x in d["context_evidence"]["sources"]
                  if x["id"] == "license-a")
    for k in ("core", "purposes", "operations", "valid_from"):
        source.pop(k)
    out = simulate(d)
    claim = out["competence_reuse_dynamics"]["links"][0]
    assert "REUSE_PERMISSION_EXPLICIT_SOURCE_SCOPE_REQUIRED" in claim["unqualified_reasons"]
    assert claim["declared_metric_change_favourable_positive"] is None
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_measurement_quality_source_requires_explicit_purpose():
    from .test_competence_measurement_mesa import measurement_case
    d = measurement_case()
    source = next(x for x in d["context_evidence"]["sources"]
                  if x["id"] == "quality-protocol-c")
    for k in ("core", "purposes", "operations", "valid_from"):
        source.pop(k)
    out = simulate(d)
    result = out["competence_reuse_dynamics"]["declared_measurement_protocols"]["protocols"][0]
    assert "MEASUREMENT_EXPLICIT_SOURCE_SCOPE_REQUIRED" in result["model_scope_reasons"]
    assert result["declared_favourable_metric_difference"] is None
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_source_update_with_expected_revision_cannot_overwrite_newer_owner_evidence():
    """Concurrent/replayed owner messages require compare-and-set when supplied."""
    d = capability_case()
    d["events"] += [
        {"at": 34, "action": "source_update", "actor": "b",
         "source": "b-capacity", "status": "CONFIRMED",
         "expected_revision": "bc1", "new_revision": "bc2"},
        {"at": 35, "action": "source_update", "actor": "b",
         "source": "b-capacity", "status": "UNKNOWN",
         "expected_revision": "bc1", "new_revision": "bc3"},
    ]
    out = simulate(d)
    first, stale = [e for e in out["trace"]
                    if e["action"] == "source_update" and e["at"] in (34, 35)]
    assert first["outcome"] == "APPLIED"
    assert stale["outcome"] == "BLOCKED"
    assert stale["reason"] == "CONTEXT_STALE_SOURCE_UPDATE_REVISION"
    assert out["context_basis"]["sources"]["b-capacity"]["revision"] == "bc2"
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_unassigned_common_operator_cash_blocks_work_counterfactual():
    """Model must not declare a complete Work economy while common cash is omitted."""
    from .test_work_counterfactual_mesa import counterfactual_case
    d = counterfactual_case()
    d["economic_claims"]["transfers"].append({
        "id": "unallocated-operator-platform-fee", "scenario": "COOPERATION",
        "payer": "op", "payee": "EXTERNAL", "amount": "12.00",
        "source": "o1", "work": None,
    })
    out = simulate(d)
    work = out["work_counterfactual_dynamics"]["works"][0]
    assert work["status"] == "COUNTERFACTUAL_WORK_SCOPE_NOT_QUALIFIED"
    assert work["network_declared_external_cash_difference"] is None
    op = work["per_scenario"]["COOPERATION"]["owners"]["op"]
    assert "COMMON_CASH_FLOW_NOT_ATTRIBUTED_TO_WORK" in op["reasons"]
    assert op["unallocated_common_cash_count"] == 1
    assert out["economics"]["consolidated_cash_difference_claimed_scope"] is not None
    assert out["economics"]["profit"] == "UNKNOWN"


def test_owner_scoped_increment_property_over_small_capacity_grid():
    """Exhaustive small-state property: baseline uses ordinary units, not grant."""
    for baseline_ceiling in range(1, 5):
        for increment in range(1, 4):
            claimed_total = baseline_ceiling + increment
            for baseline_use in range(baseline_ceiling + 1):
                for permitted_use in range(1, claimed_total + 2):
                    ledger = _ledger(capacity=baseline_ceiling, future=claimed_total)
                    if baseline_use:
                        ledger.reserve("baseline", (ResourceNeed("rb", baseline_use),), 40, 44)
                    expected_allowed = baseline_use + permitted_use <= claimed_total
                    try:
                        ledger.reserve("licensed", (ResourceNeed("rb", permitted_use),), 40, 44)
                        actual_allowed = True
                    except CapacityBlocked as exc:
                        actual_allowed = False
                        assert exc.reason == "RESOURCE_CAPACITY_EXCEEDED"
                    assert actual_allowed == expected_allowed, (
                        baseline_ceiling, increment, baseline_use, permitted_use,
                    )
