"""Cooperative cost comparisons must only inform existing non-binding review."""
from research.akis.qualitative_mesa.adaptation_review import _cooperation_cost_signals


def _economics(resource, cash, comparison="DECLARED_SCOPE_ARITHMETIC_ONLY"):
    return {"cooperation_cost_channels": {"claimed_channels": [{
        "link": "r1", "owner": "a", "channel": "TRANSACTION_COST",
        "comparison": comparison,
        "resource_cost_reduction_claim": resource,
        "buyer_cash_outlay_reduction_claim": cash,
    }]}}


def test_positive_cost_comparison_is_not_an_authorization():
    result = _cooperation_cost_signals(_economics("20.00", "0.00"))[0]
    assert result["signal"] == "DECLARED_POSSIBLE_COOPERATION_COST_ADVANTAGE"
    assert result["automatic_change"] is False
    assert result["causal_attribution"] == "NOT_IDENTIFIABLE"
    assert result["right_to_change_others"] is False


def test_negative_cooperation_cost_is_visible_without_forced_decision():
    result = _cooperation_cost_signals(_economics("-5.00", "12.00"))[0]
    assert result["signal"] == "DECLARED_POSSIBLE_COOPERATION_COST_DISADVANTAGE"
    assert result["automatic_change"] is False


def test_unknown_comparability_cannot_infer_zero_or_effect():
    result = _cooperation_cost_signals(_economics(None, None, "NOT_IDENTIFIABLE"))[0]
    assert result["signal"] == "COMPARABILITY_NOT_ESTABLISHED"
    assert _cooperation_cost_signals(None) == []
    assert _cooperation_cost_signals({}) == []
