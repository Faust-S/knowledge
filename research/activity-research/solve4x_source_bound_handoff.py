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


def _no_duplicate_json_keys(pairs):
    result = {}
    for key, value in pairs:
        c12.ensure(key not in result, "HANDOFF_DUPLICATE_JSON_KEY_HOLD")
        result[key] = value
    return result


def _ocel(raw):
    try:
        doc = json.loads(raw.decode("utf-8-sig"),
                         object_pairs_hook=_no_duplicate_json_keys)
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


def verify_owner_local_locator(original_bytes, ref, *, expected_pins=None):
    """Verify exact member revision and original event/CSV record, never action truth."""
    pins = PINS if expected_pins is None else expected_pins
    c12.ensure(type(pins) is dict and set(pins) == set(PINS)
               and type(ref) is dict, "HANDOFF_LOCATOR_SCOPE_HOLD")
    member = ref.get("source_member")
    c12.ensure(type(member) is str and member in PINS
               and type(original_bytes) is bytes and 0 < len(original_bytes) <= 524288
               and type(ref.get("source_sha256")) is str
               and ref["source_sha256"] == pins[member]
               and hashlib.sha256(original_bytes).hexdigest() == pins[member],
               "HANDOFF_LOCATOR_REVISION_HOLD")
    locator = ref.get("locator")
    c12.ensure(type(locator) is dict, "HANDOFF_LOCATOR_KIND_HOLD")
    if member in (VIDEO, SENSOR):
        c12.ensure(set(locator) == {"kind", "source_event_key"}
                   and locator["kind"] == "OCEL_EVENT_KEY"
                   and type(locator["source_event_key"]) is str
                   and bool(locator["source_event_key"]), "HANDOFF_LOCATOR_KIND_HOLD")
        events = _ocel(original_bytes)["ocel:events"]
        c12.ensure(locator["source_event_key"] in events
                   and type(events[locator["source_event_key"]]) is dict,
                   "HANDOFF_OCEL_EVENT_NOT_FOUND")
    else:
        c12.ensure(set(locator) == {"kind", "record_number",
                                    "physical_line_start", "physical_line_end"}
                   and locator["kind"] == "CSV_RECORD"
                   and all(type(locator[k]) is int and locator[k] > 0 for k in
                           ("record_number", "physical_line_start", "physical_line_end")),
                   "HANDOFF_CSV_LOCATOR_HOLD")
        count = len(c14.parse_raw_reed(original_bytes)) if member == REED else len(c14.parse_ui_context(original_bytes))
        locations = _csv_locators(original_bytes, count)
        n = locator["record_number"]
        c12.ensure(n <= count and locator == locations[n-1],
                   "HANDOFF_CSV_LOCATOR_STALE")
    return {"schema": SCHEMA, "status": "SOURCE_RECORD_ONLY_VERIFIED",
            "source_sha256": pins[member], "source_member": member,
            "original_event_id_exported": False,
            "source_record_verified": True,
            "clock_calibrated": False, "same_human_action": "UNKNOWN",
            "human_gold": "NOT_MEASURED", "accepted_tasks": 0,
            "source_access_permission_attested": False}


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


def reconcile_with_existing_reports(packet, c13_report, c14_report):
    """Reconcile source-record review scope with C13/C14, never human gold.

    Runs after owner-local original-source replay. Source record identifiers
    remain internal; only deduplicated counts are returned.
    """
    c12.ensure(type(packet) is dict and packet.get("schema") == SCHEMA
               and packet.get("not_for_publication") is True
               and type(c13_report) is dict
               and c13_report.get("schema") == c13.SCHEMA
               and type(c14_report) is dict
               and c14_report.get("schema") == c14.SCHEMA,
               "HANDOFF_RECONCILIATION_SCOPE_HOLD")
    episodes = packet.get("episodes")
    c13_rows, c14_rows = c13_report.get("episodes"), c14_report.get("review_episodes")
    c12.ensure(type(episodes) is list and type(c13_rows) is list
               and type(c14_rows) is list
               and len(episodes) == len(c13_rows) == len(c14_rows) ==
                   c14_report["denominators"]["outside_video_sensor_events"],
               "HANDOFF_EPISODE_COUNT_DRIFT")
    raw_keys, ui_keys, video_keys = set(), set(), set()
    raw_edges, ui_edges, video_edges = 0, 0, 0
    for index, (episode, c13_row, c14_row) in enumerate(
            zip(episodes, c13_rows, c14_rows), 1):
        raw_rows = episode["raw_reed_candidates_5s"]
        ui_rows = episode["browser_ui_candidates_5s"]
        video_rows = episode["author_video_annotation_candidates_5s"]
        c12.ensure(c13_row.get("review_ordinal") == index
                   and c14_row.get("review_ordinal") == index
                   and c14_row.get("sensor_class") == episode["sensor_class"]
                   and c14_row.get("ocel_state_class") == episode["sensor_state_class"]
                   and c14_row.get("raw_same_sensor_5s") == len(raw_rows)
                   and c14_row.get("raw_same_sensor_and_state_5s") ==
                       sum(row["state_compatible"] is True for row in raw_rows)
                   and c14_row.get("ui_candidates_5s") == len(ui_rows)
                   and c13_row.get("nearby_ui_record_count") == len(ui_rows)
                   and c13_row.get("ui_event_classes") ==
                       dict(sorted(__import__("collections").Counter(
                           row["event_class"] for row in ui_rows).items()))
                   and c13_row.get("ui_target_classes") ==
                       dict(sorted(__import__("collections").Counter(
                           row["target_class"] for row in ui_rows).items())),
                   "HANDOFF_C13_C14_EPISODE_DRIFT")
        for row in raw_rows:
            raw_keys.add((row["source_member"], row["locator"]["record_number"]))
        for row in ui_rows:
            ui_keys.add((row["source_member"], row["locator"]["record_number"]))
        for row in video_rows:
            video_keys.add((row["source_member"], row["locator"]["source_event_key"]))
        raw_edges += len(raw_rows)
        ui_edges += len(ui_rows)
        video_edges += len(video_rows)
    source_rows = len(episodes) + len(raw_keys) + len(ui_keys)
    c12.ensure(c14_report.get("minimal_distinct_raw_rows_for_review") == len(raw_keys)
               and c14_report.get("minimal_distinct_ui_rows_for_review") == len(ui_keys)
               and c14_report.get("source_rows_to_review_total") == source_rows
               and c13_report.get("unique_ui_candidate_records_5s") == len(ui_keys)
               and c13_report.get("source_records_for_complete_candidate_review") ==
                   len(episodes) + len(ui_keys)
               and c14_report["c16_annotation_review_footprint"][
                   "review_baselines"]["reed_closed_after_video_end_5s"][
                       "annotations_to_review"] == len(video_keys),
               "HANDOFF_REVIEW_SCOPE_DRIFT")
    return {
        "status": "SOURCE_REVIEW_SCOPE_RECONCILED_NO_HUMAN_GOLD",
        "sensor_derived_episode_source_rows": len(episodes),
        "distinct_raw_reed_source_rows": len(raw_keys),
        "distinct_browser_ui_source_rows": len(ui_keys),
        "distinct_author_video_annotation_rows": len(video_keys),
        "source_rows_without_video": source_rows,
        "source_rows_including_video": source_rows + len(video_keys),
        "temporal_candidate_edges": {
            "raw_reed": raw_edges, "browser_ui": ui_edges,
            "author_video": video_edges},
        "cross_device_clock_calibration_proven": False,
        "human_gold": "NOT_MEASURED", "accepted_tasks": 0,
        "raw_source_event_identifiers_exported": False,
    }


def public_summary(packet, *, source_files=None):
    """Only closed classes and counts: no source ID, timestamp, actor or raw text."""
    c12.ensure(type(packet) is dict and packet.get("schema") == SCHEMA
               and packet.get("not_for_publication") is True
               and type(packet.get("episodes")) is list
               and packet.get("accepted_tasks") == 0, "HANDOFF_PACKET_HOLD")
    pins = packet.get("source_sha256")
    baselines = packet.get("video_baseline_counts")
    c12.ensure(type(pins) is dict and set(pins) == set(PINS)
               and all(type(v) is str and len(v) == 64
                       and all(ch in "0123456789abcdef" for ch in v)
                       for v in pins.values())
               and packet.get("pin_authority") in
                   ("PINNED_SOLVE4X", "CALLER_SUPPLIED_UNQUALIFIED")
               and (packet["pin_authority"] != "PINNED_SOLVE4X" or pins == PINS)
               and type(baselines) is dict and set(baselines) ==
                   {"all", "literal_enter_leave", "reed_closed_after_end_5s"}
               and all(type(v) is int and 0 <= v <= 10000
                       for v in baselines.values())
               and baselines["reed_closed_after_end_5s"] <=
                   baselines["literal_enter_leave"] <= baselines["all"]
               and packet.get("clock_calibration_proven") is False
               and packet.get("same_human_action_confirmed") is False
               and packet.get("permissions_attested") is False
               and packet.get("human_gold") == "NOT_MEASURED",
               "HANDOFF_PUBLIC_METADATA_HOLD")
    checked = False
    if source_files is not None:
        c12.ensure(type(source_files) is dict and set(source_files) == set(PINS),
                   "HANDOFF_REPLAY_SOURCE_SET_HOLD")
        replayed = prepare_owner_local(
            source_files[VIDEO], source_files[SENSOR],
            source_files[UI], source_files[REED],
            expected_pins=None if packet["pin_authority"] == "PINNED_SOLVE4X"
            else pins)
        c12.ensure(replayed == packet, "HANDOFF_REPLAY_MISMATCH")
        checked = True
    safe = []
    for ordinal, e in enumerate(packet["episodes"], 1):
        c12.ensure(type(e) is dict and e.get("sensor_class") in
                   {"ENTRANCE", "MOUSE_CUPBOARD", "KEYBOARD_CUPBOARD",
                    "CUPBOARD_UNRESOLVED", "UNKNOWN"}
                   and e.get("same_human_action") == "UNKNOWN"
                   and type(e.get("review_ordinal_not_original_id")) is int
                   and e["review_ordinal_not_original_id"] == ordinal
                   and e.get("temporal_uncertainty") == CLOCK
                   and e.get("task_hypothesis") == "NOT_QUALIFIED"
                   and type(e.get("accepted_tasks")) is int
                   and e["accepted_tasks"] == 0
                   and all(type(e.get(k)) is list for k in
                       ("raw_reed_candidates_5s", "browser_ui_candidates_5s",
                        "author_video_annotation_candidates_5s")),
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
    return {"schema": SCHEMA, "status": ("PUBLIC_SOURCE_RECORDS_REPLAY_VERIFIED" if checked
                       else "PUBLIC_UNVERIFIED_AGGREGATE"),
            "pin_authority": packet["pin_authority"],
            "source_sha256": dict(packet["source_sha256"]),
            "episode_count": len(safe), "episodes": safe,
            "video_baseline_counts": dict(packet["video_baseline_counts"]),
            "original_bytes_sha_verified": checked,
            "authorized_source_locator_publicly_available": False,
            "clock_calibration_proven": False, "same_human_action_confirmed": False,
            "human_gold": "NOT_MEASURED", "accepted_tasks": 0,
            "source_identifiers_timestamps_actor_or_values_exported": False}
