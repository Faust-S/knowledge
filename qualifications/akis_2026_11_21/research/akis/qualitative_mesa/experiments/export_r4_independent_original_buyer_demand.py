"""Deterministic R4 independent buyer demand reproduction in ONE original Mesa.

Source scopes, buyer's actual model trace event, capacity, Work and private
economic choice are checked together. No second order, money or registry.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r4_independent_external_buyer_demand_mesa import (
    independent_buyer_case, demand_event, owner_outlook, owner_assessments,
    BUYER, BUYER_SOURCE, REVISION,
)


def original_r4_demand_trials():
    accepted = independent_buyer_case()
    missing = deepcopy(accepted)
    missing["events"] = [
        event for event in missing["events"]
        if event["action"] != "outside_demand_signal"
    ]
    expired = deepcopy(accepted)
    demand_event(expired)["outside_demand_valid_until"] = 81
    mismatched = deepcopy(accepted)
    demand_event(mismatched)["outside_quality_basis"] = "other-quality-basis"
    price = deepcopy(accepted)
    demand_event(price)["outside_price_ceiling"] = "500.00"
    forged = deepcopy(accepted)
    demand_event(forged)["actor"] = "a"
    revoked = deepcopy(accepted)
    revoked["events"].append({
        "at": 96, "action": "source_update", "actor": BUYER,
        "source": BUYER_SOURCE, "status": "DISPROVED",
        "expected_revision": REVISION, "new_revision": "buyer-demand-r4-2",
    })
    revoked["events"].sort(key=lambda row: row["at"])
    owner_declines = deepcopy(accepted)
    own = next(
        row for row in owner_declines["events"]
        if row["action"] == "interest_update"
        and row.get("work") == "w3" and row["actor"] == "a"
    )
    own["new_willingness"] = "DECLINES"
    own["new_outside_option"] = "OUTSIDE_PREFERRED"
    return {
        "independent_buyer_model_signal_applied": accepted,
        "seller_claim_without_buyer_event": missing,
        "independent_buyer_demand_expired": expired,
        "source_declared_quality_not_equivalent": mismatched,
        "buyer_price_below_seller_forecast": price,
        "seller_forged_buyer_actor": forged,
        "buyer_source_revoked_after_event": revoked,
        "supplier_independently_declines": owner_declines,
    }


def export_r4_independent_demand() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_3_5_2_REQUIRED")
    trials = original_r4_demand_trials()
    frozen = deepcopy(trials)
    outputs = {name: simulate(doc) for name, doc in sorted(trials.items())}
    if trials != frozen:
        raise RuntimeError("ORIGINAL_R4_SCENARIOS_MUTATED")
    rows = []
    for name, output in sorted(outputs.items()):
        if any(
            output["works"][w]["result"] != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            for w in ("w1", "w2")
        ):
            raise RuntimeError("ORIGINAL_HISTORICAL_RESULT_NOT_PRESERVED")
        if len(output["works"]) != 3:
            raise RuntimeError("R4_OUTSIDE_BUYER_SIGNAL_CREATED_WORK")
        if output["profit"]["system_increment"] != "UNKNOWN":
            raise RuntimeError("R4_MODEL_DEMAND_NOT_REALIZED_ECONOMIC_ADDITIONALITY")
        source_events = [
            e for e in output["trace"]
            if e["action"] == "outside_demand_signal"
        ]
        rows.append({
            "trial": name,
            "original_buyer_signal_applied": sum(
                e["outcome"] == "APPLIED" for e in source_events
            ) == 1,
            "original_buyers_source_permissions_must_remain_current": True,
            "third_original_Work_Result": output["works"]["w3"]["result"],
            "owner_nonbinding_advice_positions": sorted(set(
                row[1] for row in owner_assessments(output)
            )),
            "owner_nonbinding_advice_reasons": sorted(set(
                row[2] for row in owner_assessments(output)
                if row[2] is not None
            )),
            "outside_client_authenticated": False,
            "outside_offer_contract_or_bank_payment_verified": False,
            "outside_price_and_quality_model_declarations_only": True,
            "economic_network_additionality": "NOT_IDENTIFIABLE",
        })
    by_name = {row["trial"]: row for row in rows}
    if not by_name[
            "independent_buyer_model_signal_applied"]["original_buyer_signal_applied"]:
        raise RuntimeError("ORIGINAL_INDEPENDENT_BUYER_SIGNAL_NOT_APPLIED")
    if "COOPERATION_PREFERRED" not in by_name[
            "independent_buyer_model_signal_applied"]["owner_nonbinding_advice_positions"]:
        raise RuntimeError("ORIGINAL_INDEPENDENT_BUYER_MODEL_CHOICE_NOT_OBSERVED")
    if "COOPERATION_PREFERRED" in by_name[
            "seller_claim_without_buyer_event"]["owner_nonbinding_advice_positions"]:
        raise RuntimeError("OWNER_FORGED_OUTSIDE_BUYER_DEMAND")
    if by_name["supplier_independently_declines"][
            "third_original_Work_Result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT":
        raise RuntimeError("MODEL_BUYER_DEMAND_CREATED_UNAUTHORIZED_CONSENT")
    evidence = {
        "schema": "AKIS_R4_INDEPENDENT_BUYER_ORIGINAL_DEMAND_SOURCE/1.0",
        "engine": "ONE_ORIGINAL_MESA_3_5_2",
        "independent_customer_own_applied_original_event": True,
        "original_ContextBasis_exact_owner_revision_read_scope_required": True,
        "original_Work_Result_and_CapacityLedger_unchanged_by_signal": True,
        "buyer_is_outside_cooperation_not_its_operator_or_supplier": True,
        "buyer_price_and_equivalence_source_declared_model_only": True,
        "real_market_demand_authentication": False,
        "actual_bank_payment_or_concluded_contract_verified": False,
        "real_economic_additionality": "NOT_IDENTIFIABLE",
        "trials": rows,
    }
    payload = json.dumps(
        evidence, ensure_ascii=False, indent=2, sort_keys=True,
        allow_nan=False,
    ) + "\n"
    target = Path(__file__).resolve().parent / (
        "r4_independent_original_buyer_demand_evidence.json"
    )
    target.write_text(payload, encoding="utf-8")
    return target, sha256(payload.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    path, digest = export_r4_independent_demand()
    print(f"AKIS_R4_BUYER_DEMAND_SHA256={digest}")
    print(f"AKIS_R4_BUYER_DEMAND_JSON={path}")
