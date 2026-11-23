"""R4 buyer-originated withdrawal of outside demand, in ONE ORIGINAL Mesa.

Withdrawal is NOT a contract cancellation. All supplier Work and historical
Result remain original, with buyer and seller sources checked by original KPB.
A withdrawal is never a reason to reauthorize or rewrite committed Work.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import (
    OperatorAKISModel, simulate,
)
from research.akis.qualitative_mesa.tests.test_r4_independent_external_buyer_demand_mesa import (
    independent_buyer_case, demand_event, owner_assessments,
    positions, BUYER, BUYER_SOURCE, DEMAND_ID, REVISION,
)
from research.akis.qualitative_mesa.tests.test_r1l_post_result_original_reproduction_mesa import find


WITHDRAW_SOURCE = "model://x/independent-r4-demand-withdrawal"
WITHDRAW_REVISION = "buyer-withdraw-r4-v1"


def unused_tick(d, begin=79, end=130):
    used = {event["at"] for event in d["events"]}
    return next(t for t in range(begin, end) if t not in used)


def with_buyer_withdrawal(at=None):
    d = independent_buyer_case()
    d["context_evidence"]["sources"].append({
        "id": WITHDRAW_SOURCE, "owner": BUYER,
        "revision": WITHDRAW_REVISION, "status": "CONFIRMED",
        "usable_by": ["x", "a"], "core": "corporate",
        "purposes": ["AKIS_EXTERNAL_DEMAND_EVIDENCE"],
        "operations": ["READ"], "valid_from": 0, "valid_until": 160,
    })
    if at is None:
        at = unused_tick(d, 79, 82)
    d["events"].append({
        "at": at, "action": "outside_demand_withdraw",
        "actor": BUYER, "outside_demand_id": DEMAND_ID,
        "outside_withdrawal_source_ref": WITHDRAW_SOURCE,
        "outside_withdrawal_source_revision": WITHDRAW_REVISION,
    })
    d["events"].sort(key=lambda row: row["at"])
    return d


def withdrawal_event(d):
    return next(row for row in d["events"]
                if row["action"] == "outside_demand_withdraw")


def expect_owner_reason(out, reason):
    assessments = owner_assessments(out)
    assert any(row[2] == reason for row in assessments), assessments


def test_buyer_own_independent_withdrawal_applies_before_work_and_blocks_future_model_revenue():
    base, altered = independent_buyer_case(), with_buyer_withdrawal()
    before = deepcopy(altered)
    old, output = simulate(base), simulate(altered)
    assert altered == before
    original = find(output, "outside_demand_signal")[0]
    cancelled = find(output, "outside_demand_withdraw")[0]
    assert original["outcome"] == "APPLIED"
    assert cancelled["outcome"] == "APPLIED"
    assert cancelled["actor"] == BUYER
    assert cancelled["historical_original_Work_Result_not_rewritten"]
    assert cancelled["outside_work_or_money_not_created"]
    assert "COOPERATION_PREFERRED" in positions(old)
    expect_owner_reason(output, "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER")
    assert "COOPERATION_PREFERRED" not in positions(output)
    assert output["works"] == old["works"]
    assert output["profit"]["system_increment"] == "UNKNOWN"
    assert output["counts"]["blocked"] == 0


def test_buyer_late_withdrawal_triggers_same_mesa_agent_reassessment_but_preserves_accepted_work():
    d = with_buyer_withdrawal(at=unused_tick(independent_buyer_case(), 95, 110))
    event_at = withdrawal_event(d)["at"]
    out = simulate(d)
    assert find(out, "outside_demand_withdraw")[0]["outcome"] == "APPLIED"
    a = [
        row for row in out["decision_observations"]
        if row.get("subject") == "a" and row.get("work") == "w3"
        and "economic_position" in row
    ]
    assert any(row["at"] < event_at and
               row["economic_position"] == "COOPERATION_PREFERRED"
               for row in a), [(r["at"], r.get("economic_reason")) for r in a]
    assert any(row["at"] >= event_at and
               row["trigger"] == "outside_demand_withdraw" and
               row.get("economic_reason") == "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER"
               for row in a), [(r["at"], r.get("trigger"), r.get("economic_reason")) for r in a]
    assert all(out["works"][k]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for k in ("w1", "w2", "w3"))
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_seller_cannot_close_independent_buyer_demand_for_buyer():
    d = with_buyer_withdrawal()
    withdrawal_event(d)["actor"] = "a"
    out = simulate(d)
    cancelled = find(out, "outside_demand_withdraw")[0]
    assert cancelled["outcome"] == "BLOCKED"
    assert cancelled["reason"] == "OUTSIDE_DEMAND_WITHDRAW_ORIGINAL_BUYER_ONLY"
    assert "COOPERATION_PREFERRED" in positions(out)


def test_operator_cannot_retract_buyers_original_demand():
    d = with_buyer_withdrawal()
    withdrawal_event(d)["actor"] = "op"
    out = simulate(d)
    assert find(out, "outside_demand_withdraw")[0]["reason"] == (
        "OUTSIDE_DEMAND_WITHDRAW_ORIGINAL_BUYER_ONLY"
    )


def test_withdrawal_before_original_buyer_signal_cannot_be_applied():
    d = with_buyer_withdrawal()
    withdrawal_event(d)["at"] = unused_tick(d, 1, 78)
    d["events"].sort(key=lambda event: event["at"])
    out = simulate(d)
    assert find(out, "outside_demand_withdraw")[0]["reason"] == (
        "OUTSIDE_DEMAND_WITHDRAW_ORIGINAL_SIGNAL_REQUIRED"
    )
    assert "COOPERATION_PREFERRED" in positions(out)


def test_withdrawal_after_buyer_signal_expiry_cannot_invent_history():
    d = with_buyer_withdrawal()
    demand_event(d)["outside_demand_valid_until"] = 80
    withdrawal_event(d)["at"] = unused_tick(d, 81, 120)
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert find(out, "outside_demand_withdraw")[0]["reason"] == (
        "OUTSIDE_DEMAND_WITHDRAW_EVENT_TIME_INVALID"
    )


@pytest.mark.parametrize("mutator,expected", [
    (lambda d: withdrawal_event(d).update(
        outside_demand_id="unknown-external-buyer-id"),
     "OUTSIDE_DEMAND_WITHDRAW_ORIGINAL_SIGNAL_REQUIRED"),
    (lambda d: withdrawal_event(d).update(
        outside_withdrawal_source_ref=BUYER_SOURCE),
     "OUTSIDE_DEMAND_WITHDRAW_INDEPENDENT_OWNER_EDITION_REQUIRED"),
    (lambda d: withdrawal_event(d).update(
        outside_withdrawal_source_revision="invalid-old-revision"),
     "OUTSIDE_DEMAND_WITHDRAW_SOURCE_NOT_QUALIFIED"),
    (lambda d: withdrawal_event(d).update(
        outside_withdrawal_source_ref="model://a/foreign-seller-statement"),
     "OUTSIDE_DEMAND_WITHDRAW_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(s for s in d["context_evidence"]["sources"]
                    if s["id"] == WITHDRAW_SOURCE).update(status="DISPROVED"),
     "OUTSIDE_DEMAND_WITHDRAW_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(s for s in d["context_evidence"]["sources"]
                    if s["id"] == WITHDRAW_SOURCE).update(usable_by=["x"]),
     "OUTSIDE_DEMAND_WITHDRAW_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(s for s in d["context_evidence"]["sources"]
                    if s["id"] == WITHDRAW_SOURCE).update(operations=["SHARE"]),
     "OUTSIDE_DEMAND_WITHDRAW_SOURCE_NOT_QUALIFIED"),
    (lambda d: next(s for s in d["context_evidence"]["sources"]
                    if s["id"] == WITHDRAW_SOURCE).update(valid_until=77),
     "OUTSIDE_DEMAND_WITHDRAW_SOURCE_NOT_QUALIFIED"),
])
def test_forged_stale_or_out_of_scope_withdrawal_cannot_disable_buyer_request(
        mutator, expected):
    d = with_buyer_withdrawal()
    mutator(d)
    out = simulate(d)
    assert find(out, "outside_demand_withdraw")[0]["outcome"] == "BLOCKED"
    assert find(out, "outside_demand_withdraw")[0]["reason"] == expected
    assert "COOPERATION_PREFERRED" in positions(out)
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_duplicate_withdrawal_is_blocked_not_new_history_or_money():
    d = with_buyer_withdrawal()
    dupe = deepcopy(withdrawal_event(d))
    dupe["at"] = unused_tick(d, dupe["at"]+1, 83)
    d["events"].append(dupe)
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert [(row["outcome"], row["reason"])
            for row in find(out, "outside_demand_withdraw")] == [
        ("APPLIED", "NONE"),
        ("BLOCKED", "OUTSIDE_DEMAND_ALREADY_WITHDRAWN"),
    ]
    expect_owner_reason(out, "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER")


def test_new_owner_declared_buyer_request_requires_new_id_and_owner_forecast_choice():
    d = with_buyer_withdrawal()
    fresh_id = "buyer-r4-reissued-new-need"
    new_source = "model://x/new-independent-request-r4-v2"
    d["context_evidence"]["sources"].append({
        "id": new_source, "owner": BUYER,
        "revision": "buyer-r4-request-v2",
        "status": "CONFIRMED", "usable_by": ["x", "a"],
        "core": "corporate",
        "purposes": ["AKIS_EXTERNAL_DEMAND_EVIDENCE"],
        "operations": ["READ"], "valid_from": 0, "valid_until": 160,
    })
    fresh = deepcopy(demand_event(d))
    fresh["at"] = unused_tick(d, 80, 83)
    fresh["outside_demand_id"] = fresh_id
    fresh["outside_demand_source_ref"] = new_source
    fresh["outside_demand_source_revision"] = "buyer-r4-request-v2"
    d["events"].append(fresh)
    d["events"].sort(key=lambda row: row["at"])
    # The seller independently selects the new demand in its OWN outlook;
    # earlier withdrawn IDs never get automatically substituted.
    next(s for s in d["economic_outlooks"] if s["owner"] == "a")[
        "outside_demand_claim"]["signal_id"] = fresh_id
    out = simulate(d)
    assert [row["outcome"] for row in find(out, "outside_demand_signal")] == [
        "APPLIED", "APPLIED"
    ]
    assert find(out, "outside_demand_withdraw")[0]["outcome"] == "APPLIED"
    assert "COOPERATION_PREFERRED" in positions(out)
    assert len(out["works"]) == 4  # w0 original draft plus w1-w3, not outside Work.
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_duplicate_reissued_request_cannot_reuse_original_buyer_demand_id():
    d = with_buyer_withdrawal()
    new = deepcopy(demand_event(d))
    new["at"] = unused_tick(d, 80, 83)
    d["events"].append(new)
    d["events"].sort(key=lambda row: row["at"])
    out = simulate(d)
    assert [row["outcome"] for row in find(out, "outside_demand_signal")] == [
        "APPLIED", "BLOCKED"
    ]
    assert find(out, "outside_demand_signal")[1]["reason"] == (
        "OUTSIDE_DEMAND_DUPLICATE_ORIGINAL_SIGNAL"
    )
    expect_owner_reason(out, "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER")


def test_later_revocation_of_withdrawal_source_does_not_reactivate_demand():
    d = with_buyer_withdrawal()
    tick = unused_tick(d, 95, 110)
    d["events"].append({
        "at": tick, "action": "source_update", "actor": BUYER,
        "source": WITHDRAW_SOURCE,
        "expected_revision": WITHDRAW_REVISION,
        "new_revision": "buyer-withdraw-r4-revoked",
        "status": "DISPROVED",
    })
    d["events"].sort(key=lambda row: row["at"])
    model = OperatorAKISModel(d)
    output = model.execute()
    assert find(output, "source_update")[0]["outcome"] == "APPLIED"
    assert find(output, "outside_demand_withdraw")[0]["outcome"] == "APPLIED"
    expect_owner_reason(output, "OUTSIDE_DEMAND_WITHDRAWN_BY_ORIGINAL_BUYER")
    assert model.qualitative.context_basis.sources[WITHDRAW_SOURCE].status == "DISPROVED"
    assert all(output["works"][k]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
               for k in ("w1", "w2", "w3"))


def test_withdrawal_never_changes_original_legal_consents_work_or_result():
    base = simulate(independent_buyer_case())
    cancelled = simulate(with_buyer_withdrawal())
    assert base["works"] == cancelled["works"]
    assert cancelled["profit"] == base["profit"]
    assert cancelled["general_akis_model"]["legal_consent_created"] is False
    assert not any(row.get("work", "").startswith("__akis_outside_candidate__")
                   for row in cancelled["trace"] if isinstance(row.get("work", ""), str))
