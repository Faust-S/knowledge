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


def multiperiod_routes(*, cooperative_price="1200.00"):
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


def cumulative_routes(*, cooperative_price="1200.00"):
    """Add actual prior Work-linked declarations to the SAME R2 ledger.

    No reset of the operator's or producer's cash at the third period.
    Both trajectories carry identical source declarations and cost anchors
    for w1 and w2; only the selected third Work's own records differ.
    """
    docs = multiperiod_routes(cooperative_price=cooperative_price)
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
