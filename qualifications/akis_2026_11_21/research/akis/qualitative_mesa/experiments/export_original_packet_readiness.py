"""Redacted deterministic observations of original packet readiness time."""
import json
from hashlib import sha256
from pathlib import Path

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_original_delegation_recovery_mesa import renewal_routes
from research.akis.qualitative_mesa.tests.test_original_packet_readiness_mesa import readiness_time


def export_packet_readiness():
    rows = []
    for patterns in (False, True):
        for arm, doc in renewal_routes(patterns=patterns).items():
            if arm == "S1_DIRECT":
                continue
            rows.append({"structural_experience_enabled":patterns, "arm":arm,
                         "model_time":readiness_time(simulate(doc))})
    payload = json.dumps({
        "schema":"AKIS_ORIGINAL_PACKET_READINESS/1",
        "engine":"MESA_3_5_2",
        "observations":rows,
        "private_source_and_owner_identifiers_excluded":True,
        "actual_labor_production_delay_cost_and_profit_verified":False,
    },sort_keys=True,indent=2,allow_nan=False)+"\n"
    assert all(term not in payload for term in ("model://","local_research_only","source_fingerprint"))
    path = Path(__file__).resolve().parent / "r1_r2_r4_original_packet_readiness_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path,sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path,digest = export_packet_readiness()
    print(f"AKIS_ORIGINAL_PACKET_READINESS_SHA256={digest}")
    print(f"AKIS_ORIGINAL_PACKET_READINESS_JSON={path}")
