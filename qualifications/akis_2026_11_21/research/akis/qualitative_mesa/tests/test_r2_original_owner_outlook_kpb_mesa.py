"""R2/R3: a prospective owner's outlook must obey the ORIGINAL strict KPB.

A future source-scoped coalition may be named in a research hypothesis,
but it is never active until original cooperation_membership_apply succeeds.
Money opinions remain nonbinding; Work consents and bank settlement are
never created by Mesa's private economic calculations.
"""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.economic_outlook import (
    OutlookInputError, choose_outlook, parse_outlooks,
)
from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate

from .test_r1v2c2b_registered_subject_cooperation_work_mesa import _insert_before
from .test_r1u4_strict_original_source_rights_mesa import e
from .test_r2_strict_original_payment_evidence_mesa import (
    scoped_bilateral_payment_case,
)


REF = "model://b/private-w2-economic-outlook"
CHANNELS = (
    "external_sales", "member_supply_receipts", "external_purchases",
    "member_supply_payments", "production_cash", "transaction_cash",
    "marketing_cash", "logistics_cash", "operator_fee_cash",
    "reconfiguration_cash",
)


def cash(**changes):
    row = {name: "0.00" for name in CHANNELS}
    row.update(changes)
    return row


def forecast(*, revision="outlook-r1", available_at=48, external_extra="1000.00"):
    return {
        "owner": "b",
        "relation": "l2",
        "work": "w2",
        "work_source_revision": "d-2",
        "relation_source_revision": "rel-2",
        "org_revision": "oc-1",
        "available_at": available_at,
        "expires_at": 109,
        "source_ref": REF,
        "source_revision": revision,
        "period": "2026-Q4",
        "currency": "RUB",
        "coverage": "COMPLETE_DECLARED",
        "outside_feasibility": "FEASIBLE_DECLARED",
        "minimum_extra_cash": "100.00",
        "cash": {
            "COOPERATION": cash(external_sales=external_extra),
            "INDEPENDENT_ALTERNATIVE": cash(),
        },
        "requires_accepted_results": [
            {"work": "w1", "source_revision": "d-1"},
        ],
    }


def original_owner_outlook_case():
    d = scoped_bilateral_payment_case()
    d["endogenous_subjects"] = True
    d["decision_profiles"] = [
        row for row in d.get("decision_profiles", [])
        if not (row["subject"] == "b" and row["work"] == "w2")
    ] + [{
        "subject": "b", "work": "w2",
        "source_revision": "d-2", "org_revision": "oc-1",
        "willingness": "WILLING", "outside_option": "UNKNOWN",
    }]
    d["context_evidence"]["sources"].append({
        "id": REF, "owner": "b", "revision": "outlook-r1",
        "status": "CONFIRMED", "usable_by": ["b"],
        "core": "corporate", "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
        "operations": ["READ"], "valid_from": 0, "valid_until": 110,
    })
    d["economic_outlooks"] = [forecast()]
    return d


def owner_rows(output):
    return [
        row for row in output["decision_observations"]
        if row.get("subject") == "b" and row.get("work") == "w2"
    ]


def test_original_owner_outlook_for_future_coalition_works_only_after_applied_edition():
    d = original_owner_outlook_case()
    snapshot = deepcopy(d)
    out = simulate(d)
    assert d == snapshot
    assert out["counts"]["blocked"] == 0
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert any(row["action"] == "cooperation_membership_apply"
               and row["outcome"] == "APPLIED" for row in out["trace"])
    rows = owner_rows(out)
    assert any(row.get("economic_position") == "COOPERATION_PREFERRED"
               for row in rows)
    assert all(row.get("effect") == "NO_AUTOMATIC_CONSENT" for row in rows)
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_future_coalition_declaration_not_live_before_original_apply():
    d = original_owner_outlook_case()
    initial = OperatorAKISModel(d).qualitative
    parsed = parse_outlooks(
        d["economic_outlooks"], initial.subjects,
        initial.cooperation_links,
        known_works={"w1", "w2"},
        future_membership_events=initial.events,
    )
    assert len(parsed) == 1
    w2 = SimpleNamespace(key="w2", source_revision="d-2")
    assert choose_outlook(
        parsed, owner="b", work=w2, org_revision="oc-1",
        links=initial.cooperation_links, at=60,
        works=initial.works,
        context_basis=initial.context_basis,
        owner_core="corporate",
    )["position"] == "UNKNOWN"


@pytest.mark.parametrize("mutation", [
    lambda d: d["economic_outlooks"][0].pop("source_revision"),
    lambda d: d["economic_outlooks"][0].update(source_revision="outlook-r2"),
    lambda d: d["economic_outlooks"][0].update(source_ref="model://b/absent"),
    lambda d: next(row for row in d["context_evidence"]["sources"]
                   if row["id"] == REF).update(status="DISPROVED"),
    lambda d: next(row for row in d["context_evidence"]["sources"]
                   if row["id"] == REF).update(operations=["SHARE"]),
])
def test_unpinned_stale_missing_revoked_or_wrong_scope_forecast_is_unknown(mutation):
    d = original_owner_outlook_case()
    mutation(d)
    out = simulate(d)
    rows = owner_rows(out)
    assert rows
    assert not any(row.get("economic_position") == "COOPERATION_PREFERRED"
                   for row in rows)
    assert any(row.get("economic_reason")
               == "ORIGINAL_OWNER_ECONOMIC_SOURCE_NOT_QUALIFIED"
               for row in rows)
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_future_membership_cannot_be_forged_by_forecast_revision():
    d = original_owner_outlook_case()
    d["economic_outlooks"][0]["relation_source_revision"] = "unapplied-r3"
    initial = OperatorAKISModel(original_owner_outlook_case()).qualitative
    with pytest.raises(
        OutlookInputError, match="OUTLOOK_RELATION_OWNER_REQUIRED",
    ):
        parse_outlooks(
            d["economic_outlooks"], initial.subjects,
            initial.cooperation_links,
            future_membership_events=initial.events,
        )


def test_owner_cash_price_change_reverses_private_advice_without_silent_consent():
    positive = original_owner_outlook_case()
    negative = deepcopy(positive)
    negative["economic_outlooks"][0]["cash"][
        "COOPERATION"
    ]["operator_fee_cash"] = "2500.00"
    first, second = simulate(positive), simulate(negative)
    assert any(row.get("economic_position") == "COOPERATION_PREFERRED"
               for row in owner_rows(first))
    assert any(row.get("economic_position") == "OUTSIDE_PREFERRED"
               for row in owner_rows(second))
    assert first["trace"] == second["trace"]
    assert first["works"] == second["works"]
    assert second["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert second["profit"]["system_increment"] == "UNKNOWN"


def test_owner_source_revision_switch_changes_model_choice_not_original_work():
    d = original_owner_outlook_case()
    source_update = e(
        0, "source_update", "b", source=REF,
        status="CONFIRMED", expected_revision="outlook-r1",
        new_revision="outlook-r2",
    )
    _insert_before(
        d["events"],
        lambda event: event["action"] == "consent"
        and event.get("work") == "w2" and event["actor"] == "b",
        source_update,
    )
    change_time = source_update["at"]
    d["events"].sort(key=lambda row: row["at"])
    d["economic_outlooks"].append(
        forecast(revision="outlook-r2", available_at=change_time,
                 external_extra="0.00")
    )
    d["economic_outlooks"][-1]["cash"][
        "COOPERATION"
    ]["operator_fee_cash"] = "2500.00"
    d["model_horizon"] = max(d["model_horizon"], 105)
    before = deepcopy(d)
    out = simulate(d)
    assert d == before
    assert any(row["action"] == "source_update"
               and row["outcome"] == "APPLIED" for row in out["trace"])
    assert any(row.get("economic_position") == "COOPERATION_PREFERRED"
               for row in owner_rows(out) if row["at"] < change_time)
    assert any(row.get("economic_position") == "OUTSIDE_PREFERRED"
               for row in owner_rows(out) if row["at"] >= change_time)
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["economics"]["economic_value_added"] == "NOT_IDENTIFIABLE"


def test_owner_negative_outlook_cannot_replace_actual_work_refusal():
    d = original_owner_outlook_case()
    d["economic_outlooks"][0]["cash"][
        "COOPERATION"
    ]["operator_fee_cash"] = "2500.00"
    d["events"] = [
        event for event in d["events"]
        if not (
            event["action"] == "consent" and
            event.get("work") == "w2" and event["actor"] == "b"
        )
    ]
    out = simulate(d)
    assert any(row.get("economic_position") == "OUTSIDE_PREFERRED"
               for row in owner_rows(out))
    assert any(row["action"] == "commit"
               and row["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"
               for row in out["trace"])
    assert out["works"]["w2"]["result"] == "NOT_SUBMITTED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_owner_forecast_and_original_context_sources_are_not_shared_as_cash():
    out = simulate(original_owner_outlook_case())
    import json
    safe = json.dumps({
        "decision_observations": out["decision_observations"],
        "endogenous_subjects": out["endogenous_subjects"],
        "general_akis_model": out["general_akis_model"],
    }, ensure_ascii=False)
    assert REF not in safe
    assert "2500.00" not in safe
    assert "opening_cash" not in safe
    assert out["economics"]["work_payment_causality"][
        "settlement_progress"
    ]["actual_bank_payment_verified"] is False
