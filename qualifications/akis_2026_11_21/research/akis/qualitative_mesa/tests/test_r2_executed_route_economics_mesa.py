"""Controlled R2/R4 experiment: one original Work/economic ledger per arm.

Two executed routes, a fixed cooperation boundary and the entire subject
boundary are deliberately distinguished. Synthetic owner documents are not
verified settlements, physical equivalence, profits or welfare measurements.
"""
from copy import deepcopy
from decimal import Decimal
import json

import pytest

from research.akis.qualitative_mesa.comparative_trajectories import (
    TrajectoryComparisonError, compare_executed_original_routes,
)
from .test_r4_original_outside_work_mesa import (
    original_outside_work_case, OUTSIDE, ACCEPTED, BUYER,
)


ARMS = {"cooperation": "w3", "outside": OUTSIDE}
OWNERS = ("a", "b", "op", BUYER)
ACTIVE = "COOPERATION"
INACTIVE = "INDEPENDENT_ALTERNATIVE"


def paired_economics(*, cooperative_price="1200.00"):
    docs = {name: original_outside_work_case(name) for name in ARMS}
    for d in docs.values():
        d["events"].sort(key=lambda row: row["at"])
    common_sources = []
    common_context = []

    def source(owner, ref, rev="finance-v1", key=None):
        common_context.append({
            "id": ref, "owner": owner, "revision": rev,
            "status": "CONFIRMED", "usable_by": [owner],
            "core": "operator" if owner == "op" else "corporate",
            "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
            "valid_from": 0, "valid_until": 160,
        })
        if key is not None:
            common_sources.append({
                "id": key, "owner": owner, "reference": ref, "revision": rev,
            })

    for owner in OWNERS:
        source(owner, f"model://{owner}/route-terms", key=f"terms-{owner}")
        source(owner, f"model://{owner}/route-payment-source",
               key=f"receipt-{owner}")

    # Source amounts are declared separately for each selected route, not
    # part of a second, simultaneously realized financial scenario.
    costs = {
        "cooperation": [
            ("production", "a", "240.00", "DELIVERY",
             "PRODUCTION_COORDINATION", "DIRECT_RESOURCE", "start"),
            ("negotiation", "a", "40.00", "COORDINATION",
             "NEGOTIATION", "TRANSACTION", "consent"),
            ("inspection", "b", "30.00", "COORDINATION",
             "MONITORING_AND_QUALITY", "TRANSACTION", "assess_result_quality"),
            ("coordination", "op", "70.00", "COORDINATION",
             "PRODUCTION_COORDINATION", "TRANSACTION", "commit"),
            ("shared", "op", "25.00", "COMMON_CAPABILITY",
             "ONBOARDING_AND_INTEGRATION", "SHARED_OPERATOR_CAPABILITY", "authorize"),
        ],
        "outside": [
            ("production", "a", "240.00", "DELIVERY",
             "PRODUCTION_COORDINATION", "DIRECT_RESOURCE", "start"),
            ("negotiation", "a", "110.00", "COORDINATION",
             "NEGOTIATION", "TRANSACTION", "consent"),
            ("inspection", BUYER, "45.00", "COORDINATION",
             "MONITORING_AND_QUALITY", "TRANSACTION", "assess_result_quality"),
            ("coordination", "op", "15.00", "COORDINATION",
             "PRODUCTION_COORDINATION", "TRANSACTION", "commit"),
            ("shared", "op", "15.00", "COMMON_CAPABILITY",
             "ONBOARDING_AND_INTEGRATION", "SHARED_OPERATOR_CAPABILITY", "authorize"),
        ],
    }
    for name, records in costs.items():
        for key, owner, *_ in records:
            source(owner, f"model://{owner}/{name}-{key}-event-proof", "cost-v1")
    for name, buyer in (("cooperation", "b"), ("outside", BUYER)):
        for number in (1, 2):
            for owner in ("a", buyer):
                source(owner, f"model://{owner}/{name}-payment-{number}", "statement-v1")
    scope = {owner: f"terms-{owner}" for owner in OWNERS}
    opening = {"a": ("800.00", "100.00"), "b": ("2000.00", "100.00"),
               "op": ("70.00", "30.00"), BUYER: ("2000.00", "100.00")}
    for name, d in docs.items():
        work = ARMS[name]
        revision = "d-3" if name == "cooperation" else "outside-d1"
        buyer = "b" if name == "cooperation" else BUYER
        d["context_evidence"]["sources"].extend(deepcopy(common_context))
        d["strict_economic_source_work"] = work
        money = d["economic_claims"] = {
            "period": "THIRD_ORIGINAL_WORK", "currency": "RUB",
            "sources": deepcopy(common_sources), "transfers": [], "resource_uses": [],
            "coverage": {ACTIVE: deepcopy(scope), INACTIVE: {}},
            "outside_feasibility": {},
            "cash_timing": {
                "horizon_end": 134,
                "owner_positions": [
                    {"owner": owner, "source": scope[owner],
                     "opening_cash": opening[owner][0], "reserve_cash": opening[owner][1]}
                    for owner in OWNERS
                ],
                "transfer_windows": [],
            },
            "lifecycle_costs": {
                "bindings": [], "scope_proofs": {ACTIVE: deepcopy(scope), INACTIVE: {}},
                "event_bindings": [],
            },
            "work_payment_conditions": [], "work_payment_settlement_claims": [],
        }

        def transfer(key, payer, payee, amount, at, late, condition):
            owner = payee if payer == "EXTERNAL" else payer
            src = scope[owner]
            witnesses = {party: scope[party] for party in sorted({payer, payee} - {"EXTERNAL"})}
            money["transfers"].append({
                "id": key, "scenario": ACTIVE, "payer": payer, "payee": payee,
                "amount": amount, "source": src, "work": work,
            })
            money["cash_timing"]["transfer_windows"].append({
                "transfer_id": key, "at": at, "late_at": late,
                "owner_sources": deepcopy(witnesses),
            })
            money["work_payment_conditions"].append({
                "transfer_id": key, "condition": condition, "due_at": 125,
                "work_source_revision": revision, "org_revision": "oc-1",
                "owner_sources": deepcopy(witnesses),
            })

        price = cooperative_price if name == "cooperation" else "900.00"
        first = Decimal("500.00") if name == "cooperation" else Decimal("350.00")
        if name == "cooperation":
            transfer("purchase", buyer, "a", price, 119, 130, "ON_CUSTOMER_ACCEPTANCE")
            transfer("materials", "a", "EXTERNAL", "450.00", 95, 95, "ON_ORIGINAL_COMMIT")
            transfer("operator-fee", "a", "op", "150.00", 96, 130, "ON_ORIGINAL_COMMIT")
            transfer("operator-cash-cost", "op", "EXTERNAL", "50.00", 100, 100, "ON_ORIGINAL_COMMIT")
            report_at = 118
        else:
            transfer("purchase", buyer, "a", price, 112, 125, "ON_CUSTOMER_ACCEPTANCE")
            transfer("materials", "a", "EXTERNAL", "450.00", 88, 88, "ON_ORIGINAL_COMMIT")
            transfer("operator-cash-cost", "op", "EXTERNAL", "20.00", 100, 100, "ON_ORIGINAL_COMMIT")
            report_at = 111
        for number, amount in enumerate((first, Decimal(price) - first), 1):
            at = report_at + number - 1
            exact = f"{amount:.2f}"
            parties = ("a", buyer)
            refs = {owner: f"model://{owner}/{name}-payment-{number}" for owner in parties}
            money["work_payment_settlement_claims"].append({
                "id": f"{name}-payment-{number}", "transfer_id": "purchase",
                "at": at, "amount": exact,
                "owner_sources": {owner: f"receipt-{owner}" for owner in parties},
                "evidence_refs": refs,
                "evidence_revisions": {owner: "statement-v1" for owner in parties},
                "owner_attestations": {
                    owner: {"reported_at": at, "reported_amount": exact} for owner in parties
                },
            })
        life = money["lifecycle_costs"]
        for key, owner, amount, bucket, stage, nature, action in costs[name]:
            ident = f"{name}-{key}"
            pos, event = next(
                (i, row) for i, row in enumerate(d["events"])
                if row.get("work") == work and row["action"] == action
                and row["actor"] == owner
            )
            ref = f"model://{owner}/{name}-{key}-event-proof"
            money["resource_uses"].append({
                "id": ident, "scenario": ACTIVE, "owner": owner, "amount": amount,
                "bucket": bucket, "source": scope[owner], "work": work,
            })
            life["bindings"].append({
                "resource_use_id": ident, "owner": owner, "source": scope[owner],
                "stage": stage, "nature": nature,
            })
            life["event_bindings"].append({
                "resource_use_id": ident, "work": work, "owner": owner, "source": scope[owner],
                "work_source_revision": revision, "trace_position": pos,
                "at": event["at"], "action": action, "org_revision": "oc-1",
                "cost_evidence_ref": ref, "cost_evidence_revision": "cost-v1",
            })
    return docs


def compare(docs):
    return compare_executed_original_routes(
        docs, cooperative_work="w3", outside_work=OUTSIDE, relation="l1",
        prior_works=("w1", "w2"), split_at=81,
    )


def test_two_executed_original_routes_distinguish_owner_and_fixed_network_cash():
    docs = paired_economics()
    frozen = deepcopy(docs)
    report = compare(docs)
    assert docs == frozen
    assert report["status"] == "MODEL_EXECUTED_ROUTES_DECLARED_ECONOMIC_CONTRAST", report
    assert report["previous_original_results_preserved"]
    assert report["distinct_original_recipients_not_equal_measured_utility"]
    assert report["empirical_network_additionality"] == "NOT_IDENTIFIABLE"
    assert report["actual_physical_equivalence_and_causal_additionality_verified"] is False
    assert all(r["selected_original_result"] == ACCEPTED for r in report["routes"].values())
    assert all(r["source_matched_full_transfer_count"] == 1 for r in report["routes"].values())
    private = report["local_research_only"]
    assert private["boundary_projections"] == {
        "cooperation": {
            "fixed_cooperation_boundary_net_cash": "-500.00",
            "whole_original_subject_boundary_net_cash": "-500.00",
            "whole_original_noncash_total": "405.00",
            "whole_original_transaction_noncash": "140.00",
        },
        "outside": {
            "fixed_cooperation_boundary_net_cash": "430.00",
            "whole_original_subject_boundary_net_cash": "-470.00",
            "whole_original_noncash_total": "425.00",
            "whole_original_transaction_noncash": "170.00",
        },
    }
    assert private["boundary_and_cost_contrast"] == {
        "fixed_cooperation_cash_cooperation_minus_outside": "-930.00",
        "whole_subject_cash_cooperation_minus_outside": "-30.00",
        "whole_noncash_outside_minus_cooperation": "20.00",
        "whole_transaction_noncash_outside_minus_cooperation": "30.00",
    }
    assert private["original_owner_contrasts"]["a"]["cash_cooperation_minus_outside"] == "150.00"
    assert private["original_owner_contrasts"]["op"]["cash_cooperation_minus_outside"] == "120.00"
    assert private["original_owner_contrasts"][BUYER]["cash_cooperation_minus_outside"] == "900.00"
    assert report["cash_and_noncash_are_not_added"]
    assert private["automatically_shared_with_participants"] is False
    assert report["routes"]["cooperation"]["execution_model_ticks"] == 1
    assert report["routes"]["outside"]["execution_model_ticks"] == 1


@pytest.mark.parametrize("price,expected", [
    ("1200.00", "150.00"), ("1050.00", "0.00"), ("900.00", "-150.00"),
])
def test_supplier_declared_cash_difference_reverses_with_price_without_changing_whole_boundary(price, expected):
    report = compare(paired_economics(cooperative_price=price))
    private = report["local_research_only"]
    assert private["original_owner_contrasts"]["a"]["cash_cooperation_minus_outside"] == expected
    assert private["boundary_and_cost_contrast"]["whole_subject_cash_cooperation_minus_outside"] == "-30.00"
    assert report["empirical_network_additionality"] == "NOT_IDENTIFIABLE"
    assert not report["original_bank_payment_verified"]


def test_operator_reserve_can_be_at_risk_with_positive_owner_cash_difference():
    private = compare(paired_economics())["local_research_only"]
    op = private["original_owner_projections"]["cooperation"]["op"]
    assert op["expected_liquidity"] == "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    assert op["late_receipt_liquidity"] == "SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS"
    assert private["original_owner_contrasts"]["op"]["cash_cooperation_minus_outside"] == "120.00"


def test_unaccepted_result_suppresses_all_economic_contrasts_not_zero():
    docs = paired_economics()
    outside = docs["outside"]
    outside["events"] = [row for row in outside["events"]
                         if not (row.get("work") == OUTSIDE and row["action"] == "accept")]
    report = compare(docs)
    assert report["status"] == "NOT_IDENTIFIABLE_FROM_EXECUTED_ROUTE_SCOPE"
    assert report["routes"]["outside"]["selected_original_result"] == "SUBMITTED"
    assert "SELECTED_ORIGINAL_RESULT_NOT_QUALIFIED" in report["reasons"]
    assert "ORIGINAL_PAYMENT_TERMS_OR_CAUSAL_ORDER_INCOMPLETE" in report["reasons"]
    assert report["local_research_only"]["boundary_and_cost_contrast"] is None
    assert report["local_research_only"]["original_owner_contrasts"] is None


@pytest.mark.parametrize("kind", ["cash_scope", "cost_scope", "cost_anchor"])
def test_missing_source_declared_scope_or_cost_anchor_is_unknown(kind):
    docs = paired_economics()
    if kind == "cash_scope":
        for d in docs.values():
            del d["economic_claims"]["coverage"][ACTIVE]["b"]
    elif kind == "cost_scope":
        for d in docs.values():
            del d["economic_claims"]["lifecycle_costs"]["scope_proofs"][ACTIVE]["b"]
    else:
        docs["outside"]["economic_claims"]["lifecycle_costs"]["event_bindings"].pop()
    report = compare(docs)
    assert report["status"] == "NOT_IDENTIFIABLE_FROM_EXECUTED_ROUTE_SCOPE"
    assert report["local_research_only"]["boundary_projections"] is None
    assert report["local_research_only"]["boundary_and_cost_contrast"] is None


def test_missing_original_payment_term_is_unknown_even_with_accepted_result():
    docs = paired_economics()
    money = docs["cooperation"]["economic_claims"]
    money["work_payment_conditions"] = [
        row for row in money["work_payment_conditions"] if row["transfer_id"] != "operator-fee"
    ]
    report = compare(docs)
    assert report["routes"]["cooperation"]["selected_original_result"] == ACCEPTED
    assert "ORIGINAL_PAYMENT_TERMS_OR_CAUSAL_ORDER_INCOMPLETE" in report["reasons"]
    assert report["local_research_only"]["boundary_and_cost_contrast"] is None


@pytest.mark.parametrize("change,reason", [
    (lambda d: d["outside"]["resources"][0].update(capacity_units=2),
     "EXECUTED_ROUTE_INITIAL_STATE_CHANGED"),
    (lambda d: d["outside"]["economic_claims"]["cash_timing"]["owner_positions"][0].update(opening_cash="900.00"),
     "EXECUTED_ROUTE_ECONOMIC_BASELINE_CHANGED"),
    (lambda d: d["outside"]["economic_claims"].update(currency="USD"),
     "EXECUTED_ROUTE_ECONOMIC_BASELINE_CHANGED"),
    (lambda d: d["outside"]["events"][0].update(at=0),
     "EXECUTED_ROUTE_COMMON_PREFIX_CHANGED"),
    (lambda d: d["outside"]["economic_claims"]["transfers"][0].update(work="w3"),
     "EXECUTED_ROUTE_ONLY_SELECTED_ORIGINAL_ROWS"),
    (lambda d: d["outside"]["economic_claims"]["transfers"][0].update(scenario=INACTIVE),
     "EXECUTED_ROUTE_ONLY_SELECTED_ORIGINAL_ROWS"),
    (lambda d: d["outside"]["events"].append(
        {"at": 133, "action": "accept", "actor": "b", "work": "w3"}),
     "EXECUTED_ROUTE_OTHER_POST_SPLIT_EVENT"),
])
def test_mismatched_baseline_or_incompatible_ledger_is_rejected(change, reason):
    docs = paired_economics()
    change(docs)
    with pytest.raises(TrajectoryComparisonError, match=reason):
        compare(docs)


def test_different_declared_quality_basis_cannot_produce_comparable_money():
    docs = paired_economics()
    for d in docs.values():
        next(w for w in d["works"] if w["id"] == "w3")["assurance_criteria"][0]["method"] = "MEASUREMENT"
    with pytest.raises(TrajectoryComparisonError, match="EXECUTED_ROUTE_DECLARED_QUALITY_BASIS_MISMATCH"):
        compare(docs)


def test_different_declared_resource_interval_cannot_produce_comparable_money():
    docs = paired_economics()
    for d in docs.values():
        next(w for w in d["works"] if w["id"] == "w3")["slot_end"] = 121
    with pytest.raises(TrajectoryComparisonError, match="EXECUTED_ROUTE_DECLARED_PLAN_SCOPE_MISMATCH"):
        compare(docs)


def test_repeat_is_deterministic_and_does_not_disclose_private_owner_values_in_public_view():
    one = compare(paired_economics())
    two = compare(paired_economics())
    assert one == two
    public = json.dumps({k: v for k, v in one.items() if k != "local_research_only"}, sort_keys=True)
    for value in ("model://", "1200.00", "150.00", "900.00", "-930.00", "original_owner_contrasts"):
        assert value not in public
