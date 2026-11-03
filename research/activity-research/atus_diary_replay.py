#!/usr/bin/env python3
"""ATUS 2025 diary-day CSV -> existing pinned U1 EVENT_LOG_JSONL (read-only).

Research-only bridge; NOT evidence of direct observation, goals, TaskTypes,
personal health outcomes, or real calendar timestamps. No new task engine.
"""
from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from io import StringIO
import json
from pathlib import Path
import re
import sys
from zipfile import ZipFile, BadZipFile
from io import BytesIO

VERSION = "IWXA_ATUS_U1_DIARY_REPLAY/0.1"
SOURCE_URL = "https://www.bls.gov/tus/datafiles/atusact-2025.zip"
SOURCE_PAGE = "https://www.bls.gov/tus/data/datafiles-2025.htm"
REQUIRED = frozenset({
    "TUCASEID", "TUACTIVITY_N", "TUACTDUR24",
    "TUTIER1CODE", "TUTIER2CODE", "TUTIER3CODE",
})
MAX_ZIP_BYTES = 12 * 1024 * 1024
MAX_CSV_BYTES = 100 * 1024 * 1024
MAX_ROWS = 500_000
FIXED_DAY_ANCHOR = datetime(2000, 1, 1, 4, 0, tzinfo=timezone.utc)


class Hold(ValueError):
    pass


def require(ok: bool, reason: str):
    if not ok:
        raise Hold(reason)


def select_csv(zip_bytes: bytes) -> tuple[str, bytes]:
    require(type(zip_bytes) is bytes and 0 < len(zip_bytes) <= MAX_ZIP_BYTES,
            "ATUS_ZIP_SIZE_INVALID")
    try:
        with ZipFile(BytesIO(zip_bytes)) as archive:
            require(len(archive.infolist()) <= 32, "ATUS_ZIP_MEMBERS_EXCESSIVE")
            choices = [
                m for m in archive.infolist()
                if not m.is_dir()
                and re.search(r"atusact", Path(m.filename).name, re.I)
                and Path(m.filename).suffix.lower() in {".dat", ".csv"}
            ]
            require(len(choices) == 1, "ATUS_ACTIVITY_MEMBER_MISSING_OR_AMBIGUOUS")
            member = choices[0]
            require(0 < member.file_size <= MAX_CSV_BYTES,
                    "ATUS_ACTIVITY_MEMBER_SIZE_INVALID")
            data = archive.read(member)
            require(len(data) == member.file_size, "ATUS_CSV_TRUNCATED")
            return Path(member.filename).name, data
    except (BadZipFile, OSError, RuntimeError) as exc:
        raise Hold("ATUS_ZIP_INVALID") from None


def eligible_diaries(csv_bytes: bytes) -> tuple[dict, dict]:
    try:
        decoded = csv_bytes.decode("utf-8-sig", "strict")
    except UnicodeError:
        raise Hold("ATUS_CSV_NOT_UTF8") from None
    reader = csv.DictReader(StringIO(decoded, newline=""))
    require(reader.fieldnames is not None and REQUIRED <= set(reader.fieldnames)
            and len(reader.fieldnames) == len(set(reader.fieldnames)),
            "ATUS_REQUIRED_COLUMNS_MISSING_OR_DUPLICATE")
    groups: dict[str, list] = defaultdict(list)
    invalid = set()
    row_count = 0
    for row_count, row in enumerate(reader, start=1):
        require(row_count <= MAX_ROWS, "ATUS_TOO_MANY_ROWS")
        caseid = (row.get("TUCASEID") or "").strip()
        require(re.fullmatch(r"[0-9]{8,24}", caseid) is not None,
                "ATUS_CASE_ID_INVALID")
        try:
            seq = int((row.get("TUACTIVITY_N") or "").strip())
            duration = int((row.get("TUACTDUR24") or "").strip())
        except ValueError:
            invalid.add(caseid)
            continue
        if not 1 <= seq <= 100 or not 1 <= duration <= 1440:
            invalid.add(caseid)
            continue
        codes = [(row.get(field) or "").strip()
                 for field in ("TUTIER1CODE", "TUTIER2CODE", "TUTIER3CODE")]
        if any(re.fullmatch(r"[0-9]{1,3}", c) is None for c in codes):
            invalid.add(caseid)
            continue
        groups[caseid].append((seq, duration, ".".join(codes)))
    require(row_count > 0, "ATUS_CSV_EMPTY")
    eligible = {}
    for caseid, events in groups.items():
        events.sort()
        if (caseid in invalid or not 2 <= len(events) <= 100
                or sum(e[1] for e in events) != 1440
                or [e[0] for e in events] != list(range(1, len(events) + 1))):
            continue
        eligible[caseid] = events
    require(len(eligible) > 0, "ATUS_NO_COMPLETE_DIARIES")
    return eligible, {
        "source_csv_rows": row_count,
        "reported_diary_cases": len(groups) + len(invalid - set(groups)),
        "complete_24h_diary_cases": len(eligible),
        "selection_rule": "SHA256_2025_CASEID_SORT_COMPLETE_DIARIES_ONLY",
        "caveat": "SURVEY_RECALL_DIARY_DAY_NOT_OBSERVED_REPEATABLE_ROUTINE",
    }


def load_pinned_u1():
    research_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(research_root / "cross-lab"))
    from pinned_owner import load_native_u1
    return load_native_u1()


def analyze(zip_bytes: bytes, *, max_diaries: int = 8,
            expected_zip_sha256: str | None = None, u1_loader=load_pinned_u1) -> dict:
    require(type(max_diaries) is int and 1 <= max_diaries <= 16,
            "ATUS_SAMPLE_SIZE_INVALID")
    zip_sha = sha256(zip_bytes).hexdigest()
    if expected_zip_sha256 is not None:
        require(re.fullmatch(r"[0-9a-f]{64}", expected_zip_sha256) is not None,
                "ATUS_EXPECTED_SHA_FORMAT")
        require(zip_sha == expected_zip_sha256, "ATUS_SOURCE_SHA_MISMATCH")
    member, csv_data = select_csv(zip_bytes)
    diaries, stats = eligible_diaries(csv_data)
    selected_ids = sorted(diaries,
                          key=lambda cid: (sha256(("2025:"+cid).encode()).digest(), cid))[:max_diaries]
    require(selected_ids, "ATUS_SAMPLE_EMPTY")
    records = []
    for sample_index, case_id in enumerate(selected_ids, start=1):
        elapsed = 0
        for seq, duration, code in diaries[case_id]:
            record = {
                "event_id": f"diary-{sample_index:02d}-event-{seq:03d}",
                "case_id": f"diary-{sample_index:02d}",
                "activity": "ATUS_REPORTED_CODE_" + code.replace(".", "_"),
                "timestamp": (FIXED_DAY_ANCHOR + timedelta(minutes=elapsed)).isoformat(),
                "attributes": {
                    "reported_duration_minutes": duration,
                    "activity_coding": "ATUS_2025_THREE_TIERS",
                    "epistemic": "SURVEY_REPORTED_CODED_NOT_DIRECT_OBSERVATION",
                    "clock": "CONSTRUCTED_DAY_2000_01_01_NOT_REAL_DATE",
                    "goal": "UNKNOWN",
                    "task_instance": "NOT_DETERMINED",
                    "task_type": "NOT_DETERMINED",
                },
            }
            records.append(record)
            elapsed += duration
        require(elapsed == 1440, "ATUS_DIARY_DURATION_INCONSISTENT")
    data = ("\n".join(json.dumps(r, ensure_ascii=True, sort_keys=True,
                                  separators=(",", ":")) for r in records) + "\n").encode("utf-8")
    require(len(data) < 4 * 1024 * 1024 and len(records) <= 10_000,
            "ATUS_U1_INPUT_SIZE_INVALID")
    u1, u1_git_blob = u1_loader()
    manifest = {
        "schema": u1.VERSION,
        "kind": "EVENT_LOG_JSONL",
        "owner_ref": "BLS-PUBLIC-ATUS-2025-RESEARCH",
        "jurisdiction": "US",
        "as_of": "2026-06-25",
        "retention_until": "2035-12-31",
        "purpose": "ENGINE_RESEARCH_AND_TEST",
        "disclosure": "PUBLIC",
        "access_basis": "PUBLIC_REUSE_CLAIM",
        "authorization_ref": "OFFICIAL_BLS_PUBLIC_USE_METADATA_NOT_INDEPENDENT_LICENSE_AUDIT",
        "permission_asserted": True,
        "authorized_actions": ["LOCAL_ANALYSIS"],
        "revocation_status": "ACTIVE",
        "sha256": sha256(data).hexdigest(),
        "source_reference": SOURCE_URL,
    }
    receipt = u1.inspect(data, manifest, today=date(2026, 11, 3))
    require(receipt["unit_count"] == len(records), "ATUS_U1_COUNT_MISMATCH")
    require(not receipt["engine_accepted"] and receipt["task_type_ids_assigned"] == 0,
            "ATUS_U1_AUTHORITY_BREACH")
    require(all(u["kind"] == "RawEvent"
                and u["evidence_strength"] == "REPORTED_EVENT_IN_UNVERIFIED_LOG"
                and u["process_context"]["scope"] ==
                "REPORTED_CASE_SEQUENCE_NOT_VERIFIED_EXECUTION"
                for u in receipt["units"]), "ATUS_U1_EPISTEMIC_INVARIANT")
    return {
        "schema": VERSION,
        "status": ("REAL_PUBLIC_SURVEY_TO_PINNED_U1_SOURCE_PINNED" if expected_zip_sha256
                   else "REAL_PUBLIC_SURVEY_TO_PINNED_U1_SHA_CAPTURE_PENDING_LOCK"),
        "origin": {"publisher": "US_BLS", "survey": "ATUS_2025",
                   "source_page": SOURCE_PAGE, "zip_url": SOURCE_URL,
                   "zip_sha256": zip_sha, "csv_member": member,
                   "csv_sha256": sha256(csv_data).hexdigest(),
                   "pinned_source_sha_verified": expected_zip_sha256 is not None},
        "stats": stats,
        "projection": {
            "sample_diaries": len(selected_ids),
            "u1_reported_events": len(records),
            "reported_duration_minutes_each_diary": 1440,
            "input_jsonl_sha256": sha256(data).hexdigest(),
            "sampled_case_ids_exported": False,
            "raw_activity_rows_exported": False,
            "raw_diary_events_exported": False,
            "clock_is_real_calendar_date": False,
            "reported_behavior_is_direct_observation": False,
            "reported_activity_establishes_task_or_goal": False,
            "population_estimates": "NOT_COMPUTED",
            "selection_bias": "COMPLETE_DIARIES_ONLY_SAMPLED_FROM_SINGLE_YEAR",
        },
        "u1": {"source_snapshot_git_blob": u1_git_blob,
               "source_id": receipt["source"]["id"],
               "unit_count": receipt["unit_count"],
               "source_origin": receipt["source"]["source_origin"],
               "evidence_strength": "REPORTED_EVENT_IN_UNVERIFIED_LOG",
               "task_type_ids_assigned": receipt["task_type_ids_assigned"],
               "engine_accepted": receipt["engine_accepted"]},
        "qualification": {"activity_event_intake": "ENGINEERING_REPLAY_ONLY",
                          "individual_goals": "UNKNOWN",
                          "real_world_task_discovery": "NOT_MEASURED",
                          "actual_executed_behavior": "NOT_VERIFIED",
                          "independent_human_gold": "NOT_PRESENT",
                          "context_sufficiency_for_execution": "NOT_ESTABLISHED"},
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--zip", type=Path, required=True)
    p.add_argument("--max-diaries", type=int, default=8)
    p.add_argument("--expected-zip-sha256")
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    try:
        require(args.out != args.zip and not args.out.exists(),
                "ATUS_OUTPUT_PATH_EXISTS_OR_EQUALS_INPUT")
        data = args.zip.read_bytes()
        result = analyze(data, max_diaries=args.max_diaries,
                         expected_zip_sha256=args.expected_zip_sha256)
        args.out.write_text(json.dumps(result, ensure_ascii=True, indent=2,
                                       sort_keys=True) + "\n", encoding="utf-8")
        print("ATUS_U1_REPLAY_OK",
              result["projection"]["sample_diaries"], "diaries",
              result["projection"]["u1_reported_events"], "reported events",
              result["status"])
        return 0
    except (Hold, OSError, ValueError) as exc:
        print("ATUS_U1_REPLAY_HOLD", str(exc)[:100], file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
