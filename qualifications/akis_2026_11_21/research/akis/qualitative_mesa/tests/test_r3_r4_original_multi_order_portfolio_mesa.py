"""Original competing technology + separate independent order in one Mesa.

The alternative customer is not an incumbent's fictitious lost receipt.
Every actual Work retains original request, source rights, human review,
consents, capacity reservation, execution and original recipient acceptance.
"""
from copy import deepcopy

import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.org_code_policy import original_model_code_fingerprint
from research.akis.qualitative_mesa.technology import technology_route_fingerprint
from .test_r1t3_original_technology_route_mesa import (
    matched_competing_market_cases, bind_commercial_terms,
)
from .test_r1u4_strict_original_source_rights_mesa import _original_rights
from .test_r4_original_buyer_offer_response_mesa import buyer_response_case
from .test_r4_original_outside_work_mesa import OUTSIDE, BUYER, QUALITY, ACCEPTED

CLOCKS = {
    "at", "available_at", "expires_at", "valid_from", "valid_until", "slot_start", "slot_end",
    "from_slot", "to_slot", "model_horizon", "prepared_at", "pilot_decision_at",
    "evaluated_decision_at", "assessment_at", "applied_at", "goal_expires_at",
    "interest_valid_until", "technology_route_valid_until", "late_at", "due_at",
    "reported_at", "valuation_horizon", "horizon_end", "observed_at",
    "agreed_at", "new_due_at", "registration_valid_until", "lifecycle_valid_until",
}
STRETCH = 8


def _scaled(value):
    if isinstance(value, list):
        return [_scaled(x) for x in value]
    if isinstance(value, dict):
        return {k: min(v * STRETCH, 10000) if (k in CLOCKS or k.endswith(("_at", "_valid_until", "_expires_at"))) and type(v) is int
                else _scaled(v) for k, v in value.items()}
    return value


def _event(doc, action, work=None):
    rows = [e for e in doc["events"] if e["action"] == action
            and (work is None or e.get("work") == work or e.get("work_spec", {}).get("id") == work)]
    assert len(rows) == 1, (action, work, rows)
    return rows[0]


def _trace(output, action, work=None):
    rows = [e for e in output["trace"] if e["action"] == action
            and (work is None or e.get("work") == work)]
    assert len(rows) == 1, (action, work, rows)
    return rows[0]


def _portfolio_accounts(records):
    controls = {r["field"]: r["control"] for r in records}
    for field, name in (("С", "subjects"), ("ИД", "model_identified")):
        controls[field][name].append(BUYER)
    controls["Рол"]["role_bindings"].append({"subject": BUYER, "items": ["CUSTOMER"]})
    controls["Отв"]["work_responsibilities"] = [
        {"work": OUTSIDE, "work_revision": "outside-d1", "action": r["action"],
         "original_principals": [BUYER]}
        for r in controls["Отв"]["responsibilities"]
    ]


def _prepare_original_portfolio_context(d):
    """Identical prospective code and original four KPB cores in both arms."""
    g = d["general_akis"]
    d["subjects"].append({"id": BUYER, "kind": "SME"})
    _portfolio_accounts(g["organizational_code"])
    for applied in (r for r in d["events"] if r["action"] == "model_code_apply"):
        _portfolio_accounts(applied["model_code_records"])
        digest = original_model_code_fingerprint(applied["model_code_records"])
        for row in d["events"]:
            if row.get("model_code_change_id") == applied["model_code_change_id"]:
                row["model_code_fingerprint"] = digest
    for phase in (1, 2, 4, 7):
        source = next(r for r in g["formation_phases"] if r["phase"] == phase and r["owner"] == "b")
        g["formation_phases"].append(dict(deepcopy(source), owner=BUYER,
                                        source_ref=f"model://{BUYER}/formation-{phase}"))
    personal = next(r for r in g["context_cores"] if r["core"] == "personal")
    g["context_cores"].append(dict(deepcopy(personal), owner=BUYER, recipient=BUYER,
                                     source_ref=f"model://{BUYER}/core-personal",
                                     basis_source="basis-personal-outside"))
    source = next(r for r in d["context_evidence"]["sources"] if r["id"] == "basis-personal")
    d["context_evidence"]["sources"].append(dict(deepcopy(source), id="basis-personal-outside",
                                                    owner=BUYER, usable_by=[BUYER]))
    packet = next(r for r in g["agent_functions"] if r["id"] == "approval-w3")
    g["agent_functions"].append(dict(deepcopy(packet), id="approval-outside", work=OUTSIDE,
                                    work_revision="outside-d1", source_ref="model://op/packet-approval-outside"))
    # The expanded experiment uses real execution windows, not the earlier
    # abstract planning slots of the one-order fixture.
    main = _event(d, "request", "w3")["work_spec"]
    for operation in main["operations"]:
        key = operation["id"]
        starts = [e["at"] for e in d["events"] if e.get("work") == "w3"
                  and e["action"] == "start_operation" and e.get("operation") == key]
        ends = [e["at"] for e in d["events"] if e.get("work") == "w3"
                and e["action"] == "complete_operation" and e.get("operation") == key]
        assert len(starts) == len(ends) == 1, (key, starts, ends)
        operation.update(slot_start=starts[0], slot_end=ends[0]+STRETCH)
    main.update(slot_start=min(o["slot_start"] for o in main["operations"]),
                slot_end=max(o["slot_end"] for o in main["operations"]))
    for adoption in d.get("capability_adoptions", []):
        if "from_slot" in adoption:
            adoption.update(from_slot=main["slot_start"], to_slot=main["slot_end"])
    proposal = _event(d, "technology_route_propose")
    proposal["technology_route_work_spec"] = deepcopy(main)
    digest = technology_route_fingerprint(proposal["technology_route_work_spec"])
    for row in d["events"]:
        if row.get("technology_route_id") == proposal["technology_route_id"]:
            row["technology_route_fingerprint"] = digest
    terms = proposal["technology_route_commercial_terms"]
    terms["route_fingerprint"] = digest
    bind_commercial_terms(d, terms)


def portfolio_trajectories(*, disjoint=False, buyer_declines=False, missing_consent=False,
                           stage="stage-c", buyer_finish_material="140.00",
                           buyer_finish_labor="80.00"):
    original = matched_competing_market_cases(buyer_finish_material=buyer_finish_material,
                                               buyer_finish_labor=buyer_finish_labor)
    docs = {name: _scaled(d) for name, d in original.items()}
    for d in docs.values():
        _prepare_original_portfolio_context(d)
    template = docs["coproduction"]
    main = _event(template, "request", "w3")["work_spec"]
    operation = next(o for o in main["operations"] if o["id"] == "stage-c")
    start, end = operation["slot_start"], operation["slot_end"]
    if disjoint:
        start, end = end, end + (end - start)
    horizon = template["model_horizon"]
    proposal_at = _event(template, "technology_route_propose")["at"]
    occupied = {e["at"] for d in docs.values() for e in d["events"]}
    outside = buyer_response_case(decision="DECLINES_OFFER" if buyer_declines else "WILLING_TO_NEGOTIATE")
    signals = [deepcopy(_event(outside, action)) for action in
               ("outside_demand_signal", "outside_supplier_offer", "outside_buyer_offer_response")]
    demand, offer, response = signals
    for i, row in enumerate(signals, 3):
        row["at"] = proposal_at + i - 6
        assert row["at"] not in occupied
        occupied.add(row["at"])
    demand.update(outside_supplier="c", outside_relation="l2", outside_relation_revision="rel-2",
                  outside_candidate_operation=stage, outside_resource="rc", outside_units=1,
                  outside_slot_start=start, outside_slot_end=end, outside_deliverable="independent-component",
                  outside_price_ceiling="700.00", outside_demand_valid_until=horizon+1)
    offer.update(actor="c", outside_offer_source_ref="model://c/portfolio-independent-offer",
                 outside_offer_price="500.00", outside_offer_resource="rc", outside_offer_units=1,
                 outside_offer_slot_start=start, outside_offer_slot_end=end,
                 outside_offer_deliverable=demand["outside_deliverable"], outside_offer_valid_until=horizon+1)
    response.update(outside_buyer_response_valid_until=horizon+1)
    ext_sources = []
    for owner, row, prefix in ((BUYER, demand, "outside_demand"), ("c", offer, "outside_offer"),
                               (BUYER, response, "outside_buyer_response")):
        ext_sources.append({"id": row[prefix+"_source_ref"], "owner": owner,
                            "revision": row[prefix+"_source_revision"], "status": "CONFIRMED",
                            "usable_by": sorted({BUYER, "c"}), "core": "corporate",
                            "purposes": ["AKIS_EXTERNAL_DEMAND_EVIDENCE"], "operations": ["READ"],
                            "valid_from": 0, "valid_until": horizon+1})
    tick = max(_event(d, "commit", "w3")["at"] for d in docs.values())

    def next_tick(after):
        at = after + 1
        while at in occupied:
            at += 1
        occupied.add(at)
        return at

    tick = next_tick(tick)
    spec = {"id": OUTSIDE, "customer": BUYER, "resource": "rc", "source_revision": "outside-d1",
            "slot_start": start, "slot_end": end, "resource_requirements": [{"resource": "rc", "units": 1}],
            "requires_accepted": ["w2"], "assurance_criteria": [
                {"id": QUALITY, "dimension": "DELIVERABLE_CONFORMITY", "operation": "WORK",
                 "responsible_owner": "c", "assessor": BUYER, "method": "INSPECTION",
                 "source_ref": demand["outside_demand_source_ref"], "source_revision": "outside-d1"}]}
    ext = [{"at": tick, "action": "request", "actor": BUYER, "work_spec": spec,
            "outside_work_origin": {"outside_demand_id": demand["outside_demand_id"],
                                     "outside_offer_id": offer["outside_offer_id"],
                                     "outside_buyer_response_id": response["outside_buyer_response_id"]}}]
    old_to_new = {}
    for event in template["events"]:
        if event.get("work") != "w3" or event["action"] not in {
                "formation_confirm", "function_prepare", "function_review", "offer", "authorize", "consent", "commit"}:
            continue
        row = deepcopy(event)
        if row["action"] == "formation_confirm" and row.get("phase") == 3:
            if row["actor"] != "a":
                continue
            row.update(actor="c", formation_source_ref="model://c/formation-3")
        if row["action"] == "formation_confirm" and (
                row["phase"] in (1, 2) or row.get("formation_core") == "personal"):
            row.update(actor=BUYER, formation_source_ref=f"model://{BUYER}/formation-{row['phase']}")
            if row.get("formation_core") == "personal":
                row["formation_basis_source"] = "basis-personal-outside"
        if row["action"] == "consent":
            row["actor"] = {"a": "c", "b": BUYER}[row["actor"]]
        if row["action"] == "function_review":
            row["actor"] = BUYER
        if row["action"] == "consent" and row["actor"] == "c" and missing_consent:
            continue
        tick = next_tick(tick)
        old_to_new[row["at"]] = tick
        row.update(work=OUTSIDE, at=tick)
        for k in list(row):
            if k.startswith("technology_route_"):
                row.pop(k)
        for k in ("source_revision", "work_source_revision"):
            if row.get(k) == "d-3":
                row[k] = "outside-d1"
        if row.get("function_id") == "approval-w3":
            row["function_id"] = "approval-outside"
        if "function_source_ref" in row:
            row["function_source_ref"] = "model://op/packet-approval-outside"
        if "review_source_ref" in row:
            row["review_source_ref"] = f"model://{BUYER}/independent-review-outside"
        if "prepared_at" in row:
            row["prepared_at"] = old_to_new[row["prepared_at"]]
        ext.append(row)
    assert tick < start, (tick, start)
    tick = next_tick(start)
    result = "model://c/portfolio-independent-result"
    for action, actor, fields in (
            ("start", "c", {}), ("complete", "c", {"result_ref": result}),
            ("assess_result_quality", BUYER, {"criterion": QUALITY, "quality_verdict": "MEETS_DECLARED_REQUIREMENT",
                 "quality_evidence_ref": f"model://{BUYER}/portfolio-quality", "result_ref": result,
                 "source_revision": "outside-d1", "org_revision": "oc-1"}),
            ("accept", BUYER, {})):
        ext.append({"at": tick, "action": action, "actor": actor, "work": OUTSIDE, **fields})
        tick = next_tick(tick)
    assert tick < end, (tick, end)
    more = {"events": deepcopy(ext)}
    _original_rights(more)
    ext = more["events"]
    for row in more["context_evidence"]["sources"]:
        row["valid_until"] = horizon+1
    for d in docs.values():
        d["events"].extend(deepcopy(signals+ext))
        d["events"].sort(key=lambda e: e["at"])
        context = d["context_evidence"]
        context["sources"].extend(deepcopy(ext_sources))
        for field in ("sources", "requirements", "decision_requirements"):
            context[field].extend(deepcopy(more["context_evidence"][field]))
        # Preserve original cost anchors when interleaving new events.
        for row in d["economic_claims"]["lifecycle_costs"]["event_bindings"]:
            row["trace_position"] = next(i for i, e in enumerate(d["events"]) if e["at"] == row["at"])
    return docs


def mechanics(doc):
    d = deepcopy(doc)
    d.pop("economic_claims")
    d.pop("strict_economic_source_works")
    return simulate(d)


def test_original_parallel_independent_order_uses_capacity_released_by_coproduction():
    docs = portfolio_trajectories()
    frozen = deepcopy(docs)
    out = {k: mechanics(d) for k, d in docs.items()}
    assert docs == frozen
    for value in out.values():
        assert all(value["works"].get(w, {}).get("result") == ACCEPTED for w in ("w1", "w2", "w3")), [
            (r["at"], r["action"], r.get("work"), r["reason"]) for r in value["trace"] if r["outcome"] == "BLOCKED"]
        assert _trace(value, "request", OUTSIDE)["outcome"] == "APPLIED", [
            (r["at"], r["action"], r.get("work"), r["reason"]) for r in value["trace"] if r["outcome"] == "BLOCKED"]
    assert out["coproduction"]["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"]) for r in out["coproduction"]["trace"] if r["outcome"] == "BLOCKED"]
    assert out["coproduction"]["works"][OUTSIDE]["result"] == ACCEPTED
    assert set(out["coproduction"]["works"][OUTSIDE]["consenting_principals"]) == {BUYER, "c"}
    commit = _trace(out["coproduction"], "commit", OUTSIDE)
    assert commit["org_code_model_accountable_original_subjects"] == [BUYER]
    denied = _trace(out["supplier"], "commit", OUTSIDE)
    assert denied["reason"] == "RESOURCE_CAPACITY_EXCEEDED", denied
    witness = denied["original_named_capacity_conflict"]
    assert witness["competing_work"] == "w3"
    assert witness["capacity_violation_removed_by_named_work_absence"]
    assert witness["original_reservations_unchanged"]
    assert out["supplier"]["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"
    assert out["supplier"]["works"][OUTSIDE]["result"] != ACCEPTED


@pytest.mark.parametrize("kwargs,reason", [
    ({"buyer_declines": True}, "OUTSIDE_BUYER_INDEPENDENTLY_DECLINED_OFFER"),
    ({"stage": "stage-a"}, "OUTSIDE_WORK_RESOURCE_NOT_IN_ORIGINAL_STAGE_CATALOGUE"),
])
def test_original_independent_second_order_needs_own_demand_and_stage_catalogue(kwargs, reason):
    out = mechanics(portfolio_trajectories(**kwargs)["coproduction"])
    assert _trace(out, "request", OUTSIDE)["reason"] == reason
    assert OUTSIDE not in out["works"]
    assert out["works"]["w3"]["result"] == ACCEPTED


def test_original_independent_second_order_cannot_borrow_technology_route_consent():
    out = mechanics(portfolio_trajectories(missing_consent=True)["coproduction"])
    assert _trace(out, "commit", OUTSIDE)["reason"] == "INDEPENDENT_ACCEPTANCE_MISSING"
    assert out["works"]["w3"]["result"] == ACCEPTED
    assert out["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"


def test_independent_second_order_different_intervals_are_not_automatically_excluded():
    docs = portfolio_trajectories(disjoint=True)
    for doc in docs.values():
        out = mechanics(doc)
        assert out["counts"]["blocked"] == 0, [
            (r["at"], r["action"], r.get("work"), r["reason"])
            for r in out["trace"] if r["outcome"] == "BLOCKED"]
        assert out["works"][OUTSIDE]["result"] == ACCEPTED
        assert out["works"]["w3"]["result"] == ACCEPTED


def finance_portfolio(*, disjoint=False, outside_material="180.00",
                      outside_observed="7", outside_opening="1000.00",
                      seller_opening="400.00", buyer_finish_material="140.00",
                      buyer_finish_labor="80.00"):
    """Same second demand and precommit costs in BOTH original route arms."""
    from .test_r1p_r3_executed_route_economics_mesa import add_original_recipient_value

    docs = portfolio_trajectories(disjoint=disjoint,
                                buyer_finish_material=buyer_finish_material,
                                buyer_finish_labor=buyer_finish_labor)
    for arm, d in docs.items():
        money = d["economic_claims"]
        life = money["lifecycle_costs"]
        horizon = d["model_horizon"]
        commit = _event(d, "commit", OUTSIDE)["at"]
        accept = _event(d, "accept", OUTSIDE)["at"]
        owners = ("a", "b", "c", "op", BUYER)
        coverage = money["coverage"]["COOPERATION"]
        d["strict_economic_source_works"].append(OUTSIDE)
        money["period"] = "FOUR_ORIGINAL_PORTFOLIO_WORKS"

        def evidence(owner, name, *, declare=False, start=0):
            ref = f"model://{owner}/{name}"
            d["context_evidence"]["sources"].append({
                "id": ref, "owner": owner, "revision": "portfolio-finance-v1",
                "status": "CONFIRMED", "usable_by": [owner],
                "core": "operator" if owner == "op" else "corporate",
                "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
                "valid_from": start, "valid_until": horizon+1,
            })
            if declare:
                money["sources"].append({"id": name, "owner": owner, "reference": ref,
                                         "revision": "portfolio-finance-v1"})
            return ref

        coverage[BUYER] = f"market-terms-{BUYER}"
        life["scope_proofs"]["COOPERATION"][BUYER] = coverage[BUYER]
        evidence(BUYER, coverage[BUYER], declare=True)
        evidence(BUYER, f"market-receipt-{BUYER}", declare=True)
        money["cash_timing"]["owner_positions"].append({
            "owner": BUYER, "source": coverage[BUYER], "opening_cash": outside_opening,
            "reserve_cash": "100.00",
        })
        next(r for r in money["cash_timing"]["owner_positions"] if r["owner"] == "c")[
            "opening_cash"] = seller_opening

        def cost(name, owner, amount, action, stage, nature="TRANSACTION", bucket="COORDINATION"):
            ident = f"{OUTSIDE}-portfolio-{name}"
            pos, event = next((i, e) for i, e in enumerate(d["events"])
                              if e.get("work", e.get("work_spec", {}).get("id")) == OUTSIDE
                              and e["action"] == action and e["actor"] == owner)
            source = coverage[owner]
            proof = evidence(owner, ident+"-cost")
            money["resource_uses"].append({"id": ident, "scenario": "COOPERATION", "work": OUTSIDE,
                "owner": owner, "source": source, "amount": amount, "bucket": bucket})
            life["bindings"].append({"resource_use_id": ident, "owner": owner, "source": source,
                "stage": stage, "nature": nature})
            life["event_bindings"].append({"resource_use_id": ident, "work": OUTSIDE, "owner": owner,
                "source": source, "work_source_revision": "outside-d1", "trace_position": pos,
                "at": event["at"], "action": action, "org_revision": "oc-1",
                "cost_evidence_ref": proof, "cost_evidence_revision": "portfolio-finance-v1"})

        def transfer(name, payer, payee, amount, condition, at):
            ident = f"{OUTSIDE}-portfolio-{name}"
            parties = {payer, payee} - {"EXTERNAL"}
            witnesses = {o: coverage[o] for o in sorted(parties)}
            money["transfers"].append({"id": ident, "scenario": "COOPERATION", "work": OUTSIDE,
                "payer": payer, "payee": payee, "amount": amount, "source": coverage[payer]})
            money["cash_timing"]["transfer_windows"].append({"transfer_id": ident,
                "at": at, "late_at": at, "owner_sources": deepcopy(witnesses)})
            money["work_payment_conditions"].append({"transfer_id": ident, "condition": condition,
                "due_at": at+1, "work_source_revision": "outside-d1", "org_revision": "oc-1",
                "owner_sources": deepcopy(witnesses)})
            if payee != "EXTERNAL" and condition == "ON_CUSTOMER_ACCEPTANCE":
                refs = {o: evidence(o, ident+"-receipt") for o in sorted(parties)}
                money["work_payment_settlement_claims"].append({
                    "id": ident+"-settlement", "transfer_id": ident, "at": at, "amount": amount,
                    "owner_sources": {o: f"market-receipt-{o}" for o in parties}, "evidence_refs": refs,
                    "evidence_revisions": {o: "portfolio-finance-v1" for o in parties},
                    "owner_attestations": {o: {"reported_at": at, "reported_amount": amount}
                                           for o in parties},
                })

        # The independent customer and supplier incurred these costs
        # before the capacity decision regardless of its eventual outcome.
        cost("buyer-prep", BUYER, "10.00", "request", "PARTNER_SEARCH")
        cost("seller-prep", "c", "10.00", "consent", "NEGOTIATION")
        cost("operator-prep", "op", "20.00", "offer", "PARTNER_SEARCH")
        for owner in ("c", "op", BUYER):
            evidence(owner, f"portfolio-uncommitted-scope-{owner}", declare=True, start=commit+1)
        evidence(BUYER, "portfolio-no-order-observation", declare=True, start=commit+1)
        if arm == "coproduction" or disjoint:
            transfer("purchase", BUYER, "c", "500.00", "ON_CUSTOMER_ACCEPTANCE", accept+2)
            transfer("material", "c", "EXTERNAL", outside_material, "ON_ORIGINAL_COMMIT", commit+1)
            transfer("fee", "c", "op", "50.00", "ON_ORIGINAL_COMMIT", commit+2)
            transfer("overhead", "op", "EXTERNAL", "20.00", "ON_ORIGINAL_COMMIT", commit+3)
            cost("labor", "c", "100.00", "start", "PRODUCTION_COORDINATION", "DIRECT_RESOURCE", "DELIVERY")
            cost("coordination", "op", "15.00", "commit", "PRODUCTION_COORDINATION")
            add_original_recipient_value(d, OUTSIDE, baseline="0", observed=outside_observed,
                                         rate="100.00", source_prefix="portfolio-external-value", append=True)
        else:
            money["uncommitted_order_cost_evidence"] = {
                "work": OUTSIDE, "work_revision": "outside-d1",
                "capacity_block": {"at": commit, "resource": "rc", "competing_work": "w3"},
                "owner_scopes": {o: {"source": f"portfolio-uncommitted-scope-{o}",
                    "observed_at": horizon,
                    "resource_use_ids": [r["id"] for r in money["resource_uses"]
                                         if r["work"] == OUTSIDE and r["owner"] == o],
                    "zero_transfer_declared": True, "complete_exclusive_precommit_resource_scope": True}
                    for o in ("c", "op", BUYER)},
                "recipient_no_order_observation": {
                    "source": "portfolio-no-order-observation", "at": horizon, "quantity": "0",
                    "unit": "useful-service-unit", "basis": "OWNER_SERVICE_USE_IN_MATCHED_HORIZON",
                    "valuation_horizon": horizon,
                },
            }
        scopes = {}
        for owner in owners:
            ident = f"portfolio-complete-scope-{owner}"
            evidence(owner, ident, declare=True)
            scopes[owner] = {"source": ident, "observed_at": horizon,
                "transfer_ids": [t["id"] for t in money["transfers"] if t["work"] in {"w3", OUTSIDE}
                                 and owner in {t["payer"], t["payee"]}],
                "resource_use_ids": [r["id"] for r in money["resource_uses"]
                                    if r["work"] in {"w3", OUTSIDE} and r["owner"] == owner],
                "complete_exclusive_portfolio_cost_and_value_scope": True}
        money["portfolio_scope_evidence"] = {"works": ["w3", OUTSIDE], "owner_scopes": scopes}

    # A common source universe before comparison, never substituted owners.
    sources, financial = {}, {}
    for d in docs.values():
        for row in d["context_evidence"]["sources"]:
            assert row["id"] not in sources or sources[row["id"]] == row
            sources[row["id"]] = deepcopy(row)
        for row in d["economic_claims"]["sources"]:
            assert row["id"] not in financial or financial[row["id"]] == row
            financial[row["id"]] = deepcopy(row)
    for d in docs.values():
        d["context_evidence"]["sources"] = list(deepcopy(sources).values())
        d["economic_claims"]["sources"] = list(deepcopy(financial).values())
    return docs


def compare_portfolios(docs):
    from research.akis.qualitative_mesa.comparative_trajectories import compare_original_competing_market_routes
    split = _event(docs["supplier"], "technology_route_propose")["at"] - 1
    return compare_original_competing_market_routes(
        docs, work="w3", secondary_work=OUTSIDE, prior_works=("w1", "w2"), split_at=split)


def test_portfolio_counts_actual_alternative_order_and_retains_failed_preparation_costs():
    docs = finance_portfolio()
    frozen = deepcopy(docs)
    out = {k: simulate(d) for k, d in docs.items()}
    assert docs == frozen
    blocked = out["supplier"]["economics"]["original_uncommitted_order_costs"]
    assert blocked["original_capacity_conflict_applied"] and not blocked["original_independent_refusal_applied"]
    assert blocked["local_research_only"]["total_exclusive_precommit_resource_cost"] == "40.00"
    assert out["coproduction"]["works"][OUTSIDE]["result"] == ACCEPTED
    r = compare_portfolios(docs)
    assert r["status"] == "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS", r
    assert r["original_owner_count"] == 5
    private = r["local_research_only"]
    assert private["arms"]["supplier"]["consolidated_model_contribution"] == "620.00"
    assert private["arms"]["coproduction"]["consolidated_model_contribution"] == "1065.00"
    assert private["pairwise"][0]["left_minus_right_model_contribution"] == "445.00"
    assert private["pairwise"][0]["per_original_owner_left_minus_right"] == {
        "a": "0.00", "b": "180.00", "c": "50.00", "op": "15.00", BUYER: "200.00"}
    assert r["pairwise_contrasts"][0]["left_weak_pareto_improvement_on_portfolio"]
    assert r["empirical_network_additionality"] == "NOT_IDENTIFIABLE"


def test_portfolio_disjoint_windows_keep_both_original_orders_not_fake_displacement():
    r = compare_portfolios(finance_portfolio(disjoint=True, seller_opening="800.00"))
    assert r["status"] == "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS", r
    assert all(a["accepted_original_order_count"] == 2 for a in r["local_research_only"]["arms"].values())
    assert r["local_research_only"]["pairwise"][0]["left_minus_right_model_contribution"] == "60.00"
    assert not r["pairwise_contrasts"][0]["left_weak_pareto_improvement_on_portfolio"]


@pytest.mark.parametrize("change,reason", [
    ("fake_competitor", "UNCOMMITTED_ORDER_ORIGINAL_CAPACITY_CONFLICT_REQUIRED"),
    ("missing_cost", "UNCOMMITTED_ORDER_ALL_ORIGINAL_PRECOMMIT_COSTS_REQUIRED"),
    ("wrong_owner", "PORTFOLIO_ORIGINAL_OWNER_HISTORICAL_SCOPE_NOT_QUALIFIED"),
    ("scope_alias", "PORTFOLIO_INDEPENDENT_NONOVERLAP_SCOPE_REQUIRED"),
])
def test_portfolio_cannot_manufacture_opportunity_cost_or_omit_original_costs(change, reason):
    d = finance_portfolio()["supplier"]
    money = d["economic_claims"]
    if change == "fake_competitor":
        money["uncommitted_order_cost_evidence"]["capacity_block"]["competing_work"] = "w2"
    elif change == "missing_cost":
        money["uncommitted_order_cost_evidence"]["owner_scopes"]["c"]["resource_use_ids"] = []
    elif change == "wrong_owner":
        money["portfolio_scope_evidence"]["owner_scopes"]["c"]["source"] = "portfolio-complete-scope-b"
    else:
        money["portfolio_scope_evidence"]["owner_scopes"]["c"]["source"] = "market-terms-c"
    with pytest.raises(ValueError, match=reason):
        simulate(d)


def test_portfolio_different_precommit_costs_not_a_matched_experiment():
    docs = finance_portfolio()
    row = next(r for r in docs["supplier"]["economic_claims"]["resource_uses"]
               if r["id"] == f"{OUTSIDE}-portfolio-seller-prep")
    row["amount"] = "1.00"
    with pytest.raises(ValueError, match="SECONDARY_DEMAND_PREPARATION_OR_BASELINE_CHANGED"):
        compare_portfolios(docs)


def test_portfolio_no_order_observation_must_match_independent_buyer_baseline():
    docs = finance_portfolio()
    docs["supplier"]["economic_claims"]["uncommitted_order_cost_evidence"][
        "recipient_no_order_observation"]["quantity"] = "1"
    with pytest.raises(ValueError, match="SECONDARY_DEMAND_PREPARATION_OR_BASELINE_CHANGED"):
        compare_portfolios(docs)


def test_portfolio_positive_incremental_value_does_not_override_cumulative_reserve_shortfall():
    r = compare_portfolios(finance_portfolio(outside_opening="500.00"))
    assert r["status"] == "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS", r
    assert r["local_research_only"]["pairwise"][0]["left_minus_right_model_contribution"] == "445.00"
    assert not r["local_research_only"]["arms"]["coproduction"]["all_owner_declared_reserves_met"]
    assert r["best_model_contribution_among_executed_portfolio_viable_routes"] == []


@pytest.mark.parametrize("start,end,units,other,expected", [
    (12, 18, 1, False, True),
    (20, 25, 1, False, False),
    (12, 18, 2, False, False),
    (12, 25, 1, True, False),
])
def test_named_capacity_witness_uses_existing_interval_sweep_without_mutation(start, end, units, other, expected):
    from research.akis.qualitative_mesa.capacity import (
        CapacityLedger, ResourceCapacity, ResourceNeed, Reservation,
    )
    ledger = CapacityLedger({"rc": ResourceCapacity("rc", "c", 1, "UNIT", None, "MODEL_DECLARED")})
    ledger.reserve("w3", [ResourceNeed("rc", 1)], 10, 20)
    if other:
        ledger.reserve("another", [ResourceNeed("rc", 1)], 20, 30)
    old = list(ledger.reservations)
    answer = ledger.explain_named_competing_reservation(
        "outside", [Reservation("rc", "outside", start, end, units)], "w3", "rc")
    assert answer["capacity_violation_removed_by_named_work_absence"] is expected
    assert ledger.reservations == old


@pytest.mark.parametrize("revision,principal,reason", [
    ("wrong-revision", BUYER, "OC_WORK_RESPONSIBILITY_SOURCE_REVISION_MISMATCH"),
    ("outside-d1", "b", "OC_RESPONSIBILITY_NOT_ORIGINAL_PRINCIPAL"),
])
def test_work_scoped_responsibility_cannot_replace_original_work_principal(revision, principal, reason):
    doc = portfolio_trajectories()["coproduction"]

    def change(records):
        control = next(r["control"] for r in records if r["field"] == "Отв")
        row = next(r for r in control["work_responsibilities"] if r["action"] == "commit")
        row.update(work_revision=revision, original_principals=[principal])

    change(doc["general_akis"]["organizational_code"])
    for event in [e for e in doc["events"] if e["action"] == "model_code_apply"]:
        change(event["model_code_records"])
        digest = original_model_code_fingerprint(event["model_code_records"])
        for row in doc["events"]:
            if row.get("model_code_change_id") == event["model_code_change_id"]:
                row["model_code_fingerprint"] = digest
    result = mechanics(doc)
    assert _trace(result, "commit", OUTSIDE)["reason"] == reason
    assert result["works"]["w3"]["result"] == ACCEPTED
    assert result["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"


def test_both_executed_secondary_orders_require_same_own_costs():
    docs = finance_portfolio(disjoint=True, seller_opening="800.00")
    row = next(r for r in docs["supplier"]["economic_claims"]["transfers"]
               if r["id"] == f"{OUTSIDE}-portfolio-material")
    row["amount"] = "181.00"
    with pytest.raises(ValueError, match="PORTFOLIO_SECONDARY_EXECUTED_ECONOMICS_CHANGED"):
        compare_portfolios(docs)


def test_portfolio_scope_cannot_certify_future_use_observation():
    d = finance_portfolio()["coproduction"]
    money = d["economic_claims"]
    money["portfolio_scope_evidence"]["owner_scopes"][BUYER]["observed_at"] = _event(d, "accept", OUTSIDE)["at"]
    with pytest.raises(ValueError, match="PORTFOLIO_INDEPENDENT_NONOVERLAP_SCOPE_REQUIRED"):
        simulate(d)


@pytest.mark.parametrize("kwargs,delta,owner,owner_delta,pareto", [
    ({"outside_material": "260.00"}, "365.00", "c", "-30.00", False),
    ({"outside_observed": "2"}, "-55.00", BUYER, "-300.00", False),
])
def test_portfolio_independent_cost_or_value_can_reverse_owner_or_system_advantage(kwargs, delta, owner, owner_delta, pareto):
    r = compare_portfolios(finance_portfolio(**kwargs))
    assert r["status"] == "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS", r
    pair = r["local_research_only"]["pairwise"][0]
    assert pair["left_minus_right_model_contribution"] == delta
    assert pair["per_original_owner_left_minus_right"][owner] == owner_delta
    assert r["pairwise_contrasts"][0]["left_weak_pareto_improvement_on_portfolio"] is pareto
