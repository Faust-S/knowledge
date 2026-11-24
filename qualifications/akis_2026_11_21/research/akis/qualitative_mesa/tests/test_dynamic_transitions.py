"""Qualitative dynamics of one operator AKIS: needs, resources, and valid authority.

All input states are MODEL_ONLY claims. Tests do not imply measured business effects.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from .test_rules import apply, fixture, progress_to_commit


def test_new_customer_need_appears_during_run_without_creating_obligation():
    data = fixture()
    spec = deepcopy(data["works"][0])
    data["works"] = []
    state = QualitativeAKIS(data)
    assert state.works == {}
    assert apply(state, "request", 1, "op", work_spec=spec)["reason"] == "ORIGINAL_CUSTOMER_REQUEST_REQUIRED"
    assert state.works == {}
    assert apply(state, "request", 2, "b", work_spec=spec)["outcome"] == "APPLIED"
    work = state.works["w1"]
    assert work.proposal == "REQUESTED"
    assert work.requester == "b" and work.request_at == 2
    assert work.obligation == "NOT_ACCEPTED"
    assert state.allocations == []
    assert apply(state, "request", 3, "b", work_spec=spec)["reason"] == "WORK_ALREADY_EXISTS"
    assert apply(state, "offer", 4, "op", work="w1")["outcome"] == "APPLIED"
    assert state.works["w1"].proposal == "OFFERED"
    assert state.works["w1"].obligation == "NOT_ACCEPTED"


def test_unselected_governance_blocks_authority_until_explicit_code_change():
    data = fixture("UNSELECTED")
    state = QualitativeAKIS(data)
    assert apply(state, "offer", 1, "op", work="w1")["outcome"] == "APPLIED"
    assert apply(state, "authorize", 2, "op", work="w1")["reason"] == "MODE_NOT_SELECTED"
    assert apply(state, "exclude", 3, "op", subject="a")["reason"] == "MODE_NOT_SELECTED"
    assert state.subjects["a"].active
    assert not state.works["w1"].admitted
    assert apply(state, "change_mode", 4, "FOUNDERS", expected_revision="oc-1", new_revision="oc-2", new_mode="SOLE", authorized_by=["op", "a", "b"])["outcome"] == "APPLIED"
    assert apply(state, "authorize", 5, "op", work="w1")["outcome"] == "APPLIED"
    assert state.works["w1"].authorization_org_revision == "oc-2"


def test_mode_change_requires_reauthorization_before_new_consents():
    state = QualitativeAKIS(fixture())
    assert apply(state, "offer", 1, "op", work="w1")["outcome"] == "APPLIED"
    assert apply(state, "authorize", 2, "op", work="w1")["outcome"] == "APPLIED"
    assert apply(state, "consent", 3, "a", work="w1", source_revision="d-1", org_revision="oc-1")["outcome"] == "APPLIED"
    assert apply(state, "change_mode", 4, "FOUNDERS", expected_revision="oc-1", new_revision="oc-2", new_mode="COLLEGIAL", authorized_by=["op", "a", "b"])["outcome"] == "APPLIED"
    assert not state.works["w1"].admitted
    assert state.works["w1"].authorization_org_revision is None
    assert state.works["w1"].consents == {}
    assert apply(state, "consent", 5, "b", work="w1", source_revision="d-1", org_revision="oc-2")["reason"] == "CONSENT_REQUIRES_AUTHORIZED_PROPOSAL"
    assert apply(state, "commit", 6, "op", work="w1")["reason"] == "NO_AUTHORIZED_UNCOMMITTED_PROPOSAL"
    assert apply(state, "authorize", 7, "COUNCIL", work="w1", votes={"a": "YES", "b": "YES"})["outcome"] == "APPLIED"
    assert apply(state, "consent", 8, "a", work="w1", source_revision="d-1", org_revision="oc-2")["outcome"] == "APPLIED"
    assert apply(state, "consent", 9, "b", work="w1", source_revision="d-1", org_revision="oc-2")["outcome"] == "APPLIED"
    assert apply(state, "commit", 10, "op", work="w1")["outcome"] == "APPLIED"
    assert state.works["w1"].commitment_org_revision == "oc-2"


def test_unknown_resource_requires_new_owner_statement_without_erasing_offer():
    data = fixture()
    data["resources"][0]["availability"] = "UNKNOWN"
    state = QualitativeAKIS(data)
    assert progress_to_commit(state)["reason"] == "RESOURCE_READINESS_UNKNOWN"
    assert state.works["w1"].obligation == "NOT_ACCEPTED"
    assert apply(state, "resource_status", 6, "op", resource="ra", availability="AVAILABLE")["reason"] == "RESOURCE_OWNER_REQUIRED"
    assert apply(state, "resource_status", 7, "a", resource="ra", availability="AVAILABLE")["outcome"] == "APPLIED"
    assert apply(state, "commit", 8, "op", work="w1")["outcome"] == "APPLIED"
    assert apply(state, "resource_status", 9, "a", resource="ra", availability="UNAVAILABLE")["outcome"] == "APPLIED"
    assert apply(state, "start", 10, "a", work="w1")["reason"] == "RESOURCE_NOT_AVAILABLE"
    assert state.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert state.works["w1"].execution == "NOT_STARTED"
    assert apply(state, "resource_status", 11, "a", resource="ra", availability="AVAILABLE")["outcome"] == "APPLIED"
    assert apply(state, "start", 12, "a", work="w1")["outcome"] == "APPLIED"
    assert state.snapshot()["resources"]["ra"]["basis"] == "MODEL_EVENT"


def test_invalid_resource_availability_is_not_accepted_as_evidence():
    data = fixture()
    data["resources"][0]["availability"] = "INFERRED_AVAILABLE"
    with pytest.raises(InputError, match="INVALID_RESOURCE_AVAILABILITY"):
        QualitativeAKIS(data)
    state = QualitativeAKIS(fixture())
    assert apply(state, "resource_status", 1, "a", resource="ra", availability="INFERRED_AVAILABLE")["reason"] == "INVALID_RESOURCE_STATUS"
    assert state.resource_availability["ra"] == "AVAILABLE"
    assert state.snapshot()["resources"]["ra"]["basis"] == "LEGACY_FIXTURE_DEFAULT"


def test_new_request_is_run_by_real_mesa_scheduler_when_installed():
    pytest.importorskip("mesa", reason="Native Mesa not available: not a CI PASS")
    from research.akis.qualitative_mesa.mesa_model import simulate

    data = fixture()
    spec = deepcopy(data["works"][0])
    data["works"] = []
    data["events"] = [
        {"at": 1, "action": "request", "actor": "b", "work_spec": spec},
        {"at": 2, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 3, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 4, "action": "consent", "actor": "a", "work": "w1", "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 5, "action": "consent", "actor": "b", "work": "w1", "source_revision": "d-1", "org_revision": "oc-1"},
        {"at": 6, "action": "commit", "actor": "op", "work": "w1"},
        {"at": 7, "action": "start", "actor": "a", "work": "w1"},
        {"at": 8, "action": "complete", "actor": "a", "work": "w1", "result_ref": "model://arrival"},
        {"at": 9, "action": "accept", "actor": "b", "work": "w1"},
    ]
    result = simulate(data)
    assert result["counts"] == {"applied": 9, "blocked": 0}
    assert result["works"]["w1"]["requested_at"] == 1
    assert result["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["evidence"] == "MODEL_ONLY"
    assert set(result["profit"].values()) == {"UNKNOWN"}
    assert result["trace"][0]["actor"] == "b"
    assert result["trace"][0]["work"] == "w1"
    assert result["trace"][0]["prior_org_revision"] == "oc-1"


def test_native_repeated_resource_interruption_fixture_when_mesa_installed():
    pytest.importorskip("mesa", reason="Native Mesa not available: not a CI PASS")
    from pathlib import Path
    from research.akis.qualitative_mesa.mesa_model import run_file

    example = Path(__file__).resolve().parents[1] / "fixtures" / "dynamic_need_and_resource_hold.json"
    result = run_file(example)
    assert result["counts"] == {"applied": 12, "blocked": 2}
    assert [row["reason"] for row in result["trace"] if row["outcome"] == "BLOCKED"] == [
        "RESOURCE_READINESS_UNKNOWN", "RESOURCE_NOT_AVAILABLE"
    ]
    assert result["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["resources"]["ra"]["availability"] == "AVAILABLE"
    assert set(result["profit"].values()) == {"UNKNOWN"}


def test_new_demand_cannot_double_allocate_resource_after_restoration():
    data = fixture()
    data["resources"][0]["availability"] = "AVAILABLE"
    state = QualitativeAKIS(data)
    assert progress_to_commit(state)["outcome"] == "APPLIED"
    spec = {
        "id": "w2", "customer": "b", "resource": "ra",
        "source_revision": "d-2", "slot_start": 9, "slot_end": 12,
    }
    assert apply(state, "request", 6, "b", work_spec=spec)["outcome"] == "APPLIED"
    assert apply(state, "offer", 7, "op", work="w2")["outcome"] == "APPLIED"
    assert apply(state, "authorize", 8, "op", work="w2")["outcome"] == "APPLIED"
    assert apply(state, "consent", 9, "a", work="w2", source_revision="d-2", org_revision="oc-1")["outcome"] == "APPLIED"
    assert apply(state, "consent", 10, "b", work="w2", source_revision="d-2", org_revision="oc-1")["outcome"] == "APPLIED"
    assert apply(state, "resource_status", 11, "a", resource="ra", availability="UNAVAILABLE")["outcome"] == "APPLIED"
    assert apply(state, "commit", 12, "op", work="w2")["reason"] == "RESOURCE_NOT_AVAILABLE"
    assert apply(state, "resource_status", 13, "a", resource="ra", availability="AVAILABLE")["outcome"] == "APPLIED"
    assert apply(state, "commit", 14, "op", work="w2")["reason"] == "RESOURCE_ALREADY_COMMITTED"
    assert state.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert state.works["w2"].obligation == "NOT_ACCEPTED"
    assert len(state.allocations) == 1


def test_invalid_research_mode_and_resource_objects_fail_as_inputs():
    data = fixture()
    data["institution"]["mode"] = []
    with pytest.raises(InputError, match="INVALID_GOVERNANCE"):
        QualitativeAKIS(data)
    data2 = fixture()
    data2["resources"][0]["availability"] = []
    with pytest.raises(InputError, match="INVALID_RESOURCE_AVAILABILITY"):
        QualitativeAKIS(data2)
    data3 = fixture()
    data3["works"] = []
    data3["events"] = [
        {"at": 1, "action": "request", "actor": "b", "work_spec": {"id": "w2"}}
    ]
    with pytest.raises(InputError, match="WORK_MISSING"):
        QualitativeAKIS(data3)
