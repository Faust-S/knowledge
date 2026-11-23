"""Reproduce the FOUR-TRAJECTORY comparative Work experiment as one JSON.

Run with PYTHONPATH=qualifications/akis_2026_11_21:
  python qualifications/akis_2026_11_21/research/akis/qualitative_mesa/experiments/export_r1r2_four_trajectory_evidence.py

The artifact contains original Work outcomes, errors and fingerprints only.
It contains no individual confidential cash flows or synthetic profits.
"""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.tests.test_r1r2_four_trajectory_economic_causal_mesa import (
    original_four_trajectory_run,
)


def export_evidence() -> tuple[Path, str]:
    scenarios, outputs, review = original_four_trajectory_run()
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_3_5_2_REQUIRED")
    manifest = {
        "schema": "AKIS_R1_R2_FOUR_TRAJECTORY_EVIDENCE/1.0",
        "engine": "ONE_ORIGINAL_QUALITATIVE_AKIS_MESA_3_5_2",
        "qualified_experiment": review,
        "original_event_counts": {
            key: {
                "declared": len(scenarios[key]["events"]),
                "actual": len(outputs[key]["trace"]),
                "applied": outputs[key]["counts"]["applied"],
                "blocked": outputs[key]["counts"]["blocked"],
            }
            for key in sorted(scenarios)
        },
        "source_claims_same_in_all_cases": True,
        "observed_economic_gain_not_inferred": True,
    }
    for key, record in manifest["original_event_counts"].items():
        if record["actual"] != record["declared"]:
            raise RuntimeError(f"EXPERIMENT_CREATED_EXTRA_EVENTS:{key}")
    output = (
        Path(__file__).resolve().parent /
        "r1r2_four_trajectory_evidence.json"
    )
    data = json.dumps(
        manifest, sort_keys=True, indent=2, ensure_ascii=False,
        allow_nan=False,
    ) + "\n"
    output.write_text(data, encoding="utf-8")
    return output, sha256(data.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    outfile, digest = export_evidence()
    print(f"ORIGINAL_MESA_EXPERIMENT_FILE={outfile}")
    print(f"ORIGINAL_MESA_EXPERIMENT_SHA256={digest}")
    print("FOUR_TRAJECTORIES=")
    for row in json.loads(outfile.read_text(encoding="utf-8"))[
        "qualified_experiment"
    ]["trials"]:
        print(
            f"{row['trial']}|{row['original_next_work_result']}|"
            f"{row['original_next_work_obligation']}"
        )
