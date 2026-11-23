"""R2: historical event eligibility and current READ use are separate.

Use ONLY original ContextBasis source_update events (one Mesa trace) for
source-revision history. Old Work/Result, transfers and owner declarations
are neither rewritten nor authenticated as real bank statements.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.context_basis import ContextBlocked
from research.akis.qualitative_mesa.mesa_model import (
    OperatorAKISModel, simulate,
)
from research.akis.qualitative_mesa.rules import InputError

from .test_r2_strict_original_payment_evidence_mesa import (
    scoped_bilateral_payment_case,
)


REF = "model://c/partial-w2-01-statement"
CORE = "institutional"
PURPOSE = "AKIS_ECONOMIC_WORK_EVIDENCE"


def change(d, at, status, previous, updated):
    d["events"].append({
        "at": at, "actor": "c", "action": "source_update",
        "source": REF, "status": status,
        "expected_revision": previous, "new_revision": updated,
    })
    d["events"].sort(key=lambda row: row["at"])
    d["model_horizon"] = max(d["model_horizon"], at + 2)
    assert len({row["at"] for row in d["events"]}) == len(d["events"])


def check_historical(state, revision, when):
    state.context_basis.assert_original_historical_form_role_source(
        "c", REF, revision, core=CORE, purpose=PURPOSE,
        operation="READ", recipients={"c"}, at=when,
    )


def check_current(state, revision, when):
    state.context_basis.assert_original_form_role_source(
        "c", REF, revision, core=CORE, purpose=PURPOSE,
        operation="READ", recipients={"c"}, at=when,
    )


def test_later_revocation_does_not_retroactively_invalidate_original_statement():
    d = scoped_bilateral_payment_case()
    change(d, 103, "DISPROVED", "receipt-r1", "receipt-r2")
    original = deepcopy(d)
    model = OperatorAKISModel(d)
    with pytest.raises(
        InputError, match="ORIGINAL_PAYMENT_EVIDENCE_NOT_USABLE_IN_STRICT_KPB"
    ):
        model.execute()
    assert d == original
    assert model.qualitative.works["w1"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )
    assert model.qualitative.works["w2"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )
    assert any(
        row["action"] == "source_update"
        and row["source"] == REF and row["outcome"] == "APPLIED"
        for row in model.qualitative.trace
    )
    # Historical fact remains *model-valid* at 101, yet present-day
    # reading is disallowed after the owning enterprise's 103 revocation.
    check_historical(model.qualitative, "receipt-r1", 101)
    with pytest.raises(ContextBlocked, match="CONTEXT_SOURCE_DISPROVED"):
        check_current(model.qualitative, "receipt-r2", 105)
    with pytest.raises(ContextBlocked, match="CONTEXT_REVISION_STALE"):
        check_historical(model.qualitative, "receipt-r2", 101)


def test_later_restoration_does_not_rewrite_original_version_and_can_restore_read():
    d = scoped_bilateral_payment_case()
    change(d, 103, "DISPROVED", "receipt-r1", "receipt-r2")
    change(d, 105, "CONFIRMED", "receipt-r2", "receipt-r3")
    d["model_horizon"] = 106
    out = simulate(d)
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["economics"]["original_strict_context_source_qualification"][
        "historical_event_revision_replayed_in_original_KPB"
    ]
    assert out["economics"]["original_strict_context_source_qualification"][
        "current_original_read_right_checked_separately"
    ]
    model = OperatorAKISModel(d)
    model.execute()
    check_historical(model.qualitative, "receipt-r1", 101)
    with pytest.raises(ContextBlocked, match="CONTEXT_SOURCE_DISPROVED"):
        check_historical(model.qualitative, "receipt-r2", 104)
    check_historical(model.qualitative, "receipt-r3", 106)
    check_current(model.qualitative, "receipt-r3", 106)


def test_later_reinstatement_cannot_authorize_old_disproved_payment_evidence():
    d = scoped_bilateral_payment_case()
    source = next(
        row for row in d["context_evidence"]["sources"]
        if row["id"] == REF
    )
    source["status"] = "DISPROVED"
    change(d, 103, "CONFIRMED", "receipt-r1", "receipt-r2")
    model = OperatorAKISModel(d)
    with pytest.raises(
        InputError, match="ORIGINAL_PAYMENT_EVIDENCE_NOT_USABLE_IN_STRICT_KPB"
    ):
        model.execute()
    with pytest.raises(ContextBlocked, match="CONTEXT_SOURCE_DISPROVED"):
        check_historical(model.qualitative, "receipt-r1", 101)
    check_current(model.qualitative, "receipt-r2", 105)
    assert model.qualitative.works["w2"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )


def test_same_tick_source_update_and_payment_statement_do_not_imply_order():
    d = scoped_bilateral_payment_case()
    change(d, 101, "DISPROVED", "receipt-r1", "receipt-r2")
    model = OperatorAKISModel(d)
    with pytest.raises(
        InputError, match="ORIGINAL_PAYMENT_EVIDENCE_NOT_USABLE_IN_STRICT_KPB"
    ):
        model.execute()
    with pytest.raises(
        ContextBlocked, match="CONTEXT_HISTORICAL_SAME_TICK_SOURCE_UPDATE_UNQUALIFIED"
    ):
        check_historical(model.qualitative, "receipt-r1", 101)


def test_evidence_not_yet_in_original_mesa_horizon_is_not_qualified():
    d = scoped_bilateral_payment_case()
    d["model_horizon"] = 100
    model = OperatorAKISModel(d)
    with pytest.raises(
        InputError, match="ORIGINAL_PAYMENT_EVIDENCE_NOT_USABLE_IN_STRICT_KPB"
    ):
        model.execute()
    assert model.qualitative.works["w2"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )


def test_original_source_order_unknown_fails_closed_without_second_registry():
    d = scoped_bilateral_payment_case()
    model = OperatorAKISModel(d)
    model.execute()
    # Legacy direct caller has no original Mesa tick; historical source order
    # must become UNKNOWN, even when the final owner source is CONFIRMED.
    basis = model.qualitative.context_basis
    basis.owner_update({
        "actor": "c", "source": REF, "status": "CONFIRMED",
        "expected_revision": "receipt-r1", "new_revision": "receipt-r2",
    })
    with pytest.raises(ContextBlocked, match="CONTEXT_HISTORICAL_SOURCE_ORDER_UNKNOWN"):
        check_historical(model.qualitative, "receipt-r1", 101)
    check_current(model.qualitative, "receipt-r2", 104)


def test_historical_source_time_and_revision_are_exact():
    d = scoped_bilateral_payment_case()
    model = OperatorAKISModel(d)
    model.execute()
    for when in (-1, 10001, 101.5):
        with pytest.raises(ContextBlocked, match="CONTEXT_HISTORICAL_EVENT_TIME_INVALID"):
            check_historical(model.qualitative, "receipt-r1", when)
    with pytest.raises(ContextBlocked, match="CONTEXT_REVISION_STALE"):
        check_historical(model.qualitative, "receipt-r3", 101)
