"""R4 deterministic owner-minimized bilateral outside-document research protocol.

Two model-declared owner sources qualify one buyer request and one supplier
counterproposal in original Mesa, not an authentic external order/contract.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r4_independent_supplier_offer_mesa import (
    OFFER_SOURCE, OFFER_REVISION, bilateral_case, offer_event,
)
from research.akis.qualitative_mesa.tests.test_r4_independent_external_buyer_demand_mesa import (
    owner_outlook, owner_assessments,
)
from research.akis.qualitative_mesa.tests.test_r4_original_buyer_demand_withdrawal_mesa import (
    with_buyer_withdrawal, withdrawal_event, unused_tick, WITHDRAW_SOURCE,
)


def bilateral_trials():
    base = bilateral_case()
    no_offer = deepcopy(base)
    no_offer["events"] = [
        event for event in no_offer["events"]
        if event["action"] != "outside_supplier_offer"
    ]
    forged = deepcopy(base)
    offer_event(forged)["actor"] = "x"
    stale = deepcopy(base)
    offer_event(stale)["outside_offer_source_revision"] = "stale-edition"
    wrong_scope = deepcopy(base)
    next(source for source in wrong_scope["context_evidence"]["sources"]
         if source["id"] == OFFER_SOURCE)["usable_by"] = ["a"]
    changed_price = deepcopy(base)
    owner_outlook(changed_price)["cash"]["INDEPENDENT_ALTERNATIVE"][
        "external_sales"
    ] = "800.00"
    buyer_withdrew = deepcopy(base)
    original = with_buyer_withdrawal()
    buyer_withdrew["context_evidence"]["sources"].append(
        deepcopy(next(source for source in original["context_evidence"]["sources"]
                      if source["id"] == WITHDRAW_SOURCE))
    )
    withdrawn = deepcopy(withdrawal_event(original))
    withdrawn["at"] = unused_tick(buyer_withdrew, 95, 111)
    buyer_withdrew["events"].append(withdrawn)
    buyer_withdrew["events"].sort(key=lambda row: row["at"])
    buyer_future_source_revoked = deepcopy(base)
    buyer_future_source_revoked["events"].append({
        "at": unused_tick(buyer_future_source_revoked, 95, 111),
        "action": "source_update", "actor": "a",
        "source": OFFER_SOURCE,
        "expected_revision": OFFER_REVISION,
        "new_revision": "supplier-offer-revoked-r4",
        "status": "DISPROVED",
    })
    buyer_future_source_revoked["events"].sort(key=lambda row: row["at"])
    return {
        "independently_source_scoped_bilateral_model_terms": base,
        "seller_claim_without_original_independent_offer": no_offer,
        "buyer_forged_the_supplier_offer": forged,
        "supplier_offer_wrong_source_revision": stale,
        "supplier_offer_disallowed_buyer_read": wrong_scope,
        "seller_outlook_differs_from_its_original_offer": changed_price,
        "buyer_independently_withdrew_after_supplier_offer": buyer_withdrew,
        "supplier_offer_source_revoked_after_event": buyer_future_source_revoked,
    }


def export_bilateral_original_outside_offer() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_3_5_2_REQUIRED")
    scenarios = bilateral_trials()
    original = deepcopy(scenarios)
    results = {name: simulate(data) for name, data in sorted(scenarios.items())}
    if scenarios != original:
        raise RuntimeError("R4_ORIGINAL_SOURCE_DOC_MUTATED")
    rows = []
    for name, output in sorted(results.items()):
        if set(output["works"]) != {"w0", "w1", "w2", "w3"}:
            raise RuntimeError("R4_PRECONTRACT_OFFER_CREATED_WORK")
        if any(output["works"][w]["result"] != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for w in ("w1", "w2")):
            raise RuntimeError("R4_HISTORICAL_RESULT_MUTATED")
        if output["profit"]["system_increment"] != "UNKNOWN":
            raise RuntimeError("MODEL_DOCUMENTS_NOT_REALIZED_ADDITIONALITY")
        offers = [
            e for e in output["trace"]
            if e["action"] == "outside_supplier_offer"
        ]
        rows.append({
            "trial": name,
            "original_independent_supplier_offer_applied_count": sum(
                row["outcome"] == "APPLIED" for row in offers
            ),
            "original_supplier_offer_blocked_count": sum(
                row["outcome"] == "BLOCKED" for row in offers
            ),
            "private_owner_model_economic_positions": sorted(set(
                pos for _, pos, _ in owner_assessments(output)
            )),
            "private_owner_model_reasons": sorted(set(
                reason for _, _, reason in owner_assessments(output)
                if reason is not None
            )),
            "earlier_original_accepted_results_preserved": True,
            "declared_buyer_model_terms_not_authenticated_market_order": True,
            "supplier_model_offer_not_contract": True,
            "original_bank_payment_verified": False,
            "causal_network_additionality": "NOT_IDENTIFIABLE",
        })
    by = {row["trial"]: row for row in rows}
    if "COOPERATION_PREFERRED" not in by[
            "independently_source_scoped_bilateral_model_terms"][
                "private_owner_model_economic_positions"]:
        raise RuntimeError("R4_BILATERAL_SOURCE_QUALIFIED_ADVICE_NOT_OBSERVED")
    if "OUTSIDE_OFFER_APPLIED_INDEPENDENT_RESPONSE_REQUIRED" not in by[
            "seller_claim_without_original_independent_offer"]["private_owner_model_reasons"]:
        raise RuntimeError("R4_SELLER_DOCUMENT_ABSENCE_NOT_CAUSAL")
    if "OUTSIDE_OFFER_SELLER_DOCUMENT_NOT_COMPARABLE" not in by[
            "seller_outlook_differs_from_its_original_offer"]["private_owner_model_reasons"]:
        raise RuntimeError("R4_SELLER_FORECAST_UNPINNED_TO_OFFER")
    if "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER" not in by[
            "buyer_independently_withdrew_after_supplier_offer"]["private_owner_model_reasons"]:
        raise RuntimeError("R4_WITHDRAWAL_NOT_REFLECTED_IN_OWNER_REVIEW")
    manifest = {
        "schema": "AKIS_R4_ORIGINAL_BILATERAL_OUTSIDE_OFFER_SOURCE_SCOPE/1.0",
        "engine": "ONE_ORIGINAL_MESA_3_5_2",
        "original_buyer_and_supplier_both_have_separate_current_source_evidence": True,
        "original_independent_buyer_own_demand_required": True,
        "original_independent_supplier_own_model_offer_required": True,
        "model_document_scope_price_quality_units_and_horizon_compared": True,
        "original_resource_preview_read_only": True,
        "buyer_source_and_supplier_source_both_require_CURRENT_read_permissions": True,
        "no_additional_registry_Work_contract_consent_or_cash_ledger": True,
        "external_contract_identity_delivery_and_payment_authenticated": False,
        "network_economic_additionality_identified": False,
        "trials": rows,
    }
    data = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True,
        indent=2, allow_nan=False,
    ) + "\n"
    target = Path(__file__).resolve().parent / (
        "r4_original_bilateral_outside_offer_evidence.json"
    )
    target.write_text(data, encoding="utf-8")
    return target, sha256(data.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    target, digest = export_bilateral_original_outside_offer()
    print(f"AKIS_R4_BILATERAL_OFFER_SHA256={digest}")
    print(f"AKIS_R4_BILATERAL_OFFER_JSON={target}")
