"""R1-W2B: source-derived native evidence for the same industrial case.

The projection must pass through the real QualitativeAKIS/Mesa Work actions;
no parallel financial, Work or MaterialBatch mechanism may be created.
"""
from copy import deepcopy
from decimal import Decimal

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from research.akis.qualitative_mesa.r1w2b_causal_projection import (
    SCHEMA, project_original_work,
)
from .test_r1w1b_original_operation_wip_mesa import applied, send
from .test_r1w1c_assurance_multibatch_quality_mesa import (
    origin_with_disputed_quality,
)
from .test_r1w1c_quality_revision_mesa import (
    revision_proposal, new_votes,
)


def accepted_native_case():
    state = origin_with_disputed_quality()
    offered = revision_proposal()
    applied(state, 27, "wip_propose", "c",
            **{k: v for k, v in offered.items()
               if k not in {"at", "action", "actor", "work"}})
    digest = state.works["w1"].wip_proposal["fingerprint"]
    new_votes(state, digest)
    applied(state, 32, "wip_apply", "c", source_revision="d1",
            org_revision="oc-1", wip_operation="form",
            wip_id="wip-form-2", wip_fingerprint=digest,
            wip_source_ref="model://c/w1c-quality-revision-apply")
    applied(state, 33, "wip_resume", "d", source_revision="d1",
            org_revision="oc-1", wip_operation="form",
            wip_source_ref="model://d/w1c-quality-resume")
    applied(state, 34, "complete_operation", "d", operation="form",
            result_ref="model://d/form-revised-assurance")
    original_edge = dict(from_operation="form", to_operation="finish",
                         source_revision="d1", org_revision="oc-1")
    units = [
        {"batch": "mat-out-1", "quantity": "3"},
        {"batch": "mat-out-2", "quantity": "2"},
    ]
    applied(state, 35, "handoff_dispatch", "d", **original_edge,
            material_quantities=units,
            result_ref="model://d/batches-after-revision")
    applied(state, 36, "handoff_receive", "a", **original_edge,
            dispatch_ref="model://d/batches-after-revision",
            material_quantities=units,
            result_ref="model://a/batches-after-revision")
    applied(state, 37, "handoff_quality", "a", **original_edge,
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
    for at, key, scopes in [
        (41, "form-surface", {
            "quality_expected_responsible_owner": "d",
            "quality_responsibility_revision": "wip-form-1",
        }),
        (42, "form-record", {
            "quality_expected_responsible_owner": "d",
            "quality_responsibility_revision": "wip-form-1",
        }),
        (43, "finish-product", {}),
    ]:
        applied(state, at, "assess_result_quality", "c",
                source_revision="d1", org_revision="oc-1", criterion=key,
                result_ref="model://a/original-work-result-with-assurance",
                quality_verdict="MEETS_DECLARED_REQUIREMENT",
                quality_evidence_ref=f"model://c/assess-{key}-{at}",
                **scopes)
    applied(state, 44, "accept", "c")
    return state


def test_real_native_projection_of_finished_industrial_case_is_exact_and_read_only():
    state = accepted_native_case()
    before = deepcopy(state.snapshot())
    p = project_original_work(state)
    assert state.snapshot() == before
    assert p["schema"] == SCHEMA
    assert p["original_work_id"] == "w1"
    assert p["customer"] == "c"
    assert p["original_work_resource"] == "ra"
    assert p["original_planned_slot"] == [0, 12]
    assert p["operation_ids"] == ["source", "form", "finish"]
    assert p["operation_states"] == {
        "source": "COMPLETED", "form": "COMPLETED", "finish": "COMPLETED",
    }
    assert p["effective_operation_resources"] == {"form": "rd"}
    assert p["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert p["accepted_by_original_customer"]
    assert p["result_ref"] == "model://a/original-work-result-with-assurance"
    assert len(state.works) == 2
    assert project_original_work(state) == p


def test_both_native_revisions_are_separate_economics_not_doubled_cost():
    p = project_original_work(accepted_native_case())
    initial, revised = p["wip_economic_revisions"]
    assert initial == {
        "id": "wip-form-1", "status": "SUPERSEDED_BY_QUALITY_REVISION",
        "supersedes": None, "total_units": 5, "produced_units": 3,
        "usable_units": 2, "remaining_units": 3,
        "original_cost_claim_rub": "60000.00",
        "saved_resources_rub": "31000.00", "future_cost_rub": "29000.00",
        "material_value_rub": "7000.00", "handling_claim_rub": "1500.00",
        "recovery_claim_rub": "5000.00",
        "recovery_cash_status": "NOT_RECORDED",
        "future_planned_window": [20, 40],
    }
    assert revised == {
        **initial,
        "id": "wip-form-2", "status": "APPLIED",
        "supersedes": "wip-form-1",
        "usable_units": 1, "remaining_units": 4,
        "saved_resources_rub": "19000.00", "future_cost_rub": "41000.00",
    }
    assert Decimal(revised["future_cost_rub"]) - Decimal(initial["future_cost_rub"]) == 12000
    assert all(x["original_cost_claim_rub"] == "60000.00"
               for x in p["wip_economic_revisions"])
    assert p["money_evidence"]["compensation_cash"] == "NOT_BOUND_TO_WIP_NATIVE_PAYMENT"
    assert p["money_evidence"]["payment_settlement"] == "NOT_ESTABLISHED_BY_THIS_PROJECTION"
    assert not p["money_evidence"]["bank_payment_authenticated"]


def test_native_material_lots_sources_and_effective_assurance_are_distinct():
    p = project_original_work(accepted_native_case())
    material = p["original_material_batches"]
    assert len(material) == 4
    assert {x["id"] for x in material} == {
        "mat-in-1", "mat-in-2", "mat-out-1", "mat-out-2",
    }
    assert {x["id"]: x["declared_title_holder"] for x in material} == {
        "mat-in-1": "a", "mat-in-2": "a",
        "mat-out-1": "b", "mat-out-2": "b",
    }
    assert {x["id"]: x["accepted_units"] for x in material} == {
        "mat-in-1": 3, "mat-in-2": 2, "mat-out-1": 3, "mat-out-2": 2,
    }
    lots = p["physical_wip_lots"]
    assert len(lots) == 4
    assert {(x["batch"], x["revision"]) for x in lots} == {
        ("mat-out-1", "wip-form-1"), ("mat-out-2", "wip-form-1"),
        ("mat-out-1", "wip-form-2"), ("mat-out-2", "wip-form-2"),
    }
    assert all(x["quality_ref"] is not None for x in lots)
    assert {row["status"] for row in lots if row["revision"] == "wip-form-1"} == {
        "SUPERSEDED_BY_QUALITY_REVISION",
    }
    assert {row["status"] for row in lots if row["revision"] == "wip-form-2"} == {
        "CONSUMED",
    }
    assert {(x["criterion"], x["original_owner"], x["effective_owner"],
             x["assessor"], x["revision"])
            for x in p["assurance_responsibility"]} == {
        ("form-surface", "b", "d", "c", "wip-form-1"),
        ("form-record", "b", "d", "c", "wip-form-1"),
        ("finish-product", "a", "a", "c", None),
    }
    r = [x for x in p["same_original_capacity_reservations"]
         if x["resource"] == "rd"]
    assert len(r) == 1
    assert r[0] == {"resource": "rd", "start": 20, "end": 40, "units": 1}


def test_native_event_time_is_separate_from_reserved_planned_window():
    p = project_original_work(accepted_native_case())
    events = p["trace"]
    lookup = [(x["action"], x["at"]) for x in events if x["outcome"] == "APPLIED"]
    for event in [
        ("wip_interrupt", 14),
        ("wip_propose", 15),
        ("wip_apply", 20),
        ("wip_handoff_dispatch", 21),
        ("wip_handoff_quality", 26),
        ("wip_propose", 27),
        ("wip_apply", 32),
        ("wip_resume", 33),
        ("handoff_dispatch", 35),
        ("handoff_receive", 36),
        ("handoff_quality", 37),
        ("complete", 40),
        ("accept", 44),
    ]:
        assert event in lookup, event
    assert len([x for x in events if x["action"] == "wip_apply"
                and x["outcome"] == "APPLIED"]) == 2
    assert len([x for x in events if x["action"] == "accept"
                and x["outcome"] == "APPLIED"]) == 1
    assert p["wip_economic_revisions"][0]["future_planned_window"] == [20, 40]
    assert p["wip_economic_revisions"][1]["future_planned_window"] == [20, 40]
    assert p["comparison_limits"]["event_at_is_not_planned_slot"]


def test_native_source_declared_claim_is_not_automatically_cash_or_legal_release():
    state = accepted_native_case()
    p = project_original_work(state)
    original = state.works["w1"]
    assert all(r["recovery_cash_status"] == "NOT_RECORDED"
               for r in p["wip_economic_revisions"])
    assert all(r["original_cost_claim_rub"] == "60000.00"
               for r in p["wip_economic_revisions"])
    assert len([r for r in state.capacity_ledger.reservations
                if r.work == "w1" and r.resource == "rd"]) == 1
    assert original.assurance_criteria[0].responsible_owner in {"a", "b"}
    assert p["money_evidence"]["internal_transfer_is_not_network_profit"]
