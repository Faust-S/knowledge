"""Reproducible R4 independent buyer's model response to seller's offer.

All events run through ONE original Mesa 3.5.2, one original ContextBasis,
one original trace and the original capacity ledger. No second Work or money.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel
from research.akis.qualitative_mesa.tests.test_r4_original_buyer_offer_response_mesa import (
    BUYER_RESPONSE_SOURCE, BUYER_RESPONSE_REVISION,
    buyer_response_case, response_event, current_owner_review,
    owner_assessments, unused_tick, BUYER,
)


ACCEPTED = "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def independent_response_trials():
    willing = buyer_response_case()
    missing = deepcopy(willing)
    missing["events"] = [
        row for row in missing["events"]
        if row["action"] != "outside_buyer_offer_response"
    ]
    declines = buyer_response_case(decision="DECLINES_OFFER")
    forged = deepcopy(willing)
    response_event(forged)["actor"] = "a"
    stale = deepcopy(willing)
    response_event(stale)["outside_buyer_response_source_revision"] = "stale-v0"
    not_readable = deepcopy(willing)
    next(src for src in not_readable["context_evidence"]["sources"]
         if src["id"] == BUYER_RESPONSE_SOURCE).update(usable_by=[BUYER])
    double = deepcopy(willing)
    second = deepcopy(response_event(double))
    second["at"] = unused_tick(double, second["at"]+1, 90)
    second["outside_buyer_response_id"] = "another-r4-response-for-the-same-offer"
    second["outside_buyer_response_decision"] = "DECLINES_OFFER"
    double["events"].append(second)
    double["events"].sort(key=lambda row: row["at"])
    revoked = deepcopy(willing)
    revoked_at = unused_tick(revoked, 95, 110)
    revoked["events"].append({
        "at": revoked_at, "action": "source_update", "actor": BUYER,
        "source": BUYER_RESPONSE_SOURCE,
        "expected_revision": BUYER_RESPONSE_REVISION,
        "new_revision": "buyer-response-revoked-edition",
        "status": "DISPROVED",
    })
    revoked["events"].sort(key=lambda row: row["at"])
    return {
        "buyer_independently_willing_to_negotiate": willing,
        "supplier_claim_without_original_buyer_response": missing,
        "buyer_independently_declines_offer": declines,
        "supplier_forges_buyer_response": forged,
        "buyer_response_wrong_document_edition": stale,
        "supplier_cannot_read_buyer_response_document": not_readable,
        "buyer_cannot_change_previous_response_for_same_offer": double,
        "buyer_later_revokes_response_source": revoked,
    }


def export_original_buyer_response() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ONE_OFFICIAL_MESA_3_5_2_REQUIRED")
    inputs = independent_response_trials()
    frozen = deepcopy(inputs)
    models = {name: OperatorAKISModel(doc)
              for name, doc in sorted(inputs.items())}
    outputs = {name: model.execute() for name, model in models.items()}
    if inputs != frozen:
        raise RuntimeError("ORIGINAL_RESPONSE_SCENARIOS_MUTATED")
    reports = []
    for name, output in sorted(outputs.items()):
        if set(output["works"]) != {"w0", "w1", "w2", "w3"}:
            raise RuntimeError("BUYER_RESPONSE_CREATED_ALTERNATIVE_WORK")
        if any(output["works"][work]["result"] != ACCEPTED
               for work in ("w1", "w2", "w3")):
            raise RuntimeError("BUYER_RESPONSE_CHANGED_ORIGINAL_ACCEPTED_RESULT")
        if output["profit"]["system_increment"] != "UNKNOWN":
            raise RuntimeError("BUYER_RESPONSE_NOT_REALIZED_NETWORK_PROFIT")
        applied = [
            e for e in output["trace"]
            if e.get("action") == "outside_buyer_offer_response"
        ]
        opinions = owner_assessments(output)
        reports.append({
            "trial": name,
            "original_buyer_responses_applied": sum(
                e["outcome"] == "APPLIED" for e in applied
            ),
            "original_buyer_responses_blocked": sum(
                e["outcome"] == "BLOCKED" for e in applied
            ),
            "seller_original_nonbinding_model_positions": sorted(set(
                row[1] for row in opinions
            )),
            "seller_original_nonbinding_model_reasons": sorted(set(
                row[2] for row in opinions if row[2] is not None
            )),
            "original_existing_Result_preserved": True,
            "independent_buyer_model_intent_not_legal_consent": True,
            "original_Work_or_bank_payment_created": False,
            "real_legal_contract_delivery_and_bank_payment_verified": False,
            "measured_network_additionality": "NOT_IDENTIFIABLE",
        })
    by = {r["trial"]: r for r in reports}
    if "COOPERATION_PREFERRED" not in by[
            "buyer_independently_willing_to_negotiate"][
                "seller_original_nonbinding_model_positions"]:
        raise RuntimeError("ORIGINAL_BUYER_WILLINGNESS_NOT_USED_BY_OWNER_AGENT")
    if "OUTSIDE_BUYER_RESPONSE_INDEPENDENT_EVENT_REQUIRED" not in by[
            "supplier_claim_without_original_buyer_response"][
                "seller_original_nonbinding_model_reasons"]:
        raise RuntimeError("BUYER_RESPONSE_ABSENCE_IGNORED")
    if "OUTSIDE_BUYER_INDEPENDENTLY_DECLINED_OFFER" not in by[
            "buyer_independently_declines_offer"][
                "seller_original_nonbinding_model_reasons"]:
        raise RuntimeError("BUYER_INDEPENDENT_REFUSAL_IGNORED")
    if by["buyer_cannot_change_previous_response_for_same_offer"][
            "original_buyer_responses_blocked"] != 1:
        raise RuntimeError("ORIGINAL_BUYER_RESPONSE_REPEAT_NOT_BLOCKED")
    revoked_model = models["buyer_later_revokes_response_source"]
    revocation_at = next(
        e["at"] for e in outputs["buyer_later_revokes_response_source"]["trace"]
        if e["action"] == "source_update" and e["outcome"] == "APPLIED"
        and e.get("actor") == BUYER
    )
    check = current_owner_review(revoked_model, revocation_at + 1)
    if check.get("reason") != (
            "OUTSIDE_BUYER_RESPONSE_CURRENT_SOURCE_NO_LONGER_READABLE"):
        raise RuntimeError("LATE_BUYER_RESPONSE_REVOCATION_NOT_ENFORCED")
    manifest = {
        "schema": "AKIS_R4_ORIGINAL_BUYER_OFFER_RESPONSE/1.0",
        "engine": "ONE_ORIGINAL_MESA_3_5_2",
        "buyer_and_supplier_independent_model_source_owners": True,
        "original_buyer_response_pinned_to_one_offer_and_demand": True,
        "original_KPB_current_source_revision_scopes_qualified": True,
        "original_response_may_decline_without_overriding_work": True,
        "late_buyer_response_source_revocation_blocks_new_read": True,
        "one_applied_response_per_original_offer": True,
        "original_Work_Result_capacity_and_money_not_modified": True,
        "real_offer_legal_acceptance_delivery_bank_verified": False,
        "empirical_network_additionality": "NOT_IDENTIFIABLE",
        "trials": reports,
    }
    payload = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True,
        indent=2, allow_nan=False,
    ) + "\n"
    path = Path(__file__).resolve().parent / (
        "r4_independent_original_buyer_offer_response_evidence.json"
    )
    path.write_text(payload, encoding="utf-8")
    return path, sha256(payload.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    path, digest = export_original_buyer_response()
    print(f"AKIS_R4_BUYER_RESPONSE_SHA256={digest}")
    print(f"AKIS_R4_BUYER_RESPONSE_JSON={path}")
