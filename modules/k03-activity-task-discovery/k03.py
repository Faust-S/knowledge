#!/usr/bin/env python3
"""Host-neutral, source-bound Activity/Task discovery; no Task or U1 runtime."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

SCHEMA = "IWXA_K03_DISCOVERY/0.1.0"
SELECTION_SCHEMA = "IWXA_K03_SELECTION/0.1.0"
RATIONALE_SCHEMA = "IWXA_K03_ADP_DESK_RATIONALE/0.1"
PILOT_SCHEMA = "IWXA_ACTIVITY_DISCOVERY_METHOD_PILOT/0.1"
PINNED_PILOT_BLOB = "106c5fde979911382e45ba066e3cb6b6b538bb05"
ROOT = Path(__file__).resolve().parents[2]
PILOT_PATH = ROOT / "research/activity-research/pilots/ADP-001.json"
RATIONALE_PATH = Path(__file__).with_name("case_links.json")
TAGS = frozenset(("reported", "observed", "inferred", "target"))


class DiscoveryHold(ValueError):
    """A fixed refusal reason, never a source excerpt."""


def need(condition: bool, code: str) -> None:
    if not condition:
        raise DiscoveryHold(code)


def git_blob_sha(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


def load_pinned_pilot(path: Path = PILOT_PATH) -> dict:
    raw = path.read_bytes()
    need(git_blob_sha(raw) == PINNED_PILOT_BLOB, "PILOT_SOURCE_REVISION_CHANGED")
    data = json.loads(raw)
    need(type(data) is dict and data.get("schema") == PILOT_SCHEMA
         and data.get("pilot_id") == "ADP-001"
         and data.get("scope") == "DESK_REANALYSIS_AND_HYPOTHETICAL_ZERO_DATA_NOT_FIELD_STUDY"
         and type(data.get("cases")) is list and type(data.get("evidence")) is list
         and type(data.get("sources")) is list, "PILOT_CONTRACT_CHANGED")
    return data


def load_rationale(path: Path = RATIONALE_PATH) -> dict:
    value = json.loads(path.read_text("utf-8"))
    need(type(value) is dict and set(value) == {"schema", "source_git_blob", "cases"}
         and value["schema"] == RATIONALE_SCHEMA
         and value["source_git_blob"] == PINNED_PILOT_BLOB
         and type(value["cases"]) is dict, "RATIONALE_CONTRACT_INVALID")
    return value


def unique_index(items: list, label: str) -> dict:
    need(type(items) is list, label + "_NOT_LIST")
    out = {}
    for row in items:
        need(type(row) is dict and type(row.get("id")) is str
             and bool(row["id"]) and row["id"] not in out,
             label + "_DUPLICATE_OR_INVALID_ID")
        out[row["id"]] = row
    return out


def source_tag(epistemic: str) -> str:
    need(type(epistemic) is str, "EVIDENCE_EPISTEMIC_MISSING")
    if epistemic == "OBSERVED_BY_STUDY_AUTHORS_ONLY":
        return "observed"
    if epistemic == "RISK_NOT_MEASURED_EFFECT":
        return "inferred"
    return "reported"


def verify_trace(bundle: dict, pilot: dict, rationale: dict) -> dict:
    """Independent structural replay, not independent human/field confirmation."""
    cases = unique_index(pilot["cases"], "CASE")
    evidence = unique_index(pilot["evidence"], "EVIDENCE")
    sources = unique_index(pilot["sources"], "SOURCE")
    cid = bundle.get("case_id")
    need(cid in cases, "UNKNOWN_CASE")
    case = cases[cid]
    allowed = set(case["evidence_ids"])
    source_ids = set(case["source_ids"])
    need(len(allowed) == len(case["evidence_ids"])
         and len(source_ids) == len(case["source_ids"])
         and source_ids <= set(sources), "CASE_SOURCE_IDENTITY_INVALID")
    for eid in allowed:
        need(eid in evidence and evidence[eid].get("source") in source_ids,
             "CROSS_CASE_OR_UNRESOLVED_EVIDENCE")

    observations = bundle.get("activity_observations")
    need(type(observations) is list and len(observations) == len(allowed) + 1,
         "OBSERVATION_COUNT_CHANGED")
    by_id = unique_index(observations, "OBSERVATION")
    need(set(by_id) == allowed | {cid + ":need"}, "OBSERVATION_IDENTITY_CHANGED")
    target = by_id[cid + ":need"]
    need(target.get("tag") == "target" and target.get("source_id") is None
         and target.get("source_ref") is None and target.get("text") == case["input"],
         "TARGET_MASQUERADING_AS_SOURCE")
    for eid in allowed:
        row, original = by_id[eid], evidence[eid]
        publication = sources[original["source"]]
        need(row.get("tag") == source_tag(original["epistemic"])
             and row.get("tag") in TAGS
             and row.get("source_id") == original["source"]
             and row.get("source_ref") == publication["url"]
             and row.get("locator") == original["locator"]
             and row.get("source_epistemic") == original["epistemic"]
             and row.get("source_version") == PINNED_PILOT_BLOB
             and row.get("origin") == "SECONDARY_PUBLISHED_STUDY_NOT_DIRECT_FIELD_GOLD",
             "OBSERVATION_SOURCE_REPLAY_FAILED")

    propositions = case["possible_task_hypotheses"]
    mapped = rationale["cases"].get(cid)
    need(type(mapped) is list and len(mapped) == len(propositions),
         "HYPOTHESIS_RATIONALE_SHAPE_INVALID")
    hypotheses = bundle.get("task_hypotheses")
    need(type(hypotheses) is list, "HYPOTHESES_INVALID")
    expected = {}
    abstained = 0
    for i, links in enumerate(mapped):
        need(type(links) is list and len(set(links)) == len(links)
             and all(type(eid) is str and eid in allowed for eid in links),
             "HYPOTHESIS_CROSS_CASE_OR_DUPLICATE_LINK")
        if links:
            expected[f"H-{cid}-{i + 1}"] = (propositions[i], links)
        else:
            abstained += 1
    need(len(hypotheses) == len(expected)
         and len({h.get("id") for h in hypotheses if type(h) is dict})
         == len(hypotheses), "HYPOTHESIS_COUNT_CHANGED")
    for h in hypotheses:
        need(type(h) is dict and h.get("id") in expected,
             "HYPOTHESIS_NOT_IN_PINNED_CORPUS")
        content, links = expected[h["id"]]
        need(h.get("text") == content and h.get("tag") == "inferred"
             and h.get("status") == "PROPOSED_NOT_QUALIFIED_TASK"
             and h.get("evidence_links") == [
                 {"evidence_id": eid, "relation": "DESK_RATIONALE_NOT_TASK_CONFIRMATION"}
                 for eid in links]
             and h.get("independent_field_confirmation") is False,
             "HYPOTHESIS_EVIDENCE_OR_AUTHORITY_CHANGED")
    question = case["first_nonleading_question"]
    need(bundle.get("clarification_requests") == [{
        "id": f"Q-{cid}-1", "question": question,
        "reason": "STAKEHOLDER_TASK_NOT_QUALIFIED",
    }], "CLARIFICATION_CHANGED")
    need(bundle.get("accepted_task_count") == 0
         and bundle.get("task_type_accepted") is False
         and bundle.get("human_task_gold") is False
         and bundle.get("source_git_blob") == PINNED_PILOT_BLOB
         and bundle.get("abstained_unlinked_options") == abstained
         and bundle.get("route") == ("QUALIFICATION_REQUIRED" if expected
                                     else "CLARIFICATION_REQUIRED"),
         "DISCOVERY_AUTHORITY_CHANGED")
    return {
        "trace_check": "PASS_REPLAYED_AGAINST_PINNED_SOURCE",
        "independent_field_truth": "NOT_MEASURED",
        "independent_human_task_gold": False,
        "source_count": len(source_ids),
        "observations_checked": len(allowed),
        "hypotheses_checked": len(expected),
    }


def discover_case(pilot: dict, rationale: dict, case_id: str) -> dict:
    """Use curated published ADP hypotheses; never invent new TaskType or Task."""
    cases = unique_index(pilot["cases"], "CASE")
    evidence = unique_index(pilot["evidence"], "EVIDENCE")
    sources = unique_index(pilot["sources"], "SOURCE")
    need(case_id in cases and case_id in rationale["cases"], "UNKNOWN_CASE")
    case = cases[case_id]
    need(type(case.get("source_ids")) is list
         and type(case.get("evidence_ids")) is list
         and type(case.get("possible_task_hypotheses")) is list
         and type(case.get("first_nonleading_question")) is str
         and type(case.get("input")) is str
         and case.get("task_types") == "NONE_ACCEPTED",
         "CASE_CONTRACT_INVALID")
    allowed = case["evidence_ids"]
    records = [{
        "id": case_id + ":need",
        "tag": "target", "text": case["input"],
        "source_id": None, "source_ref": None,
    }]
    for eid in allowed:
        need(eid in evidence, "EVIDENCE_NOT_IN_PINNED_CORPUS")
        item = evidence[eid]
        sid = item.get("source")
        need(sid in case["source_ids"] and sid in sources,
             "CROSS_CASE_OR_UNRESOLVED_EVIDENCE")
        records.append({
            "id": eid, "tag": source_tag(item["epistemic"]),
            "source_id": sid, "source_ref": sources[sid]["url"],
            "locator": item["locator"],
            "source_epistemic": item["epistemic"],
            "source_version": PINNED_PILOT_BLOB,
            "origin": "SECONDARY_PUBLISHED_STUDY_NOT_DIRECT_FIELD_GOLD",
        })
    mapping = rationale["cases"][case_id]
    need(type(mapping) is list and len(mapping) == len(case["possible_task_hypotheses"]),
         "HYPOTHESIS_RATIONALE_SHAPE_INVALID")
    hypotheses = []
    for index, links in enumerate(mapping):
        need(type(links) is list and all(type(x) is str for x in links),
             "HYPOTHESIS_RATIONALE_INVALID")
        if not links:
            continue
        hypotheses.append({
            "id": f"H-{case_id}-{index + 1}",
            "text": case["possible_task_hypotheses"][index],
            "tag": "inferred",
            "status": "PROPOSED_NOT_QUALIFIED_TASK",
            "evidence_links": [
                {"evidence_id": eid, "relation": "DESK_RATIONALE_NOT_TASK_CONFIRMATION"}
                for eid in links],
            "independent_field_confirmation": False,
        })
    result = {
        "schema": SCHEMA, "case_id": case_id,
        "source_git_blob": PINNED_PILOT_BLOB,
        "method": "PINNED_SECONDARY_CORPUS_WITH_CURATED_RATIONALE",
        "route": "QUALIFICATION_REQUIRED" if hypotheses else "CLARIFICATION_REQUIRED",
        "activity_observations": records,
        "task_hypotheses": hypotheses,
        "clarification_requests": [{
            "id": f"Q-{case_id}-1",
            "question": case["first_nonleading_question"],
            "reason": "STAKEHOLDER_TASK_NOT_QUALIFIED",
        }],
        "abstained_unlinked_options":
            len(case["possible_task_hypotheses"]) - len(hypotheses),
        "accepted_task_count": 0,
        "task_type_accepted": False,
        "human_task_gold": False,
        "native_u1": "NOT_INVOKED_NO_SOURCE_PROJECTION_FOR_PINNED_U1_ADAPTER",
    }
    result["independent_check"] = verify_trace(result, pilot, rationale)
    return result


def baseline_prior_first(pilot: dict, case_id: str) -> dict:
    """Deterministic deliberately weak prior-first comparator, not task quality."""
    cases = unique_index(pilot["cases"], "CASE")
    need(case_id in cases, "UNKNOWN_CASE")
    case = cases[case_id]
    proposed = case["possible_task_hypotheses"]
    return {
        "method": "BLIND_FIRST_CATALOG_PRIOR",
        "prior_count": len(proposed),
        "first_proposal_without_case_evidence": bool(proposed)
            and not bool(case["evidence_ids"]),
        "tasks_accepted": 0,
        "task_precision": None, "task_recall": None, "task_f1": None,
    }


def select_hypothesis(bundle: dict, hypothesis_id: str, *, choice: str,
                      selection_ref: str) -> dict:
    """A host-neutral selection event; never creates/accepts a Task."""
    need(bundle.get("schema") == SCHEMA
         and bundle.get("accepted_task_count") == 0, "DISCOVERY_NOT_TRACE_CHECKED")
    # A host-provided receipt or PASS flag is not authority. Before selection,
    # independently replay the entire candidate against the pinned corpus.
    verify_trace(bundle, load_pinned_pilot(), load_rationale())
    need(choice == "HUMAN_SELECT_FOR_QUALIFICATION"
         and type(selection_ref) is str
         and 1 <= len(selection_ref) <= 128
         and not any(ch.isspace() for ch in selection_ref),
         "EXPLICIT_HUMAN_SELECTION_REQUIRED")
    hypotheses = bundle.get("task_hypotheses")
    need(type(hypotheses) is list, "HYPOTHESES_INVALID")
    selected = [x for x in hypotheses if x["id"] == hypothesis_id
                and x["status"] == "PROPOSED_NOT_QUALIFIED_TASK"
                and x["evidence_links"]]
    need(len(selected) == 1, "HYPOTHESIS_NOT_SELECTABLE")
    h = selected[0]
    return {
        "schema": SELECTION_SCHEMA,
        "selection_ref": selection_ref,
        "choice": choice,
        "case_id": bundle["case_id"], "hypothesis_id": h["id"],
        "candidate_text": h["text"],
        "evidence_links": h["evidence_links"],
        "status": "SELECTED_CANDIDATE_AWAITING_HOST_TASK_QUALIFICATION",
        "task_created": False, "task_id": None, "result_created": False,
        "next_owner": "HOST_TASK_QUALIFICATION",
    }


def bypass_clear_task(task_text: str, expected_result: str) -> dict:
    need(type(task_text) is str and bool(task_text.strip())
         and type(expected_result) is str and bool(expected_result.strip()),
         "DIRECT_TASK_REQUIRES_CLEAR_RESULT")
    return {
        "schema": SCHEMA,
        "route": "DIRECT_TASK_HOST_HANDOFF_NO_DISCOVERY",
        "task_input": task_text.strip(),
        "expected_result": expected_result.strip(),
        "task_hypotheses": [], "clarification_requests": [],
        "accepted_task_count": 0, "task_created": False,
        "next_owner": "HOST_TASK_QUALIFICATION",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--case-id")
    mode.add_argument("--all", action="store_true")
    mode.add_argument("--direct-task")
    parser.add_argument("--expected-result")
    parser.add_argument("--select")
    parser.add_argument("--selection-ref")
    args = parser.parse_args()
    try:
        if args.direct_task is not None:
            need(args.select is None and args.selection_ref is None,
                 "DIRECT_ROUTE_CANNOT_SELECT_HYPOTHESIS")
            result = bypass_clear_task(args.direct_task, args.expected_result)
        else:
            need(args.expected_result is None, "EXPECTED_RESULT_ONLY_FOR_DIRECT_TASK")
            pilot, mapping = load_pinned_pilot(), load_rationale()
            if args.all:
                need(args.select is None and args.selection_ref is None,
                     "SELECTION_REQUIRES_ONE_CASE")
                rows = [discover_case(pilot, mapping, row["id"])
                        for row in pilot["cases"]]
                result = {
                    "schema": SCHEMA, "status": "SCOPED_DESK_REPLAY",
                    "cases": len(rows),
                    "hypotheses": sum(len(x["task_hypotheses"]) for x in rows),
                    "abstained_options": sum(x["abstained_unlinked_options"] for x in rows),
                    "negative_no_source_cases": sum(
                        x["route"] == "CLARIFICATION_REQUIRED" for x in rows),
                    "all_trace_checks_pass": all(
                        x["independent_check"]["trace_check"]
                        == "PASS_REPLAYED_AGAINST_PINNED_SOURCE" for x in rows),
                    "first_prior_unsupported_negative_count": sum(
                        baseline_prior_first(pilot, x["case_id"])
                        ["first_proposal_without_case_evidence"] for x in rows),
                    "task_instances_created": 0, "human_gold": False,
                    "task_precision": None, "task_recall": None, "task_f1": None,
                }
            else:
                bundle = discover_case(pilot, mapping, args.case_id)
                result = (select_hypothesis(
                    bundle, args.select, choice="HUMAN_SELECT_FOR_QUALIFICATION",
                    selection_ref=args.selection_ref)
                    if args.select is not None else bundle)
        print(json.dumps(result, sort_keys=True, ensure_ascii=False, allow_nan=False))
        return 0
    except (DiscoveryHold, ValueError, OSError, UnicodeError) as exc:
        reason = str(exc) if isinstance(exc, DiscoveryHold) else "K03_INPUT_UNAVAILABLE"
        print(json.dumps({"status": "HOLD", "code": reason}, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
