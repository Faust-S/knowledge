#!/usr/bin/env python3
"""Solve4X scene01 separate UI CSV: source-bound structural audit.

No raw CSV rows leave the runner. UI records are not presumed to be
independent of joined OCEL until a concrete event-level mapping is verified.
"""
from __future__ import annotations
import csv
from collections import Counter
from hashlib import sha256
from io import StringIO
import json
from pathlib import Path
import sys

import solve4x_zip_range_probe as idx
import solve4x_small_member_pair as pair

FILENAME = "scene01/scene01_ui.csv"
SCHEMA = "IWXA_SOLVE4X_SCENE_UI_CSV_SOURCE_AUDIT/0.1"
EXPECTED_CSV_SHA = None


def analyze(raw: bytes) -> dict:
    idx.check(type(raw) is bytes and 0 < len(raw) <= 128 * 1024,
              "UI_CSV_SIZE_HOLD")
    try:
        text = raw.decode("utf-8-sig", errors="strict")
    except UnicodeError:
        raise idx.Hold("UI_CSV_UTF8_HOLD") from None
    # Exact header separator baseline: malformed rows must fail at arity gate.
    try:
        header = text.splitlines()[0]
        delimiter = max((",", ";", "\t"), key=lambda c: (header.count(c), c))
        idx.check(header.count(delimiter) > 0, "UI_CSV_SCHEMA_INVALID")
        reader = csv.DictReader(StringIO(text), delimiter=delimiter)
        fields = reader.fieldnames
        idx.check(fields is not None and len(fields) == len(set(fields)) and
                  len(fields) <= 40 and len(fields) > 1,
                  "UI_CSV_SCHEMA_INVALID")
        rows = list(reader)
    except csv.Error:
        raise idx.Hold("UI_CSV_FORMAT_INVALID") from None
    idx.check(0 < len(rows) <= 10000, "UI_CSV_ROWS_INVALID")
    idx.check(all(None not in row and all(isinstance(v, str) for v in row.values())
                  for row in rows), "UI_CSV_ROW_ARITY_INVALID")
    null_counts = {field: sum(not row[field].strip() for row in rows)
                   for field in fields}
    values_per_field = {field: len(set(row[field] for row in rows
                                      if row[field].strip())) for field in fields}
    return {
        "schema": SCHEMA,
        "status": "ORIGINAL_UI_CSV_STRUCTURE_LOADED_NOT_YET_ALIGNED",
        "source": {"scene": "scene01", "member_name": FILENAME,
                   "source_sha256": sha256(raw).hexdigest(),
                   "original_rows_exported": False},
        "scope": {
            "row_count": len(rows), "column_count": len(fields),
            "column_names": fields,
            "empty_cell_counts": null_counts,
            "distinct_nonempty_counts": values_per_field,
        },
        "independence": {
            "source_is_separate_csv_member": True,
            "source_is_independent_human_observation": False,
            "source_row_to_ocel_event_mapping": "NOT_MEASURED",
            "timestamp_alignment": "NOT_MEASURED",
            "semantic_label_alignment": "NOT_MEASURED",
        },
        "qualification": {
            "independent_human_ground_truth": "NOT_MEASURED",
            "false_confident_claim_rate": "NOT_MEASURED",
            "correct_unknown_rate": "NOT_MEASURED",
            "accepted_tasks": 0,
        }
    }


def probe() -> dict:
    zipdata = idx.probe()
    entries = [x for x in zipdata["target_files"] if x["name"] == FILENAME]
    idx.check(len(entries) == 1 and
              entries[0]["compressed_bytes"] <= pair.MAX_COMPRESSED and
              entries[0]["uncompressed_bytes"] <= pair.MAX_UNCOMPRESSED,
              "UI_SOURCE_MEMBER_HOLD")
    meta = idx._metadata()
    raw = pair._download_member(meta["download_url"], meta["archive_size"],
                                entries[0])
    report = analyze(raw)
    report["source"]["figshare_article_id"] = meta["article_id"]
    report["source"]["zip_central_sha256"] = zipdata["source"]["central_sha256"]
    report["source"]["full_archive_downloaded"] = False
    return report


def main() -> int:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    idx.check(not args.out.exists(), "OUTPUT_EXISTS")
    try:
        report = probe()
        good = True
    except (idx.Hold, UnicodeError, OSError, ValueError, TimeoutError) as exc:
        report = {"schema": SCHEMA, "status": "UI_SOURCE_HOLD",
                  "reason": str(exc)[:100] if isinstance(exc, idx.Hold) else
                            "EXTERNAL_SOURCE_UNAVAILABLE",
                  "qualification": {"accepted_tasks": 0,
                                    "independent_human_ground_truth": "NOT_MEASURED"},
                  "source": {"original_rows_exported": False}}
        good = False
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8")
    print("SOLVE4X_UI", report["status"],
          "rows", report.get("scope", {}).get("row_count", "UNKNOWN"))
    return 0 if good else 2


if __name__ == "__main__":
    sys.exit(main())
