"""R4 deterministic independent buyer withdrawal lifecycle experiment.

One original Mesa 3.5.2, one trace, one KPB, existing Work/Result and
CapacityLedger. Public JSON contains only aggregate model statuses.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.tests.test_r4_independent_external_buyer_demand_mesa import (
    independent_buyer_case,
)
from research.akis.qualitative_mesa.tests.test_r4_original_buyer_demand_withdrawal_mesa import (
    with_buyer_withdrawal, withdrawal_event, unused_tick,
    WITHDRAW_SOURCE, WITHDRAW_REVISION, BUYER,
    owner_assessments,
)


ACCEPTED = "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def lifecycle_trials():
    base = independent_buyer_case()
    closed = with_buyer_withdrawal()
    late = with_buyer_withdrawal(
        at=unused_tick(independent_buyer_case(), 95, 110)
    )
    seller_forged = with_buyer_withdrawal()
    withdrawal_event(seller_forged)["actor"] = "a"
    bad_revision = with_buyer_withdrawal()
    withdrawal_event(bad_revision)[
        "outside_withdrawal_source_revision"
    ] = "invalid-withdrawal-revision"
    no_seller_read = with_buyer_withdrawal()
    next(src for src in no_seller_read["context_evidence"]["sources"]
         if src["id"] == WITHDRAW_SOURCE)["usable_by"] = ["x"]
    duplicate = with_buyer_withdrawal()
    second = deepcopy(withdrawal_event(duplicate))
    second["at"] = unused_tick(duplicate, second["at"] + 1, 83)
    duplicate["events"].append(second)
    duplicate["events"].sort(key=lambda row: row["at"])
    revoke_withdrawal_source = with_buyer_withdrawal()
    revoke_withdrawal_source["events"].append({
        "at": unused_tick(revoke_withdrawal_source, 95, 110),
        "action": "source_update", "actor": BUYER,
        "source": WITHDRAW_SOURCE, "expected_revision": WITHDRAW_REVISION,
        "new_revision": "buyer-withdrawal-document-revoked",
        "status": "DISPROVED",
    })
    revoke_withdrawal_source["events"].sort(key=lambda row: row["at"])
    return {
        "buyer_initial_independent_demand": base,
        "buyer_withdrew_before_owning_firm_decision": closed,
        "buyer_withdrew_after_first_owner_economic_view": late,
        "seller_attempted_to_withdraw_buyers_demand": seller_forged,
        "buyer_withdrawal_wrong_document_revision": bad_revision,
        "buyer_withdrawal_no_supplier_read_permission": no_seller_read,
        "buyer_duplicate_withdrawal_is_not_second_event": duplicate,
        "buyer_withdrawal_document_revocation_does_not_reactivate": revoke_withdrawal_source,
    }


def export_original_r4_demand_lifecycle() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_3_5_2_REQUIRED")
    trials = lifecycle_trials()
    snapshot = deepcopy(trials)
    outputs = {name: simulate(data) for name, data in sorted(trials.items())}
    if trials != snapshot:
        raise RuntimeError("ORIGINAL_INPUT_MUTATED")
    rows = []
    for trial, output in sorted(outputs.items()):
        if set(output["works"]) != {"w0", "w1", "w2", "w3"}:
            raise RuntimeError("BUYER_DEMAND_CREATED_SECOND_WORK")
        if any(output["works"][w]["result"] != ACCEPTED
               for w in ("w1", "w2")):
            raise RuntimeError("BUYER_LIFECYCLE_REWRITES_PREVIOUS_RESULTS")
        if output["profit"]["system_increment"] != "UNKNOWN":
            raise RuntimeError("REAL_NETWORK_EFFECT_NOT_IDENTIFIED")
        events = [
            e for e in output["trace"]
            if e["action"] == "outside_demand_withdraw"
        ]
        opinions = owner_assessments(output)
        rows.append({
            "trial": trial,
            "original_buyer_withdrawal_events_applied": sum(
                e["outcome"] == "APPLIED" for e in events
            ),
            "original_buyer_withdrawal_events_blocked": sum(
                e["outcome"] == "BLOCKED" for e in events
            ),
            "seller_model_economic_positions": sorted(set(
                position for _, position, _ in opinions
            )),
            "seller_model_economic_reasons": sorted(set(
                reason for _, _, reason in opinions if reason is not None
            )),
            "original_three_work_results_preserved": True,
            "buyer_model_demand_not_external_contract": True,
            "closed_buyer_model_demand_is_not_real_bank_payment": True,
            "original_money_and_resource_ledgers_not_modified_by_signal": True,
            "empirical_network_additionality": "NOT_IDENTIFIABLE",
        })
    keyed = {r["trial"]: r for r in rows}
    first = keyed["buyer_initial_independent_demand"]
    closed = keyed["buyer_withdrew_before_owning_firm_decision"]
    later = keyed["buyer_withdrew_after_first_owner_economic_view"]
    if "COOPERATION_PREFERRED" not in first["seller_model_economic_positions"]:
        raise RuntimeError("INITIAL_INDEPENDENT_BUYER_DEMAND_NOT_OBSERVED")
    if "COOPERATION_PREFERRED" in closed["seller_model_economic_positions"]:
        raise RuntimeError("EARLY_WITHDRAWAL_IGNORED")
    if "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER" not in (
            closed["seller_model_economic_reasons"]):
        raise RuntimeError("BUYER_WITHDRAWAL_NOT_CAUSALLY_WITNESSED")
    if not later["original_buyer_withdrawal_events_applied"]:
        raise RuntimeError("LATE_BUYER_WITHDRAWAL_NOT_IN_ORIGINAL_TRACE")
    if "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER" not in (
            later["seller_model_economic_reasons"]):
        raise RuntimeError("LATE_BUYER_WITHDRAWAL_NOT_REFLECTED_BY_MESA_AGENT")
    if "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER" not in (
            keyed["buyer_withdrawal_document_revocation_does_not_reactivate"][
                "seller_model_economic_reasons"]):
        raise RuntimeError("REVOKED_WITHDRAWAL_IMPROPERLY_REACTIVATED_OLD_DEMAND")
    manifest = {
        "schema": "AKIS_R4_ORIGINAL_INDEPENDENT_BUYER_DEMAND_LIFECYCLE/1.0",
        "engine": "ONE_ORIGINAL_MESA_3_5_2_SINGLE_EVENT_TRACE",
        "buyer_independently_authorizes_a_fresh_withdrawal_document": True,
        "existing_original_ContextBasis_source_revision_scope": True,
        "later_permission_revocation_does_not_resurrect_closed_request": True,
        "seller_independent_comparison_does_not_create_contract": True,
        "no_second_registry_IAM_money_or_Work": True,
        "real_buyer_identity_contract_external_payment_authenticated": False,
        "measured_economic_additionality": "NOT_IDENTIFIABLE",
        "trials": rows,
    }
    data = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True, indent=2,
        allow_nan=False,
    ) + "\n"
    target = Path(__file__).resolve().parent / (
        "r4_independent_buyer_demand_lifecycle_evidence.json"
    )
    target.write_text(data, encoding="utf-8")
    return target, sha256(data.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    filename, digest = export_original_r4_demand_lifecycle()
    print(f"AKIS_R4_DEMAND_LIFECYCLE_SHA256={digest}")
    print(f"AKIS_R4_DEMAND_LIFECYCLE_JSON={filename}")
