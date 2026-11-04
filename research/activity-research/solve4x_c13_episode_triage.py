#!/usr/bin/env python3
"""C13: review-ready redacted scene01 sensor episode gap characterization.

Time-only neighbors are not the same operation, independent human gold, or Tasks.
Never export original labels, IDs, timestamps, URLs or arbitrary source values.
"""
from __future__ import annotations
from collections import Counter
from io import StringIO
import csv
import re

import solve4x_cross_source_coverage as c12

SCHEMA = "IWXA_SOLVE4X_C13_SENSOR_UI_REVIEW/0.1"
WINDOW_SECONDS = 5


def _tokens(value):
    return set(re.findall(r"[a-z]+", value.casefold())) if isinstance(value, str) else set()


def sensor_category(label):
    """Closed candidate classes from published Solve4X ambient sensor docs."""
    tokens = _tokens(label)
    if "cupboard" in tokens or tokens & {"mouse", "keyboard"}:
        return "CUPBOARD_REED_SWITCH_CANDIDATE"
    if "door" in tokens or "entrance" in tokens:
        return "ENTRANCE_REED_SWITCH_CANDIDATE"
    if "shelf" in tokens or "distance" in tokens:
        return "DISTANCE_SHELF_CANDIDATE"
    if tokens & {"temperature", "humidity", "temp"}:
        return "TEMPERATURE_HUMIDITY_CANDIDATE"
    return "UNMAPPED_SENSOR_ACTIVITY"


def ui_category(value):
    t = _tokens(value)
    if "click" in t or "clicks" in t:
        return "MOUSE_CLICK"
    if t & {"key", "keys", "keyboard", "keypress", "keystroke",
            "typing", "type", "input"}:
        return "KEYBOARD_OR_TEXT_INPUT"
    if t & {"scroll", "scrolling", "wheel"}:
        return "SCROLL"
    if t & {"navigation", "navigate", "page", "load", "tab"}:
        return "PAGE_NAVIGATION"
    if t & {"paste", "copy", "clipboard"}:
        return "CLIPBOARD"
    return "UNMAPPED_BROWSER_EVENT"


def target_category(value):
    t = _tokens(value)
    if t & {"input", "textbox", "textarea", "select"}:
        return "FORM_FIELD"
    if "button" in t:
        return "BUTTON"
    if t & {"anchor", "link"}:
        return "LINK"
    return "UNMAPPED_TARGET"


def parse_ui_records(ui_csv):
    times = c12.ui_values(ui_csv)
    decoded = ui_csv.decode("utf-8-sig")
    first = decoded.splitlines()[0]
    delimiter = max((",", ";", "\t"), key=lambda x: (first.count(x), x))
    reader = csv.DictReader(StringIO(decoded), delimiter=delimiter)
    fields = reader.fieldnames or []
    c12.ensure(len(fields) == len(set(fields)) and "eventType" in fields,
               "UI_EVENTTYPE_FIELD_INVALID")
    rows = list(reader)
    c12.ensure(len(times) == len(rows) and all(
        None not in row and isinstance(row.get("eventType"), str)
        for row in rows), "UI_EVENTTYPE_ROWS_INVALID")
    target_field = next((field for field in (
        "context.elementType", "context_elementType", "elementType")
        if field in fields), None)
    result = []
    for i, row in enumerate(rows):
        result.append((
            times[i],
            ui_category(row["eventType"]),
            target_category(row.get(target_field)) if target_field else "UNMAPPED_TARGET",
            row["eventType"].strip().casefold(),
        ))
    return result


def analyze(video_doc, sensor_doc, ui_csv):
    intervals = c12.spans(video_doc)
    c12.ensure(isinstance(sensor_doc, dict) and
               isinstance(sensor_doc.get("ocel:events"), dict),
               "SENSOR_EVENTS_MISSING")
    events = sensor_doc["ocel:events"]
    c12.ensure(bool(events), "SENSOR_EVENTS_EMPTY")
    ui = parse_ui_records(ui_csv)
    outside = []
    for index, event in enumerate(events.values()):
        c12.ensure(isinstance(event, dict) and
                   isinstance(event.get("ocel:activity"), str),
                   "SENSOR_ACTIVITY_MISSING")
        t = c12.stamp(event.get("ocel:timestamp"))
        if not any(start <= t <= end for start, end in intervals):
            outside.append((t, index, event["ocel:activity"]))
    outside.sort(key=lambda record: (record[0], record[1]))
    episodes = []
    all_ui_candidates = set()
    outside_times = []
    for ordinal, (t, _, sensor_label) in enumerate(outside, start=1):
        matches = [i for i, (ut, _, _, _) in enumerate(ui)
                   if abs(ut - t) <= WINDOW_SECONDS]
        all_ui_candidates.update(matches)
        outside_times.append(t)
        kinds = Counter(ui[i][1] for i in matches)
        targets = Counter(ui[i][2] for i in matches)
        episodes.append({
            "review_ordinal": ordinal,
            "sensor_signal_class": sensor_category(sensor_label),
            "nearby_ui_record_count": len(matches),
            "ui_event_classes": dict(sorted(kinds.items())),
            "ui_target_classes": dict(sorted(targets.items())),
            "literal_activity_to_ui_eventtype_matches": sum(
                sensor_label.strip().casefold() == ui[i][3] for i in matches),
            "nearest_candidate_distance_band": (
                "WITHIN_1_SECOND" if matches and
                min(abs(ui[i][0] - t) for i in matches) <= 1 else
                "WITHIN_5_SECONDS" if matches else
                "NO_UI_CANDIDATE_5S"),
            "sensor_hardware_event_truth": "NOT_ATTESTED_AGAINST_RAW_SENSOR_TRACE",
            "same_human_action": "UNKNOWN",
            "task_hypothesis": "NOT_QUALIFIED",
        })
    edges = c12.pairing(outside_times, [r[0] for r in ui], WINDOW_SECONDS)
    sensitivity = c12.pairing(outside_times, [r[0] + 90 for r in ui],
                              WINDOW_SECONDS)
    day_control = c12.pairing(outside_times, [r[0] + 86400 for r in ui],
                              WINDOW_SECONDS)
    return {
        "schema": SCHEMA,
        "status": "REDACTED_SOURCE_REVIEW_EPISODES_NOT_TASKS",
        "sensor_total": len(events),
        "sensor_outside_video": len(outside),
        "episodes": episodes,
        "unique_ui_candidate_records_5s": len(all_ui_candidates),
        "one_to_one_time_only_upper_bound_5s": edges["one_to_one_upper_bound"],
        "ui_candidate_ambiguity_5s": {
            "edges": edges["candidate_edges"],
            "sensor_with_multiple_candidates": edges["ambiguous_sensor"],
            "ui_with_multiple_sensor_candidates": edges["ambiguous_ui"],
        },
        "plus_90_second_control_candidates_5s": sensitivity["candidate_edges"],
        "plus_one_day_control_candidates_5s": day_control["candidate_edges"],
        "source_records_for_complete_candidate_review":
            len(outside) + len(all_ui_candidates),
        "additional_source_scopes_needed": [
            "RAW_SENSOR_STATE_TRANSITIONS",
            "BROWSER_UI_TARGET_STATE",
            "CLOCK_DOMAIN_CALIBRATION",
        ],
        "manual_review_minutes": "NOT_MEASURED",
        "new_human_actions_confirmed": 0,
        "accepted_tasks": 0,
        "clock_synchronization_confirmed": False,
        "independent_human_ground_truth": "NOT_MEASURED",
        "false_confident_rate": "NOT_MEASURED",
        "correct_unknown_rate": "NOT_MEASURED",
        "raw_values_or_event_ids_exported": False,
    }
