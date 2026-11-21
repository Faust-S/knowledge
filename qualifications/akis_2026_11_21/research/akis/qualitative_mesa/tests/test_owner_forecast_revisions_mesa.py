"""M2.4 source_update -> private payment forecast -> independent Mesa choice.

All dates and cash are research fixtures. Original ContextBasis source_update
is a MODEL_ONLY owner event, not a proven settlement or external bank feed.
"""
from __future__ import annotations

from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError, QualitativeAKIS
from research.akis.qualitative_mesa.owner_forecast_revisions import (
    ForecastRevisionInputError, parse_forecast_revisions, private_forecast_override,
)
from research.akis.qualitative_mesa.owner_economic_feedback import parse_owner_finance
from .test_owner_economic_feedback_mesa import (
    fixture as owner_fixture, claim as owner_claim,
)
from .test_liquidity_mesa_integration import case as finance_case


def revision():
    return {
        "owner": "b", "work": "w1",
        "context_source": "ctx-b-financial",
        "expected_context_revision": "r1", "new_context_revision": "r2",
        "effective_at": 3, "transfer_id": "t1",
        "expected_at": 5, "late_at": 6,
    }


def data():
    scenario = owner_fixture()
    # An early initial customer receipt makes baseline viable, but the
    # owner's later, personally asserted DELAY makes liquidity insufficient
    # before a subcontractor payment. No new cash amounts are invented.
    scenario["economic_claims"] = finance_case()
    for row in scenario["economic_claims"]["cash_timing"]["transfer_windows"]:
        if row["transfer_id"] == "t1":
            row["at"] = 0
            row["late_at"] = 0
        if row["transfer_id"] == "t2":
            row["at"] = 4
    scenario["owner_financial_reviews"] = [owner_claim(start=0, end=7)]
    scenario["events"] = [
        {"at": 1, "action": "offer", "actor": "op", "work": "w1"},
        {"at": 2, "action": "authorize", "actor": "op", "work": "w1"},
        {"at": 3, "action": "source_update", "actor": "b",
         "source": "ctx-b-financial", "status": "CONFIRMED",
         "new_revision": "r2", "usable_by": ["b"]},
    ]
    scenario["context_evidence"] = {
        "strict": True,
        "sources": [
            {"id": "ctx-op-shared", "owner": "op",
             "revision": "s1", "status": "CONFIRMED",
             "usable_by": ["op", "a", "b"]},
            {"id": "ctx-b-financial", "owner": "b",
             "revision": "r1", "status": "CONFIRMED",
             "usable_by": ["b"]},
        ],
        "requirements": [
            {"work": "w1", "action": act, "sources": ["ctx-op-shared"],
             "expected_revisions": ["s1"]}
            for act in ("offer", "authorize", "consent")
        ] + [
            {"work": "w1", "action": "interest_update",
             "sources": ["ctx-b-financial"], "expected_revisions": ["r2"]},
        ],
    }
    scenario["owner_payment_forecast_revisions"] = [revision()]
    scenario["model_horizon"] = 8
    return scenario


def test_parsing_ties_private_forecast_to_original_owner_cash_and_context_revision():
    scenario = data()
    state = QualitativeAKIS({
        k: v for k, v in scenario.items()
        if k in {"schema", "evidence", "institution", "subjects", "resources",
                 "works", "events", "context_evidence"}
    })
    owners = parse_owner_finance(
        scenario["owner_financial_reviews"], state=state,
        original_money=scenario["economic_claims"],
    )
    rows = parse_forecast_revisions(
        scenario["owner_payment_forecast_revisions"], state=state,
        original_money=scenario["economic_claims"], owner_claims=owners,
    )
    assert len(rows) == 1
    assert rows[0].owner == "b"
    assert rows[0].new_source_revision == "r2"
    # Even a predeclared future revision cannot apply before an ORIGINAL
    # source_update is accepted and recorded in the single original trace.
    assert private_forecast_override(
        rows, owner="b", work="w1", at=3,
        original_money=scenario["economic_claims"], state=state,
    ) is None


@pytest.mark.parametrize("alter,error", [
    (lambda d:d["owner_payment_forecast_revisions"][0].update({"owner":"op"}),
     "FORECAST_REVISION_REQUIRES_CURRENT_ORIGINAL_OWNER_CLAIM"),
    (lambda d:d["owner_payment_forecast_revisions"][0].update({"transfer_id":"t3"}),
     "FORECAST_REVISION_TRANSFER_NOT_ORIGINAL_OWNER_PAYMENT"),
    (lambda d:d["owner_payment_forecast_revisions"][0].update({"transfer_id":"unknown"}),
     "FORECAST_REVISION_TRANSFER_NOT_ORIGINAL_OWNER_PAYMENT"),
    (lambda d:d["owner_payment_forecast_revisions"][0].update({"effective_at":4}),
     "FORECAST_REVISION_REQUIRES_EXACT_ORIGINAL_SOURCE_EVENT"),
    (lambda d:d["owner_payment_forecast_revisions"][0].update({"new_context_revision":"r3"}),
     "FORECAST_REVISION_CONTEXT_OWNERSHIP_OR_SCOPE_MISMATCH"),
    (lambda d:d["owner_payment_forecast_revisions"][0].update({"expected_at":2}),
     "FORECAST_REVISION_TIMES_INVALID"),
    (lambda d:d["owner_payment_forecast_revisions"][0].update({"late_at":4}),
     "FORECAST_REVISION_TIMES_INVALID"),
    (lambda d:d["owner_payment_forecast_revisions"][0].update({"expected_context_revision":"r0"}),
     "FORECAST_REVISION_CONTEXT_OWNERSHIP_OR_SCOPE_MISMATCH"),
    (lambda d:d["owner_payment_forecast_revisions"].append(
        deepcopy(d["owner_payment_forecast_revisions"][0])),
     "FORECAST_REVISION_OVERLAPPING_OWNER_TRANSFER"),
])
def test_invalid_future_source_or_foreign_transfer_is_rejected(alter,error):
    scenario = data()
    alter(scenario)
    with pytest.raises(InputError, match=error):
        simulate(scenario)


def test_original_source_update_changes_one_owner_private_choice_without_changing_money():
    scenario = data()
    result = simulate(scenario)
    assert result["counts"] == {"applied": 3, "blocked": 0}
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"
    assert result["works"]["w1"]["consenting_principals"] == []
    assert result["context_basis"]["sources"]["ctx-b-financial"]["revision"] == "r2"
    assert [(e["at"], e["action"], e["outcome"]) for e in result["trace"]] == [
        (1, "offer", "APPLIED"),
        (2, "authorize", "APPLIED"),
        (3, "source_update", "APPLIED"),
    ]
    b = [row for row in result["decision_observations"]
         if row["subject"] == "b"]
    actions = {(row["at"], row["endogenous_choice"]["action"])
               for row in b if "endogenous_choice" in row}
    assert (2.0, "SEEK_ORIGINAL_INDEPENDENT_REVIEW") in actions
    assert (3.0, "REQUEST_INDEPENDENT_EVIDENCE_REVIEW") in actions
    assert (7.0, "SEEK_ORIGINAL_INDEPENDENT_REVIEW") in actions
    a = [row for row in result["decision_observations"]
         if row["subject"] == "a" and row["at"] == 3.0]
    assert a and a[-1]["endogenous_choice"]["action"] == "SEEK_ORIGINAL_INDEPENDENT_REVIEW"
    assert result["economics"]["cash_timing"][
        "per_original_owner_private_research_projection"]["b"][
            "scenario_paths"]["COOPERATION"]["expected"]["status"
        ] == "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    # Output still uses original global cash timing. Revised timing exists
    # ONLY in b's temporary assessor projection and is never serialized.
    assert scenario["economic_claims"]["cash_timing"]["transfer_windows"][0]["at"] == 0
    assert result["endogenous_subjects"]["private_financial_evidence_boundary"][
        "forecast_revision_changes_shared_cash_ledger"
    ] is False
    assert result["general_akis_model"]["legal_consent_created"] is False
    assert simulate(deepcopy(scenario)) == result


def test_rejected_original_source_update_does_not_change_private_forecast():
    scenario = data()
    scenario["events"][2]["actor"] = "a"  # stolen source update
    # Invalid event, but the expected owner revision still targets b.
    with pytest.raises(InputError, match="FORECAST_REVISION_REQUIRES_EXACT_ORIGINAL_SOURCE_EVENT"):
        simulate(scenario)


def test_only_applied_original_source_update_qualifies_revision_not_future_event_listing():
    scenario = data()
    # The original actor is b, but the ContextBasis source is made unusable
    # at the same original update: event accepted, private read denied.
    scenario["events"][2]["usable_by"] = ["a"]
    result = simulate(scenario)
    actions = [
        row["endogenous_choice"]["action"]
        for row in result["decision_observations"]
        if row["subject"] == "b" and row["at"] == 3.0
    ]
    assert result["counts"] == {"applied": 3, "blocked": 0}
    assert actions and actions[-1] == "SEEK_ORIGINAL_INDEPENDENT_REVIEW"
    assert result["works"]["w1"]["obligation"] == "NOT_ACCEPTED"


def test_no_optional_forecast_revisions_preserves_original_cash_interpretation():
    scenario = data()
    original = deepcopy(scenario)
    original.pop("owner_payment_forecast_revisions")
    with_update = simulate(scenario)
    without_update = simulate(original)
    assert with_update["economics"] == without_update["economics"]
    assert with_update["works"] == without_update["works"]
    assert with_update["trace"] == without_update["trace"]
    assert with_update["counts"] == without_update["counts"]
