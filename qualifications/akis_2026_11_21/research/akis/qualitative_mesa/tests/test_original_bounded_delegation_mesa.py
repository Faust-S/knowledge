"""Bounded S2 delegation in the original Work, KPB, OC and cost trace."""
from copy import deepcopy
import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.rules import InputError
from .test_original_preparation_pattern_revision_mesa import (
    preparation_pattern_routes, without_costs, event, trace_event, ACCEPTED,
)

MANDATE = "model://b/w3-preparation-mandate"
PURPOSE = "AKIS_DELEGATED_PREPARATION"


def delegated_route(*, costs=False):
    doc = preparation_pattern_routes()["REUSE"]
    if not costs:
        without_costs(doc)
    prepare = event(doc, "function_prepare", "w3")
    review = event(doc, "function_review", "w3")
    tick = prepare["at"]
    shift = 4
    fn = next(row for row in doc["general_akis"]["agent_functions"]
              if row["id"] == prepare["function_id"] and row["work"] == "w3")
    fn["requires_original_delegation"] = True
    doc["context_evidence"]["sources"].append({
        "id": MANDATE, "owner": "b", "revision": "mandate-v1",
        "status": "CONFIRMED", "usable_by": ["b", fn["owner"]],
        "core": "corporate", "purposes": [PURPOSE], "operations": ["DERIVE"],
        "valid_from": 0, "valid_until": doc["model_horizon"],
    })
    for row in doc["events"]:
        if row["at"] >= tick:
            assert row.get("work") == "w3"
            row["at"] += shift
    review["prepared_at"] += shift
    prepare["delegation_at"] = tick
    doc["events"].append({
        "at": tick, "action": "function_delegate", "actor": "b", "work": "w3",
        "org_revision": "oc-1", "work_source_revision": "d-3",
        "function_id": fn["id"], "function_source_ref": fn["source_ref"],
        "delegation_source_ref": MANDATE, "delegation_source_revision": "mandate-v1",
    })
    doc["events"].sort(key=lambda row: row["at"])
    if costs:
        money = doc["economic_claims"]
        transfers = {row["id"] for row in money["transfers"] if row["work"] == "w3"}
        for row in money["cash_timing"]["transfer_windows"]:
            if row["transfer_id"] in transfers:
                old_at = row["at"]
                row["at"] += shift
                row["late_at"] = (row["at"] if row["late_at"] == old_at
                                  else max(row["at"], row["late_at"]))
        for row in money["work_payment_settlement_claims"]:
            if row["transfer_id"] in transfers:
                row["at"] += shift
                for owner in row["owner_attestations"].values():
                    owner["reported_at"] += shift
        life = money["lifecycle_costs"]
        positions = {row["at"]: i for i, row in enumerate(doc["events"])}
        for row in life["event_bindings"]:
            if row["work"] == "w3" and row["at"] >= tick:
                row["at"] += shift
            row["trace_position"] = positions[row["at"]]
    return doc


def mandate_source(doc):
    return next(row for row in doc["context_evidence"]["sources"] if row["id"] == MANDATE)


def grant(doc):
    return event(doc, "function_delegate", "w3")


def check_blocked(doc, action, reason):
    out = simulate(doc)
    target = trace_event(out, action, "w3")
    assert target["outcome"] == "BLOCKED"
    assert target["reason"] == reason
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert all(out["works"][w]["result"] == ACCEPTED for w in ("w1", "w2"))
    return out


def test_delegated_original_preparation_keeps_human_review_and_original_work():
    doc = delegated_route(costs=True)
    frozen = deepcopy(doc)
    out = simulate(doc)
    assert doc == frozen
    assert out["counts"]["blocked"] == 0
    assert all(out["works"][w]["result"] == ACCEPTED for w in ("w1", "w2", "w3"))
    applied_grant = trace_event(out, "function_delegate", "w3")
    prepared = trace_event(out, "function_prepare", "w3")
    witness = prepared["model_original_delegated_preparation"]
    assert applied_grant["actor"] == "b"
    assert applied_grant["model_original_preparation_mandate"]["delegate"] == "op"
    assert applied_grant["delegation_is_not_work_consent"]
    assert witness["delegation_at"] == applied_grant["at"]
    assert len(witness["packet_fingerprint"]) == 64
    assert witness["original_program_computation_qualified"]
    assert not witness["external_action_executed"]
    assert trace_event(out, "function_review", "w3")["human_decision"] == "APPROVE"
    gate = out["general_akis_model"]["agent_function_formation_model_gate"]
    assert gate["original_delegation_grants"] == 1
    assert gate["original_delegated_preparations"] == 1
    assert gate["delegation_is_not_business_execution_or_consent"]
    assert out["economics"]["profit"] == "UNKNOWN"
    assert out == simulate(deepcopy(doc))


@pytest.mark.parametrize("field,value,reason", [
    ("actor", "op", "FORMATION_AGENT_DELEGATION_ORIGINAL_CUSTOMER_REQUIRED"),
    ("work_source_revision", "wrong", "FORMATION_AGENT_DELEGATION_ORIGINAL_SCOPE_MISMATCH"),
    ("function_source_ref", "wrong", "FORMATION_AGENT_DELEGATION_ORIGINAL_SCOPE_MISMATCH"),
    ("delegation_source_revision", "wrong", "FORMATION_AGENT_DELEGATION_SOURCE_CONTEXT_REVISION_STALE"),
    ("delegation_source_ref", "model://op/structural-preparation-pattern",
     "FORMATION_AGENT_DELEGATION_SOURCE_AUTHOR_ROLE_ORIGINAL_SOURCE_OWNER_REQUIRED"),
])
def test_mandate_must_be_customer_owned_and_bound_to_original_function(field,value,reason):
    doc = delegated_route()
    grant(doc)[field] = value
    check_blocked(doc, "function_delegate", reason)


@pytest.mark.parametrize("field,value,reason", [
    ("usable_by", ["b"], "FORMATION_AGENT_DELEGATION_SOURCE_CONTEXT_USE_NOT_PERMITTED"),
    ("operations", ["EXECUTE"], "FORMATION_AGENT_DELEGATION_SOURCE_CONTEXT_OPERATION_NOT_PERMITTED"),
    ("purposes", ["another-purpose"], "FORMATION_AGENT_DELEGATION_SOURCE_CONTEXT_PURPOSE_NOT_PERMITTED"),
    ("core", "operator", "FORMATION_AGENT_DELEGATION_SOURCE_CONTEXT_CORE_MISMATCH"),
])
def test_context_scope_does_not_turn_a_source_into_any_other_grant(field,value,reason):
    doc = delegated_route()
    mandate_source(doc)[field] = value
    check_blocked(doc, "function_delegate", reason)


def test_preparation_without_original_grant_cannot_use_declared_function():
    doc = delegated_route()
    doc["events"].remove(grant(doc))
    check_blocked(doc, "function_prepare", "FORMATION_AGENT_ORIGINAL_DELEGATION_NOT_CURRENT")


def test_other_preparation_modes_do_not_claim_delegated_agent_execution():
    doc = delegated_route()
    event(doc, "function_prepare", "w3")["preparation_mode"] = "S1"
    check_blocked(doc, "function_prepare", "FORMATION_AGENT_DELEGATED_PREPARATION_REQUIRES_S2")


@pytest.mark.parametrize("phase", ["function_prepare","function_review"])
def test_mandate_expiry_blocks_next_transition_without_rewriting_prior_results(phase):
    doc = delegated_route()
    mandate_source(doc)["valid_until"] = event(doc,phase,"w3")["at"]
    action = "function_review" if phase == "function_prepare" else "commit"
    check_blocked(doc, action, "FORMATION_AGENT_DELEGATION_SOURCE_CONTEXT_SOURCE_EXPIRED")


def test_mandate_alone_cannot_replace_independent_approval():
    doc = delegated_route()
    event(doc,"function_review","w3")["human_decision"] = "REJECT"
    out = simulate(doc)
    assert trace_event(out,"function_prepare","w3")["outcome"] == "APPLIED"
    assert trace_event(out,"function_review","w3")["outcome"] == "APPLIED"
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"


def test_same_revision_revocation_and_restoration_require_new_original_mandate():
    doc = delegated_route()
    t = grant(doc)["at"]
    for delta,status in ((1,"UNKNOWN"),(2,"CONFIRMED")):
        doc["events"].append({
            "at": t+delta, "action": "source_update", "actor": "b",
            "source": MANDATE, "expected_revision": "mandate-v1",
            "new_revision": "mandate-v1", "status": status,
        })
    doc["events"].sort(key=lambda row:row["at"])
    check_blocked(doc,"function_prepare","FORMATION_AGENT_DELEGATION_SOURCE_CHANGED_AFTER_GRANT")


def test_mandate_single_use_and_new_grant_supersedes_old_packet():
    doc = delegated_route()
    p = event(doc,"function_prepare","w3")
    t = grant(doc)["at"]
    # Same original preparation, one additional attempted reuse.
    p["at"] = t+1
    event(doc,"function_review","w3")["prepared_at"] = t+1
    doc["events"].append(dict(deepcopy(p),at=t+2))
    doc["events"].sort(key=lambda row:row["at"])
    out = simulate(doc)
    attempts = [row for row in out["trace"] if row["action"] == "function_prepare"
                and row["work"] == "w3"]
    assert [row["outcome"] for row in attempts] == ["APPLIED","BLOCKED"]
    assert attempts[1]["reason"] == "FORMATION_AGENT_DELEGATION_ALREADY_USED"
    assert out["works"]["w3"]["result"] == ACCEPTED
    # A new mandate before review means the old computation is no longer current.
    doc["events"] = [row for row in doc["events"]
                     if not (row["action"] == "function_prepare" and row["at"] == t+2)]
    doc["events"].append(dict(deepcopy(grant(doc)),at=t+2))
    doc["events"].sort(key=lambda row:row["at"])
    check_blocked(doc,"function_review","FORMATION_AGENT_ORIGINAL_DELEGATION_NOT_CURRENT")


def test_expiry_after_original_commit_is_not_retroactive():
    doc = delegated_route()
    mandate_source(doc)["valid_until"] = event(doc,"commit","w3")["at"]
    out = simulate(doc)
    assert out["counts"]["blocked"] == 0
    assert out["works"]["w3"]["result"] == ACCEPTED


def test_delegation_cannot_be_attached_to_unrelated_work_event():
    doc = delegated_route()
    event(doc,"commit","w3")["delegation_at"] = grant(doc)["at"]
    with pytest.raises(InputError,match="DELEGATION_FIELDS_REQUIRE_ORIGINAL_FUNCTION_ACTION"):
        simulate(doc)
