#!/usr/bin/env python3
"""K03 read-only adapter to existing pinned U1 + frozen real public issue corpus.

Never exports third-party issue text, never creates a Task, TaskType or Result.
Native U1 is loaded by the existing research/task-discovery adapter, not copied.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from time import perf_counter_ns
from urllib.error import HTTPError, URLError

HERE = Path(__file__).resolve().parent
TASK_RESEARCH = HERE.parents[1] / "research" / "task-discovery"
if not TASK_RESEARCH.is_dir():
    raise RuntimeError("PINNED_TASK_DISCOVERY_ADAPTER_UNAVAILABLE")
sys.path.insert(0, str(TASK_RESEARCH))

import exact_search_baseline as literal
import method_snapshot as frozen
import paired_pinned_u1 as paired
import source_first_baseline as source
import k03

SCHEMA = "IWXA_K03_PUBLIC_ISSUE_DISCOVERY/0.1.0"
METHOD_SHA = "93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0"
COMMITMENT_BLOB = "e7e64f01565429f841d7863970481292c4f75518"
PERMITTED_KINDS = frozenset((
    "EXPLICIT_REQUEST_REVIEW_CUE", "REPORTED_PROBLEM_REVIEW_CUE"))
SELECTION = "HUMAN_SELECT_FOR_QUALIFICATION"


def need(value: bool, code: str) -> None:
    if not value:
        raise k03.DiscoveryHold(code)


def checked_manifest() -> dict:
    need(frozen.git_blob_sha(frozen.SELECTION.read_bytes())
         == frozen.MANIFEST_GIT_BLOB,
         "ISSUE_SOURCE_SELECTION_SHA_CHANGED")
    need(frozen.git_blob_sha(
        (TASK_RESEARCH / "pre_gold_method_commitment_20261103.json").read_bytes())
         == COMMITMENT_BLOB, "ISSUE_PRE_GOLD_COMMITMENT_CHANGED")
    return literal.checked_manifest()


def _cue_id(sha: str, index: int) -> str:
    return f"E-{sha[:16]}-{index + 1}"


def issue_case(item: dict, row: dict, *, exact_hit: bool) -> dict:
    """Pure deterministic source-to-investigation projection (not task gold)."""
    need(type(item) is dict and type(row) is dict and type(exact_hit) is bool,
         "ISSUE_CASE_INPUT_INVALID")
    sha, ref = item.get("projection_sha256"), item.get("html_url")
    need(type(sha) is str and source.HASH.fullmatch(sha) is not None
         and type(ref) is str
         and ref == f"https://github.com/{item.get('repository')}/issues/{item.get('issue_number')}"
         and type(item.get("issue_number")) is int and item["issue_number"] > 0
         and type(item.get("projection_bytes")) is int
         and 1 <= item["projection_bytes"] <= source.MAX_HTTP_BYTES,
         "ISSUE_CASE_SOURCE_INVALID")
    need(row.get("source_ref") == ref and row.get("source_sha256") == sha
         and type(row.get("u1_raw_statements")) is int
         and row["u1_raw_statements"] >= 1,
         "ISSUE_CASE_ROW_NOT_SOURCE_BOUND")
    hints = frozen.validate_spans(
        row.get("u1_review_cue_spans"), item["projection_bytes"],
        "U1", with_kind=True)
    titles = frozen.validate_spans(
        row.get("title_regex_cue_spans"), item["projection_bytes"],
        "TITLE", with_kind=False)
    need(all(h["cue_kind"] in PERMITTED_KINDS for h in hints),
         "ISSUE_UNSUPPORTED_U1_CUE_KIND")
    need(len({(h["byte_start"], h["byte_end"], h["cue_kind"])
              for h in hints}) == len(hints), "ISSUE_DUPLICATE_REVIEW_CUE")
    observations = [{
        "id": "O-" + sha[:16],
        "tag": "reported",
        "source_ref": ref,
        "source_sha256": sha,
        "source_version": frozen.MANIFEST_GIT_BLOB,
        "origin": "THIRD_PARTY_PUBLIC_ISSUE_REPORT_NOT_INDEPENDENT_OBSERVATION",
        "locator": {"byte_start": 0, "byte_end": item["projection_bytes"]},
    }]
    for i, hint in enumerate(hints):
        observations.append({
            "id": _cue_id(sha, i),
            "tag": "reported",
            "source_ref": ref,
            "source_sha256": sha,
            "source_version": frozen.MANIFEST_GIT_BLOB,
            "origin": "PINNED_NATIVE_U1_LEXICAL_REVIEW_CUE_NOT_CONFIRMED_TASK",
            "cue_kind": hint["cue_kind"],
            "locator": {
                "byte_start": hint["byte_start"],
                "byte_end": hint["byte_end"],
            },
        })
    hypothesis = [] if not hints else [{
        "id": "H-" + sha[:16],
        "text": "Проверить сообщение " + item["repository"] + "#"
                + str(item["issue_number"]) +
                ": уточнить факты, ожидаемый результат и применимость к вашей задаче.",
        "tag": "inferred",
        "status": "PROPOSED_NOT_QUALIFIED_TASK",
        "kind": "INVESTIGATE_REPORTED_ISSUE",
        "evidence_links": [{
            "evidence_id": _cue_id(sha, i),
            "relation": "PINNED_U1_REVIEW_CUE_NOT_TASK_CONFIRMATION",
        } for i in range(len(hints))],
        "independent_field_confirmation": False,
    }]
    case_id = "ISSUE-" + sha[:16]
    result = {
        "schema": SCHEMA,
        "method": "PINNED_NATIVE_U1_LEXICAL_SOURCE_CUE_NOT_TASK_PREDICTOR",
        "case_id": case_id,
        "source_ref": ref,
        "source_sha256": sha,
        "source_manifest_git_blob": frozen.MANIFEST_GIT_BLOB,
        "owner_u1_git_blob": frozen.OWNER_U1_GIT_BLOB,
        "source_verified": True,
        "source_text_exported": False,
        "activity_observations": observations,
        "task_hypotheses": hypothesis,
        "clarification_requests": [{
            "id": "Q-" + sha[:16],
            "question": ("Какие проверяемые факты, условия и ожидаемый результат "
                         "необходимы, чтобы сделать это вашей задачей?"
                         if hints else
                         "Какую конкретную проблему вы хотите решить и на каких "
                         "проверяемых событиях она основана?"),
            "reason": "REPORT_ONLY_NO_QUALIFIED_USER_TASK",
        }],
        "baseline": {
            "title_regex_cue": bool(titles),
            "full_source_literal_hit": exact_hit,
            "pinned_native_u1_cue": bool(hints),
            "title_regex_cue_count": len(titles),
            "pinned_native_u1_cue_count": len(hints),
        },
        "route": "QUALIFICATION_REQUIRED" if hints else "CLARIFICATION_REQUIRED",
        "accepted_task_count": 0,
        "task_type_accepted": False,
        "human_task_gold": False,
        "independent_task_truth": "NOT_MEASURED",
    }
    return result


def verify_issue_case(bundle: dict, item: dict, row: dict, *, exact_hit: bool) -> dict:
    """Exact structural re-projection; cannot infer truth of the reported claim."""
    need(type(bundle) is dict and bundle == issue_case(item, row, exact_hit=exact_hit),
         "ISSUE_BUNDLE_CHANGED_OR_UNTRUSTED")
    return {
        "status": "PASS_PINNED_PROJECTION_REPLAY",
        "semantic_confirmation": "NOT_MEASURED",
        "task_gold": False,
    }


def replay_issues(input_dir: Path | None = None, *, get_source=None) -> dict:
    """Read eight immutable original source projections once across three baselines."""
    manifest = checked_manifest()
    cache: dict[str, bytes] = {}

    def source_once(item: dict) -> bytes:
        key = item["html_url"]
        if key not in cache:
            raw = (get_source(item) if get_source is not None
                   else source._projection(item, input_dir))
            need(type(raw) is bytes
                 and len(raw) == item["projection_bytes"]
                 and source.sha(raw) == item["projection_sha256"],
                 "ISSUE_FROZEN_SOURCE_BYTES_CHANGED")
            cache[key] = raw
        return cache[key]

    begin = perf_counter_ns()
    paired_report = paired.paired_run(manifest, get_source=source_once)
    frozen_method = frozen.freeze(manifest, paired_report)
    need(frozen_method["method_output_sha256"] == METHOD_SHA,
         "ISSUE_FROZEN_U1_METHOD_HASH_CHANGED")
    exact_report = literal.replay(manifest, fetch_source=source_once)
    need(exact_report["method_output_sha256"] == literal.OUTPUT_SHA,
         "ISSUE_FROZEN_LITERAL_OUTCOMES_CHANGED")
    needed = [item["html_url"] for item in manifest["items"]]
    need(len(set(needed)) == len(needed) == 8
         and len(frozen_method["source_rows"]) == 8
         and len(exact_report["source_rows"]) == 8,
         "ISSUE_FROZEN_EIGHT_INCOMPLETE")
    outputs = []
    for item, row, exact_row in zip(
            manifest["items"],
            frozen_method["source_rows"],
            exact_report["source_rows"]):
        need(row["source_ref"] == item["html_url"]
             and exact_row["source_sha256"] == item["projection_sha256"]
             and type(exact_row["hit"]) is bool,
             "ISSUE_ROW_ORDER_OR_SOURCE_CHANGED")
        found = issue_case(item, row, exact_hit=exact_row["hit"])
        verify_issue_case(found, item, row, exact_hit=exact_row["hit"])
        outputs.append(found)
    need(len({r["case_id"] for r in outputs}) == 8,
         "ISSUE_CASE_ID_COLLISION")
    return {
        "schema": SCHEMA,
        "scope": "EIGHT_FROZEN_PUBLIC_ISSUES_EXPLORATORY_NOT_TASK_GOLD",
        "frozen_manifest_git_blob": frozen.MANIFEST_GIT_BLOB,
        "frozen_u1_method_output_sha256": METHOD_SHA,
        "frozen_literal_output_sha256": literal.OUTPUT_SHA,
        "owner_u1_git_blob": frozen.OWNER_U1_GIT_BLOB,
        "source_count": 8,
        "sources_read_once": len(cache) == 8,
        "source_level_methods": {
            "source_first_full_review": 8,
            "native_u1_cue_sources": sum(
                bool(r["task_hypotheses"]) for r in outputs),
            "title_regex_cue_sources": sum(
                r["baseline"]["title_regex_cue"] for r in outputs),
            "literal_full_source_hit_sources": sum(
                r["baseline"]["full_source_literal_hit"] for r in outputs),
        },
        "investigation_candidates": sum(
            len(r["task_hypotheses"]) for r in outputs),
        "clarification_only_sources": sum(
            not r["task_hypotheses"] for r in outputs),
        "native_u1_engineering_processing_ms":
            paired_report["native_u1_processing_ms"],
        "end_to_end_elapsed_including_source_fetch_ms":
            round((perf_counter_ns() - begin) / 1_000_000, 3),
        "human_task_gold": False,
        "task_precision": None, "task_recall": None, "task_f1": None,
        "task_execution": "NOT_RUN",
        "user_time_savings": None,
        "source_text_exported": False,
        "task_instances_created": 0,
        "cases": outputs,
    }


def selected_issue_hypothesis(bundle: dict, hypothesis_id: str, *,
                              choice: str, selection_ref: str,
                              input_dir: Path | None = None,
                              get_source=None) -> dict:
    """Replay original pinned U1/issue evidence before emitting neutral selection."""
    need(type(bundle) is dict and bundle.get("schema") == SCHEMA,
         "ISSUE_SELECTION_INPUT_INVALID")
    need(choice == SELECTION and type(selection_ref) is str
         and 1 <= len(selection_ref) <= 128
         and not any(ch.isspace() for ch in selection_ref),
         "EXPLICIT_HUMAN_SELECTION_REQUIRED")
    # The input (including purported checked flags) is untrusted.
    fresh = replay_issues(input_dir=input_dir, get_source=get_source)
    matches = [row for row in fresh["cases"]
               if row["case_id"] == bundle.get("case_id")]
    need(len(matches) == 1 and bundle == matches[0],
         "ISSUE_SELECTION_REPLAY_MISMATCH")
    selected = [h for h in matches[0]["task_hypotheses"]
                if h["id"] == hypothesis_id and h["evidence_links"]]
    need(len(selected) == 1, "HYPOTHESIS_NOT_SELECTABLE")
    hyp = selected[0]
    return {
        "schema": k03.SELECTION_SCHEMA,
        "selection_ref": selection_ref, "choice": choice,
        "case_id": bundle["case_id"], "hypothesis_id": hyp["id"],
        "candidate_text": hyp["text"],
        "evidence_links": hyp["evidence_links"],
        "source_ref": bundle["source_ref"],
        "source_sha256": bundle["source_sha256"],
        "status": "SELECTED_CANDIDATE_AWAITING_HOST_TASK_QUALIFICATION",
        "task_created": False, "task_id": None, "result_created": False,
        "next_owner": "HOST_TASK_QUALIFICATION",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--source-ref")
    parser.add_argument("--select")
    parser.add_argument("--selection-ref")
    parser.add_argument("--input-dir", type=Path)
    args = parser.parse_args()
    try:
        need((args.all and args.source_ref is None) !=
             (args.source_ref is not None and not args.all),
             "EXACTLY_ONE_SOURCE_MODE_REQUIRED")
        need((args.select is None) == (args.selection_ref is None),
             "SELECTION_REQUIRES_EXPLICIT_REFERENCE")
        need(not args.all or args.select is None,
             "SELECTION_REQUIRES_SINGLE_SOURCE")
        output = replay_issues(args.input_dir)
        if args.all:
            output.pop("cases")
        else:
            matches = [r for r in output["cases"]
                       if r["source_ref"] == args.source_ref]
            need(len(matches) == 1, "ISSUE_SOURCE_NOT_IN_FROZEN_CORPUS")
            chosen = matches[0]
            if args.select is not None:
                # CLI output was just replayed; enforce identical intent rules,
                # avoiding a second network fetch in the same invocation.
                need(type(args.selection_ref) is str
                     and 1 <= len(args.selection_ref) <= 128
                     and not any(ch.isspace() for ch in args.selection_ref),
                     "EXPLICIT_HUMAN_SELECTION_REQUIRED")
                hyps = [h for h in chosen["task_hypotheses"]
                        if h["id"] == args.select and h["evidence_links"]]
                need(len(hyps) == 1, "HYPOTHESIS_NOT_SELECTABLE")
                hyp = hyps[0]
                chosen = {
                    "schema": k03.SELECTION_SCHEMA,
                    "selection_ref": args.selection_ref, "choice": SELECTION,
                    "case_id": chosen["case_id"], "hypothesis_id": hyp["id"],
                    "candidate_text": hyp["text"],
                    "evidence_links": hyp["evidence_links"],
                    "source_ref": chosen["source_ref"],
                    "source_sha256": chosen["source_sha256"],
                    "status": "SELECTED_CANDIDATE_AWAITING_HOST_TASK_QUALIFICATION",
                    "task_created": False, "task_id": None, "result_created": False,
                    "next_owner": "HOST_TASK_QUALIFICATION",
                }
            output = chosen
        print(json.dumps(output, ensure_ascii=False, sort_keys=True, allow_nan=False))
        return 0
    except (k03.DiscoveryHold, source.BaselineHold, frozen.SnapshotHold,
            literal.ExactHold) as e:
        print(json.dumps({"status": "HOLD", "code": str(e)}, sort_keys=True))
        return 2
    except (HTTPError, URLError, OSError, KeyError, TypeError, ValueError,
            UnicodeError):
        print(json.dumps({"status": "HOLD",
                          "code": "PINNED_ISSUE_REPLAY_UNAVAILABLE"}, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
