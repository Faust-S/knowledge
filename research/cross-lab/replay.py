#!/usr/bin/env python3
"""Native read-only IWXA U1 vs simple baselines on frozen public issue bytes.

The issue corpus is an *exploratory developer-selected* sample, NOT E5 held-out
or independent human task gold. This never proposes/accepts/executed tasks.
Blind raw text export is opt-in, stays local and MUST NOT be uploaded to CI.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pinned_owner import load_native_u1, check_label_studio_xml, PinMismatch

HERE = Path(__file__).resolve().parent
MANIFEST_PATH = HERE / "REAL_PUBLIC_ISSUE_SLICE_20261103.json"
SCHEMA = "IWXA_CROSSLAB_NATIVE_PUBLIC_REPLICATION/0.1"
MANIFEST_SCHEMA = "IWXA_CROSSLAB_PUBLIC_ISSUE_REPLICATION_SLICE/0.1"
REPOS = ("python/cpython", "nodejs/node", "pandas-dev/pandas", "microsoft/vscode")
PINNED_MANIFEST_BLOB = "e22b8b3926889564f6ed70b49471b1057fa2724a"
TITLE_REGEX = re.compile(
    r"\b(?:bug|error|fail(?:s|ed|ure)?|slow|performance|should|need|missing|"
    r"crash(?:es)?|prevent(?:s|ed)?|improv(?:e|es|ed)|leak(?:s|ed)?|support|add|unable)\b",
    re.IGNORECASE,
)
EXACT_REFERENCE = re.compile(
    rb"(?:\#[1-9][0-9]{2,}|https://github\.com/[a-z0-9_.-]+/[a-z0-9_.-]+/issues/[0-9]+)",
    re.IGNORECASE,
)


class ReplayHold(ValueError):
    """Fixed error code without third-party input or local filename."""


def require(ok: bool, code: str) -> None:
    if not ok:
        raise ReplayHold(code)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def git_blob(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\x00" + raw).hexdigest()


def manifest() -> dict:
    raw = MANIFEST_PATH.read_bytes()
    require(git_blob(raw) == PINNED_MANIFEST_BLOB, "FROZEN_MANIFEST_CHANGED")
    obj = json.loads(raw)
    require(type(obj) is dict and obj.get("schema") == MANIFEST_SCHEMA and
            obj.get("no_gold") is True and obj.get("e5_held_out") is False and
            obj.get("human_reviewers") == 0 and
            obj.get("source_text_published") is False and
            obj.get("annotation_status") == "NOT_PERFORMED", "MANIFEST_INVALID")
    items = obj.get("items")
    require(type(items) is list and len(items) == 8, "FROZEN_SAMPLE_SIZE_CHANGED")
    refs = set()
    for row in items:
        require(type(row) is dict and row.get("repository") in REPOS and
                type(row.get("issue_number")) is int and row["issue_number"] > 0 and
                row.get("html_url") ==
                f'https://github.com/{row["repository"]}/issues/{row["issue_number"]}' and
                type(row.get("projection_bytes")) is int and
                0 < row["projection_bytes"] <= 100_000 and
                all(type(row.get(k)) is str and re.fullmatch(r"[0-9a-f]{64}", row[k])
                    for k in ("projection_sha256", "body_sha256")) and
                type(row.get("created_at")) is str, "FROZEN_SOURCE_INVALID")
        refs.add(row["html_url"])
    require(len(refs) == 8 and all(sum(x["repository"] == repo for x in items) == 2
                                   for repo in REPOS), "FROZEN_SOURCE_SET_CHANGED")
    return obj


def pinned_source(row: dict, input_dir: Path | None = None) -> bytes:
    if input_dir is not None:
        filename = row["repository"].replace("/", "__") + "__" + str(row["issue_number"]) + ".txt"
        raw = (input_dir / filename).read_bytes()
    else:
        url = f'https://api.github.com/repos/{row["repository"]}/issues/{row["issue_number"]}'
        req = Request(url, headers={"Accept": "application/vnd.github+json",
                                    "User-Agent": "IWXA-CrossLab-Research/0.1"})
        with urlopen(req, timeout=15) as response:
            require(response.status == 200, "SOURCE_HTTP_UNEXPECTED")
            payload = response.read(100_001)
        require(len(payload) <= 100_000, "SOURCE_RESPONSE_TOO_LARGE")
        issue = json.loads(payload)
        require(type(issue) is dict and issue.get("number") == row["issue_number"] and
                issue.get("html_url") == row["html_url"] and
                "pull_request" not in issue and type(issue.get("title")) is str and
                type(issue.get("body")) is str, "SOURCE_IDENTITY_CHANGED")
        require(sha256(issue["body"].encode("utf-8")) == row["body_sha256"],
                "SOURCE_BODY_VERSION_CHANGED")
        raw = (issue["title"] + "\n" + issue["body"] + "\n").encode("utf-8")
    require(len(raw) == row["projection_bytes"] and
            sha256(raw) == row["projection_sha256"], "SOURCE_PROJECTION_VERSION_CHANGED")
    return raw


def u1_claim(row: dict, raw: bytes) -> dict:
    return {
        "schema": "IWXA_ENGINE_UNIVERSAL_EVIDENCE/0.1",
        "kind": "PUBLIC_DOCUMENT_UTF8",
        "owner_ref": "PUBLIC_GITHUB_REPORTER_NOT_AUTHENTICATED",
        "jurisdiction": "UNDETERMINED",
        "as_of": row["created_at"][:10], "retention_until": "2027-12-31",
        "purpose": "ENGINE_RESEARCH_AND_TEST", "disclosure": "PUBLIC",
        "access_basis": "PUBLIC_REUSE_CLAIM",
        "authorization_ref": "PUBLIC_PAGE_LOCAL_ANALYSIS_CLAIM_ONLY",
        "permission_asserted": True, "authorized_actions": ["LOCAL_ANALYSIS"],
        "revocation_status": "ACTIVE", "sha256": sha256(raw),
        "source_reference": row["html_url"],
    }


def run(input_dir: Path | None = None, *, source_reader=pinned_source,
        owner_loader=load_native_u1) -> tuple[dict, list[dict]]:
    selected = manifest()
    owner, u1_sha = owner_loader()
    rows = []
    blind = []
    u1_ns, simple_ns = 0, 0
    for row in selected["items"]:
        raw = source_reader(row, input_dir)
        claim = u1_claim(row, raw)
        start = time.perf_counter_ns()
        evidence = owner.inspect(raw, claim, today=date(2026, 11, 3))
        cues = owner.review_hints(raw, claim, today=date(2026, 11, 3))
        u1_ns += time.perf_counter_ns() - start
        by_id = {u["id"]: u for u in evidence["units"]}
        require(evidence["unit_count"] == len(by_id) and
                cues["hint_count"] == len(cues["hints"]) and
                evidence["source"]["id"] == cues["source"]["id"] and
                evidence["engine_accepted"] is False and
                cues["engine_accepted"] is False and
                evidence["task_type_ids_assigned"] == 0 and
                cues["task_type_ids_assigned"] == 0 and
                cues["candidate_task_count"] == 0,
                "U1_AUTHORITY_OR_SOURCE_MISMATCH")
        for hint in cues["hints"]:
            unit = by_id.get(hint["source_unit_id"])
            start, end = hint["cue_byte_start"], hint["cue_byte_end"]
            require(unit is not None and unit["kind"] == "RawStatement" and
                    type(start) is int and type(end) is int and
                    unit["locator"]["byte_start"] <= start < end <= unit["locator"]["byte_end"] and
                    bool(raw[start:end].strip()), "U1_HINT_ANCHOR_INVALID")
        start = time.perf_counter_ns()
        title = raw.split(b"\n", 1)[0].decode("utf-8")
        title_regex_hit = bool(TITLE_REGEX.search(title))
        reference_count = len(EXACT_REFERENCE.findall(raw))
        simple_ns += time.perf_counter_ns() - start
        rows.append({
            "source_ref": row["html_url"],
            "projection_sha256": row["projection_sha256"],
            "raw_statements": evidence["unit_count"],
            "u1_lexical_cues": cues["hint_count"],
            "title_regex_cue": title_regex_hit,
            "exact_reference_occurrences": reference_count,
            "scan_complete": cues["complete_lexical_scan"],
            "included_for_human_review": True,
            "priority": "U1_CUE" if cues["hint_count"] else
                        "TITLE_REGEX" if title_regex_hit else "SOURCE_ONLY",
            "taskness": "NOT_DETERMINED",
        })
        blind.append({"data": {"source_text": raw.decode("utf-8"),
                                "source_url": row["html_url"]}})
    rank = {"U1_CUE": 0, "TITLE_REGEX": 1, "SOURCE_ONLY": 2}
    rows.sort(key=lambda x: rank[x["priority"]])  # stable source order within a rank
    result = {
        "schema": SCHEMA, "status": "EXPLORATORY_NATIVE_U1_REVIEW_NOT_TASK_GOLD",
        "owner_u1_blob_sha": u1_sha, "frozen_manifest_blob": PINNED_MANIFEST_BLOB,
        "source_count": len(rows),
        "u1_raw_statements": sum(r["raw_statements"] for r in rows),
        "u1_lexical_cues": sum(r["u1_lexical_cues"] for r in rows),
        "sources_with_u1_cues": sum(r["u1_lexical_cues"] > 0 for r in rows),
        "sources_with_title_regex": sum(r["title_regex_cue"] for r in rows),
        "sources_with_either_cue": sum(bool(r["u1_lexical_cues"] or r["title_regex_cue"]) for r in rows),
        "source_first_documents": len(rows),
        "sources_without_cues_still_reviewed": sum(r["u1_lexical_cues"] == 0 for r in rows),
        "reference_occurrences": sum(r["exact_reference_occurrences"] for r in rows),
        "partial_scans": sum(r["scan_complete"] is not True for r in rows),
        "u1_processing_ms": round(u1_ns / 1_000_000, 4),
        "simple_baseline_ms": round(simple_ns / 1_000_000, 4),
        "human_review_time_ms": None,
        "compute_cost_usd": None,
        "independent_task_gold": False, "precision": None, "recall": None, "f1": None,
        "sha_bfs": "NOT_APPLICABLE_NO_VERIFIED_DEPENDENCY_GRAPH",
        "task_candidates_created": 0, "t1_acceptances_created": 0,
        "e4_approvals_created": 0, "source_rights_independently_verified": False,
        "worklist": rows,
    }
    return result, blind


def save_new(path: Path, payload: object) -> None:
    # Never clobber an owner's review or a frozen receipt.
    with path.open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--blind-out", type=Path, help="Owner-local raw text, never upload to CI")
    args = parser.parse_args()
    try:
        if args.blind_out is not None:
            require(args.blind_out != args.out, "OUTPUT_PATH_COLLISION")
            check_label_studio_xml()
        report, tasks = run(args.input_dir)
        if args.blind_out is not None:
            save_new(args.blind_out, tasks)
        save_new(args.out, report)
        print(json.dumps({"status": report["status"],
                          "source_count": report["source_count"],
                          "raw_statements": report["u1_raw_statements"],
                          "u1_cues": report["u1_lexical_cues"],
                          "independent_gold": False}, sort_keys=True))
        return 0
    except (ReplayHold, PinMismatch, OSError, ValueError, KeyError, TypeError,
            HTTPError, URLError) as exc:
        # Only our fixed error codes may reach stdout/stderr.
        code = str(exc) if isinstance(exc, (ReplayHold, PinMismatch)) else "SOURCE_OR_ENVIRONMENT_UNAVAILABLE"
        print(json.dumps({"status": "HOLD", "code": code}, sort_keys=True), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
