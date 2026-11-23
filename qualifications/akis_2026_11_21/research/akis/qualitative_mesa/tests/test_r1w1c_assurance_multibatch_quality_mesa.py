"""R1-W1C cross-case: original Assurance survives multi-batch quality revision.

One Work and Result; exactly one original CapacityLedger reservation for the
new executor; original criteria and material declarations are not rewritten.
"""
from copy import deepcopy

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1w1b_original_operation_wip_mesa import ev, applied, send
from .test_r1w1c_multibatch_mesa import (
    multibatch_scenario, multibatch_baseline, multibatch_proposal, custody,
)
from .test_r1w1c_quality_revision_mesa import (
    revision_proposal, new_votes,
)
from .test_r1w1c_assurance_responsibility_mesa import (
    criterion, terms,
)


def joined_scenario():
    d = multibatch_scenario()
    d["works"][0]["assurance_criteria"] = [
        criterion("form-surface", "form", "b", "INSPECTION"),
        criterion("form-record", "form", "b", "DOCUMENT_REVIEW", "DOCUMENTATION"),
        criterion("finish-product", "finish", "a", "FUNCTIONAL_TEST",
                  "DELIVERABLE_CONFORMITY"),
    ]
    return d


def initial_offer():
    offer = multibatch_proposal()
    offer["wip_assurance_responsibility"] = terms()
    return offer


def origin_with_disputed_quality():
    state = QualitativeAKIS(joined_scenario())
    for event in multibatch_baseline():
        assert state.apply(event, event["at"])["outcome"] == "APPLIED"
    first = initial_offer()
    assert state.apply(first, 15)["outcome"] == "APPLIED"
    digest = state.works["w1"].wip_proposal["fingerprint"]
    for at, actor in enumerate(("a", "b", "c", "d"), start=16):
        applied(state, at, "wip_review", actor, source_revision="d1",
                org_revision="oc-1", wip_operation="form",
                wip_id="wip-form-1", wip_fingerprint=digest,
                wip_position="SUPPORT",
                wip_source_ref=f"model://{actor}/wip-review-{at}")
    applied(state, 20, "wip_apply", "c", source_revision="d1",
            org_revision="oc-1", wip_operation="form",
            wip_id="wip-form-1", wip_fingerprint=digest,
            wip_source_ref="model://c/form-apply")
    assert custody(state, "mat-out-1", 21)["outcome"] == "APPLIED"
    assert custody(state, "mat-out-2", 24, acceptable=0)["outcome"] == "APPLIED"
    return state


def test_quality_revision_preserves_original_consented_assurance_and_capacity():
    state = origin_with_disputed_quality()
    work = state.works["w1"]
    original = deepcopy(work.assurance_responsibilities)
    booking = tuple(state.capacity_ledger.reservations)
    p = revision_proposal()
    assert state.apply(p, 27)["outcome"] == "APPLIED"
    digest = work.wip_proposal["fingerprint"]
    new_votes(state, digest)
    result = send(state, 32, "wip_apply", "c",
                  source_revision="d1", org_revision="oc-1",
                  wip_operation="form", wip_id="wip-form-2",
                  wip_fingerprint=digest,
                  wip_source_ref="model://c/w1c-quality-revision-apply")
    assert result["outcome"] == "APPLIED", result
    assert result["wip_existing_capacity_reused"]
    assert tuple(state.capacity_ledger.reservations) == booking
    assert work.assurance_responsibilities == original
    assert {row["wip_id"] for row in work.assurance_responsibilities.values()} == {
        "wip-form-1",
    }
    assert work.wip_amendments[0]["status"] == "SUPERSEDED_BY_QUALITY_REVISION"
    assert work.wip_amendments[1]["quality_revision_of"] == "wip-form-1"
    assert all(row.responsible_owner == "b"
               for row in work.assurance_criteria if row.operation == "form")
    assert len(state.works) == 2
    assert work.result == "NOT_SUBMITTED"
    assert send(state, 33, "wip_resume", "b", source_revision="d1",
                org_revision="oc-1", wip_operation="form",
                wip_source_ref="model://b/wrong-resume")["outcome"] == "BLOCKED"
    assert send(state, 33, "wip_resume", "d", source_revision="d1",
                org_revision="oc-1", wip_operation="form",
                wip_source_ref="model://d/w1c-quality-resume")["outcome"] == "APPLIED"


def test_quality_revised_operation_and_original_recipient_accept_one_result():
    state = origin_with_disputed_quality()
    work = state.works["w1"]
    offer = revision_proposal()
    applied(state, 27, "wip_propose", "c",
            **{k: v for k, v in offer.items()
               if k not in {"at", "action", "actor", "work"}})
    digest = work.wip_proposal["fingerprint"]
    new_votes(state, digest)
    applied(state, 32, "wip_apply", "c",
            source_revision="d1", org_revision="oc-1", wip_operation="form",
            wip_id="wip-form-2", wip_fingerprint=digest,
            wip_source_ref="model://c/w1c-quality-revision-apply")
    applied(state, 33, "wip_resume", "d", source_revision="d1",
            org_revision="oc-1", wip_operation="form",
            wip_source_ref="model://d/w1c-quality-resume")
    applied(state, 34, "complete_operation", "d", operation="form",
            result_ref="model://d/form-revised-assurance")
    common = dict(from_operation="form", to_operation="finish",
                  source_revision="d1", org_revision="oc-1")
    quantities = [
        {"batch": "mat-out-1", "quantity": "3"},
        {"batch": "mat-out-2", "quantity": "2"},
    ]
    applied(state, 35, "handoff_dispatch", "d", **common,
            material_quantities=quantities,
            result_ref="model://d/batches-after-revision")
    applied(state, 36, "handoff_receive", "a", **common,
            dispatch_ref="model://d/batches-after-revision",
            material_quantities=quantities,
            result_ref="model://a/batches-after-revision")
    applied(state, 37, "handoff_quality", "a", **common,
            receipt_ref="model://a/batches-after-revision",
            quality_quantities=[
                {"batch": "mat-out-1", "accepted": "3", "rejected": "0"},
                {"batch": "mat-out-2", "accepted": "2", "rejected": "0"},
            ], result_ref="model://a/material-inspection-after-revision")
    applied(state, 38, "start_operation", "a", operation="finish")
    applied(state, 39, "complete_operation", "a", operation="finish",
            result_ref="model://a/final-stage-after-revision")
    applied(state, 40, "complete", "a",
            result_ref="model://a/original-work-result-with-assurance")
    for at, key, change in [
        (41, "form-surface", {"quality_expected_responsible_owner": "d",
                              "quality_responsibility_revision": "wip-form-1"}),
        (42, "form-record", {"quality_expected_responsible_owner": "d",
                             "quality_responsibility_revision": "wip-form-1"}),
        (43, "finish-product", {}),
    ]:
        applied(state, at, "assess_result_quality", "c",
                source_revision="d1", org_revision="oc-1",
                criterion=key, result_ref="model://a/original-work-result-with-assurance",
                quality_verdict="MEETS_DECLARED_REQUIREMENT",
                quality_evidence_ref=f"model://c/assess-{key}-{at}",
                **change)
    applied(state, 44, "accept", "c")
    assert work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert work.obligation == "FULFILLED"
    assert state.snapshot()["works"]["w1"]["assurance"]["current_result_quality_gate"] == "NONE"
    assert len(state.works) == 2
    assert len([r for r in state.capacity_ledger.reservations
                if r.work == "w1" and r.resource == "rd"]) == 1
    assert {row["material_batch"] for row in work.wip_lots} == {
        "mat-out-1", "mat-out-2",
    }
