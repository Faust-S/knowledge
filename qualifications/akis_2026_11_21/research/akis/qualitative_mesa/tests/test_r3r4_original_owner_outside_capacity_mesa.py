"""R3-R4: outside economic alternatives must fit ORIGINAL owner capacity.

The owner can declare an external economic alternative, but a capacity check
uses existing CapacityLedger.preview, never reserve, commit or new Work.
A successful model preview cannot certify customers, prices or payments.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.economic_outlook import (
    OutlookInputError, parse_outlooks,
)
from research.akis.qualitative_mesa.mesa_model import (
    OperatorAKISModel, simulate,
)
from research.akis.qualitative_mesa.tests.test_r3_three_period_original_owner_economics_mesa import (
    _owner_obs, original_three_period_economic_case,
)
from research.akis.qualitative_mesa.tests.test_r1l_post_result_original_reproduction_mesa import find


def probed(*, owner="a", resource="ra", units=1, start=106, end=120):
    d = original_three_period_economic_case()
    forecast = next(row for row in d["economic_outlooks"]
                    if row["owner"] == owner)
    forecast["outside_capacity_probe"] = {
        "resource": resource, "units": units,
        "slot_start": start, "slot_end": end,
    }
    return d


def owner_assessments(output, owner="a"):
    return [
        (row["at"], row["economic_position"], row.get("economic_reason"))
        for row in _owner_obs(output, owner)
    ]


def assert_owner_reason(output, reason, owner="a"):
    observations = owner_assessments(output, owner)
    assert any(entry[2] == reason for entry in observations), observations


def test_original_owner_option_is_previewed_without_reserving_or_creating_work():
    baseline = original_three_period_economic_case()
    prepared = probed()
    original = deepcopy(prepared)
    old, now = simulate(baseline), simulate(prepared)
    assert prepared == original
    assert now["trace"] == old["trace"]
    assert now["works"] == old["works"]
    assert now["counts"] == old["counts"]
    assert find(now, "commit", work="w3")[0]["outcome"] == "APPLIED"
    assert all(
        now["works"][name]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        for name in ("w1", "w2", "w3")
    )
    assert any(entry[1] == "COOPERATION_PREFERRED"
               for entry in owner_assessments(now))
    assert not any("__akis_outside_candidate__" in str(row)
                   for row in now["trace"])
    assert not any(key.startswith("__akis_outside_candidate__")
                   for key in now["works"])
    assert now["profit"]["system_increment"] == "UNKNOWN"


def test_private_outside_amount_reverses_advice_only_with_original_resource():
    positive, negative = probed(), probed()
    negative["economic_outlooks"][0]["cash"]["COOPERATION"][
        "operator_fee_cash"
    ] = "2600.00"
    a, b = simulate(positive), simulate(negative)
    assert any(row[1] == "COOPERATION_PREFERRED"
               for row in owner_assessments(a))
    assert any(row[1] == "OUTSIDE_PREFERRED"
               for row in owner_assessments(b))
    assert a["works"] == b["works"]
    assert a["trace"] == b["trace"]
    assert b["profit"]["system_increment"] == "UNKNOWN"


def test_two_unit_external_claim_cannot_use_capacity_adopted_only_for_w3():
    d = probed(units=2)
    output = simulate(d)
    assert_owner_reason(output, "OUTSIDE_CAPACITY_ORIGINAL_RESERVATIONS_OR_SCOPE_BLOCK")
    assert not any(item[1] in ("COOPERATION_PREFERRED", "OUTSIDE_PREFERRED")
                   for item in owner_assessments(output))
    assert output["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert output["capability_dynamics"]["original_owner_adopted_count"] == 1


def test_customer_cannot_claim_supplier_original_capacity_as_own_outside_option():
    d = probed(owner="b")
    output = simulate(d)
    assert_owner_reason(output, "OUTSIDE_CAPACITY_INDEPENDENT_RESOURCE_OWNER_REQUIRED", "b")
    assert output["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_absent_resource_cannot_be_proved_by_a_forecast_string():
    d = probed(resource="imaginary-resource")
    output = simulate(d)
    assert_owner_reason(output, "OUTSIDE_CAPACITY_INDEPENDENT_RESOURCE_OWNER_REQUIRED")
    assert output["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_different_delivery_horizon_is_not_a_comparable_outside_option():
    d = probed(start=107, end=120)
    output = simulate(d)
    assert_owner_reason(output, "OUTSIDE_CAPACITY_COMPARABLE_WORK_HORIZON_REQUIRED")
    assert not any(item[1] == "COOPERATION_PREFERRED"
                   for item in owner_assessments(output))


def test_owner_unavailable_resource_is_not_an_attainable_external_option():
    d = probed()
    d["events"].append({
        "at": 80, "action": "resource_status", "actor": "a",
        "resource": "ra", "availability": "UNAVAILABLE",
    })
    d["events"].sort(key=lambda row: row["at"])
    output = simulate(d)
    assert find(output, "resource_status")[0]["outcome"] == "APPLIED"
    assert_owner_reason(output, "OUTSIDE_CAPACITY_ORIGINAL_RESOURCE_NOT_READY")
    assert all(output["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1", "w2"))


def test_owner_recovery_requires_original_resource_event_not_forecast_claim():
    d = probed()
    for at, status in ((80, "UNAVAILABLE"), (81, "AVAILABLE")):
        d["events"].append({
            "at": at, "action": "resource_status", "actor": "a",
            "resource": "ra", "availability": status,
        })
    d["events"].sort(key=lambda row: row["at"])
    output = simulate(d)
    assert [item["outcome"] for item in find(output, "resource_status")] == [
        "APPLIED", "APPLIED",
    ]
    assert any(entry[1] == "COOPERATION_PREFERRED"
               for entry in owner_assessments(output))
    assert output["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_stale_owner_source_blocks_capacity_even_when_original_resource_is_ready():
    d = probed()
    d["economic_outlooks"][0]["source_revision"] = "foreign-stale"
    output = simulate(d)
    assert_owner_reason(output, "ORIGINAL_OWNER_ECONOMIC_SOURCE_NOT_QUALIFIED")
    assert not any(item[1] == "COOPERATION_PREFERRED"
                   for item in owner_assessments(output))
    assert output["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_owner_independent_refusal_dominates_positive_resource_and_cash_signal():
    d = probed()
    update = next(row for row in d["events"]
                  if row["action"] == "interest_update"
                  and row.get("work") == "w3" and row["actor"] == "a")
    update["new_willingness"] = "DECLINES"
    update["new_outside_option"] = "OUTSIDE_PREFERRED"
    result = simulate(d)
    assert any(item[1] == "COOPERATION_PREFERRED"
               for item in owner_assessments(result))
    assert find(result, "commit", work="w3")[0]["outcome"] == "BLOCKED"
    assert result["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert all(result["works"][w]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1", "w2"))


@pytest.mark.parametrize("mutation,code", [
    (lambda x: x.update(units=True),
     "OUTLOOK_OUTSIDE_CAPACITY_PROBE_WINDOW_OR_UNITS_INVALID"),
    (lambda x: x.update(units=0),
     "OUTLOOK_OUTSIDE_CAPACITY_PROBE_WINDOW_OR_UNITS_INVALID"),
    (lambda x: x.update(slot_start=120),
     "OUTLOOK_OUTSIDE_CAPACITY_PROBE_WINDOW_OR_UNITS_INVALID"),
    (lambda x: x.update(slot_end=120.0),
     "OUTLOOK_OUTSIDE_CAPACITY_PROBE_WINDOW_OR_UNITS_INVALID"),
    (lambda x: x.update(unexpected_field="side-effect"),
     "OUTLOOK_OUTSIDE_CAPACITY_PROBE_FIELDS_INVALID"),
])
def test_invalid_outside_resource_proof_rejected_at_parser(mutation, code):
    d = probed()
    mutation(d["economic_outlooks"][0]["outside_capacity_probe"])
    before = OperatorAKISModel(original_three_period_economic_case()).qualitative
    with pytest.raises(OutlookInputError, match=code):
        parse_outlooks(
            d["economic_outlooks"],
            subjects=before.subjects,
            links=before.cooperation_links,
        )


def test_capacity_probe_requires_original_revision_pinned_private_source():
    d = probed()
    d["economic_outlooks"][0].pop("source_revision")
    before = OperatorAKISModel(original_three_period_economic_case()).qualitative
    with pytest.raises(
        OutlookInputError,
        match="OUTLOOK_OUTSIDE_CAPACITY_REQUIRES_PINNED_OWNER_SOURCE",
    ):
        parse_outlooks(
            d["economic_outlooks"],
            subjects=before.subjects,
            links=before.cooperation_links,
        )


def test_capacity_probe_never_generates_verified_external_offer_or_profit():
    out = simulate(probed())
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert not any(
        row.get("action") == "accept"
        and str(row.get("work", "")).startswith("__akis_outside_candidate__")
        for row in out["trace"]
    )
    assert out["general_akis_model"]["legal_consent_created"] is False
