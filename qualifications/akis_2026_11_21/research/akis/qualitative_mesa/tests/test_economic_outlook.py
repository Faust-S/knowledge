"""Time-qualified owner-private economic research outlook; not actual profit."""
from types import SimpleNamespace as N

import pytest

from research.akis.qualitative_mesa.economic_outlook import (
    OutlookInputError, choose_outlook, parse_outlooks,
)


CHANNELS = ("external_sales", "member_supply_receipts", "external_purchases",
            "member_supply_payments", "production_cash", "transaction_cash",
            "marketing_cash", "logistics_cash", "operator_fee_cash",
            "reconfiguration_cash")


def cash(**changes):
    row = {key: "0.00" for key in CHANNELS}
    row.update(changes)
    return row


def outlook(owner="a", relation="joint", at=2):
    return {
        "owner": owner, "relation": relation, "work": "w1",
        "work_source_revision": "w-r1", "relation_source_revision": "r1",
        "org_revision": "oc1", "available_at": at, "expires_at": 10,
        "source_ref": f"model://{owner}/quote-{at}",
        "period": "month1", "currency": "RUB", "coverage": "COMPLETE_DECLARED",
        "outside_feasibility": "FEASIBLE_DECLARED",
        "minimum_extra_cash": "5.00",
        "cash": {
            "INDEPENDENT_ALTERNATIVE": cash(
                external_sales="120.00", external_purchases="40.00",
                transaction_cash="30.00", marketing_cash="20.00"),
            "COOPERATION": cash(
                external_sales="120.00", external_purchases="30.00",
                transaction_cash="10.00", marketing_cash="8.00",
                operator_fee_cash="9.00", reconfiguration_cash="5.00"),
        },
    }


LINKS = (N(key="joint", participants=("a", "b", "op"),
           works=("w1",), source_revision="r1"),)
SUBJECTS = {key: N(kind="SME") for key in ("a", "b", "op")}
WORK = N(key="w1", source_revision="w-r1")


def evaluate(rows, *, at=4, links=LINKS, work=WORK, org="oc1"):
    parsed = parse_outlooks(rows, SUBJECTS, links)
    return choose_outlook(parsed, owner="a", work=work, org_revision=org,
                          links=links, at=at)


def test_procurement_search_advertising_operator_and_reconfiguration_are_net():
    row = evaluate([outlook()])
    assert row["position"] == "COOPERATION_PREFERRED"
    detail = row["private_owner_comparison"]
    assert detail["cash_difference_cooperation_minus_outside"] == "28.00"
    assert detail["cash_contribution_difference_by_channel"]["transaction_cash"] == "20.00"
    assert detail["cash_contribution_difference_by_channel"]["marketing_cash"] == "12.00"
    assert detail["cash_contribution_difference_by_channel"]["operator_fee_cash"] == "-9.00"
    assert detail["cash_contribution_difference_by_channel"]["reconfiguration_cash"] == "-5.00"
    assert detail["resource_uses_not_added"]
    assert detail["interfirm_transfers_not_consolidated"]


def test_operator_fee_can_reverse_independent_choice_despite_purchase_discount():
    candidate = outlook()
    candidate["cash"]["COOPERATION"]["operator_fee_cash"] = "60.00"
    outcome = evaluate([candidate])
    assert outcome["position"] == "OUTSIDE_PREFERRED"
    assert outcome["private_owner_comparison"]["cash_difference_cooperation_minus_outside"] == "-23.00"


def test_reservation_margin_and_unverified_comparability_block_premature_preference():
    row = outlook()
    row["minimum_extra_cash"] = "30.00"
    assert evaluate([row])["position"] == "UNKNOWN"
    for field, value in (("coverage", "PARTIAL"),
                         ("outside_feasibility", "UNKNOWN"),
                         ("outside_feasibility", "NOT_FEASIBLE_DECLARED")):
        row = outlook()
        row[field] = value
        assert evaluate([row])["reason"] == "INCOMPLETE_OR_UNFEASIBLE_COMPARISON"


def test_forecast_is_unavailable_before_publication_or_after_expiry_and_revision():
    assert evaluate([outlook()], at=1)["position"] == "UNKNOWN"
    assert evaluate([outlook()], at=10)["position"] == "UNKNOWN"
    assert evaluate([outlook()], org="oc2")["position"] == "UNKNOWN"
    assert evaluate([outlook()], work=N(key="w1", source_revision="w-r2"))["position"] == "UNKNOWN"
    altered = (N(key="joint", participants=("a", "b"),
                 works=("w1",), source_revision="r2"),)
    assert evaluate([outlook()], links=altered)["position"] == "UNKNOWN"


def test_new_owner_forecast_changes_future_assessment_not_past_assessment():
    former, revised = outlook(), outlook(at=4)
    revised["cash"]["COOPERATION"]["operator_fee_cash"] = "60.00"
    assert evaluate([former, revised], at=3)["position"] == "COOPERATION_PREFERRED"
    assert evaluate([former, revised], at=4)["position"] == "OUTSIDE_PREFERRED"


def test_ambiguous_organizational_relations_cannot_be_auto_combined():
    other = N(key="other", participants=("a", "b"),
              works=("w1",), source_revision="r1")
    result = evaluate([outlook(), outlook(relation="other", at=3)],
                      links=LINKS + (other,))
    assert result["reason"] == "MULTIPLE_RELATIONS_REQUIRE_OWNER_CHOICE"


@pytest.mark.parametrize("changes, reason", [
    ({"source_ref": "model://op/fake"}, "OUTLOOK_OWNER_SOURCE_REQUIRED"),
    ({"available_at": True}, "OUTLOOK_TIME_INVALID"),
    ({"expires_at": 2}, "OUTLOOK_TIME_INVALID"),
    ({"owner": "outsider"}, "OUTLOOK_OWNER_UNKNOWN"),
    ({"relation": "other"}, "OUTLOOK_RELATION_OWNER_REQUIRED"),
    ({"currency": "USDT"}, "INVALID_OUTLOOK_CURRENCY"),
    ({"minimum_extra_cash": "-4.00"}, "INVALID_OUTLOOK_AMOUNT"),
])
def test_invalid_forecast_cannot_enter_the_model(changes, reason):
    row = outlook()
    row.update(changes)
    with pytest.raises(OutlookInputError, match=reason):
        parse_outlooks([row], SUBJECTS, LINKS)


def test_complete_nonoverlapping_cash_channels_are_required():
    row = outlook()
    del row["cash"]["COOPERATION"]["transaction_cash"]
    with pytest.raises(OutlookInputError, match="INVALID_OUTLOOK_CASH_CHANNELS"):
        parse_outlooks([row], SUBJECTS, LINKS)
    row = outlook()
    row["cash"]["COOPERATION"]["external_sales"] = 120.0
    with pytest.raises(OutlookInputError, match="INVALID_OUTLOOK_AMOUNT"):
        parse_outlooks([row], SUBJECTS, LINKS)


def test_duplicate_owner_hypotheses_same_time_not_interpreted_as_facts():
    with pytest.raises(OutlookInputError, match="DUPLICATE_OUTLOOK"):
        parse_outlooks([outlook(), outlook()], SUBJECTS, LINKS)


def test_accepted_prior_result_is_required_before_using_conditional_discount():
    row = outlook()
    row["requires_accepted_results"] = [{"work": "w0", "source_revision": "r0"}]
    parsed = parse_outlooks([row], SUBJECTS, LINKS, known_works={"w0", "w1"})
    def evaluate_state(result, revision="r0"):
        previous = N(key="w0", source_revision=revision, result=result)
        return choose_outlook(parsed, owner="a", work=WORK, org_revision="oc1",
                              links=LINKS, at=4, works={"w0": previous})
    assert evaluate_state("NOT_SUBMITTED")["reason"] == "PRIOR_RESULT_NOT_ACCEPTED"
    assert evaluate_state("REJECTED")["position"] == "UNKNOWN"
    assert evaluate_state("ACCEPTED_BY_ORIGINAL_RECIPIENT")["position"] == "COOPERATION_PREFERRED"
    assert evaluate_state("ACCEPTED_BY_ORIGINAL_RECIPIENT", "stale")["position"] == "UNKNOWN"
    assert choose_outlook(parsed, owner="a", work=WORK, org_revision="oc1",
                          links=LINKS, at=4)["reason"] == "PRIOR_RESULT_CONTEXT_MISSING"


def test_accepted_prior_result_does_not_manufacture_individual_net_advantage():
    row = outlook()
    row["requires_accepted_results"] = [{"work": "w0", "source_revision": "r0"}]
    row["cash"]["COOPERATION"]["operator_fee_cash"] = "70.00"
    parsed = parse_outlooks([row], SUBJECTS, LINKS, known_works={"w0", "w1"})
    previous = N(key="w0", source_revision="r0",
                 result="ACCEPTED_BY_ORIGINAL_RECIPIENT")
    assessment = choose_outlook(parsed, owner="a", work=WORK, org_revision="oc1",
                                links=LINKS, at=4, works={"w0": previous})
    assert assessment["position"] == "OUTSIDE_PREFERRED"


@pytest.mark.parametrize("dependencies,reason", [
    ([{"work": "w1", "source_revision": "r0"}], "INVALID_OUTLOOK_PRIOR_RESULT_LINK"),
    ([{"work": "w0", "source_revision": "r0"}, {"work": "w0", "source_revision": "r0"}],
     "INVALID_OUTLOOK_PRIOR_RESULT_LINK"),
    ([{"work": "unknown", "source_revision": "r0"}], "OUTLOOK_PRIOR_WORK_NOT_DECLARED"),
    ([{"work": "w0"}], "INVALID_OUTLOOK_PRIOR_RESULT_FIELDS"),
    ({"w0": "r0"}, "INVALID_OUTLOOK_PRIOR_RESULT_COUNT"),
])
def test_prior_result_source_bounds(dependencies, reason):
    row = outlook()
    row["requires_accepted_results"] = dependencies
    with pytest.raises(OutlookInputError, match=reason):
        parse_outlooks([row], SUBJECTS, LINKS, known_works={"w0", "w1"})
