#!/usr/bin/env python3
"""BPI Challenge 2013 open-problems XES -> original IWXA U1 read-only events.

A PUBLIC THIRD-PARTY COPY of a reported real-life event log is used. The
GitHub blob is verified; identity with the original 4TU bytes is not yet
independently established. Events are *registered* states, not work-as-done.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date, datetime
import gzip
from hashlib import sha1, sha256
import io
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

VERSION = "IWXA_BPI13_OPEN_PROBLEMS_U1_REPLAY/0.1"
DATASET = "BPI_CHALLENGE_2013_OPEN_PROBLEMS"
OFFICIAL_DOI = "https://doi.org/10.4121/uuid:3537c19d-6c64-4b1d-815d-915ab0e479da"
MIRROR_REPO = "ziaridoy20/Smart-Process-Analytics-on-Business-Process-Intelligence-Challenge"
MIRROR_COMMIT = "8c3dddac389eae0a222d5506f0474bc1641121d6"
MIRROR_BLOB = "9a001b58da47ed45d0fa5fff80815d1f444cac27"
MIRROR_BYTES = 68697
MIRROR_URL = ("https://raw.githubusercontent.com/" + MIRROR_REPO + "/"
              + MIRROR_COMMIT + "/BPI_Challenge_2013_open_problems.xes.gz")
MAX_GZIP_BYTES = 1024 * 1024
MAX_XES_BYTES = 8 * 1024 * 1024
MAX_TRACES = 20000
MAX_EVENTS = 100000

class Hold(ValueError):
    """Research gate, never print raw source contents."""

def check(value: bool, reason: str):
    if not value:
        raise Hold(reason)

def git_blob(raw: bytes) -> str:
    return sha1(b"blob " + str(len(raw)).encode() + b"\x00" + raw).hexdigest()

def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]

def attr(element, key: str) -> str | None:
    values = [e.get("value") for e in element
              if local(e.tag) in ("string", "date", "int", "float", "boolean")
              and e.get("key") == key]
    check(len(values) < 2, "XES_DUPLICATE_ATTRIBUTE")
    return values[0] if values else None

def event_time(raw: str | None) -> datetime:
    check(isinstance(raw, str) and len(raw) <= 60, "XES_TIMESTAMP_MISSING")
    try:
        result = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise Hold("XES_TIMESTAMP_INVALID") from None
    check(result.tzinfo is not None and result.utcoffset() is not None,
          "XES_TIMESTAMP_TIMEZONE_REQUIRED")
    return result

def parse_xes(compressed: bytes) -> tuple[dict[str, list[tuple[int, str, str, str | None]]], dict]:
    check(type(compressed) is bytes and 0 < len(compressed) <= MAX_GZIP_BYTES,
          "BPI_GZIP_SIZE_INVALID")
    check(len(compressed) == MIRROR_BYTES and git_blob(compressed) == MIRROR_BLOB,
          "BPI_PINNED_MIRROR_GIT_BLOB_MISMATCH")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as f:
            raw = f.read(MAX_XES_BYTES + 1)
    except (OSError, EOFError, ValueError):
        raise Hold("BPI_GZIP_INVALID") from None
    check(0 < len(raw) <= MAX_XES_BYTES, "BPI_DECOMPRESSED_SIZE_INVALID")
    upper = raw.upper()
    check(b"<!DOCTYPE" not in upper and b"<!ENTITY" not in upper,
          "BPI_XML_DTD_OR_ENTITY_FORBIDDEN")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise Hold("BPI_XML_INVALID") from None
    check(local(root.tag) == "log", "BPI_XES_LOG_MISSING")
    traces: dict[str, list] = {}
    rows = 0
    distinct_activities = set()
    regression_count = 0
    tie_count = 0
    for t in root:
        if local(t.tag) != "trace":
            continue
        check(len(traces) < MAX_TRACES, "BPI_TOO_MANY_TRACES")
        case = attr(t, "concept:name")
        check(isinstance(case, str) and 0 < len(case) <= 200,
              "BPI_CASE_ID_INVALID")
        check(case not in traces, "BPI_DUPLICATE_CASE_ID")
        events = []
        previous = None
        for item in t:
            if local(item.tag) != "event":
                continue
            rows += 1
            check(rows <= MAX_EVENTS, "BPI_TOO_MANY_EVENTS")
            activity = attr(item, "concept:name")
            check(isinstance(activity, str) and 0 < len(activity) <= 200,
                  "BPI_ACTIVITY_MISSING")
            timestamp = event_time(attr(item, "time:timestamp"))
            lifecycle = attr(item, "lifecycle:transition")
            check(lifecycle is None or (0 < len(lifecycle) <= 80),
                  "BPI_LIFECYCLE_INVALID")
            if previous is not None:
                regression_count += int(timestamp < previous)
                tie_count += int(timestamp == previous)
            previous = timestamp
            distinct_activities.add(activity)
            events.append((len(events) + 1, activity, timestamp.isoformat(), lifecycle))
        check(events, "BPI_EMPTY_TRACE")
        traces[case] = events
    check(rows >= 1 and len(traces) >= 1, "BPI_NO_EVENTS")
    return traces, {
        "recorded_traces": len(traces), "registered_events": rows,
        "registered_activity_labels": len(distinct_activities),
        "declared_timestamp_regressions_in_file_order": regression_count,
        "declared_timestamp_ties_in_file_order": tie_count,
        "log_origin_claim": "PUBLIC_THIRD_PARTY_MIRROR_ORIGINAL_4TU_NOT_BYTE_VERIFIED",
    }

def native_u1():
    research_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(research_root / "cross-lab"))
    from pinned_owner import load_native_u1
    return load_native_u1()

def analyze(compressed: bytes, *, max_traces: int = 12,
            u1_loader=native_u1) -> dict:
    check(type(max_traces) is int and 1 <= max_traces <= 24,
          "BPI_SAMPLE_SIZE_INVALID")
    traces, population = parse_xes(compressed)
    ordered = sorted((case for case, events in traces.items() if len(events) >= 2),
                     key=lambda c: (sha256(("BPI13:"+c).encode()).digest(), c))
    check(len(ordered) >= max_traces, "BPI_TOO_FEW_ELIGIBLE_TRACES")
    selected = ordered[:max_traces]
    data = []
    equal_time_cases = 0
    for index, case in enumerate(selected, 1):
        events = traces[case]
        timestamps = [x[2] for x in events]
        equal_time_cases += len(set(timestamps)) < len(timestamps)
        for position, activity, timestamp, lifecycle in events:
            data.append({
                "event_id": f"bpi13-{index:02d}-{position:04d}",
                "case_id": f"bpi13-{index:02d}",
                "activity": activity,
                "timestamp": timestamp,
                "attributes": {
                    "source_file_event_index": position,
                    "lifecycle": lifecycle,
                    "origin_scope": "REGISTERED_VINSTR_SYSTEM_EVENT_NOT_VERIFIED_HUMAN_ACTION",
                    "real_world_execution": "NOT_VERIFIED",
                    "case_goal": "NOT_DETERMINED",
                    "task_type": "NOT_DETERMINED",
                }
            })
    raw = ("\n".join(json.dumps(row, ensure_ascii=True, sort_keys=True,
                                 separators=(",", ":")) for row in data) + "\n").encode()
    check(len(raw) <= 4 * 1024 * 1024 and len(data) <= 10000,
          "BPI_U1_INPUT_SIZE_INVALID")
    u1, owner_blob = u1_loader()
    m = {
        "schema": u1.VERSION, "kind": "EVENT_LOG_JSONL",
        "owner_ref": "BPI2013-PUBLIC-MIRROR-RESEARCH",
        "jurisdiction": "EU", "as_of": "2026-11-03",
        "retention_until": "2035-12-31",
        "purpose": "ENGINE_RESEARCH_AND_TEST",
        "disclosure": "PUBLIC", "access_basis": "PUBLIC_REUSE_CLAIM",
        "authorization_ref": "PUBLIC_RESEARCH_REUSE_ASSERTED_LICENSE_AUDIT_PENDING",
        "permission_asserted": True, "authorized_actions": ["LOCAL_ANALYSIS"],
        "revocation_status": "ACTIVE", "sha256": sha256(raw).hexdigest(),
        "source_reference": OFFICIAL_DOI,
    }
    receipt = u1.inspect(raw, m, today=date(2026, 11, 3))
    check(receipt["unit_count"] == len(data)
          and receipt["task_type_ids_assigned"] == 0
          and receipt["engine_accepted"] is False,
          "BPI_U1_UNEXPECTED_AUTHORITY_OR_COUNT")
    check(all(x["kind"] == "RawEvent"
              and x["evidence_strength"] == "REPORTED_EVENT_IN_UNVERIFIED_LOG"
              and x["process_context"]["scope"] ==
                  "REPORTED_CASE_SEQUENCE_NOT_VERIFIED_EXECUTION"
              and x["process_context"]["task_type_identity"] == "NOT_DETERMINED"
              for x in receipt["units"]), "BPI_EPISTEMIC_CONTRACT_FAIL")
    distribution = Counter(len(traces[c]) for c in selected)
    return {
        "schema": VERSION, "status": "THIRD_PARTY_MIRROR_REAL_WORLD_EVENT_REPLAY_PROVENANCE_HOLD",
        "source": {
            "official_doi": OFFICIAL_DOI,
            "mirror_repository": MIRROR_REPO, "mirror_commit": MIRROR_COMMIT,
            "mirror_git_blob": MIRROR_BLOB,
            "mirror_sha256": sha256(compressed).hexdigest(),
            "mirror_bytes": len(compressed),
            "original_4tu_file_sha_match": "NOT_VERIFIED",
            "rights_to_read_claimed": True,
            "rights_independent_review": "NOT_PERFORMED",
        },
        "source_population": population,
        "sample": {
            "selection": "SHA256(BPI13+ORIGINAL_CASE_ID)_SORT_MIN_TWO_EVENTS",
            "traces": len(selected), "registered_events": len(data),
            "min_events_per_trace": min(distribution),
            "max_events_per_trace": max(distribution),
            "distinct_registered_activity_labels": len({e["activity"] for e in data}),
            "traces_with_declared_timestamp_ties": equal_time_cases,
            "u1_source_jsonl_sha256": sha256(raw).hexdigest(),
            "raw_case_ids_or_actor_ids_exported": False,
            "raw_activity_names_exported": False,
            "real_world_activity_truth": "UNKNOWN",
            "declared_event_order_is_causality": False,
        },
        "u1": {
            "pinned_owner_git_blob": owner_blob,
            "source_id": receipt["source"]["id"],
            "unit_count": receipt["unit_count"],
            "evidence_strength": "REPORTED_EVENT_IN_UNVERIFIED_LOG",
            "task_type_ids_assigned": 0, "engine_accepted": False,
        },
        "qualification": {
            "system_event_reconstruction": "ENGINEERING_REPLAY",
            "actual_human_activity": "NOT_VERIFIED",
            "task_instance": "NOT_DETERMINED",
            "task_discovery_quality": "NOT_MEASURED",
            "e5_expert_gold": "NOT_AVAILABLE",
            "result_utility": "NOT_MEASURED",
        },
    }

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--xes-gz", required=True, type=Path)
    p.add_argument("--max-traces", type=int, default=12)
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()
    try:
        check(not args.out.exists() and args.xes_gz != args.out,
              "BPI_OUTPUT_EXISTS_OR_EQUALS_INPUT")
        result = analyze(args.xes_gz.read_bytes(), max_traces=args.max_traces)
        args.out.write_text(json.dumps(result, ensure_ascii=True,
                                       indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print("BPI13_OPEN_PROBLEMS_U1_REPLAY",
              result["sample"]["traces"], "cases",
              result["sample"]["registered_events"], "registered events",
              result["status"])
        return 0
    except (Hold, OSError, ValueError) as exc:
        print("BPI13_U1_HOLD", str(exc)[:100], file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
