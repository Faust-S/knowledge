"""Deterministic R4/R2: original executed alternatives and original payment evidence.

Reports separate model trajectories, never combines two incompatible executions.
All source declarations and claims remain MODEL_ONLY.
"""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r4_original_outside_work_mesa import (
    original_outside_work_case, OUTSIDE, ACCEPTED,
)
from research.akis.qualitative_mesa.tests.test_r4_original_outside_work_payment_mesa import (
    economic_case,
)


def export_original_outside_work():
    assert mesa.__version__ == "3.5.2"
    scenarios = {
        "cooperation_route": original_outside_work_case("cooperation"),
        "outside_route": original_outside_work_case("outside"),
        "competing_reservations": original_outside_work_case("both"),
        "uncommitted_request": original_outside_work_case("no_commit"),
        "outside_with_source_matched_payment": economic_case(),
    }
    scenarios["missing_quality"] = original_outside_work_case("outside")
    scenarios["missing_quality"]["events"] = [
        row for row in scenarios["missing_quality"]["events"]
        if not (row["action"] == "assess_result_quality" and row.get("work") == OUTSIDE)
    ]
    scenarios["unaccepted_result_with_payment_claims"] = economic_case()
    scenarios["unaccepted_result_with_payment_claims"]["events"] = [
        row for row in scenarios["unaccepted_result_with_payment_claims"]["events"]
        if not (row["action"] == "accept" and row.get("work") == OUTSIDE)
    ]
    outside, coop = scenarios["outside_route"], scenarios["cooperation_route"]
    assert {k: v for k,v in outside.items() if k != "events"} == {
        k: v for k,v in coop.items() if k != "events"}
    assert [e for e in outside["events"] if e["at"] <= 81] == [
        e for e in coop["events"] if e["at"] <= 81]
    before = deepcopy(scenarios)
    reports = {name: simulate(doc) for name, doc in sorted(scenarios.items())}
    assert scenarios == before
    assert reports["cooperation_route"]["works"]["w3"]["result"] == ACCEPTED
    assert reports["outside_route"]["works"][OUTSIDE]["result"] == ACCEPTED
    assert reports["competing_reservations"]["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert reports["missing_quality"]["works"][OUTSIDE]["result"] == "SUBMITTED"
    rows = []
    for name, report in reports.items():
        assert all(report["works"][work]["result"] == ACCEPTED for work in ("w1", "w2"))
        assert report["profit"]["system_increment"] == "UNKNOWN"
        assert report["context_basis"]["strict"]
        out = report["works"][OUTSIDE]
        coop = report["works"]["w3"]
        assert not (out["result"] == ACCEPTED and coop["result"] == ACCEPTED)
        row = {
            "trial": name,
            "previous_two_results_preserved": True,
            "cooperation_result": coop["result"],
            "outside_result": out["result"],
            "outside_obligation": out["obligation"],
            "outside_quality_gate": out["assurance"]["current_result_quality_gate"],
            "original_blocked_events": report["counts"]["blocked"],
            "measured_real_network_profit": "UNKNOWN",
        }
        if "economics" in report:
            money = report["economics"]
            strict = money["original_strict_context_source_qualification"]
            binding = money["work_payment_causality"]["bindings"][0]
            assert money["transfers_count"] == 1
            assert strict["outside_work_original_offer_purchase_transfer_price_matched"]
            assert money["consolidated_external_cash_from_claims"]["COOPERATION"] == "0.00"
            row["payment"] = {
                "original_purchase_transfer_count": 1,
                "source_matched_offer_price": True,
                "two_independent_owner_statements_per_claim": True,
                "settlement_status": binding["settlement_progress"]["status"],
                "bank_payment_verified": False,
                "transfer_is_internal_to_original_subject_boundary": True,
            }
        rows.append(row)
    assert reports["outside_with_source_matched_payment"]["economics"][
        "work_payment_causality"]["bindings"][0]["settlement_progress"]["status"] == (
        "FULLY_SOURCE_MATCHED_MODEL_ONLY_NOT_BANK_PAYMENT")
    assert reports["unaccepted_result_with_payment_claims"]["economics"][
        "work_payment_causality"]["bindings"][0]["settlement_progress"]["status"] == (
        "PAYMENT_CLAIMS_CAUSALLY_INCONSISTENT")
    manifest = {
        "schema": "AKIS_ORIGINAL_OUTSIDE_WORK_R4_R2_EXPERIMENT/1.0",
        "engine": "MESA_3_5_2",
        "matched_original_initial_state_and_common_event_prefix": True,
        "separate_counterfactual_runs_not_simultaneously_realized": True,
        "same_original_work_capacity_context_quality_and_money_mechanisms": True,
        "no_second_executor_or_ledger": True,
        "real_external_order_delivery_cost_bank_and_causal_profit_verified": False,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
        "trials": rows,
    }
    payload = json.dumps(manifest, ensure_ascii=False, sort_keys=True,
                         indent=2, allow_nan=False) + "\n"
    path = Path(__file__).resolve().parent / "r4_original_outside_work_evidence.json"
    path.write_text(payload, encoding="utf-8")
    return path, sha256(payload.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    path, digest = export_original_outside_work()
    print(f"AKIS_R4_OUTSIDE_WORK_SHA256={digest}")
    print(f"AKIS_R4_OUTSIDE_WORK_JSON={path}")
