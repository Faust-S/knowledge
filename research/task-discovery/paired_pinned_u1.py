#!/usr/bin/env python3
"""Same-source comparison: public pinned U1 vs fixed title baseline, no gold.

Uses the existing Cross-Lab owner_pins U1 snapshot (read-only) and U1 claim
adapter. Never defines a new U1, Task Engine, Label Studio, or TaskCandidate.
"""
from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import sys
import time

import source_first_baseline as baseline

HERE = Path(__file__).resolve().parent
CROSSLAB = HERE.parent / "cross-lab"
SCHEMA = "IWXA_TASK_EXP_01_PINNED_U1_TITLE_PAIR/0.1"


def load_owner():
    if not (CROSSLAB / "pinned_owner.py").is_file() or not (CROSSLAB / "replay.py").is_file():
        raise baseline.BaselineHold("CROSSLAB_OWNER_SNAPSHOT_UNAVAILABLE")
    sys.path.insert(0, str(CROSSLAB))
    try:
        from pinned_owner import load_native_u1
        from replay import u1_claim
    finally:
        sys.path.pop(0)
    owner, blob = load_native_u1()
    return owner, blob, u1_claim


def paired_run(manifest: dict, *, input_dir: Path | None = None,
               load=load_owner, get_source=None) -> dict:
    # Source identity and SHA are validated once per record.
    baseline.require(type(manifest) is dict and
                     manifest.get("schema") == baseline.MANIFEST_SCHEMA and
                     manifest.get("no_gold") is True and
                     len(manifest.get("items", [])) == 8,
                     "PAIRED_MANIFEST_NOT_FROZEN")
    owner, blob, claim_factory = load()
    rows = []
    timing_ms = 0.0
    seen = set()
    for metadata in manifest["items"]:
        key = (metadata.get("repository"), metadata.get("issue_number"))
        baseline.require(key not in seen, "PAIRED_DUPLICATE_SOURCE")
        seen.add(key)
        raw = (get_source(metadata) if get_source is not None
               else baseline._projection(metadata, input_dir))
        baseline.require(type(raw) is bytes and len(raw) == metadata["projection_bytes"]
                         and baseline.sha(raw) == metadata["projection_sha256"],
                         "PAIRED_SOURCE_SHA_MISMATCH")
        observed = {"repository": metadata["repository"],
                    "issue_number": metadata["issue_number"],
                    "source_sha256": metadata["projection_sha256"],
                    "source_first_included": True,
                    "title_regex_cue_spans": baseline.title_spans(raw),
                    "task_discovery_label": None}
        claim = claim_factory(metadata, raw)
        start = time.perf_counter_ns()
        evidence = owner.inspect(raw, claim, today=date(2026, 11, 3))
        cues = owner.review_hints(raw, claim, today=date(2026, 11, 3))
        timing_ms += (time.perf_counter_ns() - start) / 1_000_000
        units = {unit["id"]: unit for unit in evidence["units"]}
        baseline.require(evidence["unit_count"] == len(units)
                         and cues["hint_count"] == len(cues["hints"])
                         and evidence["source"]["id"] == cues["source"]["id"]
                         and evidence["engine_accepted"] is False
                         and cues["engine_accepted"] is False
                         and cues["candidate_task_count"] == 0
                         and cues["task_type_ids_assigned"] == 0,
                         "PINNED_U1_AUTHORITY_OR_UNIT_MISMATCH")
        u1_spans = []
        for hint in cues["hints"]:
            unit = units.get(hint["source_unit_id"])
            a, b = hint["cue_byte_start"], hint["cue_byte_end"]
            baseline.require(unit is not None and unit["kind"] == "RawStatement"
                             and unit["locator"]["byte_start"] <= a < b <=
                             unit["locator"]["byte_end"]
                             and raw[a:b].strip() != b"",
                             "PINNED_U1_EVIDENCE_NOT_SOURCE_BOUND")
            u1_spans.append({"byte_start": a, "byte_end": b,
                             "cue_kind": hint["cue_kind"]})
        rows.append({**observed, "u1_raw_statements": evidence["unit_count"],
                     "pinned_u1_review_cue_spans": u1_spans})
    title_sources = {i for i, r in enumerate(rows) if r["title_regex_cue_spans"]}
    u1_sources = {i for i, r in enumerate(rows) if r["pinned_u1_review_cue_spans"]}
    return {
        "schema": SCHEMA,
        "status": "PINNED_OWNER_U1_VS_TITLE_CUES_NO_HUMAN_GOLD",
        "u1_owner_snapshot_blob": blob,
        "title_pattern_sha256": baseline.sha(baseline.TITLE_PATTERN.encode("utf-8")),
        "sources_verified": len(rows),
        "sources_review_included": len(rows),
        "u1_raw_statements": sum(r["u1_raw_statements"] for r in rows),
        "pinned_u1_cues": sum(len(r["pinned_u1_review_cue_spans"]) for r in rows),
        "title_cues": sum(len(r["title_regex_cue_spans"]) for r in rows),
        "sources_with_pinned_u1_cues": len(u1_sources),
        "sources_with_title_cues": len(title_sources),
        "source_level_cue_intersection": len(title_sources & u1_sources),
        "source_level_cue_union": len(title_sources | u1_sources),
        "sources_without_either_cue_still_included": 8 - len(title_sources | u1_sources),
        "source_rows": rows,
        "native_u1_processing_ms": round(timing_ms, 3),
        "task_candidates_created": 0,
        "human_gold": False,
        "task_precision": None, "task_recall": None, "task_f1": None,
        "human_review_time_ms": None,
        "source_text_published": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path,
                        help="Legitimately acquired original immutable text directory")
    args = parser.parse_args()
    try:
        manifest = baseline.read_manifest(baseline.MANIFEST)
        result = paired_run(manifest, input_dir=args.input_dir)
    except Exception as error:
        code = str(error) if isinstance(error, baseline.BaselineHold) else "PAIRED_REPLAY_UNAVAILABLE"
        print(json.dumps({"status": "HOLD", "code": code}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
