"""R1/R2: strict-KPB new sector actor + one existing original economic ledger.

One genuinely registered new sector actor, original CapacityLedger and
cooperation membership, original independent Work/Result decisions, source
rights, payment-time forecasts and original cost-to-Work event anchors.

No second income, IAM, contract, Work, scheduler or autonomous signatures.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.comparative_trajectories import (
    compare_original_trajectories,
)
from research.akis.qualitative_mesa.mesa_model import OperatorAKISModel, simulate
from research.akis.qualitative_mesa.rules import InputError

from .test_r1v2c2b_registered_subject_cooperation_work_mesa import (
    original_new_actor_cycle, _insert_before,
)
from .test_r1u4_strict_original_source_rights_mesa import e


OWNERS = ("a", "b", "c", "op", "sector")
SCENARIOS = ("COOPERATION", "INDEPENDENT_ALTERNATIVE")


def original_strict_economic_case():
    d = original_new_actor_cycle("sector")
    # Prospective c may have an owner-held source, but its active role still
    # enters only after the original subject_registration_apply.
    context = d["context_evidence"]
    source_rows = []
    for owner in OWNERS:
        kind = (
            "operator" if owner == "op" else
            "institutional" if owner in {"sector", "c"} else "corporate"
        )
        ref = f"model://{owner}/w2-economic-evidence"
        context["sources"].append({
            "id": ref, "owner": owner, "revision": "money-r1",
            "status": "CONFIRMED", "usable_by": [owner],
            "core": kind, "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
            "operations": ["READ"], "valid_from": 0, "valid_until": 120,
        })
        source_rows.append({
            "id": f"econ-{owner}", "owner": owner,
            "reference": ref, "revision": "money-r1",
        })
    def tx(ident, scenario, payer, payee, value, owner):
        return {
            "id": ident, "scenario": scenario, "payer": payer,
            "payee": payee, "amount": value,
            "source": f"econ-{owner}", "work": "w2",
        }
    transfers = [
        tx("sale-coop", "COOPERATION", "EXTERNAL", "b", "180000.00", "b"),
        tx("sector-coop", "COOPERATION", "b", "sector", "85000.00", "b"),
        tx("entrant-coop", "COOPERATION", "b", "c", "15000.00", "b"),
        tx("operator-coop", "COOPERATION", "b", "op", "5000.00", "b"),
        tx("external-coop", "COOPERATION", "b", "EXTERNAL", "32000.00", "b"),
        tx("sale-outside", "INDEPENDENT_ALTERNATIVE", "EXTERNAL", "b", "165000.00", "b"),
        tx("materials-outside", "INDEPENDENT_ALTERNATIVE", "b", "EXTERNAL", "110000.00", "b"),
        tx("sector-outside", "INDEPENDENT_ALTERNATIVE", "sector", "EXTERNAL", "7000.00", "sector"),
        tx("entrant-outside", "INDEPENDENT_ALTERNATIVE", "c", "EXTERNAL", "6000.00", "c"),
        tx("operator-outside", "INDEPENDENT_ALTERNATIVE", "op", "EXTERNAL", "2000.00", "op"),
        tx("legacy-outside", "INDEPENDENT_ALTERNATIVE", "a", "EXTERNAL", "4000.00", "a"),
    ]
    def cost(ident, scenario, owner, money, bucket, stage, nature):
        return (
            {
                "id": ident, "scenario": scenario, "owner": owner,
                "amount": money, "bucket": bucket,
                "source": f"econ-{owner}", "work": "w2",
            },
            {
                "resource_use_id": ident, "owner": owner,
                "source": f"econ-{owner}", "stage": stage, "nature": nature,
            },
        )
    cost_entries = [
        cost("cost-entrant-search", "COOPERATION", "c", "4000.00",
             "PARTICIPANT_CONNECT", "PARTNER_SEARCH", "TRANSACTION"),
        cost("cost-sector-production", "COOPERATION", "sector", "18000.00",
             "DELIVERY", "PRODUCTION_COORDINATION", "DIRECT_RESOURCE"),
        cost("cost-operator-onboarding", "COOPERATION", "op", "2800.00",
             "COORDINATION", "ONBOARDING_AND_INTEGRATION",
             "SHARED_OPERATOR_CAPABILITY"),
        cost("cost-b-governance", "COOPERATION", "b", "4500.00",
             "OTHER", "SECURITY_DATA_AND_AI_GOVERNANCE",
             "DATA_SECURITY_GOVERNANCE"),
        cost("cost-outside-entrant", "INDEPENDENT_ALTERNATIVE", "c",
             "6000.00", "DELIVERY", "PRODUCTION_COORDINATION",
             "DIRECT_RESOURCE"),
        cost("cost-outside-sector", "INDEPENDENT_ALTERNATIVE", "sector",
             "24000.00", "DELIVERY", "PRODUCTION_COORDINATION",
             "DIRECT_RESOURCE"),
        cost("cost-outside-b", "INDEPENDENT_ALTERNATIVE", "b", "6000.00",
             "OTHER", "PARTNER_SEARCH", "TRANSACTION"),
    ]
    costs = [row for row, _ in cost_entries]
    lifecycle = [row for _, row in cost_entries]
    original_request = next(
        event for event in d["events"]
        if event["action"] == "request"
        and event["work_spec"]["id"] == "w2"
    )
    position = d["events"].index(original_request)
    # Existing economic_lifecycle binds one SOURCE-DECLARED resource cost to
    # the ACTUAL original Work request. It does not attest cash settlement.
    event_cost = {
        "resource_use_id": "cost-entrant-search",
        "work": "w2", "owner": "c", "source": "econ-c",
        "work_source_revision": "d-2",
        "trace_position": position, "at": original_request["at"],
        "action": "request", "org_revision": "oc-1",
        "cost_evidence_ref": "model://c/w2-search-cost-proof",
    }
    owner_by_scenario = {
        scenario: {owner: f"econ-{owner}" for owner in OWNERS}
        for scenario in SCENARIOS
    }
    cash_timing = {
        "horizon_end": 110,
        "owner_positions": [
            {
                "owner": owner, "source": f"econ-{owner}",
                "opening_cash": opening, "reserve_cash": reserve,
            }
            for owner, opening, reserve in [
                ("a", "10000.00", "2000.00"),
                ("b", "25000.00", "10000.00"),
                ("c", "10000.00", "2000.00"),
                ("op", "5000.00", "1000.00"),
                ("sector", "8000.00", "2000.00"),
            ]
        ],
        "transfer_windows": [],
    }
    timing = {
        "sale-coop": (75, 95), "sector-coop": (65, 65),
        "entrant-coop": (66, 66), "operator-coop": (68, 68),
        "external-coop": (60, 60),
        "sale-outside": (78, 93), "materials-outside": (62, 62),
        "sector-outside": (65, 65), "entrant-outside": (63, 63),
        "operator-outside": (64, 64), "legacy-outside": (64, 64),
    }
    for transfer in transfers:
        at, late = timing[transfer["id"]]
        parties = {transfer["payer"], transfer["payee"]} - {"EXTERNAL"}
        cash_timing["transfer_windows"].append({
            "transfer_id": transfer["id"], "at": at,
            "late_at": late, "owner_sources": {
                owner: f"econ-{owner}" for owner in sorted(parties)
            },
        })
    doc = {
        "period": "2026-Q4", "currency": "RUB",
        "sources": source_rows,
        "transfers": transfers,
        "resource_uses": costs,
        "coverage": owner_by_scenario,
        "outside_feasibility": {
            owner: {"state": "FEASIBLE_DECLARED",
                    "source": f"econ-{owner}"}
            for owner in OWNERS
        },
        "cash_timing": cash_timing,
        "lifecycle_costs": {
            "bindings": lifecycle,
            "scope_proofs": deepcopy(owner_by_scenario),
            "event_bindings": [event_cost],
        },
    }
    d["economic_claims"] = doc
    owner_scope = {}
    for scenario in SCENARIOS:
        owner_scope[scenario] = {}
        for owner in OWNERS:
            cash_exists = any(
                row["scenario"] == scenario
                and owner in {row["payer"], row["payee"]}
                for row in transfers
            )
            costs_exist = any(
                row["scenario"] == scenario and row["owner"] == owner
                for row in costs
            )
            owner_scope[scenario][owner] = {
                "source": f"econ-{owner}", "complete": True,
                "declared_zero_cash": not cash_exists,
                "declared_zero_noncash": not costs_exist,
            }
    d["work_counterfactuals"] = [{
        "work": "w2", "reuse_claim": None,
        "comparison_source": "econ-b",
        "equivalence": {field: True for field in (
            "deliverable", "quantity", "quality", "risk", "horizon"
        )},
        "owner_scope": owner_scope,
    }]
    d["strict_economic_source_work"] = "w2"
    return d


def strict_economic_alternatives():
    baseline = original_strict_economic_case()
    variants = {name: deepcopy(baseline) for name in (
        "accepted", "independent_work_refusal",
        "resource_unavailable", "awaiting_acceptance",
    )}
    refuse = variants["independent_work_refusal"]
    refuse["events"] = [
        event for event in refuse["events"]
        if not (event["action"] == "consent"
                and event.get("work") == "w2"
                and event["actor"] == "b")
    ]
    capacity = variants["resource_unavailable"]
    _insert_before(
        capacity["events"],
        lambda event: event["action"] == "commit"
        and event.get("work") == "w2",
        e(0, "resource_status", "c", resource="rc",
          availability="UNAVAILABLE"),
    )
    capacity["events"].sort(key=lambda event: event["at"])
    awaiting = variants["awaiting_acceptance"]
    awaiting["events"] = [
        event for event in awaiting["events"]
        if not (event["action"] == "accept"
                and event.get("work") == "w2")
    ]
    for key, doc in variants.items():
        assert doc["context_evidence"]["strict"], key
        assert len({event["at"] for event in doc["events"]}) == len(
            doc["events"]
        ), key
        doc["model_horizon"] = max(
            100, doc["model_horizon"],
            max(event["at"] for event in doc["events"]) + 1
        )
    return variants


def test_registered_sector_actor_has_one_original_strict_economics_and_result():
    d = original_strict_economic_case()
    before = deepcopy(d)
    out = simulate(d)
    assert before == d
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"])
        for r in out["trace"] if r["outcome"] == "BLOCKED"
    ]
    assert out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["works"]["w2"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    assert out["subjects"]["c"]["kind"] == "SECTOR_BODY"
    assert out["capacity"]["resources"]["rc"]["owner"] == "c"
    assert out["context_basis"]["strict"]
    rights = out["economics"]["original_strict_context_source_qualification"]
    assert rights["status"] == "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED"
    assert rights["covered_original_subject_count"] == len(OWNERS)
    assert rights["all_original_work_principals_have_own_sources"]
    assert rights["member_private_cash_values_or_source_refs_redisclosed"] is False
    assert out["economics"]["cash_timing"][
        "per_original_owner_private_research_projection"
    ]["b"]["status"] == "DECLARED_LIQUIDITY_GAP_IN_ONE_OR_MORE_CASES"
    assert out["economics"]["consolidated_external_cash_from_claims"][
        "COOPERATION"
    ] == "148000.00"
    assert out["economics"]["consolidated_cash_difference_claimed_scope"] == (
        "112000.00"
    )
    # An aggregate candidate can look favourable while the actual customer
    # sees a strictly worse private cash path and a liquidity constraint.
    # Neither the operator nor a positive network comparison may waive b's
    # independent decision.
    assert out["economics"]["per_subject"]["b"][
        "cash_difference_cooperation_minus_outside"
    ] == "-12000.00"
    assert out["economics"]["lifecycle_resource_costs"][
        "original_work_event_timing"
    ]["original_lifecycle_timed_record_count"] == 1
    assert out["economics"]["economic_value_added"] == "NOT_IDENTIFIABLE"
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_four_strict_original_work_trajectories_are_economically_comparable():
    scenarios = strict_economic_alternatives()
    outputs = {label: simulate(doc) for label, doc in scenarios.items()}
    comparison = compare_original_trajectories(
        scenarios, outputs, pilot_work="w1", next_work="w2"
    )
    assert comparison["accepted_next_work_count"] == 1
    assert comparison["observed_divergent_work_results"]
    assert comparison["source_declared_economic_inputs_held_constant"]
    assert comparison["actual_profit"] == "UNKNOWN"
    expected = {
        "accepted": "ACCEPTED_BY_ORIGINAL_RECIPIENT",
        "independent_work_refusal": "NOT_SUBMITTED",
        "resource_unavailable": "NOT_SUBMITTED",
        "awaiting_acceptance": "SUBMITTED",
    }
    assert {
        trial["trial"]: trial["original_next_work_result"]
        for trial in comparison["trials"]
    } == expected
    assert all(out["context_basis"]["strict"] for out in outputs.values())
    refusal = outputs["independent_work_refusal"]
    assert refusal["works"]["w2"]["consenting_principals"] == [
        "c", "sector",
    ]
    assert next(
        row for row in refusal["trace"]
        if row["action"] == "commit" and row.get("work") == "w2"
    )["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"
    assert all(
        out["economics"]["per_subject"]["b"][
            "cash_difference_cooperation_minus_outside"
        ] == "-12000.00"
        for out in outputs.values()
    )
    assert all(
        out["economics"]["original_strict_context_source_qualification"][
            "status"
        ] == "ORIGINAL_STRICT_CONTEXT_SOURCES_QUALIFIED"
        for out in outputs.values()
    )
    assert all(
        out["economics"]["consolidated_external_cash_from_claims"][
            "COOPERATION"
        ] == "148000.00" for out in outputs.values()
    )
    assert all(
        out["works"]["w1"]["result"] == "ACCEPTED_BY_ORIGINAL_RECIPIENT"
        for out in outputs.values()
    )


def test_context_revocation_after_accepted_work_blocks_new_economic_use():
    d = original_strict_economic_case()
    d["events"].append(e(
        96, "source_update", "c",
        source="model://c/w2-economic-evidence",
        status="DISPROVED", expected_revision="money-r1",
        new_revision="money-r2",
    ))
    d["events"].sort(key=lambda event: event["at"])
    d["model_horizon"] = 103
    model = OperatorAKISModel(d)
    with pytest.raises(
        InputError,
        match="ORIGINAL_ECONOMIC_SOURCE_NOT_USABLE_IN_STRICT_KPB",
    ):
        model.execute()
    assert model.qualitative.works["w1"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )
    assert model.qualitative.works["w2"].result == (
        "ACCEPTED_BY_ORIGINAL_RECIPIENT"
    )


def test_foreign_source_cannot_qualify_another_original_owner_cash():
    d = original_strict_economic_case()
    source = next(row for row in d["economic_claims"]["sources"]
                  if row["owner"] == "c")
    source["reference"] = "model://sector/w2-economic-evidence"
    with pytest.raises(
        InputError,
        match="ORIGINAL_ECONOMIC_SOURCE_NOT_USABLE_IN_STRICT_KPB",
    ):
        simulate(d)


def test_cash_forecast_not_evidence_of_an_accepted_result():
    d = original_strict_economic_case()
    d["events"] = [
        event for event in d["events"]
        if not (event["action"] == "accept"
                and event.get("work") == "w2")
    ]
    out = simulate(d)
    assert out["works"]["w2"]["result"] == "SUBMITTED"
    assert out["economics"]["consolidated_external_cash_from_claims"][
        "COOPERATION"
    ] == "148000.00"
    assert out["economics"]["economic_value_added"] == "NOT_IDENTIFIABLE"
    assert out["profit"]["system_increment"] == "UNKNOWN"


def test_forged_cost_event_anchor_cannot_infer_original_expense():
    d = original_strict_economic_case()
    d["economic_claims"]["lifecycle_costs"]["event_bindings"][0][
        "trace_position"
    ] = 0
    with pytest.raises(
        InputError,
        match="LIFECYCLE_TIMED_APPLIED_ORIGINAL_WORK_EVENT_REQUIRED",
    ):
        simulate(d)


def test_strict_source_review_is_required_when_requested():
    d = original_strict_economic_case()
    d["context_evidence"]["strict"] = False
    with pytest.raises(
        InputError,
        match="ORIGINAL_ECONOMIC_STRICT_CONTEXT_REQUIRED",
    ):
        simulate(d)
