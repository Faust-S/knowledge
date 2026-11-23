"""R1-W1C: independently consented future Operation Assurance responsibility.

Original QualityCriterion, Work, MaterialBatch, Handoff and Result remain
immutable. The transfer does not authenticate quality, legal liability or
ownership: only future executed Operation responsibility changes.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1w1b_original_operation_wip_mesa import (
    scenario as original_scenario,
    strict_scenario as original_strict_scenario,
    baseline, proposal, state_to_interruption, independent_votes,
    ev, send, applied, custody,
)


def criterion(key, operation, owner, method, dimension="MATERIAL_CONFORMITY"):
    return {
        "id": key, "operation": operation,
        "responsible_owner": owner, "assessor": "c", "method": method,
        "dimension": dimension,
        "source_ref": f"model://c/criterion-{key}",
        "source_revision": "d1",
    }


def scenario(*, strict=False):
    d = original_strict_scenario() if strict else original_scenario()
    d["works"][0]["assurance_criteria"] = [
        criterion("form-surface", "form", "b", "INSPECTION"),
        criterion("form-record", "form", "b", "DOCUMENT_REVIEW",
                  "DOCUMENTATION"),
        criterion("finish-product", "finish", "a", "FUNCTIONAL_TEST",
                  "DELIVERABLE_CONFORMITY"),
    ]
    if strict:
        sources = d["context_evidence"]["sources"]
        for name in (
                "criterion-form-surface", "criterion-form-record",
                "criterion-finish-product", "w1c-assurance-terms"):
            sources.append({
                "id": f"model://c/{name}",
                "owner": "c", "revision": "source-r1",
                "status": "CONFIRMED", "usable_by": ["c"],
                "valid_until": 100,
            })
    return d


def terms():
    return {
        "scope": "FUTURE_OPERATION_EXECUTION_ONLY",
        "terms_ref": "model://c/w1c-assurance-terms",
        "criteria": [
            {
                "criterion": "form-surface", "original_owner": "b",
                "previous_effective_owner": "b", "new_effective_owner": "d",
                "assessor": "c", "method": "INSPECTION",
            },
            {
                "criterion": "form-record", "original_owner": "b",
                "previous_effective_owner": "b", "new_effective_owner": "d",
                "assessor": "c", "method": "DOCUMENT_REVIEW",
            },
        ],
    }


def transfer_offer():
    offered = proposal()
    offered["wip_assurance_responsibility"] = terms()
    return offered


def interrupted(*, strict=False):
    state = QualitativeAKIS(scenario(strict=strict))
    for event in baseline():
        result = state.apply(event, event["at"])
        assert result["outcome"] == "APPLIED", (event, result)
    assert state.works["w1"].execution == "PAUSED"
    return state


def approved(*, strict=False):
    state = interrupted(strict=strict)
    offer = transfer_offer()
    applied(state, 15, "wip_propose", "c",
            **{key: value for key, value in offer.items()
               if key not in {"at", "action", "actor", "work"}})
    digest = state.works["w1"].wip_proposal["fingerprint"]
    independent_votes(state, digest)
    applied(state, 20, "wip_apply", "c", source_revision="d1",
            org_revision="oc-1", wip_operation="form",
            wip_id="wip-form-1", wip_fingerprint=digest,
            wip_source_ref="model://c/form-apply")
    return state


def resume_and_result(state):
    custody(state)
    applied(state, 24, "wip_resume", "d",
            source_revision="d1", org_revision="oc-1",
            wip_operation="form", wip_source_ref="model://d/form-resume")
    applied(state, 25, "complete_operation", "d", operation="form",
            result_ref="model://d/new-form-after-assurance")
    common = dict(from_operation="form", to_operation="finish",
                  source_revision="d1", org_revision="oc-1")
    applied(state, 26, "handoff_dispatch", "d", **common,
            material_quantities=[{"batch": "mat-out", "quantity": "5"}],
            result_ref="model://d/assured-dispatch")
    applied(state, 27, "handoff_receive", "a", **common,
            dispatch_ref="model://d/assured-dispatch",
            material_quantities=[{"batch": "mat-out", "quantity": "5"}],
            result_ref="model://a/assured-receipt")
    applied(state, 28, "handoff_quality", "a", **common,
            receipt_ref="model://a/assured-receipt",
            quality_quantities=[
                {"batch": "mat-out", "accepted": "5", "rejected": "0"},
            ], result_ref="model://a/assured-material-quality")
    applied(state, 29, "start_operation", "a", operation="finish")
    applied(state, 30, "complete_operation", "a", operation="finish",
            result_ref="model://a/assured-finish")
    applied(state, 31, "complete", "a",
            result_ref="model://a/assured-original-result")
    return state


def quality_event(at, criterion_key, *, owner=None, revision=None, verdict="MEETS_DECLARED_REQUIREMENT"):
    out = ev(
        at, "assess_result_quality", "c", criterion=criterion_key,
        source_revision="d1", org_revision="oc-1",
        result_ref="model://a/assured-original-result",
        quality_verdict=verdict,
        quality_evidence_ref=f"model://c/assurance-check-{criterion_key}-{at}",
    )
    if owner is not None:
        out["quality_expected_responsible_owner"] = owner
    if revision is not None:
        out["quality_responsibility_revision"] = revision
    return out


def test_transfer_without_explicit_assurance_terms_is_blocked_before_booking():
    state = interrupted()
    before = tuple(state.capacity_ledger.reservations)
    old = proposal()
    attempted = state.apply(old, old["at"])
    assert attempted["reason"] == "WIP_ASSURANCE_RESPONSIBILITY_TERMS_REQUIRED"
    assert state.works["w1"].wip_proposal is None
    assert state.works["w1"].assurance_responsibilities == {}
    assert tuple(state.capacity_ledger.reservations) == before


@pytest.mark.parametrize("mutate,reason", [
    (lambda p: p["wip_assurance_responsibility"]["criteria"].pop(),
     "WIP_ASSURANCE_ALL_OPERATION_CRITERIA_REQUIRED"),
    (lambda p: p["wip_assurance_responsibility"]["criteria"][1].update(
        {"criterion":"form-surface"}), "WIP_ASSURANCE_CRITERION_ID_OR_DUPLICATE_INVALID"),
    (lambda p: p["wip_assurance_responsibility"]["criteria"][0].update(
        {"original_owner":"a"}), "WIP_ASSURANCE_RESPONSIBLE_OWNERS_MISMATCH"),
    (lambda p: p["wip_assurance_responsibility"]["criteria"][0].update(
        {"new_effective_owner":"b"}), "WIP_ASSURANCE_RESPONSIBLE_OWNERS_MISMATCH"),
    (lambda p: p["wip_assurance_responsibility"]["criteria"][1].update(
        {"method":"INSPECTION"}), "WIP_ASSURANCE_ORIGINAL_ASSESSOR_OR_METHOD_CHANGED"),
    (lambda p: p["wip_assurance_responsibility"]["criteria"][0].update(
        {"assessor":"a"}), "WIP_ASSURANCE_ORIGINAL_ASSESSOR_OR_METHOD_CHANGED"),
    (lambda p: p["wip_assurance_responsibility"].update(
        {"scope":"RETROACTIVE_OWNER_REPLACEMENT"}), "WIP_ASSURANCE_SCOPE_MUST_BE_PROSPECTIVE"),
    (lambda p: p["wip_assurance_responsibility"].update(
        {"terms_ref":"model://d/unauthorized-terms"}),
     "WIP_ASSURANCE_CUSTOMER_SOURCE_REQUIRED"),
])
def test_assurance_source_owner_method_and_scope_cannot_be_silently_changed(
        mutate, reason):
    state = interrupted()
    offered = transfer_offer()
    mutate(offered)
    old_bookings = tuple(state.capacity_ledger.reservations)
    response = state.apply(offered, offered["at"])
    assert response["reason"] == reason, response
    assert state.works["w1"].wip_proposal is None
    assert state.works["w1"].assurance_responsibilities == {}
    assert tuple(state.capacity_ledger.reservations) == old_bookings


def test_consent_fingerprint_binds_every_assurance_criterion_and_all_principals():
    state = interrupted()
    offered = transfer_offer()
    assert state.apply(offered, 15)["outcome"] == "APPLIED"
    active = state.works["w1"].wip_proposal
    assert active["required"] == ["a", "b", "c", "d"]
    original = active["fingerprint"]
    assert {row["criterion"] for row in active["assurance_responsibility"]["criteria"]} == {
        "form-surface", "form-record",
    }
    independent_votes(state, original, objector="b")
    old_booking = tuple(state.capacity_ledger.reservations)
    denied = send(state, 20, "wip_apply", "c",
                  source_revision="d1", org_revision="oc-1",
                  wip_operation="form", wip_id="wip-form-1",
                  wip_fingerprint=original, wip_source_ref="model://c/form-apply")
    assert denied["reason"] == "WIP_INDEPENDENT_SUPPORT_MISSING"
    assert state.works["w1"].assurance_responsibilities == {}
    assert tuple(state.capacity_ledger.reservations) == old_booking


def test_valid_original_assurance_revision_is_scoped_to_future_form_execution():
    state = approved()
    work = state.works["w1"]
    originals = {row.key: row.responsible_owner for row in work.assurance_criteria}
    assert originals == {"form-surface": "b", "form-record": "b",
                         "finish-product": "a"}
    assert {key: row["effective_owner"] for key, row in
            work.assurance_responsibilities.items()} == {
        "form-surface": "d", "form-record": "d",
    }
    assert set(work.assurance_responsibilities) == {"form-surface", "form-record"}
    assert work.operation_states["form"] == "PAUSED"
    assert work.wip_operation_active_resources == {"form": "rd"}
    assert next(batch for batch in work.material_batches
                if batch.key == "mat-out").declared_title_holder == "b"
    assert len(state.works) == 2
    w = state.snapshot()["works"]["w1"]
    assert w["assurance"]["current_result_quality_gate"] == "QUALITY_ORIGINAL_ASSESSMENT_MISSING"
    criteria = {x["criterion"]: x for x in w["assurance"]["criteria"]}
    assert criteria["form-surface"]["responsible_original_owner"] == "b"
    assert criteria["form-surface"]["effective_future_execution_owner"] == "d"
    assert criteria["form-surface"]["assessor_original_recipient"] == "c"
    assert criteria["finish-product"]["effective_future_execution_owner"] == "a"
    assert criteria["finish-product"]["effective_responsibility_revision"] is None
    assert criteria["form-surface"]["effective_responsibility_revision"] == "wip-form-1"
    assert not criteria["form-surface"]["legal_liability_created"]


def test_submission_and_acceptance_require_original_recipient_to_assess_new_owner():
    state = resume_and_result(approved())
    assert state.works["w1"].result == "SUBMITTED"
    before = deepcopy(state.works["w1"].assurance_reviews)
    bad = quality_event(32, "form-surface")
    assert state.apply(bad, 32)["reason"] == "QUALITY_EFFECTIVE_RESPONSIBLE_OWNER_REQUIRED"
    bad = quality_event(33, "form-surface", owner="b", revision="wip-form-1")
    assert state.apply(bad, 33)["reason"] == "QUALITY_EFFECTIVE_RESPONSIBLE_OWNER_REQUIRED"
    bad = quality_event(34, "form-surface", owner="d", revision="wrong-wip")
    assert state.apply(bad, 34)["reason"] == "QUALITY_EFFECTIVE_RESPONSIBILITY_REVISION_REQUIRED"
    bad = quality_event(35, "finish-product", owner="d", revision="wip-form-1")
    assert state.apply(bad, 35)["reason"] == "QUALITY_UNCHANGED_CRITERION_CANNOT_INFER_NEW_RESPONSIBILITY"
    assert state.works["w1"].assurance_reviews == before
    for event in [
        quality_event(36, "form-surface", owner="d", revision="wip-form-1"),
        quality_event(37, "form-record", owner="d", revision="wip-form-1"),
        quality_event(38, "finish-product"),
    ]:
        assert state.apply(event, event["at"])["outcome"] == "APPLIED"
    assert send(state, 39, "accept", "c")["outcome"] == "APPLIED"
    assert state.works["w1"].result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert state.works["w1"].obligation == "FULFILLED"
    assert set(state.works["w1"].assurance_reviews) == {
        "form-surface", "form-record", "finish-product",
    }
    assert state.works["w1"].assurance_reviews["form-surface"][
        "responsibility_revision"] == "wip-form-1"
    assert state.snapshot()["works"]["w1"]["assurance"]["current_result_quality_gate"] == "NONE"


def test_strict_kpb_revoked_criterion_blocks_apply_without_any_reservation():
    state = interrupted(strict=True)
    offered = transfer_offer()
    assert state.apply(offered, 15)["outcome"] == "APPLIED"
    digest = state.works["w1"].wip_proposal["fingerprint"]
    independent_votes(state, digest)
    before = tuple(state.capacity_ledger.reservations)
    changed = send(state, 20, "source_update", "c",
                   source="model://c/criterion-form-record",
                   expected_revision="source-r1", new_revision="source-r2",
                   status="DISPROVED")
    assert changed["outcome"] == "APPLIED", changed
    denied = send(state, 21, "wip_apply", "c", source_revision="d1",
                  org_revision="oc-1", wip_operation="form",
                  wip_id="wip-form-1", wip_fingerprint=digest,
                  wip_source_ref="model://c/form-apply")
    assert denied["reason"] == "WIP_ORIGINAL_EVIDENCE_SOURCE_UNAVAILABLE"
    assert tuple(state.capacity_ledger.reservations) == before
    assert state.works["w1"].assurance_responsibilities == {}


def test_strict_kpb_terms_revocation_blocks_future_quality_even_after_submit():
    state = resume_and_result(approved(strict=True))
    old = tuple(state.capacity_ledger.reservations)
    changed = send(state, 32, "source_update", "c",
                   source="model://c/w1c-assurance-terms",
                   expected_revision="source-r1", new_revision="source-r2",
                   status="DISPROVED")
    assert changed["outcome"] == "APPLIED", changed
    attempted = state.apply(
        quality_event(33, "form-surface", owner="d", revision="wip-form-1"), 33
    )
    assert attempted["reason"] == "WIP_ORIGINAL_EVIDENCE_SOURCE_UNAVAILABLE"
    assert state.works["w1"].assurance_reviews == {}
    assert tuple(state.capacity_ledger.reservations) == old
    assert state.works["w1"].result == "SUBMITTED"


def test_native_mesa_scheduler_uses_same_approval_and_assurance_snapshot():
    d = scenario()
    direct = interrupted()
    offered = transfer_offer()
    assert direct.apply(offered, 15)["outcome"] == "APPLIED"
    digest = direct.works["w1"].wip_proposal["fingerprint"]
    votes = [
        ev(at, "wip_review", actor, source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_id="wip-form-1", wip_fingerprint=digest,
           wip_position="SUPPORT", wip_source_ref=f"model://{actor}/wip-review-{at}")
        for at, actor in enumerate(("a", "b", "c", "d"), start=16)
    ]
    events = baseline() + [offered] + votes + [
        ev(20, "wip_apply", "c", source_revision="d1",
           org_revision="oc-1", wip_operation="form",
           wip_id="wip-form-1", wip_fingerprint=digest,
           wip_source_ref="model://c/form-apply"),
    ]
    d["events"] = events
    d["model_horizon"] = 23
    result = simulate(d)
    assert not [row for row in result["trace"] if row["outcome"] == "BLOCKED"]
    work = result["works"]["w1"]
    criteria = {row["criterion"]: row for row in work["assurance"]["criteria"]}
    assert criteria["form-surface"]["responsible_original_owner"] == "b"
    assert criteria["form-surface"]["effective_future_execution_owner"] == "d"
    assert criteria["finish-product"]["effective_future_execution_owner"] == "a"
    assert len(work["unfinished_production"]["applied_amendments"]) == 1
    assert simulate(deepcopy(d)) == result
