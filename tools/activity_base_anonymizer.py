"""Deterministic A0 graph from synthetic, already selected activity snapshots.

An internal structural candidate, never an anonymized or exportable result.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path

INPUT_SCHEMA = "IWXA_SYNTHETIC_A0_SNAPSHOT/0.1"
OUTPUT_SCHEMA = "IWXA_A0_INTERNAL_CANDIDATE/0.1"
MAX_EVENTS = 10_000
MAX_TAG_LENGTH = 128


class BaselineHold(ValueError):
    """Refusal with a fixed error code, without source excerpts."""


def require(ok: bool, code: str) -> None:
    if not ok:
        raise BaselineHold(code)


def tag(value: object) -> bool:
    return type(value) is str and 0 < len(value) <= MAX_TAG_LENGTH and bool(value.strip())


def reconstruct(snapshot: dict) -> dict:
    """Return an internal, non-transferable graph; source is never mutated."""
    require(type(snapshot) is dict and snapshot.get("schema") == INPUT_SCHEMA,
            "UNSUPPORTED_OR_NON_SYNTHETIC_INPUT")
    subject = snapshot.get("selected_subject")
    require(tag(subject), "SUBJECT_SELECTION_REQUIRED")
    events = snapshot.get("events")
    require(type(events) is list and 0 < len(events) <= MAX_EVENTS,
            "EVENT_SELECTION_INVALID")

    cases: dict[str, list[dict]] = defaultdict(list)
    case_process: dict[str, str] = {}
    roles: set[str] = set()
    for event in events:
        require(type(event) is dict, "EVENT_INVALID")
        require(event.get("subject_scope") == subject,
                "SUBJECT_SCOPE_VIOLATION")
        require(event.get("status") == "observed",
                "NON_OBSERVED_EVENT_REQUIRES_EVIDENCE_REVIEW")
        require(all(tag(event.get(field)) for field in
                    ("case_ref", "process_binding", "state_binding", "role_binding")),
                "BOUND_EVENT_FIELDS_REQUIRED")
        ordinal = event.get("ordinal")
        require(type(ordinal) is int and 1 <= ordinal <= MAX_EVENTS,
                "EVENT_ORDINAL_INVALID")
        case_id = event["case_ref"]
        process = event["process_binding"]
        require(case_id not in case_process or case_process[case_id] == process,
                "CASE_PROCESS_CONFLICT")
        case_process[case_id] = process
        # Copy exactly the four fields used by the algorithm: no payload,
        # actor, authority, time, source id, or other text is copied.
        cases[case_id].append({
            "process": process,
            "state": event["state_binding"],
            "role": event["role_binding"],
            "ordinal": ordinal,
        })
        roles.add(event["role_binding"])

    by_process: dict[str, list[list[dict]]] = defaultdict(list)
    for case in cases.values():
        ordered = sorted(case, key=lambda item: item["ordinal"])
        require([x["ordinal"] for x in ordered] == list(range(1, len(ordered) + 1)),
                "CASE_SEQUENCE_GAP_OR_DUPLICATE")
        by_process[ordered[0]["process"]].append(ordered)

    role_alias = {name: f"role_{i:03d}"
                  for i, name in enumerate(sorted(roles), 1)}
    processes = []
    for number, process_name in enumerate(sorted(by_process), 1):
        traces = by_process[process_name]
        states = sorted({event["state"] for trace in traces for event in trace})
        state_alias = {name: f"state_{i:03d}"
                       for i, name in enumerate(states, 1)}
        state_roles: dict[str, set[str]] = defaultdict(set)
        transitions: dict[tuple[str, str], int] = defaultdict(int)
        for trace in traces:
            for event in trace:
                state_roles[event["state"]].add(event["role"])
            for left, right in zip(trace, trace[1:]):
                # Recorded succession, not causality or verified dependency.
                transitions[(left["state"], right["state"])] += 1
        processes.append({
            "id": f"process_{number:03d}",
            "trace_count": len(traces),
            "states": [
                {"id": state_alias[state],
                 "roles": [role_alias[role] for role in sorted(state_roles[state])]}
                for state in states
            ],
            "observed_successions": [
                {"from": state_alias[left], "to": state_alias[right],
                 "trace_occurrences": count,
                 "relation": "OBSERVED_ORDER_NOT_CAUSAL_DEPENDENCY"}
                for (left, right), count in sorted(transitions.items())
            ],
        })
    return {
        "schema": OUTPUT_SCHEMA,
        "stage": "A0_SYNTHETIC_STRUCTURAL_CANDIDATE",
        "processes": processes,
        "role_count": len(role_alias),
        "anonymous": False,
        "export_allowed": False,
        "iwxa_package": None,
        "provenance_verification": "NOT_PERFORMED",
        "risk_assessment": "NOT_PERFORMED",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--synthetic-a0", action="store_true", required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        require(args.input.resolve() != args.output.resolve(), "OUTPUT_COLLIDES_WITH_INPUT")
        data = json.loads(args.input.read_text(encoding="utf-8"))
        result = reconstruct(data)
        # No overwrite: caller controls the output location; source stays intact.
        with args.output.open("x", encoding="utf-8") as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
    except BaselineHold as exc:
        parser.exit(2, f"HOLD:{exc}\n")
    except (OSError, ValueError, TypeError):
        parser.exit(2, "HOLD:INPUT_OR_OUTPUT_UNAVAILABLE\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
