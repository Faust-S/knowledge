"""Independent original principals' prospective price feasibility, not an accepted deal."""
from copy import deepcopy
import pytest

from research.akis.qualitative_mesa.partner_discovery import (
    DiscoveryInputError, assess_bilateral_finance, discover, parse_discovery,
    parse_formation_finance,
)
from research.akis.qualitative_mesa.tests.test_partner_discovery import raw, world


CHANNELS = (
    "external_receipts_cash", "external_purchases_cash", "production_cash",
    "transaction_cash", "marketing_cash", "logistics_cash",
    "verification_cash", "switching_cash", "risk_reserve_cash",
    "operator_fee_cash", "financing_cash",
)


def cash(**changes):
    value = {k: "0.00" for k in CHANNELS}
    value.update(changes)
    return value


def pair():
    b = {
        "side": "BUYER", "owner": "buyer", "demand": "D1", "offer": "S1",
        "source_ref": "model://buyer/quote-b-1", "demand_source_ref": "model://buyer/need-1",
        "offer_source_ref": "model://supplier/cap-1", "work_source_revision": "wr1",
        "available_at": 2, "expires_at": 18, "period": "cycle1", "currency": "RUB",
        "coverage": "COMPLETE_DECLARED", "outside_feasibility": "FEASIBLE_DECLARED",
        "intent": "WILLING", "outside_net_cash": "100.00",
        "minimum_increment_cash": "20.00",
        "cooperative_external_cash": cash(
            external_receipts_cash="500.00", external_purchases_cash="50.00",
            production_cash="100.00", transaction_cash="20.00",
            marketing_cash="10.00", logistics_cash="10.00",
            verification_cash="10.00", switching_cash="10.00",
            risk_reserve_cash="5.00", operator_fee_cash="5.00"),
        "liquidity": {"max_supplier_payment_cash": "155.00"},
    }
    p = {
        "side": "PROVIDER", "owner": "supplier", "demand": "D1", "offer": "S1",
        "source_ref": "model://supplier/quote-p-1", "demand_source_ref": "model://buyer/need-1",
        "offer_source_ref": "model://supplier/cap-1", "work_source_revision": "wr1",
        "available_at": 2, "expires_at": 18, "period": "cycle1", "currency": "RUB",
        "coverage": "COMPLETE_DECLARED", "outside_feasibility": "FEASIBLE_DECLARED",
        "intent": "WILLING", "outside_net_cash": "0.00",
        "minimum_increment_cash": "10.00",
        "cooperative_external_cash": cash(
            external_purchases_cash="30.00", production_cash="70.00",
            transaction_cash="10.00", marketing_cash="5.00",
            logistics_cash="5.00", verification_cash="5.00",
            switching_cash="5.00", risk_reserve_cash="5.00",
            operator_fee_cash="5.00"),
        "liquidity": {"upfront_required_cash": "100.00",
                      "available_working_capital_cash": "120.00"},
    }
    return [b, p]


def evaluate(claims=None, *, at=4, state=None, with_details=False):
    data = raw()
    data["formation_finance"] = pair() if claims is None else claims
    state = world() if state is None else state
    ds, os = parse_discovery(data, state.subjects, state.works, state.resources)
    q = parse_formation_finance(data["formation_finance"], ds, os)
    result = discover(ds, os, state, at=at, formation_finance=q)
    return (result, q, ds, os) if with_details else result


def test_positive_bilateral_price_range_not_actual_consent_or_selected_quote():
    result = evaluate()
    row = result["candidates"][0]
    assert row["status"] == "POTENTIAL_PARTNER_REQUIRES_FRESH_ORIGINAL_OWNER_REVIEW"
    assert row["economic_status"] == "ONE_PROSPECTIVE_BILATERAL_INTERVAL_NOT_CONSENTED"
    assert row["economically_possible_count"] == 1
    assert result["economically_reviewable_count"] == 1
    assert result["original_consent_status"] == "NOT_ESTABLISHED"
    assert result["cash_or_profit"] == "NOT_CALCULATED"
    for secret in ("155.00", "150.00", "500.00", "100.00", "model://supplier/quote"):
        assert secret not in str(result)


def test_pairwise_internal_payment_is_not_double_counted():
    result, q, d, o = evaluate(with_details=True)
    assert assess_bilateral_finance(q, demand=d[0], offer=o[0], at=4) == (
        "PROSPECTIVE_BILATERAL_CASH_INTERVAL_NOT_CONSENTED")
    assert "transfer" not in result["candidates"][0]
    assert result["interfirm_cash_transfers"] == "EXCLUDED_FROM_INPUTS_AND_NOT_REDISCLOSED"


@pytest.mark.parametrize("side, channel, value", [
    ("PROVIDER", "transaction_cash", "40.00"),
    ("PROVIDER", "marketing_cash", "30.00"),
    ("BUYER", "transaction_cash", "65.00"),
    ("BUYER", "verification_cash", "25.00"),
    ("BUYER", "switching_cash", "25.00"),
    ("BUYER", "risk_reserve_cash", "30.00"),
    ("BUYER", "operator_fee_cash", "35.00"),
])
def test_endogenous_transaction_marketing_quality_risk_and_switching_costs_reverse_admissibility(side, channel, value):
    claims = pair()
    owner = claims[0] if side == "BUYER" else claims[1]
    owner["cooperative_external_cash"][channel] = value
    row = evaluate(claims)["candidates"][0]
    assert row["economic_status"] == "NO_QUALIFIED_BILATERAL_CASH_INTERVAL"
    assert row["economically_possible_count"] == 0


def test_buyer_liquidity_constraint_blocks_even_when_joint_surplus_positive():
    claims = pair()
    claims[0]["liquidity"]["max_supplier_payment_cash"] = "145.00"
    assert evaluate(claims)["candidates"][0]["economically_possible_count"] == 0


def test_provider_upfront_funding_blocks_even_with_positive_interfirm_interval():
    claims = pair()
    claims[1]["liquidity"]["available_working_capital_cash"] = "90.00"
    _, q, d, o = evaluate(claims, with_details=True)
    assert assess_bilateral_finance(q, demand=d[0], offer=o[0], at=4) == "PROVIDER_WORKING_CAPITAL_INSUFFICIENT"


@pytest.mark.parametrize("side, field, value", [
    (0, "intent", "DECLINES"),
    (1, "intent", "UNKNOWN"),
    (0, "coverage", "PARTIAL"),
    (1, "outside_feasibility", "UNKNOWN"),
    (0, "period", "cycle2"),
    (1, "currency", "USD"),
])
def test_independent_refusal_partial_coverage_or_currency_mismatch_never_creates_deal(side, field, value):
    claims = pair()
    claims[side][field] = value
    result = evaluate(claims)
    assert result["economically_reviewable_count"] == 0


def test_current_bilateral_evidence_must_have_both_original_parties():
    claims = pair()
    assert evaluate(claims[:1])["economically_reviewable_count"] == 0
    assert evaluate(claims[1:])["economically_reviewable_count"] == 0
    assert evaluate(claims, at=1)["economically_reviewable_count"] == 0
    assert evaluate(claims, at=18)["economically_reviewable_count"] == 0


@pytest.mark.parametrize("side, changes, error", [
    (0, {"owner": "supplier"}, "DISCOVERY_FINANCE_INDEPENDENT_OWNER_REQUIRED"),
    (1, {"owner": "buyer"}, "DISCOVERY_FINANCE_INDEPENDENT_OWNER_REQUIRED"),
    (0, {"source_ref": "model://supplier/pretend"}, "DISCOVERY_ORIGINAL_OWNER_SOURCE_REQUIRED"),
    (0, {"offer_source_ref": "model://supplier/old"}, "DISCOVERY_FINANCE_SOURCE_REVISION_MISMATCH"),
    (1, {"work_source_revision": "old"}, "DISCOVERY_FINANCE_SOURCE_REVISION_MISMATCH"),
    (1, {"currency": "USD4"}, "DISCOVERY_FINANCE_INVALID_CURRENCY"),
    (0, {"outside_net_cash": 100.0}, "DISCOVERY_FINANCE_INVALID_CASH"),
    (0, {"available_at": True}, "DISCOVERY_TIME_INVALID"),
    (0, {"intent": "COMMITTED"}, "DISCOVERY_FINANCE_INVALID_INTENT"),
    (1, {"side": "BUYER"}, "DISCOVERY_FINANCE_INDEPENDENT_OWNER_REQUIRED"),
])
def test_owner_revision_schema_source_provenance_and_amounts_are_fail_closed(side, changes, error):
    claims = pair()
    claims[side].update(changes)
    with pytest.raises(DiscoveryInputError, match=error):
        evaluate(claims)


def test_stale_quote_cannot_be_used_after_original_capability_source_changed():
    claims = pair()
    data = raw()
    data["offers"][0]["source_ref"] = "model://supplier/new-capability"
    data["formation_finance"] = claims
    state = world()
    ds, os = parse_discovery(data, state.subjects, state.works, state.resources)
    with pytest.raises(DiscoveryInputError, match="DISCOVERY_FINANCE_SOURCE_REVISION_MISMATCH"):
        parse_formation_finance(data["formation_finance"], ds, os)


def test_overlapping_buyer_quotes_cannot_choose_posthoc_best_price():
    claims = pair()
    dup = deepcopy(claims[0])
    dup["source_ref"] = "model://buyer/alternative-price"
    with pytest.raises(DiscoveryInputError, match="DISCOVERY_FINANCE_OVERLAPPING_OWNER_QUOTES"):
        evaluate(claims + [dup])
    dup["available_at"] = 18
    dup["expires_at"] = 22
    assert evaluate(claims + [dup], at=4)["economically_reviewable_count"] == 1


def test_missing_unavailable_original_resource_cannot_create_a_price_based_partner():
    s = world()
    s.resource_availability["new-machine"] = "UNAVAILABLE"
    row = evaluate(state=s)["candidates"][0]
    assert row["candidate_count"] == 0
    assert row["economically_possible_count"] == 0


def test_no_formation_input_retains_exact_previous_output_shape():
    state = world()
    data = raw()
    ds, os = parse_discovery(data, state.subjects, state.works, state.resources)
    previous = discover(ds, os, state, at=4)
    new = discover(ds, os, state, at=4)
    assert previous == new
    assert "economically_reviewable_count" not in previous
    assert "economic_status" not in str(previous)


def test_deterministic_and_mutation_free_bilateral_reservations():
    state = world()
    before = deepcopy(state)
    assert evaluate(state=state) == evaluate(state=state)
    assert state.works == before.works
    assert state.capacity_ledger.reservations == before.capacity_ledger.reservations


def test_signed_negative_outside_net_is_allowed_as_distinct_enterprise_loss():
    claims=pair()
    claims[1]["outside_net_cash"] = "-10.00"
    assert evaluate(claims)["economically_reviewable_count"] == 1

def test_rival_demands_cannot_both_claim_a_bilateral_deal_on_same_capacity():
    state=world(second=True)
    data=raw()
    added=deepcopy(data['demands'][0])
    added.update(id='D2',work='w2',work_source_revision='wr2',source_ref='model://buyer/new-need')
    data['demands'].append(added)
    d,o=parse_discovery(data,state.subjects,state.works,state.resources)
    claims=parse_formation_finance(pair(),d,o)
    result=discover(d,o,state,at=4,formation_finance=claims)
    assert result['contested_opportunity_count']==2
    assert result['economically_reviewable_count']==0
    assert all(row['economic_status']=='BILATERAL_RESOURCE_ALLOCATION_UNRESOLVED'
               for row in result['candidates'])
    assert len(state.capacity_ledger.reservations)==0
