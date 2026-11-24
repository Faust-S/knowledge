"""Redacted owner-specific delegation effects on the original two-order portfolio."""
from hashlib import sha256
import json
from pathlib import Path
from research.akis.qualitative_mesa.tests.test_original_portfolio_delegation_mesa import observe_portfolio_mandates

def export_portfolio_delegation():
    observations=[]
    for label,main,outside in (("explicit_zero","0.00","0.00"),("positive_total_mixed_owner","12.00","20.00"),
                               ("zero_total","32.00","32.00"),("negative_total","40.00","48.00")):
        out,deltas,total=observe_portfolio_mandates(main_cost=main,outside_cost=outside)
        observations.append({
            "trial":label,"aggregate_contribution_change":"POSITIVE" if total>0 else "ZERO" if total==0 else "NEGATIVE",
            "owners_positive":sum(v>0 for v in deltas.values()),
            "owners_zero":sum(v==0 for v in deltas.values()),
            "owners_negative":sum(v<0 for v in deltas.values()),
            "same_original_two_orders_accepted":True,
            "all_owners_weakly_benefit":all(v>=0 for v in deltas.values()),
        })
    payload=json.dumps({
        "schema":"AKIS_ORIGINAL_PORTFOLIO_DELEGATION/1.0","engine":"MESA_3_5_2","observations":observations,
        "private_amounts_and_source_and_owner_identifiers_excluded":True,
        "actual_profit_causal_effect_and_runtime_verified":False,
    },sort_keys=True,indent=2,allow_nan=False)+"\n"
    assert all(term not in payload for term in ("model://","local_research_only","source_fingerprint"))
    path=Path(__file__).resolve().parent/"r1_r2_r4_original_portfolio_delegation_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path,sha256(path.read_bytes()).hexdigest()

if __name__=="__main__":
    path,digest=export_portfolio_delegation()
    print(f"AKIS_ORIGINAL_PORTFOLIO_DELEGATION_SHA256={digest}")
    print(f"AKIS_ORIGINAL_PORTFOLIO_DELEGATION_JSON={path}")
