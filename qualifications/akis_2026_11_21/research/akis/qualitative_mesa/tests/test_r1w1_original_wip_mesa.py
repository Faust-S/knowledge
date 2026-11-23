"""R1-W1: source-scoped unfinished production on ONE original Work / Mesa."""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import QualitativeAKIS
from .test_rules import apply, fixture, progress_to_commit


def wip_case():
    d = fixture()
    d["subjects"].append({"id": "c", "kind": "SME"})
    d["resources"][0].update({
        "availability": "AVAILABLE", "capacity_units": 1,
        "capacity_unit": "unit", "site": "A",
    })
    d["resources"].append({
        "id": "rc", "owner": "c", "availability": "AVAILABLE",
        "capacity_units": 1, "capacity_unit": "unit", "site": "C",
    })
    d["works"].append({
        "id": "w2", "customer": "b", "resource": "rc",
        "source_revision": "d-2", "slot_start": 22, "slot_end": 25,
    })
    # New supplier already participates by its own original prospective Work.
    # The relation itself does not authorize a transfer.
    d["cooperation_links"] = [{
        "id": "net", "purpose": "independent works and shared supplies",
        "coordinator": "op", "participants": ["a", "b", "c", "op"],
        "works": ["w1", "w2"], "mechanisms": ["SHARED_LOGISTICS"],
        "source_ref": "model://net/source", "source_revision": "net-r1",
    }]
    return d


def event(action, at, actor, **kwargs):
    return {"action": action, "at": at, "actor": actor, **kwargs}


def submit(state, action, at, actor, **kwargs):
    return state.apply(event(action, at, actor, **kwargs), at)


def base_events():
    return [
        event("offer", 1, "op", work="w1"),
        event("authorize", 2, "op", work="w1"),
        event("consent", 3, "a", work="w1",
              source_revision="d-1", org_revision="oc-1"),
        event("consent", 4, "b", work="w1",
              source_revision="d-1", org_revision="oc-1"),
        event("commit", 5, "op", work="w1"),
        event("start", 6, "a", work="w1"),
        event("resource_status", 7, "a", resource="ra",
              availability="UNAVAILABLE"),
        event("wip_interrupt", 8, "a", work="w1",
              source_revision="d-1", org_revision="oc-1",
              cost_source_ref="model://a/w1-attempt-1-expense",
              prior_cost_claim="60000.00"),
    ]


def original_terms(*, total=5, produced=3, usable=2, materials="7000.00",
                   handling="1500.00", claim="5000.00", full="60000.00",
                   owner="a", ref="ACT-1"):
    return {
        "total_units": total, "produced_units": produced, "usable_units": usable,
        "material_value": materials, "handling_cost": handling,
        "claim_amount": claim, "next_full_cost": full,
        "inspection_ref": f"model://{owner}/{ref}" if (usable or Decimalish(materials)) else "",
        "claim_ref": f"model://{owner}/claim-{ref}" if Decimalish(claim) else "",
    }


def Decimalish(number):
    return float(number) > 0


def proposal(at=9, decision="TRANSFER", target="rc", terms=None, valid=49,
             plan=(22, 27), **changes):
    return event(
        "wip_propose", at, "b", work="w1",
        source_revision="d-1", org_revision="oc-1",
        wip_id="wip-1", work_interruption_at=8,
        wip_decision=decision, wip_source_ref="model://b/wip-proposal-1",
        wip_target_resource=target if decision != "TERMINATE" else None,
        wip_slot_start=plan[0] if decision != "TERMINATE" else None,
        wip_slot_end=plan[1] if decision != "TERMINATE" else None,
        wip_capacity_units=1 if decision != "TERMINATE" else None,
        wip_valid_until=valid, wip_terms=terms or original_terms(),
        **changes,
    )


def prepare(decision="TRANSFER"):
    state = QualitativeAKIS(wip_case())
    for ev in base_events():
        assert state.apply(ev, ev["at"])["outcome"] == "APPLIED", ev["action"]
    assert state.works["w1"].execution == "PAUSED"
    proposed = proposal(decision=decision,
                        target="ra" if decision == "REWORK" else "rc")
    assert state.apply(proposed, 9)["outcome"] == "APPLIED"
    return state, state.works["w1"].wip_proposal["fingerprint"]


def votes(state, digest, *, support=True):
    for at, who in enumerate(("a", "b", "c") if
                             state.works["w1"].wip_proposal["decision"] == "TRANSFER"
                             else ("a", "b"), start=10):
        res = submit(
            state, "wip_review", at, who, work="w1",
            source_revision="d-1", org_revision="oc-1",
            wip_id="wip-1", wip_fingerprint=digest,
            wip_position="OBJECT" if not support and who == "a" else "SUPPORT",
            wip_source_ref=f"model://{who}/wip-vote-{at}",
        )
        assert res["outcome"] == "APPLIED", res


def finish(state, digest, at=13):
    return submit(state, "wip_apply", at, "b",
                  work="w1", source_revision="d-1", org_revision="oc-1",
                  wip_id="wip-1", wip_fingerprint=digest,
                  wip_source_ref="model://b/apply-1")


def test_original_wip_starts_only_after_real_original_start_and_owner_loss():
    state = QualitativeAKIS(wip_case())
    assert submit(state, "wip_interrupt", 1, "a", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  cost_source_ref="model://a/expense", prior_cost_claim="60000.00")["reason"] == (
                      "WIP_REQUIRES_ORIGINAL_OPEN_OBLIGATION")
    for ev in base_events()[:6]:
        assert state.apply(ev, ev["at"])["outcome"] == "APPLIED"
    blocked = submit(state, "wip_interrupt", 7, "a", work="w1",
                     source_revision="d-1", org_revision="oc-1",
                     cost_source_ref="model://a/expense", prior_cost_claim="60000.00")
    assert blocked["reason"] == "WIP_REQUIRES_ORIGINAL_RESOURCE_LOSS"
    assert state.works["w1"].execution == "IN_PROGRESS"
    assert submit(state, "resource_status", 8, "a", resource="ra",
                  availability="UNAVAILABLE")["outcome"] == "APPLIED"
    assert submit(state, "wip_interrupt", 9, "a", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  cost_source_ref="model://a/expense", prior_cost_claim="60000.00")["outcome"] == "APPLIED"
    assert state.works["w1"].execution == "PAUSED"
    assert state.works["w1"].result == "NOT_SUBMITTED"


def test_wip_uses_existing_work_independent_original_votes_and_reservations():
    state, digest = prepare()
    work = state.works["w1"]
    assert work.wip_proposal["lot"]["reusable_resources"] == "31000.00"
    assert work.wip_proposal["lot"]["future_resource_cost"] == "29000.00"
    assert work.wip_proposal["lot"]["reference_gain_vs_complete_redo"] == "29500.00"
    assert finish(state, digest)["reason"] == "WIP_INDEPENDENT_SUPPORT_MISSING"
    assert not work.wip_lots
    votes(state, digest)
    actual = finish(state, digest)
    assert actual["outcome"] == "APPLIED", actual
    assert work.resource == "ra"
    assert work.wip_active_resource == "rc"
    assert work.wip_lots[-1]["status"] == "RESERVED"
    assert work.wip_lots[-1]["holder"] == "a"
    assert work.obligation == "ACCEPTED_BY_ORIGINAL_PRINCIPALS"
    assert work.result == "NOT_SUBMITTED"
    assert [r.resource for r in state.capacity_ledger.reservations if r.work == "w1"] == ["ra", "rc"]
    assert submit(state, "complete", 21, "a", work="w1",
                  result_ref="model://a/stale-result")["outcome"] == "BLOCKED"
    assert submit(state, "wip_resume", 22, "c", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  wip_source_ref="model://c/resume-1")["outcome"] == "APPLIED"
    assert work.wip_lots[-1]["status"] == "CONSUMED"
    assert work.wip_lots[-1]["holder"] == "c"
    assert submit(state, "complete", 23, "a", work="w1",
                  result_ref="model://a/forged-result")["outcome"] == "BLOCKED"
    assert submit(state, "complete", 24, "c", work="w1",
                  result_ref="model://c/actual-wip-result")["outcome"] == "APPLIED"
    assert submit(state, "accept", 25, "b", work="w1")["outcome"] == "APPLIED"
    assert work.result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert work.resource == "ra"
    assert work.wip_amendments[0]["votes"]["a"]["decision"] == "SUPPORT"
    snapshot = state.snapshot()
    assert snapshot["works"]["w1"]["unfinished_production"]["no_second_work_or_result"] is True
    assert len(state.works) == 2
    assert snapshot["works"]["w1"]["resource_owner"] == "a"


def test_objected_amendment_cannot_be_forced_through():
    state, digest = prepare()
    votes(state, digest, support=False)
    assert finish(state, digest)["reason"] == "WIP_INDEPENDENT_SUPPORT_MISSING"
    assert state.works["w1"].wip_lots == []
    assert state.works["w1"].execution == "PAUSED"
    assert state.capacity_ledger.reservations[-1].resource == "ra"


def test_terminated_work_retains_lot_without_a_new_result():
    state, digest = prepare(decision="TERMINATE")
    votes(state, digest)
    actual = finish(state, digest)
    assert actual["outcome"] == "APPLIED", actual
    w = state.works["w1"]
    assert w.execution == "STOPPED"
    assert w.wip_lots[-1]["status"] == "HELD"
    assert w.wip_lots[-1]["cash_recovery_claim"] == "PENDING_NOT_CASH"
    assert w.result == "NOT_SUBMITTED"
    assert len(state.capacity_ledger.reservations) == 1
    assert submit(state, "complete", 20, "a", work="w1",
                  result_ref="model://a/phantom-result")["outcome"] == "BLOCKED"


def test_original_capacity_is_not_double_booked_during_transfer():
    state = QualitativeAKIS(wip_case())
    for ev in base_events()[:6]:
        assert state.apply(ev, ev["at"])["outcome"] == "APPLIED"
    # A separate Work has independently reserved the same receiving plant.
    for ev in [
        event("offer", 7, "op", work="w2"),
        event("authorize", 8, "op", work="w2"),
        event("consent", 9, "c", work="w2", source_revision="d-2", org_revision="oc-1"),
        event("consent", 10, "b", work="w2", source_revision="d-2", org_revision="oc-1"),
        event("commit", 11, "op", work="w2"),
        event("resource_status", 12, "a", resource="ra", availability="UNAVAILABLE"),
        event("wip_interrupt", 13, "a", work="w1", source_revision="d-1",
              org_revision="oc-1", cost_source_ref="model://a/w1-expense",
              prior_cost_claim="60000.00"),
    ]:
        assert state.apply(ev, ev["at"])["outcome"] == "APPLIED", ev
    ev = proposal(at=14,plan=(22, 27))
    ev["work_interruption_at"] = 13
    assert state.apply(ev, 14)["outcome"] == "APPLIED"
    digest = state.works["w1"].wip_proposal["fingerprint"]
    for at, who in enumerate(("a", "b", "c"), start=15):
        assert submit(state, "wip_review", at, who, work="w1",
                      source_revision="d-1", org_revision="oc-1",
                      wip_id="wip-1", wip_fingerprint=digest,
                      wip_position="SUPPORT",
                      wip_source_ref=f"model://{who}/vote-{at}")["outcome"] == "APPLIED"
    result = finish(state, digest, at=18)
    assert result["outcome"] == "BLOCKED"
    assert result["reason"].startswith("WIP_ORIGINAL_CAPACITY_CONFLICT:")
    assert state.works["w1"].wip_lots == []
    assert len([r for r in state.capacity_ledger.reservations if r.resource == "rc"]) == 1


def test_repeated_interruption_references_only_last_attempt_cost_and_quantity():
    state, digest = prepare()
    votes(state, digest)
    actual = finish(state, digest)
    assert actual["outcome"] == "APPLIED", actual
    assert submit(state, "wip_resume", 22, "c", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  wip_source_ref="model://c/resume-1")["outcome"] == "APPLIED"
    assert submit(state, "resource_status", 23, "c", resource="rc",
                  availability="UNAVAILABLE")["outcome"] == "APPLIED"
    assert submit(state, "wip_interrupt", 24, "c", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  cost_source_ref="model://c/attempt-2", prior_cost_claim="60000.00")["reason"] == (
                      "WIP_LATEST_ATTEMPT_COST_MISMATCH")
    assert submit(state, "wip_interrupt", 25, "c", work="w1",
                  source_revision="d-1", org_revision="oc-1",
                  cost_source_ref="model://c/attempt-2", prior_cost_claim="29000.00")["outcome"] == "APPLIED"
    ev = proposal(at=26, decision="TERMINATE",
                  terms=original_terms(total=3, produced=1, usable=1,
                                       materials="0.00", handling="500.00",
                                       claim="1000.00", full="29000.00",
                                       owner="c", ref="ACT-SECOND"))
    ev["work_interruption_at"] = 25
    ev["wip_id"] = "wip-2"
    ev["wip_source_ref"] = "model://b/wip-proposal-2"
    assert state.apply(ev, 26)["outcome"] == "APPLIED"
    second = state.works["w1"].wip_proposal
    digest2 = second["fingerprint"]
    for at, who in ((27, "b"), (28, "c")):
        assert submit(state, "wip_review", at, who, work="w1",
                      source_revision="d-1", org_revision="oc-1",
                      wip_id="wip-2", wip_fingerprint=digest2,
                      wip_position="SUPPORT", wip_source_ref=f"model://{who}/vote-2")["outcome"] == "APPLIED"
    result = submit(state, "wip_apply", 29, "b", work="w1",
                    source_revision="d-1", org_revision="oc-1",
                    wip_id="wip-2", wip_fingerprint=digest2,
                    wip_source_ref="model://b/apply-2")
    assert result["outcome"] == "APPLIED"
    assert len(state.works["w1"].wip_interruptions) == 2
    assert len(state.works["w1"].wip_lots) == 2
    assert state.works["w1"].wip_lots[0]["status"] == "CONSUMED"
    assert state.works["w1"].wip_lots[1]["status"] == "HELD"
    assert state.works["w1"].result == "NOT_SUBMITTED"


def test_real_mesa_scheduler_keeps_one_original_event_trace():
    d = wip_case()
    # Establish the proposal digest using precisely the same original input
    # prefix; no second simulator is introduced to calculate consent.
    scratch = QualitativeAKIS(deepcopy(d))
    events = [*base_events(), proposal()]
    for ev in events:
        assert scratch.apply(ev, ev["at"])["outcome"] == "APPLIED", ev
    digest = scratch.works["w1"].wip_proposal["fingerprint"]
    events.extend([
        event("wip_review", 10, "a", work="w1", source_revision="d-1",
              org_revision="oc-1", wip_id="wip-1", wip_fingerprint=digest,
              wip_position="SUPPORT", wip_source_ref="model://a/vote"),
        event("wip_review", 11, "b", work="w1", source_revision="d-1",
              org_revision="oc-1", wip_id="wip-1", wip_fingerprint=digest,
              wip_position="SUPPORT", wip_source_ref="model://b/vote"),
        event("wip_review", 12, "c", work="w1", source_revision="d-1",
              org_revision="oc-1", wip_id="wip-1", wip_fingerprint=digest,
              wip_position="SUPPORT", wip_source_ref="model://c/vote"),
        event("wip_apply", 13, "b", work="w1", source_revision="d-1",
              org_revision="oc-1", wip_id="wip-1", wip_fingerprint=digest,
              wip_source_ref="model://b/apply"),
        event("wip_resume", 22, "c", work="w1", source_revision="d-1",
              org_revision="oc-1", wip_source_ref="model://c/resume"),
        event("complete", 23, "c", work="w1",
              result_ref="model://c/wip-complete"),
        event("accept", 24, "b", work="w1"),
    ])
    d["events"] = events
    result = simulate(deepcopy(d))
    assert all(row["outcome"] == "APPLIED" for row in result["trace"]), [row for row in result["trace"] if row["outcome"] != "APPLIED"]
    assert result["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert result["works"]["w1"]["unfinished_production"]["material_lots"][0]["status"] == "CONSUMED"
    assert result["works"]["w1"]["resource_owner"] == "a"
    assert result["works"]["w1"]["unfinished_production"]["current_resource"] == "rc"
    assert len([r for r in result["trace"] if r["action"] == "wip_apply"]) == 1
    assert len(result["works"]) == 2
    assert simulate(deepcopy(d)) == result
