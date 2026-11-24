"""Original native mass lifecycle: bounded delegation and reusable preparation.

Compare fresh BUILD on every attempt against REUSE of an actually accepted
prior-period Work. The physical route, decisions, grants, cash and common
resources are unchanged. Unit prices are declared model assumptions only.
"""
from __future__ import annotations

from collections import Counter
from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
import sys
import time

from research.akis.qualitative_mesa.experiments.export_original_network_organization import (
    organization_document, RATES, _hash_rows,
)
from research.akis.qualitative_mesa.experiments.export_original_network_scale import (
    ACCEPTED, COOP,
)
from research.akis.qualitative_mesa.mesa_model import simulate


def preparation_document(enterprises: int, periods: int = 3, *, reuse: bool = True,
                         checkpoints: bool = True) -> dict:
    """Declare each grant, pattern and exclusive expense BEFORE execution."""
    d = organization_document(enterprises, periods, "S2")
    money = d["economic_claims"]
    life = money["lifecycle_costs"]
    source_rows = d["context_evidence"]["sources"]
    scope = money["network_period_scope"]
    functions = {row["work"]: row for row in d["general_akis"]["agent_functions"]}
    owners = {row["work_spec"]["id"]: row["work_spec"]["customer"]
              for row in d["events"] if row["action"] == "request"}
    for fn in functions.values():
        fn["requires_original_delegation"] = True
    events, old_to_new, positions, preparations, accepted, operations = [], {}, {}, {}, {}, {}

    def emit(row):
        event = dict(row, at=len(events)+1)
        events.append(event)
        return event["at"]

    for original in d["events"]:
        row = dict(original)
        action = row["action"]
        work = row.get("work")
        if action == "function_prepare":
            buyer = owners[work]
            source = f"model://{buyer}/mandate-{work}"
            source_rows.append({
                "id": source, "owner": buyer, "revision": "mandate-1",
                "status": "CONFIRMED", "usable_by": [buyer, "op"],
                "core": "corporate", "purposes": ["AKIS_DELEGATED_PREPARATION"],
                "operations": ["DERIVE"], "valid_from": 0,
            })
            grant_at = emit({"action": "function_delegate", "actor": buyer,
                             "work": work, "org_revision": "oc-1", "work_source_revision": "d-1",
                             "function_id": row["function_id"],
                             "function_source_ref": row["function_source_ref"],
                             "delegation_source_ref": source,
                             "delegation_source_revision": "mandate-1"})
            positions[(work, "function_delegate")] = len(events)-1
            row["delegation_at"] = grant_at
            _, period, suffix = work.split("-")
            prior_key = f"work-{int(period)-1}-{suffix}"
            template_ref = f"model://op/structure-{buyer}"
            pattern = {"operation": "BUILD", "pattern_id": "pattern-"+work,
                       "source_ref": template_ref, "source_revision": "pattern-1"}
            if reuse and prior_key in accepted:
                prior = accepted[prior_key]
                pattern.update(operation="REUSE", pattern_id=prior["pattern_id"],
                               prior_work=prior_key, prior_prepare_at=prior["prepare_at"],
                               prior_result_ref=prior["result_ref"], prior_accepted_at=prior["accept_at"])
            row["preparation_pattern"] = pattern
            operations[work] = pattern["operation"]
        elif action == "function_review":
            row["prepared_at"] = old_to_new[row["prepared_at"]]
        tick = emit(row)
        old_to_new[original["at"]] = tick
        if action == "function_prepare":
            preparations[work] = {"pattern_id": row["preparation_pattern"]["pattern_id"],
                                  "prepare_at": tick}
        elif action == "complete":
            preparations[work]["result_ref"] = row["result_ref"]
        elif action == "accept":
            accepted[work] = dict(preparations[work], accept_at=tick)
    last = len(events)
    horizon = last + 6
    if horizon > 3_000_000:
        raise ValueError("NETWORK_PREPARATION_HORIZON_EXCEEDS_LIMIT")
    d["events"] = events
    d["model_horizon"] = horizon
    if checkpoints:
        d["network_observation_ticks"] = [0, horizon]
        d["network_exact_preparation_observation"] = True
    else:
        d.pop("network_observation_ticks", None)
    for rows in d["general_akis"].values():
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, dict) and "expires_at" in row:
                    row["expires_at"] = horizon+1
    for row in source_rows:
        row["valid_until"] = (last+2 if "AKIS_DELEGATED_PREPARATION" in row["purposes"]
                              else horizon+1)
    for buyer in sorted(set(owners.values())):
        source_rows.append({
            "id": f"model://op/structure-{buyer}", "owner": "op",
            "revision": "pattern-1", "status": "CONFIRMED", "usable_by": ["op"],
            "core": "operator", "purposes": ["competence-reuse"], "operations": ["DERIVE"],
            "valid_from": 0, "valid_until": last+2,
        })
    for row in scope["owners"].values():
        row["observed_at"] = horizon
    for row in life["event_bindings"]:
        tick = old_to_new[row["at"]]
        row.update(at=tick, trace_position=tick-1)

    # Each pattern construction/reuse is a real modeled activity count from
    # the original APPLIED preparation. Every customer's grant cost is a
    # distinct original noncash record, even when commitment is blocked.
    rates = {mode: {**card, "pattern_build": "18.00", "pattern_reuse": "3.00"}
             for mode, card in RATES.items()}
    cost_rows = {row["id"]: row for row in money["resource_uses"]}
    for activity in life["preparation_activity_bindings"]:
        row = cost_rows[activity["resource_use_id"]]
        operation = operations[row["work"]]
        activity["unit_rates_by_mode"] = rates
        row["amount"] = str(Decimal(row["amount"]) +
                            Decimal(rates["S2"]["pattern_build" if operation == "BUILD" else "pattern_reuse"]))
    for work, buyer in owners.items():
        rid = work+"-mandate"
        proof = f"model://{buyer}/{rid}-proof"
        source_rows.append({
            "id": proof, "owner": buyer, "revision": "economic-1", "status": "CONFIRMED",
            "usable_by": [buyer], "core": "corporate",
            "purposes": ["AKIS_ECONOMIC_WORK_EVIDENCE"], "operations": ["READ"],
            "valid_from": 0, "valid_until": horizon+1,
        })
        source = money["coverage"][COOP][buyer]
        money["resource_uses"].append({"id": rid, "scenario": COOP, "owner": buyer,
                                       "work": work, "source": source,
                                       "amount": "4.00", "bucket": "COORDINATION"})
        life["bindings"].append({"resource_use_id": rid, "owner": buyer, "source": source,
                                 "stage": "CONTRACT_AND_PERMISSIONS", "nature": "TRANSACTION"})
        pos = positions[(work, "function_delegate")]
        life["event_bindings"].append({
            "resource_use_id": rid, "work": work, "owner": buyer, "source": source,
            "work_source_revision": "d-1", "trace_position": pos, "at": events[pos]["at"],
            "action": "function_delegate", "org_revision": "oc-1",
            "cost_evidence_ref": proof, "cost_evidence_revision": "economic-1",
        })
        scope["owners"][buyer]["resource_use_ids"].append(rid)
    return d


def run_preparation(enterprises: int, periods: int, reuse: bool) -> tuple[dict, dict]:
    doc = preparation_document(enterprises, periods, reuse=reuse)
    out = simulate(doc)
    n = enterprises*periods
    failed = ((enterprises+9)//10)*periods
    attempts = n+failed
    trace = out["trace"]
    assert len(trace) == len(doc["events"])
    assert Counter(row["reason"] for row in trace if row["outcome"] == "BLOCKED") == {
        "RESOURCE_CAPACITY_EXCEEDED": failed}
    assert sum(row["result"] == ACCEPTED for row in out["works"].values()) == n
    assert len(out["works"]) == attempts
    assert all(len(row["consenting_principals"]) == 3 for row in out["works"].values())
    assert len(out["capacity"]["reservations"]) == 2*n
    general = out["general_akis_model"]
    assert general["network_observation_design"]["full_history_endpoint_cross_checked"]
    repro = general["author_operator_reproducibility"]
    pattern = repro["structural_preparation_scope"]
    gate = general["agent_function_formation_model_gate"]
    delegation = gate["original_delegation_scope"]
    assert delegation["historical_original_chain_identified"]
    assert delegation["applied_mandate_count"] == attempts
    assert delegation["applied_delegated_preparation_count"] == attempts
    assert delegation["accepted_effective_preparation_count"] == n
    assert delegation["other_applied_preparation_count"] == failed
    assert pattern["accepted_effective_preparation_count"] == n
    assert pattern["accepted_effective_reuse_count"] == (enterprises*(periods-1) if reuse else 0)
    assert pattern["accepted_versions_with_current_source_and_oc"] == 0
    econ = out["economics"]
    assert econ["profit"] == "UNKNOWN"
    scope = econ["original_strict_context_source_qualification"]
    assert scope["network_period_exact_declared_owner_scope"]
    life = econ["lifecycle_resource_costs"]
    assert life["unclassified_original_record_count"] == 0
    assert life["original_preparation_activity_costs"]["original_cost_count"] == attempts
    costs = econ["original_delegation_attempt_costs"]
    assert costs["status"] == "MODEL_ORIGINAL_DELEGATION_ATTEMPT_COSTS_RECONCILED"
    totals = costs["local_research_only"]["aggregate"]
    assert Decimal(totals["all_mandate_cost"]) == 4*attempts
    assert Decimal(totals["other_mandate_cost"]) == 4*failed
    assert econ["original_pattern_reproduction_costs"]["status"] == "MODEL_ORIGINAL_PATTERN_COSTS_RECONCILED"
    net = {}
    for owner, row in life["owner_scoped_details"].items():
        side = row["scenarios"][COOP]
        assert side["declared_resource_scope_complete_not_audited"]
        cash = Decimal(econ["per_subject"][owner]["flow_sums_from_claims"][COOP])
        noncash = sum(map(Decimal, side["noncash_use_by_nature"].values()), Decimal(0))
        net[owner] = cash-noncash
    result = {
        "accepted_original_works": n, "capacity_blocked_original_works": failed,
        "original_work_attempts": attempts, "original_events": len(trace),
        "applied_grants": delegation["applied_mandate_count"],
        "applied_preparations": delegation["applied_delegated_preparation_count"],
        "accepted_effective_reuses": pattern["accepted_effective_reuse_count"],
        "accepted_pattern_versions": pattern["distinct_accepted_pattern_versions"],
        "structural_pattern_time": repro["structural_preparation_model_time"],
        "delegation_time": gate["original_delegation_model_time"],
        "packet_readiness_time": gate["original_packet_readiness_model_time"],
        "full_checkpoint_count": len(general["read_only_evolution"]),
        "compact_observation_design": general["network_observation_design"],
        "declared_attempt_costs_rub": totals,
        "operator_cash_minus_cost_rub": str(net["op"]),
        "network_cash_minus_cost_rub": str(sum(net.values(), Decimal(0))),
        "same_original_owner_evidence_cost_scope": True,
        "work_state_sha256": _hash_rows(
            ({"work": key, **row} for key, row in sorted(out["works"].items()))),
        "transfer_sha256": _hash_rows(doc["economic_claims"]["transfers"]),
        "event_baseline_sha256": _hash_rows(
            ({k:v for k,v in row.items() if k != "preparation_pattern"} for row in doc["events"])),
    }
    return result, net


def compare_preparation(enterprises: int, periods: int = 3) -> dict:
    build, a = run_preparation(enterprises, periods, False)
    reuse, b = run_preparation(enterprises, periods, True)
    for key in ("work_state_sha256", "transfer_sha256", "event_baseline_sha256",
                "delegation_time", "packet_readiness_time"):
        assert build[key] == reuse[key], key
    delta = {owner:b[owner]-a[owner] for owner in a}
    # The same exact physical route; the cost difference must follow only
    # the declared original BUILD/REUSE unit rates and observed attempts.
    attempted_reuses = (enterprises+(enterprises+9)//10)*(periods-1)
    assert sum(delta.values(), Decimal(0)) == 15*attempted_reuses
    assert delta["op"] == 15*attempted_reuses
    assert all(value == 0 for owner,value in delta.items() if owner != "op")
    return {
        "schema": "AKIS_ORIGINAL_MASS_PREPARATION_LIFECYCLE/1",
        "enterprises": enterprises, "periods": periods,
        "fresh_build": build, "reuse": reuse,
        "declared_noncash_saving_rub": str(delta["op"]),
        "enterprises_with_changed_net_contribution": sum(v != 0 for k,v in delta.items() if k != "op"),
        "declared_attempted_pattern_reuses": attempted_reuses,
        "same_physical_route_and_owner_mandates": True,
        "profit": "UNKNOWN",
        "actual_time_savings_or_empirical_causality_verified": False,
    }


if __name__ == "__main__":
    n = int(sys.argv[1])
    periods = int(sys.argv[2]) if len(sys.argv)>2 else 3
    started = time.perf_counter()
    report = compare_preparation(n, periods)
    payload = json.dumps(report, sort_keys=True, indent=2, allow_nan=False)+"\n"
    path = Path(__file__).resolve().parent/f"network_preparation_{n}_{periods}.json"
    path.write_bytes(payload.encode("utf-8"))
    print(payload, end="")
    print("AKIS_NETWORK_PREPARATION_SHA256="+sha256(path.read_bytes()).hexdigest())
    print(f"AKIS_NETWORK_PREPARATION_WALL_SECONDS={time.perf_counter()-started:.3f}")
