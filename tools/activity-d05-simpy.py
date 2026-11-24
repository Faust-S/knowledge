"""Local original SimPy model of declared D05 technology scenarios.
Not the domain's scheduler, an execution record, inspection engine or release authority.
All inputs are explicit local Task artifacts. No file paths in the protocol.
"""
from collections import deque
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from importlib.metadata import version
import json
import re
import sys

VERSION = "4.1.2"
LIMIT = 8 * 1024 * 1024
PROFILE = "ACTIVITY_D05_SIMPY_COMPARISON_V1"
UNITS = ("hours", "work-days", "calendar-days")
KINDS = ("internal", "subcontract", "wait", "inspection", "transport")
POLICIES = ("RELEASE_RESOURCE_DURING_BUFFER", "HOLD_RESOURCE_DURING_BUFFER")
LIMITATIONS = ["CONTINUOUS_TIME_NO_SHIFT_CALENDAR", "INPUTS_ASSUMED_AVAILABLE",
               "NO_STOCHASTIC_VARIATION_OR_FAILURES", "NO_PHYSICAL_QUALITY_OUTCOMES",
               "NO_SLACK_OR_OVERALL_RESERVE_SCHEDULING", "DECLARED_COSTS_NOT_FULL_ECONOMICS"]


class Hold(Exception):
    pass


def need(ok, code):
    if not ok:
        raise Hold(code)


def exact(value, keys):
    return type(value) is dict and set(value) == set(keys.split())


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def unique(pairs):
    result = {}
    for k, v in pairs:
        need(k not in result, "SIMPY_DUPLICATE_KEY")
        result[k] = v
    return result


def constant(_):
    raise Hold("SIMPY_JSON_INVALID")


def ident(value):
    return type(value) is str and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", value) is not None


def decimal_value(value):
    need(type(value) is str and re.fullmatch(r"[0-9]{1,9}(?:[.,][0-9]{1,6})?", value) is not None,
         "SIMPY_TIME_VALUE_INVALID")
    try:
        return Decimal(value.replace(",", "."))
    except InvalidOperation as exc:
        raise Hold("SIMPY_TIME_VALUE_INVALID") from exc


def whole_minutes(amount):
    need(amount == amount.to_integral_value() and 0 <= amount <= 1000000, "SIMPY_MINUTE_PRECISION")
    return int(amount)


def canonical(value):
    # D05 technology uses strings, booleans, null and small weekday integers.
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def declared_parameters(items):
    need(type(items) is list and len(items) <= 32, "SIMPY_CANDIDATE_PARAMETERS")
    params = {}
    for p in items:
        need(exact(p, "field mode value guidance") and type(p["field"]) is str and
             p["field"] not in params and p["mode"] in ("NEEDS_DECISION", "RETAIN_DECLARATION", "PARAMETERIZE"),
             "SIMPY_CANDIDATE_PARAMETERS")
        if p["mode"] == "RETAIN_DECLARATION":
            need(p["value"] is not None and p["guidance"] is None, "SIMPY_CANDIDATE_PARAMETERS")
        elif p["mode"] == "PARAMETERIZE":
            need(p["value"] is None and type(p["guidance"]) is str and p["guidance"].strip(), "SIMPY_CANDIDATE_PARAMETERS")
        else:
            need(p["value"] is None and p["guidance"] is None, "SIMPY_CANDIDATE_PARAMETERS")
        params[p["field"]] = p
    return params


def retained_equal(params, key, actual, numeric=False):
    row = params.get(key)
    if row and row["mode"] == "RETAIN_DECLARATION":
        expected = decimal_value(row["value"]) if numeric else row["value"]
        need(expected == actual, "SIMPY_RETAINED_PARAMETER_CHANGED")


def validate_candidate(candidate):
    need(type(candidate) is dict and candidate.get("status") in
         ("LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW", "LOCAL_CANDIDATE_NEEDS_REVIEW_INPUT") and
         candidate.get("export_allowed") is False and candidate.get("anonymity") == "NOT_ESTABLISHED" and
         candidate.get("disclosure_review") == "NOT_PERFORMED" and candidate.get("domain_validation") == "NOT_PERFORMED" and
         "iwxa_package" in candidate and candidate["iwxa_package"] is None,
         "SIMPY_CANDIDATE_PROFILE")
    tech = candidate.get("technology")
    need(exact(tech, "terms route_parameters operations quality_checks") and type(tech["terms"]) is dict and
         type(tech["operations"]) is list and 1 <= len(tech["operations"]) <= 128 and
         type(tech["quality_checks"]) is list and len(tech["quality_checks"]) <= 2048,
         "SIMPY_CANDIDATE_STRUCTURE")
    route = declared_parameters(tech["route_parameters"])
    nodes = {}
    for op in tech["operations"]:
        need(exact(op, "operation_id label kind parallel milestone predecessors role equipment_requirement material_requirement parameters") and
             ident(op["operation_id"]) and op["operation_id"] not in nodes and op["kind"] in KINDS and
             type(op["parallel"]) is bool and type(op["milestone"]) is bool and
             type(op["predecessors"]) is list and len(op["predecessors"]) <= 128 and
             all(ident(p) for p in op["predecessors"]) and len(set(op["predecessors"])) == len(op["predecessors"]),
             "SIMPY_CANDIDATE_OPERATION")
        nodes[op["operation_id"]] = {**op, "parameter_map": declared_parameters(op["parameters"])}
    # Validate the original explicit graph only. SimPy, not this traversal, executes it.
    indegree = {k: len(n["predecessors"]) for k, n in nodes.items()}
    next_nodes = {k: [] for k in nodes}
    need(sum(indegree.values()) <= 1024, "SIMPY_CANDIDATE_GRAPH_LIMIT")
    for k, node in nodes.items():
        for p in node["predecessors"]:
            need(p in nodes and p != k, "SIMPY_CANDIDATE_DEPENDENCY")
            next_nodes[p].append(k)
    queue = deque(k for k in nodes if not indegree[k])
    visited = 0
    while queue:
        k = queue.popleft()
        visited += 1
        for child in next_nodes[k]:
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
    need(visited == len(nodes), "SIMPY_CANDIDATE_CYCLE")
    checks = set()
    for check in tech["quality_checks"]:
        need(exact(check, "check_id title operation_id control_type responsible_role declared_fields") and
             ident(check["check_id"]) and check["check_id"] not in checks and
             (check["operation_id"] is None or check["operation_id"] in nodes) and
             type(check["declared_fields"]) is list, "SIMPY_CANDIDATE_QUALITY")
        checks.add(check["check_id"])
    return tech, route, nodes


def validate_scenario(scenario, route, nodes):
    need(exact(scenario, "hours_per_day resources operations other_cost_minor_per_order") and
         type(scenario["resources"]) is list and 0 <= len(scenario["resources"]) <= 128 and
         type(scenario["operations"]) is list and len(scenario["operations"]) == len(nodes) and
         integer(scenario["other_cost_minor_per_order"], 0, 1000000000), "SIMPY_SCENARIO_PROFILE")
    day = decimal_value(scenario["hours_per_day"])
    need(0 < day <= 24, "SIMPY_WORKDAY_INVALID")
    retained_equal(route, "hoursPerDay", day, True)
    resources = {}
    for resource in scenario["resources"]:
        need(exact(resource, "key capacity rate_minor_per_minute") and ident(resource["key"]) and
             resource["key"] not in resources and integer(resource["capacity"], 1, 64) and
             integer(resource["rate_minor_per_minute"], 0, 1000000), "SIMPY_RESOURCE_PROFILE")
        resources[resource["key"]] = resource
    ops = {}
    for op in scenario["operations"]:
        need(exact(op, "operation_id duration unit setup_hours buffer_hours resource_key") and
             ident(op["operation_id"]) and op["operation_id"] in nodes and op["operation_id"] not in ops and
             op["unit"] in UNITS, "SIMPY_SCENARIO_OPERATION")
        node = nodes[op["operation_id"]]
        params = node["parameter_map"]
        duration, setup, buffer = (decimal_value(op[k]) for k in ("duration", "setup_hours", "buffer_hours"))
        retained_equal(params, "duration", duration, True)
        retained_equal(params, "unit", op["unit"])
        retained_equal(params, "setup", setup, True)
        retained_equal(params, "buffer", buffer, True)
        multiplier = {"hours": Decimal(60), "work-days": day * 60, "calendar-days": Decimal(1440)}[op["unit"]]
        d, s, b = whole_minutes(duration * multiplier), whole_minutes(setup * 60), whole_minutes(buffer * 60)
        key = op["resource_key"]
        need((key is None and (node["kind"] == "wait" or (node["milestone"] and d+s == 0))) or
             (ident(key) and key in resources), "SIMPY_RESOURCE_UNASSIGNED")
        ops[op["operation_id"]] = {"duration": d, "setup": s, "buffer": b, "resource": key}
    need(set(ops) == set(nodes), "SIMPY_SCENARIO_COVERAGE")
    return resources, ops, scenario["other_cost_minor_per_order"]


def load(payload):
    need(0 < len(payload) <= LIMIT, "SIMPY_INPUT_LIMIT")
    try:
        req = json.loads(payload.decode("utf-8"), object_pairs_hook=unique, parse_constant=constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise Hold("SIMPY_JSON_INVALID") from exc
    need(exact(req, "profile candidate arrival_minutes deadline_after_minutes buffer_policy currency baseline recipient") and
         req["profile"] == PROFILE and req["buffer_policy"] in POLICIES and
         type(req["currency"]) is str and re.fullmatch(r"[A-Z]{3}", req["currency"]) and
         type(req["arrival_minutes"]) is list and 1 <= len(req["arrival_minutes"]) <= 200 and
         all(integer(v, 0, 1000000) for v in req["arrival_minutes"]) and
         req["arrival_minutes"] == sorted(req["arrival_minutes"]) and
         integer(req["deadline_after_minutes"], 1, 100000000), "SIMPY_REQUEST_PROFILE")
    tech, route, nodes = validate_candidate(req["candidate"])
    baseline = validate_scenario(req["baseline"], route, nodes)
    recipient = validate_scenario(req["recipient"], route, nodes)
    return req, tech, nodes, baseline, recipient


def simulate(simpy, nodes, scenario, arrivals, deadline, policy):
    resources, ops, other_cost = scenario
    env = simpy.Environment()
    pools = {key: simpy.Resource(env, capacity=r["capacity"]) for key, r in resources.items()}
    counters = {key: {"busy_minutes": 0, "queue_minutes": 0, "uses": 0} for key in resources}
    operation_totals = {key: {"service_minutes": 0, "buffer_minutes": 0, "queue_minutes": 0} for key in nodes}
    completed = [{} for _ in arrivals]

    def operation(case, arrival, key, done):
        if arrival:
            yield env.timeout(arrival)
        dependencies = nodes[key]["predecessors"]
        if dependencies:
            yield env.all_of([done[p] for p in dependencies])
        ready = env.now
        settings = ops[key]
        service = settings["setup"] + settings["duration"]
        buffer = settings["buffer"]
        resource = settings["resource"]
        wait = 0
        if resource is None:
            yield env.timeout(service + buffer)
        else:
            held_buffer = buffer if policy == "HOLD_RESOURCE_DURING_BUFFER" else 0
            with pools[resource].request() as request:
                yield request
                wait = env.now - ready
                counters[resource]["queue_minutes"] += wait
                counters[resource]["busy_minutes"] += service + held_buffer
                counters[resource]["uses"] += 1
                yield env.timeout(service + held_buffer)
            if buffer != held_buffer:
                yield env.timeout(buffer - held_buffer)
        row = operation_totals[key]
        row["service_minutes"] += service
        row["buffer_minutes"] += buffer
        row["queue_minutes"] += wait
        completed[case][key] = env.now
        done[key].succeed()

    for i, arrival in enumerate(arrivals):
        done = {key: env.event() for key in nodes}
        for key in nodes:
            env.process(operation(i, arrival, key, done))
    env.run()
    need(all(len(case) == len(nodes) for case in completed), "SIMPY_INCOMPLETE_GRAPH")
    finish = [max(case.values()) for case in completed]
    turnaround = [end - start for start, end in zip(arrivals, finish)]
    elapsed = max(finish) - arrivals[0]
    resource_rows = []
    resource_cost = 0
    for key, r in resources.items():
        count = counters[key]
        cost = count["busy_minutes"] * r["rate_minor_per_minute"]
        resource_cost += cost
        capacity_minutes = elapsed * r["capacity"]
        need(count["busy_minutes"] <= capacity_minutes, "SIMPY_RESOURCE_ACCOUNTING")
        resource_rows.append({"key": key, "capacity": r["capacity"], **count,
                              "capacity_minutes": capacity_minutes, "cost_minor": cost})
    order_count = len(arrivals)
    need(resource_cost + other_cost * order_count <= 9007199254740991, "SIMPY_ACCOUNTING_RANGE")
    return {"model_order_count": order_count, "on_time_model_orders": sum(t <= deadline for t in turnaround),
            "elapsed_minutes": elapsed, "sum_turnaround_minutes": sum(turnaround),
            "max_turnaround_minutes": max(turnaround),
            "sum_queue_minutes": sum(v["queue_minutes"] for v in operation_totals.values()),
            "resource_cost_minor": resource_cost, "other_cost_minor": other_cost * order_count,
            "declared_total_cost_minor": resource_cost + other_cost * order_count,
            "orders": [{"model_order": i+1, "arrival_minutes": a, "completion_minutes": f,
                        "turnaround_minutes": t} for i, (a, f, t) in enumerate(zip(arrivals, finish, turnaround))],
            "operations": [{"operation_id": key, **value} for key, value in operation_totals.items()],
            "resources": resource_rows}


def run(payload):
    req, tech, nodes, baseline, recipient = load(payload)
    need(version("simpy") == VERSION, "SIMPY_PROFILE_NOT_INSTALLED")
    import simpy
    results = [simulate(simpy, nodes, scenario, req["arrival_minutes"], req["deadline_after_minutes"],
                        req["buffer_policy"]) for scenario in (baseline, recipient)]
    # Do not turn a simulated completion into a physically accepted product.
    return {"status": "LOCAL_D05_MODEL_COMPARISON", "engine": "SimPy", "version": VERSION,
            "input_sha256": sha256(payload).hexdigest(), "technology_sha256": sha256(canonical(tech)).hexdigest(),
            "time_basis": "CONTINUOUS_OPERATION_MINUTES", "currency": req["currency"],
            "buffer_policy": req["buffer_policy"], "deadline_after_minutes": req["deadline_after_minutes"],
            "quality_checks_count": len(tech["quality_checks"]), "candidate_status": req["candidate"]["status"],
            "source_authority": "UNVERIFIED_LOCAL_SCENARIO", "evidence": "MODEL_NOT_EXECUTION",
            "domain_validation": "NOT_PERFORMED", "limitations": LIMITATIONS,
            "baseline": results[0], "recipient": results[1],
            "anonymity": "NOT_ESTABLISHED", "export_allowed": False, "iwxa_package": None}


def main():
    try:
        need(len(sys.argv) == 1, "SIMPY_ARGUMENTS_INVALID")
        payload = sys.stdin.buffer.read(LIMIT + 1)
        result = json.dumps(run(payload), allow_nan=False, separators=(",", ":")).encode("utf-8")
        need(len(result) <= LIMIT, "SIMPY_OUTPUT_LIMIT")
        sys.stdout.buffer.write(result + b"\n")
        return 0
    except Hold as exc:
        code = str(exc)
    except (ImportError, ModuleNotFoundError):
        code = "SIMPY_PROFILE_NOT_INSTALLED"
    except Exception:
        code = "SIMPY_LOCAL_MODEL_FAILED"
    sys.stdout.write(json.dumps({"status": "HOLD", "code": code, "anonymity": "NOT_ESTABLISHED",
                                 "export_allowed": False, "iwxa_package": None}) + "\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
