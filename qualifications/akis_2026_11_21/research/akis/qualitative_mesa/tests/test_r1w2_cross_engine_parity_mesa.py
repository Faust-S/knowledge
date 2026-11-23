"""R1-W2: one numerical WIP contract executed by the original Mesa 3.5.2.

The same JSON contract is exercised by the actual standalone browser engine
on iwxa-ru-1. This compares bounded Work/material quantities, not cash
or complete technology routes that are still different in the two layers.
"""
from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import pytest

from research.akis.qualitative_mesa.rules import QualitativeAKIS
from .test_r1w1_original_wip_mesa import (
    wip_case, base_events, proposal, original_terms, votes, finish, submit,
)

CONTRACT = json.loads((
    Path(__file__).resolve().parents[2] / "fixtures" /
    "r1w2_wip_cross_engine.json"
).read_text(encoding="utf-8"))
FIRST = CONTRACT["first_attempt"]
SECOND = CONTRACT["second_interruption"]


def original():
    state = QualitativeAKIS(wip_case())
    for event in base_events():
        result = state.apply(event, event["at"])
        assert result["outcome"] == "APPLIED", result
    return state


def rubles(raw: str) -> int:
    return int(Decimal(raw).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def terms(first: dict):
    return original_terms(
        total=first["total_units"], produced=first["produced_units"],
        usable=first["usable_units"],
        materials=f'{first["materials_value_rub"]}.00',
        handling=f'{first["handling_cost_rub"]}.00',
        claim=f'{first["claim_amount_rub"]}.00',
        full=f'{first["full_redo_cost_rub"]}.00',
    )


@pytest.mark.parametrize("choice", CONTRACT["decisions"], ids=lambda row: row["kind"])
def test_original_mesa_parity_for_three_independent_wip_decisions(choice):
    state = original()
    decision = choice["kind"]
    proposed = proposal(
        decision=decision,
        target="ra" if decision == "REWORK" else "rc",
        terms=terms(FIRST),
    )
    result = state.apply(proposed, proposed["at"])
    assert result["outcome"] == "APPLIED", result
    digest = state.works["w1"].wip_proposal["fingerprint"]
    candidate = state.works["w1"].wip_proposal["lot"]
    assert rubles(candidate["original_cost_claim"]) == FIRST["original_cost_rub"]
    assert candidate["total_units"] == FIRST["total_units"]
    assert candidate["produced_units"] == FIRST["produced_units"]
    assert candidate["usable_units"] == FIRST["usable_units"]
    assert rubles(candidate["unit_credit"]) == FIRST["unit_credit_rub"]
    assert rubles(candidate["reusable_resources"]) == FIRST["reusable_resources_rub"]
    assert rubles(candidate["handling_cost"]) == FIRST["handling_cost_rub"]
    assert rubles(candidate["claim_amount"]) == FIRST["claim_amount_rub"]
    assert candidate["remaining_units"] == FIRST["remaining_units"]
    assert candidate["cash_recovery"] == "NOT_RECORDED"
    if decision != "TERMINATE":
        assert rubles(candidate["future_resource_cost"]) == choice["new_attempt_cost_rub"]
        assert rubles(candidate["reference_gain_vs_complete_redo"]) == FIRST["net_resource_gain_rub"]
    else:
        assert candidate["future_resource_cost"] is None
    votes(state, digest)
    if decision == "REWORK":
        result = submit(state, "resource_status", 12, "a",
                        resource="ra", availability="AVAILABLE")
        assert result["outcome"] == "APPLIED", result
    approved = finish(state, digest)
    assert approved["outcome"] == "APPLIED", approved
    work = state.works["w1"]
    latest = work.wip_lots[-1]
    assert latest["status"] == choice["lot_after_agreement"]
    assert latest["holder"] == "a"
    assert latest["cash_recovery_claim"] == "PENDING_NOT_CASH"
    assert work.result == "NOT_SUBMITTED"
    assert len(state.works) == 2
    assert work.resource == "ra"
    if decision != "TERMINATE":
        executor = "a" if decision == "REWORK" else "c"
        result = submit(state, "wip_resume", 22, executor, work="w1",
                        source_revision="d-1", org_revision="oc-1",
                        wip_source_ref=f"model://{executor}/resume")
        assert result["outcome"] == "APPLIED", result
    assert latest["status"] == choice["lot_after_execution"]
    assert work.result == "NOT_SUBMITTED"
    assert work.obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"


def test_mesa_repeat_uses_only_last_attempt_quantity_cost_and_sources():
    state = original()
    first = proposal()
    assert state.apply(first, first["at"])["outcome"] == "APPLIED"
    digest = state.works["w1"].wip_proposal["fingerprint"]
    votes(state, digest)
    assert finish(state, digest)["outcome"] == "APPLIED"
    assert submit(state, "wip_resume", 22, "c",
                  work="w1", source_revision="d-1", org_revision="oc-1",
                  wip_source_ref="model://c/resume-1")["outcome"] == "APPLIED"
    assert submit(state, "resource_status", 23, "c",
                  resource="rc", availability="UNAVAILABLE")["outcome"] == "APPLIED"
    assert submit(state, "wip_interrupt", 24, "c",
                  work="w1", source_revision="d-1", org_revision="oc-1",
                  cost_source_ref="model://c/attempt-2",
                  prior_cost_claim=f'{SECOND["current_attempt_cost_rub"]}.00')["outcome"] == "APPLIED"
    new_terms = original_terms(
        total=SECOND["current_attempt_units"],
        produced=SECOND["produced_units"],
        usable=SECOND["usable_units"],
        materials=f'{SECOND["materials_value_rub"]}.00',
        handling=f'{SECOND["handling_cost_rub"]}.00',
        claim=f'{SECOND["claim_amount_rub"]}.00',
        full=f'{SECOND["current_attempt_cost_rub"]}.00',
        owner="c", ref="ACT-SECOND",
    )
    second = proposal(
        at=26, decision="TERMINATE", terms=new_terms,
    )
    second["work_interruption_at"] = 24
    second["wip_id"] = "wip-2"
    second["wip_source_ref"] = "model://b/wip-proposal-2"
    assert state.apply(second, 26)["outcome"] == "APPLIED"
    spec = state.works["w1"].wip_proposal["lot"]
    assert spec["total_units"] == SECOND["current_attempt_units"]
    assert spec["remaining_units"] == SECOND["expected_remaining_units"]
    assert spec["unit_credit"] == SECOND["precise_native_credit_rub"]
    assert rubles(spec["unit_credit"]) == SECOND["expected_unit_credit_rub"]
    assert rubles(Decimal(spec["next_full_cost"]) - Decimal(spec["reusable_resources"])) == SECOND["expected_new_attempt_cost_rub"]
    assert str(Decimal(spec["next_full_cost"]) - Decimal(spec["reusable_resources"])) == SECOND["precise_native_new_cost_rub"]
    digest = state.works["w1"].wip_proposal["fingerprint"]
    for at, who in ((27, "b"), (28, "c")):
        assert submit(state, "wip_review", at, who, work="w1",
                      source_revision="d-1", org_revision="oc-1",
                      wip_id="wip-2", wip_fingerprint=digest,
                      wip_position="SUPPORT",
                      wip_source_ref=f"model://{who}/vote-2")["outcome"] == "APPLIED"
    assert submit(state, "wip_apply", 29, "b", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  wip_id="wip-2", wip_fingerprint=digest,
                  wip_source_ref="model://b/apply-2")["outcome"] == "APPLIED"
    work = state.works["w1"]
    assert [x["status"] for x in work.wip_lots] == [
        SECOND["previous_lot_status"], SECOND["lot_status"],
    ]
    assert work.execution == "STOPPED"
    assert work.result == "NOT_SUBMITTED"
    assert len(state.works) == 2


def test_mesa_second_transfer_uses_own_original_future_window_and_consent():
    expected = CONTRACT["second_transfer"]
    state = original()
    first = proposal()
    assert state.apply(first, first["at"])["outcome"] == "APPLIED"
    first_digest = state.works["w1"].wip_proposal["fingerprint"]
    votes(state, first_digest)
    assert finish(state, first_digest)["outcome"] == "APPLIED"
    assert submit(state, "wip_resume", 22, "c", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  wip_source_ref="model://c/resume-1")["outcome"] == "APPLIED"
    assert submit(state, "resource_status", 23, "c",
                  resource="rc", availability="UNAVAILABLE")["outcome"] == "APPLIED"
    assert submit(state, "wip_interrupt", 24, "c", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  cost_source_ref="model://c/attempt-2",
                  prior_cost_claim=f'{SECOND["current_attempt_cost_rub"]}.00')["outcome"] == "APPLIED"
    source = original_terms(
        total=expected["current_attempt_units"],
        produced=expected["produced_units"],
        usable=expected["usable_units"],
        materials="0.00", handling="0.00", claim="0.00",
        full=f'{expected["full_redo_cost_rub"]}.00',
        owner="c", ref="ACT-SECOND",
    )
    next_proposal = proposal(at=26, decision="TRANSFER", target="ra",
                             terms=source, plan=(32, 37))
    next_proposal.update(
        work_interruption_at=24, wip_id="wip-2",
        wip_source_ref="model://b/wip-proposal-2",
    )
    assert state.apply(next_proposal, 26)["outcome"] == "APPLIED"
    p = state.works["w1"].wip_proposal
    assert rubles(p["lot"]["unit_credit"]) == expected["reused_unit_credit_rub"]
    assert rubles(p["lot"]["future_resource_cost"]) == expected["new_attempt_cost_rub"]
    assert p["lot"]["remaining_units"] == expected["next_attempt_units"]
    assert p["required"] == ["a", "b", "c"]
    for at, who in ((27, "c"), (28, "b"), (29, "a")):
        v = submit(state, "wip_review", at, who, work="w1",
                   source_revision="d-1", org_revision="oc-1",
                   wip_id="wip-2", wip_fingerprint=p["fingerprint"],
                   wip_position="SUPPORT",
                   wip_source_ref=f"model://{who}/second-transfer-vote")
        assert v["outcome"] == "APPLIED", v
    assert submit(state, "resource_status", 30, "a",
                  resource="ra", availability="AVAILABLE")["outcome"] == "APPLIED"
    result = submit(state, "wip_apply", 31, "b", work="w1",
                    source_revision="d-1", org_revision="oc-1",
                    wip_id="wip-2", wip_fingerprint=p["fingerprint"],
                    wip_source_ref="model://b/second-apply")
    assert result["outcome"] == "APPLIED", result
    work = state.works["w1"]
    assert len(work.wip_lots) == 2
    assert [row["status"] for row in work.wip_lots] == ["CONSUMED", expected["lot_after_agreement"]]
    assert work.wip_lots[-1]["holder"] == "c"
    assert work.wip_active_resource == "ra"
    assert [(r.resource, r.start, r.end) for r in state.capacity_ledger.reservations
            if r.work == "w1"] == [("ra", 7, 11), ("rc", 22, 27), ("ra", 32, 37)]
    assert submit(state, "wip_resume", 32, "a", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  wip_source_ref="model://a/second-resume")["outcome"] == "APPLIED"
    assert work.wip_lots[-1]["status"] == expected["lot_after_execution"]
    assert work.wip_lots[-1]["holder"] == "a"
    assert work.resource == "ra"
    assert work.result == "NOT_SUBMITTED"
