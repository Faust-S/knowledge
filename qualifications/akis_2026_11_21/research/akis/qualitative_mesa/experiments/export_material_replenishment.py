"""Deterministic redacted quantity/cost observations from original material handoffs."""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.tests.test_original_material_replenishment_mesa import (
    material_finance_portfolio, observed_material_finance,
)
from research.akis.qualitative_mesa.experiments.export_activity_efficiency import direction


def export_material_replenishment():
    _, base = observed_material_finance(material_finance_portfolio(supplement=False))
    cases = []
    for label, seller, buyer in (("declared_extra_cost", "60.00", "15.00"),
                                 ("explicit_zero_cost", "0.00", "0.00"),
                                 ("contribution_reversal", "1000.00", "100.00")):
        _, after = observed_material_finance(material_finance_portfolio(
            seller_cost=seller, buyer_cost=buyer))
        material = after["per_original_work"]["w3"]["original_material_replenishment"]
        batch = next(iter(material["per_original_batch"].values()))
        cases.append({
            "trial": label,
            "same_accepted_work_count": after["accepted_original_work_count"] == base["accepted_original_work_count"],
            "same_declared_use_value": after["consolidated"]["gross_incremental_recipient_use_value"] ==
                base["consolidated"]["gross_incremental_recipient_use_value"],
            "same_original_reservations": after["reserved_capacity_unit_ticks_by_resource"] ==
                base["reserved_capacity_unit_ticks_by_resource"],
            "retained_original_material_shortfall_and_rejection": (
                Decimal(batch["cumulative_unreceived_quantity"]) > 0 and
                Decimal(batch["cumulative_rejected_quantity"]) > 0),
            "required_accepted_material_quantity_recovered": (
                batch["planned_quantity"] == batch["cumulative_accepted_quantity"]),
            "original_material_round_count": batch["original_round_count"],
            "contribution_after_direction": direction(after["consolidated"]["model_economic_contribution"]),
            "contribution_change_direction": direction(
                Decimal(after["consolidated"]["model_economic_contribution"]) -
                Decimal(base["consolidated"]["model_economic_contribution"])),
        })
    _, unknown = observed_material_finance(material_finance_portfolio(declared=False))
    result = {
        "schema": "AKIS_ORIGINAL_MATERIAL_REPLENISHMENT_ECONOMICS_EVIDENCE/1.0",
        "engine": "MESA_3_5_2",
        "matched_observations": cases,
        "missing_extra_cost_not_zero_measurement": unknown["per_original_work"]["w3"][
            "original_material_replenishment"]["separately_declared_supplementary_handoff_resource_cost"] is None,
        "physical_origin_inventory_scrap_cost_accounting_profit": "NOT_IDENTIFIABLE",
        "no_new_work_result_or_cost_ledger": True,
        "private_owner_values_and_sources_excluded": True,
    }
    payload = json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False)+"\n"
    assert all(word not in payload for word in ("model://", "local_research_only", "source_ref"))
    path = Path(__file__).resolve().parent / "r2_r3_r4_material_replenishment_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_material_replenishment()
    print(f"AKIS_ORIGINAL_MATERIAL_REPLENISHMENT_SHA256={digest}")
    print(f"AKIS_ORIGINAL_MATERIAL_REPLENISHMENT_JSON={path}")
