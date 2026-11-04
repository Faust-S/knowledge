#!/usr/bin/env python3
"""C14: compare source reed-switch transitions with C13 sensor review episodes.

Raw recorder consistency is not human-action truth or calibrated cross-device
clock evidence. Export only closed-vocabulary classes, counts and source hashes.
"""
from __future__ import annotations
from collections import Counter
from io import StringIO
import csv
import re

import solve4x_cross_source_coverage as c12
import solve4x_c13_episode_triage as c13

SCHEMA = "IWXA_SOLVE4X_C14_RAW_REED_EPISODE_REVIEW/0.1"
RAW_REED = "scene01/scene01_reed_switches.csv"
WINDOWS = (1, 5)
ALLOWED_SENSORS = {
    "reed_switch_door": "ENTRANCE",
    "reed_switch_mouse_cupboard": "MOUSE_CUPBOARD",
    "reed_switch_keyboard_cupboard": "KEYBOARD_CUPBOARD",
}
STATE_TOKENS = {
    "reed_switch_opened": "OPENED", "reed_switch_closed": "CLOSED",
    "opened": "OPENED", "closed": "CLOSED",
}


def _word_tokens(value):
    return set(re.findall(r"[a-z]+", value.casefold())) if isinstance(value, str) else set()


def _meaning_of_sensor_event(activity):
    """Whitelisted interpretation, not a physical observation."""
    category = c13.sensor_category(activity)
    sensor = ("ENTRANCE" if category == "ENTRANCE_REED_SWITCH_CANDIDATE"
              else "CUPBOARD_UNRESOLVED" if
              category == "CUPBOARD_REED_SWITCH_CANDIDATE" else "UNKNOWN")
    tokens = _word_tokens(activity)
    opened = bool(tokens & {"open", "opened", "opening"})
    closed = bool(tokens & {"close", "closed", "closing"})
    state = ("OPENED" if opened and not closed else
             "CLOSED" if closed and not opened else "UNKNOWN")
    return sensor, state


def parse_raw_reed(raw):
    c12.ensure(type(raw) is bytes and 0 < len(raw) <= 131072, "RAW_REED_BOUNDS_HOLD")
    try:
        source = raw.decode("utf-8-sig")
    except UnicodeError:
        raise c12.Hold("RAW_REED_ENCODING_HOLD") from None
    lines = source.splitlines()
    c12.ensure(bool(lines), "RAW_REED_EMPTY")
    delim = max((",", ";", "\t"), key=lambda c: (lines[0].count(c), c))
    c12.ensure(lines[0].count(delim) > 0, "RAW_REED_DELIMITER_HOLD")
    reader = csv.DictReader(StringIO(source), delimiter=delim, skipinitialspace=True)
    fields = [f.strip() if isinstance(f, str) else f for f in (reader.fieldnames or [])]
    c12.ensure(len(fields) == len(set(fields)), "RAW_REED_DUPLICATE_FIELDS")
    c12.ensure({"time", "reed_switch", "reed_switch_state"}.issubset(fields),
               "RAW_REED_SCHEMA_HOLD")
    reader.fieldnames = fields
    rows = list(reader)
    c12.ensure(0 < len(rows) <= 10000, "RAW_REED_ROWS_HOLD")
    result = []
    for row in rows:
        c12.ensure(None not in row and all(isinstance(row.get(k), str)
                   and row[k].strip() for k in
                   ("time", "reed_switch", "reed_switch_state")),
                   "RAW_REED_ROW_ARITY_HOLD")
        sensor = ALLOWED_SENSORS.get(row["reed_switch"].strip().lower(), "UNKNOWN")
        state = STATE_TOKENS.get(row["reed_switch_state"].strip().lower(), "UNKNOWN")
        result.append((c12.stamp(row["time"].strip()), sensor, state))
    return result


def _outside_video_events(video_doc, sensor_doc):
    intervals = c12.spans(video_doc)
    c12.ensure(isinstance(sensor_doc, dict) and
               isinstance(sensor_doc.get("ocel:events"), dict),
               "SENSOR_OCEL_HOLD")
    outside = []
    for event in sensor_doc["ocel:events"].values():
        c12.ensure(isinstance(event, dict) and
                   isinstance(event.get("ocel:activity"), str),
                   "SENSOR_ACTIVITY_HOLD")
        time = c12.stamp(event.get("ocel:timestamp"))
        if not any(a <= time <= b for a, b in intervals):
            sensor, state = _meaning_of_sensor_event(event["ocel:activity"])
            outside.append((time, sensor, state))
    outside.sort(key=lambda e: (e[0], e[1], e[2]))
    return outside


def _context_flags(row):
    def filled(field):
        value = row.get(field)
        return isinstance(value, str) and bool(value.strip())
    return {
        "has_dom_path": filled("domPath"),
        "has_target_element_type": filled("context.elementType"),
        "has_target_element_id": filled("context.elementId"),
        "has_target_input_type": filled("context.inputType"),
        "has_active_url": filled("url"),
        "has_target_value": filled("context.elementValue"),
    }


def parse_ui_context(ui_raw):
    times = c12.ui_values(ui_raw)
    source = ui_raw.decode("utf-8-sig")
    header = source.splitlines()[0]
    delimiter = max((",", ";", "\t"), key=lambda c: (header.count(c), c))
    reader = csv.DictReader(StringIO(source), delimiter=delimiter, skipinitialspace=True)
    fields = reader.fieldnames or []
    c12.ensure("eventType" in fields and len(fields) == len(set(fields)),
               "UI_EVENT_SCHEMA_HOLD")
    rows = list(reader)
    c12.ensure(len(rows) == len(times) and all(None not in r for r in rows),
               "UI_CONTEXT_ARITY_HOLD")
    return [(time, _context_flags(row), c13.ui_category(row.get("eventType", "")))
            for time, row in zip(times, rows)]


def _compatibles(episode, record, window, *, require_state):
    left_time, left_sensor, left_state = episode
    raw_time, raw_sensor, raw_state = record
    if (left_sensor not in {"ENTRANCE", "MOUSE_CUPBOARD", "KEYBOARD_CUPBOARD"}
            or raw_sensor == "UNKNOWN" or abs(left_time - raw_time) > window
            or raw_sensor != left_sensor):
        return False
    if require_state:
        return (left_state != "UNKNOWN" and raw_state != "UNKNOWN" and
                left_state == raw_state)
    return True


def _counts(episodes, raw, *, window, require_state):
    edges = [[j for j, record in enumerate(raw) if _compatibles(e, record,
              window, require_state=require_state)] for e in episodes]
    raw_degree = Counter(j for row in edges for j in row)
    assigned = {}

    def augment(i, seen):
        for j in sorted(edges[i], key=lambda j: (abs(episodes[i][0] - raw[j][0]), j)):
            if j in seen:
                continue
            seen.add(j)
            if j not in assigned or augment(assigned[j], seen):
                assigned[j] = i
                return True
        return False

    for i in sorted(range(len(episodes)), key=lambda i: (len(edges[i]), i)):
        augment(i, set())
    return {
        "episodes_with_raw_candidates": sum(bool(row) for row in edges),
        "distinct_raw_candidates": len(raw_degree),
        "candidate_edges": sum(map(len, edges)),
        "episodes_with_multiple_raw_candidates": sum(len(row) > 1 for row in edges),
        "raw_candidates_for_multiple_episodes": sum(v > 1 for v in raw_degree.values()),
        "one_to_one_upper_bound": len(assigned),
    }


def analyze(video_doc, sensor_doc, ui_csv, raw_reed_csv):
    original = _outside_video_events(video_doc, sensor_doc)
    ui = parse_ui_context(ui_csv)
    raw = parse_raw_reed(raw_reed_csv)
    c13_report = c13.analyze(video_doc, sensor_doc, ui_csv)
    c12.ensure(len(original) == c13_report["sensor_outside_video"],
               "REVIEW_SCOPE_DISAGREES_C13")
    strict = {str(window) + "s": _counts(original, raw, window=window,
                                        require_state=True) for window in WINDOWS}
    location_only = {str(window) + "s": _counts(original, raw, window=window,
                                               require_state=False) for window in WINDOWS}
    plus_90 = _counts([(t + 90, loc, state) for t, loc, state in original], raw,
                      window=5, require_state=True)
    plus_day = _counts([(t + 86400, loc, state) for t, loc, state in original], raw,
                       window=5, require_state=True)
    per_episode = []
    needed_ui = set()
    needed_raw = set()
    for ordinal, (t, location, state) in enumerate(original, 1):
        ui_near = [i for i, (stamp, _, _) in enumerate(ui) if abs(t - stamp) <= 5]
        raw_near = [j for j, record in enumerate(raw)
                    if _compatibles((t, location, state), record,
                                    5, require_state=True)]
        raw_place = [j for j, record in enumerate(raw)
                     if _compatibles((t, location, state), record,
                                     5, require_state=False)]
        needed_ui.update(ui_near)
        needed_raw.update(raw_place)
        states = Counter(raw[j][2] for j in raw_place)
        ui_flags = Counter(k for i in ui_near for k, value in ui[i][1].items() if value)
        per_episode.append({
            "review_ordinal": ordinal,
            "sensor_class": location,
            "ocel_state_class": state,
            "raw_same_sensor_5s": len(raw_place),
            "raw_same_sensor_and_state_5s": len(raw_near),
            "raw_state_classes": dict(sorted(states.items())),
            "ui_candidates_5s": len(ui_near),
            "ui_context_populated_field_counts": dict(sorted(ui_flags.items())),
            "source_record_matches_human_action": False,
            "same_human_action": "UNKNOWN",
            "task_proposal": "NOT_QUALIFIED",
        })
    consecutive_state_repeats = 0
    last_by_sensor = {}
    for _, sensor_name, state in raw:
        if sensor_name == "UNKNOWN" or state == "UNKNOWN":
            continue
        consecutive_state_repeats += int(last_by_sensor.get(sensor_name) == state)
        last_by_sensor[sensor_name] = state
    timestamp_backwards = sum(raw[i][0] < raw[i-1][0] for i in range(1, len(raw)))
    return {
        "schema": SCHEMA,
        "status": "RAW_REED_SOURCE_DESCRIPTIVE_COMPARISON",
        "denominators": {
            "raw_reed_rows": len(raw),
            "raw_door_rows": sum(loc == "ENTRANCE" for _, loc, _ in raw),
            "outside_video_sensor_events": len(original),
            "browser_ui_rows": len(ui),
        },
        "raw_sensor_classes": dict(sorted(Counter(loc for _, loc, _ in raw).items())),
        "raw_state_classes": dict(sorted(Counter(state for _, _, state in raw).items())),
        "raw_timestamps_out_of_order": timestamp_backwards,
        "adjacent_repeated_sensor_states": consecutive_state_repeats,
        "time_and_sensor_only": location_only,
        "time_sensor_and_state": strict,
        "sensor_plus_90_seconds_sensitivity": plus_90,
        "sensor_plus_one_day_negative": plus_day,
        "review_episodes": per_episode,
        "minimal_distinct_raw_rows_for_review": len(needed_raw),
        "minimal_distinct_ui_rows_for_review": len(needed_ui),
        "source_rows_to_review_total": len(original) + len(needed_raw) + len(needed_ui),
        "limitations": {
            "internal_derived_log_consistency_not_independent_physical_truth": True,
            "cross_device_clock_calibration_proven": False,
            "ui_time_proximity_is_same_action": False,
            "human_activity_gold": "NOT_MEASURED",
            "false_confident_rate": "NOT_MEASURED",
            "correct_unknown_rate": "NOT_MEASURED",
            "human_review_minutes": "NOT_MEASURED",
            "accepted_tasks": 0,
        },
        "raw_values_or_identifiers_exported": False,
    }
