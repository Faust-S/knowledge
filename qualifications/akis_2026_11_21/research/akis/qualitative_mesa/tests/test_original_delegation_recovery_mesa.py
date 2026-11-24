"""Original same-Work delegation renewal, with costs of every actual attempt."""
from copy import deepcopy
from decimal import Decimal

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_original_bounded_delegation_mesa import delegated_route, grant, MANDATE
from .test_original_preparation_pattern_revision_mesa import (
    event, without_costs, structural_view, ACCEPTED,
)


def append_mandate_cost(doc, mandate, rid, amount):
    money = doc["economic_claims"]
    life = money["lifecycle_costs"]
    proof = "model://b/" + rid + "-proof"
    doc["context_evidence"]["sources"].append({
        "id": proof, "owner": "b", "revision": "cost-v1",
        "status": "CONFIRMED", "usable_by": ["b"], "core": "corporate",
        "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
        "valid_from": 0, "valid_until": 160,
    })
    money["resource_uses"].append({
        "id": rid, "scenario": "COOPERATION", "work": "w3", "owner": "b",
        "source": "terms-b", "amount": amount, "bucket": "COORDINATION",
    })
    life["bindings"].append({
        "resource_use_id": rid, "owner": "b", "source": "terms-b",
        "stage": "CONTRACT_AND_PERMISSIONS", "nature": "TRANSACTION",
    })
    life["event_bindings"].append({
        "resource_use_id": rid, "work": "w3", "owner": "b", "source": "terms-b",
        "work_source_revision": "d-3", "trace_position": doc["events"].index(mandate),
        "at": mandate["at"], "action": "function_delegate", "org_revision": "oc-1",
        "cost_evidence_ref": proof, "cost_evidence_revision": "cost-v1",
    })


def reindex(doc):
    doc["events"].sort(key=lambda row: row["at"])
    assert len({row["at"] for row in doc["events"]}) == len(doc["events"])
    positions = {row["at"]: i for i, row in enumerate(doc["events"])}
    for row in doc["economic_claims"]["lifecycle_costs"]["event_bindings"]:
        row["trace_position"] = positions[row["at"]]


def drop_cost(doc, rid):
    money = doc["economic_claims"]
    money["resource_uses"] = [r for r in money["resource_uses"] if r["id"] != rid]
    for key in ("bindings", "event_bindings", "preparation_activity_bindings"):
        money["lifecycle_costs"][key] = [r for r in money["lifecycle_costs"][key]
                                           if r["resource_use_id"] != rid]


def renewal_routes(*, first_cost="12.00", renewed_cost="12.00", patterns=False,
                   same_revision=False):
    """Same original commitment, execution, quality, acceptance and cash.

    EARLY prepares only after the customer's source change; RECOVERED first
    prepares and gets approval, then original commit fails, then an independent
    new grant, preparation and review. S1_DIRECT is available only without
    structural patterns, which are mode-specific in the original model.
    """
    late = delegated_route(costs=True, patterns=patterns)
    g1 = grant(late)
    p1 = event(late, "function_prepare", "w3")
    r1 = event(late, "function_review", "w3")
    commit = event(late, "commit", "w3")
    tick = commit["at"]
    rev = "mandate-v1" if same_revision else "mandate-v2"
    failed = dict(deepcopy(commit), at=tick+1)
    g2 = dict(deepcopy(g1), at=tick+2, delegation_source_revision=rev)
    p2 = dict(deepcopy(p1), at=tick+3, delegation_at=g2["at"])
    r2 = dict(deepcopy(r1), at=tick+4, prepared_at=p2["at"],
              review_source_ref="model://b/w3-renewed-delegated-review")
    commit["at"] = tick+5
    assert r1["at"] < tick and commit["at"] < event(late, "start", "w3")["at"]
    late["events"].extend([
        {"at": tick, "action": "source_update", "actor": "b", "source": MANDATE,
         "status": "CONFIRMED", "expected_revision": "mandate-v1", "new_revision": rev},
        failed, g2, p2, r2,
    ])
    reindex(late)
    money = late["economic_claims"]
    life = money["lifecycle_costs"]
    # Keep execution and recipient acceptance at the ORIGINAL times. Only
    # original commit-conditioned cash windows are moved to the common new
    # commitment; independent acceptance-conditioned settlement stays fixed.
    commit_transfers = {row["transfer_id"] for row in money["work_payment_conditions"]
                        if row["condition"] == "ON_ORIGINAL_COMMIT"
                        and row["transfer_id"] in {t["id"] for t in money["transfers"] if t["work"] == "w3"}}
    for row in money["cash_timing"]["transfer_windows"]:
        if row["transfer_id"] in commit_transfers:
            old_at = row["at"]
            row["at"] += 5
            row["late_at"] = row["at"] if row["late_at"] == old_at else max(row["at"], row["late_at"])
    # No settlement claim is attached to these commit transfers in this fixture.
    assert not any(row["transfer_id"] in commit_transfers
                   for row in money["work_payment_settlement_claims"])
    for row in life["event_bindings"]:
        if row["work"] == "w3" and row["action"] == "commit":
            row["at"] = commit["at"]

    rid = "w3-renewed-delegated-preparation"
    old_id = "cooperation-coordination"
    cost = next(row for row in money["resource_uses"] if row["id"] == old_id)
    money["resource_uses"].append(dict(deepcopy(cost), id=rid))
    binding = next(row for row in life["bindings"] if row["resource_use_id"] == old_id)
    life["bindings"].append(dict(deepcopy(binding), resource_use_id=rid))
    proof = "model://op/w3-renewed-delegated-cost-proof"
    anchor = next(row for row in life["event_bindings"] if row["resource_use_id"] == old_id)
    life["event_bindings"].append(dict(deepcopy(anchor), resource_use_id=rid, at=p2["at"],
                                        cost_evidence_ref=proof))
    old_source = next(row for row in late["context_evidence"]["sources"]
                      if row["id"] == anchor["cost_evidence_ref"])
    late["context_evidence"]["sources"].append(dict(deepcopy(old_source), id=proof))
    rate = next(row for row in life["preparation_activity_bindings"] if row["resource_use_id"] == old_id)
    life["preparation_activity_bindings"].append(dict(deepcopy(rate), resource_use_id=rid))
    append_mandate_cost(late, g1, "w3-first-mandate-cost", first_cost)
    append_mandate_cost(late, g2, "w3-renewed-mandate-cost", renewed_cost)
    reindex(late)

    fresh = deepcopy(late)
    omit = {g1["at"], p1["at"], r1["at"], failed["at"]}
    fresh["events"] = [row for row in fresh["events"] if row["at"] not in omit]
    drop_cost(fresh, old_id)
    drop_cost(fresh, "w3-first-mandate-cost")
    reindex(fresh)
    arms = {"FRESH": fresh, "RECOVERED": late}
    if not patterns:
        direct = deepcopy(fresh)
        direct["events"] = [row for row in direct["events"] if row["action"] != "function_delegate"]
        prep = event(direct, "function_prepare", "w3")
        prep.pop("delegation_at")
        prep["preparation_mode"] = "S1"
        next(fn for fn in direct["general_akis"]["agent_functions"]
             if fn["work"] == "w3" and fn["id"] == prep["function_id"]).pop("requires_original_delegation")
        drop_cost(direct, "w3-renewed-mandate-cost")
        next(row for row in direct["economic_claims"]["resource_uses"]
             if row["id"] == rid)["amount"] = "83.00"
        reindex(direct)
        arms["S1_DIRECT"] = direct
    return arms


def delegation_scope(out):
    return out["general_akis_model"]["agent_function_formation_model_gate"]["original_delegation_scope"]


def attempt_costs(out):
    return out["economics"]["original_delegation_attempt_costs"]["local_research_only"]["by_original_work"]["w3"]


def original_applied(out, action):
    return [row for row in out["trace"] if row.get("work") == "w3"
            and row["action"] == action and row["outcome"] == "APPLIED"]


def observe_renewal(**kwargs):
    docs = renewal_routes(**kwargs)
    frozen = deepcopy(docs)
    outcomes = {arm: simulate(doc) for arm, doc in docs.items()}
    assert docs == frozen
    fresh, late = outcomes["FRESH"], outcomes["RECOVERED"]
    assert fresh["counts"]["blocked"] == 0
    assert late["counts"]["blocked"] == 1, [
        (row["at"], row["action"], row["reason"]) for row in late["trace"] if row["outcome"] == "BLOCKED"]
    expected = "FORMATION_AGENT_DELEGATION_SOURCE_CHANGED_AFTER_GRANT" if kwargs.get("same_revision") else "FORMATION_AGENT_DELEGATION_SOURCE_CONTEXT_REVISION_STALE"
    assert [(row["action"], row["reason"]) for row in late["trace"] if row["outcome"] == "BLOCKED"] == [
        ("commit", expected)]
    for out in outcomes.values():
        assert out["works"] == fresh["works"] and out["capacity"] == fresh["capacity"]
        assert all(out["works"][w]["result"] == ACCEPTED for w in ("w1", "w2", "w3"))
        for action in ("commit", "start", "complete", "assess_result_quality", "accept", "authorize", "consent"):
            assert original_applied(out, action) == original_applied(fresh, action)
        assert out["economics"]["cash_timing"] == fresh["economics"]["cash_timing"]
        assert out["economics"]["profit"] == "UNKNOWN"
        payment = deepcopy(out["economics"]["work_payment_causality"])
        reference = deepcopy(fresh["economics"]["work_payment_causality"])
        for a,b in zip(payment["bindings"], reference["bindings"], strict=True):
            ca = a.pop("same_original_work_noncash_resource_use_count")
            cb = b.pop("same_original_work_noncash_resource_use_count")
            # Late has exactly one additional grant AND one additional packet.
            # Direct has no mandate cost row. All other payment evidence is equal.
            delta = 2 if out is late else -1 if out is outcomes.get("S1_DIRECT") else 0
            assert ca-cb == delta*int(a["original_work"]=="w3")
        assert payment == reference
    for out, n in ((fresh,1),(late,2)):
        v = delegation_scope(out)
        assert v["historical_original_chain_identified"]
        assert v["applied_mandate_count"] == v["applied_delegated_preparation_count"] == n
        assert v["committed_effective_preparation_count"] == v["accepted_effective_preparation_count"] == 1
        assert v["other_applied_mandate_count"] == v["other_applied_preparation_count"] == n-1
        assert v["original_works_with_accepted_delegated_preparation"] == 1
        assert len(original_applied(out, "function_review")) == n
        assert attempt_costs(out)["status"] == "MODEL_ORIGINAL_DELEGATION_ATTEMPT_COSTS_RECONCILED"
    return outcomes


@pytest.mark.parametrize("first,renewed,fresh,late", [
    ("0.00","0.00","51.00","102.00"),
    ("12.00","12.00","63.00","126.00"),
    ("12.00","32.00","83.00","146.00"),
    ("12.00","48.00","99.00","162.00"),
])
def test_same_result_recovery_costs_count_both_independent_participants(first,renewed,fresh,late):
    out = observe_renewal(first_cost=first, renewed_cost=renewed)
    a,b = (attempt_costs(out[arm]) for arm in ("FRESH","RECOVERED"))
    assert a["all_combined_cost"] == fresh
    assert b["all_combined_cost"] == late
    assert b["all_customer_mandate_cost"] == f"{Decimal(first)+Decimal(renewed):.2f}"
    assert b["all_delegate_preparation_cost"] == "102.00"
    assert b["accepted_effective_combined_cost"] == fresh
    assert b["other_combined_cost"] == f"{Decimal(first)+Decimal('51.00'):.2f}"
    assert Decimal(b["all_combined_cost"]) == Decimal(b["committed_effective_combined_cost"])+Decimal(b["other_combined_cost"])
    direct = out["S1_DIRECT"]["economics"]["lifecycle_resource_costs"]["original_preparation_activity_costs"]["items"]
    assert next(r for r in direct if r["work"]=="w3")["declared_resource_cost"] == "83.00"
    assert out["RECOVERED"] == simulate(renewal_routes(first_cost=first,renewed_cost=renewed)["RECOVERED"])


def test_same_revision_update_still_requires_original_renewal():
    out = observe_renewal(same_revision=True)
    assert attempt_costs(out["RECOVERED"])["other_combined_cost"] == "63.00"


def test_mandate_recovery_keeps_structural_experience_but_not_stale_authorization():
    out = observe_renewal(patterns=True)
    for arm,n in (("FRESH",3),("RECOVERED",4)):
        v = structural_view(out[arm])
        assert v["applied_preparation_count"] == n
        assert v["accepted_effective_preparation_count"] == 3
        assert v["distinct_accepted_pattern_versions"] == 1
        assert v["accepted_effective_reuse_count"] == 2
        assert v["accepted_versions_with_current_source_and_oc"] == 1
    assert attempt_costs(out["FRESH"])["all_combined_cost"] == "71.00"
    assert attempt_costs(out["RECOVERED"])["all_combined_cost"] == "142.00"
    assert out["RECOVERED"]["economics"]["original_pattern_reproduction_costs"]["other_applied_preparation_cost"] == "59.00"


def test_live_recovery_observation_distinguishes_preparation_commit_and_acceptance():
    doc = renewal_routes()["RECOVERED"]
    out = simulate(doc)
    points = [(int(row["at"]), row["projection"]["agent_function_formation_model_gate"].get("original_delegation_scope"))
              for row in out["general_akis_model"]["read_only_evolution"]]
    points = dict((at,v) for at,v in points if v is not None)
    commits = [row for row in out["trace"] if row["action"]=="commit" and row["work"]=="w3"]
    g1,g2 = original_applied(out,"function_delegate")
    p1,p2 = original_applied(out,"function_prepare")
    assert points[g1["at"]]["mandates_without_applied_preparation"] == 1
    assert points[p1["at"]]["applied_delegated_preparation_count"] == 1
    assert points[g2["at"]]["applied_mandate_count"] == 2
    assert points[g2["at"]]["committed_effective_preparation_count"] == 0
    assert points[p2["at"]]["applied_delegated_preparation_count"] == 2
    assert points[commits[1]["at"]]["committed_not_accepted_preparation_count"] == 1
    assert points[commits[1]["at"]]["accepted_effective_preparation_count"] == 0
    assert points[event(doc,"accept","w3")["at"]]["accepted_effective_preparation_count"] == 1
    assert all("local_research_only" not in v for v in points.values())


def test_unrecorded_attempt_cost_is_unknown_not_zero():
    doc = renewal_routes()["RECOVERED"]
    drop_cost(doc, "w3-first-mandate-cost")
    out = simulate(doc)
    view = attempt_costs(out)
    assert view["uniquely_anchored_mandate_cost_count"] == 1
    assert view["applied_mandate_count"] == 2
    assert view["all_combined_cost"] is None
    assert view["other_customer_mandate_cost"] is None
    assert delegation_scope(out)["accepted_effective_preparation_count"] == 1


def test_two_cost_rows_for_one_mandate_do_not_prove_complete_cost():
    doc = renewal_routes()["RECOVERED"]
    append_mandate_cost(doc, grant(doc), "w3-first-mandate-additional-cost", "1.00")
    reindex(doc)
    out = simulate(doc)
    assert attempt_costs(out)["all_combined_cost"] is None
    assert attempt_costs(out)["uniquely_anchored_mandate_cost_count"] == 1


def test_repeated_cost_evidence_for_two_mandates_is_rejected():
    doc = renewal_routes()["RECOVERED"]
    anchors = doc["economic_claims"]["lifecycle_costs"]["event_bindings"]
    a,b = [r for r in anchors if r["action"]=="function_delegate"]
    b["cost_evidence_ref"] = a["cost_evidence_ref"]
    with pytest.raises(InputError, match="LIFECYCLE_TIMED_COST_EVIDENCE_NOT_UNIQUE"):
        simulate(doc)


def test_no_new_original_review_no_recovered_commit():
    doc = without_costs(renewal_routes()["RECOVERED"])
    reviews = [r for r in doc["events"] if r["action"]=="function_review" and r["work"]=="w3"]
    doc["events"].remove(reviews[-1])
    out = simulate(doc)
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert delegation_scope(out)["committed_effective_preparation_count"] == 0
    assert delegation_scope(out)["applied_delegated_preparation_count"] == 2
    assert all(out["works"][w]["result"]==ACCEPTED for w in ("w1","w2"))
