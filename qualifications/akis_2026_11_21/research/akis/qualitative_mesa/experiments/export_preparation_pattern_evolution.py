"""Redacted model-time observations from the original Mesa scheduler."""
from hashlib import sha256
import json
from pathlib import Path

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_original_pattern_evolution_mesa import (
    expiry_route, live_points, time_view,
)


def export_pattern_evolution():
    observations = []
    for revise in (False, True):
        doc, _ = expiry_route(revise=revise)
        out = simulate(doc)
        observations.append({
            "trial": "revision_and_expiry" if revise else "stable_use_and_expiry",
            "applied_original_event_count": out["counts"]["applied"],
            "blocked_original_event_count": out["counts"]["blocked"],
            "model_time": time_view(out),
            "original_observations": [
                {
                    "at": tick,
                    "original_trace_position": pos,
                    "applied_preparation_count": view["applied_preparation_count"],
                    "accepted_effective_preparation_count": view["accepted_effective_preparation_count"],
                    "accepted_versions": view["distinct_accepted_pattern_versions"],
                    "current_versions": view["accepted_versions_with_current_source_and_oc"],
                    "returned_versions": view["distinct_versions_returned_to_accepted_work"],
                    "cost_status": view["cost_status"],
                } for tick, pos, view in live_points(out)
            ],
        })
    payload = json.dumps({
        "schema": "AKIS_ORIGINAL_STRUCTURAL_PREPARATION_EVOLUTION/1.0",
        "engine": "MESA_3_5_2",
        "observations": observations,
        "private_values_owner_and_source_identifiers_excluded": True,
        "actual_labor_time_profit_and_causal_additionality_verified": False,
        "full_author_ratios_identified": False,
    }, sort_keys=True, indent=2, allow_nan=False) + "\n"
    assert all(term not in payload for term in ("model://", "local_research_only", "source_fingerprint"))
    path = Path(__file__).resolve().parent / "r2_r3_r4_preparation_pattern_evolution_evidence.json"
    path.write_bytes(payload.encode("utf-8"))
    return path, sha256(path.read_bytes()).hexdigest()


if __name__ == "__main__":
    path, digest = export_pattern_evolution()
    print(f"AKIS_ORIGINAL_PREPARATION_PATTERN_EVOLUTION_SHA256={digest}")
    print(f"AKIS_ORIGINAL_PREPARATION_PATTERN_EVOLUTION_JSON={path}")
