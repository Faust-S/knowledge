"""AKIS R3: three ORIGINAL Work periods with owner-scoped economics.

First and second original Results remain accepted. A third original Work
depends on a newly adopted capacity, post-Result need, original parties'
independent interests, original formation/OC and source-qualified research
outlooks. The original Mesa alone executes every Work/Result transition.
"""
from copy import deepcopy
import json

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.three_period_original_work import (
    MultiPeriodEvidenceError, original_three_period_evidence,
)
from .test_r1p_original_capability_cooperation_cycle_mesa import r1p_case
from .test_r1l_post_result_original_reproduction_mesa import find


SOURCE_A = "model://a/r3-third-work-owner-outlook"
SOURCE_B = "model://b/r3-third-work-owner-outlook"
OWNER_REFS = {"a": SOURCE_A, "b": SOURCE_B}
CHANNELS = (
    "external_sales", "member_supply_receipts", "external_purchases",
    "member_supply_payments", "production_cash", "transaction_cash",
    "marketing_cash", "logistics_cash", "operator_fee_cash",
    "reconfiguration_cash",
)


def _cash(**extra):
    row = {key: "0.00" for key in CHANNELS}
    row.update(extra)
    return row


def _forecast(owner, amount):
    return {
        "owner": owner,
        "relation": "l1",
        "work": "w3",
        "work_source_revision": "d-3",
        "relation_source_revision": "rel-1",
        "org_revision": "oc-1",
        "available_at": 82,
        "expires_at": 150,
        "source_ref": OWNER_REFS[owner],
        "source_revision": "outlook-r3-v1",
        "period": "THIRD_ORIGINAL_WORK",
        "currency": "RUB",
        "coverage": "COMPLETE_DECLARED",
        "outside_feasibility": "FEASIBLE_DECLARED",
        "minimum_extra_cash": "100.00",
        "cash": {
            "COOPERATION": _cash(external_sales=amount),
            "INDEPENDENT_ALTERNATIVE": _cash(),
        },
        "requires_accepted_results": [
            {"work": "w2", "source_revision": "d-2"},
        ],
    }


def original_three_period_economic_case(*, adopt=True):
    scenario = r1p_case(adopt=adopt)
    scenario["endogenous_subjects"] = True
    scenario["decision_profiles"] = [
        profile for profile in scenario.get("decision_profiles", [])
        if profile.get("work") != "w3"
    ]
    for owner in OWNER_REFS:
        scenario["decision_profiles"].append({
            "subject": owner,
            "work": "w3",
            "source_revision": "d-3",
            "org_revision": "oc-1",
            "willingness": "WILLING",
            "outside_option": "UNKNOWN",
        })
        scenario["context_evidence"]["sources"].append({
            "id": OWNER_REFS[owner],
            "owner": owner,
            "revision": "outlook-r3-v1",
            "status": "CONFIRMED",
            "usable_by": [owner],
            "core": "corporate",
            "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
            "operations": ["READ"],
            "valid_from": 0,
            "valid_until": 160,
        })
    # Original source-qualified independent decisions remain the only actual
    # decisions. These UNKNOWN preferences permit a forecast to refine an
    # in-memory modeled opinion without overriding a known owner preference.
    owner_interest_count = 0
    for event in scenario["events"]:
        if event["action"] == "interest_update" and event.get("work") == "w3":
            event["new_willingness"] = "WILLING"
            event["new_outside_option"] = "UNKNOWN"
            owner_interest_count += 1
    assert owner_interest_count == 2
    scenario["economic_outlooks"] = [
        _forecast("a", "1500.00"),
        _forecast("b", "1100.00"),
    ]
    return scenario


def independent_outside_case():
    d = original_three_period_economic_case()
    d["economic_outlooks"][0]["cash"]["COOPERATION"][
        "operator_fee_cash"
    ] = "2600.00"
    interest = next(row for row in d["events"]
                    if row["action"] == "interest_update"
                    and row.get("work") == "w3" and row["actor"] == "a")
    interest["new_willingness"] = "DECLINES"
    interest["new_outside_option"] = "OUTSIDE_PREFERRED"
    return d


def scenarios():
    base = original_three_period_economic_case()
    negative_advice = deepcopy(base)
    negative_advice["economic_outlooks"][0]["cash"]["COOPERATION"][
        "operator_fee_cash"
    ] = "2600.00"
    stale = deepcopy(base)
    stale["economic_outlooks"][0]["source_revision"] = "outlook-r3-stale"
    declined = independent_outside_case()
    not_adopted = original_three_period_economic_case(adopt=False)
    no_acceptance = deepcopy(base)
    no_acceptance["events"] = [
        event for event in no_acceptance["events"]
        if not (
            event["action"] == "accept"
            and event.get("work") == "w3"
        )
    ]
    return {
        "accepted_three_results": base,
        "advice_reverses_without_new_consent": negative_advice,
        "source_revision_stale": stale,
        "independent_owner_declines_third_work": declined,
        "original_capacity_not_adopted": not_adopted,
        "third_result_not_accepted": no_acceptance,
    }


def three_period_run():
    inputs = scenarios()
    frozen = deepcopy(inputs)
    outputs = {key: simulate(value) for key, value in inputs.items()}
    assert inputs == frozen
    views = {name: original_three_period_evidence(out)
             for name, out in outputs.items()}
    return inputs, outputs, views


def _owner_obs(out, owner):
    return [
        row for row in out["decision_observations"]
        if row.get("subject") == owner and row.get("work") == "w3"
        and "economic_position" in row
    ]


def test_three_original_work_periods_reproduce_new_result_after_owner_capacity():
    original = original_three_period_economic_case()
    before = deepcopy(original)
    out = simulate(original)
    assert original == before
    assert out["counts"]["blocked"] == 0, [
        (row["at"], row["action"], row["reason"])
        for row in out["trace"] if row["outcome"] == "BLOCKED"
    ]
    assert [out["works"][name]["result"] for name in ("w1", "w2", "w3")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    ] * 3
    assert find(out, "adopt_capability")[0]["outcome"] == "APPLIED"
    assert find(out, "request", work="w3")[0]["outcome"] == "APPLIED"
    assert find(out, "commit", work="w3")[0]["outcome"] == "APPLIED"
    for who in ("a", "b"):
        assert any(row["economic_position"] == "COOPERATION_PREFERRED"
                   for row in _owner_obs(out, who))
    witness = original_three_period_evidence(out)
    assert len(witness["work_periods"]) == 3
    assert all(item["recipient_acceptance_applied"]
               for item in witness["work_periods"])
    assert witness["original_owner_capability_adopted"]
    assert witness["original_result_capability_cooperation_chain_witnessed"]
    assert witness["measured_incremental_network_value"] == "NOT_IDENTIFIABLE"


def test_owner_cash_advice_reverses_but_does_not_rewrite_any_original_Work_or_Result():
    positive, negative = (original_three_period_economic_case(),
                          scenarios()["advice_reverses_without_new_consent"])
    start, shifted = simulate(positive), simulate(negative)
    assert any(row["economic_position"] == "COOPERATION_PREFERRED"
               for row in _owner_obs(start, "a"))
    assert any(row["economic_position"] == "OUTSIDE_PREFERRED"
               for row in _owner_obs(shifted, "a"))
    assert start["trace"] == shifted["trace"]
    assert start["works"] == shifted["works"]
    assert start["profit"]["system_increment"] == "UNKNOWN"


def test_owner_explicit_refusal_blocks_future_result_but_preserves_first_two():
    d = independent_outside_case()
    out = simulate(d)
    assert [out["works"][work]["result"] for work in ("w1", "w2")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    ] * 2
    assert find(out, "interest_update", work="w3")[-1]["outcome"] == "APPLIED"
    assert find(out, "commit", work="w3")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert original_three_period_evidence(out)["work_periods"][-1][
        "recipient_acceptance_applied"
    ] is False


def test_owner_must_originally_adopt_capacity_before_any_third_Work():
    out = simulate(original_three_period_economic_case(adopt=False))
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert find(out, "request", work="w3")[0]["reason"] == (
        "FORMATION_CAPABILITY_ORIGINAL_OWNER_ADOPTION_REQUIRED"
    )
    assert "w3" not in out["works"]
    assert original_three_period_evidence(out)["work_periods"][-1][
        "original_result"
    ] == "NOT_CREATED"


def test_third_Work_submission_does_not_count_as_accepted_result():
    d = scenarios()["third_result_not_accepted"]
    out = simulate(d)
    assert [out["works"][w]["result"] for w in ("w1", "w2")] == [
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    ] * 2
    assert out["works"]["w3"]["result"] == "SUBMITTED"
    assert original_three_period_evidence(out)["work_periods"][-1][
        "recipient_acceptance_applied"
    ] is False


@pytest.mark.parametrize("break_source", [
    lambda d: d["economic_outlooks"][0].update(source_revision="old-revision"),
    lambda d: next(row for row in d["context_evidence"]["sources"]
                   if row["id"] == SOURCE_A).update(status="DISPROVED"),
    lambda d: next(row for row in d["context_evidence"]["sources"]
                   if row["id"] == SOURCE_A).update(operations=["SHARE"]),
    lambda d: next(row for row in d["context_evidence"]["sources"]
                   if row["id"] == SOURCE_A).update(usable_by=["b"]),
    lambda d: next(row for row in d["context_evidence"]["sources"]
                   if row["id"] == SOURCE_A).update(valid_until=79),
])
def test_revision_pinned_forecast_uses_same_original_context_basis_even_when_legacy_work_not_strict(break_source):
    d = original_three_period_economic_case()
    break_source(d)
    out = simulate(d)
    owner = _owner_obs(out, "a")
    assert owner
    assert any(row.get("economic_reason")
               == "ORIGINAL_OWNER_ECONOMIC_SOURCE_NOT_QUALIFIED"
               for row in owner)
    assert not any(row.get("economic_position") == "COOPERATION_PREFERRED"
                   for row in owner)
    assert out["works"]["w3"]["result"] == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )


def test_unverified_owner_forecast_does_not_overwrite_prior_original_results():
    _, outputs, views = three_period_run()
    for name, output in outputs.items():
        assert [output["works"][w]["result"] for w in ("w1", "w2")] == [
            "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        ] * 2, name
        assert views[name]["previous_accepted_results_preserved"]
        assert views[name]["owner_outlook_cannot_authorize_original_work"]
        assert views[name]["measured_incremental_network_value"] == "NOT_IDENTIFIABLE"
        assert not views[name]["empirical_scientific_closure"]


def test_original_result_witness_cannot_be_forged_from_research_forecast():
    out = simulate(scenarios()["independent_owner_declines_third_work"])
    forged = deepcopy(out)
    forged["works"]["w3"]["result"] = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    with pytest.raises(
        MultiPeriodEvidenceError,
        match="R3_ACCEPTED_RESULT_NOT_IN_ORIGINAL_TRACE",
    ):
        original_three_period_evidence(forged)


def test_owner_private_economic_values_sources_are_not_in_public_period_report():
    _, outputs, views = three_period_run()
    public = json.dumps(views, ensure_ascii=False, sort_keys=True)
    for secret in (SOURCE_A, SOURCE_B, "model://", "2600.00", "1500.00",
                   "1100.00", "opening_cash", "reserve_cash"):
        assert secret not in public
    assert all(
        row["cash_or_source_identifiers_disclosed"] is False
        for row in views.values()
    )
    assert all(out["profit"]["system_increment"] == "UNKNOWN"
               for out in outputs.values())


def test_every_third_cycle_owner_position_remains_an_unsignable_model_action():
    for name, output in three_period_run()[1].items():
        for observation in output["decision_observations"]:
            if observation.get("work") == "w3":
                assert observation.get("effect") == "NO_AUTOMATIC_CONSENT", name
