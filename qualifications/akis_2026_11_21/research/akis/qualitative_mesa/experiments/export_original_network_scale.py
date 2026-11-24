"""Mass-scale ORIGINAL Work and declared economic ledger qualification.

This is an infrastructure experiment, not evidence of AKIS efficiency.
One connected population uses the same operator, resource ledger and Mesa
scheduler. Every enterprise both buys and supplies to other enterprises.
No replicated miniature model, simulated consent shortcut, or new ledger.
The full nine-component/strict-source economic scale is a separate gate.
"""
from __future__ import annotations

from collections import Counter
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
import sys
import time

from research.akis.qualitative_mesa.mesa_model import simulate

ACCEPTED = "ACCEPTED_BY_ORIGINAL_RECIPIENT"
COOP = "COOPERATION"
ALT = "INDEPENDENT_ALTERNATIVE"


def network_document(enterprises: int, periods: int = 3) -> dict:
    if type(enterprises) is not int or not 10 <= enterprises <= 30000:
        raise ValueError("NETWORK_EXPERIMENT_ENTERPRISES_OUTSIDE_QUALIFICATION_SCOPE")
    if type(periods) is not int or not 1 <= periods <= 3:
        raise ValueError("NETWORK_EXPERIMENT_PERIODS_OUTSIDE_QUALIFICATION_SCOPE")
    firms = [f"enterprise-{i:05d}" for i in range(enterprises)]
    resources = [f"resource-{i:05d}" for i in range(enterprises)]
    subjects = [{"id":"op","kind":"OPERATOR"}] + [
        {"id":owner,"kind":"SME"} for owner in firms]
    events = []
    transfers = []
    costs = []
    source_ids = {row["id"]:"finance-"+row["id"] for row in subjects}
    sources = [{"id":source_ids[row["id"]], "owner":row["id"],
                "reference":f"model://{row['id']}/period-economic-document",
                "revision":"economic-1"} for row in subjects]

    def emit(action, actor, **fields):
        events.append({"at":len(events)+1,"action":action,"actor":actor,**fields})

    def cost(key, owner, amount, bucket, work):
        costs.append({"id":key,"scenario":COOP,"owner":owner,
                      "amount":str(amount),"bucket":bucket,
                      "source":source_ids[owner],"work":work})

    def transfer(key, payer, payee, amount, work):
        owner = payee if payer == "EXTERNAL" else payer
        transfers.append({"id":key,"scenario":COOP,"payer":payer,
                          "payee":payee,"amount":str(amount),
                          "source":source_ids[owner],"work":work})

    def submit(work, buyer, first, second, period):
        # Each period has its own disjoint PLANNED resource windows.
        # Event ordinal is not a measured physical duration.
        specification = {"id":work,"customer":firms[buyer],
                         "resource":resources[first],"source_revision":"d-1",
                         "slot_start":10*period,"slot_end":10*(period+1),
                         "resource_requirements":[{"resource":resources[first],"units":1},
                                                  {"resource":resources[second],"units":1}]}
        emit("request",firms[buyer],work_spec=specification)
        emit("offer","op",work=work)
        emit("authorize","op",work=work)
        for owner in sorted({firms[buyer],firms[first],firms[second]}):
            emit("consent",owner,work=work,source_revision="d-1",org_revision="oc-1")
        emit("commit","op",work=work)

    for i, owner in enumerate(firms):
        # One source-declared entry expense per enterprise, not per order.
        cost(f"entry-{i}",owner,60+i%23,"PARTICIPANT_CONNECT",None)
    for period in range(periods):
        # Once for this original operator/period. It is not replicated for
        # each enterprise. The amounts are stress fixture inputs only.
        cost(f"common-{period}","op",100000+period*10000,"COMMON_CAPABILITY",None)
        scheduled = []
        for i, owner in enumerate(firms):
            first = (i+period+1)%enterprises
            second = (i+period+2)%enterprises
            work = f"work-{period}-{i:05d}"
            submit(work,i,first,second,period)
            scheduled.append((work,i,first,second))
            # Exact declared resource/cash rows for the controlled fixture,
            # not a computed claim that organization creates these values.
            transfer(work+"-sale","EXTERNAL",owner,900+(i%17)*11,work)
            transfer(work+"-supplier",owner,firms[first],240+i%31,work)
            transfer(work+"-support",owner,firms[second],130+i%19,work)
            transfer(work+"-operator",owner,"op",20+i%9,work)
            transfer(work+"-materials",firms[first],"EXTERNAL",90+i%13,work)
            cost(work+"-production",firms[first],100+i%21,"DELIVERY",work)
            cost(work+"-support-cost",firms[second],45+i%11,"DELIVERY",work)
            cost(work+"-buyer-preparation",owner,13+i%7,"COORDINATION",work)
            cost(work+"-operator-preparation","op",5+i%4,"COORDINATION",work)
        # Every resource already has two commitments for this period.
        # Additional genuine requests compete on precisely those resources.
        # They incur declared preparation expense but no sale/fee/delivery.
        for i in range(0,enterprises,10):
            work = f"conflict-{period}-{i:05d}"
            submit(work,i,(i+period+1)%enterprises,(i+period+2)%enterprises,period)
            cost(work+"-preparation",firms[i],8+i%7,"COORDINATION",work)
            cost(work+"-operator-attempt","op",4+i%3,"COORDINATION",work)
        # All successful obligations are outstanding before execution begins.
        for work,i,first,second in scheduled:
            emit("start",firms[first],work=work)
        for work,i,first,second in scheduled:
            emit("complete",firms[first],work=work,result_ref=f"model://{work}/result")
        for work,i,first,second in scheduled:
            emit("accept",firms[i],work=work)

    return {
        "schema":"IWXA_AKIS_QUALITATIVE_INPUT/0.1","evidence":"MODEL_ONLY",
        "network_scale":True,"capacity_strict":True,
        "institution":{"operator":"op","founders":["op",firms[0],firms[1]],
                       "mode":"SOLE","revision":"oc-1",
                       "council_members":[firms[0],firms[1]],"council_quorum":2,
                       "council_rule":"UNANIMOUS","operator_mandate":["authorize","exclude"],
                       "mixed_reserved":[]},
        "subjects":subjects,
        "resources":[{"id":key,"owner":owner,"availability":"AVAILABLE",
                      "capacity_units":2,"capacity_unit":"work-units","site":owner}
                     for key,owner in zip(resources,firms,strict=True)],
        "works":[],"events":events,
        "economic_claims":{"period":f"network-{periods}-periods","currency":"RUB",
                           "sources":sources,"transfers":transfers,"resource_uses":costs,
                           "coverage":{COOP:source_ids.copy(),ALT:{}},
                           "outside_feasibility":{}},
    }


def verify_network_result(doc: dict, out: dict, enterprises: int, periods: int) -> dict:
    expected_accepted = enterprises*periods
    expected_blocked = ((enterprises+9)//10)*periods
    assert len(out["subjects"]) == enterprises+1
    assert len(out["resources"]) == enterprises
    assert len(out["trace"]) == len(doc["events"])
    assert out["counts"]["blocked"] == expected_blocked
    assert out["counts"]["applied"] == len(doc["events"])-expected_blocked
    reasons = Counter(row["reason"] for row in out["trace"] if row["outcome"]=="BLOCKED")
    assert reasons == {"RESOURCE_CAPACITY_EXCEEDED":expected_blocked}
    work_states = out["works"]
    assert len(work_states)==expected_accepted+expected_blocked
    accepted = {key for key,row in work_states.items() if row["result"]==ACCEPTED}
    blocked = set(work_states)-accepted
    assert len(accepted)==expected_accepted and len(blocked)==expected_blocked
    assert all(key.startswith("work-") for key in accepted)
    assert all(key.startswith("conflict-") and work_states[key]["obligation"]=="NOT_ACCEPTED"
               for key in blocked)
    assert len({work_states[key]["result_ref"] for key in accepted})==expected_accepted
    assert all(len(work_states[key]["consenting_principals"])==3 for key in accepted)
    reservations = out["capacity"]["reservations"]
    assert len(reservations)==expected_accepted*2
    by_window = Counter((row["resource"],row["start"],row["end"]) for row in reservations)
    assert len(by_window)==enterprises*periods and set(by_window.values())=={2}
    assert {row["work"] for row in reservations}==accepted
    econ = out["economics"]
    assert econ["profit"]=="UNKNOWN"
    assert not econ["consolidated_comparable_declared"]
    money=doc["economic_claims"]
    assert econ["transfers_count"]==len(money["transfers"])==5*expected_accepted
    assert econ["resource_uses_count"]==len(money["resource_uses"])
    assert econ["internal_transfers_count"][COOP]==3*expected_accepted
    assert all(row["work"] in accepted for row in money["transfers"])
    record_evidence=econ["original_work_record_evidence"]
    assert all(record_evidence[k]["existing_transfer_rows"][COOP]==0
               and record_evidence[k]["existing_noncash_resource_use_rows"][COOP]==2
               for k in blocked)
    external=sum((Decimal(row["amount"])*(1 if row["payer"]=="EXTERNAL" else -1)
                  for row in money["transfers"] if "EXTERNAL" in {row["payer"],row["payee"]}),Decimal(0))
    owner_sum=sum((Decimal(row["flow_sums_from_claims"][COOP])
                   for row in econ["per_subject"].values()),Decimal(0))
    assert owner_sum==external==Decimal(econ["consolidated_external_cash_from_claims"][COOP])
    # Verify one declared common cost per period and entry cost per company.
    common=[row for row in money["resource_uses"] if row["bucket"]=="COMMON_CAPABILITY"]
    entry=[row for row in money["resource_uses"] if row["bucket"]=="PARTICIPANT_CONNECT"]
    assert len(common)==periods and all(row["owner"]=="op" and row["work"] is None for row in common)
    assert len(entry)==enterprises and len({row["owner"] for row in entry})==enterprises
    # The redacted scientific result contains COUNTS and invariants, no money
    # values or identifiers. There is deliberately no claimed profit effect.
    return {
        "schema":"AKIS_ORIGINAL_NETWORK_SCALE_INFRASTRUCTURE/1",
        "engine":"MESA_3_5_2","one_model":True,"enterprises":enterprises,
        "original_operator_count":1,"periods":periods,
        "original_subjects":len(out["subjects"]),"original_resources":len(out["resources"]),
        "original_works":len(work_states),"accepted_results":len(accepted),
        "capacity_blocked_works":len(blocked),"original_events":len(out["trace"]),
        "original_reservations":len(reservations),
        "original_declared_transfer_rows":econ["transfers_count"],
        "original_declared_resource_rows":econ["resource_uses_count"],
        "all_enterprises_buy_and_supply":True,
        "same_original_resource_contention_verified":True,
        "independent_original_consents_verified":True,
        "internal_cash_conservation_verified":True,
        "blocked_order_no_declared_revenue":True,
        "one_common_expense_per_period_verified":True,
        "full_nine_component_network_qualified":False,
        "executed_without_akis_comparison_qualified":False,
        "actual_profit_or_economic_causality_verified":False,
    }


def run_network(enterprises: int, periods: int = 3) -> dict:
    doc=network_document(enterprises,periods)
    out=simulate(doc)
    return verify_network_result(doc,out,enterprises,periods)


if __name__=="__main__":
    n=int(sys.argv[1])
    started=time.perf_counter()
    summary=run_network(n)
    payload=json.dumps(summary,sort_keys=True,indent=2,allow_nan=False)+"\n"
    path=Path(__file__).resolve().parent/f"network_scale_infrastructure_{n}.json"
    path.write_bytes(payload.encode("utf-8"))
    print(payload,end="")
    print("AKIS_NETWORK_SCALE_SHA256="+sha256(path.read_bytes()).hexdigest())
    print(f"AKIS_NETWORK_SCALE_WALL_SECONDS={time.perf_counter()-started:.3f}")
