"""Redacted observations of retained exposure in original unfinished production."""
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r3_r4_original_multi_order_portfolio_mesa import (
    unfinished_resource_disturbance_portfolio,
)


def export_unfinished_activity():
    d = unfinished_resource_disturbance_portfolio()
    result = simulate(d)["economics"]["original_portfolio_economics"]
    obs = result["incomplete_original_activity_observation"]
    work = next(iter(obs["local_research_only"]["per_original_unfinished_work"].values()))
    from decimal import Decimal
    manifest = {
        "schema": "AKIS_ORIGINAL_COMMITTED_INCOMPLETE_COST_EXPOSURE_EVIDENCE/1.0",
        "engine": "MESA_3_5_2",
        "original_portfolio_final_contribution_unqualified": result["status"] == "UNKNOWN",
        "retained_triggered_cost_and_resource_exposure_positive": Decimal(
            work["triggered_external_outflows_plus_exclusive_resource_cost"]) > 0,
        "conditional_untriggered_obligations_not_current_revenue": obs[
            "untriggered_conditional_payments_not_current_revenue"],
        "unaccepted_value_and_final_contribution_unqualified": (
            work["accepted_recipient_use_value"] is None and work["net_economic_contribution"] is None),
        "original_commitment_retained": work["original_commitment_remains"],
        "completed_original_stage_preserved": work["completed_original_operation_count"] > 0,
        "original_readiness_interruption_still_open": not work["original_execution_readiness"][
            "all_observed_readiness_interruptions_closed"],
        "actual_bank_payment_and_final_loss": "NOT_IDENTIFIABLE",
        "private_owner_values_and_sources_excluded": True,
    }
    payload = json.dumps(manifest, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False)+"\n"
    assert all(word not in payload for word in ("model://", "local_research_only", "source_ref"))
    path = Path(__file__).resolve().parent / "r2_r3_r4_unfinished_activity_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_unfinished_activity()
    print(f"AKIS_ORIGINAL_UNFINISHED_ACTIVITY_SHA256={digest}")
    print(f"AKIS_ORIGINAL_UNFINISHED_ACTIVITY_JSON={path}")
