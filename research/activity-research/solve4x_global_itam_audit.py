#!/usr/bin/env python3
"""Bounded direct global ITAM / scene OCEL comparison for Solve4X.

Reads exact bytes of two ZIP members in memory using existing HTTP-range
adapter; exports aggregates and cryptographic hashes, never event details.
This validates source-record consistency, NOT observed physical work or E5 gold.
"""
from __future__ import annotations

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys

import solve4x_zip_range_probe as idx
import solve4x_small_member_pair as selected

GLOBAL = "global/global_ocel.json"
SCENE = "scene01/scene01_ocel.json"
SCHEMA = "IWXA_SOLVE4X_GLOBAL_ITAM_SCENE_COMPARISON/0.1"
MAX_GLOBAL_COMPRESSED = 128 * 1024
MAX_GLOBAL_UNCOMPRESSED = 1024 * 1024


def verify_ocel(data: dict, label: str) -> tuple[dict, dict]:
    idx.check(isinstance(data, dict) and
              isinstance(data.get("ocel:events"), dict) and
              isinstance(data.get("ocel:objects"), dict),
              label + "_NOT_OCEL_1_JSON")
    events = data["ocel:events"]
    objects = data["ocel:objects"]
    idx.check(0 < len(events) <= 20000 and len(objects) <= 30000,
              label + "_POPULATION_UNBOUNDED")
    for event_id, event in events.items():
        idx.check(isinstance(event_id, str) and isinstance(event, dict) and
                  isinstance(event.get("ocel:activity"), str) and
                  isinstance(event.get("ocel:timestamp"), str) and
                  isinstance(event.get("ocel:omap", []), list),
                  label + "_EVENT_SCHEMA_INVALID")
    return events, objects


def event_signature(event: dict) -> tuple[str, str]:
    # Exact logged event timestamp and label: a descriptive baseline only.
    return (event["ocel:timestamp"], event["ocel:activity"])


def compare(global_ocel: dict, scene_ocel: dict) -> dict:
    g_events, g_objects = verify_ocel(global_ocel, "GLOBAL")
    s_events, s_objects = verify_ocel(scene_ocel, "SCENE")
    global_id_set = set(g_events)
    scene_id_set = set(s_events)
    exact_ids = global_id_set & scene_id_set
    global_counts = Counter(map(event_signature, g_events.values()))
    scene_counts = Counter(map(event_signature, s_events.values()))
    scene_marked = {key: event for key, event in s_events.items()
                    if isinstance(event.get("ocel:vmap"), dict) and
                    "end_time" in event["ocel:vmap"]}
    scene_unmarked = {key: event for key, event in s_events.items()
                      if key not in scene_marked}
    matched_signatures = sum((global_counts & scene_counts).values())
    unmarked_sig = Counter(map(event_signature, scene_unmarked.values()))
    marked_sig = Counter(map(event_signature, scene_marked.values()))
    unmarked_sig_match = sum((global_counts & unmarked_sig).values())
    marked_sig_match = sum((global_counts & marked_sig).values())
    global_only_id_count = len(global_id_set - scene_id_set)
    scene_only_id_count = len(scene_id_set - global_id_set)

    # Source lineage is not established by a name match. No row-level pairing
    # is asserted without exact ID and timestamp plus trusted origin mapping.
    return {
        "schema": SCHEMA,
        "status": "DIRECT_GLOBAL_AND_SCENE_OCEL_RECORD_SCOPE_COMPARED",
        "counts": {
            "global_recorded_events": len(g_events),
            "global_recorded_objects": len(g_objects),
            "scene_recorded_events": len(s_events),
            "scene_recorded_objects": len(s_objects),
            "scene_marked_end_time_events": len(scene_marked),
            "scene_unmarked_end_time_events": len(scene_unmarked),
            "shared_exact_event_ids": len(exact_ids),
            "global_only_event_ids": global_only_id_count,
            "scene_only_event_ids": scene_only_id_count,
            "shared_exact_object_ids": len(set(g_objects) & set(s_objects)),
            "matching_timestamp_and_activity_multiplicity": matched_signatures,
            "scene_unmarked_matching_global_timestamp_activity": unmarked_sig_match,
            "scene_marked_matching_global_timestamp_activity": marked_sig_match,
            "exact_ids_with_matching_activity_timestamp": sum(
                event_signature(g_events[e]) == event_signature(s_events[e])
                for e in exact_ids),
        },
        "limits": {
            "matching_timestamp_and_activity_means_physical_action_proven": False,
            "same_archive_system_logs_are_independent_human_activity_gold": False,
            "unmatched_events_are_hidden_work": False,
            "global_vs_scene_is_system_record_consistency_only": True,
            "independent_raw_video_review": "NOT_RUN",
            "human_task_gold": "NOT_MEASURED",
            "false_confident_rate": "NOT_MEASURED",
            "correct_unknown_rate": "NOT_MEASURED",
            "task_to_result": "NOT_RUN",
            "accepted_tasks": 0,
        },
        "raw_source_events_exported": False,
    }


def run() -> dict:
    probe = idx.probe()
    idx.check(probe["status"] == "ZIP_RANGE_INDEX_ONLY_NOT_MULTIMODAL_REPLAY",
              "GLOBAL_ZIP_INDEX_HOLD")
    candidates = [entry for entry in probe["target_files"]
                  if entry["name"] in (GLOBAL, SCENE)]
    idx.check(len(candidates) == 2 and len({x["name"] for x in candidates}) == 2,
              "GLOBAL_AND_SCENE_REQUIRED")
    meta = idx._metadata()
    idx.check(meta["archive_size"] == probe["source"]["archive_bytes"],
              "GLOBAL_ARCHIVE_SIZE_DRIFT")
    raw = {}
    for entry in candidates:
        idx.check(entry["compression_method"] == 8, "GLOBAL_UNSUPPORTED_ZIP_METHOD")
        cap = (MAX_GLOBAL_UNCOMPRESSED if entry["name"] == GLOBAL
               else selected.MAX_UNCOMPRESSED)
        cmpcap = (MAX_GLOBAL_COMPRESSED if entry["name"] == GLOBAL
                  else selected.MAX_COMPRESSED)
        idx.check(0 < entry["compressed_bytes"] <= cmpcap and
                  0 < entry["uncompressed_bytes"] <= cap,
                  "GLOBAL_MEMBER_SIZE_CAP_HOLD")
        raw[entry["name"]] = selected._download_member(
            meta["download_url"], meta["archive_size"], entry,
            max_compressed=cmpcap, max_uncompressed=cap)
    result = compare(json.loads(raw[GLOBAL]), json.loads(raw[SCENE]))
    result["source"] = {
        "figshare_article": meta["article_id"],
        "source_file_id": meta["file_id"],
        "central_zip_index_sha256": probe["source"]["central_sha256"],
        "global_ocel_sha256": sha256(raw[GLOBAL]).hexdigest(),
        "scene_ocel_sha256": sha256(raw[SCENE]).hexdigest(),
        "full_archive_downloaded": False,
        "raw_video_downloaded": False,
        "original_json_exported": False,
    }
    return result


def main() -> int:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()
    idx.check(not args.out.exists(), "OUTPUT_ALREADY_EXISTS")
    try:
        result = run()
        success = True
    except (idx.Hold, OSError, ValueError, TimeoutError) as exc:
        result = {
            "schema": SCHEMA, "status": "GLOBAL_AND_SCENE_SOURCE_HOLD",
            "failure_class": type(exc).__name__,
            "failure_code": str(exc)[:110] if isinstance(exc, idx.Hold)
                            else "EXTERNAL_SOURCE_ACCESS_FAILURE",
            "raw_source_events_exported": False,
            "limits": {
                "human_task_gold": "NOT_MEASURED",
                "task_to_result": "NOT_RUN", "accepted_tasks": 0},
        }
        success = False
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8")
    print("SOLVE4X_GLOBAL_ITAM", result["status"],
          "global_events", result.get("counts", {}).get("global_recorded_events", "UNKNOWN"),
          "matched_scene_unmarked",
          result.get("counts", {}).get("scene_unmarked_matching_global_timestamp_activity", "UNKNOWN"))
    return 0 if success else 2


if __name__ == "__main__":
    sys.exit(main())
