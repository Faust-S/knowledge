"""Reproduce historical vs current original source rights, without private data.

All five scenarios use the original Mesa 3.5.2, the same Work/Result and
ContextBasis. This is source-assertion provenance, NOT bank authentication.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path

import mesa

from research.akis.qualitative_mesa.context_basis import ContextBlocked
from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel
from research.akis.qualitative_mesa.rules import InputError
from research.akis.qualitative_mesa.tests.test_r2_historical_original_source_rights_mesa import (
    REF, PURPOSE, CORE, change,
)
from research.akis.qualitative_mesa.tests.test_r2_strict_original_payment_evidence_mesa import (
    scoped_bilateral_payment_case,
)


def _verdict(state, *, historic: bool, revision: str, at: int) -> str:
    basis = state.context_basis
    try:
        method = (
            basis.assert_original_historical_form_role_source
            if historic else basis.assert_original_form_role_source
        )
        method(
            "c", REF, revision, core=CORE, purpose=PURPOSE,
            operation="READ", recipients={"c"}, at=at,
        )
    except ContextBlocked as exc:
        # Only general model error code; never publish owner identifiers.
        return exc.reason
    return "ORIGINAL_MODEL_SOURCE_QUALIFIED"


def original_cases():
    cases = {
        "baseline": scoped_bilateral_payment_case(),
        "later_revoked": scoped_bilateral_payment_case(),
        "revoked_then_restored": scoped_bilateral_payment_case(),
        "initially_disproved_then_restored": scoped_bilateral_payment_case(),
        "update_on_same_tick": scoped_bilateral_payment_case(),
        "future_payment_claim": scoped_bilateral_payment_case(),
    }
    change(cases["later_revoked"], 103, "DISPROVED", "receipt-r1", "receipt-r2")
    change(cases["revoked_then_restored"], 103, "DISPROVED", "receipt-r1", "receipt-r2")
    change(cases["revoked_then_restored"], 105, "CONFIRMED", "receipt-r2", "receipt-r3")
    cases["revoked_then_restored"]["model_horizon"] = 106
    initial = next(
        source for source in cases["initially_disproved_then_restored"][
            "context_evidence"
        ]["sources"] if source["id"] == REF
    )
    initial["status"] = "DISPROVED"
    change(
        cases["initially_disproved_then_restored"],
        103, "CONFIRMED", "receipt-r1", "receipt-r2",
    )
    change(cases["update_on_same_tick"], 101, "DISPROVED", "receipt-r1", "receipt-r2")
    cases["future_payment_claim"]["model_horizon"] = 100
    return cases


def export() -> tuple[Path, str]:
    if mesa.__version__ != "3.5.2":
        raise RuntimeError("ORIGINAL_MESA_352_REQUIRED")
    expected = {
        "baseline": (True, True, True),
        "later_revoked": (False, True, False),
        "revoked_then_restored": (True, True, True),
        "initially_disproved_then_restored": (False, False, True),
        "update_on_same_tick": (False, False, False),
        "future_payment_claim": (False, True, False),
    }
    trials = []
    for name, data in sorted(original_cases().items()):
        pristine = deepcopy(data)
        model = OperatorAKISModel(data)
        success = True
        try:
            output = model.execute()
        except InputError:
            success = False
        if data != pristine:
            raise RuntimeError("ORIGINAL_INPUT_MUTATED")
        original = model.qualitative
        if (original.works["w1"].result !=
                "ACCEPTED_BY_ORIGINAL_RECIPIENT"
                or original.works["w2"].result !=
                "ACCEPTED_BY_ORIGINAL_RECIPIENT"):
            raise RuntimeError("ORIGINAL_HISTORY_RETROACTIVELY_CHANGED")
        current_version = original.context_basis.sources[REF].revision
        historic = _verdict(original, historic=True,
                            revision="receipt-r1", at=101)
        current = _verdict(original, historic=False,
                           revision=current_version,
                           at=int(model.time))
        asof_ok = historic == "ORIGINAL_MODEL_SOURCE_QUALIFIED"
        current_ok = current == "ORIGINAL_MODEL_SOURCE_QUALIFIED"
        if (success, asof_ok, current_ok) != expected[name]:
            raise RuntimeError(
                "ORIGINAL_HISTORICAL_CURRENT_BOUNDARY_MISMATCH:" + name
            )
        trials.append({
            "trial": name,
            "current_private_economic_read_passed": success,
            "original_source_at_earlier_event_qualified": asof_ok,
            "current_source_read_qualified": current_ok,
            "historical_source_model_reason": historic,
            "present_day_source_model_reason": current,
            "original_accepted_work_history_unchanged": True,
            "original_source_updates_applied": sum(
                e["action"] == "source_update" and e["outcome"] == "APPLIED"
                for e in original.trace
            ),
            "current_source_right_not_proof_of_actual_bank_payment": True,
        })
    document = {
        "schema": "AKIS_R2_ONE_ORIGINAL_KPB_HISTORICAL_SOURCE_EVIDENCE/1.0",
        "engine": "ONE_ORIGINAL_MESA_3_5_2",
        "old_result_and_payment_ledger_immutable": True,
        "historical_right_not_current_read_grant": True,
        "late_restoration_not_retroactive_authentication": True,
        "future_payment_claim_not_qualified": True,
        "history_is_source_assertions_not_independent_bank_data": True,
        "no_new_IAM_Kernel_Store_or_economic_ledger": True,
        "actual_bank_settlement_verified": False,
        "real_cost_incurrence_verified": False,
        "measured_incremental_economic_value": False,
        "trials": trials,
    }
    target = Path(__file__).resolve().parent / (
        "r2_historical_kpb_evidence.json"
    )
    raw = json.dumps(
        document, ensure_ascii=False, sort_keys=True,
        indent=2, allow_nan=False,
    ) + "\n"
    target.write_text(raw, encoding="utf-8")
    return target, sha256(raw.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    file, digest = export()
    print("AKIS_R2_HISTORICAL_KPB_JSON_SHA256=" + digest)
    print("AKIS_R2_HISTORICAL_KPB_CASES=" + str(
        len(json.loads(file.read_text(encoding="utf-8"))["trials"])
    ))
