"""Deterministic owner-minimized R3 three-period Mesa experiment export."""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.tests.test_r3_three_period_original_owner_economics_mesa import (
    three_period_run,
)


def export_three_original_work_periods() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_3_5_2_REQUIRED")
    scenarios, outputs, views = three_period_run()
    names = sorted(scenarios)
    if names != sorted(views) or len(names) != 6:
        raise RuntimeError("ORIGINAL_THREE_PERIOD_TRAJECTORY_COUNT_INVALID")
    accepted = views["accepted_three_results"]["work_periods"]
    if not all(row["recipient_acceptance_applied"] for row in accepted):
        raise RuntimeError("ORIGINAL_THIRD_ACCEPTED_RESULT_MISSING")
    if views["independent_owner_declines_third_work"][
            "work_periods"][-1]["recipient_acceptance_applied"]:
        raise RuntimeError("ORIGINAL_OWNER_REFUSAL_MUST_NOT_CREATE_RESULT")
    if "w3" in outputs["original_capacity_not_adopted"]["works"]:
        raise RuntimeError("ORIGINAL_UNADOPTED_CAPACITY_USED")
    for name, out in outputs.items():
        if out["profit"]["system_increment"] != "UNKNOWN":
            raise RuntimeError("REALIZED_NETWORK_ADDITIONALITY_NOT_AUTHENTICATED")
    manifest = {
        "schema": "AKIS_R3_THREE_ORIGINAL_WORK_PERIODS/1.0",
        "engine": "ONE_NATIVE_ORIGINAL_MESA_3_5_2",
        "three_original_work_periods": True,
        "same_original_source_based_KPB": True,
        "global_original_work_KPB_strict_for_this_R1P_case": False,
        "individual_revision_pinned_outlooks_checked_by_original_ContextBasis": True,
        "owner_private_model_advice_not_consent": True,
        "source_claimed_cash_not_realized_profit": True,
        "measured_causal_network_additionality": "NOT_IDENTIFIABLE",
        "scenarios": [{"trial": name, **views[name]} for name in names],
    }
    data = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True,
        indent=2, allow_nan=False,
    ) + "\n"
    location = Path(__file__).resolve().parent / (
        "r3_three_original_work_periods_evidence.json"
    )
    location.write_text(data, encoding="utf-8")
    return location, sha256(data.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    path, digest = export_three_original_work_periods()
    print(f"AKIS_R3_THREE_PERIOD_SHA256={digest}")
    print(f"AKIS_R3_THREE_PERIOD_JSON={path}")
