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
    doc.pop("strict_economic_source_work")
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
