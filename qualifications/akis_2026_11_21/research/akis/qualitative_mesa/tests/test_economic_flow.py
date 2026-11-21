"""Research accounting invariants, independent of Mesa or corporate originals."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from research.akis.qualitative_mesa.economic_flow import EconomicInputError, evaluate_economic_claims


def subject_state():
    return {"op": SimpleNamespace(kind="OPERATOR"), "a": SimpleNamespace(kind="SME"), "b": SimpleNamespace(kind="SME")}


def work_state():
    return {"w1": SimpleNamespace(result="ACCEPTED_BY_ORIGINAL_RECIPIENT"),
            "w2": SimpleNamespace(result="REJECTED")}


def source(sid, owner):
    return {"id": sid, "owner": owner, "reference": f"model://{sid}", "revision": "doc-r1"}


def transfer(eid, scenario, payer, payee, amount, proof, work="w1"):
    return {"id": eid, "scenario": scenario, "payer": payer, "payee": payee,
            "amount": amount, "source": proof, "work": work}


def resource_use(eid, scenario, owner, amount, bucket, proof):
    return {"id": eid, "scenario": scenario, "owner": owner,
            "amount": amount, "bucket": bucket, "source": proof, "work": None}


def fixture():
    return {
        "period": "P-1", "currency": "RUB",
        "sources": [source("b1", "b"), source("o1", "op"), source("a1", "a")],
        "transfers": [
            transfer("t1", "COOPERATION", "EXTERNAL", "b", "300.00", "b1"),
            transfer("t2", "COOPERATION", "b", "op", "120.00", "b1"),
            transfer("t3", "COOPERATION", "op", "a", "50.00", "o1"),
            transfer("t4", "COOPERATION", "op", "EXTERNAL", "30.00", "o1"),
            transfer("t5", "INDEPENDENT_ALTERNATIVE", "EXTERNAL", "b", "260.00", "b1"),
            transfer("t6", "INDEPENDENT_ALTERNATIVE", "b", "EXTERNAL", "95.00", "b1"),
            transfer("t7", "INDEPENDENT_ALTERNATIVE", "a", "EXTERNAL", "20.00", "a1"),
        ],
        "resource_uses": [
            resource_use("c1", "COOPERATION", "op", "15.00", "COMMON_CAPABILITY", "o1"),
            resource_use("c2", "COOPERATION", "a", "9.00", "PARTICIPANT_CONNECT", "a1"),
        ],
        "coverage": {"COOPERATION": {"a": "a1", "b": "b1", "op": "o1"},
                     "INDEPENDENT_ALTERNATIVE": {"a": "a1", "b": "b1", "op": "o1"}},
        "outside_feasibility": {
            "a": {"state": "FEASIBLE_DECLARED", "source": "a1"},
            "b": {"state": "FEASIBLE_DECLARED", "source": "b1"},
            "op": {"state": "UNKNOWN", "source": "o1"},
        },
    }


def run(raw=None):
    return evaluate_economic_claims(raw or fixture(), subject_state(), work_state())


def test_internal_transfers_cancel_without_creating_value():
    r = run()
    assert r["internal_transfers_count"]["COOPERATION"] == 2
    assert r["per_subject"]["b"]["flow_sums_from_claims"]["COOPERATION"] == "180.00"
    assert r["per_subject"]["op"]["flow_sums_from_claims"]["COOPERATION"] == "40.00"
    assert r["per_subject"]["a"]["flow_sums_from_claims"]["COOPERATION"] == "50.00"
    assert r["consolidated_external_cash_from_claims"]["COOPERATION"] == "270.00"
    assert r["consolidated_external_cash_from_claims"]["INDEPENDENT_ALTERNATIVE"] == "145.00"
    assert r["consolidated_cash_difference_claimed_scope"] is None
    assert r["consolidated_comparable_declared"] is False
    assert r["profit"] == "UNKNOWN"
    assert r["declared_source_index"]["b1"] == {"owner": "b", "reference": "model://b1", "revision": "doc-r1"}
    assert r["economic_value_added"] == "NOT_IDENTIFIABLE"
    assert r["comparative_causal_effect"] == "NOT_IDENTIFIABLE"


def test_resource_costs_are_separate_not_subtracted_twice():
    r = run()
    assert r["per_subject"]["op"]["resource_uses_by_bucket"]["COOPERATION"] == {"COMMON_CAPABILITY": "15.00"}
    assert r["per_subject"]["a"]["resource_uses_by_bucket"]["COOPERATION"] == {"PARTICIPANT_CONNECT": "9.00"}
    assert r["resource_costs_additive_to_cash"] is False
    assert r["profit"] == "UNKNOWN"


def test_comparable_cash_difference_is_only_declared_scope_arithmetic():
    r = run()
    assert r["per_subject"]["b"]["cash_comparison"] == "DECLARED_SCOPE_ARITHMETIC_ONLY"
    assert r["per_subject"]["b"]["cash_difference_cooperation_minus_outside"] == "15.00"
    assert r["per_subject"]["a"]["cash_difference_cooperation_minus_outside"] == "70.00"
    assert r["per_subject"]["op"]["cash_difference_cooperation_minus_outside"] is None
    assert r["economic_interest"] == "NOT_IDENTIFIABLE"
    assert r["per_subject"]["b"]["complete_cash_balance_from_claims"]["COOPERATION"] == "180.00"


def test_missing_scope_never_automatically_means_zero_or_profit():
    f = fixture()
    f["transfers"] = []
    f["resource_uses"] = []
    f["coverage"] = {"COOPERATION": {}, "INDEPENDENT_ALTERNATIVE": {}}
    r = run(f)
    assert r["consolidated_scope_complete_declared"] is False
    assert r["consolidated_cash_difference_claimed_scope"] is None
    assert r["complete_consolidated_external_balance_from_claims"]["COOPERATION"] is None
    assert all(v["cash_difference_cooperation_minus_outside"] is None for v in r["per_subject"].values())
    assert all(not v["declared_complete"]["COOPERATION"] for v in r["per_subject"].values())


def test_missing_outside_feasibility_blocks_individual_cash_comparison():
    f = fixture()
    f["outside_feasibility"]["b"] = {"state": "UNKNOWN", "source": "b1"}
    assert run(f)["per_subject"]["b"]["cash_difference_cooperation_minus_outside"] is None
    f["outside_feasibility"]["b"] = {"state": "NOT_FEASIBLE_DECLARED", "source": "b1"}
    assert run(f)["per_subject"]["b"]["cash_difference_cooperation_minus_outside"] is None


def test_nonexistent_work_refusal_and_linked_original_result_status():
    f = fixture()
    f["transfers"][0]["work"] = "w2"
    assert run(f)["linked_work_result_states"]["w2"] == "REJECTED"
    f["transfers"][0]["work"] = "unknown"
    with pytest.raises(EconomicInputError, match="SOURCE_WORK_NOT_IN_PORTFOLIO"):
        run(f)


def test_missing_owner_or_unauthorized_source_refusal():
    f = fixture()
    f["transfers"][0]["source"] = "o1"
    with pytest.raises(EconomicInputError, match="SOURCE_OWNER_NOT_PARTY"):
        run(f)
    f = fixture()
    f["resource_uses"][0]["source"] = "a1"
    with pytest.raises(EconomicInputError, match="SOURCE_OWNER_NOT_PARTY"):
        run(f)


@pytest.mark.parametrize("bad", [1, 1.0, None, True, [], "-1", "+12", "1e3", "0.000", "012", " 2", "NaN", "Infinity", "2,90", "9999999999999", "1.233"])
def test_malformed_money_never_silently_enter_accounts(bad):
    f = fixture()
    f["transfers"][0]["amount"] = bad
    with pytest.raises(EconomicInputError, match="INVALID_EXACT_AMOUNT"):
        run(f)


@pytest.mark.parametrize("field,value,error", [
    ("currency", "RUBUSD", "INVALID_CURRENCY"),
    ("currency", "rub", "INVALID_CURRENCY"),
    ("coverage", {}, "INVALID_COVERAGE_FIELDS"),
    ("coverage", {"COOPERATION": {"none": "b1"}, "INDEPENDENT_ALTERNATIVE": {}}, "INVALID_COVERAGE_SUBJECT"),
    ("coverage", {"COOPERATION": ["a", "a"], "INDEPENDENT_ALTERNATIVE": {}}, "INVALID_COVERAGE_MAP"),
    ("outside_feasibility", {"none": "FEASIBLE_DECLARED"}, "INVALID_OUTSIDE_FEASIBILITY"),
    ("outside_feasibility", {"a": {"state": "GREAT_PROFIT", "source": "a1"}}, "INVALID_OUTSIDE_FEASIBILITY"),
])
def test_invalid_scope_or_currency_refused(field, value, error):
    f = fixture()
    f[field] = value
    with pytest.raises(EconomicInputError, match=error):
        run(f)


def test_duplicate_claim_id_refused_across_cash_and_resource_use():
    f = fixture()
    f["resource_uses"][0]["id"] = f["transfers"][0]["id"]
    with pytest.raises(EconomicInputError, match="DUPLICATE_ECONOMIC_RECORD"):
        run(f)


def test_bad_transfer_boundaries_and_undeclared_source_refused():
    f = fixture()
    f["transfers"][0]["payer"] = "b"
    with pytest.raises(EconomicInputError, match="INVALID_TRANSFER_BOUNDARY"):
        run(f)
    f = fixture()
    f["transfers"][0]["source"] = "unknown"
    with pytest.raises(EconomicInputError, match="UNDECLARED_SOURCE"):
        run(f)


def test_determinism_without_floating_point_rounding():
    f = fixture()
    f["transfers"].append(transfer("t8", "COOPERATION", "EXTERNAL", "op", "0.01", "o1"))
    f["transfers"].append(transfer("t9", "COOPERATION", "op", "EXTERNAL", "0.02", "o1"))
    f["transfers"].append(transfer("t10", "COOPERATION", "EXTERNAL", "op", "0.01", "o1"))
    assert run(f) == run(deepcopy(f))
    assert run(f)["per_subject"]["op"]["flow_sums_from_claims"]["COOPERATION"] == "40.00"


def test_no_economic_record_changes_work_decisions():
    state = work_state()
    before = deepcopy(state)
    f = fixture()
    f["transfers"].append(transfer("extra", "COOPERATION", "b", "op", "20.00", "b1", work="w2"))
    r = evaluate_economic_claims(f, subject_state(), state)
    assert r["organizational_change"] == "NOT_AUTOMATIC"
    assert state["w2"].result == before["w2"].result == "REJECTED"


def test_system_comparison_only_when_every_alternative_declared_feasible():
    f = fixture()
    f["outside_feasibility"]["op"] = {"state": "FEASIBLE_DECLARED", "source": "o1"}
    r = run(f)
    assert r["consolidated_comparable_declared"] is True
    assert r["consolidated_cash_difference_claimed_scope"] == "125.00"
    assert r["economic_value_added"] == "NOT_IDENTIFIABLE"


def test_unlisted_flow_not_conflated_with_complete_balance():
    f = fixture()
    f["coverage"]["COOPERATION"] = {"a": "a1", "op": "o1"}
    r = run(f)
    assert r["per_subject"]["b"]["flow_sums_from_claims"]["COOPERATION"] == "180.00"
    assert r["per_subject"]["b"]["complete_cash_balance_from_claims"]["COOPERATION"] is None
    assert r["per_subject"]["b"]["cash_comparison"] == "NOT_IDENTIFIABLE"


def test_malformed_unhashable_outside_value_returns_controlled_input_error():
    f = fixture()
    f["outside_feasibility"]["b"] = []
    with pytest.raises(EconomicInputError, match="INVALID_OUTSIDE_FEASIBILITY"):
        run(f)


def test_claimed_completeness_requires_party_owned_document_source():
    f = fixture()
    f["coverage"]["COOPERATION"]["b"] = "o1"
    with pytest.raises(EconomicInputError, match="SOURCE_OWNER_NOT_PARTY"):
        run(f)
    f = fixture()
    f["coverage"]["INDEPENDENT_ALTERNATIVE"]["a"] = "missing-proof"
    with pytest.raises(EconomicInputError, match="UNDECLARED_SOURCE"):
        run(f)


def test_outside_alternative_needs_own_source():
    f = fixture()
    f["outside_feasibility"]["b"]["source"] = "o1"
    with pytest.raises(EconomicInputError, match="SOURCE_OWNER_NOT_PARTY"):
        run(f)


def test_provenance_of_completeness_and_outside_claim_is_visible():
    r = run()
    assert r["coverage_proof_sources"]["COOPERATION"] == {"a": "a1", "b": "b1", "op": "o1"}
    assert r["outside_feasibility_proof_sources"]["b"] == "b1"
    assert r["source_authority"] == "DECLARED_UNVERIFIED"
