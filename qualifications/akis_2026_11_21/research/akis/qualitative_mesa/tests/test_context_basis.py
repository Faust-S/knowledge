"""Evidence permissions and uncertainty never create a contract or authentic signature."""
from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.context_basis import ContextBasis, ContextBlocked, ContextInputError


SUBJECTS = {"op": SimpleNamespace(), "a": SimpleNamespace(), "b": SimpleNamespace()}


def source(name="d1", *, owner="b", status="CONFIRMED", revision="r1", allowed=None, until=None):
    x = {"id": name, "owner": owner, "revision": revision, "status": status,
         "usable_by": allowed if allowed is not None else ["op", "a", "b"]}
    if until is not None:
        x["valid_until"] = until
    return x


def fixture(*, strict=True, sources=None, requirements=None):
    return {"strict": strict,
            "sources": sources if sources is not None else [source()],
            "requirements": requirements if requirements is not None else [
                {"work": "w1", "action": "commit", "sources": ["d1"], "expected_revisions": ["r1"]}
            ]}


def state(data=None):
    return ContextBasis(fixture() if data is None else data, SUBJECTS, {"w1", "w2"})


def decision(data=None, *, work="w1", action="commit", actor="op", at=5):
    s = state(data)
    s.assert_allowed(work, action, actor, at)
    return s


def blocked_reason(data=None, **kw):
    with pytest.raises(ContextBlocked) as e:
        decision(data, **kw)
    return e.value.reason


def test_confirmed_usable_current_source_allows_only_declared_simulation_step():
    s = decision()
    snapshot = s.snapshot()
    assert snapshot["evidence"] == "MODEL_ONLY"
    assert snapshot["authenticated_documents"] is False
    assert snapshot["sources"]["d1"]["status"] == "CONFIRMED"


def test_strict_missing_requirement_denies_and_compatible_mode_does_not_require_all():
    assert blocked_reason(action="start") == "CONTEXT_REQUIREMENT_MISSING"
    loose = fixture(strict=False)
    decision(loose, action="start")
    assert blocked_reason(loose, actor="not-granted") == "CONTEXT_USE_NOT_PERMITTED"


@pytest.mark.parametrize("status,reason", [
    ("UNKNOWN", "CONTEXT_SOURCE_UNKNOWN"),
    ("DISPROVED", "CONTEXT_SOURCE_DISPROVED"),
    ("CONFIRMED", None),
])
def test_tristate_epistemic_conditions(status, reason):
    f = fixture(sources=[source(status=status)])
    if reason:
        assert blocked_reason(f) == reason
    else:
        decision(f)


def test_conflicting_sources_do_not_yield_a_majority_vote_or_automatic_truth():
    f = fixture(sources=[source(), source("d2", status="DISPROVED")], requirements=[
        {"work": "w1", "action": "commit", "sources": ["d1", "d2"], "expected_revisions": ["r1", "r1"]}
    ])
    assert blocked_reason(f) == "CONTEXT_CONTRADICTORY_ORIGINALS"
    f["sources"][1]["status"] = "UNKNOWN"
    assert blocked_reason(f) == "CONTEXT_SOURCE_UNKNOWN"


def test_source_use_does_not_follow_from_ownership_or_membership():
    f = fixture(sources=[source(allowed=["a"])])
    assert blocked_reason(f, actor="op") == "CONTEXT_USE_NOT_PERMITTED"
    decision(f, actor="a")


def test_source_version_and_expiration_are_distinct_blockers():
    f = fixture(sources=[source(revision="r2")])
    assert blocked_reason(f) == "CONTEXT_REVISION_STALE"
    f["sources"][0]["revision"] = "r1"
    f["sources"][0]["valid_until"] = 4
    assert blocked_reason(f, at=5) == "CONTEXT_SOURCE_EXPIRED"
    decision(f, at=4)


def test_revocation_and_reconfirmation_are_not_retroactive_acceptances():
    s = state()
    s.assert_allowed("w1", "commit", "op", 1)
    s.owner_update({"source": "d1", "actor": "b", "status": "UNKNOWN"})
    with pytest.raises(ContextBlocked, match="CONTEXT_SOURCE_UNKNOWN"):
        s.assert_allowed("w1", "commit", "op", 2)
    s.owner_update({"source": "d1", "actor": "b", "status": "CONFIRMED"})
    s.assert_allowed("w1", "commit", "op", 3)


def test_change_revision_invalidates_old_requirement_until_an_explicit_new_one():
    s = state()
    s.owner_update({"source": "d1", "actor": "b", "status": "CONFIRMED", "new_revision": "r2"})
    with pytest.raises(ContextBlocked, match="CONTEXT_REVISION_STALE"):
        s.assert_allowed("w1", "commit", "op", 2)


def test_unrelated_actor_cannot_revoke_or_expand_use_of_others_originals():
    s = state()
    old = deepcopy(s.snapshot())
    with pytest.raises(ContextBlocked, match="CONTEXT_SOURCE_OWNER_REQUIRED"):
        s.owner_update({"source": "d1", "actor": "op", "status": "DISPROVED", "usable_by": ["op"]})
    assert s.snapshot() == old


def test_owner_can_narrow_future_usage_without_deleting_previous_result():
    s = state()
    s.owner_update({"source": "d1", "actor": "b", "status": "CONFIRMED", "usable_by": ["a", "b"]})
    with pytest.raises(ContextBlocked, match="CONTEXT_USE_NOT_PERMITTED"):
        s.assert_allowed("w1", "commit", "op", 4)
    s.assert_allowed("w1", "commit", "a", 4)


@pytest.mark.parametrize("change,code", [
    ({"strict": 1}, "INVALID_CONTEXT_STRICT"),
    ({"sources": "not-list"}, "INVALID_CONTEXT_SOURCE_COUNT"),
    ({"requirements": None}, "INVALID_CONTEXT_REQUIREMENT_COUNT"),
    ({"sources": [source(), source()]}, "INVALID_CONTEXT_OWNER_OR_DUPLICATE_SOURCE"),
    ({"sources": [source(owner="c")]}, "INVALID_CONTEXT_OWNER_OR_DUPLICATE_SOURCE"),
    ({"sources": [source(status="ASSUMED") ]}, "INVALID_CONTEXT_STATUS"),
    ({"sources": [source(allowed=["c"]) ]}, "UNKNOWN_CONTEXT_RECIPIENT"),
    ({"sources": [source(allowed=["a", "a"]) ]}, "INVALID_CONTEXT_RECIPIENTS"),
    ({"sources": [source(until=-1)]}, "INVALID_CONTEXT_VALID_UNTIL"),
    ({"requirements": [{"work": "missing", "action": "commit", "sources": ["d1"], "expected_revisions": ["r1"]}]}, "UNKNOWN_CONTEXT_WORK_OR_ACTION"),
    ({"requirements": [{"work": "w1", "action": "commit", "sources": ["x"], "expected_revisions": ["r1"]}]}, "INVALID_CONTEXT_REFERENCE"),
    ({"requirements": [{"work": "w1", "action": "commit", "sources": ["d1"], "expected_revisions": []}]}, "INVALID_CONTEXT_EXPECTED_REVISION"),
])
def test_structural_rejection_is_not_misreported_as_blocked_action(change, code):
    f = fixture()
    f.update(change)
    with pytest.raises(ContextInputError, match=code):
        state(f)


def test_invalid_owner_update_cannot_partially_mutate_evidence():
    s = state()
    before = deepcopy(s.snapshot())
    with pytest.raises(ContextBlocked, match="UNKNOWN_CONTEXT_RECIPIENT"):
        s.owner_update({"source": "d1", "actor": "b", "status": "DISPROVED", "usable_by": ["missing"]})
    assert s.snapshot() == before


def test_status_update_affected_only_explicit_source_references():
    f = fixture(requirements=[
        {"work": "w1", "action": "commit", "sources": ["d1"], "expected_revisions": ["r1"]},
        {"work": "w2", "action": "start", "sources": ["d1"], "expected_revisions": ["r1"]},
    ])
    assert state(f).affected_works("d1") == ["w1", "w2"]
    assert state(f).affected_works("missing") == []


def test_positive_interest_does_not_override_missing_source_permissions():
    from .test_participant_response import environment, position
    from research.akis.qualitative_mesa.participant_response import assess_principal, parse_profiles

    original = environment()
    original.trace = [{"at": 5}]
    raw = fixture(sources=[source(allowed=["op", "b"])], requirements=[
        {"work": "w1", "action": "consent", "sources": ["d1"], "expected_revisions": ["r1"]}
    ])
    original.context_basis = state(raw)
    profiles = parse_profiles([position()], original.subjects)
    assert assess_principal(original, profiles, "a", "w1")["assessment"] == "CONTEXT_USE_NOT_PERMITTED"
    original.context_basis.owner_update({"source": "d1", "actor": "b", "status": "CONFIRMED", "usable_by": ["a", "b"]})
    assert assess_principal(original, profiles, "a", "w1")["assessment"] == "REVIEWABLE_NOT_CONSENTED"
    assert assess_principal(original, profiles, "a", "w1")["effect"] == "NO_AUTOMATIC_CONSENT"


def test_kpb_blocking_causes_nonbinding_organizational_inquiry_not_new_rights():
    from research.akis.qualitative_mesa.portfolio import review_cues
    from research.akis.qualitative_mesa.adaptation_review import inquiry_from_applied_event

    blocked = {"at": 12, "action": "commit", "outcome": "BLOCKED", "reason": "CONTEXT_CONTRADICTORY_ORIGINALS",
               "org_revision": "oc-1", "work": "w1", "resource": "ra"}
    update = {"at": 13, "action": "source_update", "outcome": "APPLIED", "reason": "NONE",
              "org_revision": "oc-1", "work": None, "resource": None, "source": "d1"}
    cues = review_cues([blocked, update])
    assert [r["signal"] for r in cues] == ["KPB_CONFLICT_REVIEW", "KPB_SOURCE_CHANGE_RECORDED"]
    inquiry = inquiry_from_applied_event(blocked)
    assert inquiry["decision"] == "INQUIRY_ONLY_NOT_PROPOSAL"
    assert inquiry["causal_attribution"] == "NOT_IDENTIFIABLE"


def test_explicit_null_context_policy_is_invalid_not_legacy_compatibility():
    with pytest.raises(ContextInputError, match="INVALID_CONTEXT_BASIS"):
        state({})
    with pytest.raises(ContextInputError, match="INVALID_CONTEXT_BASIS"):
        ContextBasis(None, SUBJECTS, {"w1"})


def scoped_source(*, from_at=2, until=9, core="corporate", purpose="fulfill-w1",
                  operation="ACCEPT", owner="b", recipient="op"):
    raw = source(owner=owner, allowed=[recipient], until=until)
    raw.update(core=core, purposes=[purpose], operations=[operation], valid_from=from_at)
    return raw


def scoped_requirement(*, core="corporate", purpose="fulfill-w1", operation="ACCEPT"):
    return {"work": "w1", "action": "commit", "sources": ["d1"],
            "expected_revisions": ["r1"], "core": core,
            "purpose": purpose, "operation": operation}


def test_four_core_scope_is_checked_by_original_context_basis_before_work_action():
    f = fixture(sources=[scoped_source()], requirements=[scoped_requirement()])
    s = state(f)
    with pytest.raises(ContextBlocked, match="CONTEXT_SOURCE_NOT_YET_AVAILABLE"):
        s.assert_allowed("w1", "commit", "op", 1)
    s.assert_allowed("w1", "commit", "op", 2)
    with pytest.raises(ContextBlocked, match="CONTEXT_SOURCE_EXPIRED"):
        s.assert_allowed("w1", "commit", "op", 10)
    snap = s.snapshot()
    assert snap["sources"]["d1"]["core"] == "corporate"
    assert snap["sources"]["d1"]["purposes"] == ["fulfill-w1"]
    assert snap["requirements"][0]["operation"] == "ACCEPT"
    assert snap["authenticated_documents"] is False


@pytest.mark.parametrize("core,purpose,operation,reason", [
    ("personal", "fulfill-w1", "ACCEPT", "CONTEXT_CORE_MISMATCH"),
    ("corporate", "advertise-another-customer", "ACCEPT", "CONTEXT_PURPOSE_NOT_PERMITTED"),
])
def test_original_scoped_requirement_never_gains_context_from_broad_recipient_list(
        core, purpose, operation, reason):
    f = fixture(sources=[scoped_source()],
                requirements=[scoped_requirement(core=core, purpose=purpose, operation=operation)])
    assert blocked_reason(f, at=4) == reason


def test_read_or_derive_scope_cannot_authorize_an_original_commit():
    f = fixture(sources=[scoped_source(operation="READ")],
                requirements=[scoped_requirement(operation="READ")])
    with pytest.raises(ContextInputError, match="CONTEXT_ACTION_OPERATION_MISMATCH"):
        state(f)


def test_scoped_source_cannot_be_used_by_unscoped_old_requirement():
    f = fixture(sources=[scoped_source()])
    assert blocked_reason(f, at=4) == "CONTEXT_REQUIREMENT_SCOPE_MISSING"
    assert decision()  # legacy unscoped original data stays compatible


def test_later_original_owner_revocation_changes_only_future_scope_evaluations():
    f = fixture(sources=[scoped_source(from_at=0)],
                requirements=[scoped_requirement()])
    s = state(f)
    s.assert_allowed("w1", "commit", "op", 2)
    s.owner_update({"source": "d1", "actor": "b", "status": "UNKNOWN"})
    with pytest.raises(ContextBlocked, match="CONTEXT_SOURCE_UNKNOWN"):
        s.assert_allowed("w1", "commit", "op", 3)
    s.owner_update({"source": "d1", "actor": "b", "status": "CONFIRMED",
                    "usable_by": ["b"]})
    with pytest.raises(ContextBlocked, match="CONTEXT_USE_NOT_PERMITTED"):
        s.assert_allowed("w1", "commit", "op", 4)


@pytest.mark.parametrize("source_change,reason", [
    ({"core": "fake-core"}, "CONTEXT_CORE_INVALID"),
    ({"purposes": []}, "CONTEXT_PURPOSES_INVALID"),
    ({"operations": ["DELETE_EVERYTHING"]}, "CONTEXT_OPERATIONS_INVALID"),
    ({"valid_from": True}, "CONTEXT_VALID_FROM_INVALID"),
    ({"valid_from": 10}, "CONTEXT_SCOPE_INTERVAL_INVALID"),
])
def test_invalid_extended_model_scope_never_enters_original_basis(source_change, reason):
    src = scoped_source()
    src.update(source_change)
    f = fixture(sources=[src], requirements=[scoped_requirement()])
    with pytest.raises(ContextInputError, match=reason):
        state(f)


def test_missing_purpose_or_operation_never_becomes_blanket_context_permission():
    src = source()
    src["core"] = "corporate"
    f = fixture(sources=[src], requirements=[scoped_requirement()])
    with pytest.raises(ContextInputError, match="CONTEXT_SCOPE_FIELDS_INCOMPLETE"):
        state(f)
    f = fixture(sources=[scoped_source()],
                requirements=[{**scoped_requirement(), "operation": None}])
    with pytest.raises(ContextInputError, match="CONTEXT_REQUIREMENT_SCOPE_INVALID"):
        state(f)
