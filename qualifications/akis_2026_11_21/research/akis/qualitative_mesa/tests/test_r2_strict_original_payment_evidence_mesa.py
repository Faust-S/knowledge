"""R2: independently scoped payment claims in the original registered Mesa.

Owner reports about one ORIGINAL transfer are not bank settlement, and the
old accepted Result survives subsequent loss of financial-source permission.
No new work, actor, resource, transfer or payment book is created.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import (
    OperatorAKISModel, simulate,
)
from research.akis.qualitative_mesa.rules import InputError

from .test_r1r2_strict_registered_economic_cycle_mesa import (
    original_strict_economic_case,
)


BILATERAL_TRANSFER = "entrant-coop"
PROOF_ID = "partial-w2-01"
EVIDENCE_REVISION = "receipt-r1"


def scoped_bilateral_payment_case():
    d = original_strict_economic_case()
    money = d["economic_claims"]
    context = d["context_evidence"]
    # The current w2 due dates and the same original transfer records are
    # explicit. Avoid inferring a contractual due from a later bank forecast.
    for window in money["cash_timing"]["transfer_windows"]:
        transfer = next(
            row for row in money["transfers"]
            if row["id"] == window["transfer_id"]
        )
        if transfer["scenario"] == "COOPERATION":
            window["at"] = 100
            window["late_at"] = 110
    money["work_payment_conditions"] = [
        {
            "transfer_id": transfer["id"],
            "condition": (
                "ON_CUSTOMER_ACCEPTANCE"
                if transfer["id"] in {"entrant-coop", "sale-coop"}
                else "ON_ORIGINAL_COMMIT"
            ),
            "due_at": 106, "work_source_revision": "d-2",
            "org_revision": "oc-1",
            "owner_sources": {
                owner: f"econ-{owner}" for owner in
                sorted({transfer["payer"], transfer["payee"]} - {"EXTERNAL"})
            },
        }
        for transfer in money["transfers"]
        if transfer["scenario"] == "COOPERATION"
    ]
    # A fresh economic source is owned by each counterparty, independently
    # of the original contract-term source and of the other's statement.
    for owner in ("b", "c"):
        new_id = f"econ-{owner}-receipt"
        source_ref = f"model://{owner}/receipt-source-w2"
        money["sources"].append({
            "id": new_id, "owner": owner,
            "reference": source_ref, "revision": "receipt-source-r1",
        })
        core = "institutional" if owner == "c" else "corporate"
        context["sources"].append({
            "id": source_ref, "owner": owner,
            "revision": "receipt-source-r1", "status": "CONFIRMED",
            "usable_by": [owner], "core": core,
            "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
            "operations": ["READ"], "valid_from": 50,
            "valid_until": 120,
        })
    money["work_payment_settlement_claims"] = []
    for number, (at, amount) in enumerate(
        ((101, "6000.00"), (102, "9000.00")), start=1
    ):
        name = f"partial-w2-{number:02d}"
        evidence_refs = {
            owner: f"model://{owner}/{name}-statement"
            for owner in ("b", "c")
        }
        money["work_payment_settlement_claims"].append({
            "id": name, "transfer_id": BILATERAL_TRANSFER,
            "at": at, "amount": amount,
            "owner_sources": {
                owner: f"econ-{owner}-receipt"
                for owner in ("b", "c")
            },
            "evidence_refs": evidence_refs,
            "evidence_revisions": {
                owner: EVIDENCE_REVISION
                for owner in ("b", "c")
            },
        })
        for owner, ref in evidence_refs.items():
            context["sources"].append({
                "id": ref, "owner": owner,
                "revision": EVIDENCE_REVISION,
                "status": "CONFIRMED", "usable_by": [owner],
                "core": "institutional" if owner == "c" else "corporate",
                "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
                "operations": ["READ"], "valid_from": at,
                "valid_until": 108,
            })
    return d


def test_full_bilateral_owner_claims_do_not_create_new_payment_or_profit():
    d = scoped_bilateral_payment_case()
    untouched = deepcopy(d)
    out = simulate(d)
    assert d == untouched
    assert out["counts"]["blocked"] == 0
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    strict = out["economics"]["original_strict_context_source_qualification"]
    assert strict["source_scoped_original_payment_event_count"] == 2
    assert strict["source_scoped_independent_payment_owner_witness_count"] == 4
    assert strict["payment_witnesses_checked_at_declared_time"]
    assert strict["payment_witnesses_are_not_bank_settlement"]
    payment = out["economics"]["work_payment_causality"]
    assert payment["settlement_progress"]["source_claimed_full_transfer_count"] == 1
    assert payment["settlement_progress"]["source_claim_event_count"] == 2
    assert payment["settlement_progress"]["actual_bank_payment_verified"] is False
    original = next(
        row for row in payment["bindings"]
        if row["transfer_id"] == BILATERAL_TRANSFER
    )
    assert original["settlement_progress"]["status"] == (
        "FULLY_SOURCE_MATCHED_MODEL_ONLY_NOT_BANK_PAYMENT"
    )
    assert original["settlement_progress"]["unconfirmed_remainder_not_actual_bank_debt"] == "0.00"
    assert out["economics"]["transfers_count"] == 11
    assert out["economics"]["consolidated_external_cash_from_claims"][
        "COOPERATION"
    ] == "148000.00"
    assert out["economics"]["economic_value_added"] == "NOT_IDENTIFIABLE"
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out == simulate(deepcopy(d))


def test_partial_bilateral_claim_reuses_only_original_transfer_and_cash_path():
    d = scoped_bilateral_payment_case()
    d["economic_claims"]["work_payment_settlement_claims"].pop()
    out = simulate(d)
    payment = out["economics"]["work_payment_causality"]
    assert payment["settlement_progress"]["source_claimed_partial_transfer_count"] == 1
    binding = next(
        row for row in payment["bindings"]
        if row["transfer_id"] == BILATERAL_TRANSFER
    )
    assert binding["settlement_progress"]["source_claimed_eligible_amount"] == "6000.00"
    assert binding["settlement_progress"]["unconfirmed_remainder_not_actual_bank_debt"] == "9000.00"
    joint = out["economics"]["cash_timing"]["joint_network_settlement"][
        "scenarios"
    ]["COOPERATION"]
    assert joint["claim_adjusted_original_money_conserved_per_tick"]
    assert joint["claim_adjusted_splits_original_transfer_not_new_money"]
    assert not joint["claim_adjusted_bank_payment_verified"]


@pytest.mark.parametrize("owner", ["b", "c"])
def test_each_payment_counterparty_needs_own_current_context_source(owner):
    d = scoped_bilateral_payment_case()
    row = d["economic_claims"]["work_payment_settlement_claims"][0]
    proof = row["evidence_refs"][owner]
    d["context_evidence"]["sources"] = [
        source for source in d["context_evidence"]["sources"]
        if source["id"] != proof
    ]
    model = OperatorAKISModel(d)
    with pytest.raises(
        InputError, match="ORIGINAL_PAYMENT_EVIDENCE_NOT_USABLE_IN_STRICT_KPB"
    ):
        model.execute()
    assert model.qualitative.works["w1"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )
    assert model.qualitative.works["w2"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )


def test_pinned_evidence_revision_cannot_be_silently_replaced():
    d = scoped_bilateral_payment_case()
    d["economic_claims"]["work_payment_settlement_claims"][0][
        "evidence_revisions"
    ]["c"] = "receipt-r2"
    with pytest.raises(
        InputError, match="ORIGINAL_PAYMENT_EVIDENCE_NOT_USABLE_IN_STRICT_KPB"
    ):
        simulate(d)


def test_payment_claim_date_after_owner_permission_expiration_is_blocked():
    d = scoped_bilateral_payment_case()
    proof = d["economic_claims"]["work_payment_settlement_claims"][0][
        "evidence_refs"
    ]["c"]
    source = next(
        row for row in d["context_evidence"]["sources"]
        if row["id"] == proof
    )
    source["valid_from"] = 95
    source["valid_until"] = 100
    # Source interval itself is valid, but payment at 101 falls outside it.
    # Original Mesa Work has already been accepted, but an unqualified
    # later payment statement cannot reuse expired data rights.
    model = OperatorAKISModel(d)
    with pytest.raises(
        InputError, match="ORIGINAL_PAYMENT_EVIDENCE_NOT_USABLE_IN_STRICT_KPB"
    ):
        model.execute()
    assert model.qualitative.works["w2"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )


def test_payment_evidence_cannot_masquerade_as_another_work_transfer():
    d = scoped_bilateral_payment_case()
    d["economic_claims"]["work_payment_settlement_claims"][0][
        "transfer_id"
    ] = "sale-outside"
    with pytest.raises(
        InputError, match="ORIGINAL_PAYMENT_WRONG_WORK_OR_TRANSFER_SCOPE"
    ):
        simulate(d)


def test_claim_without_customer_acceptance_is_not_qualified_settlement():
    d = scoped_bilateral_payment_case()
    d["events"] = [
        row for row in d["events"]
        if not (row["action"] == "accept" and row.get("work") == "w2")
    ]
    out = simulate(d)
    assert out["works"]["w2"]["result"] == "SUBMITTED"
    payment = out["economics"]["work_payment_causality"]
    assert payment["status"] in {
        "PAYMENT_PROGRESS_EVIDENCE_OR_AMENDMENT_CONFLICT",
        "UNOBSERVED_OR_INCONSISTENT_PAYMENT_CAUSAL_SEQUENCE",
    }
    claim = next(
        row for row in payment["bindings"]
        if row["transfer_id"] == BILATERAL_TRANSFER
    )["settlement_progress"]
    assert claim["status"] == "PAYMENT_CLAIMS_CAUSALLY_INCONSISTENT"
    assert out["economics"]["consolidated_external_cash_from_claims"][
        "COOPERATION"
    ] == "148000.00"
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_withdrawn_outside_feasibility_cannot_claim_independent_option_verified():
    d = scoped_bilateral_payment_case()
    d["economic_claims"]["outside_feasibility"]["b"]["state"] = "UNKNOWN"
    out = simulate(d)
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["economics"]["per_subject"]["b"]["cash_comparison"] == (
        "NOT_IDENTIFIABLE"
    )
    assert out["economics"]["comparative_causal_effect"] == "NOT_IDENTIFIABLE"
    assert out["economics"]["source_authority"] == "DECLARED_UNVERIFIED"


def test_no_claim_not_zero_paid_and_original_result_is_unchanged():
    d = scoped_bilateral_payment_case()
    d["economic_claims"]["work_payment_settlement_claims"] = []
    out = simulate(d)
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    p = next(
        row for row in out["economics"]["work_payment_causality"]["bindings"]
        if row["transfer_id"] == BILATERAL_TRANSFER
    )["settlement_progress"]
    assert p["status"] == "NO_PAYMENT_SOURCE_CLAIM_DOES_NOT_PROVE_UNPAID"
    assert p["unreported_payment_is_not_zero_actual_payment"]
    assert out["economics"]["original_strict_context_source_qualification"][
        "source_scoped_original_payment_event_count"
    ] == 0
