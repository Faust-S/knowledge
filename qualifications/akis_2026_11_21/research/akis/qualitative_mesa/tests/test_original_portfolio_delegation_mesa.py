"""Independent customer mandates on two actual original portfolio orders."""
from copy import deepcopy
from decimal import Decimal
import pytest

from research.akis.qualitative_mesa.mesa_model import simulate
from .test_r3_r4_original_multi_order_portfolio_mesa import finance_portfolio, _event
from .test_r4_original_outside_work_mesa import OUTSIDE, BUYER, ACCEPTED
from .test_original_preparation_pattern_revision_mesa import without_costs
from .test_original_delegation_recovery_mesa import delegation_scope, authority_time

CUSTOMERS = {"w3":"b",OUTSIDE:BUYER}
RATES = {
    "S0":{"human_entry":"5.00","program_fill":"1.00","human_validation":"2.00","packet_overhead":"0.00"},
    "S1":{"human_entry":"5.00","program_fill":"1.00","human_validation":"2.00","packet_overhead":"8.00"},
    "S2":{"human_entry":"5.00","program_fill":"1.00","human_validation":"2.00","packet_overhead":"12.00"},
}


def source(doc, owner, name, revision, purpose, operation, recipients):
    ref = f"model://{owner}/{name}"
    doc["context_evidence"]["sources"].append({
        "id":ref,"owner":owner,"revision":revision,"status":"CONFIRMED",
        "usable_by":recipients,"core":"operator" if owner=="op" else "corporate",
        "purposes":[purpose],"operations":[operation],
        "valid_from":0,"valid_until":doc["model_horizon"]+1,
    })
    return ref


def reserve_original_grant_tick(doc, work):
    prep = _event(doc,"function_prepare",work)
    tick = prep["at"]
    used = {row["at"] for row in doc["events"]}
    if tick-1 not in used:
        return tick-1
    # The independent external order uses closely interleaved original
    # formation events. Reserve one slot by moving only its existing
    # preparation-through-commit suffix; preserve all execution times.
    commit = _event(doc,"commit",work)
    end = commit["at"]
    suffix = [row for row in doc["events"] if row.get("work")==work
              and tick <= row["at"] <= end]
    assert suffix[0] is prep and suffix[-1] is commit
    free = end+1
    while free in used:
        free += 1
    assert free < _event(doc,"start",work)["at"]
    old_times = [r["at"] for r in suffix]
    mapping = dict(zip(old_times,old_times[1:]+[free],strict=True))
    for row in suffix:
        row["at"] = mapping[row["at"]]
        if "prepared_at" in row:
            row["prepared_at"] = mapping[row["prepared_at"]]
    money = doc["economic_claims"]
    for row in money["lifecycle_costs"]["event_bindings"]:
        if row["work"]==work and row["at"] in mapping:
            row["at"] = mapping[row["at"]]
    transfer_ids = {row["id"] for row in money["transfers"] if row["work"]==work}
    commit_transfers = {row["transfer_id"] for row in money["work_payment_conditions"]
                        if row["transfer_id"] in transfer_ids and row["condition"]=="ON_ORIGINAL_COMMIT"}
    delta = free-end
    for row in money["cash_timing"]["transfer_windows"]:
        if row["transfer_id"] in commit_transfers:
            row["at"] += delta
            row["late_at"] += delta
    for row in money["work_payment_conditions"]:
        if row["transfer_id"] in commit_transfers:
            row["due_at"] += delta
    assert not any(row["transfer_id"] in commit_transfers for row in money["work_payment_settlement_claims"])
    return tick


def mandate_portfolio_routes(*, main_cost="12.00", outside_cost="20.00"):
    """Hold existing original commercial terms, production and value fixed."""
    delegated = finance_portfolio(disjoint=True, seller_opening="800.00")["coproduction"]
    money = delegated["economic_claims"]
    life = money["lifecycle_costs"]
    life["preparation_activity_bindings"] = []
    mandate_ids = {}
    for work,owner,amount in (("w3","b",main_cost),(OUTSIDE,BUYER,outside_cost)):
        tick = reserve_original_grant_tick(delegated,work)
        prep = _event(delegated,"function_prepare",work)
        fn = next(row for row in delegated["general_akis"]["agent_functions"]
                  if row["id"]==prep["function_id"] and row["work"]==work)
        assert fn["owner"]=="op"
        fn["requires_original_delegation"] = True
        ref = source(delegated,owner,work+"-independent-preparation-mandate","mandate-v1",
                     "AKIS_DELEGATED_PREPARATION","DERIVE",[owner,"op"])
        g = {"at":tick,"action":"function_delegate","actor":owner,"work":work,
             "org_revision":"oc-1","work_source_revision":fn["work_revision"],
             "function_id":fn["id"],"function_source_ref":fn["source_ref"],
             "delegation_source_ref":ref,"delegation_source_revision":"mandate-v1"}
        delegated["events"].append(g)
        prep["preparation_mode"] = "S2"
        prep["delegation_at"] = tick
        # Replace the SAME original operator coordination cost for this
        # controlled preparation comparison, never add a second copy.
        rid = "w3-market-coordination" if work=="w3" else f"{OUTSIDE}-portfolio-coordination"
        cost = next(row for row in money["resource_uses"] if row["id"]==rid)
        cost["amount"] = "51.00"
        anchor = next(row for row in life["event_bindings"] if row["resource_use_id"]==rid)
        proof = source(delegated,"op",work+"-matched-preparation-cost","activity-v1",
                       "AKIS_ECONOMIC_WORK_EVIDENCE","READ",["op"])
        anchor.update(at=prep["at"],action="function_prepare",cost_evidence_ref=proof,
                      cost_evidence_revision="activity-v1")
        life["preparation_activity_bindings"].append({"resource_use_id":rid,"unit_rates_by_mode":deepcopy(RATES)})
        mandate_id = work+"-independent-mandate-cost"
        mandate_ids[work] = mandate_id
        term = money["coverage"]["COOPERATION"][owner]
        proof = source(delegated,owner,mandate_id+"-proof","cost-v1",
                       "AKIS_ECONOMIC_WORK_EVIDENCE","READ",[owner])
        money["resource_uses"].append({"id":mandate_id,"scenario":"COOPERATION","work":work,
            "owner":owner,"source":term,"amount":amount,"bucket":"COORDINATION"})
        life["bindings"].append({"resource_use_id":mandate_id,"owner":owner,"source":term,
            "stage":"CONTRACT_AND_PERMISSIONS","nature":"TRANSACTION"})
        life["event_bindings"].append({"resource_use_id":mandate_id,"work":work,"owner":owner,
            "source":term,"work_source_revision":fn["work_revision"],"trace_position":0,
            "at":tick,"action":"function_delegate","org_revision":"oc-1",
            "cost_evidence_ref":proof,"cost_evidence_revision":"cost-v1"})
        money["portfolio_scope_evidence"]["owner_scopes"][owner]["resource_use_ids"].append(mandate_id)
        for evidence in money["recipient_use_value_evidence"]:
            if evidence["work"]==work and evidence["owner"]==owner:
                evidence["resource_use_ids"].append(mandate_id)
        if work=="w3":
            money["market_order_economics"]["owner_scopes"][owner]["resource_use_ids"].append(mandate_id)
    from .test_original_delegation_recovery_mesa import reindex,drop_cost
    reindex(delegated)
    direct = deepcopy(delegated)
    direct["events"] = [row for row in direct["events"] if row["action"]!="function_delegate"]
    for work,owner in CUSTOMERS.items():
        prep = _event(direct,"function_prepare",work)
        prep["preparation_mode"]="S1"
        prep.pop("delegation_at")
        next(row for row in direct["general_akis"]["agent_functions"]
             if row["work"]==work and row["id"]==prep["function_id"]).pop("requires_original_delegation")
        rid = "w3-market-coordination" if work=="w3" else f"{OUTSIDE}-portfolio-coordination"
        next(row for row in direct["economic_claims"]["resource_uses"] if row["id"]==rid)["amount"]="83.00"
        drop_cost(direct,mandate_ids[work])
        direct["economic_claims"]["portfolio_scope_evidence"]["owner_scopes"][owner]["resource_use_ids"].remove(mandate_ids[work])
        for evidence in direct["economic_claims"]["recipient_use_value_evidence"]:
            if evidence["work"]==work and evidence["owner"]==owner:
                evidence["resource_use_ids"].remove(mandate_ids[work])
        if work=="w3":
            direct["economic_claims"]["market_order_economics"]["owner_scopes"][owner]["resource_use_ids"].remove(mandate_ids[work])
    reindex(direct)
    return {"DIRECT":direct,"DELEGATED":delegated}


def observe_portfolio_mandates(**kwargs):
    docs = mandate_portfolio_routes(**kwargs)
    frozen=deepcopy(docs)
    outcomes = {arm:simulate(doc) for arm,doc in docs.items()}
    assert docs==frozen
    a,b=outcomes["DIRECT"],outcomes["DELEGATED"]
    assert a["counts"]["blocked"]==b["counts"]["blocked"]==0, [
        (r["at"],r["action"],r["reason"]) for r in b["trace"] if r["outcome"]=="BLOCKED"]
    assert a["works"]==b["works"] and a["capacity"]==b["capacity"]
    assert all(b["works"][key]["result"]==ACCEPTED for key in ("w1","w2","w3",OUTSIDE))
    assert a["economics"]["cash_timing"]==b["economics"]["cash_timing"]
    trace=deepcopy(b["trace"])
    trace=[r for r in trace if r["action"]!="function_delegate"]
    baseline=deepcopy(a["trace"])
    for rows in (trace,baseline):
        for row in rows:
            if row["action"]=="function_prepare" and row["work"] in CUSTOMERS:
                row.pop("model_preparation_activity")
                row.pop("model_original_delegated_preparation",None)
    assert trace==baseline
    payment_a=deepcopy(a["economics"]["work_payment_causality"])
    payment_b=deepcopy(b["economics"]["work_payment_causality"])
    for x,y in zip(payment_a["bindings"],payment_b["bindings"],strict=True):
        ca=x.pop("same_original_work_noncash_resource_use_count")
        cb=y.pop("same_original_work_noncash_resource_use_count")
        assert cb-ca==int(x["original_work"] in CUSTOMERS)
    assert payment_a==payment_b
    views={arm:out["economics"]["original_portfolio_economics"]["local_research_only"]
           for arm,out in outcomes.items()}
    assert views["DIRECT"]["gross_incremental_recipient_use_value"]==views["DELEGATED"]["gross_incremental_recipient_use_value"]
    deltas={o:Decimal(views["DELEGATED"]["per_owner"][o]["model_contribution"])-Decimal(v["model_contribution"])
            for o,v in views["DIRECT"]["per_owner"].items()}
    system=Decimal(views["DELEGATED"]["consolidated_model_contribution"])-Decimal(views["DIRECT"]["consolidated_model_contribution"])
    assert sum(deltas.values(),Decimal(0))==system
    assert deltas["op"]==64
    assert deltas["b"]==-Decimal(kwargs.get("main_cost","12.00"))
    assert deltas[BUYER]==-Decimal(kwargs.get("outside_cost","20.00"))
    assert deltas["a"]==deltas["c"]==0
    cost=b["economics"]["original_delegation_attempt_costs"]["local_research_only"]
    assert cost["aggregate"]["scope_complete"]
    assert cost["aggregate"]["all_preparation_cost"]=="102.00"
    assert Decimal(cost["aggregate"]["all_mandate_cost"])==-deltas["b"]-deltas[BUYER]
    assert cost["aggregate"]["original_work_count"]==2
    assert cost["aggregate"]["original_owner_count_with_applied_grants_or_preparations"]==3
    assert cost["per_original_owner"]["op"]["original_work_count"]==2
    assert cost["per_original_owner"]["op"]["all_combined_cost"]=="102.00"
    assert Decimal(cost["per_original_owner"]["b"]["all_combined_cost"])==-deltas["b"]
    assert Decimal(cost["per_original_owner"][BUYER]["all_combined_cost"])==-deltas[BUYER]
    assert delegation_scope(b)["accepted_effective_preparation_count"]==2
    assert b["economics"]["profit"]=="UNKNOWN"
    return outcomes,deltas,system


@pytest.mark.parametrize("main,outside,expected",[
    ("0.00","0.00","64.00"),
    ("12.00","20.00","32.00"),
    ("32.00","32.00","0.00"),
    ("40.00","48.00","-24.00"),
])
def test_original_portfolio_delegation_separates_system_effect_from_each_owner(main,outside,expected):
    _,deltas,system=observe_portfolio_mandates(main_cost=main,outside_cost=outside)
    assert system==Decimal(expected)
    assert all(v>=0 for v in deltas.values())==(main==outside=="0.00")


def test_independent_outside_customer_mandate_expiry_does_not_block_main_order():
    doc=without_costs(mandate_portfolio_routes()["DELEGATED"])
    g=_event(doc,"function_delegate",OUTSIDE)
    src=next(row for row in doc["context_evidence"]["sources"] if row["id"]==g["delegation_source_ref"])
    src["valid_until"]=g["at"]
    out=simulate(doc)
    assert out["works"][OUTSIDE]["obligation"]=="NOT_ACCEPTED"
    assert out["works"]["w3"]["result"]==ACCEPTED
    prep=next(row for row in out["trace"] if row["work"]==OUTSIDE and row["action"]=="function_prepare")
    assert prep["reason"]=="FORMATION_AGENT_DELEGATION_SOURCE_CONTEXT_SOURCE_EXPIRED"
    assert delegation_scope(out)["accepted_effective_preparation_count"]==1
    assert authority_time(out)["pending_work_model_ticks_without_current_mandate"]>0


def test_main_mandate_expiry_preserves_explicit_stage_comparison_dependency():
    doc=without_costs(mandate_portfolio_routes()["DELEGATED"])
    g=_event(doc,"function_delegate","w3")
    src=next(row for row in doc["context_evidence"]["sources"] if row["id"]==g["delegation_source_ref"])
    src["valid_until"]=g["at"]
    out=simulate(doc)
    assert all(out["works"][key]["result"]==ACCEPTED for key in ("w1","w2"))
    assert out["works"]["w3"]["obligation"]=="NOT_ACCEPTED"
    # This particular outside order is an independent buyer's demand, but
    # its original stage-market comparison explicitly requires the main
    # route's applied commitment. Do not erase that provenance dependency.
    assert OUTSIDE not in out["works"]
    request=next(row for row in out["trace"] if row["work"]==OUTSIDE and row["action"]=="request")
    assert request["outcome"]=="BLOCKED"
    assert request["reason"]=="OUTSIDE_WORK_ORIGINAL_COMMITTED_STAGE_MARKET_REQUIRED"
    assert delegation_scope(out)["accepted_effective_preparation_count"]==0


def test_original_other_customer_grant_cannot_be_reused_on_different_work():
    doc=without_costs(mandate_portfolio_routes()["DELEGATED"])
    _event(doc,"function_prepare",OUTSIDE)["delegation_at"]=_event(doc,"function_delegate","w3")["at"]
    out=simulate(doc)
    assert out["works"]["w3"]["result"]==ACCEPTED
    assert out["works"][OUTSIDE]["obligation"]=="NOT_ACCEPTED"
    prep=next(row for row in out["trace"] if row["work"]==OUTSIDE and row["action"]=="function_prepare")
    assert prep["reason"]=="FORMATION_AGENT_ORIGINAL_DELEGATION_NOT_CURRENT"


def test_original_foreign_mandate_source_does_not_authorize_independent_customer():
    doc=without_costs(mandate_portfolio_routes()["DELEGATED"])
    _event(doc,"function_delegate",OUTSIDE)["delegation_source_ref"]=_event(doc,"function_delegate","w3")["delegation_source_ref"]
    out=simulate(doc)
    assert out["works"]["w3"]["result"]==ACCEPTED
    assert out["works"][OUTSIDE]["obligation"]=="NOT_ACCEPTED"
    grant=next(row for row in out["trace"] if row["work"]==OUTSIDE and row["action"]=="function_delegate")
    assert grant["reason"]=="FORMATION_AGENT_DELEGATION_SOURCE_AUTHOR_ROLE_ORIGINAL_SOURCE_OWNER_REQUIRED"


def test_missing_one_customer_cost_keeps_other_customer_cost_but_not_common_total():
    doc=mandate_portfolio_routes()["DELEGATED"]
    from .test_original_delegation_recovery_mesa import drop_cost
    rid=OUTSIDE+"-independent-mandate-cost"
    drop_cost(doc,rid)
    doc["economic_claims"]["portfolio_scope_evidence"]["owner_scopes"][BUYER]["resource_use_ids"].remove(rid)
    for evidence in doc["economic_claims"]["recipient_use_value_evidence"]:
        if evidence["work"]==OUTSIDE and evidence["owner"]==BUYER:
            evidence["resource_use_ids"].remove(rid)
    out=simulate(doc)
    costs=out["economics"]["original_delegation_attempt_costs"]["local_research_only"]
    assert costs["aggregate"]["all_combined_cost"] is None
    assert costs["by_original_work"][OUTSIDE]["all_combined_cost"] is None
    assert costs["by_original_work"]["w3"]["all_combined_cost"]=="63.00"
    assert costs["per_original_owner"]["b"]["all_combined_cost"]=="12.00"
    assert costs["per_original_owner"][BUYER]["all_combined_cost"] is None
    assert costs["per_original_owner"]["op"]["all_combined_cost"]=="102.00"
    assert not costs["per_original_owner"]["op"]["associated_work_cost_scope_complete"]


def blocked_portfolio_mandate_routes(*, mandate_cost="20.00"):
    """Both preparations really occur, but an earlier reservation blocks Work."""
    delegated=finance_portfolio()["supplier"]
    money=delegated["economic_claims"]
    life=money["lifecycle_costs"]
    tick=reserve_original_grant_tick(delegated,OUTSIDE)
    uncommitted=money["uncommitted_order_cost_evidence"]
    uncommitted["capacity_block"]["at"]=_event(delegated,"commit",OUTSIDE)["at"]
    prep=_event(delegated,"function_prepare",OUTSIDE)
    fn=next(row for row in delegated["general_akis"]["agent_functions"]
            if row["id"]==prep["function_id"] and row["work"]==OUTSIDE)
    fn["requires_original_delegation"]=True
    ref=source(delegated,BUYER,"blocked-portfolio-preparation-mandate","mandate-v1",
               "AKIS_DELEGATED_PREPARATION","DERIVE",[BUYER,"op"])
    grant={"at":tick,"action":"function_delegate","actor":BUYER,"work":OUTSIDE,
           "org_revision":"oc-1","work_source_revision":fn["work_revision"],
           "function_id":fn["id"],"function_source_ref":fn["source_ref"],
           "delegation_source_ref":ref,"delegation_source_revision":"mandate-v1"}
    delegated["events"].append(grant)
    prep.update(preparation_mode="S2",delegation_at=tick)

    # The original 40 precommit expenses are not packet costs. Keep all
    # those rows and declare two distinct additional modeled activities.
    def cost(rid,owner,amount,event,stage):
        term=money["coverage"]["COOPERATION"][owner]
        proof=source(delegated,owner,rid+"-proof","cost-v1",
                     "AKIS_ECONOMIC_WORK_EVIDENCE","READ",[owner])
        money["resource_uses"].append({"id":rid,"scenario":"COOPERATION","work":OUTSIDE,
            "owner":owner,"source":term,"amount":amount,"bucket":"COORDINATION"})
        life["bindings"].append({"resource_use_id":rid,"owner":owner,"source":term,
            "stage":stage,"nature":"TRANSACTION"})
        life["event_bindings"].append({"resource_use_id":rid,"work":OUTSIDE,"owner":owner,
            "source":term,"work_source_revision":fn["work_revision"],"trace_position":0,
            "at":event["at"],"action":event["action"],"org_revision":"oc-1",
            "cost_evidence_ref":proof,"cost_evidence_revision":"cost-v1"})
        uncommitted["owner_scopes"][owner]["resource_use_ids"].append(rid)
        money["portfolio_scope_evidence"]["owner_scopes"][owner]["resource_use_ids"].append(rid)
    prep_id="blocked-portfolio-packet-cost"
    grant_id="blocked-portfolio-mandate-cost"
    cost(prep_id,"op","51.00",prep,"PRODUCTION_COORDINATION")
    cost(grant_id,BUYER,mandate_cost,grant,"CONTRACT_AND_PERMISSIONS")
    life["preparation_activity_bindings"]=[{"resource_use_id":prep_id,"unit_rates_by_mode":deepcopy(RATES)}]
    from .test_original_delegation_recovery_mesa import reindex,drop_cost
    reindex(delegated)
    direct=deepcopy(delegated)
    direct["events"]=[row for row in direct["events"] if row["action"]!="function_delegate"]
    direct_prep=_event(direct,"function_prepare",OUTSIDE)
    direct_prep["preparation_mode"]="S1"
    direct_prep.pop("delegation_at")
    next(row for row in direct["general_akis"]["agent_functions"]
         if row["id"]==fn["id"] and row["work"]==OUTSIDE).pop("requires_original_delegation")
    dm=direct["economic_claims"]
    next(row for row in dm["resource_uses"] if row["id"]==prep_id)["amount"]="83.00"
    drop_cost(direct,grant_id)
    for scope in ("uncommitted_order_cost_evidence","portfolio_scope_evidence"):
        dm[scope]["owner_scopes"][BUYER]["resource_use_ids"].remove(grant_id)
    reindex(direct)
    return {"DIRECT":direct,"DELEGATED":delegated}


def observe_blocked_portfolio_mandate(*, mandate_cost="20.00"):
    docs=blocked_portfolio_mandate_routes(mandate_cost=mandate_cost)
    frozen=deepcopy(docs)
    outs={key:simulate(doc) for key,doc in docs.items()}
    assert docs==frozen
    a,b=outs["DIRECT"],outs["DELEGATED"]
    assert a["works"]==b["works"] and a["capacity"]==b["capacity"]
    assert a["economics"]["cash_timing"]==b["economics"]["cash_timing"]
    for out in (a,b):
        assert out["works"][OUTSIDE]["obligation"]=="NOT_ACCEPTED"
        assert out["works"][OUTSIDE]["result"]=="NOT_SUBMITTED"
        assert all(out["works"][key]["result"]==ACCEPTED for key in ("w1","w2","w3"))
        rejected=out["economics"]["original_uncommitted_order_costs"]
        assert rejected["original_capacity_conflict_applied"]
        assert not rejected["original_accepted_result"]
        assert rejected["independent_zero_transfer_declaration_count"]==3
    costs=[out["economics"]["original_uncommitted_order_costs"]["local_research_only"]
           for out in (a,b)]
    assert costs[0]["total_exclusive_precommit_resource_cost"]=="123.00"
    assert Decimal(costs[1]["total_exclusive_precommit_resource_cost"])==91+Decimal(mandate_cost)
    assert Decimal(costs[1]["per_owner_exclusive_precommit_resource_cost"][BUYER])==10+Decimal(mandate_cost)
    view=delegation_scope(b)
    assert view["applied_mandate_count"]==view["applied_delegated_preparation_count"]==1
    assert view["committed_effective_preparation_count"]==view["accepted_effective_preparation_count"]==0
    cost=b["economics"]["original_delegation_attempt_costs"]["local_research_only"]["by_original_work"][OUTSIDE]
    assert Decimal(cost["all_combined_cost"])==51+Decimal(mandate_cost)
    assert cost["other_combined_cost"]==cost["all_combined_cost"]
    assert cost["accepted_effective_combined_cost"]=="0.00"
    portfolio=[out["economics"]["original_portfolio_economics"]["local_research_only"]
               for out in (a,b)]
    delta=Decimal(portfolio[1]["consolidated_model_contribution"])-Decimal(portfolio[0]["consolidated_model_contribution"])
    assert delta==32-Decimal(mandate_cost)
    assert b["economics"]["profit"]=="UNKNOWN"
    return outs,delta


@pytest.mark.parametrize("cost,expected",[("0.00","32.00"),("20.00","12.00"),("32.00","0.00"),("48.00","-16.00")])
def test_original_uncommitted_order_retains_mandate_cost_without_revenue(cost,expected):
    _,delta=observe_blocked_portfolio_mandate(mandate_cost=cost)
    assert delta==Decimal(expected)


def test_original_uncommitted_order_cannot_hide_applied_mandate_expense():
    doc=blocked_portfolio_mandate_routes()["DELEGATED"]
    doc["economic_claims"]["uncommitted_order_cost_evidence"]["owner_scopes"][BUYER]["resource_use_ids"].remove("blocked-portfolio-mandate-cost")
    from research.akis.qualitative_mesa.rules import InputError
    with pytest.raises(InputError,match="UNCOMMITTED_ORDER_"):
        simulate(doc)
