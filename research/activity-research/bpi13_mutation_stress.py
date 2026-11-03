#!/usr/bin/env python3
"""IWXA BPI13: controlled mutations of a real registered-event projection.

Compares SOURCE SNAPSHOTS, not the truth of underlying human activity.
All interventions are researcher-authored SYNTHETIC; no TaskTypes/Tasks created.
"""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timedelta
from hashlib import sha256
import json
from pathlib import Path
import sys

from bpi13_xes_u1_replay import (
    Hold, analyze, check, inspect_registered_rows, parse_xes,
    project_registered_rows,
)

VERSION = "IWXA_BPI13_ACTIVITY_MUTATION_STRESS/0.1"
SCENARIOS = (
    "DELETE_REGISTERED_EVENT",
    "INSERT_SYNTHETIC_EVENT",
    "BACKDATE_REGISTERED_TIMESTAMP",
    "REASSIGN_REGISTERED_CASE",
    "RENAME_REGISTERED_ACTIVITY",
    "DUPLICATE_EVENT_ID",
    "UNLOGGED_OFF_SYSTEM_ACTION",
)
SYNTHETIC = "RESEARCHER_CONSTRUCTED_NOT_REAL_ACTIVITY"


def selected_sample(compressed: bytes, max_traces: int = 12) -> list[dict]:
    check(type(max_traces) is int and 2 <= max_traces <= 24,
          "BPI_STRESS_SAMPLE_SIZE_INVALID")
    traces, _ = parse_xes(compressed)
    eligible = sorted(
        (c for c, events in traces.items() if len(events) >= 2),
        key=lambda c: (sha256(("BPI13:" + c).encode()).digest(), c),
    )
    check(len(eligible) >= max_traces, "BPI_STRESS_TOO_FEW_CASES")
    rows, _ = project_registered_rows(traces, eligible[:max_traces])
    check(len(rows) >= max_traces * 2, "BPI_STRESS_TOO_FEW_EVENTS")
    return rows


def modified(rows: list[dict], scenario: str) -> list[dict]:
    check(scenario in SCENARIOS, "BPI_STRESS_UNKNOWN_SCENARIO")
    result = deepcopy(rows)
    # Choose a case with at least three events where possible, so removal
    # leaves at least two events for meaningful comparison.
    counts = Counter(e["case_id"] for e in result)
    target = next((i for i, e in enumerate(result)
                   if counts[e["case_id"]] >= 3), 0)
    if scenario == "DELETE_REGISTERED_EVENT":
        del result[target]
    elif scenario == "INSERT_SYNTHETIC_EVENT":
        invented = deepcopy(result[target])
        invented["event_id"] = invented["event_id"] + "-INSERTED"
        invented["activity"] = "IWXA_SYNTHETIC_UNOBSERVED_STEP"
        invented["attributes"]["origin_scope"] = SYNTHETIC
        invented["attributes"]["real_world_execution"] = "NOT_OBSERVED_SYNTHETIC"
        result.insert(target + 1, invented)
    elif scenario == "BACKDATE_REGISTERED_TIMESTAMP":
        event = result[target]
        time = datetime.fromisoformat(event["timestamp"])
        event["timestamp"] = (time - timedelta(days=90)).isoformat()
        event["attributes"]["origin_scope"] = SYNTHETIC
    elif scenario == "REASSIGN_REGISTERED_CASE":
        event = result[target]
        alternative = next(e["case_id"] for e in result
                           if e["case_id"] != event["case_id"])
        event["case_id"] = alternative
        event["attributes"]["origin_scope"] = SYNTHETIC
    elif scenario == "RENAME_REGISTERED_ACTIVITY":
        result[target]["activity"] = "IWXA_SYNTHETIC_ACTIVITY_LABEL"
        result[target]["attributes"]["origin_scope"] = SYNTHETIC
    elif scenario == "DUPLICATE_EVENT_ID":
        result[target]["event_id"] = result[-1]["event_id"]
    elif scenario == "UNLOGGED_OFF_SYSTEM_ACTION":
        # A putative real-world action without a log record is NOT evidence.
        # It is explicitly invisible in this test's input by construction.
        pass
    return result


def signature(report: dict) -> tuple:
    return tuple(
        (u["id"], u["sha256"], u["process_context"]["case_event_count"],
         u["process_context"]["position_by_reported_timestamp"])
        for u in report["units"]
    )


def run(rows: list[dict], *, u1_loader=None) -> dict:
    loader_kwargs = {} if u1_loader is None else {"u1_loader": u1_loader}
    baseline_raw, baseline, pinned = inspect_registered_rows(rows, **loader_kwargs)
    baseline_ids = {u["id"] for u in baseline["units"]}
    results = []
    for name in SCENARIOS:
        changed = modified(rows, name)
        expected_changed = name != "UNLOGGED_OFF_SYSTEM_ACTION"
        try:
            raw, receipt, source_pin = inspect_registered_rows(changed, **loader_kwargs)
        except ValueError as exc:
            # The test deliberately triggers one native U1 rejection.
            code = str(exc)
            check(code == "DUPLICATE_EVENT_ID" and name == "DUPLICATE_EVENT_ID",
                  "BPI_STRESS_UNEXPECTED_U1_REJECTION")
            results.append({
                "scenario": name, "synthetic_intervention": True,
                "u1_result": "REJECTED_INVALID_SOURCE",
                "u1_rejection": code,
                "source_mutated": True,
                "baseline_comparison_has_reference": True,
                "real_world_activity_truth": "UNKNOWN",
                "task_type_ids_assigned": 0,
                "engine_accepted": False,
            })
            continue

        check(source_pin == pinned, "BPI_STRESS_OWNER_PIN_CHANGED")
        changed_bytes = raw != baseline_raw
        check(changed_bytes == expected_changed, "BPI_STRESS_MUTATION_NOT_APPLIED")
        check(receipt["task_type_ids_assigned"] == 0
              and receipt["engine_accepted"] is False,
              "BPI_STRESS_TASK_AUTHORITY_ESCALATION")
        new_ids = {u["id"] for u in receipt["units"]}
        results.append({
            "scenario": name, "synthetic_intervention": True,
            "u1_result": "ACCEPTED_AS_REPORTED_SOURCE",
            "u1_rejection": None,
            "source_mutated": changed_bytes,
            "baseline_comparison_has_reference": True,
            "source_sha_changed": sha256(raw).hexdigest() != sha256(baseline_raw).hexdigest(),
            "unit_count_delta": receipt["unit_count"] - baseline["unit_count"],
            "unchanged_raw_evidence_unit_ids": len(baseline_ids & new_ids),
            "reported_context_changed": signature(receipt) != signature(baseline),
            "real_world_activity_truth": "UNKNOWN",
            "task_type_ids_assigned": receipt["task_type_ids_assigned"],
            "engine_accepted": receipt["engine_accepted"],
        })

    by_name = {r["scenario"]: r for r in results}
    check(by_name["DELETE_REGISTERED_EVENT"]["unit_count_delta"] == -1,
          "BPI_STRESS_DELETE_COUNT_MISMATCH")
    check(by_name["INSERT_SYNTHETIC_EVENT"]["unit_count_delta"] == 1,
          "BPI_STRESS_INSERT_COUNT_MISMATCH")
    check(by_name["UNLOGGED_OFF_SYSTEM_ACTION"]["source_mutated"] is False
          and by_name["UNLOGGED_OFF_SYSTEM_ACTION"]["reported_context_changed"] is False,
          "BPI_STRESS_OFF_SYSTEM_INVISIBLE_IN_LOG")
    check(by_name["DUPLICATE_EVENT_ID"]["u1_result"] ==
          "REJECTED_INVALID_SOURCE", "BPI_STRESS_DUPLICATE_NOT_REJECTED")
    check(all(x["real_world_activity_truth"] == "UNKNOWN"
              and x["task_type_ids_assigned"] == 0
              and x["engine_accepted"] is False for x in results),
          "BPI_STRESS_UNFOUNDED_AUTHORITY")
    accepted = sum(x["u1_result"] == "ACCEPTED_AS_REPORTED_SOURCE"
                   for x in results)
    rejected = len(results) - accepted
    return {
        "schema": VERSION,
        "status": "REAL_LOG_WITH_SYNTHETIC_MUTATIONS_SCOPED_EXPERIMENT",
        "source": "BPI13_GIT_BLOB_PINNED_THIRD_PARTY_MIRROR_4TU_MATCH_PENDING",
        "pinned_owner_u1_git_blob": pinned,
        "baseline": {
            "registered_event_rows": len(rows),
            "original_projection_sha256": sha256(baseline_raw).hexdigest(),
            "u1_unit_count": baseline["unit_count"],
            "task_type_ids_assigned": 0,
            "engine_accepted": False,
        },
        "summary": {
            "cases": len(SCENARIOS),
            "accepted_as_formally_valid_reported_logs": accepted,
            "rejected_as_formally_invalid_logs": rejected,
            "semantic_mutations_accepted_are_real_world_truth": False,
            "log_absence_can_prove_absence_of_action": False,
            "with_baseline_comparison": True,
            "without_baseline_real_world_integrity": "NOT_DETERMINED",
            "independent_task_quality": "NOT_MEASURED",
        },
        "scenarios": results,
        "interpretation": "A native U1 receipt verifies source structure and anchors, not factual "
                          "human work. Ground-truth for mutations exists only by construction. "
                          "Unlogged acts cannot be recovered from a log alone.",
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--xes-gz", type=Path, required=True)
    p.add_argument("--max-traces", type=int, default=12)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    try:
        check(not args.out.exists() and args.out != args.xes_gz,
              "BPI_STRESS_OUTPUT_INVALID")
        rows = selected_sample(args.xes_gz.read_bytes(), args.max_traces)
        report = run(rows)
        args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n",
                            encoding="utf-8")
        print("BPI13_MUTATION_U1", report["summary"]["cases"], "scenarios",
              report["summary"]["accepted_as_formally_valid_reported_logs"],
              "accepted_as_log",
              report["summary"]["rejected_as_formally_invalid_logs"],
              "rejected_invalid")
        return 0
    except (Hold, ValueError, OSError) as exc:
        print("BPI13_MUTATION_HOLD", str(exc)[:100], file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
