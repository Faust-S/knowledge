"""Export a reproducible OWNER-REDACTED strict-KPB economic experiment.

No new money is booked. Owner-private cash values and all source references
remain in the original research scenario, not in the shared JSON.
"""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.comparative_trajectories import (
    compare_original_trajectories,
)
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r1r2_strict_registered_economic_cycle_mesa import (
    strict_economic_alternatives,
)


def export_original_strict_evidence() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_3_5_2_REQUIRED")
    scenarios = strict_economic_alternatives()
    outputs = {
        name: simulate(scenario)
        for name, scenario in sorted(scenarios.items())
    }
    comparison = compare_original_trajectories(
        scenarios, outputs, pilot_work="w1", next_work="w2"
    )
    rows = []
    for name in sorted(scenarios):
        out = outputs[name]
        economics = out["economics"]
        context_review = economics["original_strict_context_source_qualification"]
        lifecycle = economics["lifecycle_resource_costs"][
            "original_work_event_timing"
        ]
        rows.append({
            "trial": name,
            "original_next_Work_Result": out["works"]["w2"]["result"],
            "original_next_Work_obligation": out["works"]["w2"]["obligation"],
            "original_historical_w1_unchanged": (
                out["works"]["w1"]["result"]
                == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
            ),
            "original_registered_c_exists": "c" in out["subjects"],
            "original_strict_KPB": out["context_basis"]["strict"],
            "owner_scoped_economic_source_review": context_review["status"],
            "original_event_anchored_declared_cost_count": lifecycle[
                "original_lifecycle_timed_record_count"
            ],
            "original_economic_profit": economics["profit"],
            "causal_gain": economics["comparative_causal_effect"],
            "work_scoped_declared_arithmetic_status": next(
                item["status"]
                for item in out["work_counterfactual_dynamics"]["works"]
                if item["work"] == "w2"
            ),
            "source_declarations_not_payments": True,
        })
    manifest = {
        "schema": "AKIS_R1_R2_STRICT_REGISTERED_ECONOMIC_EVIDENCE/1.0",
        "engine": "ONE_ORIGINAL_MESA_3_5_2_QUALITATIVE_AKIS",
        "experiment": "REGISTERED_SECTOR_ACTOR_INDEPENDENT_COALITION_WORK_RESULT",
        "original_baseline_sha256": comparison[
            "original_baseline_fingerprint_sha256"
        ],
        "trial_count": len(rows),
        "accepted_followup_results": comparison["accepted_next_work_count"],
        "source_declared_economic_inputs_identical": comparison[
            "source_declared_economic_inputs_held_constant"
        ],
        "economics_privacy": {
            "owner_cash_amounts_or_balances_exposed": False,
            "owner_source_identifiers_exposed": False,
            "actual_bank_evidence_proven": False,
            "unobserved_economic_value_imputed_as_zero": False,
        },
        "measured_network_additionality": "NOT_IDENTIFIABLE",
        "trials": rows,
    }
    if manifest["accepted_followup_results"] != 1:
        raise RuntimeError("EXPERIMENT_EXPECTED_ONE_ACCEPTED_NEW_RESULT")
    if any(row["owner_scoped_economic_source_review"] !=
           "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED" for row in rows):
        raise RuntimeError("EXPERIMENT_CONTEXT_SCOPE_UNQUALIFIED")
    target = Path(__file__).resolve().parent / (
        "r1r2_strict_registered_economic_evidence.json"
    )
    data = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True,
        indent=2, allow_nan=False,
    ) + "\n"
    target.write_text(data, encoding="utf-8")
    return target, sha256(data.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    path, checksum = export_original_strict_evidence()
    print(f"ORIGINAL_STRICT_ECONOMIC_JSON_SHA256={checksum}")
    print(f"ORIGINAL_STRICT_ECONOMIC_JSON={path}")
    for row in json.loads(path.read_text(encoding="utf-8"))["trials"]:
        print(f"{row['trial']}|{row['original_next_Work_Result']}")
