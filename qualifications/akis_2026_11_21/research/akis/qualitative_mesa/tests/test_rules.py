"""Deterministic scientific logic checks; no fabricated economic parameters."""

from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS


def fixture(mode="SOLE", *, reserve=()):
    return {
        "schema": "IWXA_AKIS_QUALITATIVE_INPUT/0.1", "evidence": "MODEL_ONLY",
        "institution": {
            "operator": "op", "founders": ["op", "a", "b"], "mode": mode, "revision": "oc-1",
            "council_members": ["a", "b"], "council_quorum": 2,
            "council_rule": "UNANIMOUS", "operator_mandate": ["authorize", "exclude"], "mixed_reserved": list(reserve),
        },
        "subjects": [{"id": "op", "kind": "OPERATOR"}, {"id": "a", "kind": "SME"}, {"id": "b", "kind": "SME"}],
        "resources": [{"id": "ra", "owner": "a"}],
        "works": [{"id": "w1", "customer": "b", "resource": "ra", "source_revision": "d-1", "slot_start": 7, "slot_end": 11}],
        "events": [],
    }


def apply(state, action, at, actor, **kw):
    return state.apply({"action": action, "actor": actor, **kw}, at)


def progress_to_commit(state):
    apply(state, "offer", 1, "op", work="w1")
    apply(state, "authorize", 2, "op", work="w1")
    apply(state, "consent", 3, "a", work="w1", source_revision="d-1", org_revision="oc-1")
    apply(state, "consent", 4, "b", work="w1", source_revision="d-1", org_revision="oc-1")
    return apply(state, "commit", 5, "op", work="w1")


def test_authority_and_per_original_acceptance():
    model = QualitativeAKIS(fixture())
    assert apply(model, "offer", 1, "op", work="w1")["outcome"] == "APPLIED"
    assert apply(model, "authorize", 2, "a", work="w1")["reason"] == "OPERATOR_MANDATE_REQUIRED"
    assert apply(model, "authorize", 3, "op", work="w1")["outcome"] == "APPLIED"
    assert apply(model, "commit", 4, "op", work="w1", accepted_by=["a", "b"])["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"
    assert apply(model, "consent", 5, "a", work="w1", source_revision="d-1", org_revision="oc-1")["outcome"] == "APPLIED"
    assert apply(model, "consent", 6, "b", work="w1", source_revision="d-1", org_revision="oc-1")["outcome"] == "APPLIED"
    assert apply(model, "commit", 7, "op", work="w1")["outcome"] == "APPLIED"
    assert model.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"


def test_collegial_quorum_and_vote_are_real_conditions():
    model = QualitativeAKIS(fixture("COLLEGIAL"))
    apply(model, "offer", 1, "op", work="w1")
    assert apply(model, "authorize", 2, "COUNCIL", work="w1", votes={"a": "YES"})["reason"] == "QUORUM_NOT_MET"
    assert apply(model, "authorize", 3, "COUNCIL", work="w1", votes={"a": "YES", "b": "NO"})["reason"] == "COUNCIL_NOT_UNANIMOUS"
    assert apply(model, "authorize", 4, "COUNCIL", work="w1", votes={"a": "YES", "b": "YES"})["outcome"] == "APPLIED"


def test_mixed_requires_explicit_reserved_scope():
    model = QualitativeAKIS(fixture("MIXED", reserve=["exclude"]))
    apply(model, "offer", 1, "op", work="w1")
    assert apply(model, "authorize", 2, "op", work="w1")["outcome"] == "APPLIED"
    assert apply(model, "exclude", 3, "op", subject="a")["reason"] == "COUNCIL_DECISION_REQUIRED"
    assert apply(model, "exclude", 4, "COUNCIL", subject="a", votes={"a": "YES", "b": "YES"})["outcome"] == "APPLIED"
    assert apply(model, "commit", 5, "op", work="w1")["reason"] == "PARTICIPANT_NOT_AVAILABLE_FOR_NEW_WORK"


def test_existing_commitment_survives_exclusion_and_governance_switch():
    model = QualitativeAKIS(fixture())
    assert progress_to_commit(model)["outcome"] == "APPLIED"
    assert apply(model, "exclude", 6, "op", subject="a")["outcome"] == "APPLIED"
    assert apply(model, "change_mode", 7, "FOUNDERS", expected_revision="oc-1", new_revision="oc-2", new_mode="COLLEGIAL", authorized_by=["op", "a", "b"])["outcome"] == "APPLIED"
    assert model.works["w1"].commitment_org_revision == "oc-1"
    assert apply(model, "start", 8, "a", work="w1")["outcome"] == "APPLIED"
    assert apply(model, "complete", 9, "a", work="w1", result_ref="model://r1")["outcome"] == "APPLIED"
    assert apply(model, "accept", 10, "b", work="w1")["outcome"] == "APPLIED"
    assert model.works["w1"].result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert model.subjects["a"].active is False


def test_mode_switch_requires_all_original_code_holders():
    state = QualitativeAKIS(fixture())
    assert apply(state, "change_mode", 1, "op", expected_revision="oc-1", new_revision="oc-2", new_mode="MIXED", authorized_by=["op", "a", "b"])["reason"] == "FOUNDERS_ACTION_REQUIRED"
    assert apply(state, "change_mode", 2, "FOUNDERS", expected_revision="oc-1", new_revision="oc-2", new_mode="MIXED", authorized_by=["op", "a"])["reason"] == "ORIGINAL_CODE_OWNERS_CONSENT_REQUIRED"
    assert apply(state, "change_mode", 3, "FOUNDERS", expected_revision="oc-0", new_revision="oc-2", new_mode="MIXED", authorized_by=["op", "a", "b"])["reason"] == "STALE_ORGANIZATIONAL_CODE"
    assert state.institution.mode == "SOLE"


def test_result_separate_from_completion_and_independent_acceptance():
    state = QualitativeAKIS(fixture())
    progress_to_commit(state)
    assert apply(state, "start", 6, "a", work="w1")["outcome"] == "APPLIED"
    assert apply(state, "complete", 7, "a", work="w1", result_ref="model://r1")["outcome"] == "APPLIED"
    assert state.works["w1"].result == "SUBMITTED"
    assert apply(state, "accept", 8, "op", work="w1")["reason"] == "ORIGINAL_CUSTOMER_RESULT_DECISION_REQUIRED"
    assert apply(state, "reject", 9, "b", work="w1")["outcome"] == "APPLIED"
    assert state.works["w1"].result == "REJECTED"
    assert state.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"


def test_resource_double_booking_fails_even_with_acceptances():
    data = fixture()
    data["works"].append({"id": "w2", "customer": "b", "resource": "ra", "source_revision": "d-2", "slot_start": 9, "slot_end": 12})
    state = QualitativeAKIS(data)
    assert progress_to_commit(state)["outcome"] == "APPLIED"
    apply(state, "offer", 6, "op", work="w2")
    apply(state, "authorize", 7, "op", work="w2")
    apply(state, "consent", 8, "a", work="w2", source_revision="d-2", org_revision="oc-1")
    apply(state, "consent", 9, "b", work="w2", source_revision="d-2", org_revision="oc-1")
    assert apply(state, "commit", 10, "op", work="w2")["reason"] == "RESOURCE_ALREADY_COMMITTED"
    assert state.works["w2"].obligation == "NOT_ACCEPTED"


def test_nonoverlapping_resource_slots_allowed():
    data = fixture()
    data["works"].append({"id": "w2", "customer": "b", "resource": "ra", "source_revision": "d-2", "slot_start": 11, "slot_end": 16})
    state = QualitativeAKIS(data)
    progress_to_commit(state)
    apply(state, "offer", 6, "op", work="w2")
    apply(state, "authorize", 7, "op", work="w2")
    apply(state, "consent", 8, "a", work="w2", source_revision="d-2", org_revision="oc-1")
    apply(state, "consent", 9, "b", work="w2", source_revision="d-2", org_revision="oc-1")
    assert apply(state, "commit", 10, "op", work="w2")["outcome"] == "APPLIED"


def test_no_automatic_profit_or_fabricated_evidence():
    state = QualitativeAKIS(fixture())
    progress_to_commit(state)
    apply(state, "start", 6, "a", work="w1")
    assert apply(state, "complete", 7, "a", work="w1", result_ref="real-bank-id")["reason"] == "MODEL_ONLY_EVIDENCE_REQUIRED"
    result = state.snapshot()
    assert result["evidence"] == "MODEL_ONLY"
    assert set(result["profit"].values()) == {"UNKNOWN"}


def test_independent_resource_distribution_not_equated_with_governance():
    for mode in ("SOLE", "COLLEGIAL", "MIXED"):
        state = QualitativeAKIS(fixture(mode, reserve=["exclude"] if mode == "MIXED" else ()))
        assert state.resources == {"ra": "a"}
        assert state.institution.operator == "op"
        assert state.snapshot()["institution"]["resource_distribution_is_distinct"] is True


def test_invalid_inputs_are_not_silently_accepted():
    bad = fixture()
    bad["events"] = [{"at": 1, "action": "offer", "actor": "op"}, {"at": 1, "action": "authorize", "actor": "op"}]
    with pytest.raises(InputError):
        QualitativeAKIS(bad)
    bad2 = fixture()
    bad2["works"][0]["slot_end"] = 7
    with pytest.raises(InputError):
        QualitativeAKIS(bad2)
    bad3 = fixture()
    bad3["evidence"] = "OBSERVED_WITH_ORIGINAL_EVIDENCE"
    with pytest.raises(InputError):
        QualitativeAKIS(bad3)


def test_trace_and_model_only_audit_are_deterministic():
    state1 = QualitativeAKIS(fixture())
    state2 = QualitativeAKIS(deepcopy(fixture()))
    for state in (state1, state2):
        progress_to_commit(state)
    assert state1.snapshot() == state2.snapshot()
    assert state1.snapshot()["counts"]["applied"] == 5


def test_council_majority_requires_true_majority_and_quorum():
    data = fixture("COLLEGIAL")
    data["institution"]["council_members"] = ["op", "a", "b"]
    data["institution"]["council_quorum"] = 3
    data["institution"]["council_rule"] = "MAJORITY"
    state = QualitativeAKIS(data)
    apply(state, "offer", 1, "op", work="w1")
    assert apply(state, "authorize", 2, "COUNCIL", work="w1", votes={"op": "YES", "a": "NO", "b": "NO"})["reason"] == "COUNCIL_MAJORITY_NOT_MET"
    assert apply(state, "authorize", 3, "COUNCIL", work="w1", votes={"op": "YES", "a": "YES", "b": "NO"})["outcome"] == "APPLIED"


def test_model_no_event_has_known_empty_state():
    state = QualitativeAKIS(fixture())
    assert state.snapshot()["trace"] == []
    assert state.snapshot()["works"]["w1"]["result"] == "NOT_SUBMITTED"


def test_principal_cannot_delegate_own_consent_to_unsupported_actor():
    state = QualitativeAKIS(fixture())
    apply(state, "offer", 1, "op", work="w1")
    apply(state, "authorize", 2, "op", work="w1")
    assert apply(state, "consent", 3, "op", work="w1", source_revision="d-1", org_revision="oc-1")["reason"] == "NOT_AN_ORIGINAL_OBLIGATION_OWNER"
    assert apply(state, "consent", 4, "a", work="w1", source_revision="d-old", org_revision="oc-1")["reason"] == "STALE_CONSENT_SOURCE_OR_ORG_CODE"
    assert apply(state, "commit", 5, "op", work="w1")["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"


def test_mode_change_invalidates_pending_admission_and_consents():
    data = fixture()
    data["works"].append({"id": "w2", "customer": "b", "resource": "ra", "source_revision": "d-2", "slot_start": 12, "slot_end": 15})
    state = QualitativeAKIS(data)
    progress_to_commit(state)
    apply(state, "offer", 6, "op", work="w2")
    apply(state, "authorize", 7, "op", work="w2")
    apply(state, "consent", 8, "a", work="w2", source_revision="d-2", org_revision="oc-1")
    assert apply(state, "change_mode", 9, "FOUNDERS", expected_revision="oc-1", new_revision="oc-2", new_mode="COLLEGIAL", authorized_by=["op", "a", "b"])["outcome"] == "APPLIED"
    assert state.works["w1"].obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert state.works["w1"].commitment_org_revision == "oc-1"
    assert state.works["w2"].consents == {}
    assert state.works["w2"].admitted is False
    assert state.works["w2"].authorization_org_revision is None
    assert apply(state, "commit", 10, "op", work="w2")["reason"] == "NO_AUTHORIZED_UNCOMMITTED_PROPOSAL"


def test_repeated_acceptance_and_forged_approval_cannot_advance_result():
    state = QualitativeAKIS(fixture())
    assert progress_to_commit(state)["outcome"] == "APPLIED"
    assert apply(state, "accept", 6, "b", work="w1")["reason"] == "ORIGINAL_CUSTOMER_RESULT_DECISION_REQUIRED"
    apply(state, "start", 7, "a", work="w1")
    apply(state, "complete", 8, "a", work="w1", result_ref="model://r2")
    assert apply(state, "accept", 9, "b", work="w1")["outcome"] == "APPLIED"
    assert apply(state, "accept", 10, "b", work="w1")["reason"] == "ORIGINAL_CUSTOMER_RESULT_DECISION_REQUIRED"


def test_operator_mandate_must_be_explicit_even_when_sole():
    data = fixture()
    data["institution"]["operator_mandate"] = ["authorize"]
    state = QualitativeAKIS(data)
    assert apply(state, "exclude", 1, "op", subject="a")["reason"] == "EXPLICIT_OPERATOR_MANDATE_MISSING"
    assert state.subjects["a"].active is True


def test_mixed_governance_without_explicit_scope_refused():
    with pytest.raises(InputError):
        QualitativeAKIS(fixture("MIXED"))
