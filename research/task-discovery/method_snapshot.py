#!/usr/bin/env python3
"""Freeze a paired TASK-EXP-01 method snapshot before independent review.

Uses the existing pinned owner U1 and paired_pinned_u1.py. This file is NOT
another Task Engine, labeling system or gold evaluator. Never exports text.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
SELECTION = HERE / "task_exp_01_source_metadata.json"
MANIFEST_GIT_BLOB = "4ecaa74522ba1c3fa4e8851e877200c7767ad0de"
OWNER_U1_GIT_BLOB = "eb15aec5ba1a749c29d7c40a868127e1a384b6bf"
E5_XML_GIT_BLOB = "7b82dbd05b4e28c53446d863c5bb48b72245a10d"
PAIRED_SCHEMA = "IWXA_TASK_EXP_01_PINNED_U1_TITLE_PAIR/0.1"
SCHEMA = "IWXA_TASK_EXP_01_PRE_GOLD_PAIRED_METHOD_SNAPSHOT/0.1"


class SnapshotHold(ValueError):
    """Only fixed refusal codes. No source content in exceptions."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise SnapshotHold(code)


def git_blob_sha(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


def canonical_sha(obj: object) -> str:
    raw = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"),
                     allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def validate_spans(spans: object, length: int, label: str, *, with_kind: bool) -> list[dict]:
    require(type(spans) is list and len(spans) <= 80, "INVALID_" + label + "_SPANS")
    checked = []
    for item in spans:
        fields = {"byte_start", "byte_end", "cue_kind"} if with_kind else {"byte_start", "byte_end"}
        require(type(item) is dict and set(item) == fields, "INVALID_" + label + "_SPAN")
        start, end = item["byte_start"], item["byte_end"]
        require(type(start) is int and type(end) is int and 0 <= start < end <= length,
                "INVALID_" + label + "_OFFSET")
        if with_kind:
            require(item["cue_kind"] in {"EXPLICIT_REQUEST_REVIEW_CUE", "REPORTED_PROBLEM_REVIEW_CUE"},
                    "UNEXPECTED_U1_CUE_KIND")
        checked.append(dict(item))
    return checked


def freeze(manifest: dict, paired: dict) -> dict:
    """Record method-only observations. No task labels or imported source text."""
    require(type(manifest) is dict and manifest.get("schema") ==
            "IWXA_TASK_EXP_01_PUBLIC_ISSUE_SOURCE_SLICE/0.1" and
            manifest.get("no_gold") is True and
            type(manifest.get("items")) is list and len(manifest["items"]) == 8,
            "INVALID_FROZEN_SELECTION")
    require(type(paired) is dict and paired.get("schema") == PAIRED_SCHEMA and
            paired.get("status") == "PINNED_OWNER_U1_VS_TITLE_CUES_NO_HUMAN_GOLD" and
            paired.get("u1_owner_snapshot_blob") == OWNER_U1_GIT_BLOB and
            paired.get("human_gold") is False and
            all(paired.get(k) is None for k in
                ("task_precision", "task_recall", "task_f1", "human_review_time_ms")) and
            paired.get("task_candidates_created") == 0 and
            paired.get("source_text_published") is False,
            "UNQUALIFIED_OR_AUTHORITY_BEARING_METHOD_REPORT")
    require(paired.get("sources_verified") == 8 and
            paired.get("sources_review_included") == 8 and
            type(paired.get("source_rows")) is list and len(paired["source_rows"]) == 8,
            "INCOMPLETE_METHOD_REPLAY")

    selected = {x["html_url"]: x for x in manifest["items"]}
    require(len(selected) == 8, "DUPLICATE_SELECTION")
    checked = []
    seen = set()
    for row in paired["source_rows"]:
        require(type(row) is dict and set(row) == {
            "repository", "issue_number", "source_sha256", "source_first_included",
            "title_regex_cue_spans", "task_discovery_label", "u1_raw_statements",
            "pinned_u1_review_cue_spans"}, "INVALID_METHOD_ROW_SHAPE")
        repo, number = row["repository"], row["issue_number"]
        require(type(repo) is str and type(number) is int,
                "INVALID_METHOD_IDENTITY")
        identity = "https://github.com/" + repo + "/issues/" + str(number)
        info = selected.get(identity)
        require(info is not None and identity not in seen and
                row["source_sha256"] == info["projection_sha256"] and
                row["source_first_included"] is True and
                row["task_discovery_label"] is None and
                type(row["u1_raw_statements"]) is int and row["u1_raw_statements"] >= 1,
                "METHOD_SOURCE_IDENTITY_OR_LABEL_MISMATCH")
        seen.add(identity)
        length = info["projection_bytes"]
        title = validate_spans(row["title_regex_cue_spans"], length, "TITLE", with_kind=False)
        u1 = validate_spans(row["pinned_u1_review_cue_spans"], length, "U1", with_kind=True)
        checked.append({"source_ref": identity, "source_sha256": row["source_sha256"],
                        "u1_raw_statements": row["u1_raw_statements"],
                        "title_regex_cue_spans": title, "u1_review_cue_spans": u1})
    require(seen == set(selected), "REVIEW_SOURCE_MISSING")
    title = sum(len(x["title_regex_cue_spans"]) for x in checked)
    u1 = sum(len(x["u1_review_cue_spans"]) for x in checked)
    title_refs = {x["source_ref"] for x in checked if x["title_regex_cue_spans"]}
    u1_refs = {x["source_ref"] for x in checked if x["u1_review_cue_spans"]}
    require(title == paired.get("title_cues") and u1 == paired.get("pinned_u1_cues") and
            sum(x["u1_raw_statements"] for x in checked) == paired.get("u1_raw_statements") and
            len(title_refs) == paired.get("sources_with_title_cues") and
            len(u1_refs) == paired.get("sources_with_pinned_u1_cues") and
            len(title_refs & u1_refs) == paired.get("source_level_cue_intersection") and
            len(title_refs | u1_refs) == paired.get("source_level_cue_union") and
            8 - len(title_refs | u1_refs) == paired.get("sources_without_either_cue_still_included"),
            "METHOD_TOTALS_MISMATCH")
    # Sort by the ORIGINAL frozen manifest, not score or reviewer outcomes.
    rows = sorted(checked, key=lambda x: list(selected).index(x["source_ref"]))
    method_payload = {"sources": rows, "title_pattern_sha256": paired["title_pattern_sha256"],
                      "owner_u1_blob": OWNER_U1_GIT_BLOB}
    return {
        "schema": SCHEMA, "status": "METHOD_SNAPSHOT_BEFORE_INDEPENDENT_HUMAN_GOLD",
        "frozen_manifest_git_blob": MANIFEST_GIT_BLOB,
        "owner_u1_git_blob": OWNER_U1_GIT_BLOB,
        "label_studio_xml_git_blob": E5_XML_GIT_BLOB,
        "method_output_sha256": canonical_sha(method_payload),
        "sources": 8, "review_sources": 8, "raw_statements": paired["u1_raw_statements"],
        "u1_lexical_cues": u1, "title_regex_cues": title,
        "source_level_union": len(title_refs | u1_refs),
        "source_level_intersection": len(title_refs & u1_refs),
        "source_level_without_either_cue": 8 - len(title_refs | u1_refs),
        "source_rows": rows,
        "method_scope": "LEXICAL_REVIEW_CUES_NOT_TASK_PREDICTIONS",
        "human_gold": False, "task_precision": None, "task_recall": None, "task_f1": None,
        "human_review_time_ms": None, "task_candidates_created": 0,
        "sha_bfs": "NOT_APPLICABLE_NO_VERIFIED_DEPENDENCY_GRAPH",
        "requires_owner_local_label_studio": True,
        "source_text_exported": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--input-dir", type=Path, default=None)
    args = parser.parse_args()
    try:
        import paired_pinned_u1 as paired
        from source_first_baseline import read_manifest
        require(not args.out.exists(), "REFUSE_OVERWRITE_METHOD_SNAPSHOT")
        require(git_blob_sha(SELECTION.read_bytes()) == MANIFEST_GIT_BLOB,
                "FROZEN_MANIFEST_GIT_BLOB_CHANGED")
        source = read_manifest(SELECTION)
        # Existing Label Studio format only; don't create an annotation engine.
        owner, _, _ = paired.load_owner()
        _ = owner  # load_owner verifies the original code pin
        sys.path.insert(0, str(paired.CROSSLAB))
        try:
            from pinned_owner import check_label_studio_xml
            require(check_label_studio_xml() == E5_XML_GIT_BLOB,
                    "OWNER_LABEL_STUDIO_FORMAT_CHANGED")
        finally:
            sys.path.pop(0)
        output = freeze(source, paired.paired_run(source, input_dir=args.input_dir))
        with args.out.open("x", encoding="utf-8") as stream:
            json.dump(output, stream, indent=2, ensure_ascii=False, sort_keys=True)
            stream.write("\n")
        print(json.dumps({"status": output["status"], "sources": 8,
                          "method_output_sha256": output["method_output_sha256"],
                          "gold": False}, sort_keys=True))
        return 0
    except (SnapshotHold, OSError, ValueError, TypeError, KeyError) as exc:
        code = str(exc) if isinstance(exc, SnapshotHold) else "SOURCE_OR_ENGINE_NOT_AVAILABLE"
        print(json.dumps({"status": "HOLD", "code": code}, sort_keys=True), file=sys.stderr)
        return 2
    except Exception:
        print(json.dumps({"status": "HOLD", "code": "UNEXPECTED_EXECUTION_FAILURE"}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
