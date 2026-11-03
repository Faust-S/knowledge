#!/usr/bin/env python3
"""Public source-first baseline: pinned real issue bytes, not task discovery gold.

This stand-alone stdlib tool does NOT implement U1, Task Engine, E5, or Label
Studio. It only verifies a frozen source selection and runs a predeclared
literal title cue baseline on the exact same bytes. Raw titles/bodies are never
included in its public receipt. Every source is retained, including cue-silent.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "task_exp_01_source_metadata.json"
SCHEMA = "IWXA_PUBLIC_TASK_DISCOVERY_SOURCE_FIRST_BASELINE/0.1"
MANIFEST_SCHEMA = "IWXA_TASK_EXP_01_PUBLIC_ISSUE_SOURCE_SLICE/0.1"
# Fixed generic title lexicon, NOT tuned on these eight exploratory issues.
TITLE_PATTERN = (r"\b(?:bug|error|fail(?:ed|ure|ures|s)?|issue|request|"
                 r"need|should|support|allow|cannot|can't|doesn't)\b")
TITLE_CUES = re.compile(TITLE_PATTERN, re.IGNORECASE)
PROJECT_ID = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")
MAX_HTTP_BYTES = 100_000


class BaselineHold(ValueError):
    """Fixed safe refusal codes, not private input values."""


def require(ok: bool, code: str) -> None:
    if not ok:
        raise BaselineHold(code)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_manifest(path: Path) -> dict:
    data = json.loads(path.read_text("utf-8"))
    require(type(data) is dict and data.get("schema") == MANIFEST_SCHEMA
            and data.get("no_gold") is True
            and type(data.get("items")) is list and len(data["items"]) == 8,
            "MANIFEST_NOT_FROZEN_EXPLORATORY_EIGHT")
    identities = set()
    for item in data["items"]:
        require(type(item) is dict, "MANIFEST_SOURCE_INVALID")
        repo, number = item.get("repository"), item.get("issue_number")
        require(type(repo) is str and PROJECT_ID.fullmatch(repo) is not None
                and type(number) is int and number > 0,
                "MANIFEST_SOURCE_INVALID")
        identity = (repo, number)
        require(identity not in identities, "DUPLICATE_FROZEN_SOURCE")
        identities.add(identity)
        require(item.get("html_url") ==
                f"https://github.com/{repo}/issues/{number}"
                and type(item.get("projection_bytes")) is int
                and 1 <= item["projection_bytes"] <= MAX_HTTP_BYTES
                and all(type(item.get(key)) is str and HASH.fullmatch(item[key])
                        for key in ("projection_sha256", "body_sha256")),
                "MANIFEST_SOURCE_INVALID")
    return data


def _projection(item: dict, input_dir: Path | None) -> bytes:
    repo, number = item["repository"], item["issue_number"]
    if input_dir is not None:
        fname = f"{repo.replace('/', '__')}__{number}.txt"
        p = input_dir / fname
        require(not p.is_symlink() and p.is_file(), "LOCAL_SOURCE_NOT_AVAILABLE")
        raw = p.read_bytes()
    else:
        url = f"https://api.github.com/repos/{repo}/issues/{number}"
        req = Request(url, headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "IWXA-PublicSourceFirstBaseline/0.1"})
        with urlopen(req, timeout=15) as response:
            require(response.status == 200, "SOURCE_HTTP_UNAVAILABLE")
            payload = response.read(MAX_HTTP_BYTES + 1)
        require(len(payload) <= MAX_HTTP_BYTES, "SOURCE_HTTP_SIZE_EXCEEDED")
        document = json.loads(payload)
        require(type(document) is dict and document.get("number") == number
                and "pull_request" not in document
                and type(document.get("title")) is str
                and type(document.get("body")) is str
                and document.get("html_url") == item["html_url"],
                "SOURCE_IDENTITY_CHANGED")
        raw = (document["title"] + "\n" + document["body"] + "\n").encode("utf-8")
    require(len(raw) == item["projection_bytes"]
            and sha(raw) == item["projection_sha256"],
            "FROZEN_SOURCE_CONTENT_CHANGED")
    title_bytes, boundary, body_with_newline = raw.partition(b"\n")
    require(boundary == b"\n" and body_with_newline.endswith(b"\n"),
            "FROZEN_SOURCE_PROJECTION_INVALID")
    require(sha(body_with_newline[:-1]) == item["body_sha256"],
            "FROZEN_BODY_CONTENT_CHANGED")
    title_bytes.decode("utf-8", "strict")
    return raw


def title_spans(raw: bytes) -> list[dict]:
    title = raw.split(b"\n", 1)[0].decode("utf-8", "strict")
    matches = []
    for match in TITLE_CUES.finditer(title):
        a = len(title[:match.start()].encode("utf-8"))
        b = len(title[:match.end()].encode("utf-8"))
        matches.append({"byte_start": a, "byte_end": b})
    return matches


def replay(manifest: dict, input_dir: Path | None = None,
           fetch_source=None) -> dict:
    # Revalidate caller-supplied manifests too: no untrusted URL interpolation.
    require(type(manifest) is dict and manifest.get("schema") == MANIFEST_SCHEMA
            and manifest.get("no_gold") is True
            and type(manifest.get("items")) is list
            and len(manifest["items"]) == 8,
            "MANIFEST_NOT_FROZEN_EXPLORATORY_EIGHT")
    keys = set()
    for row in manifest["items"]:
        require(type(row) is dict and type(row.get("repository")) is str
                and PROJECT_ID.fullmatch(row["repository"]) is not None
                and type(row.get("issue_number")) is int
                and row["issue_number"] > 0
                and row.get("html_url") ==
                f"https://github.com/{row['repository']}/issues/{row['issue_number']}"
                and type(row.get("projection_bytes")) is int
                and 1 <= row["projection_bytes"] <= MAX_HTTP_BYTES
                and all(type(row.get(k)) is str and HASH.fullmatch(row[k])
                        for k in ("projection_sha256", "body_sha256")),
                "MANIFEST_SOURCE_INVALID")
        key = row["repository"], row["issue_number"]
        require(key not in keys, "DUPLICATE_FROZEN_SOURCE")
        keys.add(key)
    rows = []
    total_ms = 0.0
    for row in manifest["items"]:
        raw = (fetch_source(row) if fetch_source is not None
               else _projection(row, input_dir))
        # Caller injection must not defeat SHA validation.
        require(type(raw) is bytes and len(raw) == row["projection_bytes"]
                and sha(raw) == row["projection_sha256"],
                "FROZEN_SOURCE_CONTENT_CHANGED")
        begin = time.perf_counter_ns()
        spans = title_spans(raw)
        total_ms += (time.perf_counter_ns() - begin) / 1_000_000
        rows.append({
            "repository": row["repository"], "issue_number": row["issue_number"],
            "source_sha256": row["projection_sha256"],
            "source_first_included": True, "title_regex_cue_spans": spans,
            "task_discovery_label": None,
        })
    return {
        "schema": SCHEMA,
        "status": "EXPLORATORY_PUBLIC_SOURCE_REPLAY_NOT_TASK_GOLD",
        "methods": {
            "SOURCE_FIRST_ALL": "ALL_EIGHT_INCLUDED_EVEN_WITHOUT_CUES",
            "TITLE_REGEX_BASELINE": "SOURCE_BOUND_CUES_NOT_TASK_PREDICTIONS",
            "NATIVE_U1": "NOT_RUN_PRIVATE_OWNER_SOURCE_NOT_COPIED",
            "TRAINED_ACTION_PROVIDER": "NOT_RUN_NO_GENERAL_ISSUE_CONTRACT",
            "SEMANTIC_CONTEXT_TASK_PREDICTOR": "NOT_RUN_NO_COLD_START_CONTRACT",
        },
        "method_pattern_sha256": sha(TITLE_PATTERN.encode("utf-8")),
        "sources_verified": len(rows),
        "sources_review_included": sum(r["source_first_included"] for r in rows),
        "sources_with_title_regex_cues": sum(bool(r["title_regex_cue_spans"]) for r in rows),
        "title_regex_cue_count": sum(len(r["title_regex_cue_spans"]) for r in rows),
        "sources_without_title_regex_cues_still_included":
            sum(not r["title_regex_cue_spans"] for r in rows),
        "source_rows": rows,
        "source_bytes_in_receipt": False,
        "human_task_gold": False,
        "human_task_precision": None, "human_task_recall": None,
        "human_task_f1": None, "human_review_time_ms": None,
        "engineering_title_regex_processing_ms": round(total_ms, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--input-dir", type=Path, default=None,
                        help="Use legitimately acquired, digest-pinned issue projections")
    args = parser.parse_args()
    try:
        manifest = read_manifest(args.manifest)
        result = replay(manifest, input_dir=args.input_dir)
    except Exception as exc:
        # Safe fixed error codes: no original text or URLs in logs.
        code = str(exc) if isinstance(exc, BaselineHold) else "SOURCE_REPLAY_UNAVAILABLE"
        print(json.dumps({"status": "HOLD", "code": code}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
