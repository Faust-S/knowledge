#!/usr/bin/env python3
"""BPI13 C1: applicability of the 4TU Incidents XES to owner questions.

Source-bounded research adapter, not another Activity Engine or Task Engine.
A record is not independent proof of an action, intention, fault or user Task.
"""
from __future__ import annotations

import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

import bpi13_xes_u1_replay as bpi

VERSION = "IWXA_BPI13_OFFICIAL_INCIDENTS_APPLICABILITY/0.1"
OFFICIAL_DOI = "https://doi.org/10.4121/uuid:500573e6-accc-4b0c-9576-aa5468b10cee"
OFFICIAL_URL = ("https://data.4tu.nl/file/"
                "0fc5c579-e544-4fab-9143-fab1f5192432/"
                "aa51ffbb-25fd-4b5a-b0b8-9aba659b7e8c")
EXPECTED_CASES, EXPECTED_EVENTS = 7554, 65533
EVENT_KEYS = ("org:group", "org:resource", "org:role",
              "organization involved", "lifecycle:transition")
TRACE_KEYS = ("organization involved", "org:group")


def evaluate_registered_fields(traces: dict, event_fields: dict,
                               trace_fields: dict) -> dict:
    """Only coverage and log-defined transitions; all values stay in memory."""
    events_count = sum(len(v) for v in traces.values())
    bpi.check(events_count > 0 and len(event_fields) == len(traces),
              "INCIDENTS_EVENT_FIELD_ALIGNMENT_INVALID")
    event_coverage, case_coverage = Counter(), Counter()
    org_values = set()
    changes = returns = wait_user = wait_user_cases = 0
    for case, events in traces.items():
        rows = event_fields[case]
        bpi.check(len(rows) == len(events), "INCIDENTS_EVENT_FIELD_ALIGNMENT_INVALID")
        for key, value in trace_fields[case].items():
            if value:
                case_coverage[key] += 1
                if key == "organization involved":
                    org_values.add(value)
        groups = []
        case_has_wait_user = False
        for (_, activity, _, lifecycle), meta in zip(events, rows):
            for key in EVENT_KEYS:
                if meta[key]:
                    event_coverage[key] += 1
            if meta["organization involved"]:
                org_values.add(meta["organization involved"])
            groups.append(meta["org:group"])
            status = re.sub(r"[^a-z0-9]+", " ",
                            ((activity or "") + " " + (lifecycle or "")).casefold())
            tokens = status.split()
            if any(a == "wait" and z == "user"
                   for a, z in zip(tokens, tokens[1:])):
                wait_user += 1
                case_has_wait_user = True
        wait_user_cases += int(case_has_wait_user)
        for a, z in zip(groups, groups[1:]):
            changes += int(bool(a and z and a != z))
        for a, z, c in zip(groups, groups[1:], groups[2:]):
            returns += int(bool(a and z and c and a == c and a != z))
    return {
        "denominator_registered_events": events_count,
        "denominator_registered_cases": len(traces),
        "event_attribute_coverage_counts": dict(sorted(event_coverage.items())),
        "case_attribute_coverage_counts": dict(sorted(case_coverage.items())),
        "distinct_recorded_organizations": len(org_values),
        "organization_involved_semantics": "REPORTER_BUSINESS_AREA_NOT_SUPPORT_ORG",
        "support_organization_identity_from_reporter_field": False,
        "consecutive_registered_group_changes": changes,
        "registered_group_A_B_A_motifs": returns,
        "wait_user_label_events": wait_user,
        "wait_user_label_cases": wait_user_cases,
        "wait_user_detection_scope": "CONCEPT_NAME_AND_LIFECYCLE_ONLY_NORMALIZED_PUNCTUATION",
        "group_change_is_actual_human_handover": False,
        "group_return_is_proven_process_abuse": False,
        "wait_label_is_proven_actual_waiting": False,
        "recorded_time_is_proven_execution_time": False,
    }


def question_gates(coverage: dict) -> list[dict]:
    ev = coverage["event_attribute_coverage_counts"]
    group = ev.get("org:group", 0) > 0
    wait = coverage["wait_user_label_events"] > 0
    return [
        {
            "id": "INCIDENT_ESCALATION_TIMING",
            "source_fit": ("INCIDENT_LOG_AND_GROUP_ATTRIBUTE_PRESENT"
                           if group else "INCIDENT_LOG_MISSING_GROUP_ATTRIBUTE"),
            "missing_evidence": ["authoritative_first_second_third_line_mapping",
                                 "escalation_timing_rule", "independent_action_check"],
            "fault_or_early_escalation_proven": False,
        },
        {
            "id": "TEAM_PING_PONG",
            "source_fit": ("REGISTERED_GROUP_TRANSITIONS_DESCRIBABLE"
                           if group else "GROUP_TRANSITIONS_UNKNOWN"),
            "missing_evidence": ["verified_group_identity_and_handover_semantics",
                                 "independent_handover_observation"],
            "real_human_team_ping_pong_proven": False,
        },
        {
            "id": "WAIT_USER_STATUS_ABUSE",
            "source_fit": ("WAIT_USER_REPORTED_LABEL_PRESENT"
                           if wait else "WAIT_USER_LABEL_NOT_OBSERVED"),
            "missing_evidence": ["independent_wait_reason",
                                 "user_response_and_elapsed_policy"],
            "misconduct_or_motive_proven": False,
        },
        {
            "id": "ORGANIZATION_PROCESS_CONFORMITY",
            "source_fit": "REQUESTER_ORG_FIELD_NOT_SUPPORT_ORG_CONFORMITY",
            "missing_evidence": ["authoritative_support_organization_A2_C_mapping",
                                 "authoritative_organization_membership",
                                 "comparable_case_mix", "normative_process_model"],
            "normative_nonconformity_proven": False,
        },
    ]


def analyze(compressed: bytes, *, expected_sha256: str | None = None,
            sample_cases: int = 12, u1_loader=bpi.native_u1) -> dict:
    """SHA recorded from this download is NOT an independent prior source pin."""
    bpi.check(type(sample_cases) is int and 1 <= sample_cases <= 24,
              "INCIDENTS_SAMPLE_CASES_INVALID")
    file_sha = sha256(compressed).hexdigest()
    pinned_before_run = expected_sha256 is not None
    digest = expected_sha256 if pinned_before_run else file_sha
    event_fields: dict[str, list[dict]] = {}
    trace_fields: dict[str, dict] = {}

    def on_trace(case, node):
        trace_fields[case] = {key: bpi.attr(node, key) for key in TRACE_KEYS}
        event_fields[case] = []

    def on_event(case, position, node):
        bpi.check(position == len(event_fields[case]) + 1,
                  "INCIDENTS_EVENT_POSITION_INVALID")
        event_fields[case].append({key: bpi.attr(node, key) for key in EVENT_KEYS})

    traces, pop = bpi.parse_xes(
        compressed, source_profile="OFFICIAL_INCIDENTS_CLAIM",
        expected_sha256=digest, on_trace=on_trace, on_event=on_event)
    coverage = evaluate_registered_fields(traces, event_fields, trace_fields)
    eligible = sorted(
        (case for case, seq in traces.items() if len(seq) >= 2),
        key=lambda c: (sha256(("BPI13_INCIDENTS:" + c).encode()).digest(), c))
    bpi.check(len(eligible) >= sample_cases, "INCIDENTS_TOO_FEW_SAMPLE_CASES")
    selected = eligible[:sample_cases]
    projected, _ = bpi.project_registered_rows(traces, selected)
    _, receipt, owner_blob = bpi.inspect_registered_rows(
        projected, u1_loader=u1_loader, source_reference=OFFICIAL_DOI,
        owner_ref="BPI2013-INCIDENTS-DIRECT-4TU-RESEARCH",
        authorization_ref="4TU_PUBLIC_RESEARCH_REUSE_LICENSE_REVIEW_PENDING")
    population_match = (len(traces) == EXPECTED_CASES
                        and pop["registered_events"] == EXPECTED_EVENTS)
    return {
        "schema": VERSION,
        "status": ("SOURCE_SCOPE_RESEARCH_PASS_INDEPENDENT_TRUTH_UNKNOWN"
                   if population_match else "SOURCE_POPULATION_MISMATCH_HOLD"),
        "source": {
            "official_dataset_doi": OFFICIAL_DOI,
            "official_download_url_expected": OFFICIAL_URL,
            "url_used_for_download": "ASSERTED_BY_RUNNER_NOT_ATTESTED_BY_PARSER",
            "file_sha256": file_sha,
            "bytes": len(compressed),
            "sha_pinned_before_this_run": pinned_before_run,
            "official_file_identity_independently_verified": False,
            "dataset_license_directly_verified": False,
            "source_rights_republication_authorized": "NOT_ASSESSED",
            "original_binary_exported": False,
        },
        "population": {
            "recorded_cases": len(traces),
            "registered_events": pop["registered_events"],
            "expected_cases_from_public_catalogue": EXPECTED_CASES,
            "expected_events_from_public_catalogue": EXPECTED_EVENTS,
            "catalogue_counts_match": population_match,
            "recorded_timestamp_regressions": pop[
                "declared_timestamp_regressions_in_file_order"],
        },
        "field_applicability": coverage,
        "owner_documentary_context": {
            "url": "https://ais.win.tue.nl/bpi/2013/vinst_data_set.pdf",
            "status": "DESCRIPTIVE_PROCESS_DOCUMENT_NOT_INDEPENDENT_EVENT_OBSERVATION",
            "organization_involved_field": "REPORTER_BUSINESS_AREA",
            "support_organization_A2_C_from_reporter_field": False,
        },
        "descriptive_literature_comparison": {
            "source": "https://www.ceur-ws.org/Vol-1052/paper10.pdf",
            "reference_wait_user_events": 4217,
            "reference_wait_user_cases": 2495,
            "same_origin_system_not_independent_work_evidence": True,
            "method_only_agreement": (
                coverage["wait_user_label_events"] == 4217
                and coverage["wait_user_label_cases"] == 2495
            ),
            "can_prove_misconduct_or_actual_waiting": False,
        },
        "questions": question_gates(coverage),
        "question_count": 4,
        "u1_sample": {
            "selected_cases": len(selected),
            "registered_events": len(projected),
            "native_owner_git_blob": owner_blob,
            "units": receipt["unit_count"],
            "evidence_strength": "REPORTED_EVENT_IN_UNVERIFIED_LOG",
            "accepted_tasktypes": receipt["task_type_ids_assigned"],
            "engine_accepted": receipt["engine_accepted"],
        },
        "source_independence": {
            "incidents_and_open_problems_same_original_vinst_system": True,
            "different_exports_are_independent_real_world_observations": False,
            "published_owner_questions_confirm_specific_events": False,
            "independent_confirmation_of_actual_work": "NOT_AVAILABLE",
        },
        "qualification": {
            "independent_work_as_done_ground_truth": "NOT_MEASURED",
            "false_confident_claim_rate_against_human_gold": "NOT_MEASURED",
            "correct_unknown_rate_against_human_gold": "NOT_MEASURED",
            "independent_task_gold": "NOT_MEASURED",
            "accepted_user_tasks": 0,
            "catalogue_tasktype_acceptance": "NOT_RUN",
            "task_to_result": "NOT_RUN",
            "followup_evidence_cost": "NOT_MEASURED",
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--xes-gz", type=Path, required=True)
    p.add_argument("--expected-sha256", default=None,
                   help="Prior, independently recorded SHA; omit during discovery.")
    p.add_argument("--sample-cases", type=int, default=12)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    try:
        bpi.check(args.xes_gz != args.out and not args.out.exists(),
                  "INCIDENTS_OUTPUT_EXISTS_OR_EQUALS_SOURCE")
        report = analyze(args.xes_gz.read_bytes(),
                         expected_sha256=args.expected_sha256,
                         sample_cases=args.sample_cases)
        args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n",
                            encoding="utf-8")
        print("BPI13_INCIDENTS_SOURCE_FIT", report["status"],
              report["population"]["recorded_cases"], "cases",
              report["population"]["registered_events"], "registered events",
              "accepted_tasks", report["qualification"]["accepted_user_tasks"])
        return 0 if report["population"]["catalogue_counts_match"] else 2
    except (bpi.Hold, OSError, ValueError) as exc:
        print("BPI13_INCIDENTS_SOURCE_HOLD", str(exc)[:110], file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
