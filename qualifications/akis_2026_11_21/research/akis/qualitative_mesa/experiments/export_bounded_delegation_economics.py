"""Redacted matched original preparation delegation experiment."""
from hashlib import sha256
import json
from pathlib import Path
from decimal import Decimal
from research.akis.qualitative_mesa.comparative_trajectories import (
    compare_original_bounded_delegation_economics,
)
from research.akis.qualitative_mesa.tests.test_original_bounded_delegation_mesa import (
    matched_delegation_economics,
)


def export_bounded_delegation():
    observations = []
    for label, cost in (("explicit_zero","0.00"),("below_reduction","12.00"),
                        ("at_reduction","32.00"),("above_reduction","48.00")):
        out = compare_original_bounded_delegation_economics(matched_delegation_economics(cost),work="w3")
        delta = Decimal(out["local_research_only"]["direct_minus_delegated_combined_cost"])
        observations.append({
            "trial": label,
            "combined_cost_advantage": "POSITIVE" if delta > 0 else "NEGATIVE" if delta < 0 else "ZERO",
            "same_original_works_results_consents_capacity_and_cash": out["same_original_works_results_consents_capacity_and_cash"],
            "accepted_original_work_count": out["local_research_only"]["arms"]["S2_DELEGATED"]["accepted_original_work_count"],
            "explicit_customer_cost_record": True,
        })
    payload = json.dumps({
        "schema": "AKIS_ORIGINAL_BOUNDED_DELEGATION_ECONOMICS/1.0",
        "engine": "MESA_3_5_2",
        "observations": observations,
        "private_amounts_owner_and_source_identifiers_excluded": True,
        "actual_runtime_legal_authority_profit_or_causal_gain_verified": False,
    },sort_keys=True,indent=2,allow_nan=False)+"\n"
    assert all(term not in payload for term in ("model://","local_research_only","source_fingerprint"))
    path = Path(__file__).resolve().parent / "r2_r3_r4_bounded_delegation_economics_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_bounded_delegation()
    print(f"AKIS_ORIGINAL_BOUNDED_DELEGATION_ECONOMICS_SHA256={digest}")
    print(f"AKIS_ORIGINAL_BOUNDED_DELEGATION_ECONOMICS_JSON={path}")
