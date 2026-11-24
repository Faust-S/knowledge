"""Mass six-phase ORGANIZATIONAL gate and original source-cost comparison.

All enterprises share ONE native Mesa population, capacity ledger and trace.
S0/S1/S2 here vary packet preparation and explicitly declared platform costs,
NOT the presence/absence of AKIS, real LLM throughput or audited profit.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
import sys
import time

from research.akis.qualitative_mesa.general_system import author_catalog
from research.akis.qualitative_mesa.mesa_model import simulate
from research.akis.qualitative_mesa.experiments.export_original_network_scale import (
    network_document, verify_network_result, COOP, ALT,
)

MODES = ("S0", "S1", "S2")
RATES = {
    "S0": {"human_entry":"5.00", "program_fill":"1.00",
           "human_validation":"2.00", "packet_overhead":"0.00"},
    "S1": {"human_entry":"5.00", "program_fill":"1.00",
           "human_validation":"2.00", "packet_overhead":"8.00"},
    "S2": {"human_entry":"5.00", "program_fill":"1.00",
           "human_validation":"2.00", "packet_overhead":"12.00"},
}
# Explicit stress assumptions, NOT claimed market prices. Shared platform
# costs are already in the original ledger; this is a per-period increment.
PLATFORM_INCREMENT = {"S0":0, "S1":15000, "S2":50000}


def organization_document(enterprises: int, periods: int = 3, mode: str = "S2",
                          *, strict_period: bool = True, checkpoints: bool = True,
                          agent_fill: str = "1.00", timed_cash: bool = False) -> dict:
    if mode not in MODES:
        raise ValueError("NETWORK_PREPARATION_MODE_INVALID")
    rates = {k: dict(v) for k,v in RATES.items()}
    rates["S2"]["program_fill"] = agent_fill
    if type(enterprises) is not int or type(periods) is not int:
        raise ValueError("NETWORK_EXPERIMENT_INVALID_DIMENSIONS")
    if timed_cash and not strict_period:
        raise ValueError("NETWORK_TIMED_CASH_REQUIRES_STRICT_PERIOD")
    attempts = periods*(enterprises+(enterprises+9)//10)
    event_count = periods*(10*enterprises+7*((enterprises+9)//10))+13*attempts
    if event_count+(101 if timed_cash else 1) > 3_000_000:
        raise ValueError("NETWORK_ORGANIZATION_DECLARED_LIMIT_EXCEEDED")
    d = network_document(enterprises, periods)
    firms = [row["id"] for row in d["subjects"] if row["id"] != "op"]
    parties = ["op", *firms]
    owners_by_resource = {row["id"]:row["owner"] for row in d["resources"]}
    founders = d["institution"]["founders"]
    events, positions = [], {}
    work_specs = {}
    goals, phases, cores, functions, responsibilities = [], [], [], [], []
    source_rows, requirements = [], []
    # Every original event is re-timed identically in every arm. There are
    # eleven formation confirmations, a preparation and independent review
    # for each attempt, in addition to the original business events.
    def emit(action, actor, **fields):
        event = {"at":len(events)+1,"action":action,"actor":actor,**fields}
        events.append(event)
        if action in {"request", "function_prepare", "commit", "start", "complete", "accept"}:
            work = event["work_spec"]["id"] if action=="request" else event["work"]
            positions[(work,action)] = len(events)-1
        return event["at"]

    def claim(owner, name, **fields):
        return {"owner":owner,"source_ref":f"model://{owner}/{name}",
                "revision":"oc-1","available_at":0,**fields}

    def source(key, owner, recipients, core, purpose, operations, revision="source-r1"):
        source_rows.append({"id":key,"owner":owner,"revision":revision,
                            "status":"CONFIRMED","usable_by":list(recipients),
                            "core":core,"purposes":[purpose],"operations":list(operations),
                            "valid_from":0})

    def core_claim(owner, core, recipient, operation):
        key = f"basis-{owner}-{core}"
        cores.append(claim(owner,f"core-{core}",core=core,recipient=recipient,
                           purpose="akis-formation",operation=operation,
                           basis_source=key,basis_revision="source-r1"))
        source(key,owner,[recipient],core,"akis-formation",[operation])
        return key

    for owner in firms:
        for phase in (1,2,3,4):
            phases.append(claim(owner,f"formation-{phase}",phase=phase))
        core_claim(owner,"personal",owner,"READ")
        core_claim(owner,"corporate","op","SHARE")
        core_claim(owner,"institutional","op","READ")
    for owner in founders:
        phases.append(claim(owner,"formation-5",phase=5))
    for phase in (4,6):
        phases.append(claim("op",f"formation-{phase}",phase=phase))
    core_claim("op","operator","op","READ")

    catalog = author_catalog()["taxonomy"]
    morphology = {row["key"]:row["values"][0] for row in catalog["morphological_axes"]}
    morphology.update(scale="межфирменные",governance="операторские",
                      autonomy="согласовательные",process="межфирменные",
                      knowledge="операторский",economics="комиссионные")
    # No branch in execution or authority depends on the selected cost mode.
    # The independent customer review remains mandatory in all three arms.
    for event in d["events"]:
        emit(event["action"],event["actor"],
             **{k:v for k,v in event.items() if k not in {"at","action","actor"}})
        if event["action"] != "request":
            continue
        spec = event["work_spec"]
        work, buyer = spec["id"],spec["customer"]
        first = owners_by_resource[spec["resource"]]
        suppliers = sorted({owners_by_resource[need["resource"]]
                            for need in spec["resource_requirements"]})
        principals = sorted({buyer,*suppliers})
        work_specs[work] = spec
        goals.append(claim(buyer,f"goal-{work}",work=work,work_revision="d-1",
                           objective="TRANSACTION_COST",priority=1))
        function_id = "approval-"+work
        functions.append(claim("op","packet-"+work,id=function_id,work=work,
                               work_revision="d-1",autonomy=morphology["autonomy"],
                               action="REQUEST_APPROVAL",basis_source=f"basis-{first}-corporate",
                               basis_revision="source-r1",purpose="akis-formation",operation="SHARE"))
        responsibilities.append({"work":work,"work_revision":"d-1","action":"commit",
                                 "original_principals":principals})
        refs = []
        for owner in principals:
            key = f"decision-{work}-{owner}"
            refs.append(key)
            source(key,owner,["op",*principals],"corporate","AKIS_NETWORK_WORK",
                   ["ACCEPT","EXECUTE"])
        for action,operation in (("authorize","ACCEPT"),("consent","ACCEPT"),
                                 ("commit","ACCEPT"),("start","EXECUTE"),
                                 ("complete","EXECUTE"),("accept","ACCEPT")):
            requirements.append({"work":work,"action":action,"sources":refs,
                                 "expected_revisions":["source-r1"]*len(refs),
                                 "core":"corporate","purpose":"AKIS_NETWORK_WORK",
                                 "operation":operation})

        def confirm(phase, owner, **extra):
            emit("formation_confirm",owner,work=work,phase=phase,org_revision="oc-1",
                 formation_source_ref=f"model://{owner}/formation-{phase}",**extra)
        confirm(1,buyer)
        confirm(2,buyer)
        for supplier in suppliers:
            confirm(3,supplier)
        for core,owner in (("personal",buyer),("corporate",first),
                           ("operator","op"),("institutional",buyer)):
            confirm(4,owner,formation_core=core,formation_basis_source=f"basis-{owner}-{core}")
        for owner in founders:
            confirm(5,owner)
        prepared_at = emit("function_prepare","op",work=work,function_id=function_id,
                           function_source_ref=f"model://op/packet-{work}",
                           function_phase_source_ref="model://op/formation-6",
                           org_revision="oc-1",preparation_mode=mode)
        emit("function_review",buyer,work=work,function_id=function_id,prepared_at=prepared_at,
             human_decision="APPROVE",review_source_ref=f"model://{buyer}/review-{work}",
             org_revision="oc-1")
    d["events"] = events
    horizon = len(events)+(101 if timed_cash else 1)
    d["model_horizon"] = horizon
    if checkpoints:
        # Keep only two explicit boundary observations at this scale. All
        # transition guards, costs and independent reviews are still exact.
        d["network_observation_ticks"] = [0,horizon]
    controls = {
        "С":{"subjects":parties},
        "ИД":{"model_identified":parties},
        "Рол":{"role_bindings":[{"subject":"op","items":["OPERATOR"]}]+[
            {"subject":owner,"items":["CUSTOMER","RESOURCE_OWNER"]} for owner in firms]},
        "Пр":{"permitted":[{"subject":"OPERATOR","items":["offer","authorize","commit"]},
                            {"subject":"CUSTOMER","items":["request","consent"]},
                            {"subject":"RESOURCE_OWNER","items":["consent","interest_update"]}]},
        "Запр":{"denied":[{"subject":"OPERATOR","items":["consent"]}]},
        "Ист":{"require_scoped_context_for":["commit"]},
        "Событ":{"new_work_events":["request","offer","authorize","consent","commit"]},
        "Прав":{"require_admitted_for":["consent","commit"]},
        "Авт":{"max_agent_function":"REQUEST_APPROVAL"},
        "Эск":{"reviewers":[{"action":"commit","subject":founders[1]}]},
        "Отв":{"responsibilities":[],"work_responsibilities":responsibilities},
        "Журн":{"require_original_trace":True},
        "Пересм":{"expected_revision":"oc-1"},
    }
    code = [claim("op",f"oc-{idx+1}",field=field,control=controls[field])
            for idx,field in enumerate(catalog["organizational_code_components"])]
    for row in goals+phases+cores+functions+code:
        row["expires_at"] = horizon+1
    d["general_akis"] = {
        "configuration":"operator","morphology":morphology,"goals":goals,
        "organizational_code":code,"formation_phases":phases,
        "context_cores":cores,"agent_functions":functions,
        "enforce_model_org_code":True,"enforce_model_formation_phases":True,
        "enforce_model_formation_context_code":True,
        "enforce_model_formation_agent_review":True,
    }

    money = d["economic_claims"]
    bindings, timed, activity = [], [], []
    by_owner_t, by_owner_c = defaultdict(list),defaultdict(list)
    common_ids = []
    for row in money["transfers"]:
        for owner in (row["payer"],row["payee"]):
            if owner!="EXTERNAL":
                by_owner_t[owner].append(row["id"])
    for row in money["resource_uses"]:
        rid,owner,work = row["id"],row["owner"],row["work"]
        by_owner_c[owner].append(rid)
        stage,nature,action = "PRODUCTION_COORDINATION","TRANSACTION",None
        if work is None:
            common_ids.append(rid)
            if row["bucket"]=="COMMON_CAPABILITY":
                stage,nature="SECURITY_DATA_AND_AI_GOVERNANCE","SHARED_OPERATOR_CAPABILITY"
                row["amount"] = str(Decimal(row["amount"])+PLATFORM_INCREMENT[mode])
            else:
                stage,nature="ONBOARDING_AND_INTEGRATION","TRANSACTION"
        elif owner=="op":
            action = "function_prepare"
            # Independent calculation of the existing preparation event's
            # field units. Actual trace units must reconcile with this row.
            fields = 4+5+2*3
            fill = {"S0":0,"S1":4,"S2":fields}[mode]
            units = {"human_entry":fields-fill,"program_fill":fill,
                     "human_validation":fields,"packet_overhead":1}
            row["amount"] = str(sum(Decimal(rates[mode][key])*value for key,value in units.items()))
            activity.append({"resource_use_id":rid,"unit_rates_by_mode":rates})
        elif row["bucket"]=="DELIVERY":
            nature,action="DIRECT_RESOURCE","complete"
        else:
            stage,action="SOURCE_AND_IDENTITY_VERIFICATION","request"
        bindings.append({"resource_use_id":rid,"owner":owner,"source":row["source"],
                         "stage":stage,"nature":nature})
        if action is not None:
            pos = positions[(work,action)]
            proof = f"model://{owner}/{rid}-proof"
            timed.append({"resource_use_id":rid,"work":work,"owner":owner,
                          "source":row["source"],"work_source_revision":"d-1",
                          "trace_position":pos,"at":events[pos]["at"],"action":action,
                          "org_revision":"oc-1","cost_evidence_ref":proof,
                          "cost_evidence_revision":"economic-1"})
            source(proof,owner,[owner],"operator" if owner=="op" else "corporate",
                   "AKIS_ECONOMIC_WORK_EVIDENCE",["READ"],"economic-1")
    money["lifecycle_costs"] = {
        "bindings":bindings,"event_bindings":timed,
        "preparation_activity_bindings":activity,
        "scope_proofs":{COOP:dict(money["coverage"][COOP]),ALT:{}},
    }
    if strict_period:
        scope = {}
        for owner in parties:
            key = f"period-scope-{owner}"
            money["sources"].append({"id":key,"owner":owner,
                                      "reference":f"model://{owner}/exclusive-period-scope",
                                      "revision":"economic-1"})
            scope[owner] = {"source":key,"observed_at":horizon,
                            "transfer_ids":by_owner_t[owner],"resource_use_ids":by_owner_c[owner],
                            "complete_exclusive_period_scope":True}
        money["network_period_scope"] = {
            "period":money["period"],"owners":scope,
            "common_resource_use_ids":common_ids,
            "uncommitted_works":sorted(w for w in work_specs if w.startswith("conflict-")),
        }
        d["strict_economic_source_works"] = sorted(work_specs)
    if timed_cash:
        positions_cash, windows = [], []
        for i,owner in enumerate(parties):
            key = "opening-"+owner
            money["sources"].append({"id":key,"owner":owner,
                "reference":f"model://{owner}/opening-reserve","revision":"economic-1"})
            positions_cash.append({"owner":owner,"source":key,
                "opening_cash":str(50000 if owner=="op" else 30+(i*137)%501),
                "reserve_cash":str(10000 if owner=="op" else 20+(i*17)%31)})
        # Explicit declared stress schedule, not a real settlement event or
        # a forecast. No reset of opening cash at the next period boundary.
        for row in money["transfers"]:
            work = row["work"]
            kind = row["id"].rsplit("-",1)[1]
            phase = {"sale":"accept","supplier":"complete","support":"complete",
                     "operator":"commit","materials":"start"}[kind]
            at = events[positions[(work,phase)]]["at"]+1
            period,i = map(int,work.split("-")[1:])
            delay = 2+(period*13+i*17+len(kind))%49
            owners = {row["payer"],row["payee"]}-{"EXTERNAL"}
            windows.append({"transfer_id":row["id"],"at":at,"late_at":at+delay,
                "owner_sources":{owner:money["coverage"][COOP][owner]
                                 for owner in sorted(owners)}})
        money["cash_timing"] = {"horizon_end":horizon,
            "owner_positions":positions_cash,"transfer_windows":windows}
    for row in money["sources"]:
        owner = row["owner"]
        source(row["reference"],owner,[owner],"operator" if owner=="op" else "corporate",
               "AKIS_ECONOMIC_WORK_EVIDENCE",["READ"],row["revision"])
    for row in source_rows:
        row["valid_until"] = horizon+1
    d["context_evidence"] = {"strict":True,"sources":source_rows,"requirements":requirements}
    return d


def _hash_rows(rows):
    digest=sha256()
    for row in rows:
        digest.update(json.dumps(row,sort_keys=True,ensure_ascii=False,
                                 separators=(",",":"),allow_nan=False).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _period_totals(money, periods):
    # Derived arithmetic on the original unique rows; never an additional
    # transaction register. Group by the declared generation period of
    # Work. This is not the settlement-date period or accrual accounting.
    fields = ("external_cash","noncash","entry","shared","failed","preparation")
    groups = [{key:Decimal(0) for key in fields} for _ in range(periods)]
    for row in money["transfers"]:
        if "EXTERNAL" not in (row["payer"],row["payee"]):
            continue
        period = int(row["work"].split("-")[1])
        groups[period]["external_cash"] += Decimal(row["amount"])*(1 if row["payer"]=="EXTERNAL" else -1)
    for row in money["resource_uses"]:
        amount = Decimal(row["amount"])
        work = row["work"]
        period = int(work.split("-")[1]) if work is not None else (
            int(row["id"].split("-")[1]) if row["bucket"]=="COMMON_CAPABILITY" else 0)
        g = groups[period]
        g["noncash"] += amount
        if row["bucket"]=="COMMON_CAPABILITY":
            g["shared"] += amount
        if row["bucket"]=="PARTICIPANT_CONNECT":
            g["entry"] += amount
        if work is not None and work.startswith("conflict-"):
            g["failed"] += amount
        if work is not None and row["owner"]=="op":
            g["preparation"] += amount
    balance = Decimal(0)
    result = []
    for period,g in enumerate(groups):
        net = g["external_cash"]-g["noncash"]
        balance += net
        result.append({"period":period+1,**{key:str(g[key]) for key in fields},
            "cash_minus_exclusive_noncash":str(net),
            "cumulative_cash_minus_exclusive_noncash":str(balance)})
    return result


def _liquidity_summary(money, econ, scope, cash_by_owner):
    timing = econ["cash_timing"]
    joint = timing["joint_network_settlement"]["scenarios"][COOP]
    assert scope["network_period_complete_declared_cash_timing"]
    assert scope["network_period_source_scoped_transfer_timing_count"]==len(money["transfers"])
    assert timing["missing_transfer_window_count"]==0
    assert joint["internal_cash_nets_to_zero_at_every_tick"]
    assert joint["sum_owner_cash_changes_equals_original_external_cash_at_every_tick"]
    opening = {row["owner"]:Decimal(row["opening_cash"]) for row in money["cash_timing"]["owner_positions"]}
    paths = timing["per_original_owner_private_research_projection"]
    joint_paths = joint["per_original_owner_private_research_projection"]
    assert set(opening)==set(paths)==set(joint_paths)==set(cash_by_owner)
    counts = {key:Counter() for key in ("expected","owner_late_receipt_stress","joint_late_settlement")}
    for owner,net_cash in cash_by_owner.items():
        own = paths[owner]["scenario_paths"][COOP]
        assert own["status"]=="SOURCE_DECLARED_TIMING_ARITHMETIC_ONLY"
        details = {"expected":own["expected"],
            "owner_late_receipt_stress":own["declared_late_case"],
            "joint_late_settlement":joint_paths[owner]["joint_posted_late_case"]}
        for key,row in details.items():
            assert Decimal(row["end_of_horizon_cash_from_declared_transfers"])==opening[owner]+net_cash
            if owner!="op":
                counts[key][row["status"]] += 1
    return {"enterprise_status_counts":{k:dict(v) for k,v in counts.items()},
        "operator_status":{k:v["status"] for k,v in {
            "expected":paths["op"]["scenario_paths"][COOP]["expected"],
            "owner_late_receipt_stress":paths["op"]["scenario_paths"][COOP]["declared_late_case"],
            "joint_late_settlement":joint_paths["op"]["joint_posted_late_case"]}.items()},
        "original_source_qualified_timing_rows":len(money["transfers"]),
        "opening_positions_not_income_or_reset":True,
        "joint_cash_conserved_each_tick":True,
        "owner_stress_not_joint_forecast":True,
        "real_bank_balance_verified":False,
        "declared_timing_sha256":_hash_rows(money["cash_timing"]["owner_positions"]+
                                             money["cash_timing"]["transfer_windows"])}


def run_organization(enterprises: int, periods: int, mode: str,
                     *, agent_fill: str = "1.00", timed_cash: bool = False) -> tuple[dict,dict]:
    doc = organization_document(enterprises,periods,mode,agent_fill=agent_fill,
                                timed_cash=timed_cash)
    out = simulate(doc)
    result = verify_network_result(doc,out,enterprises,periods)
    n = result["original_works"]
    trace = out["trace"]
    applied = Counter(row["action"] for row in trace if row["outcome"]=="APPLIED")
    assert applied["formation_confirm"] == 11*n
    assert applied["function_prepare"] == applied["function_review"] == n
    assert all(row["human_decision"]=="APPROVE" for row in trace
               if row["action"]=="function_review")
    general = out["general_akis_model"]
    assert general["model_organizational_code_review"]["all_thirteen_model_controls_active"]
    econ = out["economics"]
    scope = econ["original_strict_context_source_qualification"]
    assert scope["network_period_exact_declared_owner_scope"]
    assert scope["network_period_owner_count"]==enterprises+1
    assert scope["network_period_accepted_work_count"]==result["accepted_results"]
    assert scope["network_period_uncommitted_work_count"]==result["capacity_blocked_works"]
    life = econ["lifecycle_resource_costs"]
    assert life["unclassified_original_record_count"]==0
    assert scope["network_period_direct_cost_count"]==life["original_work_event_timing"]["original_lifecycle_timed_record_count"]
    prep = life["original_preparation_activity_costs"]
    assert prep["original_cost_count"]==n
    assert all(row["mode"]==mode for row in prep["items"])
    assert all(row["units"]["human_validation"]==15 for row in prep["items"])
    # Count each original noncash use once, rather than adding stage and
    # nature totals (which are two views of the very same cost rows).
    cost_by_owner={}
    for owner,row in life["owner_scoped_details"].items():
        sc=row["scenarios"][COOP]
        assert sc["declared_resource_scope_complete_not_audited"]
        cost_by_owner[owner]=sum(map(Decimal,sc["noncash_use_by_nature"].values()),Decimal(0))
    cash_by_owner={owner:Decimal(row["flow_sums_from_claims"][COOP])
                   for owner,row in econ["per_subject"].items()}
    net={owner:cash_by_owner[owner]-cost_by_owner[owner] for owner in cash_by_owner}
    sum_cost=sum(cost_by_owner.values(),Decimal(0))
    sum_cash=sum(cash_by_owner.values(),Decimal(0))
    assert sum(net.values(),Decimal(0))==sum_cash-sum_cost
    money=doc["economic_claims"]
    prep_cost=Decimal(prep["total_declared_resource_cost"])
    shared=sum((Decimal(r["amount"]) for r in money["resource_uses"]
                if r["bucket"]=="COMMON_CAPABILITY"),Decimal(0))
    entry=sum((Decimal(r["amount"]) for r in money["resource_uses"]
               if r["bucket"]=="PARTICIPANT_CONNECT"),Decimal(0))
    blocked=set(money["network_period_scope"]["uncommitted_works"])
    failed=sum((Decimal(r["amount"]) for r in money["resource_uses"]
                if r["work"] in blocked),Decimal(0))
    # Same physical Work, decisions, payments and all OTHER resource costs.
    # Preparation mode and shared platform cost are the only interventions.
    matched_baseline = _hash_rows(
        ({k:v for k,v in row.items() if k!="preparation_mode"} for row in doc["events"]))
    transfer_hash=_hash_rows(money["transfers"])
    other_cost_hash=_hash_rows(r for r in money["resource_uses"] if not (
        r["owner"]=="op" and (r["work"] is not None or r["bucket"]=="COMMON_CAPABILITY")))
    state_hash=_hash_rows(({"work":key,**out["works"][key]}
                           for key in sorted(out["works"])))
    period_rows = _period_totals(money,periods)
    for key,total in (("external_cash",sum_cash),("noncash",sum_cost),
                      ("preparation",prep_cost),("shared",shared),("entry",entry),
                      ("failed",failed)):
        assert sum((Decimal(row[key]) for row in period_rows),Decimal(0))==total
    assert Decimal(period_rows[-1]["cumulative_cash_minus_exclusive_noncash"])==sum_cash-sum_cost
    result.update({
        "schema":"AKIS_ORIGINAL_NETWORK_ORGANIZATION/1",
        "declared_period_arithmetic":period_rows,
        "periods_are_model_work_groups_not_months_or_accrual_accounts":True,
        **({"declared_liquidity":_liquidity_summary(money,econ,scope,cash_by_owner)}
           if timed_cash else {}),

        "preparation_mode":mode,"four_original_context_cores":4,
        "thirteen_original_oc_controls_active":True,
        "applied_original_formation_confirmations":applied["formation_confirm"],
        "applied_original_independent_customer_reviews":applied["function_review"],
        "original_cost_scope_complete_declared":True,
        "original_cost_events_source_qualified":scope["source_scoped_original_cost_event_count"],
        "original_common_cost_rows":scope["network_period_common_cost_count"],
        "declared_preparation_cost_rub":str(prep_cost),
        "declared_operator_shared_cost_rub":str(shared),
        "declared_enterprise_entry_cost_rub":str(entry),
        "declared_failed_order_cost_rub":str(failed),
        "declared_total_noncash_cost_rub":str(sum_cost),
        "declared_external_net_cash_rub":str(sum_cash),
        "declared_cash_minus_exclusive_noncash_cost_rub":str(sum_cash-sum_cost),
        "declared_operator_cash_minus_exclusive_noncash_cost_rub":str(net["op"]),
        "enterprises_positive_cash_minus_cost":sum(v>0 for k,v in net.items() if k!="op"),
        "enterprises_zero_cash_minus_cost":sum(v==0 for k,v in net.items() if k!="op"),
        "enterprises_negative_cash_minus_cost":sum(v<0 for k,v in net.items() if k!="op"),
        "matched_original_event_baseline_sha256":matched_baseline,
        "matched_original_transfer_sha256":transfer_hash,
        "matched_other_resource_cost_sha256":other_cost_hash,
        "matched_final_original_work_sha256":state_hash,
        "assumptions_not_empirical_prices":True,
        "without_akis_executed":False,
        "full_eight_phase_and_delegation_lifecycle_qualified":False,
        "actual_profit_or_economic_causality_verified":False,
    })
    return result,net


def compare_network_modes(enterprises: int, periods: int=3, *, agent_fill: str="1.00",
                          modes=MODES, timed_cash: bool = False) -> dict:
    results, nets = {},{}
    for mode in modes:
        results[mode],nets[mode]=run_organization(enterprises,periods,mode,agent_fill=agent_fill,timed_cash=timed_cash)
    if "S0" not in results or "S2" not in results:
        raise ValueError("NETWORK_MODE_COMPARISON_NEEDS_S0_S2")
    first=results["S0"]
    for result in results.values():
        for key in ("matched_original_event_baseline_sha256","matched_original_transfer_sha256",
                    "matched_other_resource_cost_sha256","matched_final_original_work_sha256"):
            assert result[key]==first[key],key
        if timed_cash:
            assert result["declared_liquidity"]==first["declared_liquidity"]
    contrasts={}
    for mode in results:
        if mode=="S0":
            continue
        result=results[mode]
        changes={owner:nets[mode][owner]-value for owner,value in nets["S0"].items()}
        total=sum(changes.values(),Decimal(0))
        saving=Decimal(first["declared_preparation_cost_rub"])-Decimal(result["declared_preparation_cost_rub"])
        extra=Decimal(result["declared_operator_shared_cost_rub"])-Decimal(first["declared_operator_shared_cost_rub"])
        assert total==saving-extra
        accumulated = Decimal(0)
        period_contrast = []
        first_positive = None
        for baseline, arm in zip(first["declared_period_arithmetic"],
                                 result["declared_period_arithmetic"],strict=True):
            period_delta = (Decimal(baseline["noncash"])-Decimal(arm["noncash"]))
            accumulated += period_delta
            period_contrast.append({"period":baseline["period"],"net_cost_reduction":str(period_delta),
                                    "cumulative_net_cost_reduction":str(accumulated)})
            if first_positive is None and accumulated>0:
                first_positive=baseline["period"]
        assert accumulated==total
        contrasts[mode]={"declared_period_contrast":period_contrast,
                         "first_positive_cumulative_period":first_positive,
                         "declared_preparation_cost_reduction_rub":str(saving),
                         "declared_incremental_platform_cost_rub":str(extra),
                         "declared_net_cost_reduction_rub":str(total),
                         "operator_change_rub":str(changes["op"]),
                         "enterprises_improved":sum(v>0 for k,v in changes.items() if k!="op"),
                         "enterprises_unchanged":sum(v==0 for k,v in changes.items() if k!="op"),
                         "enterprises_worsened":sum(v<0 for k,v in changes.items() if k!="op")}
    return {"schema":"AKIS_ORIGINAL_NETWORK_MATCHED_MODE_CONTRAST/1",
            "enterprises":enterprises,"periods":periods,"modes":results,
            "relative_to_S0":contrasts,
            "same_original_physical_work_decisions_and_cash":True,
            "full_without_akis_comparison_qualified":False,"profit":"UNKNOWN"}


if __name__=="__main__":
    n=int(sys.argv[1])
    periods=int(sys.argv[2]) if len(sys.argv)>2 else 3
    started=time.perf_counter()
    timed_cash="--timed-cash" in sys.argv[3:]
    report=compare_network_modes(n,periods,modes=("S0","S2"),timed_cash=timed_cash)
    payload=json.dumps(report,sort_keys=True,indent=2,allow_nan=False)+"\n"
    path=Path(__file__).resolve().parent/f"network_organization_{n}_{periods}{'_timed' if timed_cash else ''}.json"
    path.write_bytes(payload.encode("utf-8"))
    print(payload,end="")
    print("AKIS_NETWORK_ORGANIZATION_SHA256="+sha256(path.read_bytes()).hexdigest())
    print(f"AKIS_NETWORK_ORGANIZATION_WALL_SECONDS={time.perf_counter()-started:.3f}")
