"""R1-T3: prospective ORIGINAL Work operation reassignment in one native Mesa.

Accepted predecessor W2 -> approved L1 and function OC edition -> independent
two-owner operation/quality route -> fresh W3 principal consents -> original
operation execution -> owner handoff -> recipient quality -> accepted Result.

This is an actual original Work/DAG, not a second process or Result engine.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.technology import technology_route_fingerprint
from .test_r1t2_original_function_responsibility_mesa import r1t2_case
from .test_r1q_original_coalition_membership_mesa import reports


def original_technology_route_case(*, absent=None, objecting=None):
    d = r1t2_case()
    d["handoff_strict"] = True
    for r in d["resources"]:
        r["site"] = "site-" + r["owner"]
    request = next(
        row for row in d["events"]
        if row["action"] == "request" and row["work_spec"]["id"] == "w3"
    )
    plan = request["work_spec"]
    assert plan["resource"] == "ra"
    plan["operations"] = [
        {
            "id": "stage-a", "primary_resource": "ra",
            "requires_completed": [],
            "resource_requirements": [{"resource": "ra", "units": 2}],
            "slot_start": 106, "slot_end": 112,
        },
        {
            "id": "stage-c", "primary_resource": "rc",
            "requires_completed": ["stage-a"],
            "resource_requirements": [{"resource": "rc", "units": 1}],
            "slot_start": 113, "slot_end": 120,
        },
    ]
    plan["assurance_criteria"] = [
        {
            "id": "q-stage-a", "dimension": "PROCESS_SAFETY",
            "operation": "stage-a", "responsible_owner": "a",
            "assessor": "b", "method": "INSPECTION",
            "source_ref": "model://b/quality-stage-a",
            "source_revision": "d-3",
        },
        {
            "id": "q-stage-c", "dimension": "DELIVERABLE_CONFORMITY",
            "operation": "stage-c", "responsible_owner": "c",
            "assessor": "b", "method": "FUNCTIONAL_TEST",
            "source_ref": "model://b/quality-stage-c",
            "source_revision": "d-3",
        },
    ]
    digest = technology_route_fingerprint(plan)
    request_at = request["at"]
    assert request_at > 92
    # Reserve four consultation positions BEFORE the still-uncreated W3.
    for row in d["events"]:
        if row["at"] >= request_at:
            row["at"] += 5
        if (row.get("action") == "function_review"
                and row.get("prepared_at", -1) >= request_at):
            row["prepared_at"] += 5
    request["org_revision"] = "oc-1"
    request["technology_route_id"] = "r1t3-route-w3"
    request["technology_route_fingerprint"] = digest
    proposal = {
        "at": request_at, "action": "technology_route_propose",
        "actor": "b", "org_revision": "oc-1",
        "technology_route_id": "r1t3-route-w3",
        "technology_route_work": "w3",
        "technology_route_work_spec": deepcopy(plan),
        "technology_route_fingerprint": digest,
        "technology_route_source_ref": "model://b/r1t3-future-operation-plan",
        "technology_route_valid_until": 190,
        "technology_route_model_code_change_id": "r1t2-func-1",
        "cooperation_link": "l2", "cooperation_source_revision": "rel-2",
        "pilot_work": "w2", "pilot_result_ref": "model://w2-result",
    }
    d["events"].append(proposal)
    for i, owner in enumerate(("a", "c", "b"), start=1):
        if absent == owner:
            continue
        d["events"].append({
            "at": request_at + i, "action": "technology_route_response",
            "actor": owner, "org_revision": "oc-1",
            "technology_route_id": "r1t3-route-w3",
            "technology_route_fingerprint": digest,
            "technology_route_decision": (
                "OBJECT_ORIGINAL_TECHNOLOGY" if objecting == owner
                else "SUPPORT_ORIGINAL_TECHNOLOGY"
            ),
            "technology_route_decision_source_ref":
                f"model://{owner}/r1t3-own-operation-plan-approval",
        })
    # Actual ORIGINAL technological execution of the new W3, replacing
    # legacy whole-Work start/complete with two independent owner stages.
    start = next(row for row in d["events"]
                 if row["action"] == "start" and row.get("work") == "w3")
    original_start = start["at"]
    old_complete = next(row for row in d["events"]
                        if row["action"] == "complete" and row.get("work") == "w3")
    old_accept = next(row for row in d["events"]
                      if row["action"] == "accept" and row.get("work") == "w3")
    result_ref = old_complete["result_ref"]
    d["events"] = [
        row for row in d["events"]
        if row not in (start, old_complete, old_accept)
    ]
    for row in d["events"]:
        if row["at"] >= original_start:
            row["at"] += 11
        if (row.get("action") == "function_review"
                and row.get("prepared_at", -1) >= original_start):
            row["prepared_at"] += 11
    additions = [
        {
            "at": original_start, "action": "start_operation",
            "actor": "a", "work": "w3", "operation": "stage-a",
        },
        {
            "at": original_start + 1, "action": "complete_operation",
            "actor": "a", "work": "w3", "operation": "stage-a",
            "result_ref": "model://a/r1t3-stage-a-result",
        },
        {
            "at": original_start + 2, "action": "handoff_dispatch",
            "actor": "a", "work": "w3",
            "from_operation": "stage-a", "to_operation": "stage-c",
            "source_revision": "d-3", "org_revision": "oc-1",
            "result_ref": "model://a/r1t3-handoff-dispatch",
        },
        {
            "at": original_start + 3, "action": "handoff_receive",
            "actor": "c", "work": "w3",
            "from_operation": "stage-a", "to_operation": "stage-c",
            "source_revision": "d-3", "org_revision": "oc-1",
            "dispatch_ref": "model://a/r1t3-handoff-dispatch",
            "result_ref": "model://c/r1t3-handoff-receipt",
        },
        {
            "at": original_start + 4, "action": "start_operation",
            "actor": "c", "work": "w3", "operation": "stage-c",
        },
        {
            "at": original_start + 5, "action": "complete_operation",
            "actor": "c", "work": "w3", "operation": "stage-c",
            "result_ref": "model://c/r1t3-stage-c-result",
        },
        {
            "at": original_start + 6, "action": "complete",
            "actor": "a", "work": "w3", "result_ref": result_ref,
        },
        *[
            {
                "at": original_start + 7 + i,
                "action": "assess_result_quality",
                "actor": "b", "work": "w3", "source_revision": "d-3",
                "org_revision": "oc-1", "result_ref": result_ref,
                "criterion": criterion,
                "quality_verdict": "MEETS_DECLARED_REQUIREMENT",
                "quality_evidence_ref":
                    f"model://b/r1t3-independent-quality-{i}",
            }
            for i, criterion in enumerate(("q-stage-a", "q-stage-c"))
        ],
        {
            "at": original_start + 9, "action": "accept",
            "actor": "b", "work": "w3",
        },
    ]
    d["events"].extend(additions)
    d["events"].sort(key=lambda row: row["at"])
    d["model_horizon"] = max(d["model_horizon"] + 18, d["events"][-1]["at"] + 2)
    return d


def last_request(out):
    return [r for r in reports(out, "request")
            if r["work"] == "w3"][0]


def test_r1t3_full_original_cross_owner_work_operations_handoff_quality_accepted_result():
    d = original_technology_route_case()
    expected = deepcopy(d)
    out = simulate(d)
    assert d == expected
    assert out["counts"]["blocked"] == 0, [
        (x["at"], x["action"], x["reason"])
        for x in out["trace"] if x["outcome"] == "BLOCKED"
    ]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert last_request(out)["technology_route_original_source_qualified"] is True
    assert last_request(out)["technology_route_original_work_consent_still_required"]
    assert [r["actor"] for r in reports(out, "technology_route_response")] == [
        "a", "c", "b"
    ]
    assert set(out["works"]["w3"]["consenting_principals"]) == {"a", "b", "c"}
    tech = out["works"]["w3"]["technology"]
    assert [row["declared_performer_owner"] for row in tech["operations"]] == [
        "a", "c"
    ]
    assert [row["execution"] for row in tech["operations"]] == [
        "COMPLETED", "COMPLETED"
    ]
    assert len(tech["handoffs"]["required_edges"]) == 1
    assert tech["handoffs"]["required_edges"][0]["state"] == "RECEIVED"
    assert out["works"]["w3"]["assurance"]["model_reported_met_count"] == 2
    assert out["works"]["w3"]["assurance"]["current_result_quality_gate"] == "NONE"
    assert out["resources"]["ra"]["owner"] == "a"
    assert out["resources"]["rc"]["owner"] == "c"
    general = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert general[
        "accepted_original_cross_owner_technology_routes_with_handoff_and_quality"
    ] == 1
    assert general["route_consultation_not_equivalent_to_original_Work_obligation"]
    assert general["all_nine_component_original_causal_closure_proven"] is False
    private = out["general_akis_private_cycle_evidence"][
        "original_cross_owner_technology_route_successions"
    ]
    assert len(private) == 1
    assert private[0]["previous_original_accepted_result"] == "w2"
    assert private[0]["accepted_future_original_work"] == "w3"
    assert private[0]["original_operation_performer_owners"] == ["a", "c"]
    assert private[0]["independent_original_recipient_quality_checks"] == 2
    assert private[0]["original_cross_owner_handoffs_received"] == 1
    assert private[0]["real_production_quality_or_economic_gain_verified"] is False
    assert out["works"]["w1"]["consenting_principals"] == ["a", "b"]
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert simulate(deepcopy(d)) == out


@pytest.mark.parametrize("party", ["a", "b", "c"])
def test_r1t3_no_new_original_work_without_each_independent_route_response(party):
    out = simulate(original_technology_route_case(absent=party))
    assert last_request(out)["reason"] == (
        "ORIGINAL_TECHNOLOGY_ROUTE_ALL_PRINCIPALS_RESPONSE_REQUIRED"
    )
    assert "w3" not in out["works"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("party", ["a", "b", "c"])
def test_r1t3_any_original_principal_can_refuse_a_future_route(party):
    out = simulate(original_technology_route_case(objecting=party))
    assert last_request(out)["reason"] == (
        "ORIGINAL_TECHNOLOGY_ROUTE_ORIGINAL_PRINCIPAL_OBJECTED"
    )
    assert "w3" not in out["works"]


def test_r1t3_request_with_different_valid_plan_cannot_reuse_route_consents():
    d = original_technology_route_case()
    request = next(x for x in d["events"] if x["action"] == "request"
                   and x["work_spec"]["id"] == "w3")
    request["work_spec"]["operations"][0]["slot_end"] = 111
    out = simulate(d)
    assert last_request(out)["reason"] == (
        "ORIGINAL_TECHNOLOGY_ROUTE_ORIGINAL_WORK_BINDING_STALE"
    )
    assert "w3" not in out["works"]


def test_r1t3_route_not_qualified_without_applied_model_function_change():
    d = original_technology_route_case()
    d["events"] = [
        row for row in d["events"]
        if not (row["action"] == "model_code_apply"
                and row.get("new_model_edition") == "model-oc-3")
    ]
    out = simulate(d)
    assert reports(out, "technology_route_propose")[0]["reason"] == (
        "ORIGINAL_TECHNOLOGY_ROUTE_FUNCTION_REVISION_REQUIRED"
    )
    assert "w3" not in out["works"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t3_wrong_owner_cannot_execute_foreign_operation():
    d = original_technology_route_case()
    stage = next(x for x in d["events"] if x["action"] == "start_operation"
                 and x["operation"] == "stage-c")
    stage["actor"] = "a"
    out = simulate(d)
    assert [r for r in reports(out, "start_operation")
            if r["operation"] == "stage-c"][0]["reason"] == (
        "ORIGINAL_OPERATION_PERFORMER_REQUIRED"
    )
    assert out["works"]["w3"]["result"] != "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t3_missing_original_cross_owner_handoff_receipt_blocks_next_stage():
    d = original_technology_route_case()
    d["events"] = [r for r in d["events"]
                   if r["action"] != "handoff_receive"]
    out = simulate(d)
    assert [r for r in reports(out, "start_operation")
            if r["operation"] == "stage-c"][0]["reason"] == (
        "HANDOFF_RECEIPT_NOT_DECLARED"
    )
    assert out["works"]["w3"]["result"] != "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t3_quality_recipient_must_assess_both_original_stage_owners():
    d = original_technology_route_case()
    d["events"] = [r for r in d["events"]
                   if not (r["action"] == "assess_result_quality"
                           and r["criterion"] == "q-stage-c")]
    out = simulate(d)
    assert reports(out, "accept")[-1]["reason"] == (
        "QUALITY_ORIGINAL_ASSESSMENT_MISSING"
    )
    assert out["works"]["w3"]["result"] == "SUBMITTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t3_route_approval_does_not_replace_independent_work_resource_consent():
    d = original_technology_route_case()
    d["events"] = [r for r in d["events"]
                   if not (r["action"] == "consent"
                           and r.get("work") == "w3"
                           and r["actor"] == "c")]
    out = simulate(d)
    assert [r for r in reports(out, "commit")
            if r["work"] == "w3"][0]["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t3_prospective_original_work_route_cannot_be_omitted_after_approval():
    d = original_technology_route_case()
    request = next(r for r in d["events"] if r["action"] == "request"
                   and r["work_spec"]["id"] == "w3")
    request.pop("technology_route_id")
    out = simulate(d)
    assert last_request(out)["reason"] == (
        "ORIGINAL_TECHNOLOGY_ROUTE_EXPLICIT_REQUEST_REFERENCE_REQUIRED"
    )
    assert "w3" not in out["works"]


def test_r1t3_route_proposal_cannot_create_a_work_or_rewrite_past_result():
    d = original_technology_route_case()
    request = next(r for r in d["events"] if r["action"] == "request"
                   and r["work_spec"]["id"] == "w3")
    # Retain the original Work reference for scoped KPB preflight. Make
    # the later request invalid rather than deleting the only declared
    # source of the still-referenced future Work from the whole input.
    request["actor"] = "a"
    out = simulate(d)
    assert reports(out, "technology_route_propose")[0]["outcome"] == "APPLIED"
    assert last_request(out)["reason"] == "ORIGINAL_CUSTOMER_REQUEST_REQUIRED"
    assert "w3" not in out["works"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_r1t3_foreign_enterprise_cannot_substitute_for_independent_owner_route_review():
    d = original_technology_route_case()
    vote = next(r for r in d["events"]
                if r["action"] == "technology_route_response"
                and r["actor"] == "c")
    vote["technology_route_decision_source_ref"] = "model://op/foreign-c-approval"
    out = simulate(d)
    assert next(r for r in reports(out, "technology_route_response")
                if r["actor"] == "c")["reason"] == (
        "ORIGINAL_TECHNOLOGY_ROUTE_OWN_SOURCE_REQUIRED"
    )
    assert last_request(out)["reason"] == (
        "ORIGINAL_TECHNOLOGY_ROUTE_ALL_PRINCIPALS_RESPONSE_REQUIRED"
    )
    assert "w3" not in out["works"]


def test_r1t3_model_route_does_not_require_or_authorize_new_cash_profit():
    out = simulate(original_technology_route_case())
    assert out["profit"] == {
        "operator": "UNKNOWN", "participants": "UNKNOWN",
        "system_increment": "UNKNOWN"
    }
    shared = out["general_akis_model"]["system_causal_cycle_feedback"]
    assert shared["verified_actual_productivity_or_transaction_savings"] is False


def test_r1t3_quality_failure_cannot_be_accepted_despite_completed_operations():
    d = original_technology_route_case()
    review = next(r for r in d["events"]
                  if r["action"] == "assess_result_quality"
                  and r["criterion"] == "q-stage-c")
    review["quality_verdict"] = "DOES_NOT_MEET"
    out = simulate(d)
    assert [r for r in reports(out, "accept")
            if r["work"] == "w3"][0]["reason"] == (
        "QUALITY_DECLARED_CRITERION_FAILED"
    )
    assert out["works"]["w3"]["result"] == "SUBMITTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "accepted_original_cross_owner_technology_routes_with_handoff_and_quality"
    ] == 0


def test_r1t3_no_accepted_work_is_counted_when_final_recipient_inspection_missing():
    d = original_technology_route_case()
    d["events"] = [r for r in d["events"]
                   if not (r["action"] == "assess_result_quality"
                           and r["criterion"] == "q-stage-c")]
    out = simulate(d)
    assert out["general_akis_model"]["system_causal_cycle_feedback"][
        "accepted_original_cross_owner_technology_routes_with_handoff_and_quality"
    ] == 0


def test_r1t3_same_source_route_cannot_be_proposed_twice():
    d = original_technology_route_case()
    proposal = next(r for r in d["events"]
                    if r["action"] == "technology_route_propose")
    duplicate = deepcopy(proposal)
    duplicate["at"] = proposal["at"] + 4
    d["events"].append(duplicate)
    d["events"].sort(key=lambda r: r["at"])
    out = simulate(d)
    assert [r["outcome"] for r in reports(out, "technology_route_propose")] == [
        "APPLIED", "BLOCKED"
    ]
    assert reports(out, "technology_route_propose")[-1]["reason"] == (
        "ORIGINAL_TECHNOLOGY_ROUTE_PROPOSAL_EXISTS"
    )
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
