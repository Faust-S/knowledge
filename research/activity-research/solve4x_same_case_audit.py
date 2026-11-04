#!/usr/bin/env python3
"""Solve4X-scene01 identity and vocabulary overlap: descriptive, not truth.

Uses the already source-bound, CRC-verified selective member reader.
Compares only same-case identifiers and label vocabularies. The joined scene
OCEL can contain video-derived events, so this is NOT independent confirmation.
"""
from __future__ import annotations
from collections import Counter
from hashlib import sha256
import json
import re
import sys
from pathlib import Path

import solve4x_small_member_pair as pair
import solve4x_zip_range_probe as idx

SCHEMA = "IWXA_SOLVE4X_SAME_CASE_EVIDENCE_AUDIT/0.1"
CASE_PATTERN = re.compile(r"ID\d{3}")


def walk_author_nodes(obj, depth=0):
    idx.check(depth <= 30, "VIDEO_ANNOTATION_NESTING_TOO_DEEP")
    if isinstance(obj, dict):
        if all(k in obj for k in ("data", "tcin", "tcout")):
            yield obj
        for key, value in obj.items():
            if isinstance(value, (dict, list)):
                yield from walk_author_nodes(value, depth+1)
    elif isinstance(obj, list):
        idx.check(len(obj) <= 20000, "VIDEO_NODES_TOO_MANY")
        for value in obj:
            yield from walk_author_nodes(value, depth+1)


def analyze_scene(video: dict, ocel: dict) -> dict:
    idx.check(isinstance(video, dict) and isinstance(video.get("localisations"), list),
              "VIDEO_LOCALISATIONS_MISSING")
    idx.check(isinstance(ocel, dict) and isinstance(ocel.get("ocel:events"), dict)
              and isinstance(ocel.get("ocel:objects"), dict),
              "OCEL_EVENTS_OR_OBJECTS_MISSING")
    video_nodes = list(walk_author_nodes(video["localisations"]))
    idx.check(len(video_nodes) <= 20000 and len(video_nodes) > 0,
              "VIDEO_NODES_EMPTY_OR_OVERSIZED")
    video_case_refs = set()
    video_labels = set()
    video_activities = Counter()
    nodes_with_case = 0
    video_data_fields = Counter()
    author_types = Counter()
    for node in video_nodes:
        data = node.get("data")
        author_types[type(node.get("localisation")).__name__] += 1
        if not isinstance(data, dict):
            continue
        video_data_fields.update(str(k) for k in data)
        refs = set()
        for value in data.values():
            if isinstance(value, str):
                refs.update(CASE_PATTERN.findall(value))
        if refs:
            nodes_with_case += 1
            video_case_refs.update(refs)
        label = data.get("label")
        if isinstance(label, str) and label:
            video_labels.add(label)
        activity = data.get("activity")
        if isinstance(activity, str) and activity:
            video_activities[activity] += 1
    ocel_case_refs = set()
    ocel_labels = set()
    ocel_video_marker_activity = Counter()
    ocel_other_activity = Counter()
    count_with_case_ref = 0
    ocel_vmap_fields = Counter()
    ocel_vmap_ref_hits = 0
    ocel_event_id_ref_hits = 0
    object_types = Counter()
    for event_id in ocel["ocel:events"]:
        if isinstance(event_id, str) and CASE_PATTERN.search(event_id):
            ocel_event_id_ref_hits += 1
    for object_data in ocel["ocel:objects"].values():
        if isinstance(object_data, dict):
            t = object_data.get("ocel:type")
            if isinstance(t, str):
                object_types[t] += 1
    for object_id in ocel["ocel:objects"]:
        if isinstance(object_id, str):
            ocel_case_refs.update(CASE_PATTERN.findall(object_id))
    for event in ocel["ocel:events"].values():
        idx.check(isinstance(event, dict), "OCEL_EVENT_TYPE_INVALID")
        activity = event.get("ocel:activity")
        if isinstance(activity, str) and activity:
            ocel_labels.add(activity)
        omap = event.get("ocel:omap", [])
        idx.check(isinstance(omap, list), "OCEL_EVENT_OMAP_INVALID")
        vmap = event.get("ocel:vmap", {})
        idx.check(isinstance(vmap, dict), "OCEL_EVENT_VMAP_INVALID")
        ocel_vmap_fields.update(str(k) for k in vmap)
        if isinstance(activity, str) and activity:
            if "end_time" in vmap:
                ocel_video_marker_activity[activity] += 1
            else:
                ocel_other_activity[activity] += 1
        if any(isinstance(v, str) and CASE_PATTERN.search(v) for v in vmap.values()):
            ocel_vmap_ref_hits += 1
        refs = set()
        for ref in omap:
            if isinstance(ref, str):
                refs.update(CASE_PATTERN.findall(ref))
        if refs:
            count_with_case_ref += 1
            ocel_case_refs.update(refs)
    shared = video_case_refs.intersection(ocel_case_refs)
    def multiset_intersection(left, right):
        return sum(min(n, right.get(key, 0)) for key, n in left.items())
    source_video_marked_matches = multiset_intersection(
        video_activities, ocel_video_marker_activity)
    source_other_matches = multiset_intersection(
        video_activities, ocel_other_activity)
    return {
        "schema": SCHEMA,
        "status": "REAL_SCENE_DERIVATIVES_IDENTITY_COMPARISON_NOT_INDEPENDENT_TRUTH",
        "counts": {
            "author_annotation_nodes": len(video_nodes),
            "annotation_nodes_with_case_ref": nodes_with_case,
            "video_distinct_case_refs": len(video_case_refs),
            "ocel_distinct_case_refs": len(ocel_case_refs),
            "case_references_in_both": len(shared),
            "ocel_registered_events": len(ocel["ocel:events"]),
            "ocel_registered_objects": len(ocel["ocel:objects"]),
            "ocel_events_with_case_ref": count_with_case_ref,
            "video_distinct_label_strings": len(video_labels),
            "ocel_distinct_activity_strings": len(ocel_labels),
            "shared_literal_activity_strings": len(video_labels.intersection(ocel_labels)),
            "video_annotated_activity_segments": sum(video_activities.values()),
            "video_annotated_distinct_activities": len(video_activities),
            "ocel_events_with_end_time_marker": sum(ocel_video_marker_activity.values()),
            "ocel_events_without_end_time_marker": sum(ocel_other_activity.values()),
            "literal_activity_multiset_match_with_end_time_marker": source_video_marked_matches,
            "literal_activity_multiset_match_without_marker": source_other_matches,
            "literal_video_ocel_marked_activity_multisets_equal": (
                video_activities == ocel_video_marker_activity),
            "video_annotation_data_key_occurrences": dict(sorted(video_data_fields.items())),
            "video_localisation_value_type_occurrences": dict(sorted(author_types.items())),
            "ocel_vmap_key_occurrences": dict(sorted(ocel_vmap_fields.items())),
            "ocel_vmap_values_containing_case_ref": ocel_vmap_ref_hits,
            "ocel_event_id_containing_case_ref": ocel_event_id_ref_hits,
            "ocel_distinct_object_types": len(object_types),
            "ocel_object_type_frequency_profile": sorted(object_types.values()),
        },
        "constraints": {
            "video_labels_from_author_annotations_not_independent_review": True,
            "scene_ocel_is_joined_source_cannot_claim_independent_support": True,
            "end_time_field_marker_origin": "STRUCTURAL_PROXY_NOT_INDEPENDENTLY_ATTESTED",
            "literal_activity_multiset_overlap_is_not_event_level_time_alignment": True,
            "matching_case_refs_are_documentary_link_not_event_agreement": True,
            "nonmatching_label_is_not_an_undocumented_human_action": True,
            "actual_video_self_review": "NOT_RUN",
            "independent_itam_raw_log_source": "NOT_LOADED",
            "task_type_gold": "NOT_MEASURED",
            "false_confident_claim_rate_vs_human_gold": "NOT_MEASURED",
            "correct_unknown_rate_vs_human_gold": "NOT_MEASURED",
            "accepted_tasks": 0,
        },
        "raw_source_exported": False,
    }


def run():
    index = idx.probe()
    meta = idx._metadata()
    members = pair.selected_members(index)
    raw = {entry["name"]: pair._download_member(meta["download_url"],
           meta["archive_size"], entry) for entry in members}
    result = analyze_scene(json.loads(raw[pair.WANTED[0]]),
                           json.loads(raw[pair.WANTED[1]]))
    result["source"] = {
        "dataset_article_id": meta["article_id"],
        "archive_sha256_of_zip_index": index["source"]["central_sha256"],
        "video_annotation_sha256": sha256(raw[pair.WANTED[0]]).hexdigest(),
        "joined_ocel_sha256": sha256(raw[pair.WANTED[1]]).hexdigest(),
        "full_archive_downloaded": False,
        "raw_video_downloaded": False,
    }
    return result


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()
    idx.check(not args.out.exists(), "OUTPUT_ALREADY_EXISTS")
    try:
        result = run()
        good = True
    except (idx.Hold, ValueError, OSError, TimeoutError) as error:
        result = {"schema": SCHEMA, "status": "SCENE_IDENTITY_SOURCE_HOLD",
                  "failure_class": type(error).__name__,
                  "raw_source_exported": False,
                  "constraints": {"accepted_tasks": 0, "task_type_gold": "NOT_MEASURED",
                                  "independent_itam_raw_log_source": "NOT_LOADED"}}
        good = False
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8")
    print("SOLVE4X_SAME_CASE", result["status"],
          "matched_case_refs", result.get("counts", {}).get("case_references_in_both", "UNKNOWN"),
          "accepted_tasks", result["constraints"]["accepted_tasks"])
    return 0 if good else 2


if __name__ == "__main__":
    sys.exit(main())
