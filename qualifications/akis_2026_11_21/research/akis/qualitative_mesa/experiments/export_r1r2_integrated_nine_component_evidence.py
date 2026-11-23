"""Deterministic owner-minimized AKIS R1/R2 integrated nine-component export."""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.tests.test_r1r2_integrated_nine_component_cycle_mesa import (
    integrated_nine_component_run,
)


def export_integrated_nine_component_evidence() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_3_5_2_REQUIRED")
    scenarios, outputs, comparison, views = integrated_nine_component_run()
    if comparison["accepted_next_work_count"] != 1:
        raise RuntimeError("INTEGRATED_ONE_ACCEPTED_RESULT_REQUIRED")
    if not comparison["source_declared_economic_inputs_held_constant"]:
        raise RuntimeError("INTEGRATED_ORIGINAL_SOURCES_DIFFER")
    if set(scenarios) != set(views):
        raise RuntimeError("INTEGRATED_ORIGINAL_TRIALS_INCOMPLETE")
    manifest = {
        "schema": "AKIS_R1_R2_NINE_COMPONENT_ONE_ORIGINAL_MESA/1.0",
        "engine": "MESA_3_5_2_SINGLE_ORIGINAL_QUALITATIVE_AKIS",
        "original_baseline_fingerprint_sha256": comparison[
            "original_baseline_fingerprint_sha256"
        ],
        "source_claims_identical": True,
        "historical_accepted_pilot_unchanged": comparison[
            "historical_pilot_result_unchanged"
        ],
        "trial_count": len(views),
        "accepted_next_result_count": comparison["accepted_next_work_count"],
        "nine_component_scientific_closure": False,
        "bank_settlement_authenticated": False,
        "causal_economic_additionality": "NOT_IDENTIFIABLE",
        "trials": [
            {"trial": name, **views[name]}
            for name in sorted(views)
        ],
    }
    data = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True,
        indent=2, allow_nan=False,
    ) + "\n"
    target = Path(__file__).resolve().parent / (
        "r1r2_integrated_nine_component_evidence.json"
    )
    target.write_text(data, encoding="utf-8")
    return target, sha256(data.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    path, digest = export_integrated_nine_component_evidence()
    print(f"AKIS_R1R2_NINE_COMPONENT_SHA256={digest}")
    print(f"AKIS_R1R2_NINE_COMPONENT_JSON={path}")
