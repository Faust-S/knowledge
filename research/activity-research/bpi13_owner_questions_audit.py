#!/usr/bin/env python3
"""BPI13-03: declared process-owner questions vs registered-event evidence.

Primary published questions (van Dongen et al., 2013) provide a problem/goal
source, NOT independent testimony that a system event or human action occurred.
The pinned U1 supplies reported log anchors, NOT verified human activity.
"""
from __future__ import annotations

import argparse
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path
import sys

import bpi13_xes_u1_replay as bpi

VERSION = "IWXA_ACTIVITY_OWNER_QUESTIONS_EVIDENCE_AUDIT/0.1"
PAPER = "https://ceur-ws.org/Vol-1052/summary.pdf"
PAPER_LOCATOR = "Section 2, page 2 (four process-owner questions)"
PAPER_DOI = bpi.OFFICIAL_DOI

# Strictly typed paraphrases of the four published questions. These are
# investigative intents, never descriptions of proven faulty behavior.
QUESTIONS = (
    {
        "id": "INCIDENT_ESCALATION_TIMING",
        "question_scope": "INCIDENTS_ONLY_EXPLICIT_IN_PAPER",
        "candidate_investigation": "Examine timing/frequency of second-/third-line escalation",
        "required_but_not_verified": ["incident_log", "support_line", "agreed_escalation_rule"],
        "evidence_result": "NOT_APPLICABLE_TO_OPEN_PROBLEMS_LOG",
    },
    {
        "id": "TEAM_PING_PONG",
        "question_scope": "PUBLISHED_CROSS_PROCESS_SCOPE_UNRESOLVED",
        "candidate_investigation": "Examine repeated handovers between actual support teams",
        "required_but_not_verified": ["reliably_attributed_team_per_event",
                                      "team_change_definition", "off_system_work"],
        "evidence_result": "UNANSWERABLE_FROM_ACTIVITY_LABELS_ONLY",
    },
    {
        "id": "WAIT_USER_STATUS_ABUSE",
        "question_scope": "PUBLISHED_CROSS_PROCESS_SCOPE_UNRESOLVED",
        "candidate_investigation": "Investigate reported wait-user status vs actual user dependency",
        "required_but_not_verified": ["substatus_history", "status_semantics",
                                      "independent_evidence_of_actual_waiting",
                                      "verified_reason_for_wait"],
        "evidence_result": "ABUSE_NOT_ESTABLISHED_BY_LOG_OR_STATUS",
    },
    {
        "id": "ORGANIZATION_PROCESS_CONFORMITY",
        "question_scope": "PUBLISHED_CROSS_PROCESS_SCOPE_UNRESOLVED",
        "candidate_investigation": "Compare reported process sequences across organizations",
        "required_but_not_verified": ["reliable_organization_membership",
                                      "declared_reference_process",
                                      "comparable_organizational_scope",
                                      "nonlogged_activity"],
        "evidence_result": "NORMATIVE_AND_CAUSAL_CONFORMITY_NOT_ESTABLISHED",
    },
)


def counts_from_reported_events(traces: dict[str, list]) -> dict:
    """Small honest baseline: activity-return motif is NOT team ping-pong."""
    bpi.check(type(traces) is dict and bool(traces), "BPI_OWNER_TRACES_INVALID")
    n_events = 0
    motifs = 0
    with_three = 0
    raw_order_regressions = 0
    distinct_activities = set()
    for events in traces.values():
        bpi.check(bool(events), "BPI_OWNER_EMPTY_CASE")
        n_events += len(events)
        if len(events) >= 3:
            with_three += 1
        for event in events:
            distinct_activities.add(event[1])
        for a, b in zip(events, events[1:]):
            raw_order_regressions += (datetime.fromisoformat(b[2]) <
                                      datetime.fromisoformat(a[2]))
        temporal = sorted(events, key=lambda e: (datetime.fromisoformat(e[2]), e[0]))
        for a, b, c in zip(temporal, temporal[1:], temporal[2:]):
            motifs += int(a[1] == c[1] and a[1] != b[1])
    return {
        "reported_cases": len(traces),
        "reported_events": n_events,
        "distinct_activity_labels_in_log": len(distinct_activities),
        "cases_with_at_least_three_registered_events": with_three,
        "activity_A_B_A_motifs_in_declared_timestamp_order": motifs,
        "registered_file_order_timestamp_regressions": raw_order_regressions,
        "motif_can_prove_team_ping_pong": False,
        "log_can_prove_actual_human_work": False,
        "log_can_prove_stated_motive": False,
        "log_can_prove_process_optimization": False,
    }


def compose_audit(traces: dict, *, source_sha: str, u1_report: dict) -> dict:
    bpi.check(len(source_sha) == 64, "BPI_OWNER_SOURCE_SHA_INVALID")
    counts = counts_from_reported_events(traces)
    bpi.check(u1_report["u1"]["task_type_ids_assigned"] == 0
              and u1_report["u1"]["engine_accepted"] is False,
              "BPI_OWNER_SOURCE_PROMOTED_TO_TASK")
    items = []
    for q in QUESTIONS:
        items.append({
            "investigation_id": q["id"],
            "question_source_url": PAPER,
            "question_locator": PAPER_LOCATOR,
            "epistemic_status": "PROCESS_OWNER_INTEREST_REPORTED_BY_PUBLISHED_ORGANIZERS",
            "candidate_investigation": q["candidate_investigation"],
            "source_scope": q["question_scope"],
            "registered_log_evidence": "VINST_OPEN_PROBLEMS_LOG_REPORTED_EVENTS_ONLY",
            "required_but_not_verified": q["required_but_not_verified"],
            "can_conclude_investigation_goal_exists_as_published": True,
            "can_conclude_misconduct_or_fault_exists": False,
            "can_conclude_real_human_task_instance": False,
            "evidence_sufficiency": q["evidence_result"],
            "task_type_accepted": False,
        })
    return {
        "schema": VERSION,
        "status": "TWO_DISTINCT_SOURCE_TYPES_RESEARCH_AUDIT_NOT_INDEPENDENT_EVENT_CORROBORATION",
        "sources": {
            "stated_questions": {"url": PAPER, "locator": PAPER_LOCATOR,
                                 "epistemic": "PUBLISHED_REPORT_OF_PROCESS_OWNER_QUESTIONS"},
            "registered_events": {"url": bpi.OFFICIAL_DOI, "mirror": bpi.MIRROR_URL,
                                  "source_sha256": source_sha,
                                  "epistemic": "THIRD_PARTY_MIRROR_REGISTERED_EVENTS"},
            "source_artifacts_distinct": True,
            "independent_real_world_event_confirmation": False,
            "official_4tu_byte_identity": "NOT_VERIFIED",
        },
        "log_scope": "BPI_2013_OPEN_PROBLEMS_ONLY",
        "reported_baseline": counts,
        "u1_sample": {
            "reported_events": u1_report["sample"]["registered_events"],
            "pinned_u1_blob": u1_report["u1"]["pinned_owner_git_blob"],
            "engine_accepted": False,
            "task_type_ids_assigned": 0,
        },
        "questions": items,
        "question_count": len(items),
        "accepted_task_count": 0,
        "accepted_task_type_count": 0,
        "actual_independent_work_observation_count": 0,
        "quality_of_task_discovery": "NOT_MEASURED",
        "interpretation": (
            "Owner's investigative questions supply a purpose, while VINST logs "
            "supply partial registered-event evidence. Neither provides the "
            "independent human-work truth or normative standards needed to answer "
            "the organizational and misconduct questions. A-B-A activity label "
            "motifs must not be described as transfers between people/teams."
        ),
    }


def analyze(compressed: bytes, *, max_traces: int = 12) -> dict:
    traces, _ = bpi.parse_xes(compressed)
    verified = bpi.analyze(compressed, max_traces=max_traces)
    return compose_audit(traces, source_sha=sha256(compressed).hexdigest(),
                         u1_report=verified)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--xes-gz", required=True, type=Path)
    p.add_argument("--max-traces", type=int, default=12)
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()
    try:
        bpi.check(not args.out.exists() and args.out != args.xes_gz,
                  "BPI_OWNER_OUTPUT_INVALID")
        report = analyze(args.xes_gz.read_bytes(), max_traces=args.max_traces)
        args.out.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True,
                                         indent=2) + "\n", encoding="utf-8")
        print("BPI13_OWNER_QUESTIONS",
              report["question_count"], "questions",
              report["reported_baseline"]["reported_cases"], "cases",
              report["reported_baseline"]["reported_events"], "registered events",
              "accepted_tasks", report["accepted_task_count"],
              "activity_patterns",
              report["reported_baseline"]["activity_A_B_A_motifs_in_declared_timestamp_order"])
        return 0
    except (bpi.Hold, OSError, ValueError) as e:
        print("BPI13_OWNER_QUESTIONS_HOLD", str(e)[:100], file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
