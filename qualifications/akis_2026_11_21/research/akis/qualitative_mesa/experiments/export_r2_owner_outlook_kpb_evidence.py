"""Reproducible, owner-minimized R2 source-qualified prospective outlook experiment.

Reads the original Mesa, never adds a Work, signature, source, cash ledger or
bank settlement. A changed nonbinding owner outlook does not affect the
original Work without a separate original principal action.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r2_original_owner_outlook_kpb_mesa import (
    original_owner_outlook_case, owner_rows,
)


def export_owner_outlook_kpb() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_3_5_2_REQUIRED")
    baseline = original_owner_outlook_case()
    negative = deepcopy(baseline)
    negative["economic_outlooks"][0]["cash"][
        "COOPERATION"
    ]["operator_fee_cash"] = "2500.00"
    no_consent = deepcopy(negative)
    no_consent["events"] = [
        event for event in no_consent["events"]
        if not (event["action"] == "consent"
                and event.get("work") == "w2" and event["actor"] == "b")
    ]
    stale = deepcopy(baseline)
    stale["economic_outlooks"][0]["source_revision"] = "outlook-r2"
    all_cases = {
        "source_qualified_owner_preference": baseline,
        "source_qualified_outside_preference": negative,
        "owner_independently_did_not_consent": no_consent,
        "source_revision_stale": stale,
    }
    original = deepcopy(all_cases)
    outputs = {name: simulate(doc) for name, doc in sorted(all_cases.items())}
    if all_cases != original:
        raise RuntimeError("ORIGINAL_SOURCE_DOCUMENT_MUTATED")
    rows = []
    for name, result in sorted(outputs.items()):
        actions = [
            row.get("endogenous_choice", {}).get("action")
            for row in owner_rows(result)
            if row.get("economic_position") in {
                "COOPERATION_PREFERRED", "OUTSIDE_PREFERRED"
            }
        ]
        reasons = sorted(set(
            row.get("economic_reason")
            for row in owner_rows(result)
            if row.get("economic_reason")
        ))
        rows.append({
            "trial": name,
            "original_pilot_Result": result["works"]["w1"]["result"],
            "original_followup_Result": result["works"]["w2"]["result"],
            "source_scoped_owner_reasons": reasons,
            "owner_research_action_types": sorted(set(actions)),
            "strict_original_KPB": result["context_basis"]["strict"],
            "private_amounts_or_refs_exposed": False,
            "source_claimed_money_not_bank_payment": result["economics"][
                "work_payment_causality"
            ]["settlement_progress"]["actual_bank_payment_verified"] is False,
            "measured_economic_additionality": "NOT_IDENTIFIABLE",
        })
    by_name = {row["trial"]: row for row in rows}
    for name in ("source_qualified_owner_preference",
                 "source_qualified_outside_preference",
                 "source_revision_stale"):
        if by_name[name]["original_followup_Result"] != (
                "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
            raise RuntimeError("OUTLOOK_MUST_NOT_SILENTLY_REWRITE_ORIGINAL_RESULT")
    if by_name["owner_independently_did_not_consent"][
            "original_followup_Result"] != "NOT_SUBMITTED":
        raise RuntimeError("MODEL_ADVICE_MUST_NOT_REPLACE_INDEPENDENT_CONSENT")
    if by_name["source_qualified_owner_preference"][
            "source_scoped_owner_reasons"] == by_name[
            "source_revision_stale"]["source_scoped_owner_reasons"]:
        raise RuntimeError("OUTLOOK_STRICT_KPB_REVISION_MUST_AFFECT_ADVICE")
    manifest = {
        "schema": "AKIS_R2_OWNER_OUTLOOK_ORIGINAL_STRICT_KPB/1.0",
        "engine": "MESA_3_5_2_SINGLE_ORIGINAL_QUALITATIVE_AKIS",
        "original_prior_Result_unmodified": True,
        "prospective_coalition_requires_original_apply": True,
        "no_new_owner_consent_or_economic_ledger": True,
        "bank_payment_verified": False,
        "economic_additionality": "NOT_IDENTIFIABLE",
        "trials": rows,
    }
    contents = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True,
        indent=2, allow_nan=False,
    ) + "\n"
    target = Path(__file__).resolve().parent / (
        "r2_owner_outlook_original_strict_kpb_evidence.json"
    )
    target.write_text(contents, encoding="utf-8")
    return target, sha256(contents.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    path, digest = export_owner_outlook_kpb()
    print(f"AKIS_R2_OWNER_OUTLOOK_SHA256={digest}")
    print(f"AKIS_R2_OWNER_OUTLOOK_JSON={path}")
