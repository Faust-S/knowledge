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


def original_technology_route_case(*, absent=None, objecting=None,
                                   competing=False, buyer_finishes=False):
    assert not buyer_finishes or competing
    d = r1t2_case()
    finisher = "b" if buyer_finishes else "c"
    finish_resource = "rb-finishing" if buyer_finishes else "rc"
    suffix = ("-own-finish" if buyer_finishes else "-supplier-finish") if competing else ""
    route_id = "r1t3-route-w3" + suffix
    if competing:
        from research.akis.qualitative_mesa.org_code_policy import original_model_code_fingerprint

        # The SAME independently approved prospective OC permits either
        # assignment. It never transfers ownership or replaces consent.
        proposal = next(e for e in d["events"] if e["action"] == "model_code_propose"
                        and e.get("model_code_change_id") == "r1t2-func-1")
        apply = next(e for e in d["events"] if e["action"] == "model_code_apply"
                     and e.get("model_code_change_id") == "r1t2-func-1")
        roles = ["CUSTOMER", "ENTERPRISE", "RESOURCE_OWNER"]
        proposal["proposed_model_roles"] = roles
        proposal["proposed_model_commit_responsible"] = ["b"]
        controls = {r["field"]: r["control"] for r in apply["model_code_records"]}
        next(r for r in controls["Рол"]["role_bindings"] if r["subject"] == "b")["items"] = roles
        next(r for r in controls["Отв"]["responsibilities"]
             if r["action"] == "commit")["original_principals"] = ["b"]
        fingerprint = original_model_code_fingerprint(apply["model_code_records"])
        d["events"] = [e for e in d["events"] if not (
            e["action"] == "model_code_function_response" and e["actor"] == "c"
            and e.get("model_code_change_id") == "r1t2-func-1")]
        for e in d["events"]:
            if e.get("model_code_change_id") == "r1t2-func-1":
                e["model_code_fingerprint"] = fingerprint
        phases = d["general_akis"]["formation_phases"]
        if not any(r["phase"] == 3 and r["owner"] == "b" for r in phases):
            phase = deepcopy(next(r for r in phases if r["phase"] == 3 and r["owner"] == "c"))
            phase.update(owner="b", source_ref="model://b/formation-3")
            phases.append(phase)
        if buyer_finishes:
            d["events"] = [e for e in d["events"] if not (
                e.get("work") == "w3" and e["actor"] == "c"
                and e["action"] in {"interest_update", "consent"})]
            for e in d["events"]:
                if (e.get("work") == "w3" and e["actor"] == "c"
                        and e["action"] == "formation_confirm" and e["phase"] == 3):
                    e.update(actor="b", formation_source_ref="model://b/formation-3")
    d["handoff_strict"] = True
    for r in d["resources"]:
        r["site"] = "site-" + r["owner"]
    request = next(
        row for row in d["events"]
        if row["action"] == "request" and row["work_spec"]["id"] == "w3"
    )
    plan = request["work_spec"]
    assert plan["resource"] == "ra"
    if buyer_finishes:
        for requirement in plan["resource_requirements"]:
            if requirement["resource"] == "rc":
                requirement["resource"] = finish_resource
    plan["operations"] = [
        {
            "id": "stage-a", "primary_resource": "ra",
            "requires_completed": [],
            "resource_requirements": [{"resource": "ra", "units": 2}],
            "slot_start": 106, "slot_end": 112,
        },
        {
            "id": "stage-c", "primary_resource": finish_resource,
            "requires_completed": ["stage-a"],
            "resource_requirements": [{"resource": finish_resource, "units": 1}],
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
            "operation": "stage-c", "responsible_owner": finisher,
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
    request["technology_route_id"] = route_id
    request["technology_route_fingerprint"] = digest
    proposal = {
        "at": request_at, "action": "technology_route_propose",
        "actor": "b", "org_revision": "oc-1",
        "technology_route_id": route_id,
        "technology_route_work": "w3",
        "technology_route_work_spec": deepcopy(plan),
        "technology_route_fingerprint": digest,
        "technology_route_source_ref": "model://b/r1t3-future-operation-plan" + suffix,
        "technology_route_valid_until": 190,
        "technology_route_model_code_change_id": "r1t2-func-1",
        "cooperation_link": "l2", "cooperation_source_revision": "rel-2",
        "pilot_work": "w2", "pilot_result_ref": "model://w2-result",
    }
    d["events"].append(proposal)
    for i, owner in enumerate(("a", "c", "b"), start=1):
        if absent == owner or (buyer_finishes and owner == "c"):
            continue
        d["events"].append({
            "at": request_at + i, "action": "technology_route_response",
            "actor": owner, "org_revision": "oc-1",
            "technology_route_id": route_id,
            "technology_route_fingerprint": digest,
            "technology_route_decision": (
                "OBJECT_ORIGINAL_TECHNOLOGY" if objecting == owner
                else "SUPPORT_ORIGINAL_TECHNOLOGY"
            ),
            "technology_route_decision_source_ref":
                f"model://{owner}/r1t3-own-operation-plan-approval" + suffix,
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
    result_ref = old_complete["result_ref"] + suffix
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
            "actor": finisher, "work": "w3",
            "from_operation": "stage-a", "to_operation": "stage-c",
            "source_revision": "d-3", "org_revision": "oc-1",
            "dispatch_ref": "model://a/r1t3-handoff-dispatch",
            "result_ref": f"model://{finisher}/r1t3-handoff-receipt" + suffix,
        },
        {
            "at": original_start + 4, "action": "start_operation",
            "actor": finisher, "work": "w3", "operation": "stage-c",
        },
        {
            "at": original_start + 5, "action": "complete_operation",
            "actor": finisher, "work": "w3", "operation": "stage-c",
            "result_ref": f"model://{finisher}/r1t3-stage-c-result" + suffix,
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
    relation = next(
        row for row in out["cooperation"]["system_projection"]["relations"]
        if row["link"] == "l2"
    )
    observed = relation["components"]["Э"][
        "transaction_coordination_exposures"
    ]
    assert observed["observed_coordination_events"][
        "RENEGOTIATION_AND_ADAPTATION"
    ]["applied"] >= 4  # One route proposal and three own source responses.
    assert observed["real_transaction_cost_amount"] is None
    assert observed["event_counts_are_monetary_costs"] is False
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
    assert last_request(out)["reason"] == "OC_POSITIVE_RIGHT_NOT_DECLARED"
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


def test_r1t3_strict_original_kpb_never_implicitly_grants_cross_owner_route_source_right():
    from types import SimpleNamespace
    from research.akis.qualitative_mesa.rules import QualitativeAKIS
    from .test_rules import fixture

    original = QualitativeAKIS(fixture())
    # Keep the initial original event model, but explicitly turn on the
    # preexisting strict context rights boundary for this event only.
    original.context_basis = SimpleNamespace(strict=True)
    outcome = original.apply({
        "at": 2, "action": "technology_route_propose", "actor": "a",
    }, 2)
    assert outcome["reason"] == "TECHNOLOGY_ROUTE_SOURCE_RIGHTS_NOT_QUALIFIED"
    assert original.works["w1"].result == "NOT_SUBMITTED"


def strict_original_technology_route_case(**kwargs):
    """Preserve original formation context and add exact independent KPB rights."""
    from .test_r1u4_strict_original_source_rights_mesa import _original_rights

    d = original_technology_route_case(**kwargs)
    original = deepcopy(d["context_evidence"])
    _original_rights(d)
    strict = d["context_evidence"]
    ids = {row["id"] for row in strict["sources"]}
    assert not ids.intersection(row["id"] for row in original["sources"])
    strict["sources"].extend(original["sources"])
    return d


def test_strict_original_cross_owner_technology_route_uses_existing_context_and_capacity():
    doc = strict_original_technology_route_case()
    frozen = deepcopy(doc)
    out = simulate(doc)
    assert doc == frozen
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"]) for r in out["trace"] if r["outcome"] == "BLOCKED"]
    assert last_request(out)["technology_route_strict_original_decision_sources_qualified"]
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["technology"]["handoffs"]["required_edges"][0]["state"] == "RECEIVED"
    assert out["works"]["w3"]["consenting_principals"] == ["a", "b", "c"]
    assert out["context_basis"]["strict"]


@pytest.mark.parametrize("actor", ["a", "b", "c"])
def test_strict_technology_response_requires_independent_owner_source_right(actor):
    doc = strict_original_technology_route_case()
    vote = next(r for r in doc["events"] if r["action"] == "technology_route_response" and r["actor"] == actor)
    vote["source_rights_ref"] = "model://op/unrelated"
    out = simulate(doc)
    blocked = next(r for r in reports(out, "technology_route_response") if r["actor"] == actor)
    assert blocked["reason"] == "CONTEXT_DECISION_INDEPENDENT_OWNER_RIGHT_MISSING"
    assert "w3" not in out["works"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_strict_technology_source_expiry_between_request_and_commit_blocks_new_obligation():
    doc = strict_original_technology_route_case()
    vote = next(r for r in doc["events"] if r["action"] == "technology_route_response" and r["actor"] == "c")
    request = next(r for r in doc["events"] if r["action"] == "request" and r["work_spec"]["id"] == "w3")
    source = next(r for r in doc["context_evidence"]["sources"] if r["id"] == vote["source_rights_ref"])
    source["valid_until"] = request["at"]
    out = simulate(doc)
    assert last_request(out)["outcome"] == "APPLIED"
    assert next(r for r in reports(out, "commit") if r["work"] == "w3")["reason"] == "CONTEXT_SOURCE_EXPIRED"
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_strict_technology_source_expiry_after_commit_preserves_original_work():
    doc = strict_original_technology_route_case()
    vote = next(r for r in doc["events"] if r["action"] == "technology_route_response" and r["actor"] == "c")
    commit = next(r for r in doc["events"] if r["action"] == "commit" and r.get("work") == "w3")
    next(r for r in doc["context_evidence"]["sources"] if r["id"] == vote["source_rights_ref"])["valid_until"] = commit["at"]
    out = simulate(doc)
    assert next(r for r in reports(out, "commit") if r["work"] == "w3")["outcome"] == "APPLIED"
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def original_market_complementarity_case(*, alternate=None, incomplete=False, source_stale=False,
                                         buyer_alternate=False, competing=False,
                                         buyer_finishes=False):
    """One existing buyer demand and complementary offers, not a second market."""
    d = strict_original_technology_route_case(competing=competing, buyer_finishes=buyer_finishes)
    buyer_alternate = buyer_alternate or competing
    scope = {
        "work": "w3", "work_revision": "d-3", "deliverable": "combined-manufacture-and-finishing",
        "buyer_source": {"reference": "model://b/market-need-w3", "revision": "market-v1"},
        "requirements": [
            {"operation": "stage-a", "capability": "manufacture", "capacity_unit": "UNIT",
             "compatible_resources": ["ra"]},
            {"operation": "stage-c", "capability": "finishing", "capacity_unit": "UNIT",
             "compatible_resources": ["rc"]},
        ],
        "offers": [], "offer_revisions": {}, "owner_scopes": {},
    }
    def source(owner, suffix, stale=False):
        ref = f"model://{owner}/{suffix}"
        d["context_evidence"]["sources"].append({
            "id": ref, "owner": owner, "revision": "market-v1", "status": "UNKNOWN" if stale else "CONFIRMED",
            "usable_by": sorted({owner, "b"}), "core": "corporate",
            "purposes": ["AKIS_TECHNOLOGY_MARKET_EVIDENCE"], "operations": ["READ"],
            "valid_from": 0, "valid_until": 190,
        })
        return ref
    source("b", "market-need-w3")
    def offer(owner, resource, capability, stale=False):
        ident = f"{owner}-{capability}"
        ref = source(owner, f"market-offer-{capability}", stale)
        scope["offers"].append({
            "id": ident, "owner": owner, "resource": resource, "capability": capability,
            "capacity_unit": "UNIT", "source_ref": ref, "available_at": 0, "expires_at": 190,
        })
        scope["offer_revisions"][ident] = "market-v1"
    offer("a", "ra", "manufacture")
    offer("c", "rc", "finishing")
    if alternate is not None:
        d["resources"].append({
            "id": "ra-finishing", "owner": "a", "availability": alternate,
            "capacity_units": 1, "capacity_unit": "UNIT", "site": "site-a",
        })
        scope["requirements"][1]["compatible_resources"].append("ra-finishing")
        offer("a", "ra-finishing", "finishing", source_stale)
    if buyer_alternate:
        d["resources"].append({
            "id": "rb-finishing", "owner": "b", "availability": "AVAILABLE",
            "capacity_units": 1, "capacity_unit": "UNIT", "site": "site-b",
        })
        scope["requirements"][1]["compatible_resources"].append("rb-finishing")
        offer("b", "rb-finishing", "finishing")
    for owner in ("a", "b", "c"):
        if incomplete and owner == "a":
            continue
        scope["owner_scopes"][owner] = {
            "source_ref": source(owner, "market-catalogue-scope-w3"),
            "source_revision": "market-v1", "complete": True,
        }
    for e in d["events"]:
        if (e["action"] == "technology_route_propose"
                or e["action"] == "request" and e["work_spec"]["id"] == "w3"
                or e["action"] == "commit" and e.get("work") == "w3"):
            e["technology_route_market_scope"] = deepcopy(scope)
    return d


def _market_reviews(out):
    return [row["technology_route_market_feasibility"] for row in out["trace"]
            if row.get("outcome") == "APPLIED" and "technology_route_market_feasibility" in row]


@pytest.mark.parametrize("kwargs,status,counts", [
    ({}, "COOPERATIVE_PLAN_EXPANDS_DECLARED_FEASIBLE_ORDER_SET",
     {"FEASIBLE": 0, "NO_FEASIBLE_IN_DECLARED_SCOPE": 3, "UNKNOWN": 0}),
    ({"alternate": "AVAILABLE"}, "SINGLE_OWNER_ALTERNATIVE_EXISTS",
     {"FEASIBLE": 1, "NO_FEASIBLE_IN_DECLARED_SCOPE": 2, "UNKNOWN": 0}),
    ({"alternate": "UNAVAILABLE"}, "COOPERATIVE_PLAN_EXPANDS_DECLARED_FEASIBLE_ORDER_SET",
     {"FEASIBLE": 0, "NO_FEASIBLE_IN_DECLARED_SCOPE": 3, "UNKNOWN": 0}),
    ({"alternate": "UNKNOWN"}, "SINGLE_OWNER_ALTERNATIVE_NOT_IDENTIFIABLE",
     {"FEASIBLE": 0, "NO_FEASIBLE_IN_DECLARED_SCOPE": 2, "UNKNOWN": 1}),
    ({"incomplete": True}, "SINGLE_OWNER_ALTERNATIVE_NOT_IDENTIFIABLE",
     {"FEASIBLE": 0, "NO_FEASIBLE_IN_DECLARED_SCOPE": 2, "UNKNOWN": 1}),
    ({"alternate": "AVAILABLE", "source_stale": True}, "SINGLE_OWNER_ALTERNATIVE_NOT_IDENTIFIABLE",
     {"FEASIBLE": 0, "NO_FEASIBLE_IN_DECLARED_SCOPE": 2, "UNKNOWN": 1}),
])
def test_original_market_feasibility_not_assumed_from_owner_count(kwargs, status, counts):
    d = original_market_complementarity_case(**kwargs)
    frozen = deepcopy(d)
    out = simulate(d)
    assert d == frozen
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"]) for r in out["trace"] if r["outcome"] == "BLOCKED"]
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    reviews = _market_reviews(out)
    assert len(reviews) == 3
    assert all(r["status"] == status and r["single_owner_feasibility_counts"] == counts
               and r["selected_cooperative_plan_preview_feasible"] for r in reviews)
    assert all(r["no_original_capacity_reserved_or_owner_consent_created"] for r in reviews)
    assert all(not r["actual_market_absence_or_additional_revenue_verified"] for r in reviews)
    assert out == simulate(deepcopy(d))


def test_original_market_offer_or_scope_cannot_be_rewritten_after_consultation():
    d = original_market_complementarity_case()
    req = next(e for e in d["events"] if e["action"] == "request" and e["work_spec"]["id"] == "w3")
    req["technology_route_market_scope"]["requirements"][0]["capability"] = "different"
    out = simulate(d)
    assert last_request(out)["reason"] == "MARKET_SCOPE_ORIGINAL_SOURCE_FINGERPRINT_MISMATCH"
    assert "w3" not in out["works"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


def test_original_market_review_cannot_substitute_original_owner_consent():
    d = original_market_complementarity_case()
    d["events"] = [r for r in d["events"] if not (
        r["action"] == "consent" and r.get("work") == "w3" and r["actor"] == "c")]
    out = simulate(d)
    assert len(_market_reviews(out)) == 2
    assert next(r for r in reports(out, "commit") if r["work"] == "w3")["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"


def test_qualified_market_scope_does_not_imply_recipient_quality_or_new_revenue():
    d = original_market_complementarity_case()
    next(e for e in d["events"] if e["action"] == "assess_result_quality" and e.get("criterion") == "q-stage-c")[
        "quality_verdict"] = "DOES_NOT_MEET"
    out = simulate(d)
    assert len(_market_reviews(out)) == 3
    assert all(row["status"] == "COOPERATIVE_PLAN_EXPANDS_DECLARED_FEASIBLE_ORDER_SET" for row in _market_reviews(out))
    assert out["works"]["w3"]["result"] == "SUBMITTED"
    assert out["profit"]["system_increment"] == "UNKNOWN"


def original_market_order_finance_case(*, alternate=None, incomplete=False,
                                      fee="100.00", c_opening="400.00",
                                      observed="14", missing_owner=False,
                                      failed_quality=False, competing=False, buyer_finishes=False,
                                      buyer_finish_material="140.00", buyer_finish_labor="80.00",
                                      supplier_finish_price="400.00", commercial=False,
                                      buyer_budget="1400.00", buyer_opening="2500.00",
                                      supplier_finish_material="180.00", supplier_finish_labor="100.00"):
    """Attach complete owner declarations to SAME W1/W2/W3 and ledger."""
    from .test_r1p_r3_executed_route_economics_mesa import add_original_recipient_value

    d = original_market_complementarity_case(alternate=alternate, incomplete=incomplete,
                                             competing=competing, buyer_finishes=buyer_finishes)
    finisher = "b" if buyer_finishes else "c"
    owners = ("a", "b", "c", "op")
    accepted_at = next(e["at"] for e in d["events"] if e.get("work") == "w3" and e["action"] == "accept")
    d["model_horizon"] = max(d["model_horizon"], accepted_at + 5)
    horizon = d["model_horizon"]
    d["strict_economic_source_works"] = ["w1", "w2", "w3"]
    coverage = {owner: f"market-terms-{owner}" for owner in owners}
    money = d["economic_claims"] = {
        "period": "THREE_ORIGINAL_MARKET_ORDER_PERIODS", "currency": "RUB",
        "sources": [], "transfers": [], "resource_uses": [],
        "coverage": {"COOPERATION": coverage, "INDEPENDENT_ALTERNATIVE": {}},
        "outside_feasibility": {},
        "cash_timing": {"horizon_end": horizon, "owner_positions": [], "transfer_windows": []},
        "lifecycle_costs": {"bindings": [], "scope_proofs": {"COOPERATION": deepcopy(coverage),
                            "INDEPENDENT_ALTERNATIVE": {}}, "event_bindings": []},
        "work_payment_conditions": [], "work_payment_settlement_claims": [],
    }
    life = money["lifecycle_costs"]

    def evidence(owner, name, *, declare=False, start=0):
        ref = f"model://{owner}/{name}"
        d["context_evidence"]["sources"].append({
            "id": ref, "owner": owner, "revision": "market-finance-v1",
            "status": "CONFIRMED", "usable_by": [owner],
            "core": "operator" if owner == "op" else "corporate",
            "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
            "valid_from": start, "valid_until": max(190, horizon+1),
        })
        if declare:
            money["sources"].append({"id": name, "owner": owner, "reference": ref,
                                     "revision": "market-finance-v1"})
        return ref

    for owner, opening, reserve in (
            ("a", "800.00", "100.00"), ("b", buyer_opening, "100.00"),
            ("c", c_opening, "100.00"), ("op", "100.00", "30.00")):
        evidence(owner, coverage[owner], declare=True)
        evidence(owner, f"market-receipt-{owner}", declare=True)
        money["cash_timing"]["owner_positions"].append({
            "owner": owner, "source": coverage[owner], "opening_cash": opening,
            "reserve_cash": reserve,
        })

    def transfer(work, name, payer, payee, amount, condition, at):
        ident = f"{work}-market-{name}"
        parties = {payer, payee} - {"EXTERNAL"}
        witnesses = {owner: coverage[owner] for owner in sorted(parties)}
        money["transfers"].append({"id": ident, "scenario": "COOPERATION", "payer": payer,
            "payee": payee, "amount": amount, "source": coverage[payer], "work": work})
        money["cash_timing"]["transfer_windows"].append({"transfer_id": ident,
            "at": at, "late_at": at, "owner_sources": deepcopy(witnesses)})
        money["work_payment_conditions"].append({"transfer_id": ident, "condition": condition,
            "due_at": at+1, "work_source_revision": f"d-{work[-1]}",
            "org_revision": "oc-1", "owner_sources": deepcopy(witnesses)})
        if payee != "EXTERNAL" and condition == "ON_CUSTOMER_ACCEPTANCE" and not (failed_quality and work == "w3"):
            refs = {owner: evidence(owner, f"{ident}-receipt") for owner in sorted(parties)}
            money["work_payment_settlement_claims"].append({
                "id": f"{ident}-settlement", "transfer_id": ident, "at": at, "amount": amount,
                "owner_sources": {owner: f"market-receipt-{owner}" for owner in parties}, "evidence_refs": refs,
                "evidence_revisions": {owner: "market-finance-v1" for owner in parties},
                "owner_attestations": {owner: {"reported_at": at, "reported_amount": amount}
                                       for owner in parties},
            })

    def cost(work, name, owner, amount, action, bucket, nature):
        ident = f"{work}-market-{name}"
        pos, event = next((i, e) for i, e in enumerate(d["events"])
                          if e.get("work") == work and e["action"] == action and e["actor"] == owner)
        ref = evidence(owner, f"{ident}-cost")
        money["resource_uses"].append({"id": ident, "scenario": "COOPERATION", "work": work,
            "owner": owner, "source": coverage[owner], "amount": amount, "bucket": bucket})
        life["bindings"].append({"resource_use_id": ident, "owner": owner, "source": coverage[owner],
            "stage": "MONITORING_AND_QUALITY" if action == "assess_result_quality" else "PRODUCTION_COORDINATION",
            "nature": nature})
        life["event_bindings"].append({"resource_use_id": ident, "work": work, "owner": owner,
            "source": coverage[owner], "work_source_revision": f"d-{work[-1]}", "trace_position": pos,
            "at": event["at"], "action": action, "org_revision": "oc-1",
            "cost_evidence_ref": ref, "cost_evidence_revision": "market-finance-v1"})

    for work, purchase, material, opfee, overhead, labor in (
            ("w1", "300.00", "180.00", "30.00", "20.00", "100.00"),
            ("w2", "400.00", "230.00", "40.00", "25.00", "80.00")):
        clock = {e["action"]: e["at"] for e in d["events"] if e.get("work") == work}
        transfer(work, "purchase", "b", "a", purchase, "ON_CUSTOMER_ACCEPTANCE", clock["accept"]+2)
        transfer(work, "material", "a", "EXTERNAL", material, "ON_ORIGINAL_COMMIT", clock["commit"]+1)
        transfer(work, "fee", "a", "op", opfee, "ON_ORIGINAL_COMMIT", clock["commit"]+2)
        transfer(work, "overhead", "op", "EXTERNAL", overhead, "ON_ORIGINAL_COMMIT", clock["commit"]+3)
        cost(work, "labor", "a", labor, "start", "DELIVERY", "DIRECT_RESOURCE")
        cost(work, "coordination", "op", "15.00", "commit", "COORDINATION", "TRANSACTION")
    commit = next(e["at"] for e in d["events"] if e.get("work") == "w3" and e["action"] == "commit")
    for name, payer, payee, amount, condition, at in (
            ("purchase-a", "b", "a", "700.00", "ON_CUSTOMER_ACCEPTANCE", accepted_at+2),
            ("purchase-c", "b", "c", supplier_finish_price, "ON_CUSTOMER_ACCEPTANCE", accepted_at+2),
            ("fee", "b", "op", fee, "ON_CUSTOMER_ACCEPTANCE", accepted_at+2),
            ("material-a", "a", "EXTERNAL", "300.00", "ON_ORIGINAL_COMMIT", commit+1),
            ("material-" + finisher, finisher, "EXTERNAL",
             buyer_finish_material if buyer_finishes else supplier_finish_material, "ON_ORIGINAL_COMMIT", commit+1),
            ("overhead", "op", "EXTERNAL", "30.00", "ON_ORIGINAL_COMMIT", commit+1)):
        if buyer_finishes and name == "purchase-c":
            continue
        transfer("w3", name, payer, payee, amount, condition, at)
    cost("w3", "labor-a", "a", "150.00", "start_operation", "DELIVERY", "DIRECT_RESOURCE")
    cost("w3", "labor-" + finisher, finisher, buyer_finish_labor if buyer_finishes else supplier_finish_labor,
         "start_operation", "DELIVERY", "DIRECT_RESOURCE")
    cost("w3", "coordination", "op", "50.00", "commit", "COORDINATION", "TRANSACTION")
    cost("w3", "inspection", "b", "30.00", "assess_result_quality", "COORDINATION", "TRANSACTION")
    add_original_recipient_value(d, "w3", observed=observed)
    scopes = {}
    for owner in ("a", finisher, "op"):
        if missing_owner and owner == finisher:
            continue
        name = f"market-incremental-{owner}"
        evidence(owner, name, declare=True, start=accepted_at+1)
        scopes[owner] = {"source": name, "observed_at": accepted_at+1,
            "transfer_ids": [t["id"] for t in money["transfers"]
                             if t["work"] == "w3" and owner in {t["payer"], t["payee"]}],
            "resource_use_ids": [r["id"] for r in money["resource_uses"]
                                 if r["work"] == "w3" and r["owner"] == owner],
            "incremental_costs_exclude_each_other_and_include_opportunity_costs": True}
    money["market_order_economics"] = {"work": "w3", "work_revision": "d-3",
        "result_ref": money["recipient_use_value_evidence"][0]["result_ref"], "owner_scopes": scopes}
    if failed_quality:
        next(e for e in d["events"] if e["action"] == "assess_result_quality"
             and e.get("criterion") == "q-stage-c")["quality_verdict"] = "DOES_NOT_MEET"
    if commercial:
        add_original_commercial_terms(d, buyer_budget=buyer_budget)
    return d


def test_original_market_order_creates_four_independent_positive_model_contributions():
    d = original_market_order_finance_case()
    frozen = deepcopy(d)
    out = simulate(d)
    assert d == frozen
    r = out["economics"]["original_market_order_economics"]
    assert r["status"] == "MODEL_ORIGINAL_ACCEPTED_ORDER_ECONOMICS", r
    assert r["newly_feasible_order_all_owner_viability"] == "MODEL_CRITERIA_MET", r
    assert r["positive_original_owner_contribution_count"] == 4
    assert r["all_owner_declared_reserves_met"]
    private = r["local_research_only"]
    assert private["buyer_payment_to_original_suppliers_and_operator"] == "1200.00"
    assert private["gross_incremental_recipient_use_value"] == "1500.00"
    assert private["consolidated_external_cash_net"] == "-510.00"
    assert private["consolidated_exclusive_resource_cost"] == "330.00"
    assert private["consolidated_model_contribution"] == "660.00"
    assert {k: v["model_contribution"] for k, v in private["per_owner"].items()} == {
        "a": "250.00", "b": "270.00", "c": "120.00", "op": "20.00"}
    assert r["real_market_additionality_and_profit"] == "NOT_IDENTIFIABLE"
    assert out == simulate(deepcopy(d))


@pytest.mark.parametrize("kwargs,count,reason", [
    ({"alternate": "AVAILABLE"}, 4, "SINGLE_OWNER_ALTERNATIVE_EXISTS"),
    ({"incomplete": True}, 4, "SINGLE_OWNER_ALTERNATIVE_NOT_IDENTIFIABLE"),
    ({"fee": "70.00"}, 3, "COOPERATIVE_PLAN_EXPANDS_DECLARED_FEASIBLE_ORDER_SET"),
    ({"observed": "8"}, 3, "COOPERATIVE_PLAN_EXPANDS_DECLARED_FEASIBLE_ORDER_SET"),
    ({"c_opening": "200.00"}, 4, "COOPERATIVE_PLAN_EXPANDS_DECLARED_FEASIBLE_ORDER_SET"),
])
def test_positive_consolidated_value_does_not_override_alternative_owner_loss_or_reserve(kwargs, count, reason):
    r = simulate(original_market_order_finance_case(**kwargs))["economics"]["original_market_order_economics"]
    assert r["status"] == "MODEL_ORIGINAL_ACCEPTED_ORDER_ECONOMICS", r
    assert r["positive_original_owner_contribution_count"] == count
    assert r["original_commit_market_feasibility"] == reason
    assert r["newly_feasible_order_all_owner_viability"] == "NOT_ESTABLISHED"


def test_market_order_fee_redistribution_does_not_create_consolidated_value():
    a = simulate(original_market_order_finance_case())["economics"]["original_market_order_economics"]
    b = simulate(original_market_order_finance_case(fee="70.00"))["economics"]["original_market_order_economics"]
    assert a["local_research_only"]["consolidated_model_contribution"] == (
        b["local_research_only"]["consolidated_model_contribution"])
    assert b["negative_original_owner_contribution_count"] == 1


def test_market_order_missing_independent_owner_scope_never_becomes_zero_cost():
    r = simulate(original_market_order_finance_case(missing_owner=True))["economics"]["original_market_order_economics"]
    assert r["status"] == "UNKNOWN"
    assert "INDEPENDENT_OWNER_COST_SCOPE_INCOMPLETE" in r["reasons"]
    assert "local_research_only" not in r


@pytest.mark.parametrize("mutation,reason", [
    ("wrong_owner", "MARKET_ORDER_ORIGINAL_OWNER_HISTORICAL_SOURCE_NOT_QUALIFIED"),
    ("missing_cost", "MARKET_ORDER_COMPLETE_OWNER_ORIGINAL_ROWS_REQUIRED"),
    ("overlapping_source", "MARKET_ORDER_DISTINCT_OWNER_INCREMENTAL_SCOPE_SOURCE_REQUIRED"),
    ("wrong_result", "MARKET_ORDER_ORIGINAL_RESULT_MISMATCH"),
])
def test_market_order_economic_evidence_cannot_replace_own_cost_scope_or_result(mutation, reason):
    d = original_market_order_finance_case()
    raw = d["economic_claims"]["market_order_economics"]
    if mutation == "wrong_owner":
        raw["owner_scopes"]["c"]["source"] = "market-incremental-a"
    elif mutation == "missing_cost":
        raw["owner_scopes"]["c"]["resource_use_ids"] = []
    elif mutation == "overlapping_source":
        raw["owner_scopes"]["c"]["source"] = "market-terms-c"
    else:
        raw["result_ref"] = "model://b/different-result"
    with pytest.raises(ValueError, match=reason):
        simulate(d)


def test_failed_market_order_quality_never_counts_new_accepted_economic_value():
    r = simulate(original_market_order_finance_case(failed_quality=True))["economics"]["original_market_order_economics"]
    assert r["status"] == "UNKNOWN"
    assert not r["original_accepted_result"]
    assert "local_research_only" not in r


@pytest.mark.parametrize("kwargs,competition,minimality,feasible,minimal,minimum", [
    ({}, "NO_OTHER_OWNER_SET_IN_DECLARED_SCOPE", "MINIMAL_IN_DECLARED_SCOPE", 1, 1, 2),
    ({"buyer_alternate": True}, "ALTERNATIVE_OWNER_SET_EXISTS", "MINIMAL_IN_DECLARED_SCOPE", 2, 2, 2),
    ({"alternate": "AVAILABLE"}, "ALTERNATIVE_OWNER_SET_EXISTS", "SMALLER_FEASIBLE_SUBSET_EXISTS", 2, 1, 1),
    ({"incomplete": True}, "ALTERNATIVE_OWNER_SET_NOT_IDENTIFIABLE", "NOT_IDENTIFIABLE", 1, 1, 2),
    ({"alternate": "UNKNOWN"}, "ALTERNATIVE_OWNER_SET_NOT_IDENTIFIABLE", "NOT_IDENTIFIABLE", 1, 1, 2),
])
def test_original_market_competing_owner_sets_not_confused_with_single_owner_absence(
        kwargs, competition, minimality, feasible, minimal, minimum):
    out = simulate(original_market_complementarity_case(**kwargs))
    reviews = _market_reviews(out)
    assert len(reviews) == 3
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    for review in reviews:
        r = review["original_competing_owner_sets"]
        assert r["status"] == competition
        assert r["selected_owner_set_minimality"] == minimality
        assert r["observed_distinct_feasible_owner_set_count"] == feasible
        assert r["observed_minimal_feasible_owner_set_count"] == minimal
        assert r["observed_minimum_feasible_owner_count"] == minimum
        assert r["technical_preview_not_independent_willingness_or_agreement"]
    if kwargs.get("buyer_alternate"):
        assert all(r["status"] == "COOPERATIVE_PLAN_EXPANDS_DECLARED_FEASIBLE_ORDER_SET" for r in reviews)
        assert out["works"]["w3"]["consenting_principals"] == ["a", "b", "c"]


def original_market_formation_outcome_case(*, observation="2", fee="120.00"):
    """Identical original history, demand, technology, and preparation costs.

    Only one original owner's later decision and missing own consent diverge.
    Failed formation has no selected cash transfers, with all owners' explicit
    independent evidence; costs of actual precommit events are retained.
    """
    accepted = original_market_order_finance_case(fee=fee)
    money = accepted["economic_claims"]
    life = money["lifecycle_costs"]
    selected = "w3"
    commit = next(e["at"] for e in accepted["events"] if e.get("work") == selected and e["action"] == "commit")
    horizon = money["cash_timing"]["horizon_end"]
    scope = money["market_order_economics"]["owner_scopes"]

    def evidence(owner, name, *, declare=False, start=0):
        ref = f"model://{owner}/{name}"
        accepted["context_evidence"]["sources"].append({
            "id": ref, "owner": owner, "revision": "formation-cost-v1",
            "status": "CONFIRMED", "usable_by": [owner],
            "core": "operator" if owner == "op" else "corporate",
            "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
            "valid_from": start, "valid_until": max(190, horizon+1),
        })
        if declare:
            money["sources"].append({"id": name, "owner": owner, "reference": ref,
                                     "revision": "formation-cost-v1"})
        return ref

    prep_ids = set()
    for owner, action, stage, amount in (
            ("b", "request", "PARTNER_SEARCH", "10.00"),
            ("a", "interest_update", "ADAPTATION_AND_RENEGOTIATION", "10.00"),
            ("c", "interest_update", "ADAPTATION_AND_RENEGOTIATION", "10.00"),
            ("op", "offer", "PARTNER_SEARCH", "20.00")):
        position, ev = next((i, e) for i, e in enumerate(accepted["events"])
                            if (e.get("work") == selected or e.get("work_spec", {}).get("id") == selected)
                            and e["action"] == action and e["actor"] == owner)
        ident = f"{selected}-formation-{owner}"
        prep_ids.add(ident)
        terms = f"market-terms-{owner}"
        proof = evidence(owner, f"{ident}-cost")
        money["resource_uses"].append({"id": ident, "scenario": "COOPERATION", "work": selected,
            "owner": owner, "source": terms, "amount": amount, "bucket": "COORDINATION"})
        life["bindings"].append({"resource_use_id": ident, "owner": owner, "source": terms,
            "stage": stage, "nature": "TRANSACTION"})
        life["event_bindings"].append({"resource_use_id": ident, "work": selected, "owner": owner,
            "source": terms, "work_source_revision": "d-3", "trace_position": position,
            "at": ev["at"], "action": action, "org_revision": "oc-1",
            "cost_evidence_ref": proof, "cost_evidence_revision": "formation-cost-v1"})
        if owner == "b":
            money["recipient_use_value_evidence"][0]["resource_use_ids"].append(ident)
        else:
            scope[owner]["resource_use_ids"].append(ident)
        evidence(owner, f"refused-scope-{owner}", declare=True, start=commit+1)
    evidence("b", "refused-recipient-use", declare=True, start=commit+1)
    refused = deepcopy(accepted)
    own_interest = next(e for e in refused["events"] if e.get("work") == selected
                        and e["action"] == "interest_update" and e["actor"] == "c")
    own_interest["new_willingness"] = "DECLINES"
    refused["events"] = [e for e in refused["events"] if not (
        e.get("work") == selected and e["action"] == "consent" and e["actor"] == "c")]
    cost = refused["economic_claims"]
    prior_transfers = {t["id"] for t in cost["transfers"] if t["work"] != selected}
    cost["transfers"] = [t for t in cost["transfers"] if t["id"] in prior_transfers]
    for field in ("work_payment_conditions", "work_payment_settlement_claims"):
        cost[field] = [t for t in cost[field] if t["transfer_id"] in prior_transfers]
    cost["cash_timing"]["transfer_windows"] = [t for t in cost["cash_timing"]["transfer_windows"]
                                                  if t["transfer_id"] in prior_transfers]
    cost["resource_uses"] = [r for r in cost["resource_uses"] if r["work"] != selected or r["id"] in prep_ids]
    retained = {r["id"] for r in cost["resource_uses"]}
    for field in ("bindings", "event_bindings"):
        cost["lifecycle_costs"][field] = [r for r in cost["lifecycle_costs"][field]
                                            if r["resource_use_id"] in retained]
    use = cost.pop("recipient_use_value_evidence")[0]
    cost.pop("market_order_economics")
    cost["uncommitted_order_cost_evidence"] = {
        "work": selected, "work_revision": "d-3", "refusing_owner": "c",
        "refusal_at": own_interest["at"],
        "owner_scopes": {owner: {"source": f"refused-scope-{owner}", "observed_at": commit+1,
            "resource_use_ids": [r["id"] for r in cost["resource_uses"]
                                 if r["work"] == selected and r["owner"] == owner],
            "zero_transfer_declared": True, "complete_exclusive_precommit_resource_scope": True}
            for owner in ("a", "b", "c", "op")},
        "recipient_no_order_observation": {
            "source": "refused-recipient-use", "at": horizon, "quantity": observation,
            "unit": use["unit"], "basis": use["basis"], "valuation_horizon": horizon,
        },
    }
    return {"accepted": accepted, "refused": refused}


def test_declined_original_order_retains_precommit_costs_without_creating_receipts():
    docs = original_market_formation_outcome_case()
    out = simulate(docs["refused"])
    r = out["economics"]["original_uncommitted_order_costs"]
    assert r["original_commit_blocked"] and r["original_independent_refusal_applied"]
    assert r["independent_zero_transfer_declaration_count"] == 4
    assert r["original_precommit_resource_cost_count"] == 4
    assert r["local_research_only"]["total_exclusive_precommit_resource_cost"] == "50.00"
    assert r["local_research_only"]["per_owner_exclusive_precommit_resource_cost"] == {
        "a": "10.00", "b": "10.00", "c": "10.00", "op": "20.00"}
    assert out["works"]["w3"]["result"] == "NOT_SUBMITTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert r["actual_costs_use_value_and_causal_effect"] == "NOT_IDENTIFIABLE"


@pytest.mark.parametrize("mutation,reason", [
    ("missing_owner", "UNCOMMITTED_ORDER_ORIGINAL_HISTORICAL_SCOPE_NOT_QUALIFIED"),
    ("not_zero", "UNCOMMITTED_ORDER_EXPLICIT_COMPLETE_ZERO_TRANSFER_SCOPE_REQUIRED"),
    ("missing_cost", "UNCOMMITTED_ORDER_ALL_ORIGINAL_PRECOMMIT_COSTS_REQUIRED"),
    ("aliased_scope", "UNCOMMITTED_ORDER_DISTINCT_OWNER_SCOPE_SOURCE_REQUIRED"),
    ("no_refusal", "UNCOMMITTED_ORDER_ORIGINAL_REFUSAL_AND_BLOCKED_COMMIT_REQUIRED"),
    ("wrong_refusal_tick", "UNCOMMITTED_ORDER_ORIGINAL_REFUSAL_AND_BLOCKED_COMMIT_REQUIRED"),
])
def test_uncommitted_order_cannot_use_absent_cash_or_cost_as_automatic_zero(mutation, reason):
    d = original_market_formation_outcome_case()["refused"]
    evidence = d["economic_claims"]["uncommitted_order_cost_evidence"]
    if mutation == "missing_owner":
        del evidence["owner_scopes"]["c"]
    elif mutation == "not_zero":
        evidence["owner_scopes"]["c"]["zero_transfer_declared"] = False
    elif mutation == "missing_cost":
        evidence["owner_scopes"]["c"]["resource_use_ids"] = []
    elif mutation == "aliased_scope":
        evidence["owner_scopes"]["c"]["source"] = "market-terms-c"
    elif mutation == "no_refusal":
        next(e for e in d["events"] if e.get("work") == "w3"
             and e["action"] == "interest_update" and e["actor"] == "c")["new_willingness"] = "WILLING"
    else:
        evidence["refusal_at"] -= 1
    with pytest.raises(ValueError, match=reason):
        simulate(d)


def test_uncommitted_order_omission_cannot_erase_committed_original_payment_scope():
    docs = original_market_formation_outcome_case()
    accepted = docs["accepted"]
    accepted["economic_claims"]["uncommitted_order_cost_evidence"] = docs["refused"][
        "economic_claims"]["uncommitted_order_cost_evidence"]
    with pytest.raises(ValueError, match="UNCOMMITTED_ORDER_CANNOT_OMIT_COMMITTED_TRANSFERS"):
        simulate(accepted)


def test_matched_original_market_formation_outcomes_include_unsuccessful_preparation():
    from research.akis.qualitative_mesa.comparative_trajectories import compare_original_market_formation_outcomes
    docs = original_market_formation_outcome_case()
    frozen = deepcopy(docs)
    r = compare_original_market_formation_outcomes(docs, work="w3", prior_works=("w1", "w2"))
    assert docs == frozen
    assert r["status"] == "MODEL_MATCHED_ORIGINAL_FORMATION_VALUE_CONTRAST"
    assert r["common_prior_and_precommit_costs_preserved"]
    assert r["recipient_declared_no_order_quantity_matched"]
    private = r["local_research_only"]
    assert private["accepted_selected_model_contribution"] == "610.00"
    assert private["refused_selected_model_contribution"] == "-50.00"
    assert private["accepted_minus_refused_model_contribution"] == "660.00"
    assert r["empirical_network_additionality"] == "NOT_IDENTIFIABLE"


@pytest.mark.parametrize("mutation,reason", [
    ("history", "FORMATION_CONTRAST_COMMON_FINANCIAL_HISTORY_CHANGED"),
    ("preparation", "FORMATION_CONTRAST_COMMON_FINANCIAL_HISTORY_CHANGED"),
    ("opening", "FORMATION_CONTRAST_FINANCIAL_BASELINE_CHANGED"),
    ("observation", "FORMATION_CONTRAST_RECIPIENT_NO_ORDER_QUANTITY_NOT_MATCHED"),
    ("other_decision", "FORMATION_CONTRAST_ONLY_ORIGINAL_REFUSAL_MAY_CHANGE"),
])
def test_matched_market_formation_contrast_rejects_unmatched_alternative(mutation, reason):
    from research.akis.qualitative_mesa.comparative_trajectories import compare_original_market_formation_outcomes
    docs = original_market_formation_outcome_case()
    d = docs["refused"]
    money = d["economic_claims"]
    if mutation == "history":
        money["resource_uses"][0]["amount"] = "999.00"
    elif mutation == "preparation":
        next(r for r in money["resource_uses"] if r["id"] == "w3-formation-op")["amount"] = "99.00"
    elif mutation == "opening":
        money["cash_timing"]["owner_positions"][0]["opening_cash"] = "900.00"
    elif mutation == "observation":
        money["uncommitted_order_cost_evidence"]["recipient_no_order_observation"]["quantity"] = "3"
    else:
        next(e for e in d["events"] if e.get("work") == "w3" and e["action"] == "interest_update"
             and e["actor"] == "a")["new_willingness"] = "DECLINES"
    with pytest.raises(ValueError, match=reason):
        compare_original_market_formation_outcomes(docs, work="w3", prior_works=("w1", "w2"))


def test_original_buyer_can_coproduce_and_accept_own_order_without_self_payment():
    d = original_market_order_finance_case(competing=True, buyer_finishes=True)
    frozen = deepcopy(d)
    out = simulate(d)
    assert d == frozen
    assert out["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e.get("reason")) for e in out["trace"] if e["outcome"] == "BLOCKED"]
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w3"]["consenting_principals"] == ["a", "b"]
    assert out["works"]["w3"]["technology"]["handoffs"]["required_edges"][0]["state"] == "RECEIVED"
    assert all(t["payer"] != t["payee"] for t in d["economic_claims"]["transfers"])
    r = out["economics"]["original_market_order_economics"]
    assert r["status"] == "MODEL_ORIGINAL_ACCEPTED_ORDER_ECONOMICS", r
    assert r["original_recipient_is_coproducer"]
    assert r["original_independent_supplier_count"] == 1
    assert r["original_technology_performer_count"] == 2
    assert r["original_owner_count"] == 3
    assert r["all_owner_positive_contribution_and_reserves"]
    private = r["local_research_only"]
    assert private["buyer_payment_to_original_suppliers_and_operator"] == "800.00"
    assert private["gross_incremental_recipient_use_value"] == "1500.00"
    assert private["consolidated_external_cash_net"] == "-470.00"
    assert private["consolidated_exclusive_resource_cost"] == "310.00"
    assert private["consolidated_model_contribution"] == "720.00"
    assert {k: v["model_contribution"] for k, v in private["per_owner"].items()} == {
        "a": "250.00", "b": "450.00", "op": "20.00"}
    assert out == simulate(deepcopy(d))


def test_original_buyer_coproduction_requires_separate_own_production_scope():
    d = original_market_order_finance_case(competing=True, buyer_finishes=True, missing_owner=True)
    r = simulate(d)["economics"]["original_market_order_economics"]
    assert r["status"] == "UNKNOWN"
    assert "INDEPENDENT_OWNER_COST_SCOPE_INCOMPLETE" in r["reasons"]
    assert "local_research_only" not in r


def test_original_buyer_coproduction_cannot_reuse_value_source_as_cost_scope():
    d = original_market_order_finance_case(competing=True, buyer_finishes=True)
    d["economic_claims"]["market_order_economics"]["owner_scopes"]["b"]["source"] = "value-b-outcome"
    with pytest.raises(ValueError, match="MARKET_ORDER_DISTINCT_OWNER_INCREMENTAL_SCOPE_SOURCE_REQUIRED"):
        simulate(d)


def test_original_common_code_also_permits_independent_supplier_finishing():
    d = original_market_order_finance_case(competing=True)
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e.get("reason")) for e in out["trace"] if e["outcome"] == "BLOCKED"]
    assert out["works"]["w3"]["consenting_principals"] == ["a", "b", "c"]
    r = out["economics"]["original_market_order_economics"]
    assert r["status"] == "MODEL_ORIGINAL_ACCEPTED_ORDER_ECONOMICS", r
    assert r["local_research_only"]["consolidated_model_contribution"] == "660.00"
    assert all(m["original_competing_owner_sets"]["status"] == "ALTERNATIVE_OWNER_SET_EXISTS"
               for m in _market_reviews(out))


def matched_competing_market_cases(*, buyer_finish_material="140.00", buyer_finish_labor="80.00",
                                  supplier_finish_price="400.00", buyer_observed="14",
                                  c_opening="400.00", buyer_failed_quality=False, commercial=True,
                                  buyer_budget="1400.00", buyer_opening="2500.00",
                                  supplier_finish_material="180.00", supplier_finish_labor="100.00"):
    """Common exogenous source universe: both routes can be chosen by owners."""
    docs = {
        "supplier": original_market_order_finance_case(
            competing=True, supplier_finish_price=supplier_finish_price, c_opening=c_opening,
            commercial=commercial, buyer_budget=buyer_budget, buyer_opening=buyer_opening,
            supplier_finish_material=supplier_finish_material, supplier_finish_labor=supplier_finish_labor),
        "coproduction": original_market_order_finance_case(
            competing=True, buyer_finishes=True, buyer_finish_material=buyer_finish_material,
            buyer_finish_labor=buyer_finish_labor, observed=buyer_observed,
            c_opening=c_opening, failed_quality=buyer_failed_quality, commercial=commercial,
            buyer_budget=buyer_budget, buyer_opening=buyer_opening),
    }
    # Common BEFORE-choice catalogue, existing KPB rights for both possible
    # routes, plus independent owner documents for each possible observation.
    # The shared Work context may be used by either original performer;
    # original Work consent and actual owner rules still constrain execution.
    sources, requirements, decision_rules, finance_sources = {}, {}, {}, {}
    for d in docs.values():
        for source in d["context_evidence"]["sources"]:
            key = source["id"]
            row = deepcopy(source)
            old = sources.get(key)
            if old is not None and old != row:
                assert key.startswith("model://op/work-w3-"), (old, row)
                assert {k: v for k, v in row.items() if k != "usable_by"} == {
                    k: v for k, v in old.items() if k != "usable_by"}
                row["usable_by"] = sorted(set(row["usable_by"]) | set(old["usable_by"]))
            sources[key] = row
        for row in d["context_evidence"]["requirements"]:
            key = (row["work"], row["action"])
            assert key not in requirements or requirements[key] == row
            requirements[key] = deepcopy(row)
        for row in d["context_evidence"]["decision_requirements"]:
            key = (row["action"], row["target"], row["actor"])
            assert key not in decision_rules or decision_rules[key] == row
            decision_rules[key] = deepcopy(row)
        for row in d["economic_claims"]["sources"]:
            assert row["id"] not in finance_sources or finance_sources[row["id"]] == row
            finance_sources[row["id"]] = deepcopy(row)
    for d in docs.values():
        d["context_evidence"].update(
            sources=list(deepcopy(sources).values()), requirements=list(deepcopy(requirements).values()),
            decision_requirements=list(deepcopy(decision_rules).values()))
        d["economic_claims"]["sources"] = list(deepcopy(finance_sources).values())
    return docs


def compare_competing_market(docs):
    from research.akis.qualitative_mesa.comparative_trajectories import compare_original_competing_market_routes
    split = next(e["at"] for e in docs["supplier"]["events"]
                 if e["action"] == "technology_route_propose") - 1
    return compare_original_competing_market_routes(
        docs, work="w3", prior_works=("w1", "w2"), split_at=split)


def competing_market_price(docs):
    from research.akis.qualitative_mesa.comparative_trajectories import review_competing_market_price_interval
    split = next(e["at"] for e in docs["supplier"]["events"]
                 if e["action"] == "technology_route_propose") - 1
    return review_competing_market_price_interval(
        docs, work="w3", prior_works=("w1", "w2"), split_at=split,
        candidate="supplier", comparator="coproduction", transfer_id="w3-market-purchase-c")


def test_matched_same_recipient_competing_routes_preserve_fixed_population_and_history():
    docs = matched_competing_market_cases()
    frozen = deepcopy(docs)
    r = compare_competing_market(docs)
    assert docs == frozen
    assert r["status"] == "MODEL_MATCHED_EXECUTED_COMPETING_MARKET_ROUTES", r
    assert r["qualified_route_count"] == 2
    assert r["same_original_buyer_budget_and_precommit_commercial_terms_required"]
    assert r["original_owner_count"] == 4
    assert r["best_model_contribution_among_executed_participant_viable_routes"] == ["coproduction"]
    pair = r["local_research_only"]["pairwise"][0]
    assert pair["left_minus_right_model_contribution"] == "60.00"
    assert pair["per_original_owner_left_minus_right"] == {
        "a": "0.00", "b": "180.00", "c": "-120.00", "op": "0.00"}
    assert not r["pairwise_contrasts"][0]["left_weak_pareto_improvement_on_selected_order"]
    assert r["displaced_owner_zero_only_for_selected_order_not_outside_income"]


@pytest.mark.parametrize("mutation,reason", [
    ("opening", "FINANCIAL_BASELINE_CHANGED"),
    ("historical_cost", "PRIOR_FINANCIAL_HISTORY_CHANGED"),
    ("valuation_rate", "RECIPIENT_VALUATION_BASIS_CHANGED"),
    ("quantity_baseline", "RECIPIENT_VALUATION_BASIS_CHANGED"),
    ("catalogue", "ORIGINAL_ROUTE_BINDING_REQUIRED"),
    ("initial_capacity", "INITIAL_STATE_CHANGED"),
    ("unrelated_event", "OTHER_POST_SPLIT_EVENT"),
])
def test_matched_competing_market_rejects_confounded_contrast(mutation, reason):
    docs = matched_competing_market_cases()
    d = docs["coproduction"]
    money = d["economic_claims"]
    if mutation == "opening":
        money["cash_timing"]["owner_positions"][0]["opening_cash"] = "999.00"
    elif mutation == "historical_cost":
        money["resource_uses"][0]["amount"] = "999.00"
    elif mutation == "valuation_rate":
        money["recipient_use_value_evidence"][0]["rate"]["amount"] = "126.00"
    elif mutation == "quantity_baseline":
        money["recipient_use_value_evidence"][0]["baseline"]["quantity"] = "3"
    elif mutation == "catalogue":
        next(e for e in d["events"] if e["action"] == "technology_route_propose")[
            "technology_route_market_scope"]["deliverable"] = "different-demand"
    elif mutation == "initial_capacity":
        d["resources"][0]["capacity_units"] = 9
    else:
        d["events"].append({"action": "accept", "work": "w2", "actor": "b",
                            "at": d["model_horizon"]})
    with pytest.raises(ValueError, match="COMPETING_MARKET_" + reason):
        compare_competing_market(docs)


def test_competing_market_requires_accepted_quality_not_just_technical_preview():
    r = compare_competing_market(matched_competing_market_cases(buyer_failed_quality=True))
    assert r["status"] == "UNKNOWN"
    assert "local_research_only" not in r


def test_competing_market_lower_realized_use_value_changes_preferred_model_route():
    r = compare_competing_market(matched_competing_market_cases(buyer_observed="12"))
    assert r["status"] == "MODEL_MATCHED_EXECUTED_COMPETING_MARKET_ROUTES", r
    assert r["best_model_contribution_among_executed_participant_viable_routes"] == ["supplier"]
    assert r["local_research_only"]["pairwise"][0]["left_minus_right_model_contribution"] == "-190.00"


def test_competing_market_liquidity_can_exclude_positive_contribution_route():
    r = compare_competing_market(matched_competing_market_cases(
        c_opening="200.00", buyer_finish_material="220.00", buyer_finish_labor="160.00"))
    assert r["status"] == "MODEL_MATCHED_EXECUTED_COMPETING_MARKET_ROUTES", r
    assert r["local_research_only"]["arms"]["supplier"]["consolidated_model_contribution"] == "660.00"
    assert r["best_model_contribution_among_executed_participant_viable_routes"] == ["coproduction"]


def test_competing_market_price_cannot_redistribute_nonexistent_joint_value():
    docs = matched_competing_market_cases()
    r = competing_market_price(docs)
    assert r["status"] == "NO_SINGLE_PRICE_CAN_MAKE_ALL_ORIGINAL_OWNERS_NO_WORSE"
    assert r["local_research_only"]["supplier_minimum_vs_comparator"] == "280.00"
    assert r["local_research_only"]["buyer_maximum_vs_comparator"] == "220.00"
    assert r["local_research_only"]["unresolved_model_value_gap"] == "60.00"


def test_competing_market_price_envelope_and_separately_executed_repricing():
    args = dict(buyer_finish_material="220.00", buyer_finish_labor="160.00")
    r = competing_market_price(matched_competing_market_cases(**args))
    assert r["status"] == "MODEL_NONNEGATIVE_INDIVIDUAL_PRICE_INTERVAL", r
    assert r["local_research_only"]["minimum_purchase_price"] == "280.00"
    assert r["local_research_only"]["maximum_purchase_price"] == "380.00"
    # A distinct scenario with independent original source declarations,
    # NOT a mutation of an already accepted historical Work or payment.
    adjusted = compare_competing_market(matched_competing_market_cases(
        **args, supplier_finish_price="350.00"))
    assert adjusted["status"] == "MODEL_MATCHED_EXECUTED_COMPETING_MARKET_ROUTES", adjusted
    pair = adjusted["local_research_only"]["pairwise"][0]
    assert pair["left_minus_right_model_contribution"] == "-100.00"
    assert pair["per_original_owner_left_minus_right"] == {
        "a": "0.00", "b": "-30.00", "c": "-70.00", "op": "0.00"}
    assert adjusted["pairwise_contrasts"][0]["right_weak_pareto_improvement_on_selected_order"]


def add_original_commercial_terms(d, *, buyer_budget="1400.00", expires_at=None):
    """Independent buyer budget and each supplier/operator's exact quote."""
    money = d["economic_claims"]
    proposal = next(e for e in d["events"] if e["action"] == "technology_route_propose")
    route = proposal["technology_route_id"]
    commit = next(e for e in d["events"] if e.get("work") == "w3" and e["action"] == "commit")
    expires_at = commit["at"]+1 if expires_at is None else expires_at
    source_valid = max(190, d["model_horizon"]+1)
    def source(owner, suffix, readers):
        ref = f"model://{owner}/{suffix}"
        d["context_evidence"]["sources"].append({
            "id": ref, "owner": owner, "revision": "commercial-v1", "status": "CONFIRMED",
            "usable_by": sorted(readers), "core": "operator" if owner == "op" else "corporate",
            "purposes": ["AKIS_TECHNOLOGY_ROUTE_COMMERCIAL_TERMS"], "operations": ["READ"],
            "valid_from": 0, "valid_until": source_valid,
        })
        return {"source_ref": ref, "source_revision": "commercial-v1"}
    raw = {
        "work": "w3", "work_revision": "d-3",
        "route_fingerprint": proposal["technology_route_fingerprint"],
        "buyer": "b", "currency": money["currency"], "buyer_maximum_payment": buyer_budget,
        "buyer_source": source("b", "original-market-commercial-budget", {"b"}), "offers": [],
    }
    for t in money["transfers"]:
        if t["work"] != "w3" or t["payer"] != "b" or t["payee"] == "EXTERNAL":
            continue
        terms = next(r for r in money["work_payment_conditions"] if r["transfer_id"] == t["id"])
        payee = t["payee"]
        raw["offers"].append({
            "payee": payee, "amount": t["amount"], "condition": terms["condition"],
            "due_at": terms["due_at"], "expires_at": expires_at,
            **source(payee, f"original-quote-{route}", {"b", "op", payee}),
        })
    bind_commercial_terms(d, raw)
    return raw


def bind_commercial_terms(d, raw):
    """Only for forming fresh prospective test trajectories."""
    digest = technology_route_fingerprint(raw)
    for e in d["events"]:
        if (e["action"] == "technology_route_propose"
                or e["action"] == "request" and e["work_spec"]["id"] == "w3"
                or e["action"] == "commit" and e.get("work") == "w3"):
            e["technology_route_commercial_terms"] = deepcopy(raw)
            e["technology_route_commercial_fingerprint"] = digest
        elif e["action"] == "technology_route_response" or (
                e["action"] == "consent" and e.get("work") == "w3"):
            e["technology_route_commercial_fingerprint"] = digest


def test_original_technology_commercial_quotes_bind_consent_and_payment_without_new_ledger():
    d = original_market_order_finance_case(commercial=True)
    out = simulate(d)
    assert out["counts"]["blocked"] == 0
    market = out["economics"]["original_market_order_economics"]
    assert market["original_precommit_commercial_terms_matched_to_payment_conditions"]
    assert out["economics"]["original_strict_context_source_qualification"][
        "original_commercial_order_payment_terms_matched_count"] == 1
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert market["local_research_only"]["consolidated_model_contribution"] == "660.00"


@pytest.mark.parametrize("mutation,action,reason", [
    ("budget", "technology_route_propose", "COMMERCIAL_ORIGINAL_BUYER_BUDGET_EXCEEDED"),
    ("foreign_quote", "technology_route_propose", "COMMERCIAL_ORIGINAL_OWNER_SOURCE_NOT_QUALIFIED"),
    ("missing_operator_quote", "technology_route_propose", "COMMERCIAL_ALL_EXTERNAL_SUPPLIERS_AND_OPERATOR_REQUIRED"),
    ("unshared_quote", "technology_route_propose", "COMMERCIAL_ORIGINAL_OWNER_SOURCE_NOT_QUALIFIED"),
    ("wrong_response", "technology_route_response", "COMMERCIAL_RESPONSE_MUST_BIND_ORIGINAL_TERMS"),
    ("wrong_request", "request", "COMMERCIAL_ORIGINAL_TERMS_FINGERPRINT_MISMATCH"),
    ("missing_consent_digest", "consent", "COMMERCIAL_WORK_CONSENT_MUST_BIND_ORIGINAL_TERMS"),
    ("expired_quote", "commit", "COMMERCIAL_ORIGINAL_OFFER_OR_DUE_TIME_STALE"),
    ("changed_commit_quote", "commit", "COMMERCIAL_ORIGINAL_TERMS_FINGERPRINT_MISMATCH"),
])
def test_original_commercial_gate_never_invents_budget_quote_or_consent(mutation, action, reason):
    d = original_market_order_finance_case(commercial=True)
    # In these tests exercise original transitions, without financial claims
    # about a Work which may be rejected before creation.
    d.pop("economic_claims")
    d.pop("strict_economic_source_works")
    proposal = next(e for e in d["events"] if e["action"] == "technology_route_propose")
    raw = deepcopy(proposal["technology_route_commercial_terms"])
    if mutation == "budget":
        raw["buyer_maximum_payment"] = "1000.00"
        bind_commercial_terms(d, raw)
    elif mutation == "foreign_quote":
        raw["offers"][0]["source_ref"] = raw["buyer_source"]["source_ref"] + "-other"
        bind_commercial_terms(d, raw)
    elif mutation == "missing_operator_quote":
        raw["offers"] = [o for o in raw["offers"] if o["payee"] != "op"]
        bind_commercial_terms(d, raw)
    elif mutation == "unshared_quote":
        ref = raw["offers"][0]["source_ref"]
        next(s for s in d["context_evidence"]["sources"] if s["id"] == ref)["usable_by"] = ["a"]
    elif mutation == "wrong_response":
        next(e for e in d["events"] if e["action"] == "technology_route_response"
             and e["actor"] == "a")["technology_route_commercial_fingerprint"] = "0"*64
    elif mutation == "wrong_request":
        next(e for e in d["events"] if e["action"] == "request" and e["work_spec"]["id"] == "w3")[
            "technology_route_commercial_terms"]["offers"][0]["amount"] = "999.00"
    elif mutation == "missing_consent_digest":
        next(e for e in d["events"] if e["action"] == "consent" and e.get("work") == "w3"
             and e["actor"] == "c").pop("technology_route_commercial_fingerprint")
    elif mutation == "expired_quote":
        tick = next(e["at"] for e in d["events"] if e["action"] == "commit" and e.get("work") == "w3")
        raw["offers"][0]["expires_at"] = tick
        bind_commercial_terms(d, raw)
    else:
        next(e for e in d["events"] if e["action"] == "commit" and e.get("work") == "w3")[
            "technology_route_commercial_terms"]["offers"][0]["amount"] = "999.00"
    out = simulate(d)
    assert any(e["action"] == action and e["outcome"] == "BLOCKED" and e["reason"] == reason
               for e in out["trace"]), [(e["at"], e["action"], e["reason"])
               for e in out["trace"] if e["outcome"] == "BLOCKED"]
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"].get("w3", {}).get("result") != "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("mutation,reason", [
    ("price", "COMMERCIAL_ORIGINAL_PURCHASE_PRICE_MISMATCH"),
    ("due", "COMMERCIAL_ORIGINAL_PAYMENT_CONDITION_MISMATCH"),
    ("currency", "COMMERCIAL_ORIGINAL_PAYMENT_DOCUMENT_REQUIRED"),
    ("missing_purchase", "COMMERCIAL_ORIGINAL_PURCHASE_PARTIES_MISMATCH"),
])
def test_original_committed_commercial_terms_cannot_be_rewritten_by_financial_claim(mutation, reason):
    d = original_market_order_finance_case(commercial=True)
    money = d["economic_claims"]
    if mutation == "price":
        next(t for t in money["transfers"] if t["id"] == "w3-market-purchase-c")["amount"] = "399.00"
    elif mutation == "due":
        next(t for t in money["work_payment_conditions"] if t["transfer_id"] == "w3-market-purchase-c")["due_at"] += 1
    elif mutation == "currency":
        money["currency"] = "USD"
    else:
        money["transfers"] = [t for t in money["transfers"] if t["id"] != "w3-market-purchase-c"]
    with pytest.raises(ValueError, match=reason):
        simulate(d)


def original_market_recipient_feedback_case(*, observed="14", pause=False, early=False,
                                            wrong_owner=False, stale=False):
    """Fourth original Work after buyer's own accepted technological Result.

    The buyer can commission a new Work or independently pause. The value
    scope is computed at the original phase-8 event, not at the final
    horizon. Fourth-period financial sources are absent from that review.
    """
    from research.akis.qualitative_mesa.org_code_policy import original_model_code_fingerprint
    from .test_r1u4_strict_original_source_rights_mesa import _original_rights
    from .test_r1p_r3_executed_route_economics_mesa import (
        attach_original_fourth_work_finance, add_original_recipient_value,
    )

    d = original_market_order_finance_case(competing=True, buyer_finishes=True,
                                         commercial=True, observed=observed)
    g, money = d["general_akis"], d["economic_claims"]
    old_request = next(e for e in d["events"] if e["action"] == "request"
                       and e["work_spec"]["id"] == "w3")
    accept = next(e["at"] for e in d["events"] if e["action"] == "accept" and e.get("work") == "w3")
    result = money["recipient_use_value_evidence"][0]["result_ref"]
    request_at = accept + 14
    shift = request_at - old_request["at"]
    horizon = max(230, request_at+65)
    d["model_horizon"] = horizon
    money["cash_timing"]["horizon_end"] = horizon
    money["recipient_use_value_evidence"][0]["valuation_horizon"] = horizon
    # Extend the controlled study horizon prospectively, not any accepted
    # Work, payment or agreed commercial quote. All source editions still
    # have distinct, independently reviewed fingerprints.
    for field in ("goals", "formation_phases", "context_cores", "agent_functions", "organizational_code"):
        for row in g[field]:
            if row["expires_at"] >= 160:
                row["expires_at"] = horizon+1
    for applied in (e for e in d["events"] if e["action"] == "model_code_apply"):
        for row in applied["model_code_records"]:
            if row["expires_at"] >= 160:
                row["expires_at"] = horizon+1
        digest = original_model_code_fingerprint(applied["model_code_records"])
        for row in d["events"]:
            if row.get("model_code_change_id") == applied["model_code_change_id"]:
                row["model_code_fingerprint"] = digest
    context = d["context_evidence"]
    for row in context["sources"]:
        if row.get("valid_until", 0) >= 160:
            row["valid_until"] = horizon+1
    following = []
    for actor, tick in (("a", accept+4), ("b", accept+(1 if early else 6))):
        source = f"model://{actor}/third-market-owner-review"
        context["sources"].append({
            "id": source, "owner": actor, "revision": "market-review-v1", "status": "CONFIRMED",
            "usable_by": [actor], "core": "corporate", "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
            "operations": ["READ"], "valid_from": accept+1, "valid_until": horizon+1,
        })
        row = {
            "at": tick, "action": "participation_status", "actor": actor, "org_revision": "oc-1",
            "cooperation_link": "l2", "cooperation_source_revision": "rel-2",
            "new_participation": "PAUSED_NEW_WORK" if actor == "b" and pause else "OPEN_TO_NEW_WORK",
            "economic_channel": "TRANSACTION_COST", "participation_evidence_ref": source,
            "evaluated_work": "w3", "evaluated_work_revision": "d-3",
            "evaluated_result_ref": result, "evaluated_decision_at": accept,
            "evaluation_verdict": ("ADVERSE_DECLARED" if actor == "b" and pause
                                   else "FAVOURABLE_DECLARED"),
            "formation_phase_source_ref": f"model://{actor}/formation-8",
            "evaluation_economic_source_revision": "stale" if stale and actor == "b" else "market-review-v1",
        }
        if actor == ("a" if wrong_owner else "b"):
            row["evaluation_economic_recipient_value"] = True
        following.append(row)
    following.extend([
        {"at": accept+7, "action": "need_emerge", "actor": "b", "work": "w4",
         "work_source_revision": "d-4", "org_revision": "oc-1",
         "goal_source_ref": "model://b/goal-after-market-order", "goal_expires_at": horizon+1,
         "goal_objective": "RESILIENCE", "goal_priority": 2, "cooperation_link": "l2",
         "cooperation_source_revision": "rel-2", "pilot_work": "w3",
         "pilot_result_ref": result, "pilot_decision_at": accept},
        {"at": accept+8, "action": "cooperation_change_propose", "actor": "a", "org_revision": "oc-1",
         "cooperation_link": "l2", "cooperation_source_revision": "rel-2",
         "change_id": "chg-w3", "change_kind": "REVISE_RESOURCE_COOPERATION",
         "economic_channel": "TRANSACTION_COST", "change_source_ref": "model://a/market-followup",
         "pilot_work": "w3", "pilot_result_ref": result, "pilot_decision_at": accept},
    ])
    for i, actor in enumerate(("a", "b", "c", "op"), 9):
        following.append({
            "at": accept+i, "action": "cooperation_change_response", "actor": actor,
            "org_revision": "oc-1", "cooperation_link": "l2", "cooperation_source_revision": "rel-2",
            "change_id": "chg-w3", "change_decision": "SUPPORT_MODEL_PROPOSAL",
            "change_source_ref": f"model://{actor}/market-followup-response",
        })
    # The new Work uses the actual first supplier's own capacity. It is a
    # separate demand and never reuses an earlier technology or money consent.
    spec = {
        "id": "w4", "customer": "b", "resource": "ra", "source_revision": "d-4",
        "slot_start": request_at+35, "slot_end": request_at+50,
        "requires_accepted": ["w3"], "resource_requirements": [{"resource": "ra", "units": 1}],
        "assurance_criteria": [{"id": "q-w4", "dimension": "DELIVERABLE_CONFORMITY",
            "operation": "WORK", "responsible_owner": "a", "assessor": "b", "method": "INSPECTION",
            "source_ref": "model://b/w4-market-quality", "source_revision": "d-4"}],
    }
    following.append({
        "at": request_at, "action": "request", "actor": "b", "work_spec": spec,
        "cooperation_link": "l2", "cooperation_source_revision": "rel-2", "pilot_work": "w3",
        "change_id": "chg-w3", "emergent_goal_source_ref": "model://b/goal-after-market-order",
    })
    packet = deepcopy(next(row for row in g["agent_functions"] if row["id"] == "approval-w3"))
    packet.update(id="approval-w4", work="w4", work_revision="d-4",
                  source_ref="model://op/packet-approval-w4")
    g["agent_functions"].append(packet)
    for e in d["events"]:
        if e.get("work") != "w3" or e["action"] not in {
                "interest_update", "formation_confirm", "function_prepare", "function_review",
                "offer", "authorize", "consent", "commit"}:
            continue
        if e["action"] == "formation_confirm" and e.get("phase") == 3 and e["actor"] != "a":
            continue
        row = deepcopy(e)
        row.update(work="w4", at=e["at"]+shift)
        for field in ("technology_route_market_scope", "technology_route_commercial_terms",
                      "technology_route_commercial_fingerprint", "technology_route_id", "technology_route_fingerprint"):
            row.pop(field, None)
        if row.get("source_revision") == "d-3":
            row["source_revision"] = "d-4"
        if row.get("function_id") == "approval-w3":
            row["function_id"] = "approval-w4"
        if "function_source_ref" in row:
            row["function_source_ref"] = "model://op/packet-approval-w4"
        if "review_source_ref" in row:
            row["review_source_ref"] = "model://b/independent-review-w4"
        if "prepared_at" in row:
            row["prepared_at"] += shift
        if row["action"] == "interest_update":
            row.update(pilot_work="w3", pilot_result_ref=result, pilot_decision_at=accept,
                       interest_valid_until=horizon+1,
                       interest_evidence_ref=f"model://{row['actor']}/w4-market-own-interest")
        following.append(row)
    start = max(spec["slot_start"], max(e["at"] for e in following)+1)
    assert start+3 < spec["slot_end"]
    following.extend([
        {"at": start, "action": "start", "actor": "a", "work": "w4"},
        {"at": start+1, "action": "complete", "actor": "a", "work": "w4",
         "result_ref": "model://a/w4-market-result"},
        {"at": start+2, "action": "assess_result_quality", "actor": "b", "work": "w4",
         "source_revision": "d-4", "org_revision": "oc-1", "criterion": "q-w4",
         "quality_verdict": "MEETS_DECLARED_REQUIREMENT", "quality_evidence_ref": "model://b/w4-market-inspection",
         "result_ref": "model://a/w4-market-result"},
        {"at": start+3, "action": "accept", "actor": "b", "work": "w4"},
    ])
    following.sort(key=lambda row: row["at"])
    assert len({e["at"] for e in following}) == len(following)
    more = {"events": following}
    _original_rights(more)
    for row in more["context_evidence"]["sources"]:
        row["valid_until"] = horizon+1
    for field in ("sources", "requirements", "decision_requirements"):
        context[field].extend(more["context_evidence"][field])
    d["events"].extend(following)
    d["events"].sort(key=lambda e: e["at"])
    if not pause:
        attach_original_fourth_work_finance(d)
        add_original_recipient_value(d, "w4", baseline="0", observed="8", rate="100.00",
                                    source_prefix="value-w4-b", append=True)
    return d


def market_recipient_feedback_report(out):
    return next(r for r in out["trace"] if r["action"] == "participation_status"
                and r.get("evaluated_work") == "w3" and "evaluation_recipient_value_scope_status" in r)


def test_original_recipient_value_asof_review_and_fourth_work_economics():
    d = original_market_recipient_feedback_case()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (e["at"], e["action"], e["reason"]) for e in out["trace"] if e["outcome"] == "BLOCKED"]
    review = market_recipient_feedback_report(out)
    assert review["evaluation_recipient_value_scope_status"] == (
        "MODEL_ORIGINAL_COMPLETED_RECIPIENT_VALUE_SCOPE_QUALIFIED")
    assert review["evaluation_recipient_value_private_advice_not_redisclosed"]
    assert "private_owner_model_contribution" not in review
    assert out["works"]["w3"]["result"] == out["works"]["w4"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    private = out["economics"]["original_recipient_use_value"]["local_research_only"]
    assert private["w3"]["recipient_model_surplus_vs_declared_no_order"] == "450.00"
    assert private["w4"]["recipient_model_surplus_vs_declared_no_order"] == "175.00"
    assert out["economics"]["original_strict_context_source_qualification"]["original_strict_work_scope_count"] == 4


@pytest.mark.parametrize("observed,pause,expected", [
    ("6", True, "PAUSED_NEW_WORK"),
    ("14", True, "PAUSED_NEW_WORK"),
    ("6", False, "OPEN_TO_NEW_WORK"),
])
def test_original_recipient_own_strategy_does_not_follow_value_automatically(observed, pause, expected):
    out = simulate(original_market_recipient_feedback_case(observed=observed, pause=pause))
    review = market_recipient_feedback_report(out)
    assert review["evaluation_recipient_value_scope_status"] == "MODEL_ORIGINAL_COMPLETED_RECIPIENT_VALUE_SCOPE_QUALIFIED"
    assert review["participation_value"] == expected
    assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    if pause:
        assert "w4" not in out["works"]
        assert any(r["action"] == "need_emerge" and r["outcome"] == "BLOCKED"
                   and r.get("work") == "w4" for r in out["trace"])
    else:
        assert out["works"]["w4"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("kwargs", [{"early": True}, {"wrong_owner": True}, {"stale": True}])
def test_original_recipient_value_feedback_rejects_future_foreign_or_stale_evidence(kwargs):
    out = simulate(original_market_recipient_feedback_case(**kwargs))
    review = market_recipient_feedback_report(out)
    assert review["evaluation_recipient_value_scope_status"] == "UNKNOWN"
    assert review["outcome"] == "APPLIED"
    assert out["works"]["w4"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"


@pytest.mark.parametrize("kwargs,expected_status,low,high", [
    ({"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00"},
     "MODEL_VALUE_BUDGET_AND_RESERVE_PRICE_INTERVAL", "280.00", "380.00"),
    ({"buyer_finish_material": "260.00", "buyer_finish_labor": "180.00", "buyer_budget": "1200.00"},
     "MODEL_VALUE_BUDGET_AND_RESERVE_PRICE_INTERVAL", "280.00", "400.00"),
    ({"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00", "buyer_opening": "1950.00"},
     "MODEL_VALUE_BUDGET_AND_RESERVE_PRICE_INTERVAL", "280.00", "350.00"),
    ({"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00", "buyer_opening": "1850.00"},
     "NO_PRICE_SATISFIES_ALL_OWNER_RESERVES_AT_FIXED_TIMING", None, None),
    ({"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00", "c_opening": "200.00"},
     "NO_PRICE_SATISFIES_ALL_OWNER_RESERVES_AT_FIXED_TIMING", None, None),
    ({}, "NO_PRICE_SATISFIES_VALUE_AND_BUYER_BUDGET", None, None),
    ({"commercial": False}, "UNKNOWN", None, None),
])
def test_competing_price_budget_and_reserve_intersection(kwargs, expected_status, low, high):
    docs = matched_competing_market_cases(**kwargs)
    frozen = deepcopy(docs)
    result = competing_market_price(docs)["fixed_timing_commercial_negotiation"]
    assert docs == frozen
    assert result["status"] == expected_status, result
    local = result.get("local_research_only", {})
    assert local.get("minimum_purchase_price") == low
    assert local.get("maximum_purchase_price") == high
    assert result["new_offer_and_fresh_consents_still_required"]


def robust_competing_price(cases):
    from research.akis.qualitative_mesa.comparative_trajectories import review_robust_competing_market_price_interval
    first = next(iter(cases.values()))
    split = next(e["at"] for e in first["supplier"]["events"]
                 if e["action"] == "technology_route_propose") - 1
    return review_robust_competing_market_price_interval(
        cases, work="w3", prior_works=("w1", "w2"), split_at=split,
        candidate="supplier", comparator="coproduction", transfer_id="w3-market-purchase-c")


def robust_competing_price_cases(*, mode="overlap", repriced="400.00"):
    args = {"buyer_finish_material": "220.00", "buyer_finish_labor": "160.00",
            "supplier_finish_price": repriced}
    if mode == "disjoint":
        return {
            "lower_buyer_outside_cost": matched_competing_market_cases(
                **{**args, "buyer_finish_labor": "120.00"}),
            "higher_supplier_and_buyer_cost": matched_competing_market_cases(
                **{**args, "buyer_finish_material": "260.00", "buyer_finish_labor": "180.00",
                   "supplier_finish_material": "220.00", "supplier_finish_labor": "130.00"}),
        }
    extra = ({"buyer_opening": "1950.00"} if mode == "overlap" else
             {"c_opening": "200.00"} if mode == "reserve_failure" else
             {"buyer_failed_quality": True} if mode == "unknown" else
             {"buyer_observed": "14", "commercial": False})
    return {"normal": matched_competing_market_cases(**args),
            "stress": matched_competing_market_cases(**{**args, **extra})}


def test_robust_competing_market_one_price_survives_all_declared_stresses():
    cases = robust_competing_price_cases()
    frozen = deepcopy(cases)
    result = robust_competing_price(cases)
    assert cases == frozen
    assert result["status"] == "MODEL_COMMON_PRICE_INTERVAL_ACROSS_DECLARED_STRESS_SET", result
    assert result["local_research_only"]["minimum_purchase_price"] == "280.00"
    assert result["local_research_only"]["maximum_purchase_price"] == "350.00"
    assert result["no_probability_or_empirical_risk_distribution_inferred"]
    assert result["one_new_price_still_requires_fresh_original_terms_and_consents"]
    # Fresh quotes/consents and actual executions in each declared case.
    for docs in robust_competing_price_cases(repriced="320.00").values():
        r = compare_competing_market(docs)
        assert r["status"] == "MODEL_MATCHED_EXECUTED_COMPETING_MARKET_ROUTES"
        assert r["pairwise_contrasts"][0]["right_weak_pareto_improvement_on_selected_order"]
        assert all(r["local_research_only"]["arms"]["supplier"]["original_owner_reserves_met"].values())


@pytest.mark.parametrize("mode,status", [
    ("disjoint", "NO_COMMON_PRICE_IN_DECLARED_STRESS_SET"),
    ("reserve_failure", "NO_COMMON_PRICE_IN_DECLARED_STRESS_SET"),
    ("unknown", "UNKNOWN"),
    ("missing_budget", "UNKNOWN"),
])
def test_robust_competing_market_never_averages_away_failed_or_unknown_cases(mode, status):
    r = robust_competing_price(robust_competing_price_cases(mode=mode))
    assert r["status"] == status, r
    assert "local_research_only" not in r
    if mode == "disjoint":
        assert r["individually_feasible_stress_case_count"] == 2
        assert r["all_cases_individually_feasible_but_intersection_empty"]


def test_robust_stress_comparison_rejects_unrelated_history_change_even_if_both_arms_match():
    cases = robust_competing_price_cases()
    for doc in cases["stress"].values():
        doc["economic_claims"]["resource_uses"][0]["amount"] = "101.00"
    with pytest.raises(ValueError, match="COMPETING_STRESS_NONPARAMETER_ORIGINAL_SCOPE_CHANGED"):
        robust_competing_price(cases)


def test_robust_stress_comparison_rejects_changed_valuation_basis_even_if_both_arms_match():
    cases = robust_competing_price_cases()
    for doc in cases["stress"].values():
        doc["economic_claims"]["recipient_use_value_evidence"][0]["rate"]["amount"] = "124.00"
    with pytest.raises(ValueError, match="COMPETING_STRESS_NONPARAMETER_ORIGINAL_SCOPE_CHANGED"):
        robust_competing_price(cases)


def _private_recipient_review_at_original_event(doc):
    from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel
    from research.akis.qualitative_mesa.owner_economic_feedback import review_completed_original_owner_finance

    event = next(e for e in doc["events"] if e.get("evaluation_economic_recipient_value") is True)
    model = OperatorAKISModel(deepcopy(doc))
    model.run_until(float(event["at"]) + 0.5)
    assert "w4" not in model.qualitative.works
    assert model.qualitative.works["w3"].result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    result = review_completed_original_owner_finance(
        state=model.qualitative, original_money=model.economic_claims,
        work_id=event["evaluated_work"], owner=event["actor"],
        review_source=event["participation_evidence_ref"],
        review_revision=event["evaluation_economic_source_revision"],
        at=event["at"], recipient_value=True)
    return result, model


@pytest.mark.parametrize("quantity,contribution,advice", [
    ("14", "450.00", "CONSIDER_FUTURE_WORK"),
    ("10.4", "0.00", "REVIEW_FUTURE_WORK"),
    ("6", "-550.00", "REVIEW_FUTURE_WORK"),
])
def test_private_original_recipient_advice_uses_exact_own_contribution_at_decision(quantity, contribution, advice):
    d = original_market_recipient_feedback_case(observed=quantity)
    own, model = _private_recipient_review_at_original_event(d)
    assert own["status"] == "MODEL_ORIGINAL_COMPLETED_RECIPIENT_VALUE_SCOPE_QUALIFIED", own
    assert own["private_owner_model_contribution"] == contribution
    assert own["private_owner_advice"] == advice
    assert own["actual_owner_decision_or_consent_created"] is False
    public_row = next(r for r in model.qualitative.trace
                      if r["action"] == "participation_status"
                      and r.get("evaluated_work") == "w3" and r["actor"] == "b")
    assert "private_owner_model_contribution" not in public_row
    assert "private_owner_advice" not in public_row


def test_future_fourth_work_cost_and_recipient_value_cannot_influence_prior_private_review():
    d = original_market_recipient_feedback_case()
    changed = deepcopy(d)
    for row in changed["economic_claims"]["resource_uses"]:
        if row["work"] == "w4":
            row["amount"] = "999.00"
    next(row for row in changed["economic_claims"]["recipient_use_value_evidence"]
         if row["work"] == "w4")["outcome"]["quantity"] = "999"
    old, _ = _private_recipient_review_at_original_event(d)
    new, _ = _private_recipient_review_at_original_event(changed)
    assert old == new
    assert new["private_owner_model_contribution"] == "450.00"


def test_buyer_revokes_original_value_source_before_review_without_erasing_result():
    d = original_market_recipient_feedback_case()
    event = next(e for e in d["events"] if e.get("evaluation_economic_recipient_value") is True)
    value = next(v for v in d["economic_claims"]["recipient_use_value_evidence"] if v["work"] == "w3")
    source = next(s for s in d["economic_claims"]["sources"] if s["id"] == value["outcome"]["source"])
    tick = event["at"] - 1
    assert not any(e["at"] == tick for e in d["events"])
    d["events"].append({
        "at": tick, "action": "source_update", "actor": "b",
        "source": source["reference"], "expected_revision": source["revision"],
        "new_revision": "withdrawn-value-v2", "status": "DISPROVED",
    })
    d["events"].sort(key=lambda e: e["at"])
    own, model = _private_recipient_review_at_original_event(d)
    assert own["status"] == "UNKNOWN"
    assert "private_owner_model_contribution" not in own
    assert model.qualitative.works["w3"].result == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert any(r["action"] == "source_update" and r["outcome"] == "APPLIED"
               for r in model.qualitative.trace)


@pytest.mark.parametrize("after_accept", [False, True])
def test_independent_supplier_revokes_commercial_quote_before_or_after_original_obligation(after_accept):
    d = original_market_order_finance_case(competing=True, buyer_finishes=True, commercial=True)
    d.pop("economic_claims")
    d.pop("strict_economic_source_works")
    proposal = next(e for e in d["events"] if e["action"] == "technology_route_propose")
    quote = next(q for q in proposal["technology_route_commercial_terms"]["offers"] if q["payee"] == "a")
    commit = next(e["at"] for e in d["events"] if e["action"] == "commit" and e.get("work") == "w3")
    request = next(e["at"] for e in d["events"] if e["action"] == "request" and e["work_spec"]["id"] == "w3")
    accept = next(e["at"] for e in d["events"] if e["action"] == "accept" and e.get("work") == "w3")
    used = {e["at"] for e in d["events"]}
    tick = accept+1 if after_accept else next(at for at in range(request+1, commit) if at not in used)
    assert tick not in used
    d["events"].append({
        "at": tick, "action": "source_update", "actor": "a",
        "source": quote["source_ref"], "expected_revision": quote["source_revision"],
        "new_revision": "withdrawn-original-quote-v2", "status": "DISPROVED",
    })
    d["events"].sort(key=lambda e: e["at"])
    out = simulate(d)
    assert last_request(out)["outcome"] == "APPLIED"
    assert any(r["action"] == "source_update" and r["outcome"] == "APPLIED" for r in out["trace"])
    decision = next(r for r in reports(out, "commit") if r["work"] == "w3")
    if after_accept:
        assert decision["outcome"] == "APPLIED"
        assert out["works"]["w3"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    else:
        assert decision["outcome"] == "BLOCKED"
        assert "COMMERCIAL" in decision["reason"]
        assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
