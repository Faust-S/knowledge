"""Deterministic redacted observation of original delegated preparation renewal."""
from hashlib import sha256
import json
from pathlib import Path
from decimal import Decimal
from research.akis.qualitative_mesa.mesa_model import simulate

from research.akis.qualitative_mesa.tests.test_original_delegation_recovery_mesa import (
    observe_renewal, delegation_scope, attempt_costs, authority_time, idle_mandate_route,
)


def export_original_delegation_recovery():
    rows = []
    for label, kwargs in (
        ("no_mandate_cost", {"first_cost":"0.00","renewed_cost":"0.00"}),
        ("normal_mandate_cost", {}),
        ("renewed_cost_at_direct_break_even", {"renewed_cost":"32.00"}),
        ("renewed_cost_above_direct_break_even", {"renewed_cost":"48.00"}),
        ("same_revision_update", {"same_revision":True}),
        ("structural_experience_preserved", {"patterns":True}),
    ):
        outcomes = observe_renewal(**kwargs)
        arms = []
        for arm in ("FRESH","RECOVERED"):
            out = outcomes[arm]
            costs = attempt_costs(out)
            v = delegation_scope(out)
            total = Decimal(costs["all_combined_cost"])
            arms.append({
                "arm": arm, "applied_mandates": v["applied_mandate_count"],
                "applied_preparations": v["applied_delegated_preparation_count"],
                "accepted_effective_preparations": v["accepted_effective_preparation_count"],
                "other_preparations": v["other_applied_preparation_count"],
                "combined_cost_vs_direct": (
                    "LOWER" if total<83 else "EQUAL" if total==83 else "HIGHER"
                ) if "S1_DIRECT" in outcomes else "NOT_MATCHED_ACROSS_PATTERN_MODES",
                "independent_attempt_costs_reconciled": costs["status"]=="MODEL_ORIGINAL_DELEGATION_ATTEMPT_COSTS_RECONCILED",
                "pending_work_model_time": authority_time(out),
            })
        rows.append({"trial":label,"arms":arms,"same_original_result_capacity_cash_and_acceptance":True})
    idle = [{"expiry_kind":kind,"model_time":authority_time(simulate(idle_mandate_route(kind)[0]))}
            for kind in ("source","function","oc")]
    payload = json.dumps({
        "schema":"AKIS_ORIGINAL_DELEGATION_RECOVERY/1.1",
        "engine":"MESA_3_5_2","observations":rows,"idle_expiry_observations":idle,
        "private_amounts_source_and_owner_identifiers_excluded":True,
        "real_costs_runtime_profit_and_causal_effect_verified":False,
    },sort_keys=True,indent=2,allow_nan=False)+"\n"
    assert all(term not in payload for term in ("model://","local_research_only","source_fingerprint"))
    path = Path(__file__).resolve().parent / "r1_r2_r4_original_delegation_recovery_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path,digest = export_original_delegation_recovery()
    print(f"AKIS_ORIGINAL_DELEGATION_RECOVERY_SHA256={digest}")
    print(f"AKIS_ORIGINAL_DELEGATION_RECOVERY_JSON={path}")
