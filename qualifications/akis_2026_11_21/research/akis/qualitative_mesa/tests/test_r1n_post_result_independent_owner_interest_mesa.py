"""AKIS R1-N: original Result changes independent principals' interests.

An owner may change willingness after evaluating an accepted Result; their
new individual position can block a FUTURE Work even when a stale consent
exists. Neither a claimed outside option nor a positive model opinion
establishes real prices, legal permissions, profit or coalition membership.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r1m_result_conditioned_owner_needs_mesa import result_goal_case
from .test_r1l_post_result_original_reproduction_mesa import find


def r1n_case(*, include_a=True, include_b=True,
             a_willingness="WILLING", b_willingness="WILLING",
             a_outside="OUTSIDE_PREFERRED", b_outside="UNKNOWN",
             interest_expires_at=90):
    d = result_goal_case()
    g = d["general_akis"]
    g["enforce_model_result_conditioned_interests"] = True
    # The original thirteen OC fields must EXPLICITLY include the existing
    # interest_update event and both responsible roles. No implicit grants.
    records = {row["field"]: row["control"]
               for row in g["organizational_code"]}
    records["Событ"]["new_work_events"].append("interest_update")
    for role in ("CUSTOMER", "RESOURCE_OWNER"):
        rights = next(r for r in records["Пр"]["permitted"]
                      if r["subject"] == role)["items"]
        if "interest_update" not in rights:
            rights.append("interest_update")
    # Retain the original Mesa ordering and the same initial customer/pilot.
    # Insert two decisions AFTER request w2 and BEFORE its separate phases
    # and consent. All original second Work events shift as one sequence.
    for ev in d["events"]:
        if ev["at"] >= 35:
            ev["at"] += 2
        if ev["action"] == "function_review" and ev.get("work") == "w2":
            ev["prepared_at"] += 2
    events = []
    for actor, at, enabled, willingness, outside in (
        ("a", 35, include_a, a_willingness, a_outside),
        ("b", 36, include_b, b_willingness, b_outside),
    ):
        if enabled:
            events.append({
                "at": at, "action": "interest_update", "actor": actor,
                "work": "w2", "source_revision": "d-2",
                "org_revision": "oc-1",
                "cooperation_link": "l1",
                "cooperation_source_revision": "rel-1",
                "economic_channel": "TRANSACTION_COST",
                "new_willingness": willingness,
                "new_outside_option": outside,
                "interest_evidence_ref": f"model://{actor}/w2-own-interest",
                "interest_valid_until": interest_expires_at,
                "pilot_work": "w1",
                "pilot_result_ref": "model://w1-result",
                "pilot_decision_at": 29,
            })
    d["events"].extend(events)
    d["events"].sort(key=lambda x: x["at"])
    d["model_horizon"] = 78
    return d


def test_r1n_two_original_owners_reconsider_after_result_and_second_work_completes():
    d = r1n_case()
    original = deepcopy(d)
    out = simulate(d)
    assert d == original
    assert out["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e["reason"])
        for e in out["trace"] if e["outcome"] == "BLOCKED"
    ]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    interests = find(out, "interest_update", work="w2")
    assert [x["actor"] for x in interests] == ["a", "b"]
    assert all(x["outcome"] == "APPLIED" for x in interests)
    assert interests[0]["interest_outside_option"] == "OUTSIDE_PREFERRED"
    assert [x["at"] for x in find(out, "consent", work="w2")] == [51, 52]
    assert find(out, "commit", work="w2")[0]["outcome"] == "APPLIED"
    check = out["general_akis_model"]["result_conditioned_owner_interests"]
    assert check["opted_in"] is True
    assert check["original_individual_interest_claims"] == 2
    assert check["outside_option_preferences_not_verified_profit"] is True
    assert check["real_market_price_or_owner_profit_proven"] is False
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out


def test_r1n_missing_original_resource_owner_interest_prevents_commit():
    d = r1n_case(include_a=False)
    out = simulate(d)
    assert [e["outcome"] for e in find(out, "consent", work="w2")] == [
        "APPLIED", "APPLIED"
    ]
    assert find(out, "commit", work="w2")[0]["reason"] == (
        "FORMATION_INTEREST_INDEPENDENT_OWNER_POSITION_REQUIRED"
    )
    assert out["works"]["w2"]["result"] == "NOT_SUBMITTED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1n_missing_customer_interest_prevents_new_work_commit():
    out = simulate(r1n_case(include_b=False))
    assert find(out, "commit", work="w2")[0]["reason"] == (
        "FORMATION_INTEREST_INDEPENDENT_OWNER_POSITION_REQUIRED"
    )
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"


@pytest.mark.parametrize("state,reason", [
    ("DECLINES", "FORMATION_INTEREST_ORIGINAL_OWNER_DECLINES"),
    ("UNKNOWN", "FORMATION_INTEREST_ORIGINAL_OWNER_UNDECIDED"),
])
def test_r1n_new_owner_refusal_or_unknown_blocks_even_after_old_consent(state, reason):
    d = r1n_case(a_willingness=state)
    out = simulate(d)
    interest = find(out, "interest_update", work="w2")[0]
    assert interest["outcome"] == "APPLIED"
    assert interest["interest_willingness"] == state
    assert find(out, "commit", work="w2")[0]["reason"] == reason
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"


def test_r1n_expires_after_independent_interest_before_original_commit():
    d = r1n_case(interest_expires_at=51)
    out = simulate(d)
    assert all(x["outcome"] == "APPLIED"
               for x in find(out, "interest_update", work="w2"))
    assert find(out, "commit", work="w2")[0]["reason"] == (
        "FORMATION_INTEREST_OWNER_SOURCE_EXPIRED"
    )


@pytest.mark.parametrize("change,reason", [
    (lambda e: e.update(interest_evidence_ref="model://op/foreign"),
     "FORMATION_INTEREST_OWNER_SOURCE_REQUIRED"),
    (lambda e: e.update(interest_valid_until=35),
     "FORMATION_INTEREST_SOURCE_EXPIRY_REQUIRED"),
    (lambda e: e.update(pilot_result_ref="model://unrelated-result"),
     "FORMATION_INTEREST_ORIGINAL_RESULT_BINDING_REQUIRED"),
    (lambda e: e.update(pilot_decision_at=30),
     "FORMATION_INTEREST_ORIGINAL_RESULT_BINDING_REQUIRED"),
    (lambda e: e.update(pilot_work="w0"),
     "FORMATION_INTEREST_ORIGINAL_RESULT_BINDING_REQUIRED"),
])
def test_r1n_foreign_stale_or_misbound_interest_cannot_enable_commit(change, reason):
    d = r1n_case()
    event = next(e for e in d["events"]
                 if e["action"] == "interest_update" and e["actor"] == "a")
    change(event)
    out = simulate(d)
    assert find(out, "interest_update", work="w2")[0]["reason"] == reason
    assert find(out, "commit", work="w2")[0]["outcome"] == "BLOCKED"
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "NOT_SUBMITTED"


def test_r1n_later_individual_interest_requires_new_original_consent():
    d = r1n_case()
    # Prior consent a at 51 is real but a later economic preference at 54
    # must never use it as if consent occurred AFTER the changed position.
    later = deepcopy(next(e for e in d["events"]
                          if e["action"] == "interest_update" and e["actor"] == "a"))
    later.update(at=54, interest_evidence_ref="model://a/changed-w2-interest")
    next(e for e in d["events"] if e["action"] == "commit"
         and e["work"] == "w2")["at"] = 55
    d["events"].append(later)
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert [e["outcome"] for e in find(out, "interest_update", work="w2")] == [
        "APPLIED", "APPLIED", "APPLIED"
    ]
    assert find(out, "commit", work="w2")[0]["reason"] == (
        "FORMATION_INTEREST_CONSENT_MUST_FOLLOW_LATEST_OWNER_POSITION"
    )
    assert out["works"]["w1"]["obligation"] == "FULFILLED"
    assert out["works"]["w2"]["obligation"] == "NOT_ACCEPTED"


def test_r1n_owner_may_renew_consent_after_latest_interest_with_original_work():
    d = r1n_case()
    later = deepcopy(next(e for e in d["events"]
                          if e["action"] == "interest_update" and e["actor"] == "a"))
    later.update(at=54, interest_evidence_ref="model://a/new-interest-w2")
    consent = deepcopy(next(e for e in d["events"]
                            if e["action"] == "consent" and e["actor"] == "a"
                            and e["work"] == "w2"))
    consent["at"] = 55
    next(e for e in d["events"] if e["action"] == "commit"
         and e["work"] == "w2")["at"] = 56
    d["events"].extend([later, consent])
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e["reason"])
        for e in out["trace"] if e["outcome"] == "BLOCKED"
    ]
    assert find(out, "commit", work="w2")[0]["outcome"] == "APPLIED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1n_independent_participation_reconsideration_invalidates_old_interest():
    d = r1n_case()
    ev = deepcopy(next(e for e in d["events"]
                       if e["action"] == "participation_status"
                       and e["actor"] == "a"))
    ev.update(at=54, new_participation="OPEN_TO_NEW_WORK",
              participation_evidence_ref="model://a/new-owner-review-w1")
    next(e for e in d["events"] if e["action"] == "commit"
         and e["work"] == "w2")["at"] = 55
    d["events"].append(ev)
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert find(out, "participation_status", actor="a")[-1]["outcome"] == "APPLIED"
    assert find(out, "commit", work="w2")[0]["reason"] == (
        "FORMATION_INTEREST_OWNER_RECONSIDERED_AFTER_POSITION"
    )


def test_r1n_interest_update_does_not_reverse_accepted_old_work():
    d = r1n_case()
    attempted = deepcopy(next(e for e in d["events"]
                              if e["action"] == "interest_update" and
                              e["actor"] == "a"))
    attempted.update(at=66, work="w1", source_revision="d-1",
                     new_willingness="DECLINES")
    d["events"].append(attempted)
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert find(out, "interest_update", work="w1")[0]["reason"] == (
        "INTEREST_UPDATE_CANNOT_REWRITE_ACCEPTED_OBLIGATION"
    )
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1n_opt_out_preserves_existing_historical_interest_semantics():
    d = r1n_case(include_a=False)
    d["general_akis"]["enforce_model_result_conditioned_interests"] = False
    out = simulate(d)
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_model"]["result_conditioned_owner_interests"][
        "opted_in"] is False


def test_r1n_new_interest_gate_requires_existing_result_conditioned_goals():
    d = r1n_case()
    d["general_akis"]["enforce_model_result_conditioned_goals"] = False
    with pytest.raises(ValueError, match="FORMATION_INTEREST_REQUIRES_RESULT_CONDITIONED_GOALS"):
        simulate(d)
