"""R3-R4: deterministic public, owner-minimized outside-option attainability proof.

Reads only original Mesa Work/Result and non-binding private assessments.
The ORIGINAL CapacityLedger previews resources; no external Work is created,
no actual outside contract or cash transfer is authenticated.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r3r4_original_owner_outside_capacity_mesa import (
    probed, owner_assessments,
)


ACCEPTED = "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def research_arms():
    available = probed()
    expensive = probed()
    expensive["economic_outlooks"][0]["cash"]["COOPERATION"][
        "operator_fee_cash"
    ] = "2600.00"
    scoped = probed(units=2)
    foreign = probed(owner="b")
    stale = probed()
    stale["economic_outlooks"][0]["source_revision"] = "foreign-stale"
    refusal = probed()
    change = next(row for row in refusal["events"]
                  if row["action"] == "interest_update"
                  and row.get("work") == "w3" and row["actor"] == "a")
    change["new_willingness"] = "DECLINES"
    change["new_outside_option"] = "OUTSIDE_PREFERRED"
    unavailable = probed()
    unavailable["events"].append({
        "at": 80, "action": "resource_status", "actor": "a",
        "resource": "ra", "availability": "UNAVAILABLE",
    })
    unavailable["events"].sort(key=lambda row: row["at"])
    recovered = deepcopy(unavailable)
    recovered["events"].append({
        "at": 81, "action": "resource_status", "actor": "a",
        "resource": "ra", "availability": "AVAILABLE",
    })
    recovered["events"].sort(key=lambda row: row["at"])
    return {
        "available_resource_for_outside_option": available,
        "changed_private_cash_preference": expensive,
        "future_capacity_scoped_to_original_Work": scoped,
        "independent_customer_cannot_use_foreign_resource": foreign,
        "stale_owner_economic_source": stale,
        "independent_owner_declines": refusal,
        "original_resource_not_ready": unavailable,
        "original_owner_restores_resource": recovered,
    }


def export_outside_capacity() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("MESA_3_5_2_REQUIRED")
    scenario_docs = research_arms()
    before = deepcopy(scenario_docs)
    outputs = {key: simulate(value) for key, value in sorted(scenario_docs.items())}
    if before != scenario_docs:
        raise RuntimeError("OUTSIDE_RESOURCE_INPUTS_MUTATED")
    rows = []
    for name, output in sorted(outputs.items()):
        original = output["works"]
        if any(original[w]["result"] != ACCEPTED for w in ("w1", "w2")):
            raise RuntimeError("PREVIOUS_ORIGINAL_RESULT_MODIFIED")
        if any(key.startswith("__akis_outside_candidate__") for key in original):
            raise RuntimeError("PREVIEW_CREATED_ORIGINAL_WORK")
        if output["profit"]["system_increment"] != "UNKNOWN":
            raise RuntimeError("OUTSIDE_MODEL_PREVIEW_NOT_REALIZED_PROFIT")
        assessments = owner_assessments(
            output,
            "b" if name == "independent_customer_cannot_use_foreign_resource" else "a",
        )
        rows.append({
            "trial": name,
            "historical_two_accepted_results_preserved": True,
            "third_original_result": original.get("w3", {}).get(
                "result", "NOT_CREATED"
            ),
            "owner_model_positions": sorted(set(item[1] for item in assessments)),
            "owner_model_reasons": sorted(set(
                item[2] for item in assessments if item[2] is not None
            )),
            "original_explicit_owner_refusal_is_not_agent_position": True,
            "original_work_or_resource_reserved_by_preview": False,
            "external_customer_offer_authenticity": "NOT_VERIFIED",
            "actual_external_settlement": "NOT_VERIFIED",
            "causal_network_additionality": "NOT_IDENTIFIABLE",
        })
    by_name = {row["trial"]: row for row in rows}
    if "COOPERATION_PREFERRED" not in by_name[
            "available_resource_for_outside_option"]["owner_model_positions"]:
        raise RuntimeError("MODEL_OWNER_AVAILABLE_CAPACITY_NOT_OBSERVED")
    if "OUTSIDE_PREFERRED" not in by_name[
            "changed_private_cash_preference"]["owner_model_positions"]:
        raise RuntimeError("MODEL_OWNER_COST_SENSITIVITY_NOT_OBSERVED")
    if "OUTSIDE_CAPACITY_ORIGINAL_RESERVATIONS_OR_SCOPE_BLOCK" not in by_name[
            "future_capacity_scoped_to_original_Work"]["owner_model_reasons"]:
        raise RuntimeError("ORIGINAL_CAPABILITY_SCOPE_NOT_ENFORCED")
    if by_name["independent_owner_declines"]["third_original_result"] == ACCEPTED:
        raise RuntimeError("OWNER_REFUSAL_DID_NOT_BLOCK_THIRD_RESULT")
    manifest = {
        "schema": "AKIS_R3_R4_ORIGINAL_OUTSIDE_CAPACITY_PREVIEW/1.0",
        "engine": "MESA_3_5_2_SINGLE_ORIGINAL_WORK_AND_CAPACITY_LEDGER",
        "original_owner_only_resource_scope": True,
        "source_revision_checked_via_original_ContextBasis": True,
        "same_original_reserved_intervals_and_future_claims": True,
        "original_resource_candidate_is_not_accepted_Work": True,
        "economic_price_and_outside_customer_not_verified": True,
        "outside_feasibility_is_capacity_necessary_not_sufficient": True,
        "independent_legal_consent_created_by_preview": False,
        "real_network_added_value": "NOT_IDENTIFIABLE",
        "trials": rows,
    }
    data = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True, indent=2,
        allow_nan=False,
    ) + "\n"
    output_path = Path(__file__).resolve().parent / (
        "r3r4_original_outside_capacity_evidence.json"
    )
    output_path.write_text(data, encoding="utf-8")
    return output_path, sha256(data.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    path, digest = export_outside_capacity()
    print(f"AKIS_R3R4_OUTSIDE_CAPACITY_SHA256={digest}")
    print(f"AKIS_R3R4_OUTSIDE_CAPACITY_JSON={path}")
