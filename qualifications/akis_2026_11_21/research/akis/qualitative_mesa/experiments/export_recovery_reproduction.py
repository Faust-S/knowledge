"""Redacted original recovery and independent reproduction, no choice engine."""
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.tests.test_r3_r4_original_multi_order_portfolio_mesa import (
    original_recovery_reproduction_case, observe_recovery_reproduction,
)


def export_recovery_reproduction():
    original,_=observe_recovery_reproduction(
        original_recovery_reproduction_case(disturbed=False),disturbed=False)
    observations=[]
    for label,cost in (("zero","0.00"),("positive","85.00"),("large","1100.00")):
        out,reviews=observe_recovery_reproduction(original_recovery_reproduction_case(cost=cost))
        a=original["economics"]["per_subject"]["a"]
        b=out["economics"]["per_subject"]["a"]
        def total(row):
            return sum(map(Decimal,row["resource_uses_by_bucket"]["COOPERATION"].values()))
        observations.append({
            "trial":label,
            "same_original_cash_terms":a["complete_cash_balance_from_claims"]==b["complete_cash_balance_from_claims"],
            "exclusive_restoration_cost_retained":total(b)-total(a)==Decimal(cost),
            "prior_original_financial_review_qualified":all(r["evaluation_economic_basis_status"]=="MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED" for r in reviews),
            "prior_original_portfolio_review_qualified":all(r["evaluation_portfolio_forecast_scope_status"]=="MODEL_ORIGINAL_ACCEPTED_PORTFOLIO_FORECAST_SCOPE_QUALIFIED" for r in reviews),
            "new_original_work_accepted":out["works"]["w4"]["result"]=="ACCEPTED_BY_ORIGINAL_RECIPIENT",
        })
    opened,_=observe_recovery_reproduction(original_recovery_reproduction_case(cost="1100.00"))
    stopped,reviews=observe_recovery_reproduction(original_recovery_reproduction_case(cost="1100.00",pause=True),pause=True)
    _,early=observe_recovery_reproduction(original_recovery_reproduction_case())
    _,late=observe_recovery_reproduction(original_recovery_reproduction_case(fourth_material="520.00"))
    manifest={
        "schema":"AKIS_ORIGINAL_RECOVERY_REPRODUCTION_EVIDENCE/1.0",
        "engine":"MESA_3_5_2",
        "observations":observations,
        "same_prior_original_results_after_independent_pause":all(opened["works"][k]==stopped["works"][k] for k in ("w1","w2","w3")),
        "independent_pause_prevents_new_work":"w4" not in stopped["works"],
        "future_fourth_cost_cannot_change_prior_review":early==late,
        "actual_causal_profit_and_owner_behavior":"NOT_IDENTIFIABLE",
        "private_owner_values_and_sources_excluded":True,
    }
    payload=json.dumps(manifest,sort_keys=True,ensure_ascii=False,indent=2,allow_nan=False)+"\n"
    assert all(word not in payload for word in ("model://","local_research_only","source_ref"))
    path=Path(__file__).resolve().parent/"r2_r3_r4_recovery_reproduction_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path,sha256(path.read_bytes()).hexdigest()


if __name__=="__main__":
    path,digest=export_recovery_reproduction()
    print(f"AKIS_ORIGINAL_RECOVERY_REPRODUCTION_SHA256={digest}")
    print(f"AKIS_ORIGINAL_RECOVERY_REPRODUCTION_JSON={path}")
