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
                           buyer_finish_labor="80.00", outside_price="500.00"):
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
                 outside_offer_price=outside_price, outside_offer_resource="rc", outside_offer_units=1,
                 outside_offer_slot_start=start, outside_offer_slot_end=end,
                 outside_offer_deliverable=demand["outside_deliverable"], outside_offer_valid_until=horizon+1)
    response.update(outside_buyer_response_valid_until=horizon+1)
    if outside_price != "500.00":
        # A different prospective input, not mutation of an accepted order.
        # Both seller offer and buyer response are distinct original sources.
        suffix = outside_price.replace(".", "-")
        offer["outside_offer_id"] += "-repriced-" + suffix
        offer["outside_offer_source_ref"] += "-repriced-" + suffix
        offer["outside_offer_source_revision"] = "repriced-" + suffix
        response["outside_offer_id"] = offer["outside_offer_id"]
        response["outside_offer_source_revision"] = offer["outside_offer_source_revision"]
        response["outside_buyer_response_id"] += "-repriced-" + suffix
        response["outside_buyer_response_source_ref"] += "-repriced-" + suffix
        response["outside_buyer_response_source_revision"] = "repriced-" + suffix
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
                      buyer_finish_labor="80.00", outside_price="500.00"):
    """Same second demand and precommit costs in BOTH original route arms."""
    from .test_r1p_r3_executed_route_economics_mesa import add_original_recipient_value

    docs = portfolio_trajectories(disjoint=disjoint,
                                buyer_finish_material=buyer_finish_material,
                                buyer_finish_labor=buyer_finish_labor,
                                outside_price=outside_price)
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
            transfer("purchase", BUYER, "c", outside_price, "ON_CUSTOMER_ACCEPTANCE", accept+2)
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


def portfolio_price(docs, candidate="coproduction", comparator="supplier", transfer_id=None):
    from research.akis.qualitative_mesa.comparative_trajectories import review_original_portfolio_outside_price_interval
    split = _event(docs["supplier"], "technology_route_propose")["at"] - 1
    return review_original_portfolio_outside_price_interval(
        docs, work="w3", secondary_work=OUTSIDE, prior_works=("w1", "w2"),
        split_at=split, candidate=candidate, comparator=comparator,
        transfer_id=transfer_id or f"{OUTSIDE}-portfolio-purchase")


@pytest.mark.parametrize("kwargs,low,high", [
    ({}, "450.00", "700.00"),
    ({"outside_material": "260.00", "seller_opening": "800.00"}, "530.00", "700.00"),
    ({"outside_opening": "600.00"}, "450.00", "500.00"),
])
def test_outside_portfolio_price_interval_includes_whole_owner_comparison_and_cash_paths(kwargs, low, high):
    docs = finance_portfolio(**kwargs)
    before = deepcopy(docs)
    r = portfolio_price(docs)
    assert docs == before
    assert r["status"] == "MODEL_PORTFOLIO_VALUE_CEILING_AND_RESERVE_PRICE_INTERVAL", r
    private = r["fixed_timing_independent_negotiation"]["local_research_only"]
    assert (private["minimum_purchase_price"], private["maximum_purchase_price"]) == (low, high)
    assert private["original_independent_demand_price_ceiling"] == "700.00"


@pytest.mark.parametrize("kwargs,reason", [
    ({"outside_opening": "500.00"}, "NO_PRICE_SATISFIES_ALL_OWNER_RESERVES_AT_FIXED_TIMING"),
    ({"outside_material": "260.00"}, "NO_PRICE_SATISFIES_ALL_OWNER_RESERVES_AT_FIXED_TIMING"),
    ({"outside_observed": "2"}, "NO_PRICE_SATISFIES_PORTFOLIO_VALUE_AND_DEMAND_CEILING"),
    ({"disjoint": True, "seller_opening": "800.00"}, "NO_PRICE_SATISFIES_PORTFOLIO_VALUE_AND_DEMAND_CEILING"),
])
def test_outside_portfolio_price_does_not_force_mutually_infeasible_redistribution(kwargs, reason):
    r = portfolio_price(finance_portfolio(**kwargs))
    assert r["status"] == reason, r


def test_repriced_independent_offer_is_a_separately_executed_portfolio_not_a_rewritten_payment():
    old = finance_portfolio()
    new = finance_portfolio(outside_price="600.00")
    old_offer = _event(old["coproduction"], "outside_supplier_offer")
    new_offer = _event(new["coproduction"], "outside_supplier_offer")
    assert old_offer["outside_offer_id"] != new_offer["outside_offer_id"]
    assert old_offer["outside_offer_source_revision"] != new_offer["outside_offer_source_revision"]
    assert _event(old["coproduction"], "outside_buyer_offer_response")["outside_buyer_response_id"] != _event(new["coproduction"], "outside_buyer_offer_response")["outside_buyer_response_id"]
    r = compare_portfolios(new)
    assert r["status"] == "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS", r
    delta = r["local_research_only"]["pairwise"][0]
    assert delta["left_minus_right_model_contribution"] == "445.00"
    assert delta["per_original_owner_left_minus_right"]["c"] == "150.00"
    assert delta["per_original_owner_left_minus_right"][BUYER] == "100.00"
    assert portfolio_price(old)["local_research_only"]["current_purchase_price"] == "500.00"


def test_outside_price_interval_requires_executed_original_purchase():
    docs = finance_portfolio()
    with pytest.raises(ValueError, match="PORTFOLIO_PRICE_EXECUTED_SECONDARY_ORDER_REQUIRED"):
        portfolio_price(docs, candidate="supplier", comparator="coproduction")
    with pytest.raises(ValueError, match="PORTFOLIO_PRICE_ORIGINAL_SECONDARY_PURCHASE_REQUIRED"):
        portfolio_price(docs, transfer_id=f"{OUTSIDE}-portfolio-fee")


def test_outside_price_ceiling_source_must_remain_readable_for_portfolio_projection():
    doc = finance_portfolio()["coproduction"]
    demand = _event(doc, "outside_demand_signal")
    source = next(s for s in doc["context_evidence"]["sources"] if s["id"] == demand["outside_demand_source_ref"])
    source["valid_until"] = doc["model_horizon"]-1
    with pytest.raises(ValueError, match="OUTSIDE_WORK_ORIGINAL_OFFER_PRICE_SOURCE_NOT_READABLE"):
        simulate(doc)


def stage_outlook(doc, *, cooperative_receipts="400.00", cooperative_cost="160.00", outside_receipts="500.00"):
    """A separate owner-authored prospective declaration, not final accounting."""
    from .test_r4_independent_external_buyer_demand_mesa import owner_outlook

    forecast = deepcopy(owner_outlook(buyer_response_case()))
    demand = _event(doc, "outside_demand_signal")
    offer = _event(doc, "outside_supplier_offer")
    response = _event(doc, "outside_buyer_offer_response")
    start = _event(doc, "request", "w3")["at"]
    source = "model://c/portfolio-precommit-economic-outlook"
    forecast.update(owner="c", relation="l2", relation_source_revision="rel-2",
                    work="w3", work_source_revision="d-3", org_revision="oc-1",
                    available_at=start, expires_at=doc["model_horizon"]+1,
                    source_ref=source, source_revision="stage-outlook-v1",
                    period="SAME_DECLARED_PORTFOLIO_HORIZON",
                    outside_capacity_probe={"resource": "rc", "units": 1,
                                            "slot_start": demand["outside_slot_start"],
                                            "slot_end": demand["outside_slot_end"]},
                    outside_demand_claim={"signal_id": demand["outside_demand_id"],
                                          "deliverable": demand["outside_deliverable"],
                                          "quality_basis": demand["outside_quality_basis"]},
                    outside_offer_claim=offer["outside_offer_id"],
                    outside_buyer_response_claim=response["outside_buyer_response_id"],
                    minimum_extra_cash="0.00")
    for key in forecast["cash"]:
        forecast["cash"][key] = {k: "0.00" for k in forecast["cash"][key]}
    forecast["cash"]["COOPERATION"]["member_supply_receipts"] = cooperative_receipts
    forecast["cash"]["COOPERATION"]["production_cash"] = cooperative_cost
    forecast["cash"]["INDEPENDENT_ALTERNATIVE"]["external_sales"] = outside_receipts
    forecast["cash"]["INDEPENDENT_ALTERNATIVE"]["production_cash"] = "180.00"
    doc["economic_outlooks"] = [forecast]
    doc["context_evidence"]["sources"].append({
        "id": source, "owner": "c", "revision": "stage-outlook-v1", "status": "CONFIRMED",
        "usable_by": ["c"], "core": "corporate", "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"],
        "operations": ["READ"], "valid_from": start, "valid_until": doc["model_horizon"]+1,
    })
    return doc


def stage_owner_observations(output):
    return [r for r in output["decision_observations"] if r.get("subject") == "c"
            and r.get("work") == "w3" and "economic_position" in r]


@pytest.mark.parametrize("cost,position", [("160.00", "OUTSIDE_PREFERRED"),
                                          ("50.00", "COOPERATION_PREFERRED")])
def test_independent_supplier_precommit_stage_outlook_uses_own_forecast_not_future_ledger(cost, position):
    doc = stage_outlook(portfolio_trajectories()["supplier"], cooperative_cost=cost)
    out = mechanics(doc)
    tick = _event(doc, "commit", "w3")["at"]
    rows = stage_owner_observations(out)
    assert any(r["at"] < tick and r["economic_position"] == position for r in rows), rows
    assert not any(r["at"] >= tick and r["economic_position"] in {"COOPERATION_PREFERRED", "OUTSIDE_PREFERRED"}
                   for r in rows)
    assert out["works"]["w3"]["result"] == ACCEPTED
    assert out["works"][OUTSIDE]["obligation"] == "NOT_ACCEPTED"
    assert all(r["economic_values"] == "NOT_REDISCLOSED" for r in rows)
    assert not any(w.startswith("__akis_outside_candidate__") for w in out["works"])


def test_disjoint_stage_forecast_cannot_treat_both_compatible_orders_as_mutually_exclusive():
    doc = stage_outlook(portfolio_trajectories(disjoint=True)["supplier"])
    out = mechanics(doc)
    tick = _event(doc, "commit", "w3")["at"]
    rows = stage_owner_observations(out)
    assert any(r["at"] < tick and r["economic_reason"] ==
               "OUTSIDE_STAGE_BOTH_WORKS_CAPACITY_COMPATIBLE_PORTFOLIO_REQUIRED" for r in rows), rows
    assert not any(r["economic_position"] in {"COOPERATION_PREFERRED", "OUTSIDE_PREFERRED"} for r in rows)
    assert out["works"][OUTSIDE]["result"] == ACCEPTED


def test_stage_forecast_buyer_decline_cannot_be_replaced_by_sellers_cash_optimism():
    doc = stage_outlook(portfolio_trajectories(buyer_declines=True)["supplier"])
    out = mechanics(doc)
    rows = stage_owner_observations(out)
    assert any(r["economic_reason"] == "OUTSIDE_BUYER_INDEPENDENTLY_DECLINED_OFFER" for r in rows), rows
    assert not any(r["economic_position"] in {"COOPERATION_PREFERRED", "OUTSIDE_PREFERRED"} for r in rows)
    assert out["works"]["w3"]["result"] == ACCEPTED
    assert OUTSIDE not in out["works"]


def test_stage_forecast_cannot_invent_cooperation_receipt_above_original_quote():
    doc = stage_outlook(portfolio_trajectories()["supplier"], cooperative_receipts="650.00")
    out = mechanics(doc)
    rows = stage_owner_observations(out)
    assert any(r["economic_reason"] == "OUTSIDE_STAGE_ORIGINAL_COOPERATION_QUOTE_NOT_QUALIFIED" for r in rows), rows
    assert not any(r["economic_position"] in {"COOPERATION_PREFERRED", "OUTSIDE_PREFERRED"} for r in rows)
    assert out["works"]["w3"]["result"] == ACCEPTED


def test_stage_forecast_is_invariant_to_later_original_recipient_acceptance():
    doc = stage_outlook(portfolio_trajectories()["supplier"])
    changed = deepcopy(doc)
    accept = _event(changed, "accept", "w3")
    changed["events"].remove(accept)
    tick = _event(doc, "commit", "w3")["at"]
    original, counterfactual = mechanics(doc), mechanics(changed)
    def before(out):
        return [(r["at"], r["economic_position"], r["economic_reason"])
                for r in stage_owner_observations(out) if r["at"] < tick]
    assert before(original) == before(counterfactual)
    assert any(position == "OUTSIDE_PREFERRED" for _, position, _ in before(original))
    assert original["works"]["w3"]["result"] == ACCEPTED
    assert counterfactual["works"]["w3"]["result"] != ACCEPTED


def installment_portfolio(*, advance="300.00", late_advance=False, scheduled=True,
                          outside_opening="1000.00"):
    """Separately execute the same physical portfolio at a fresh commercial edition."""
    docs = finance_portfolio(outside_material="260.00", outside_price="600.00",
                             outside_opening=outside_opening)
    # Pay material strictly AFTER the potential advance in both schedules.
    # A same-tick credit cannot be assumed to precede an outgoing payment.
    for doc in docs.values():
        commit = _event(doc, "commit", OUTSIDE)["at"]
        for window in doc["economic_claims"]["cash_timing"]["transfer_windows"]:
            if window["transfer_id"] == f"{OUTSIDE}-portfolio-material":
                window.update(at=commit+2, late_at=commit+2)
    if not scheduled:
        return docs
    from decimal import Decimal
    total = Decimal("600.00")
    for doc in docs.values():
        offer = _event(doc, "outside_supplier_offer")
        response = _event(doc, "outside_buyer_offer_response")
        request = _event(doc, "request", OUTSIDE)
        commit = _event(doc, "commit", OUTSIDE)["at"]
        start = _event(doc, "start", OUTSIDE)["at"]
        accept = _event(doc, "accept", OUTSIDE)["at"]
        suffix = "-installment-" + advance.replace(".", "-") + ("-late" if late_advance else "")
        for event, prefix, id_field in (
            (offer, "outside_offer", "outside_offer_id"),
            (response, "outside_buyer_response", "outside_buyer_response_id"),
        ):
            old_ref = event[prefix+"_source_ref"]
            event[id_field] += suffix
            event[prefix+"_source_ref"] += suffix
            event[prefix+"_source_revision"] += suffix
            for source in doc["context_evidence"]["sources"]:
                if source["id"] == old_ref:
                    source.update(id=event[prefix+"_source_ref"],
                                  revision=event[prefix+"_source_revision"])
            request["outside_work_origin"][id_field] = event[id_field]
        response["outside_offer_id"] = offer["outside_offer_id"]
        response["outside_offer_source_revision"] = offer["outside_offer_source_revision"]
        installments = [
            {"condition": "ON_ORIGINAL_COMMIT", "amount": advance,
             "at": commit+1, "due_at": commit+1,
             "late_at": accept+2 if late_advance else commit+1},
            {"condition": "ON_CUSTOMER_ACCEPTANCE", "amount": f"{total-Decimal(advance):.2f}",
             "at": accept+2, "due_at": accept+3, "late_at": accept+2},
        ]
        assert commit+1 < start
        offer["outside_offer_installments"] = deepcopy(installments)
        response["outside_buyer_response_installments"] = deepcopy(installments)
        money = doc["economic_claims"]
        purchase = f"{OUTSIDE}-portfolio-purchase"
        # These new receipt sources exist in the common source universe of
        # both arms, but a blocked Work has no claims or transfers.
        original = next(r for r in money["work_payment_settlement_claims"]
                        if r["transfer_id"] == purchase) if doc is docs["coproduction"] else None
        for part, item in enumerate(installments):
            refs = {o: f"model://{o}/portfolio-installment{suffix}-{part}" for o in (BUYER, "c")}
            for owner, source in refs.items():
                doc["context_evidence"]["sources"].append({
                    "id": source, "owner": owner, "revision": "portfolio-finance-v1",
                    "status": "CONFIRMED", "usable_by": [owner], "core": "corporate",
                    "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
                    "valid_from": item["at"], "valid_until": doc["model_horizon"]+1,
                })
            if original is not None:
                report = deepcopy(original)
                report.update(id=purchase+suffix+"-"+str(part), at=item["at"],
                              amount=item["amount"], evidence_refs=refs,
                              owner_attestations={o: {"reported_at": item["at"],
                                                      "reported_amount": item["amount"]} for o in refs})
                money["work_payment_settlement_claims"].append(report)
        if original is not None:
            money["work_payment_settlement_claims"].remove(original)
            term = next(r for r in money["work_payment_conditions"] if r["transfer_id"] == purchase)
            term["condition"] = "ON_ORIGINAL_COMMIT"
    return docs


def test_independent_installments_are_one_original_purchase_with_consistent_owner_and_network_clock():
    base = compare_portfolios(installment_portfolio(scheduled=False))
    docs = installment_portfolio()
    frozen = deepcopy(docs)
    result = compare_portfolios(docs)
    assert docs == frozen
    assert result["status"] == "MODEL_MATCHED_EXECUTED_MULTI_ORDER_PORTFOLIOS", result
    old = base["local_research_only"]["arms"]["coproduction"]
    new = result["local_research_only"]["arms"]["coproduction"]
    assert old["consolidated_model_contribution"] == new["consolidated_model_contribution"]
    assert old["per_owner_model_contribution"] == new["per_owner_model_contribution"]
    assert not old["all_owner_declared_reserves_met"]
    assert new["all_owner_declared_reserves_met"]
    assert result["local_research_only"]["pairwise"][0]["left_minus_right_model_contribution"] == "365.00"
    assert "coproduction" in result["best_model_contribution_among_executed_portfolio_viable_routes"]
    out = simulate(docs["coproduction"])["economics"]
    cash = out["cash_timing"]
    assert cash["original_agreed_installment_transfer_count"] == 1
    joint = cash["joint_network_settlement"]["scenarios"]["COOPERATION"]
    assert joint["internal_cash_nets_to_zero_at_every_tick"]
    assert joint["sum_owner_cash_changes_equals_original_external_cash_at_every_tick"]
    for owner in ("a", "b", "c", "op", BUYER):
        expected = cash["per_original_owner_private_research_projection"][owner]["scenario_paths"]["COOPERATION"]["expected"]
        network = joint["per_original_owner_private_research_projection"][owner]
        assert expected == network["expected"] == network["claim_adjusted_expected"]
    assert portfolio_price(docs)["status"] == "INSTALLMENT_REPRICING_REQUIRES_NEW_SCHEDULE_AND_OFFER"


def test_late_installment_receipt_does_not_erase_independent_reserve_risk():
    out = simulate(installment_portfolio(late_advance=True)["coproduction"])["economics"]
    cash = out["cash_timing"]
    seller = cash["per_original_owner_private_research_projection"]["c"]["scenario_paths"]["COOPERATION"]
    assert seller["expected"]["status"] == "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    assert seller["declared_late_case"]["status"] != "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS"
    assert not out["original_portfolio_economics"]["all_owner_declared_reserves_met"]


@pytest.mark.parametrize("change", ["missing_receipt", "amount", "unqualified_source", "wrong_condition",
                                    "due", "wrong_time"])
def test_independent_installments_require_exact_original_terms_and_own_receipt_evidence(change):
    d = installment_portfolio()["coproduction"]
    money = d["economic_claims"]
    purchase = f"{OUTSIDE}-portfolio-purchase"
    report = next(r for r in money["work_payment_settlement_claims"] if r["transfer_id"] == purchase)
    term = next(r for r in money["work_payment_conditions"] if r["transfer_id"] == purchase)
    if change == "missing_receipt":
        money["work_payment_settlement_claims"].remove(report)
    elif change == "amount":
        report["amount"] = "299.00"
    elif change == "unqualified_source":
        ref = report["evidence_refs"]["c"]
        next(r for r in d["context_evidence"]["sources"] if r["id"] == ref)["usable_by"] = [BUYER]
    elif change == "wrong_condition":
        term["condition"] = "ON_CUSTOMER_ACCEPTANCE"
    elif change == "due":
        term["due_at"] += 1
    else:
        report["at"] += 1
    with pytest.raises(ValueError):
        simulate(d)


@pytest.mark.parametrize("change", ["wrong_sum", "wrong_buyer", "missing_echo", "due_after_start"])
def test_independent_installment_offer_and_response_are_original_party_editions(change):
    d = installment_portfolio()["coproduction"]
    offer = _event(d, "outside_supplier_offer")
    response = _event(d, "outside_buyer_offer_response")
    if change == "wrong_sum":
        offer["outside_offer_installments"][0]["amount"] = "1.00"
    elif change == "wrong_buyer":
        response["outside_buyer_response_installments"][0]["late_at"] += 1
    elif change == "missing_echo":
        response.pop("outside_buyer_response_installments")
    else:
        due = _event(d, "start", OUTSIDE)["at"]
        offer["outside_offer_installments"][0]["due_at"] = due
        response["outside_buyer_response_installments"][0]["due_at"] = due
    out = mechanics(d)
    assert out["works"].get(OUTSIDE, {}).get("result") != ACCEPTED
    assert out["works"]["w3"]["result"] == ACCEPTED


def test_executed_activity_efficiency_separates_cost_use_value_and_owner_balance():
    docs = finance_portfolio()
    before = deepcopy(docs)
    view = compare_portfolios(docs)["local_research_only"]["activity_efficiency"]
    assert docs == before
    assert view["no_route_search_ranking_or_owner_decision"]
    supplier = view["arms"]["supplier"]
    coop = view["arms"]["coproduction"]
    for arm, use, cost, balance, ratio in (
        (supplier, "1500.00", "880.00", "620.00", "1.7045"),
        (coop, "2200.00", "1135.00", "1065.00", "1.9383"),
    ):
        total = arm["consolidated"]
        assert total["gross_incremental_recipient_use_value"] == use
        assert total["external_outflows_plus_exclusive_resource_cost"] == cost
        assert total["model_economic_contribution"] == balance
        assert total["use_value_to_cost_ratio"] == ratio
        assert arm["accounting_profit_actual_productivity_and_causal_effect"] == "NOT_IDENTIFIABLE"
        assert arm["per_original_owner"]["a"]["model_cash_resource_balance"] == "250.00"
        assert arm["per_original_owner"]["a"]["nonrecipient_balance_to_declared_inflows_ratio"] == "0.3571"
        assert arm["per_original_owner"]["b"]["nonrecipient_balance_to_declared_inflows_ratio"] is None
        assert arm["per_original_owner"][BUYER]["nonrecipient_balance_to_declared_inflows_ratio"] is None
    assert supplier["consolidated"]["exclusive_noncash_resource_cost"] == "370.00"
    assert coop["consolidated"]["exclusive_noncash_resource_cost"] == "465.00"
    assert supplier["exclusive_resource_cost_by_nature"]["TRANSACTION"] == "120.00"
    assert coop["exclusive_resource_cost_by_nature"]["TRANSACTION"] == "135.00"
    assert supplier["per_original_work"][OUTSIDE]["precommit_exclusive_resource_cost"] == "40.00"
    assert supplier["per_original_work"][OUTSIDE]["model_economic_contribution"] == "-40.00"
    assert supplier["per_original_work"][OUTSIDE]["request_to_accept_model_ticks"] is None
    assert coop["per_original_work"][OUTSIDE]["precommit_exclusive_resource_cost"] == "40.00"
    assert coop["per_original_work"][OUTSIDE]["model_economic_contribution"] == "345.00"
    assert coop["per_original_work"][OUTSIDE]["request_to_accept_model_ticks"] > 0
    assert supplier["per_original_owner"]["op"]["model_cash_resource_balance"] == "0.00"
    assert coop["per_original_owner"]["op"]["model_cash_resource_balance"] == "15.00"
    assert coop["per_original_owner"]["op"]["nonrecipient_balance_to_declared_inflows_ratio"] == "0.1000"


@pytest.mark.parametrize("kwargs,expected_delta,accepted_delta,second_delta", [
    ({}, "445.00", 1, "385.00"),
    ({"outside_material": "260.00"}, "365.00", 1, "305.00"),
    ({"outside_observed": "2"}, "-55.00", 1, "-115.00"),
    ({"disjoint": True, "seller_opening": "800.00"}, "60.00", 0, "0.00"),
])
def test_observed_activity_decomposition_can_confirm_or_falsify_efficiency(
        kwargs, expected_delta, accepted_delta, second_delta):
    report = compare_portfolios(finance_portfolio(**kwargs))
    view = report["local_research_only"]["activity_efficiency"]
    effect = view["pairwise"][0]
    assert effect["left_minus_right_consolidated"]["model_economic_contribution"] == expected_delta
    assert effect["left_minus_right_accepted_work_count"] == accepted_delta
    assert effect["left_minus_right_by_original_work"]["w3"]["model_economic_contribution"] == "60.00"
    assert effect["left_minus_right_by_original_work"][OUTSIDE]["model_economic_contribution"] == second_delta
    assert effect["left_minus_right_by_original_work"]["w3"][
        "external_outflows_plus_exclusive_resource_cost"] == "-60.00"
    for arm in view["arms"].values():
        assert arm["capacity_measure"] == "PLANNED_RESERVATION_WITHIN_MODEL_HORIZON_NOT_ACTUAL_MACHINE_TIME"
    if not kwargs:
        assert view["arms"]["supplier"]["reserved_capacity_unit_ticks_by_resource"]["rc"] == (
            view["arms"]["coproduction"]["reserved_capacity_unit_ticks_by_resource"]["rc"])
        assert effect["left_minus_right_reserved_capacity_unit_ticks_by_resource"]["rc"] == 0


def test_internal_purchase_price_changes_owner_distribution_not_system_efficiency():
    before = compare_portfolios(finance_portfolio())["local_research_only"]["activity_efficiency"]
    after = compare_portfolios(finance_portfolio(outside_price="600.00"))[
        "local_research_only"]["activity_efficiency"]
    a, b = (r["arms"]["coproduction"] for r in (before, after))
    assert a["consolidated"] == b["consolidated"]
    assert a["exclusive_resource_cost_by_stage"] == b["exclusive_resource_cost_by_stage"]
    assert a["internal_transfer_turnover_not_system_output"] != b["internal_transfer_turnover_not_system_output"]
    assert a["per_original_owner"]["c"]["model_economic_contribution"] != b["per_original_owner"]["c"]["model_economic_contribution"]


def test_same_price_new_financial_timing_changes_reserves_not_declared_economic_efficiency():
    old = compare_portfolios(installment_portfolio(scheduled=False))
    new = compare_portfolios(installment_portfolio())
    a, b = (r["local_research_only"]["activity_efficiency"]["arms"]["coproduction"]
            for r in (old, new))
    assert a == b
    assert not old["local_research_only"]["arms"]["coproduction"]["all_owner_declared_reserves_met"]
    assert new["local_research_only"]["arms"]["coproduction"]["all_owner_declared_reserves_met"]


def test_order_and_portfolio_measurement_preserve_distinct_cost_boundaries():
    out = simulate(finance_portfolio()["coproduction"])["economics"]
    order = out["original_market_order_economics"]["local_research_only"]["activity_efficiency"]
    portfolio = out["original_portfolio_economics"]["local_research_only"]["activity_efficiency"]
    assert order["selected_original_work_count"] == 1
    assert portfolio["selected_original_work_count"] == 2
    assert order["consolidated"]["model_economic_contribution"] == "720.00"
    assert portfolio["consolidated"]["model_economic_contribution"] == "1065.00"
    assert order["per_original_work"]["w3"] == portfolio["per_original_work"]["w3"]


def original_quality_recovery_portfolio(*, recovery=True, declare_cost=True,
                                       seller_cost="90.00", buyer_cost="20.00"):
    """Same accepted order, independently inspected before and after resubmission.

    No new physical execution/reservation or hypothetical additional sale is
    inferred from the original resubmit action. Cost statements are exclusive
    resource uses of correcting the submitted result and repeat inspection.
    """
    d = finance_portfolio()["coproduction"]
    money = d["economic_claims"]
    events = d["events"]
    first = _event(d, "assess_result_quality", OUTSIDE)
    accept = _event(d, "accept", OUTSIDE)
    initial_accept = accept["at"]
    occupied = {e["at"] for e in events}

    def next_tick(after):
        tick = after+1
        while tick in occupied:
            tick += 1
        occupied.add(tick)
        return tick

    resubmission_at = next_tick(initial_accept)
    second_assessment_at = next_tick(resubmission_at)
    final_accept_at = next_tick(second_assessment_at)
    horizon = d["model_horizon"]
    assert final_accept_at+4 < horizon
    correction_ref = first["result_ref"] + "-revision-2"
    reject = dict(accept, action="reject")
    resubmit = {"at": resubmission_at, "action": "resubmit", "actor": "c",
                "work": OUTSIDE, "result_ref": correction_ref}
    reinspection = dict(first, at=second_assessment_at, result_ref=correction_ref,
                        quality_evidence_ref=first["quality_evidence_ref"]+"-repeat")
    revised_accept = dict(accept, at=final_accept_at)
    if recovery:
        first["quality_verdict"] = "DOES_NOT_MEET"
        events.remove(accept)
        events.extend([reject, resubmit, reinspection, revised_accept])
        events.sort(key=lambda row: row["at"])
    # The same pre-existing access basis in each arm, not a new IAM.
    extra = {"events": [deepcopy(resubmit)]}
    _original_rights(extra)
    for row in extra["context_evidence"]["sources"]:
        row["valid_until"] = horizon+1
    for name in ("sources", "requirements", "decision_requirements"):
        d["context_evidence"][name].extend(extra["context_evidence"][name])

    # Keep independent model payment dates and use-value observation horizon
    # identical across the two separately executed histories.
    purchase = f"{OUTSIDE}-portfolio-purchase"
    posting = final_accept_at+2
    for row in money["cash_timing"]["transfer_windows"]:
        if row["transfer_id"] == purchase:
            row.update(at=posting, late_at=posting)
    for row in money["work_payment_conditions"]:
        if row["transfer_id"] == purchase:
            row["due_at"] = posting+1
    for row in money["work_payment_settlement_claims"]:
        if row["transfer_id"] == purchase:
            row["at"] = posting
            for statement in row["owner_attestations"].values():
                statement["reported_at"] = posting
    value = next(r for r in money["recipient_use_value_evidence"] if r["work"] == OUTSIDE)
    value["outcome"]["at"] = final_accept_at+1
    if recovery:
        value["result_ref"] = correction_ref

    for owner, name, amount, event in (
            ("c", "result-revision", seller_cost, resubmit),
            (BUYER, "repeat-inspection", buyer_cost, reinspection)):
        ident = f"{OUTSIDE}-quality-{name}"
        proof = f"model://{owner}/{ident}-evidence"
        d["context_evidence"]["sources"].append({
            "id": proof, "owner": owner, "revision": "quality-cost-v1",
            "status": "CONFIRMED", "usable_by": [owner], "core": "corporate",
            "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
            "valid_from": event["at"], "valid_until": horizon+1,
        })
        if not recovery or not declare_cost:
            continue
        source = money["coverage"]["COOPERATION"][owner]
        # The new inspection is positive; its own measurement expense is
        # monitoring, while the result revision is claims/rework.
        money["resource_uses"].append({"id": ident, "scenario": "COOPERATION",
            "work": OUTSIDE, "owner": owner, "source": source,
            "amount": amount, "bucket": "COORDINATION"})
        money["lifecycle_costs"]["bindings"].append({"resource_use_id": ident,
            "owner": owner, "source": source, "stage": (
                "CLAIMS_AND_REWORK" if owner == "c" else "MONITORING_AND_QUALITY"),
            "nature": "TRANSACTION"})
        money["lifecycle_costs"]["event_bindings"].append({
            "resource_use_id": ident, "work": OUTSIDE, "owner": owner, "source": source,
            "work_source_revision": "outside-d1", "trace_position": 0,
            "at": event["at"], "action": event["action"], "org_revision": "oc-1",
            "cost_evidence_ref": proof, "cost_evidence_revision": "quality-cost-v1"})
        money["portfolio_scope_evidence"]["owner_scopes"][owner]["resource_use_ids"].append(ident)
        if owner == BUYER:
            value["resource_use_ids"].append(ident)
    for row in money["lifecycle_costs"]["event_bindings"]:
        row["trace_position"] = next(i for i, e in enumerate(events) if e["at"] == row["at"])
    return d


def _observed_quality_efficiency(doc):
    out = simulate(doc)
    assert out["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"]) for r in out["trace"] if r["outcome"] == "BLOCKED"]
    assert out["works"][OUTSIDE]["result"] == ACCEPTED
    view = out["economics"]["original_portfolio_economics"]
    assert view["status"] == "MODEL_ORIGINAL_MULTI_ORDER_PORTFOLIO_ECONOMICS", view
    return out, view["local_research_only"]["activity_efficiency"]


@pytest.mark.parametrize("seller_cost,buyer_cost,net", [
    ("90.00", "20.00", "955.00"), ("0.00", "0.00", "1065.00"),
    ("1000.00", "100.00", "-35.00"),
])
def test_original_result_recovery_preserves_use_value_but_charges_own_correction_costs(
        seller_cost, buyer_cost, net):
    from decimal import Decimal
    original, before = _observed_quality_efficiency(original_quality_recovery_portfolio(recovery=False))
    doc = original_quality_recovery_portfolio(seller_cost=seller_cost, buyer_cost=buyer_cost)
    frozen = deepcopy(doc)
    out, after = _observed_quality_efficiency(doc)
    assert doc == frozen
    assert before["accepted_original_work_count"] == after["accepted_original_work_count"] == 2
    assert before["accepted_without_prior_result_rejection_count"] == 2
    assert after["accepted_without_prior_result_rejection_count"] == 1
    assert after["accepted_after_result_resubmission_count"] == 1
    assert before["consolidated"]["gross_incremental_recipient_use_value"] == (
        after["consolidated"]["gross_incremental_recipient_use_value"]) == "2200.00"
    assert after["consolidated"]["model_economic_contribution"] == net
    assert before["internal_transfer_turnover_not_system_output"] == after["internal_transfer_turnover_not_system_output"]
    assert before["reserved_capacity_unit_ticks_by_resource"] == after["reserved_capacity_unit_ticks_by_resource"]
    x, y = (v["per_original_work"][OUTSIDE] for v in (before, after))
    assert y["first_submission_to_accept_model_ticks"] > x["first_submission_to_accept_model_ticks"]
    assert y["first_rejection_to_accept_model_ticks"] > 0
    assert y["original_rejected_result_count"] == y["original_resubmission_count"] == 1
    assert y["original_quality_assessment_count"] == 2
    assert y["original_negative_quality_assessment_count"] == 1
    assert y["separately_measured_rework_resource_cost"] == seller_cost
    assert y["resubmission_does_not_establish_physical_rework"]
    assert Decimal(after["per_original_owner"]["c"]["model_cash_resource_balance"]) == (
        Decimal(before["per_original_owner"]["c"]["model_cash_resource_balance"])-Decimal(seller_cost))
    assert Decimal(after["per_original_owner"][BUYER]["model_cash_resource_balance"]) == (
        Decimal(before["per_original_owner"][BUYER]["model_cash_resource_balance"])-Decimal(buyer_cost))
    assert [r for r in original["trace"] if r["action"] == "complete" and r["work"] == OUTSIDE] == [
        r for r in out["trace"] if r["action"] == "complete" and r["work"] == OUTSIDE]


def test_original_recovery_signal_without_separate_cost_measurement_is_not_zero_evidence():
    _, view = _observed_quality_efficiency(
        original_quality_recovery_portfolio(declare_cost=False))
    work = view["per_original_work"][OUTSIDE]
    assert work["claims_and_rework_measurement_status"] == (
        "QUALITY_SIGNAL_WITHOUT_SEPARATE_REWORK_COST_MEASUREMENT")
    assert work["separately_measured_rework_resource_cost"] is None
    assert view["original_quality_signal_without_separately_measured_rework_cost_work_count"] == 1


def test_original_recovered_value_cannot_be_attached_to_rejected_result_revision():
    from research.akis.qualitative_mesa.rules import InputError
    doc = original_quality_recovery_portfolio()
    row = next(r for r in doc["economic_claims"]["recipient_use_value_evidence"] if r["work"] == OUTSIDE)
    row["result_ref"] = _event(doc, "complete", OUTSIDE)["result_ref"]
    with pytest.raises(InputError, match="RECIPIENT_VALUE_ORIGINAL_RESULT_REFERENCE_MISMATCH"):
        simulate(doc)


def resource_disturbance_portfolio(*, disturbed=True, cost="85.00", declared=True):
    """An owner-reported loss of readiness DURING an already started stage.

    Same technology, accepted output, reservation, commercial terms and
    payment schedule. No rework quantity or physical downtime inferred.
    """
    d = finance_portfolio()["coproduction"]
    events = d["events"]
    money = d["economic_claims"]
    start = next(e for e in events if e.get("work") == "w3"
                 and e["action"] == "start_operation" and e["operation"] == "stage-c")
    complete = next(e for e in events if e.get("work") == "w3"
                    and e["action"] == "complete_operation" and e["operation"] == "stage-c")
    request = _event(d, "request", "w3")["work_spec"]
    op = next(o for o in request["operations"] if o["id"] == "stage-c")
    owner = start["actor"]
    resource = op["primary_resource"]
    occupied = {ev["at"] for ev in events}
    free = [tick for tick in range(start["at"]+1, complete["at"]) if tick not in occupied]
    assert len(free) >= 3, (start, complete, free)
    loss_at, blocked_at, restored_at = free[:3]
    if disturbed:
        events.extend([
            {"at": loss_at, "action": "resource_status", "actor": owner,
             "resource": resource, "availability": "UNAVAILABLE"},
            dict(complete, at=blocked_at),
            {"at": restored_at, "action": "resource_status", "actor": owner,
             "resource": resource, "availability": "AVAILABLE"},
        ])
        events.sort(key=lambda row: row["at"])
    ident = "w3-original-readiness-restoration-cost"
    proof = f"model://{owner}/{ident}"
    d["context_evidence"]["sources"].append({
        "id": proof, "owner": owner, "revision": "readiness-cost-v1",
        "status": "CONFIRMED", "usable_by": [owner], "core": "corporate",
        "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
        "valid_from": restored_at, "valid_until": d["model_horizon"]+1,
    })
    if disturbed and declared:
        source = money["coverage"]["COOPERATION"][owner]
        money["resource_uses"].append({
            "id": ident, "scenario": "COOPERATION", "work": "w3",
            "owner": owner, "source": source, "amount": cost, "bucket": "FAILURE"})
        life = money["lifecycle_costs"]
        life["bindings"].append({"resource_use_id": ident, "owner": owner,
            "source": source, "stage": "PRODUCTION_COORDINATION", "nature": "DIRECT_RESOURCE"})
        life["event_bindings"].append({
            "resource_use_id": ident, "work": "w3", "owner": owner, "source": source,
            "work_source_revision": "d-3", "trace_position": 0, "at": restored_at,
            "action": "resource_status", "org_revision": "oc-1",
            "cost_evidence_ref": proof, "cost_evidence_revision": "readiness-cost-v1"})
        money["portfolio_scope_evidence"]["owner_scopes"][owner]["resource_use_ids"].append(ident)
        money["market_order_economics"]["owner_scopes"][owner]["resource_use_ids"].append(ident)
        next(row for row in money["recipient_use_value_evidence"]
             if row["work"] == "w3")["resource_use_ids"].append(ident)
    for row in money["lifecycle_costs"]["event_bindings"]:
        row["trace_position"] = next(i for i, ev in enumerate(events) if ev["at"] == row["at"])
    return d


@pytest.mark.parametrize("cost,net", [("85.00", "980.00"), ("0.00", "1065.00"),
                                     ("1100.00", "-35.00")])
def test_original_started_stage_readiness_loss_and_restoration_have_own_economics(cost, net):
    from decimal import Decimal
    before = simulate(resource_disturbance_portfolio(disturbed=False))
    doc = resource_disturbance_portfolio(cost=cost)
    frozen = deepcopy(doc)
    after = simulate(doc)
    assert doc == frozen
    for result in (before, after):
        assert all(result["works"][key]["result"] == ACCEPTED
                   for key in ("w1", "w2", "w3", OUTSIDE))
        assert result["economics"]["original_portfolio_economics"]["status"] == (
            "MODEL_ORIGINAL_MULTI_ORDER_PORTFOLIO_ECONOMICS")
    blocked = [e for e in after["trace"] if e["outcome"] == "BLOCKED"]
    assert len(blocked) == 1 and blocked[0]["reason"] == "RESOURCE_NOT_AVAILABLE", blocked
    assert blocked[0]["action"] == "complete_operation"
    views = [r["economics"]["original_portfolio_economics"]["local_research_only"]["activity_efficiency"]
             for r in (before, after)]
    a, b = views
    assert a["consolidated"]["gross_incremental_recipient_use_value"] == (
        b["consolidated"]["gross_incremental_recipient_use_value"]) == "2200.00"
    assert b["consolidated"]["model_economic_contribution"] == net
    assert Decimal(b["per_original_owner"]["b"]["model_cash_resource_balance"]) == (
        Decimal(a["per_original_owner"]["b"]["model_cash_resource_balance"])-Decimal(cost))
    assert a["reserved_capacity_unit_ticks_by_resource"] == b["reserved_capacity_unit_ticks_by_resource"]
    assert a["internal_transfer_turnover_not_system_output"] == b["internal_transfer_turnover_not_system_output"]
    work = b["per_original_work"]["w3"]
    readiness = work["original_execution_readiness"]
    assert readiness["any_required_resource_declared_unavailable_model_ticks"] > 0
    assert readiness["all_observed_readiness_interruptions_closed"]
    assert work["separately_declared_resource_restoration_cost"] == cost
    assert work["resource_restoration_cost_record_count"] == 1
    assert readiness["does_not_infer_scrap_rework_lost_output_or_cost"]
    assert a["per_original_work"]["w3"]["request_to_accept_model_ticks"] == (
        work["request_to_accept_model_ticks"])
    for action in ("start_operation", "complete_operation"):
        assert [e for e in before["trace"] if e["action"] == action and
                e["work"] == "w3" and e["outcome"] == "APPLIED"] == [
                e for e in after["trace"] if e["action"] == action and
                e["work"] == "w3" and e["outcome"] == "APPLIED"]


def test_original_readiness_disturbance_without_cost_document_is_not_zero_cost():
    out = simulate(resource_disturbance_portfolio(declared=False))
    work = out["economics"]["original_portfolio_economics"]["local_research_only"][
        "activity_efficiency"]["per_original_work"]["w3"]
    assert work["original_execution_readiness"]["all_observed_readiness_interruptions_closed"]
    assert work["separately_declared_resource_restoration_cost"] is None


@pytest.mark.parametrize("invalid", ["loss", "other_owner", "wrong_stage", "inactive_work"])
def test_original_resource_restoration_cost_cannot_use_unrelated_event_or_owner(invalid):
    from research.akis.qualitative_mesa.rules import InputError
    doc = resource_disturbance_portfolio()
    money = doc["economic_claims"]
    row = next(r for r in money["lifecycle_costs"]["event_bindings"]
               if r["resource_use_id"] == "w3-original-readiness-restoration-cost")
    if invalid == "loss":
        pos, ev = next((i, e) for i, e in enumerate(doc["events"])
                       if e["action"] == "resource_status" and e["availability"] == "UNAVAILABLE")
        row.update(trace_position=pos, at=ev["at"])
    elif invalid == "other_owner":
        row["owner"] = "a"
    elif invalid == "wrong_stage":
        next(r for r in money["lifecycle_costs"]["bindings"]
             if r["resource_use_id"] == row["resource_use_id"])["stage"] = "MONITORING_AND_QUALITY"
    else:
        row["work"] = OUTSIDE
    with pytest.raises(InputError):
        simulate(doc)
