#!/usr/bin/env python3
"""C12-C16 read-only owner-local source locators. No Task/Gold inference."""
from __future__ import annotations
import csv
import hashlib
from io import StringIO
import json

import solve4x_cross_source_coverage as c12
import solve4x_c13_episode_triage as c13
import solve4x_c14_raw_reed_review as c14
import solve4x_c16_review_footprint as c16

SCHEMA = "IWXA_SOLVE4X_C12_C16_SOURCE_BOUND_HANDOFF/0.1"
VIDEO = "scene01/scene01_video_ocel.json"
SENSOR = "scene01/scene01_sensors_ocel.json"
UI = "scene01/scene01_ui.csv"
REED = "scene01/scene01_reed_switches.csv"
PINS = {VIDEO: c12.SHA[VIDEO], SENSOR: c12.SHA[SENSOR],
        UI: c12.SHA[UI],
        REED: "5e469a4bd4f14f831bbdce1048fe4ec963a8c263c05b90c77a167cf0dc5bf5e0"}
CLOCK = "CROSS_DEVICE_CLOCK_CALIBRATION_UNKNOWN"
CANDIDATE = "TIME_CLASS_NEIGHBOR_NOT_CONFIRMED_ACTION"


def _check(files, pins):
    c12.ensure(type(files) is dict and set(files) == set(PINS)
               and type(pins) is dict and set(pins) == set(PINS),
               "HANDOFF_SOURCE_SCOPE_HOLD")
    for member, data in files.items():
        c12.ensure(type(data) is bytes and 0 < len(data) <= 524288,
                   "HANDOFF_SOURCE_BYTES_HOLD")
        c12.ensure(type(pins[member]) is str and len(pins[member]) == 64
                   and hashlib.sha256(data).hexdigest() == pins[member],
                   "HANDOFF_SOURCE_SHA_HOLD")


def _ocel(raw):
    try:
        doc = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeError, ValueError):
        raise c12.Hold("HANDOFF_OCEL_INVALID") from None
    c12.ensure(type(doc) is dict and type(doc.get("ocel:events")) is dict
               and all(type(key) is str and key.strip() for key in doc["ocel:events"]),
               "HANDOFF_OCEL_ORIGINAL_LOCATOR_HOLD")
    return doc


def _csv_locators(data, count):
    # Record number is within the original SHA-pinned CSV, NOT C13 review ordinal.
    try:
        source = data.decode("utf-8-sig")
        header = source.splitlines()[0]
        sep = max((",", ";", "\t"), key=lambda c: (header.count(c), c))
        reader = csv.DictReader(StringIO(source), delimiter=sep, skipinitialspace=True)
        c12.ensure(reader.fieldnames is not None, "HANDOFF_CSV_HEADER_HOLD")
        last = reader.line_num
        result = []
        for index, _ in enumerate(reader, 1):
            result.append({"kind": "CSV_RECORD", "record_number": index,
                           "physical_line_start": last + 1,
                           "physical_line_end": reader.line_num})
            c12.ensure(reader.line_num > last, "HANDOFF_CSV_LINE_HOLD")
            last = reader.line_num
    except (UnicodeError, ValueError, IndexError, csv.Error):
        raise c12.Hold("HANDOFF_CSV_LOCATOR_HOLD") from None
    c12.ensure(len(result) == count, "HANDOFF_CSV_COUNT_HOLD")
    return result


def _ref(member, sha, locator):
    return {"source_member": member, "source_sha256": sha, "locator": locator}


def prepare_owner_local(video_bytes, sensor_bytes, ui_bytes, reed_bytes, *,
                        expected_pins=None):
    """Return PRIVATE original-source locators; caller owns access/permissions.

    Override pins only for synthetic tests: that packet is not qualified Solve4X.
    """
    files = {VIDEO: video_bytes, SENSOR: sensor_bytes, UI: ui_bytes, REED: reed_bytes}
    pins = dict(PINS if expected_pins is None else expected_pins)
    _check(files, pins)
    video, sensors = _ocel(video_bytes), _ocel(sensor_bytes)
    intervals = c12.spans(video)
    original = c14._outside_video_events(video, sensors)
    raw, ui = c14.parse_raw_reed(reed_bytes), c14.parse_ui_context(ui_bytes)
    ui_types = c13.parse_ui_records(ui_bytes)
    c12.ensure(len(ui) == len(ui_types), "HANDOFF_UI_COUNT_HOLD")
    raw_locs, ui_locs = _csv_locators(reed_bytes, len(raw)), _csv_locators(ui_bytes, len(ui))
    video_rows = c16._rows(video)
    video_events = list(video["ocel:events"].items())
    outside = []
    for source_key, event in sensors["ocel:events"].items():
        c12.ensure(type(event) is dict and type(event.get("ocel:activity")) is str,
                   "HANDOFF_SENSOR_EVENT_HOLD")
        timestamp = c12.stamp(event.get("ocel:timestamp"))
        if not any(start <= timestamp <= end for start, end in intervals):
            sensor, state = c14._meaning_of_sensor_event(event["ocel:activity"])
            outside.append((timestamp, sensor, state, source_key))
    outside.sort(key=lambda row: row[:3])
    c12.ensure([r[:3] for r in outside] == original, "HANDOFF_EPISODE_ALIGNMENT_HOLD")
    episodes = []
    for ordinal, (timestamp, sensor, state, key) in enumerate(outside, 1):
        reed_candidates = []
        for i, row in enumerate(raw):
            if c14._compatibles((timestamp, sensor, state), row, 5, require_state=False):
                reed_candidates.append({
                    **_ref(REED, pins[REED], raw_locs[i]),
                    "type": "RAW_REED_RECORDER_ROW", "modality": "RAW_AMBIENT_SENSOR",
                    "epistemic": "observed", "sensor_class": row[1], "state_class": row[2],
                    "state_compatible": state != "UNKNOWN" and state == row[2],
                    "time_gap_seconds": round(abs(timestamp-row[0]), 3),
                    "relation": CANDIDATE})
        ui_candidates = []
        for i, (ui_time, flags, ui_kind) in enumerate(ui):
            if abs(timestamp-ui_time) <= 5:
                ui_candidates.append({
                    **_ref(UI, pins[UI], ui_locs[i]),
                    "type": "BROWSER_UI_ROW", "modality": "BROWSER_UI",
                    "epistemic": "observed", "event_class": ui_kind,
                    "target_class": ui_types[i][2], "context_presence_flags": flags,
                    "time_gap_seconds": round(abs(timestamp-ui_time), 3),
                    "relation": CANDIDATE})
        annotations = []
        for (video_key, _), (_, end, kind) in zip(video_events, video_rows):
            if sensor == "ENTRANCE" and state == "CLOSED" and kind is not None and 0 <= timestamp-end <= 5:
                annotations.append({
                    **_ref(VIDEO, pins[VIDEO], {"kind": "OCEL_EVENT_KEY",
                                               "source_event_key": video_key}),
                    "type": "AUTHOR_VIDEO_ANNOTATION", "modality": "VIDEO_AUTHOR_OCEL",
                    "epistemic": "reported", "author_label_class": kind,
                    "independent_human_gold": False,
                    "time_after_end_seconds": round(timestamp-end, 3),
                    "relation": CANDIDATE})
        episodes.append({
            "review_ordinal_not_original_id": ordinal,
            "sensor_observation": {
                **_ref(SENSOR, pins[SENSOR], {"kind": "OCEL_EVENT_KEY",
                                             "source_event_key": key}),
                "type": "SENSOR_DERIVED_OCEL_EVENT", "modality": "AMBIENT_SENSOR_DERIVED",
                "epistemic": "observed", "source_record_verified": True,
                "physical_human_action_verified": False},
            "sensor_class": sensor, "sensor_state_class": state,
            "raw_reed_candidates_5s": reed_candidates,
            "browser_ui_candidates_5s": ui_candidates,
            "author_video_annotation_candidates_5s": annotations,
            "temporal_uncertainty": CLOCK, "same_human_action": "UNKNOWN",
            "task_hypothesis": "NOT_QUALIFIED", "accepted_tasks": 0})
    cost = c16.analyze(video, original)
    return {"schema": SCHEMA,
            "status": "OWNER_LOCAL_SOURCE_RECORDS_VERIFIED_RELATIONS_UNKNOWN",
            "pin_authority": "PINNED_SOLVE4X" if expected_pins is None else "CALLER_SUPPLIED_UNQUALIFIED",
            "source_sha256": pins, "episodes": episodes,
            "video_baseline_counts": {
                "all": cost["denominators"]["video_annotation_total"],
                "literal_enter_leave": cost["denominators"]["literal_enter_leave_annotations"],
                "reed_closed_after_end_5s":
                    cost["review_baselines"]["reed_closed_after_video_end_5s"]["annotations_to_review"]},
            "clock_calibration_proven": False, "same_human_action_confirmed": False,
            "human_gold": "NOT_MEASURED", "accepted_tasks": 0,
            "permissions_attested": False, "not_for_publication": True}


def public_summary(packet):
    """Only closed classes and counts: no source ID, timestamp, actor or raw text."""
    c12.ensure(type(packet) is dict and packet.get("schema") == SCHEMA
               and packet.get("not_for_publication") is True
               and type(packet.get("episodes")) is list
               and packet.get("accepted_tasks") == 0, "HANDOFF_PACKET_HOLD")
    safe = []
    for e in packet["episodes"]:
        c12.ensure(type(e) is dict and e.get("sensor_class") in
                   {"ENTRANCE", "MOUSE_CUPBOARD", "KEYBOARD_CUPBOARD",
                    "CUPBOARD_UNRESOLVED", "UNKNOWN"}
                   and e.get("same_human_action") == "UNKNOWN",
                   "HANDOFF_UNKNOWN_GUARD")
        safe.append({
            "review_ordinal_not_original_id": e["review_ordinal_not_original_id"],
            "type": "SENSOR_DERIVED_OCEL_EVENT",
            "modality": "AMBIENT_SENSOR_DERIVED", "sensor_class": e["sensor_class"],
            "original_source_locator": "OWNER_LOCAL_REQUIRED",
            "raw_reed_candidates_5s": len(e["raw_reed_candidates_5s"]),
            "ui_candidates_5s": len(e["browser_ui_candidates_5s"]),
            "author_video_annotation_candidates_5s":
                len(e["author_video_annotation_candidates_5s"]),
            "temporal_uncertainty": CLOCK, "same_human_action": "UNKNOWN",
            "task_hypothesis": "NOT_QUALIFIED"})
    return {"schema": SCHEMA, "status": "PUBLIC_ONLY_OWNER_LOCAL_SOURCE_LOCATOR_REQUIRED",
            "pin_authority": packet["pin_authority"],
            "source_sha256": dict(packet["source_sha256"]),
            "episode_count": len(safe), "episodes": safe,
            "video_baseline_counts": dict(packet["video_baseline_counts"]),
            "original_bytes_sha_verified": True,
            "authorized_source_locator_publicly_available": False,
            "clock_calibration_proven": False, "same_human_action_confirmed": False,
            "human_gold": "NOT_MEASURED", "accepted_tasks": 0,
            "source_identifiers_timestamps_actor_or_values_exported": False}
