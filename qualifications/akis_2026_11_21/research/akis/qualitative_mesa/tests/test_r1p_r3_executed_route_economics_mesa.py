"""R1-P/R3 + R2/R4: the same full causal history and two executed routes.

All Work, preparation, capacity, original source rights, independent decisions
and Results are handled by the original Mesa. Financial evidence is attached
by the existing R2 experiment, not a second economic model.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.comparative_trajectories import (
    compare_executed_original_routes, TrajectoryComparisonError,
)
from research.akis.qualitative_mesa.three_period_original_work import (
    original_three_period_evidence,
)
from .test_r1u4_strict_original_source_rights_mesa import _original_rights, e
from .test_r3_three_period_original_owner_economics_mesa import (
    original_three_period_economic_case, _cash,
)
from .test_r4_original_outside_work_mesa import (
    original_outside_work_case, request_event, OUTSIDE, BUYER, QUALITY, ACCEPTED,
)
from .test_r4_original_buyer_offer_response_mesa import buyer_response_case
from .test_r2_executed_route_economics_mesa import paired_economics


def multiperiod_routes(*, cooperative_price="1200.00", outside_extra_ticks=0):
    d = original_three_period_economic_case()
    g = d["general_akis"]
    outside_template = original_outside_work_case("outside")
    d["subjects"].append({"id": BUYER, "kind": "SME"})
    d["capability_adoptions"][0]["authorized_future_works"].append(OUTSIDE)

    # One common OC remains in force for both paths. Its fixed responsibility
    # is the shared original producer; the original independent customers'
    # personal review and consent are still required for EACH Work.
    oc = {row["field"]: row["control"] for row in g["organizational_code"]}
    oc["С"]["subjects"].append(BUYER)
    oc["ИД"]["model_identified"].append(BUYER)
    customer_role = next(row for row in oc["Рол"]["role_bindings"]
                         if row["subject"] == "b")
    oc["Рол"]["role_bindings"].append(dict(deepcopy(customer_role), subject=BUYER))
    for row in oc["Отв"]["responsibilities"]:
        row["original_principals"] = [
            owner for owner in row["original_principals"] if owner == "a"
        ]
        assert row["original_principals"]

    for phase in (1, 2, 4, 7):
        original = next(row for row in g["formation_phases"]
                        if row["owner"] == "b" and row["phase"] == phase)
        g["formation_phases"].append(dict(
            deepcopy(original), owner=BUYER,
            source_ref=f"model://{BUYER}/formation-{phase}",
        ))
    personal = next(row for row in g["context_cores"] if row["core"] == "personal")
    g["context_cores"].append(dict(
        deepcopy(personal), owner=BUYER, recipient=BUYER,
        source_ref=f"model://{BUYER}/core-personal",
        basis_source="basis-personal-outside",
    ))
    context = d["context_evidence"]
    source = next(row for row in context["sources"] if row["id"] == "basis-personal")
    context["sources"].append(dict(
        deepcopy(source), id="basis-personal-outside", owner=BUYER, usable_by=[BUYER],
    ))
    context["sources"].extend(
        deepcopy(row) for row in outside_template["context_evidence"]["sources"]
        if "AKIS_EXTERNAL_DEMAND_EVIDENCE" in row.get("purposes", [])
    )
    packet = next(row for row in g["agent_functions"] if row["id"] == "approval-w3")
    g["agent_functions"].append(dict(
        deepcopy(packet), id="approval-outside", work=OUTSIDE,
        work_revision="outside-d1", source_ref="model://op/packet-approval-outside",
    ))
    req = next(row for row in d["events"] if row["action"] == "request"
               and row["work_spec"]["id"] == "w3")
    assert req["at"] == 83
    ext = deepcopy(request_event(outside_template))
    ext["at"] = 84
    ext["work_spec"]["resource_requirements"][0]["units"] = 2
    quality = deepcopy(ext["work_spec"]["assurance_criteria"][0])
    req["work_spec"]["assurance_criteria"] = [dict(
        quality, assessor="b", source_ref="model://b/w3-comparable-quality",
        source_revision="d-3",
    )]
    common = [deepcopy(row) for row in d["events"] if row["at"] <= 83]
    for row in outside_template["events"]:
        if row["action"] in (
            "outside_demand_signal", "outside_supplier_offer",
            "outside_buyer_offer_response",
        ):
            item = deepcopy(row)
            for key in ("outside_units", "outside_offer_units"):
                if key in item:
                    item[key] = 2
            common.append(item)
    common.append(ext)
    common.sort(key=lambda row: row["at"])

    cooperative = []
    external = []
    for old in d["events"]:
        if old["at"] <= 83:
            continue
        assert old.get("work") == "w3"
        row = deepcopy(old)
        row["at"] += 4
        if "prepared_at" in row:
            row["prepared_at"] += 4
        cooperative.append(row)
        if row["action"] == "interest_update":
            # The external buyer is not a member of l1. Its demand and
            # response, and later independent consent, remain original acts.
            continue
        other = dict(deepcopy(row), work=OUTSIDE)
        if other.get("source_revision") == "d-3":
            other["source_revision"] = "outside-d1"
        if other["action"] in ("consent", "function_review", "accept") and other["actor"] == "b":
            other["actor"] = BUYER
        if other["action"] == "formation_confirm":
            if other["phase"] in (1, 2) or other.get("formation_core") == "personal":
                other["actor"] = BUYER
                other["formation_source_ref"] = f"model://{BUYER}/formation-{other['phase']}"
                if other.get("formation_core") == "personal":
                    other["formation_basis_source"] = "basis-personal-outside"
        if other.get("function_id") == "approval-w3":
            other["function_id"] = "approval-outside"
        if "function_source_ref" in other:
            other["function_source_ref"] = "model://op/packet-approval-outside"
        if "review_source_ref" in other:
            other["review_source_ref"] = f"model://{BUYER}/independent-review-outside"
        if other["action"] == "complete":
            other["result_ref"] = "model://a/outside-original-result"
        external.append(other)

    for rows, work, buyer, revision in (
        (cooperative, "w3", "b", "d-3"),
        (external, OUTSIDE, BUYER, "outside-d1"),
    ):
        accept = next(row for row in rows if row["action"] == "accept")
        completion = next(row for row in rows if row["action"] == "complete")
        rows.append(e(
            accept["at"], "assess_result_quality", buyer, work=work,
            criterion=QUALITY, quality_verdict="MEETS_DECLARED_REQUIREMENT",
            quality_evidence_ref=f"model://{buyer}/{work}-inspection",
            result_ref=completion["result_ref"], source_revision=revision,
            org_revision="oc-1",
        ))
        accept["at"] += 1
        if work == OUTSIDE and outside_extra_ticks:
            for event in rows:
                if event["action"] in ("complete", "assess_result_quality", "accept"):
                    event["at"] += outside_extra_ticks
        rows.sort(key=lambda row: row["at"])
        assert accept["at"] < ext["work_spec"]["slot_end"]

    # Reuse R4's existing source-qualified owner outlook references. The
    # outside capacity probe is conservative; it must not invent owner rights.
    a, b = d["economic_outlooks"]
    prior = buyer_response_case()["economic_outlooks"][0]
    for key, value in prior.items():
        if key.startswith("outside_"):
            a[key] = deepcopy(value)
    a["outside_capacity_probe"]["units"] = 2
    a["cash"] = {
        "COOPERATION": _cash(member_supply_receipts=cooperative_price,
                             production_cash="450.00", operator_fee_cash="150.00"),
        "INDEPENDENT_ALTERNATIVE": _cash(external_sales="900.00",
                                         production_cash="450.00"),
    }
    # No comparable independently sourced alternative for the incumbent buyer.
    b["coverage"] = "PARTIAL"
    b["outside_feasibility"] = "UNKNOWN"

    # Add strict original event rights without replacing existing R1-I/P
    # core, code, learning, capability and owner economic source assertions.
    d["events"] = common + cooperative + external
    _original_rights(d)
    strict = d["context_evidence"]
    ids = {row["id"] for row in context["sources"]}
    assert not ids.intersection(row["id"] for row in strict["sources"])
    strict["sources"].extend(context["sources"])
    original_rules = {(row["work"], row["action"]) for row in context["requirements"]}
    strict["requirements"] = [
        row for row in strict["requirements"]
        if (row["work"], row["action"]) not in original_rules
    ] + context["requirements"]

    # Common rights are prepared for BOTH alternatives; there is only one
    # selected execution in each independently replayed original history.
    docs = {}
    for name, rows in (("cooperation", cooperative), ("outside", external)):
        doc = deepcopy(d)
        doc["events"] = sorted(deepcopy(common + rows), key=lambda row: row["at"])
        assert all(x["at"] < y["at"] for x, y in zip(doc["events"], doc["events"][1:]))
        docs[name] = doc
    return paired_economics(cooperative_price=cooperative_price, docs=docs)


def compare(docs):
    return compare_executed_original_routes(
        docs, cooperative_work="w3", outside_work=OUTSIDE, relation="l1",
        prior_works=("w1", "w2"), split_at=84,
    )


def without_finance(doc):
    doc = deepcopy(doc)
    doc.pop("economic_claims")
    doc.pop("strict_economic_source_work", None)
    doc.pop("strict_economic_source_works", None)
    return doc


def test_full_original_three_period_alternatives_and_economic_boundaries():
    docs = multiperiod_routes()
    assert "w3" not in docs["cooperation"]["cooperation_links"][0]["works"]
    for name, chosen in (("cooperation", "w3"), ("outside", OUTSIDE)):
        out = simulate(deepcopy(docs[name]))
        assert out["counts"]["blocked"] == 0, [
            (row["at"], row["action"], row["reason"]) for row in out["trace"]
            if row["outcome"] == "BLOCKED"
        ]
        assert all(out["works"][key]["result"] == ACCEPTED
                   for key in ("w1", "w2", chosen))
        assert any(row["action"] == "adopt_capability" and row["outcome"] == "APPLIED"
                   for row in out["trace"])
        assert any(row["action"] == "function_review" and row.get("work") == chosen
                   and row["outcome"] == "APPLIED" for row in out["trace"])
        if name == "cooperation":
            witness = original_three_period_evidence(out)
            assert witness["original_result_capability_cooperation_chain_witnessed"]
    report = compare(docs)
    assert report["status"] == "MODEL_EXECUTED_ROUTES_DECLARED_ECONOMIC_CONTRAST", report
    assert report["previous_original_results_preserved"]
    assert report["local_research_only"]["original_owner_contrasts"]["a"][
        "cash_cooperation_minus_outside"] == "150.00"
    assert report["local_research_only"]["boundary_and_cost_contrast"][
        "whole_subject_cash_cooperation_minus_outside"] == "-30.00"
    assert report["empirical_network_additionality"] == "NOT_IDENTIFIABLE"


@pytest.mark.parametrize("price,expected", [
    ("1050.00", "0.00"), ("900.00", "-150.00"),
])
def test_reversal_in_same_multiperiod_history(price, expected):
    report = compare(multiperiod_routes(cooperative_price=price))
    assert report["status"] == "MODEL_EXECUTED_ROUTES_DECLARED_ECONOMIC_CONTRAST"
    assert report["local_research_only"]["original_owner_contrasts"]["a"][
        "cash_cooperation_minus_outside"] == expected


def test_outside_buyer_cannot_bypass_own_human_review():
    d = without_finance(multiperiod_routes()["outside"])
    d["events"] = [
        row for row in d["events"]
        if not (row["action"] == "function_review" and row.get("work") == OUTSIDE)
    ]
    out = simulate(d)
    assert all(out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2"))
    assert out["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"
    commit = next(row for row in out["trace"]
                  if row["action"] == "commit" and row.get("work") == OUTSIDE)
    assert commit["outcome"] == "BLOCKED"


def test_external_order_cannot_borrow_adoption_limited_to_cooperation():
    d = without_finance(multiperiod_routes()["outside"])
    d["capability_adoptions"][0]["authorized_future_works"].remove(OUTSIDE)
    out = simulate(d)
    assert all(out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2"))
    assert out["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"


def test_declared_but_not_applied_dynamic_relation_is_not_matched():
    docs = multiperiod_routes()
    for d in docs.values():
        next(row for row in d["events"] if row["action"] == "request"
             and row["work_spec"]["id"] == "w3")["cooperation_link"] = "not-l1"
    with pytest.raises(TrajectoryComparisonError, match="FIXED_COOPERATION_BOUNDARY"):
        compare(docs)


def cumulative_routes(*, cooperative_price="1200.00", outside_extra_ticks=0):
    """Add actual prior Work-linked declarations to the SAME R2 ledger.

    No reset of the operator's or producer's cash at the third period.
    Both trajectories carry identical source declarations and cost anchors
    for w1 and w2; only the selected third Work's own records differ.
    """
    docs = multiperiod_routes(cooperative_price=cooperative_price,
                              outside_extra_ticks=outside_extra_ticks)
    for name, doc in docs.items():
        selected = doc.pop("strict_economic_source_work")
        doc["strict_economic_source_works"] = ["w1", "w2", selected]
        money = doc["economic_claims"]
        money["period"] = "THREE_ORIGINAL_WORK_PERIODS"
        context = doc["context_evidence"]["sources"]
        life = money["lifecycle_costs"]

        def evidence(owner, suffix, revision):
            ref = f"model://{owner}/{suffix}"
            context.append({
                "id": ref, "owner": owner, "revision": revision,
                "status": "CONFIRMED", "usable_by": [owner],
                "core": "operator" if owner == "op" else "corporate",
                "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
                "operations": ["READ"], "valid_from": 0, "valid_until": 160,
            })
            return ref

        for work, revision, purchase, materials, fee, overhead, labor in (
            ("w1", "d-1", "300.00", "180.00", "30.00", "20.00", "100.00"),
            ("w2", "d-2", "400.00", "230.00", "40.00", "25.00", "80.00"),
        ):
            clock = {row["action"]: row["at"] for row in doc["events"]
                     if row.get("work") == work}
            for key, payer, payee, amount, condition, at in (
                ("purchase", "b", "a", purchase,
                 "ON_CUSTOMER_ACCEPTANCE", clock["accept"] + 2),
                ("materials", "a", "EXTERNAL", materials,
                 "ON_ORIGINAL_COMMIT", clock["commit"] + 1),
                ("fee", "a", "op", fee,
                 "ON_ORIGINAL_COMMIT", clock["commit"] + 2),
                ("overhead", "op", "EXTERNAL", overhead,
                 "ON_ORIGINAL_COMMIT", clock["commit"] + 3),
            ):
                ident = f"{work}-{key}"
                parties = sorted({payer, payee} - {"EXTERNAL"})
                witnesses = {owner: f"terms-{owner}" for owner in parties}
                money["transfers"].append({
                    "id": ident, "scenario": "COOPERATION", "payer": payer,
                    "payee": payee, "amount": amount,
                    "source": f"terms-{payer}", "work": work,
                })
                money["cash_timing"]["transfer_windows"].append({
                    "transfer_id": ident, "at": at, "late_at": at,
                    "owner_sources": deepcopy(witnesses),
                })
                money["work_payment_conditions"].append({
                    "transfer_id": ident, "condition": condition,
                    "due_at": at + 1, "work_source_revision": revision,
                    "org_revision": "oc-1", "owner_sources": deepcopy(witnesses),
                })
                if key == "purchase":
                    refs = {owner: evidence(owner, f"{work}-purchase-receipt", "v1")
                            for owner in parties}
                    money["work_payment_settlement_claims"].append({
                        "id": f"{work}-settlement", "transfer_id": ident,
                        "at": at, "amount": amount,
                        "owner_sources": {owner: f"receipt-{owner}" for owner in parties},
                        "evidence_refs": refs,
                        "evidence_revisions": {owner: "v1" for owner in parties},
                        "owner_attestations": {
                            owner: {"reported_at": at, "reported_amount": amount}
                            for owner in parties
                        },
                    })
            for key, owner, amount, bucket, stage, nature, action in (
                ("labor", "a", labor, "DELIVERY", "PRODUCTION_COORDINATION",
                 "DIRECT_RESOURCE", "start"),
                ("coordination", "op", "15.00", "COORDINATION",
                 "PRODUCTION_COORDINATION", "TRANSACTION", "commit"),
            ):
                ident = f"{work}-{key}"
                pos, event = next((i, row) for i, row in enumerate(doc["events"])
                                  if row.get("work") == work and row["action"] == action
                                  and row["actor"] == owner)
                ref = evidence(owner, f"{work}-{key}-cost", "v1")
                money["resource_uses"].append({
                    "id": ident, "scenario": "COOPERATION", "work": work,
                    "owner": owner, "source": f"terms-{owner}", "amount": amount,
                    "bucket": bucket,
                })
                life["bindings"].append({
                    "resource_use_id": ident, "owner": owner,
                    "source": f"terms-{owner}", "stage": stage, "nature": nature,
                })
                life["event_bindings"].append({
                    "resource_use_id": ident, "work": work, "owner": owner,
                    "source": f"terms-{owner}", "work_source_revision": revision,
                    "trace_position": pos, "at": event["at"], "action": action,
                    "org_revision": "oc-1", "cost_evidence_ref": ref,
                    "cost_evidence_revision": "v1",
                })
    return docs


def test_three_period_cash_carries_forward_with_original_work_and_cost_evidence():
    docs = cumulative_routes()
    frozen = deepcopy(docs)
    report = compare(docs)
    assert docs == frozen
    assert report["status"] == "MODEL_EXECUTED_ROUTES_DECLARED_ECONOMIC_CONTRAST", report
    assert report["prior_economic_history_same_in_both_runs"]
    assert all(row["source_matched_full_transfer_count"] == 3
               for row in report["routes"].values())
    private = report["local_research_only"]
    assert private["boundary_projections"]["cooperation"][
        "whole_original_subject_boundary_net_cash"] == "-955.00"
    assert private["boundary_projections"]["outside"][
        "whole_original_subject_boundary_net_cash"] == "-925.00"
    assert private["original_owner_projections"]["cooperation"]["a"][
        "declared_net_cash"] == "820.00"
    assert private["original_owner_projections"]["cooperation"]["op"][
        "declared_net_cash"] == "125.00"
    assert private["original_owner_contrasts"]["a"][
        "cash_cooperation_minus_outside"] == "150.00"
    assert private["boundary_and_cost_contrast"][
        "whole_subject_cash_cooperation_minus_outside"] == "-30.00"
    assert private["boundary_and_cost_contrast"][
        "whole_transaction_noncash_outside_minus_cooperation"] == "30.00"
    assert report["empirical_network_additionality"] == "NOT_IDENTIFIABLE"


@pytest.mark.parametrize("field", ["transfers", "resource_uses"])
def test_prior_cash_or_resource_history_cannot_change_between_arms(field):
    docs = cumulative_routes()
    row = next(row for row in docs["outside"]["economic_claims"][field]
               if row["work"] == "w1")
    row["amount"] = "999.00"
    with pytest.raises(TrajectoryComparisonError, match="PRIOR_FINANCIAL_HISTORY_CHANGED"):
        compare(docs)


def test_prior_payment_window_cannot_move_after_the_controlled_prefix():
    docs = cumulative_routes()
    for doc in docs.values():
        row = next(row for row in doc["economic_claims"]["cash_timing"]["transfer_windows"]
                   if row["transfer_id"] == "w1-purchase")
        row["late_at"] = 100
    with pytest.raises(TrajectoryComparisonError, match="PRIOR_EVIDENCE_AFTER_SPLIT"):
        compare(docs)


def test_prior_cost_source_revocation_does_not_leak_through_multiwork_review():
    docs = cumulative_routes()
    from research.akis.qualitative_mesa.rules import InputError
    doc = docs["cooperation"]
    doc["events"].append(e(125, "source_update", "a",
                           source="model://a/w1-labor-cost", status="UNKNOWN"))
    doc["events"].sort(key=lambda row: row["at"])
    with pytest.raises(InputError, match="ORIGINAL_ECONOMIC_COST_SOURCE_NOT_USABLE"):
        simulate(doc)
    out = simulate(without_finance(doc))
    assert all(out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2", "w3"))


@pytest.mark.parametrize("price,position", [
    ("1200.00", "COOPERATION_PREFERRED"),
    ("1050.00", "UNKNOWN"),
    ("900.00", "OUTSIDE_PREFERRED"),
])
def test_original_external_request_enables_only_current_owner_scoped_capacity_preview(price, position):
    doc = without_finance(multiperiod_routes(cooperative_price=price)["cooperation"])
    out = simulate(doc)
    choices = [
        row for row in out["decision_observations"]
        if row.get("work") == "w3" and row.get("subject") == "a"
        and row.get("at") == 84 and row.get("trigger") == "request"
    ]
    assert len(choices) == 1, choices
    assert choices[0]["economic_position"] == position, choices
    assert out["works"]["w3"]["result"] == ACCEPTED
    assert out["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"
    assert not any(row["work"] == OUTSIDE for row in out["capacity"]["reservations"])


def test_profitable_outlook_cannot_override_independent_original_owner_refusal():
    doc = without_finance(multiperiod_routes()["cooperation"])
    next(row for row in doc["events"] if row["action"] == "interest_update"
         and row.get("work") == "w3" and row["actor"] == "a")["new_willingness"] = "DECLINES"
    out = simulate(doc)
    assert any(row.get("subject") == "a" and row.get("work") == "w3"
               and row.get("economic_position") == "COOPERATION_PREFERRED"
               for row in out["decision_observations"])
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    assert out["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"
    assert all(out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2"))


def fourth_period_case(*, pause=False, early=False, stale=False, cost_shock=False):
    """A fourth original Work follows independently reviewed third Result.

    Financial source review is attached to each existing participation_status,
    not to an automatic decision or a new finance/event registry.
    """
    d = (adverse_execution_cost_routes() if cost_shock else
         cumulative_routes())["cooperation"]
    g = d["general_akis"]
    prior_request = next(row for row in d["events"]
                         if row["action"] == "request" and row["work_spec"]["id"] == "w3")
    acceptance = next(row["at"] for row in d["events"]
                      if row["action"] == "accept" and row.get("work") == "w3")
    result_ref = next(row["result_ref"] for row in d["events"]
                      if row["action"] == "complete" and row.get("work") == "w3")
    request_at = acceptance + 13
    shift = request_at - prior_request["at"]
    new_spec = deepcopy(prior_request["work_spec"])
    new_spec.update(
        id="w4", source_revision="d-4",
        slot_start=new_spec["slot_start"] + shift,
        slot_end=new_spec["slot_end"] + shift,
        requires_accepted=["w3"],
        resource_requirements=[{"resource": "ra", "units": 1}],
    )
    for quality in new_spec["assurance_criteria"]:
        quality.update(source_ref="model://b/w4-quality", source_revision="d-4")
    d["model_horizon"] = 180
    d["economic_claims"]["cash_timing"]["horizon_end"] = 180
    for category in ("goals", "formation_phases", "context_cores",
                     "agent_functions", "organizational_code"):
        for row in g[category]:
            if row["expires_at"] >= 160:
                row["expires_at"] = 200
    context = d["context_evidence"]
    for row in context["sources"]:
        if row.get("valid_until", 0) >= 160:
            row["valid_until"] = 200
    template = next(row for row in g["agent_functions"] if row["id"] == "approval-w3")
    g["agent_functions"].append(dict(
        deepcopy(template), id="approval-w4", work="w4", work_revision="d-4",
        source_ref="model://op/packet-approval-w4",
    ))
    following = []
    for owner, when in (
        ("a", acceptance + (1 if early else 6)),
        ("b", acceptance + 7),
    ):
        source = f"model://{owner}/review-third-original-work-finance"
        context["sources"].append({
            "id": source, "owner": owner, "revision": "review-v1",
            "status": "CONFIRMED", "usable_by": [owner],
            "core": "corporate", "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
            "operations": ["READ"], "valid_from": acceptance + 1, "valid_until": 200,
        })
        following.append(e(
            when, "participation_status", owner, org_revision="oc-1",
            cooperation_link="l1", cooperation_source_revision="rel-1",
            new_participation=("PAUSED_NEW_WORK" if pause and owner == "a"
                               else "OPEN_TO_NEW_WORK"),
            economic_channel="TRANSACTION_COST", participation_evidence_ref=source,
            evaluated_work="w3", evaluated_work_revision="d-3",
            evaluated_result_ref=result_ref, evaluated_decision_at=acceptance,
            evaluation_verdict=("ADVERSE_DECLARED" if pause and owner == "a"
                                else "FAVOURABLE_DECLARED"),
            formation_phase_source_ref=f"model://{owner}/formation-8",
            evaluation_economic_source_revision=(
                "stale" if stale and owner == "a" else "review-v1"
            ),
        ))
    following.append(e(
        acceptance + 8, "need_emerge", "b", work="w4",
        work_source_revision="d-4", org_revision="oc-1",
        goal_source_ref="model://b/goal-after-third-result",
        goal_expires_at=200, goal_objective="RESILIENCE", goal_priority=2,
        cooperation_link="l1", cooperation_source_revision="rel-1",
        pilot_work="w3", pilot_result_ref=result_ref, pilot_decision_at=acceptance,
    ))
    following.append(e(
        acceptance + 9, "cooperation_change_propose", "a",
        org_revision="oc-1", cooperation_link="l1",
        cooperation_source_revision="rel-1", change_id="chg-w3",
        change_kind="REVISE_RESOURCE_COOPERATION",
        economic_channel="TRANSACTION_COST",
        change_source_ref="model://a/change-after-third-original-result",
        pilot_work="w3", pilot_result_ref=result_ref, pilot_decision_at=acceptance,
    ))
    for i, owner in enumerate(("a", "b", "op"), 10):
        following.append(e(
            acceptance + i, "cooperation_change_response", owner,
            org_revision="oc-1", cooperation_link="l1",
            cooperation_source_revision="rel-1", change_id="chg-w3",
            change_decision="SUPPORT_MODEL_PROPOSAL",
            change_source_ref=f"model://{owner}/review-chg-w3",
        ))
    following.append(e(
        request_at, "request", "b", work_spec=new_spec,
        cooperation_link="l1", cooperation_source_revision="rel-1",
        pilot_work="w3", change_id="chg-w3",
        emergent_goal_source_ref="model://b/goal-after-third-result",
    ))
    for old in d["events"]:
        if old.get("work") != "w3" or old["at"] <= prior_request["at"]:
            continue
        row = dict(deepcopy(old), work="w4", at=old["at"]+shift)
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
        if row["action"] in ("complete", "assess_result_quality"):
            row["result_ref"] = "model://w4-result"
        if row["action"] == "assess_result_quality":
            row["quality_evidence_ref"] = "model://b/w4-inspection"
        if row["action"] == "interest_update":
            row.update(
                pilot_work="w3", pilot_result_ref=result_ref,
                pilot_decision_at=acceptance, interest_valid_until=200,
                interest_evidence_ref=f"model://{row['actor']}/w4-independent-interest",
            )
        following.append(row)
    following.sort(key=lambda row: row["at"])
    assert len({row["at"] for row in following}) == len(following)
    more = {"events": following}
    _original_rights(more)
    strict = more["context_evidence"]
    for field in ("sources", "requirements", "decision_requirements"):
        context[field].extend(strict[field])
    d["events"].extend(following)
    d["events"].sort(key=lambda row: row["at"])
    return d


def third_period_reviews(out):
    return [row for row in out["trace"]
            if row.get("action") == "participation_status"
            and row.get("evaluated_work") == "w3"
            and row.get("outcome") == "APPLIED"]


def test_original_financial_review_and_independent_decision_reproduce_fourth_work():
    d = fourth_period_case()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (row["at"], row["action"], row["reason"]) for row in out["trace"]
        if row["outcome"] == "BLOCKED"
    ]
    assert all(out["works"][key]["result"] == ACCEPTED
               for key in ("w1", "w2", "w3", "w4"))
    reviews = third_period_reviews(out)
    assert len(reviews) == 2
    assert all(row["evaluation_economic_basis_status"] ==
               "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
               for row in reviews)
    assert all(row["evaluation_financial_basis_not_automatic_owner_decision"]
               and row["evaluation_private_financial_values_not_redisclosed"]
               for row in reviews)
    assert out["profit"]["system_increment"] == "UNKNOWN"
    assert out == simulate(deepcopy(d))


def test_same_qualified_finance_can_lead_to_independent_pause_not_automatic_consent():
    open_case, pause_case = fourth_period_case(), fourth_period_case(pause=True)
    assert open_case["economic_claims"] == pause_case["economic_claims"]
    continued, stopped = simulate(open_case), simulate(pause_case)
    for key in ("w1", "w2", "w3"):
        assert continued["works"][key] == stopped["works"][key]
    owner_review = next(row for row in third_period_reviews(stopped) if row["actor"] == "a")
    assert owner_review["evaluation_economic_basis_status"] == (
        "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
    )
    assert owner_review["participation_value"] == "PAUSED_NEW_WORK"
    assert continued["works"]["w4"]["result"] == ACCEPTED
    assert "w4" not in stopped["works"]
    request = next(row for row in stopped["trace"]
                   if row["action"] == "request" and row.get("work") == "w4")
    assert request["outcome"] == "BLOCKED"


def test_current_owner_economic_review_does_not_read_future_payment_evidence():
    d = fourth_period_case(early=True)
    claims = d["economic_claims"]["work_payment_settlement_claims"]
    sources = {row["id"]: row for row in d["context_evidence"]["sources"]}
    for claim in claims:
        if claim["transfer_id"] != "purchase":
            continue
        for ref in claim["evidence_refs"].values():
            sources[ref]["valid_from"] = claim["at"]
    out = simulate(d)
    early = next(row for row in third_period_reviews(out) if row["actor"] == "a")
    assert any(claim["transfer_id"] == "purchase" and claim["at"] > early["at"]
               for claim in claims)
    assert early["evaluation_economic_basis_status"] == (
        "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
    )
    assert out["works"]["w4"]["result"] == ACCEPTED


def test_stale_owner_review_source_is_unknown_not_an_override_of_own_choice():
    out = simulate(fourth_period_case(stale=True, pause=True))
    review = next(row for row in third_period_reviews(out) if row["actor"] == "a")
    assert review["evaluation_economic_basis_status"] == "UNKNOWN"
    assert review["participation_value"] == "PAUSED_NEW_WORK"
    assert "w4" not in out["works"]
    assert all(out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2", "w3"))


def test_cash_history_changes_reserve_risk_not_third_period_cash_advantage():
    isolated = compare(multiperiod_routes())
    cumulative = compare(cumulative_routes())
    def status(report):
        return report["local_research_only"]["original_owner_projections"][
            "cooperation"]["op"]["late_receipt_liquidity"]
    assert status(isolated) == "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    assert status(cumulative) == "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    assert isolated["local_research_only"]["original_owner_contrasts"]["a"] == (
        cumulative["local_research_only"]["original_owner_contrasts"]["a"]
    )
    docs = cumulative_routes()
    for doc in docs.values():
        next(row for row in doc["economic_claims"]["transfers"]
             if row["id"] == "w2-overhead")["amount"] = "55.00"
    stressed = compare(docs)
    assert status(stressed) == "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    assert stressed["local_research_only"]["original_owner_contrasts"]["op"][
        "cash_cooperation_minus_outside"] == "120.00"


def test_longer_executed_outside_duration_remains_separate_from_cash_and_noncash():
    report = compare(cumulative_routes(outside_extra_ticks=2))
    assert report["status"] == "MODEL_EXECUTED_ROUTES_DECLARED_ECONOMIC_CONTRAST"
    assert report["routes"]["cooperation"]["execution_model_ticks"] == 1
    assert report["routes"]["outside"]["execution_model_ticks"] == 3
    assert report["local_research_only"]["original_owner_contrasts"]["a"][
        "cash_cooperation_minus_outside"] == "150.00"
    assert report["empirical_network_additionality"] == "NOT_IDENTIFIABLE"


def test_measurement_inside_uncertainty_cannot_grant_either_route_future_capacity():
    docs = cumulative_routes()
    for doc in docs.values():
        d = without_finance(doc)
        d["competence_reuse_evidence"][0]["subsequent_observation"]["value"] = "9.8000"
        out = simulate(d)
        adoption = next(row for row in out["trace"] if row["action"] == "adopt_capability")
        assert adoption["outcome"] == "BLOCKED"
        assert all(out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2"))
        assert all(out["works"].get(key, {}).get("result") != ACCEPTED
                   for key in ("w3", OUTSIDE))


def adverse_execution_cost_routes():
    """Hold the original offer-time forecast fixed; change own cost evidence."""
    docs = cumulative_routes()
    money = docs["cooperation"]["economic_claims"]
    next(row for row in money["transfers"] if row["id"] == "materials")[
        "amount"
    ] = "700.00"
    next(row for row in money["resource_uses"]
         if row["id"] == "cooperation-negotiation")["amount"] = "100.00"
    return docs


def delayed_receipt_routes(*, on_time=False):
    docs = cumulative_routes()
    for doc in docs.values():
        next(row for row in doc["economic_claims"]["transfers"]
             if row["id"] == "w2-overhead")["amount"] = "55.00"
    if on_time:
        row = next(row for row in docs["cooperation"]["economic_claims"][
            "cash_timing"]["transfer_windows"] if row["transfer_id"] == "operator-fee")
        row["late_at"] = row["at"]
    return docs


def test_original_execution_cost_shock_reverses_declared_advantage_not_prior_forecast():
    base, changed = cumulative_routes(), adverse_execution_cost_routes()
    assert base["cooperation"]["economic_outlooks"] == changed["cooperation"]["economic_outlooks"]
    report = compare(changed)
    assert report["status"] == "MODEL_EXECUTED_ROUTES_DECLARED_ECONOMIC_CONTRAST"
    private = report["local_research_only"]
    assert private["original_owner_contrasts"]["a"]["cash_cooperation_minus_outside"] == "-100.00"
    assert private["boundary_and_cost_contrast"][
        "whole_subject_cash_cooperation_minus_outside"] == "-280.00"
    assert private["boundary_and_cost_contrast"][
        "whole_transaction_noncash_outside_minus_cooperation"] == "-30.00"
    out = simulate(changed["cooperation"])
    assert any(row.get("economic_position") == "COOPERATION_PREFERRED"
               and row.get("subject") == "a" and row.get("at") == 84
               for row in out["decision_observations"])
    assert out["works"]["w3"]["result"] == ACCEPTED
    # The next decision is the owner's explicit source-scoped evaluation,
    # never a new automatic signature based on the changed arithmetic.
    stopped = simulate(fourth_period_case(pause=True, cost_shock=True))
    review = next(row for row in third_period_reviews(stopped) if row["actor"] == "a")
    assert review["evaluation_economic_basis_status"] == (
        "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
    )
    assert review["participation_value"] == "PAUSED_NEW_WORK"
    assert "w4" not in stopped["works"]


def test_declared_delay_alone_changes_operator_reserve_without_changing_net_cash():
    late = compare(delayed_receipt_routes())
    on_time = compare(delayed_receipt_routes(on_time=True))
    a, b = late["local_research_only"], on_time["local_research_only"]
    assert a["original_owner_contrasts"] == b["original_owner_contrasts"]
    assert a["boundary_and_cost_contrast"] == b["boundary_and_cost_contrast"]
    def reserve(private):
        return private["original_owner_projections"]["cooperation"]["op"][
            "late_receipt_liquidity"]
    assert reserve(a) == "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    assert reserve(b) == "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"


def test_unqualified_third_period_cost_anchor_keeps_owner_review_unknown():
    d = fourth_period_case(pause=True)
    life = d["economic_claims"]["lifecycle_costs"]
    life["event_bindings"] = [
        row for row in life["event_bindings"]
        if row["resource_use_id"] != "cooperation-negotiation"
    ]
    out = simulate(d)
    reviews = third_period_reviews(out)
    assert len(reviews) == 2
    assert all(row["evaluation_economic_basis_status"] == "UNKNOWN" for row in reviews)
    assert "w4" not in out["works"]
    assert all(out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2", "w3"))


def outside_then_reenter_case(*, stay_paused=False, wrong_basis=None):
    """External execution informs a member, not the incumbent buyer's rights."""
    d = cumulative_routes()["outside"]
    continuation = fourth_period_case()
    # Same original formations and rights, but the selected third Work is
    # the independently executed outside Work, not the uncommitted w3.
    d["general_akis"] = deepcopy(continuation["general_akis"])
    d["model_horizon"] = continuation["model_horizon"]
    d["economic_claims"]["cash_timing"]["horizon_end"] = d["model_horizon"]
    context = d["context_evidence"]
    # Extend model observation horizon, keeping every original source owner.
    for row in context["sources"]:
        if row.get("valid_until", 0) >= 160:
            row["valid_until"] = 200
    other = continuation["context_evidence"]
    ids = {row["id"] for row in context["sources"]}
    context["sources"].extend(deepcopy(row) for row in other["sources"]
                              if row["id"] not in ids)
    for field in ("requirements", "decision_requirements"):
        context[field].extend(deepcopy(row) for row in other[field]
                              if row not in context[field])
    def original_result(doc, work):
        ref = next(row["result_ref"] for row in doc["events"]
                   if row["action"] == "complete" and row.get("work") == work)
        at = next(row["at"] for row in doc["events"]
                  if row["action"] == "accept" and row.get("work") == work)
        return ref, at
    old_ref, old_at = original_result(d, "w2")
    ext_ref, ext_at = original_result(d, OUTSIDE)
    _, coop_at = original_result(continuation, "w3")
    assert ext_at == coop_at
    tail = [deepcopy(row) for row in continuation["events"] if row["at"] > coop_at]
    # The original relation's latest ACCEPTED pilot remains w2. The
    # incumbent buyer must assess its OWN w2, not the external buyer's result.
    for row in tail:
        if row.get("evaluated_work") == "w3":
            row.update(evaluated_work="w2", evaluated_work_revision="d-2",
                       evaluated_result_ref=old_ref, evaluated_decision_at=old_at)
            if row["actor"] == "a":
                row["evaluation_economic_outside_basis"] = {
                    "work": OUTSIDE, "source_revision": "outside-d1",
                    "result_ref": ext_ref, "accepted_at": ext_at,
                }
                if wrong_basis is not None:
                    row["evaluation_economic_outside_basis"].update(wrong_basis)
                if stay_paused:
                    row["new_participation"] = "PAUSED_NEW_WORK"
                    row["evaluation_verdict"] = "ADVERSE_DECLARED"
        if row.get("pilot_work") == "w3":
            row.update(pilot_work="w2", pilot_result_ref=old_ref,
                       pilot_decision_at=old_at)
        if row["action"] == "request":
            row["work_spec"]["requires_accepted"] = ["w2"]
    # Independent pause of relation l1 before outside commitment. This
    # must not cancel any of w1/w2 or the outside buyer's own commitment.
    prior = next(row for row in d["events"]
                 if row["action"] == "participation_status"
                 and row["actor"] == "a" and row.get("evaluated_work") == "w2")
    pause_at = 85
    assert pause_at not in {row["at"] for row in d["events"]}
    pause = dict(deepcopy(prior), at=pause_at,
                 new_participation="PAUSED_NEW_WORK",
                 evaluation_verdict="ADVERSE_DECLARED")
    # Reuse the already-qualified original owner source rights; they
    # authorize the event kind and work scope, not the owner's actual choice.
    d["events"].extend([pause, *tail])
    d["events"].sort(key=lambda row: row["at"])
    assert len({row["at"] for row in d["events"]}) == len(d["events"])
    # Fixture declarations bind to the exact original event index. The
    # new pause is itself an original event, so construct cost anchors
    # against this scenario's final declared sequence (never repair a
    # mismatch in the executing model or its historical trace).
    for binding in d["economic_claims"]["lifecycle_costs"]["event_bindings"]:
        binding["trace_position"] = next(
            index for index, row in enumerate(d["events"])
            if row["at"] == binding["at"] and row.get("work") == binding["work"]
            and row["action"] == binding["action"] and row["actor"] == binding["owner"]
        )
    return d


def test_original_external_result_informs_independent_reentry_and_fourth_work():
    d = outside_then_reenter_case()
    out = simulate(d)
    assert out["counts"]["blocked"] == 0, [
        (row["at"], row["action"], row["reason"]) for row in out["trace"]
        if row["outcome"] == "BLOCKED"]
    assert all(out["works"][key]["result"] == ACCEPTED
               for key in ("w1", "w2", OUTSIDE, "w4"))
    assert out["works"]["w3"]["obligation"] == "NOT_ACCEPTED"
    review = next(row for row in out["trace"]
                  if row.get("evaluation_economic_basis_kind") == "OWN_EXECUTED_OUTSIDE_ALTERNATIVE")
    assert review["evaluation_economic_basis_status"] == "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
    assert review["evaluation_economic_basis_work"] == OUTSIDE
    assert review["evaluated_work"] == "w2"
    assert review["participation_value"] == "OPEN_TO_NEW_WORK"
    assert review["evaluation_financial_basis_not_automatic_owner_decision"]
    assert out["works"]["w4"]["original_customer"] == "b"


@pytest.mark.parametrize("wrong_basis", [
    None, {"source_revision": "stale"}, {"accepted_at": 999},
    {"work": "w3"}, {"result_ref": "model://a/wrong-result"},
])
def test_own_outside_result_does_not_override_independent_pause_or_fake_basis(wrong_basis):
    d = outside_then_reenter_case(stay_paused=True, wrong_basis=wrong_basis)
    out = simulate(d)
    assert all(out["works"][key]["result"] == ACCEPTED
               for key in ("w1", "w2", OUTSIDE))
    assert "w4" not in out["works"]
    review = next(row for row in out["trace"]
                  if row.get("evaluation_economic_basis_kind") == "OWN_EXECUTED_OUTSIDE_ALTERNATIVE")
    assert review["evaluation_economic_basis_status"] == (
        "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
        if wrong_basis is None else "UNKNOWN")
    assert review["participation_value"] == "PAUSED_NEW_WORK"
    if wrong_basis is not None:
        assert "evaluation_economic_basis_work" not in review


def test_incumbent_buyer_cannot_claim_the_external_suppliers_result_as_own_evidence():
    d = outside_then_reenter_case(stay_paused=True)
    reviews = [row for row in d["events"] if row["action"] == "participation_status"
               and "evaluation_economic_source_revision" in row]
    a = next(row for row in reviews if row["actor"] == "a")
    b = next(row for row in reviews if row["actor"] == "b")
    b["evaluation_economic_outside_basis"] = deepcopy(a["evaluation_economic_outside_basis"])
    out = simulate(d)
    own, other = [
        next(row for row in out["trace"] if row.get("evaluation_economic_basis_kind") ==
             "OWN_EXECUTED_OUTSIDE_ALTERNATIVE" and row["actor"] == owner)
        for owner in ("a", "b")
    ]
    assert own["evaluation_economic_basis_status"] == "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
    assert other["evaluation_economic_basis_status"] == "UNKNOWN"
    assert "evaluation_economic_basis_work" not in other
    assert all(out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2", OUTSIDE))
    assert "w4" not in out["works"]


def test_external_basis_needs_current_independent_review_source_not_historical_consent():
    d = outside_then_reenter_case(stay_paused=True)
    review = next(row for row in d["events"]
                  if "evaluation_economic_outside_basis" in row)
    review["evaluation_economic_source_revision"] = "stale"
    out = simulate(d)
    qualified = next(row for row in out["trace"]
                     if row.get("evaluation_economic_basis_kind") == "OWN_EXECUTED_OUTSIDE_ALTERNATIVE")
    assert qualified["evaluation_economic_basis_status"] == "UNKNOWN"
    assert qualified["participation_value"] == "PAUSED_NEW_WORK"
    assert out["works"][OUTSIDE]["result"] == ACCEPTED
    assert "w4" not in out["works"]


def fourth_period_finance_case(*, pause=False, material="220.00", missing_opening=False,
                               early=False, stale=False):
    """Extend the one original ledger with a genuinely requested fourth Work.

    Each fourth-period term/cost/report has an owner-held source that first
    becomes usable in the fourth period. The prior review selects only its
    already committed original portfolio and cannot use these future rows.
    """
    d = fourth_period_case(pause=pause, early=early, stale=stale)
    money = d["economic_claims"]
    for row in d["events"]:
        if row["action"] == "participation_status" and row.get("evaluated_work") == "w3":
            row["evaluation_economic_portfolio"] = True
    if missing_opening:
        money["cash_timing"]["owner_positions"] = [
            row for row in money["cash_timing"]["owner_positions"] if row["owner"] != "a"]
    if pause:
        return d
    request = next(row["at"] for row in d["events"] if row["action"] == "request"
                   and row["work_spec"]["id"] == "w4")
    clock = {row["action"]: row["at"] for row in d["events"] if row.get("work") == "w4"}
    money["period"] = "FOUR_ORIGINAL_WORK_PERIODS"
    d["strict_economic_source_works"].append("w4")
    scope = ("a", "b", "op")

    def source(owner, suffix, since, key=None):
        ref = f"model://{owner}/w4-{suffix}"
        d["context_evidence"]["sources"].append({
            "id": ref, "owner": owner, "revision": "v4", "status": "CONFIRMED",
            "usable_by": [owner], "core": "operator" if owner == "op" else "corporate",
            "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
            "valid_from": since, "valid_until": 200,
        })
        if key:
            money["sources"].append({"id": key, "owner": owner, "reference": ref, "revision": "v4"})
        return ref

    for owner in scope:
        source(owner, "financial-terms", request, key=f"w4-terms-{owner}")
    for owner in ("a", "b"):
        source(owner, "payment-terms", request, key=f"w4-receipt-{owner}")
    for key, payer, payee, amount, condition, at in (
        ("purchase", "b", "a", "600.00", "ON_CUSTOMER_ACCEPTANCE", clock["accept"]+2),
        ("materials", "a", "EXTERNAL", material, "ON_ORIGINAL_COMMIT", clock["commit"]+1),
        ("fee", "a", "op", "80.00", "ON_ORIGINAL_COMMIT", clock["commit"]+2),
        ("overhead", "op", "EXTERNAL", "35.00", "ON_ORIGINAL_COMMIT", clock["commit"]+3),
    ):
        ident = f"w4-{key}"
        witnesses = {owner: f"w4-terms-{owner}" for owner in sorted({payer, payee} - {"EXTERNAL"})}
        money["transfers"].append({
            "id": ident, "scenario": "COOPERATION", "payer": payer,
            "payee": payee, "amount": amount, "source": witnesses[payer], "work": "w4",
        })
        money["cash_timing"]["transfer_windows"].append({
            "transfer_id": ident, "at": at, "late_at": at, "owner_sources": deepcopy(witnesses),
        })
        money["work_payment_conditions"].append({
            "transfer_id": ident, "condition": condition, "due_at": at+1,
            "work_source_revision": "d-4", "org_revision": "oc-1", "owner_sources": deepcopy(witnesses),
        })
        if key == "purchase":
            for i, piece in enumerate(("250.00", "350.00")):
                tick = clock["accept"]+1+i
                refs = {owner: source(owner, f"receipt-{i}", tick) for owner in ("a", "b")}
                money["work_payment_settlement_claims"].append({
                    "id": f"w4-payment-{i}", "transfer_id": ident, "at": tick, "amount": piece,
                    "owner_sources": {owner: f"w4-receipt-{owner}" for owner in ("a", "b")},
                    "evidence_refs": refs, "evidence_revisions": {"a": "v4", "b": "v4"},
                    "owner_attestations": {owner: {"reported_at": tick, "reported_amount": piece}
                                           for owner in ("a", "b")},
                })
    life = money["lifecycle_costs"]
    for key, owner, amount, bucket, stage, nature, action in (
        ("labor", "a", "90.00", "DELIVERY", "PRODUCTION_COORDINATION", "DIRECT_RESOURCE", "start"),
        ("inspection", "b", "25.00", "COORDINATION", "MONITORING_AND_QUALITY", "TRANSACTION", "assess_result_quality"),
        ("coordination", "op", "20.00", "COORDINATION", "PRODUCTION_COORDINATION", "TRANSACTION", "commit"),
    ):
        ident = f"w4-{key}"
        pos, ev = next((i, row) for i, row in enumerate(d["events"])
                       if row.get("work") == "w4" and row["action"] == action and row["actor"] == owner)
        proof = source(owner, f"{key}-evidence", ev["at"])
        money["resource_uses"].append({
            "id": ident, "scenario": "COOPERATION", "work": "w4", "owner": owner,
            "amount": amount, "bucket": bucket, "source": f"w4-terms-{owner}",
        })
        life["bindings"].append({
            "resource_use_id": ident, "owner": owner, "source": f"w4-terms-{owner}",
            "stage": stage, "nature": nature,
        })
        life["event_bindings"].append({
            "resource_use_id": ident, "work": "w4", "owner": owner, "source": f"w4-terms-{owner}",
            "work_source_revision": "d-4", "trace_position": pos, "at": ev["at"],
            "action": action, "org_revision": "oc-1", "cost_evidence_ref": proof,
            "cost_evidence_revision": "v4",
        })
    return d


def test_original_fourth_work_own_finance_and_cumulative_cash_without_reset():
    doc = fourth_period_finance_case()
    out = simulate(doc)
    assert out["counts"]["blocked"] == 0
    assert all(out["works"][key]["result"] == ACCEPTED for key in ("w1", "w2", "w3", "w4"))
    eco = out["economics"]
    assert eco["per_subject"]["a"]["complete_cash_balance_from_claims"]["COOPERATION"] == "1120.00"
    assert eco["per_subject"]["op"]["complete_cash_balance_from_claims"]["COOPERATION"] == "170.00"
    assert eco["work_payment_causality"]["source_declared_consistent_count"] == eco["transfers_count"] == 16
    assert eco["original_strict_context_source_qualification"]["source_scoped_original_cost_event_count"] == eco["resource_uses_count"] == 12
    assert eco["work_payment_causality"]["settlement_progress"]["source_claimed_full_transfer_count"] == 4
    assert eco["profit"] == "UNKNOWN"
    assert out == simulate(deepcopy(doc))


def test_original_participation_reviews_use_three_accepted_work_portfolio_not_future_fourth():
    doc = fourth_period_finance_case(early=True)
    out = simulate(doc)
    assert all(row["evaluation_portfolio_forecast_scope_status"] ==
               "MODEL_ORIGINAL_ACCEPTED_PORTFOLIO_FORECAST_SCOPE_QUALIFIED"
               and row["evaluation_portfolio_original_completed_work_count"] == 3
               and row["evaluation_portfolio_private_amounts_and_reserve_verdict_not_redisclosed"]
               for row in third_period_reviews(out))
    assert len(third_period_reviews(out)) == 2
    shocked = simulate(fourth_period_finance_case(early=True, material="520.00"))
    assert third_period_reviews(out) == third_period_reviews(shocked)
    assert shocked["economics"]["per_subject"]["a"]["complete_cash_balance_from_claims"]["COOPERATION"] == "820.00"
    assert out["works"]["w4"]["result"] == shocked["works"]["w4"]["result"] == ACCEPTED


def test_portfolio_scope_missing_opening_is_unknown_not_an_invented_balance_or_refusal():
    out = simulate(fourth_period_finance_case(missing_opening=True))
    rows = {row["actor"]: row for row in third_period_reviews(out)}
    assert rows["a"]["evaluation_portfolio_forecast_scope_status"] == "UNKNOWN"
    assert rows["a"]["evaluation_economic_basis_status"] == "MODEL_ORIGINAL_COMPLETED_WORK_FINANCE_SCOPE_QUALIFIED"
    assert rows["b"]["evaluation_portfolio_forecast_scope_status"] == "MODEL_ORIGINAL_ACCEPTED_PORTFOLIO_FORECAST_SCOPE_QUALIFIED"
    assert out["works"]["w4"]["result"] == ACCEPTED


def test_same_original_portfolio_forecast_can_precede_independent_pause_without_fourth_money():
    out = simulate(fourth_period_finance_case(pause=True))
    assert "w4" not in out["works"]
    assert all(row["evaluation_portfolio_forecast_scope_status"] ==
               "MODEL_ORIGINAL_ACCEPTED_PORTFOLIO_FORECAST_SCOPE_QUALIFIED"
               for row in third_period_reviews(out))
    assert out["economics"]["transfers_count"] == 12
    assert next(row for row in third_period_reviews(out) if row["actor"] == "a")["participation_value"] == "PAUSED_NEW_WORK"


def test_stale_original_review_source_cannot_qualify_portfolio_forecast():
    out = simulate(fourth_period_finance_case(pause=True, stale=True))
    a = next(row for row in third_period_reviews(out) if row["actor"] == "a")
    assert a["evaluation_portfolio_forecast_scope_status"] == "UNKNOWN"
    assert a["evaluation_economic_basis_status"] == "UNKNOWN"
    assert a["participation_value"] == "PAUSED_NEW_WORK"
    assert "w4" not in out["works"]


def test_fourth_period_cannot_use_financial_rows_for_uncreated_work():
    from research.akis.qualitative_mesa.rules import InputError
    doc = fourth_period_finance_case()
    next(row for row in doc["events"] if row["action"] == "participation_status"
         and row.get("evaluated_work") == "w3" and row["actor"] == "a")["new_participation"] = "PAUSED_NEW_WORK"
    with pytest.raises(InputError, match="ORIGINAL_ECONOMIC_WORK_MUST_EXIST"):
        simulate(doc)


def joint_owner_service_case(*, third_fee="200.00", cap="300.00",
                             cooperative_price="1200.00", delay_stress=False,
                             on_time=False):
    """Same executed routes, independent nonoverlap documents and payer cap."""
    docs = (delayed_receipt_routes(on_time=on_time) if delay_stress
            else cumulative_routes(cooperative_price=cooperative_price))
    declaration = {
        "supplier": "a", "operator": "op", "scopes": {},
        "fee_cap": {"owner": "a", "source": "joint-a-fee-cap", "maximum_total_fee": cap},
    }
    for arm, doc in docs.items():
        money = doc["economic_claims"]
        for owner, suffix in (
            ("a", "cooperation-nonoverlap"), ("a", "outside-nonoverlap"),
            ("op", "cooperation-nonoverlap"), ("op", "outside-nonoverlap"),
            ("a", "fee-cap"),
        ):
            key = f"joint-{owner}-{suffix}"
            ref = f"model://{owner}/{key}"
            money["sources"].append({"id": key, "owner": owner, "reference": ref, "revision": "v1"})
            doc["context_evidence"]["sources"].append({
                "id": ref, "owner": owner, "revision": "v1", "status": "CONFIRMED",
                "usable_by": [owner], "core": "operator" if owner == "op" else "corporate",
                "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
                "valid_from": 0, "valid_until": 160,
            })
        if arm == "cooperation":
            next(row for row in money["transfers"] if row["id"] == "operator-fee")["amount"] = third_fee
        declaration["scopes"][arm] = {
            owner: {
                "source": f"joint-{owner}-{arm}-nonoverlap",
                "transfer_ids": [row["id"] for row in money["transfers"]
                                 if owner in {row["payer"], row["payee"]}],
                "resource_use_ids": [row["id"] for row in money["resource_uses"]
                                     if row["owner"] == owner],
            } for owner in ("a", "op")
        }
    return docs, declaration


def compare_joint_owner_service(docs, declaration):
    return compare_executed_original_routes(
        docs, cooperative_work="w3", outside_work=OUTSIDE, relation="l1",
        prior_works=("w1", "w2"), split_at=84, joint_owner_economics=declaration,
    )["joint_owner_service_economics"]


def test_original_supplier_and_operator_joint_viability_not_fee_redistribution():
    docs, declaration = joint_owner_service_case()
    frozen = deepcopy((docs, declaration))
    result = compare_joint_owner_service(docs, declaration)
    assert (docs, declaration) == frozen
    assert result["status"] == "BOTH_COMMON_OWNERS_MODEL_CONTRIBUTION_AND_RESERVE_CRITERIA_MET"
    local = result["local_research_only"]
    assert local["owners"]["supplier"]["cooperative_contribution"] == "310.00"
    assert local["owners"]["supplier"]["outside_contribution"] == "140.00"
    assert local["owners"]["operator"]["cooperative_contribution"] == "50.00"
    assert local["owners"]["operator"]["outside_contribution"] == "-55.00"
    assert local["cooperative_total_original_fee"] == "270.00"
    assert local["joint_cooperative_minus_outside_contribution"] == "275.00"
    assert result["empirical_network_additionality"] == "NOT_IDENTIFIABLE"
    assert result["original_distinct_recipient_value_not_measured"]
    assert result["no_automatic_consent_or_fee_change"]


def test_original_internal_fee_change_does_not_create_joint_contribution():
    base = compare_joint_owner_service(*joint_owner_service_case(third_fee="150.00"))
    revised = compare_joint_owner_service(*joint_owner_service_case(third_fee="200.00"))
    assert "OPERATOR_NONPOSITIVE_COOPERATIVE_CONTRIBUTION" in base["failure_reasons"]
    assert revised["failure_reasons"] == []
    for key in ("joint_cooperative_contribution", "joint_outside_contribution",
                "joint_cooperative_minus_outside_contribution"):
        assert base["local_research_only"][key] == revised["local_research_only"][key]


@pytest.mark.parametrize("kwargs,reason", [
    ({"third_fee": "240.00"}, "SUPPLIER_DECLARED_FEE_CAP_EXCEEDED"),
    ({"cooperative_price": "900.00"}, "SUPPLIER_NO_POSITIVE_ALTERNATIVE_ADVANTAGE"),
    ({"delay_stress": True}, "OPERATOR_DECLARED_RESERVE_NOT_ROBUST"),
])
def test_positive_owner_contribution_does_not_override_cap_alternative_or_reserve(kwargs, reason):
    report = compare_joint_owner_service(*joint_owner_service_case(**kwargs))
    assert report["status"] == "COMMON_OWNER_MODEL_VIABILITY_CRITERIA_NOT_MET"
    assert reason in report["failure_reasons"]


def test_payment_delay_can_be_removed_without_creating_any_more_joint_value():
    late = compare_joint_owner_service(*joint_owner_service_case(delay_stress=True))
    early = compare_joint_owner_service(*joint_owner_service_case(delay_stress=True, on_time=True))
    assert "OPERATOR_DECLARED_RESERVE_NOT_ROBUST" in late["failure_reasons"]
    assert early["failure_reasons"] == []
    assert late["local_research_only"]["joint_cooperative_contribution"] == (
        early["local_research_only"]["joint_cooperative_contribution"])


@pytest.mark.parametrize("mutation,reason", [
    ("omit", "FULL_ORIGINAL_ROW_SCOPE"),
    ("duplicate", "DUPLICATE_ORIGINAL_ROW"),
    ("wrong_owner", "SOURCE_OWNER_NOT_PARTY"),
    ("terms_alias", "SEPARATE_ORIGINAL_SOURCE"),
    ("wrong_payer", "ORIGINAL_FEE_PAYER_REQUIRED"),
])
def test_joint_contribution_requires_independent_complete_original_scope(mutation, reason):
    docs, declaration = joint_owner_service_case()
    scope = declaration["scopes"]["cooperation"]["a"]
    if mutation == "omit":
        scope["resource_use_ids"].pop()
    elif mutation == "duplicate":
        scope["transfer_ids"].append(scope["transfer_ids"][0])
    elif mutation == "wrong_owner":
        scope["source"] = "joint-op-cooperation-nonoverlap"
    elif mutation == "terms_alias":
        scope["source"] = "terms-a"
    else:
        declaration["fee_cap"]["owner"] = "op"
    with pytest.raises(TrajectoryComparisonError, match=reason):
        compare_joint_owner_service(docs, declaration)


def test_joint_contribution_is_unknown_when_selected_result_not_accepted():
    docs, declaration = joint_owner_service_case()
    docs["outside"]["events"] = [
        row for row in docs["outside"]["events"]
        if not (row.get("work") == OUTSIDE and row["action"] == "accept")]
    result = compare_joint_owner_service(docs, declaration)
    assert result["status"] == "UNKNOWN_EXECUTED_ROUTE_SCOPE"
    assert result["local_research_only"] is None
