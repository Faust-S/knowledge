#!/usr/bin/env python3
"""Direct-source lineage QA for Solve4X scene 01; no human-work inference.

Compare scene-derived OCELs by event ID and activity/timestamp/object links.
No semantic name or clock-offset fitting. Export aggregates and hashes only.
"""
from __future__ import annotations

from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys

SCHEMA = "IWXA_SOLVE4X_SCENE_COMPONENT_LINEAGE/0.1"
JOINED = "scene01/scene01_ocel.json"
VIDEO = "scene01/scene01_video_ocel.json"
SENSOR = "scene01/scene01_sensors_ocel.json"
COMPONENTS = (JOINED, VIDEO, SENSOR)
PINNED_JOINED_SHA256 = "5de185ada7d0e8d82e3f43929e594c31a1c52aad334197557cc7c2550d3f1f15"
MAX_UNCOMPRESSED = 512 * 1024
MAX_COMPRESSED = 128 * 1024


class Hold(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Hold(code)


def event_map(document, label):
    require(isinstance(document, dict), label + "_NOT_DICT")
    events = document.get("ocel:events")
    objects = document.get("ocel:objects")
    require(isinstance(events, dict) and isinstance(objects, dict), label + "_NOT_OCEL")
    require(0 <= len(events) <= 10000 and 0 <= len(objects) <= 10000,
            label + "_POPULATION_OUT_OF_BOUNDS")
    for event_id, event in events.items():
        require(isinstance(event_id, str) and isinstance(event, dict),
                label + "_EVENT_ID_OR_TYPE_INVALID")
        require(isinstance(event.get("ocel:activity"), str)
                and isinstance(event.get("ocel:timestamp"), str),
                label + "_CORE_FIELDS_INVALID")
        links = event.get("ocel:omap")
        require(isinstance(links, list) and all(isinstance(item, str) for item in links),
                label + "_OBJECT_LINKS_INVALID")
    return events


def same_core(a, b):
    """Structural equality only, not independently observed action evidence."""
    return (a["ocel:activity"] == b["ocel:activity"]
            and a["ocel:timestamp"] == b["ocel:timestamp"]
            and Counter(a["ocel:omap"]) == Counter(b["ocel:omap"]))


def analyze(joined, video, sensors):
    all_events = event_map(joined, "JOINED")
    video_events = event_map(video, "VIDEO")
    sensor_events = event_map(sensors, "SENSOR")
    require(bool(all_events), "JOINED_EVENTS_EMPTY")

    outcome = Counter()
    for event_id, event in all_events.items():
        present_video = event_id in video_events
        present_sensor = event_id in sensor_events
        exact_video = present_video and same_core(event, video_events[event_id])
        exact_sensor = present_sensor and same_core(event, sensor_events[event_id])
        if present_video and not exact_video:
            outcome["joined_video_same_id_core_conflict"] += 1
        if present_sensor and not exact_sensor:
            outcome["joined_sensor_same_id_core_conflict"] += 1
        if exact_video and exact_sensor:
            outcome["both_components_exact"] += 1
        elif exact_video:
            outcome["video_only_exact"] += 1
        elif exact_sensor:
            outcome["sensor_only_exact"] += 1
        elif present_video or present_sensor:
            outcome["source_id_present_but_no_exact_core"] += 1
        else:
            outcome["joined_event_not_in_components"] += 1
    outcome["video_events_absent_from_joined"] = len(set(video_events) - set(all_events))
    outcome["sensor_events_absent_from_joined"] = len(set(sensor_events) - set(all_events))
    outcome["component_id_intersection"] = len(set(video_events) & set(sensor_events))
    outcome["joined_total"] = len(all_events)
    outcome["video_component_total"] = len(video_events)
    outcome["sensor_component_total"] = len(sensor_events)
    outcome["joined_with_end_time_field"] = sum(
        isinstance(item.get("ocel:vmap"), dict) and "end_time" in item["ocel:vmap"]
        for item in all_events.values())
    outcome["joined_without_end_time_field"] = (
        len(all_events) - outcome["joined_with_end_time_field"])

    classified = sum(outcome[k] for k in
                     ("both_components_exact", "video_only_exact", "sensor_only_exact"))
    require(classified + outcome["source_id_present_but_no_exact_core"]
            + outcome["joined_event_not_in_components"] == len(all_events),
            "JOINED_PARTITION_INVALID")
    return {
        "schema": SCHEMA,
        "status": "DIRECT_PUBLISHED_COMPONENT_LINEAGE_AUDIT",
        "counts": dict(sorted(outcome.items())),
        "independent_itam_event_provenance": "NOT_PROVEN_BY_SCENE_COMPONENTS",
        "video_and_sensor_both_exact_is_independent_confirmation": False,
        "joined_event_not_in_components_is_itam_event": False,
        "timestamp_calibration": "NOT_MEASURED",
        "human_action_gold": "NOT_MEASURED",
        "task_discovery_precision": "NOT_MEASURED",
        "accepted_tasks": 0,
        "source_values_exported": False,
    }


def probe():
    import solve4x_zip_range_probe as zipidx
    import solve4x_small_member_pair as member

    zip_index = zipidx.probe()
    require(zip_index["status"] == "ZIP_RANGE_INDEX_ONLY_NOT_MULTIMODAL_REPLAY",
            "ARCHIVE_INDEX_HOLD")
    require(zip_index["source"]["central_sha256"] ==
            "bd47f03d561c6468d77df80ec8f920a3dd65502987440abf8a25dacaeb16c5b5",
            "ARCHIVE_VERSION_DRIFT")
    metadata = zipidx._metadata()
    entries = {e["name"]: e for e in zip_index["target_files"]}
    require(all(x in entries for x in COMPONENTS), "SCENE_COMPONENT_MEMBER_MISSING")
    raw = {}
    for name in COMPONENTS:
        entry = entries[name]
        require(entry["compression_method"] == 8
                and 0 < entry["compressed_bytes"] <= MAX_COMPRESSED
                and 0 < entry["uncompressed_bytes"] <= MAX_UNCOMPRESSED,
                "COMPONENT_COMPRESSION_OR_SIZE_HOLD")
        raw[name] = member._download_member(
            metadata["download_url"], metadata["archive_size"], entry,
            max_compressed=MAX_COMPRESSED, max_uncompressed=MAX_UNCOMPRESSED)
    hashes = {name: sha256(raw[name]).hexdigest() for name in COMPONENTS}
    require(hashes[JOINED] == PINNED_JOINED_SHA256, "JOINED_SOURCE_SHA_DRIFT")
    report = analyze(*(json.loads(raw[name]) for name in COMPONENTS))
    report["source"] = {
        "figshare_article_id": metadata["article_id"],
        "zip_directory_sha256": zip_index["source"]["central_sha256"],
        "member_sha256": hashes,
        "full_archive_downloaded": False,
        "media_downloaded": False,
        "source_bytes_written_to_artifact": False,
    }
    return report


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    require(not args.out.exists(), "OUTPUT_FILE_ALREADY_EXISTS")
    try:
        report = probe()
        ok = True
    except (Hold, OSError, ValueError, TimeoutError, KeyError) as exc:
        report = {
            "schema": SCHEMA,
            "status": "COMPONENT_LINEAGE_SOURCE_HOLD",
            "failure_class": type(exc).__name__,
            "failure_code": str(exc) if isinstance(exc, Hold) else "EXTERNAL_SOURCE_OR_SCHEMA_UNAVAILABLE",
            "accepted_tasks": 0,
            "source_values_exported": False,
        }
        ok = False
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("SOLVE4X_SCENE_COMPONENT_LINEAGE", report["status"],
          "events", report.get("counts", {}).get("joined_total", "UNKNOWN"))
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
