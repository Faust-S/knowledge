"""Redacted combined original process recovery and unresolved material evidence."""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.tests.test_original_material_replenishment_mesa import (
    combined_original_recovery_portfolio, combined_original_recovery_view,
    unfinished_material_portfolio, observed_unfinished_material,
)
from research.akis.qualitative_mesa.experiments.export_activity_efficiency import direction


def export_combined_process_recovery():
    _, base = combined_original_recovery_view(
        combined_original_recovery_portfolio(recovery=False), disturbed=False)
    cases = []
    for label, costs in (
        ("positive_after_recovery", ("60.00","15.00","85.00","90.00","20.00")),
        ("explicit_zero_cost", ("0.00","0.00","0.00","0.00","0.00")),
        ("negative_after_recovery", ("400.00","100.00","300.00","250.00","100.00")),
    ):
        _, after = combined_original_recovery_view(combined_original_recovery_portfolio(
            **dict(zip(("material_seller","material_buyer","restoration",
                        "quality_seller","quality_buyer"),costs))), disturbed=True)
        delta = Decimal(base["consolidated"]["model_economic_contribution"])-Decimal(
            after["consolidated"]["model_economic_contribution"])
        cases.append({
            "trial":label,
            "accepted_work_count_unchanged": after["accepted_original_work_count"] == base["accepted_original_work_count"],
            "use_value_unchanged": after["consolidated"]["gross_incremental_recipient_use_value"] == base["consolidated"]["gross_incremental_recipient_use_value"],
            "original_capacity_reservations_unchanged": after["reserved_capacity_unit_ticks_by_resource"] == base["reserved_capacity_unit_ticks_by_resource"],
            "internal_transfers_unchanged": after["internal_transfer_turnover_not_system_output"] == base["internal_transfer_turnover_not_system_output"],
            "sum_of_exclusive_recovery_costs_matches_contribution_reduction": delta == sum(map(Decimal,costs)),
            "contribution_direction": direction(after["consolidated"]["model_economic_contribution"]),
        })
    unfinished=[]
    for phase in ("shortfall","dispatched","received"):
        _, work = observed_unfinished_material(unfinished_material_portfolio(phase=phase))
        lot = next(iter(work["original_unresolved_material"]["per_original_batch"].values()))
        unfinished.append({
            "phase":phase,
            "prior_accepted_quantity_retained": Decimal(lot["cumulative_accepted_claim_quantity"]) > 0,
            "remaining_qualified_requirement_positive": Decimal(lot["quantity_remaining_to_qualified_requirement"]) > 0,
            "current_round_receipt_declared":lot["current_round_receipt_declared"],
            "current_round_quality_declared":lot["current_round_quality_declared"],
            "unaccepted_value_and_contribution_unknown":work["accepted_recipient_use_value"] is None and work["net_economic_contribution"] is None,
            "original_commitment_retained":work["original_commitment_remains"],
            "positive_retained_cost_exposure": Decimal(work["triggered_external_outflows_plus_exclusive_resource_cost"]) > 0,
        })
    result = {
        "schema":"AKIS_ORIGINAL_COMBINED_PROCESS_RECOVERY_EVIDENCE/1.0",
        "engine":"MESA_3_5_2","combined_observations":cases,
        "unfinished_material_observations":unfinished,
        "actual_physical_losses_and_accounting_profit":"NOT_IDENTIFIABLE",
        "private_owner_values_and_sources_excluded":True,
    }
    payload=json.dumps(result,sort_keys=True,ensure_ascii=False,indent=2,allow_nan=False)+"\n"
    assert all(word not in payload for word in ("model://","local_research_only","source_ref"))
    path=Path(__file__).resolve().parent/"r2_r3_r4_combined_process_recovery_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path,sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path,digest=export_combined_process_recovery()
    print(f"AKIS_ORIGINAL_COMBINED_PROCESS_RECOVERY_SHA256={digest}")
    print(f"AKIS_ORIGINAL_COMBINED_PROCESS_RECOVERY_JSON={path}")
