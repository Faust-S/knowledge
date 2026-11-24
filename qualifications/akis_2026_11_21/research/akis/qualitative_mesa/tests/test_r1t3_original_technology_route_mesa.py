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


def strict_original_technology_route_case():
    """Preserve original formation context and add exact independent KPB rights."""
    from .test_r1u4_strict_original_source_rights_mesa import _original_rights

    d = original_technology_route_case()
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


def original_market_complementarity_case(*, alternate=None, incomplete=False, source_stale=False):
    """One existing buyer demand and complementary offers, not a second market."""
    d = strict_original_technology_route_case()
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
