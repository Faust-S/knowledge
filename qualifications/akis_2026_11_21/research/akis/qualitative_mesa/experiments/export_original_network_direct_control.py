"""Matched independently EXECUTED operator-AKIS and direct-contract trajectories.

One original Work/Result, CapacityLedger, ContextBasis evaluator and Mesa clock
per trajectory. The independent trajectory has no operator, general AKIS,
agent or common organizational service. COOPERATION is the legacy name of the
executed-side ledger in EACH separate run, not a claim that the control has AKIS.
Rates/fees are explicit controlled inputs, not empirical prices or advice.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
import time

from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.experiments.export_original_network_organization import (
    organization_document, RATES, MODES, _hash_rows,
)
from research.akis.qualitative_mesa.experiments.export_original_network_scale import (
    COOP, ALT, ACCEPTED, verify_network_result,
)

CENT = Decimal("0.01")
ZERO = Decimal(0)
MONEY = re.compile(r"(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?\Z")
PHYSICAL = {"request", "consent", "start", "complete", "accept"}
DIRECT_STAGE = "CONTRACT_AND_PERMISSIONS"


def _amount(value):
    if not isinstance(value, str) or MONEY.fullmatch(value) is None:
        raise ValueError("NETWORK_COMPARISON_EXACT_NONNEGATIVE_AMOUNT_REQUIRED")
    return Decimal(value)


def _str(value):
    return f"{value:.2f}"


def _rebuild_period_scope(doc):
    """Reconcile the declarations to the EXISTING complete owner ledger."""
    money = doc["economic_claims"]
    scope = money["network_period_scope"]
    by_owner_t, by_owner_c = defaultdict(list), defaultdict(list)
    for row in money["transfers"]:
        for owner in (row["payer"], row["payee"]):
            if owner != "EXTERNAL":
                by_owner_t[owner].append(row["id"])
    for row in money["resource_uses"]:
        by_owner_c[row["owner"]].append(row["id"])
    for owner, row in scope["owners"].items():
        row["transfer_ids"] = by_owner_t[owner]
        row["resource_use_ids"] = by_owner_c[owner]
    scope["common_resource_use_ids"] = [r["id"] for r in money["resource_uses"] if r["work"] is None]


def _direct_document(doc, *, mode, tool_cost, rates):
    """Remove AKIS from the SAME initial workload, not from completed output.

    Preserve common model times. The control does not get shared information
    or an operator. Source scope is direct exchange among original owners.
    Existing resource constraints are evaluator invariants, not actor access.
    """
    if mode not in MODES:
        raise ValueError("NETWORK_DIRECT_DOCUMENTATION_MODE_INVALID")
    doc.pop("general_akis")
    doc.pop("network_observation_ticks")
    doc["direct_owner_contracts"] = True
    doc["subjects"] = [r for r in doc["subjects"] if r["id"] != "op"]
    doc["institution"].update(operator=None, founders=[], mode="UNSELECTED",
                              revision="contract-r1", council_members=[],
                              council_quorum=0, operator_mandate=[], mixed_reserved=[])
    resource_owner = {r["id"]:r["owner"] for r in doc["resources"]}
    specs = {r["work_spec"]["id"]:r["work_spec"] for r in doc["events"] if r["action"] == "request"}
    events, positions = [], {}
    for row in doc["events"]:
        action = row["action"]
        if action in {"formation_confirm", "function_prepare", "function_review"}:
            continue
        work = row["work_spec"]["id"] if action == "request" else row.get("work")
        if action == "offer":
            row["actor"] = resource_owner[specs[work]["resource"]]
        if action in {"authorize", "commit"}:
            row["actor"] = specs[work]["customer"]
        if action == "authorize":
            row["direct_documentation_mode"] = mode
        if "org_revision" in row:
            row["org_revision"] = "contract-r1"
        positions[(work, action)] = len(events)
        events.append(row)
    doc["events"] = events

    basis = doc["context_evidence"]
    source_rows = []
    for row in basis["sources"]:
        if row["owner"] == "op" or row["id"].startswith("basis-"):
            continue
        row["usable_by"] = [p for p in row["usable_by"] if p != "op"]
        if row["id"].startswith("decision-"):
            row["purposes"] = ["DIRECT_OWNER_WORK"]
            row["operations"] = ["ACCEPT", "EXECUTE", "SHARE"]
        source_rows.append(row)
    basis["sources"] = source_rows
    source_index = {r["id"]:r for r in source_rows}
    for row in basis["requirements"]:
        row["purpose"] = "DIRECT_OWNER_WORK"
    for work, spec in specs.items():
        for action, owner in (("request", spec["customer"]),
                              ("offer", resource_owner[spec["resource"]])):
            ref = f"decision-{work}-{owner}"
            assert source_index[ref]["owner"] == owner
            basis["requirements"].append({"work":work,"action":action,"sources":[ref],
                "expected_revisions":["source-r1"],"core":"corporate",
                "purpose":"DIRECT_OWNER_WORK","operation":"SHARE"})

    money = doc["economic_claims"]
    money["sources"] = [r for r in money["sources"] if r["owner"] != "op"]
    money["coverage"][COOP].pop("op")
    money["network_period_scope"]["owners"].pop("op")
    money["transfers"] = [r for r in money["transfers"] if r["payee"] != "op" and r["payer"] != "op"]
    life = money["lifecycle_costs"]
    life["scope_proofs"][COOP].pop("op")
    old_bindings = {r["resource_use_id"]:r for r in life["bindings"]}
    old_timed = {r["resource_use_id"]:r for r in life["event_bindings"]}
    rows, bindings, timed, activity = [], [], [], []
    for row in money["resource_uses"]:
        work = row["work"]
        if work is None:
            # Remove the actual incremental AKIS connection/platform costs.
            # Independent documentation/tooling are explicit costs below.
            continue
        rid = row["id"]
        if row["owner"] == "op":
            buyer = specs[work]["customer"]
            principals = {buyer} | {resource_owner[r["resource"]]
                                  for r in specs[work]["resource_requirements"]}
            fields = 4+5+2*len(principals)
            fill = {"S0":0, "S1":4, "S2":fields}[mode]
            units = {"human_entry":fields-fill, "program_fill":fill,
                     "human_validation":fields, "packet_overhead":1}
            amount = sum((Decimal(rates[mode][key])*value for key,value in units.items()),ZERO)
            rid = work+"-direct-documentation"
            source = money["coverage"][COOP][buyer]
            row = dict(row, id=rid, owner=buyer, source=source, amount=_str(amount))
            bind = {"resource_use_id":rid,"owner":buyer,"source":source,
                    "stage":DIRECT_STAGE,"nature":"TRANSACTION"}
            pos = positions[(work,"authorize")]
            proof = f"model://{buyer}/{rid}-proof"
            anchor = {"resource_use_id":rid,"work":work,"owner":buyer,"source":source,
                      "work_source_revision":specs[work]["source_revision"],
                      "trace_position":pos,"at":events[pos]["at"],"action":"authorize",
                      "org_revision":"contract-r1","cost_evidence_ref":proof,
                      "cost_evidence_revision":"economic-1"}
            source_rows.append({"id":proof,"owner":buyer,"revision":"economic-1",
                                "status":"CONFIRMED","usable_by":[buyer],"core":"corporate",
                                "purposes":["AKIS_ECONOMIC_WORK_EVIDENCE"],"operations":["READ"],
                                "valid_from":0,"valid_until":doc["model_horizon"]+1})
            activity.append({"resource_use_id":rid,"unit_rates_by_mode":rates})
        else:
            bind = old_bindings[rid]
            anchor = old_timed[rid]
            pos = positions[(work,anchor["action"])]
            assert events[pos]["at"] == anchor["at"]
            anchor.update(trace_position=pos, org_revision="contract-r1")
        rows.append(row)
        bindings.append(bind)
        timed.append(anchor)
    if tool_cost:
        periods = len({r["id"] for r in money["resource_uses"] if r["bucket"] == "COMMON_CAPABILITY"})
        for owner in money["coverage"][COOP]:
            for period in range(periods):
                rid = f"direct-tool-{period}-{owner}"
                source = money["coverage"][COOP][owner]
                rows.append({"id":rid,"scenario":COOP,"owner":owner,"amount":_str(tool_cost),
                             "bucket":"COMMON_CAPABILITY","source":source,"work":None})
                bindings.append({"resource_use_id":rid,"owner":owner,"source":source,
                                 "stage":"SECURITY_DATA_AND_AI_GOVERNANCE",
                                 "nature":"DATA_SECURITY_GOVERNANCE"})
    money["resource_uses"] = rows
    life.update(bindings=bindings,event_bindings=timed,preparation_activity_bindings=activity)
    if "cash_timing" in money:
        cash = money["cash_timing"]
        cash["owner_positions"] = [r for r in cash["owner_positions"] if r["owner"] != "op"]
        cash["transfer_windows"] = [r for r in cash["transfer_windows"] if "op" not in r["owner_sources"]]
    _rebuild_period_scope(doc)
    return doc


def matched_document(enterprises, periods, *, akis, fee="80.00", direct_mode="S0",
                     direct_tool_cost="0.00", agent_fill="1.00", timed_cash=True):
    """Declare BOTH trajectories before execution; never fit costs to results."""
    price, tool = _amount(fee), _amount(direct_tool_cost)
    _amount(agent_fill)
    rates = {mode:dict(card) for mode,card in RATES.items()}
    rates["S2"]["program_fill"] = agent_fill
    doc = organization_document(enterprises, periods, "S2", agent_fill=agent_fill,
                                timed_cash=timed_cash)
    if akis:
        for row in doc["economic_claims"]["transfers"]:
            if row["payee"] == "op":
                row["amount"] = _str(price)
        return doc
    return _direct_document(doc, mode=direct_mode, tool_cost=tool, rates=rates)


def _common_fingerprint(doc):
    """Only the explicit interventions may differ across the two executions."""
    money = doc["economic_claims"]
    def component(rows):
        return _hash_rows(rows)
    # Common physical needs, original principals' decisions and technical
    # events, with identical model times. No credit for speculative speed.
    physical = ({k:v for k,v in r.items() if k != "org_revision"}
                for r in doc["events"] if r["action"] in PHYSICAL)
    contract_ticks = ({"at":r["at"],"work":r["work"],"action":r["action"]}
                      for r in doc["events"] if r["action"] in {"offer","authorize","commit"})
    transfers = [r for r in money["transfers"] if "op" not in (r["payer"],r["payee"])]
    common_costs = [r for r in money["resource_uses"] if
                    r["work"] is not None and r["owner"]!="op"
                    and not r["id"].endswith("-direct-documentation")]
    result = {"physical":component(physical),"contract_ticks":component(contract_ticks),
              "participants":component(r for r in doc["subjects"] if r["id"]!="op"),
              "resources":component(doc["resources"]),"common_transfers":component(transfers),
              "common_costs":component(common_costs),"horizon":doc["model_horizon"],
              "period":money["period"],"currency":money["currency"]}
    if "cash_timing" in money:
        cash = money["cash_timing"]
        result["opening"] = component(r for r in cash["owner_positions"] if r["owner"]!="op")
        result["common_cash_timing"] = component(r for r in cash["transfer_windows"]
                                                 if "op" not in r["owner_sources"])
    return result


def _owner_values(doc, out, *, akis):
    money, econ = doc["economic_claims"], out["economics"]
    scope = econ["original_strict_context_source_qualification"]
    life = econ["lifecycle_resource_costs"]
    assert scope["network_period_exact_declared_owner_scope"]
    assert scope["network_period_owner_count"]==len(doc["subjects"])
    assert life["unclassified_original_record_count"]==0
    assert life["original_work_event_timing"]["original_lifecycle_timed_record_count"]==scope["network_period_direct_cost_count"]
    activity = life["original_preparation_activity_costs"]
    assert activity["original_cost_count"]==len(out["works"])
    assert all(bool(r.get("direct_owner_documentation_without_akis")) != akis
               for r in activity["items"])
    costs={}
    for owner, row in life["owner_scoped_details"].items():
        sc = row["scenarios"][COOP]
        assert sc["declared_resource_scope_complete_not_audited"]
        costs[owner] = sum(map(Decimal, sc["noncash_use_by_nature"].values()), ZERO)
    cash = {owner:Decimal(row["flow_sums_from_claims"][COOP]) for owner,row in econ["per_subject"].items()}
    assert set(costs)==set(cash)=={r["id"] for r in doc["subjects"]}
    external = Decimal(econ["consolidated_external_cash_from_claims"][COOP])
    assert sum(cash.values(),ZERO)==external
    net = {owner:cash[owner]-costs[owner] for owner in cash}
    reserves={}
    if "cash_timing" in money:
        timing = econ["cash_timing"]
        assert scope["network_period_complete_declared_cash_timing"]
        joint = timing["joint_network_settlement"]["scenarios"][COOP]
        assert joint["internal_cash_nets_to_zero_at_every_tick"]
        assert timing["missing_transfer_window_count"]==0
        opening={r["owner"]:Decimal(r["opening_cash"]) for r in money["cash_timing"]["owner_positions"]}
        for owner,row in timing["per_original_owner_private_research_projection"].items():
            path = row["scenario_paths"][COOP]
            assert path["status"]=="SOURCE_DECLARED_TIMING_ARITHMETIC_ONLY"
            reserves[owner]={k:path[k]["status"] for k in ("expected","declared_late_case")}
            for k in reserves[owner]:
                assert Decimal(path[k]["end_of_horizon_cash_from_declared_transfers"])==opening[owner]+cash[owner]
    return {"net":net,"cash":cash,"costs":costs,"reserves":reserves,
            "external":external,"preparation":Decimal(activity["total_declared_resource_cost"])}


def _execute(enterprises, periods, *, akis, fee, direct_mode, direct_tool_cost, agent_fill, timed_cash):
    doc = matched_document(enterprises, periods, akis=akis, fee=fee,
                           direct_mode=direct_mode,direct_tool_cost=direct_tool_cost,
                           agent_fill=agent_fill,timed_cash=timed_cash)
    fingerprint = _common_fingerprint(doc)
    out = simulate(doc)
    if akis:
        verify_network_result(doc,out,enterprises,periods)
        assert out["general_akis_model"]["model_organizational_code_review"]["all_thirteen_model_controls_active"]
    else:
        assert out["institution"]["operator_present"] is False
        assert "general_akis_model" not in out and "op" not in out["subjects"]
        assert all(r["actor"]!="op" for r in out["trace"])
        assert not any(r["action"] in {"formation_confirm","function_prepare","function_review"}
                       for r in out["trace"])
    expected = enterprises*periods
    failed = ((enterprises+9)//10)*periods
    assert len(out["subjects"])==enterprises+int(akis)
    assert len(out["works"])==expected+failed
    assert len(out["trace"])==len(doc["events"])
    assert Counter(r["reason"] for r in out["trace"] if r["outcome"]=="BLOCKED")=={"RESOURCE_CAPACITY_EXCEEDED":failed}
    accepted = {k for k,r in out["works"].items() if r["result"]==ACCEPTED}
    assert len(accepted)==expected and all(k.startswith("work-") for k in accepted)
    assert all(len(r["consenting_principals"])==3 for r in out["works"].values())
    assert all(out["works"][k]["obligation"]=="NOT_ACCEPTED" for k in set(out["works"])-accepted)
    assert len(out["capacity"]["reservations"])==2*expected
    for k in set(out["works"])-accepted:
        assert out["economics"]["original_work_record_evidence"][k]["existing_transfer_rows"][COOP]==0
    # Same final physical outcome; the common contract edition labels and
    # authorization actor differ intentionally. No proof of actual delivery.
    state_keys=("original_customer","resource_owner","source_revision","requested_at",
                "obligation","execution","result","result_ref","consenting_principals")
    fingerprint["final_physical_work"]=_hash_rows(
        ({"work":k,**{key:r[key] for key in state_keys}} for k,r in sorted(out["works"].items())))
    fingerprint["original_reservations"]=_hash_rows(out["capacity"]["reservations"])
    owner = _owner_values(doc,out,akis=akis)
    money = doc["economic_claims"]
    fee_rows=[r for r in money["transfers"] if r["payee"]=="op"]
    assert len(fee_rows)==(expected if akis else 0)
    if akis:
        assert all(Decimal(r["amount"])==Decimal(fee) for r in fee_rows)
        assert owner["cash"]["op"]==Decimal(fee)*expected
    fees=Counter(r["payer"] for r in fee_rows)
    entry=sum((Decimal(r["amount"]) for r in money["resource_uses"]
               if r["bucket"]=="PARTICIPANT_CONNECT"),ZERO)
    common=sum((Decimal(r["amount"]) for r in money["resource_uses"]
                if r["bucket"]=="COMMON_CAPABILITY"),ZERO)
    summary={"original_works":len(out["works"]),"accepted_results":expected,
             "capacity_blocked_works":failed,"original_events":len(out["trace"]),
             "declared_documentation_resource_cost":_str(owner["preparation"]),
             "declared_common_capability_cost":_str(common),
             "declared_connection_cost":_str(entry),
             "declared_total_exclusive_noncash_cost":_str(sum(owner["costs"].values(),ZERO)),
             "declared_external_net_cash":_str(owner["external"]),
             "declared_cash_minus_exclusive_noncash":_str(sum(owner["net"].values(),ZERO)),
             "declared_operator_contribution":_str(owner["net"]["op"]) if akis else None,
             "declared_internal_operator_service_fee_total":_str(Decimal(fee)*expected if akis else ZERO),
             "original_operator_present":akis,
             "same_original_source_scope_complete_declared":True,
             "cash_timing_is_declared_not_bank_settlement":True,
             "actual_profit_verified":False}
    return summary, owner, fees, fingerprint


def _fee_interval(akis, direct, fees, fee):
    """A fixed-work arithmetic feasibility boundary; NOT a price selector.

    A fee is a transfer, so it cannot change consolidated contribution.
    No simulated owner consent or reserve compliance follows from a bound.
    """
    n=sum(fees.values())
    assert n>0 and set(fees)==set(direct["net"])
    lower=max(ZERO, ((fee*n-akis["net"]["op"])/n).quantize(CENT,rounding=ROUND_CEILING))
    upper=min(((akis["net"][owner]-direct["net"][owner]+fee*count)/count)
              .quantize(CENT,rounding=ROUND_FLOOR) for owner,count in fees.items())
    return {"minimum_uniform_fee_for_operator_nonnegative_contribution":_str(lower),
            "maximum_uniform_fee_for_every_enterprise_nonnegative_increment":_str(upper),
            "nonnegative_fee_interval_exists":lower<=upper,
            "declared_fee_inside_interval":lower<=fee<=upper,
            "fixed_work_and_cost_arithmetic_only":True,
            "not_a_price_selection_or_legal_offer":True,
            "liquidity_and_independent_consent_not_inferred":True}


def compare_network_without_akis(enterprises,periods=3,*,fee="80.00",direct_mode="S0",
                                 direct_tool_cost="0.00",agent_fill="1.00",timed_cash=True):
    args=dict(fee=fee,direct_mode=direct_mode,direct_tool_cost=direct_tool_cost,
              agent_fill=agent_fill,timed_cash=timed_cash)
    a, av, fees, ah = _execute(enterprises,periods,akis=True,**args)
    b, bv, _, bh = _execute(enterprises,periods,akis=False,**args)
    if ah!=bh:
        raise ValueError("NETWORK_CONTROL_COMMON_BASELINE_CHANGED")
    assert av["external"]==bv["external"]
    assert set(av["net"])==set(bv["net"])|{"op"}
    changes={owner:av["net"][owner]-value for owner,value in bv["net"].items()}
    firm_increment=sum(changes.values(),ZERO)
    operator=av["net"]["op"]
    total=firm_increment+operator
    assert total==sum(bv["costs"].values(),ZERO)-sum(av["costs"].values(),ZERO)
    counts=Counter("improved" if v>0 else "worsened" if v<0 else "unchanged" for v in changes.values())
    fee_bounds=_fee_interval(av,bv,fees,Decimal(fee))
    assert fee_bounds["declared_fee_inside_interval"]==(operator>=0 and all(v>=0 for v in changes.values()))
    ordered=sorted(changes.values())
    reserve={}
    if timed_cash:
        rank={"SOURCE_DECLARED_LIQUIDITY_GAP_IN_ALL_SAME_TICK_ORDERINGS":0,
              "SAME_TICK_SETTLEMENT_ORDER_NOT_QUALIFIED":1,
              "SOURCE_DECLARED_RESERVE_MET_IN_ALL_SAME_TICK_ORDERINGS":2}
        for case in ("expected","declared_late_case"):
            c=Counter()
            for owner in bv["reserves"]:
                left,right=rank[av["reserves"][owner][case]],rank[bv["reserves"][owner][case]]
                c["improved" if left>right else "worsened" if left<right else "unchanged"]+=1
            reserve[case]={**{k:c[k] for k in ("improved","unchanged","worsened")},
                           "operator_status":av["reserves"]["op"][case]}
    return {"schema":"AKIS_ORIGINAL_NETWORK_EXECUTED_DIRECT_CONTRACT_CONTROL/1",
            "enterprises":enterprises,"periods":periods,
            "assumptions":{"uniform_service_fee":_str(Decimal(fee)),"direct_documentation_mode":direct_mode,
                           "direct_tool_cost_per_enterprise_period":_str(Decimal(direct_tool_cost)),
                           "agent_program_fill_unit_cost":_str(Decimal(agent_fill)),
                           "rates_are_controlled_inputs_not_empirical":True},
            "with_akis":a,"without_akis_direct_contracts":b,
            "matched_baseline_fingerprints":ah,
            "same_original_needs_resources_results_consents_and_external_cash":True,
            "direct_control_has_no_operator_agent_or_general_akis":True,
            "full_organizational_lifecycle_and_market_dynamics_qualified":False,
            "economic_contrast":{"system_declared_increment":_str(total),
                "operator_declared_contribution":_str(operator),
                "enterprise_declared_increment_sum":_str(firm_increment),
                "enterprise_counts":{k:counts[k] for k in ("improved","unchanged","worsened")},
                "enterprise_increment_minimum":_str(ordered[0]),
                "enterprise_increment_median_lower":_str(ordered[(len(ordered)-1)//2]),
                "enterprise_increment_maximum":_str(ordered[-1]),
                "all_enterprises_nonnegative_increment":all(v>=0 for v in ordered),
                "operator_and_every_enterprise_nonnegative":operator>=0 and ordered[0]>=0,
                "internal_fee_is_not_new_system_value":True,
                "uniform_fee_arithmetic_boundary":fee_bounds},
            **({"independent_declared_reserve_contrast":reserve} if timed_cash else {}),
            "recipient_use_value_not_measured":True,
            "no_real_market_acceptance_or_accounting_profit_claimed":True,"profit":"UNKNOWN"}


if __name__=="__main__":
    n=int(sys.argv[1])
    periods=int(sys.argv[2]) if len(sys.argv)>2 else 3
    mode=sys.argv[3] if len(sys.argv)>3 else "S0"
    fee=sys.argv[4] if len(sys.argv)>4 else "80.00"
    started=time.perf_counter()
    report=compare_network_without_akis(n,periods,fee=fee,direct_mode=mode)
    payload=json.dumps(report,sort_keys=True,indent=2,allow_nan=False)+"\n"
    path=Path(__file__).resolve().parent/f"network_direct_control_{n}_{periods}_{mode}_{fee}.json"
    path.write_bytes(payload.encode("utf-8"))
    print(payload,end="")
    print("AKIS_NETWORK_DIRECT_CONTROL_SHA256="+sha256(path.read_bytes()).hexdigest())
    print(f"AKIS_NETWORK_DIRECT_CONTROL_WALL_SECONDS={time.perf_counter()-started:.3f}")
