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
        return {k: min(v * STRETCH, 10000) if k in CLOCKS and type(v) is int
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
    proposal = _event(d, "technology_route_propose")
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
        start, end = start - (end - start), start
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
        assert all(value["works"][w]["result"] == ACCEPTED for w in ("w1", "w2", "w3"))
        assert _trace(value, "request", OUTSIDE)["outcome"] == "APPLIED"
    assert out["coproduction"]["counts"]["blocked"] == 0, [
        (r["at"], r["action"], r["reason"]) for r in out["coproduction"]["trace"] if r["outcome"] == "BLOCKED"]
    assert out["coproduction"]["works"][OUTSIDE]["result"] == ACCEPTED
    assert set(out["coproduction"]["works"][OUTSIDE]["consenting_principals"]) == {BUYER, "c"}
    commit = _trace(out["coproduction"], "commit", OUTSIDE)
    assert commit["org_code_model_accountable_original_subjects"] == [BUYER]
    denied = _trace(out["supplier"], "commit", OUTSIDE)
    assert denied["reason"] == "RESOURCE_CAPACITY_EXCEEDED", denied
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
