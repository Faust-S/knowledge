"""One original Mesa, owner-redacted source-qualified cost/payment evidence.

All events remain in the original Work trace, and all money remains in
economic_claims. Source statements are NOT independently verified bank facts.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r2_strict_original_payment_evidence_mesa import (
    BILATERAL_TRANSFER, scoped_bilateral_payment_case,
)


def export_original_evidence() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_3_5_2_REQUIRED")
    first = scoped_bilateral_payment_case()
    # Hash only the original economic declaration, excluding optional
    # settlement assertions. The original transfers/costs are unchanged.
    initial_money = deepcopy(first["economic_claims"])
    initial_money.pop("work_payment_settlement_claims", None)
    original_ledger_sha256 = sha256(json.dumps(
        initial_money, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")).hexdigest()
    cases = {
        "full_owner_source_claim": deepcopy(first),
        "partial_owner_source_claim": deepcopy(first),
        "no_original_result_acceptance": deepcopy(first),
    }
    cases["partial_owner_source_claim"]["economic_claims"][
        "work_payment_settlement_claims"
    ].pop()
    cases["no_original_result_acceptance"]["events"] = [
        event for event in cases["no_original_result_acceptance"]["events"]
        if not (event.get("action") == "accept"
                and event.get("work") == "w2")
    ]
    results = []
    for name, doc in sorted(cases.items()):
        identical = deepcopy(doc["economic_claims"])
        identical.pop("work_payment_settlement_claims", None)
        digest = sha256(json.dumps(
            identical, sort_keys=True, ensure_ascii=False,
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")).hexdigest()
        if digest != original_ledger_sha256:
            raise RuntimeError("ORIGINAL_MONEY_CHANGED_BETWEEN_TRIALS")
        output = simulate(doc)
        economics = output["economics"]
        source_check = economics["original_strict_context_source_qualification"]
        payment = economics["work_payment_causality"]
        binding = next(
            row for row in payment["bindings"]
            if row["transfer_id"] == BILATERAL_TRANSFER
        )
        original_cost = economics["lifecycle_resource_costs"][
            "original_work_event_timing"
        ]
        if (output["works"]["w1"]["result"] !=
                "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
            raise RuntimeError("HISTORIC_RESULT_CHANGED")
        if economics["transfers_count"] != 11:
            raise RuntimeError("ORIGINAL_TRANSFER_COUNT_CHANGED")
        if (economics["profit"] != "UNKNOWN" or
                economics["economic_value_added"] != "NOT_IDENTIFIABLE"):
            raise RuntimeError("UNOBSERVED_PROFIT_WAS_FABRICATED")
        if source_check["source_scoped_original_cost_event_count"] != 1:
            raise RuntimeError("COST_SOURCE_NOT_QUALIFIED")
        if original_cost["original_lifecycle_timed_record_count"] != 1:
            raise RuntimeError("COST_EVENT_NOT_LINKED_TO_ORIGINAL_WORK")
        results.append({
            "trial": name,
            "next_original_result": output["works"]["w2"]["result"],
            "historical_original_result_preserved": True,
            "original_strict_kpb_active": output["context_basis"]["strict"],
            "original_economic_sources_qualified": source_check["status"],
            "owner_scoped_cost_event_count": source_check[
                "source_scoped_original_cost_event_count"
            ],
            "owner_scoped_payment_claim_event_count": source_check[
                "source_scoped_original_payment_event_count"
            ],
            "independent_payment_owner_witness_count": source_check[
                "source_scoped_independent_payment_owner_witness_count"
            ],
            "original_payment_claim_status": binding[
                "settlement_progress"
            ]["status"],
            "original_payment_terms_review_status": payment["status"],
            "original_transfers_not_duplicated": True,
            "bank_statement_or_real_incurring_cost_confirmed": False,
            "economic_gain_established": False,
        })
    expected = {
        "full_owner_source_claim": (
            "ACCEPTED_BY_ORIGINAL_RECIPIENT",
            "FULLY_SOURCE_MATCHED_MODEL_ONLY_NOT_BANK_PAYMENT",
        ),
        "partial_owner_source_claim": (
            "ACCEPTED_BY_ORIGINAL_RECIPIENT",
            "PARTIALLY_SOURCE_MATCHED_MODEL_ONLY_NOT_BANK_PAYMENT",
        ),
        "no_original_result_acceptance": (
            "SUBMITTED", "PAYMENT_CLAIMS_CAUSALLY_INCONSISTENT",
        ),
    }
    for entry in results:
        target = expected[entry["trial"]]
        if (entry["next_original_result"],
                entry["original_payment_claim_status"]) != target:
            raise RuntimeError("ORIGINAL_PAYMENT_EXPERIMENT_DIFFERENT_FROM_PROOF")
    data = {
        "schema": "AKIS_R2_STRICT_ORIGINAL_COST_PAYMENT_EVIDENCE/1.0",
        "mesa_version": "3.5.2",
        "original_economic_declarations_sha256": original_ledger_sha256,
        "source_qualified_model_evidence_only": True,
        "original_bank_payment_and_cost_incurrence_authenticated": False,
        "full_causal_economic_gain_established": False,
        "original_source_owner_values_or_references_disclosed": False,
        "original_cash_ledger_count": 1,
        "single_original_qualitative_Mesa": True,
        "cases": results,
    }
    target = Path(__file__).resolve().parent / (
        "r2_strict_original_cost_payment_evidence.json"
    )
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False,
                     indent=2, allow_nan=False) + "\n"
    target.write_text(raw, encoding="utf-8")
    return target, sha256(raw.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    result, checksum = export_original_evidence()
    print(f"ORIGINAL_R2_COST_PAYMENT_EVIDENCE_SHA256={checksum}")
    print(f"ORIGINAL_R2_COST_PAYMENT_EVIDENCE={result}")
    for record in json.loads(result.read_text(encoding="utf-8"))["cases"]:
        print(record["trial"] + "|" + record["next_original_result"]
              + "|" + record["original_payment_claim_status"])
