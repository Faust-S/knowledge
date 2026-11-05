"""C16 source-bound annotation-duration and candidate-sensitivity metrics only.

Takes caller-provided original video OCEL events and sensor-derived episode tuples.
No Task/Result creation, media decoding, clock optimization or human-review claims.
"""
from __future__ import annotations
from datetime import datetime
import math

SCHEMA = 'IWXA_SOLVE4X_C16_ANNOTATION_REVIEW_FOOTPRINT/0.1'
DOOR_LABELS = {'enter room': 'ENTER_ROOM', 'leave room': 'LEAVE_ROOM'}
WINDOWS = (1, 5, 15)
SHIFTS = (1, -1, 5, -5, 90, 86400)
CONTEXT_SECONDS = 2

class Hold(ValueError):
    pass

def require(condition, code):
    if not condition:
        raise Hold(code)

def naive_timestamp(value):
    require(isinstance(value, str) and value.strip(), 'C16_TIMESTAMP_MISSING')
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        raise Hold('C16_TIMESTAMP_INVALID') from None
    require(dt.tzinfo is None, 'C16_CLOCK_DOMAIN_UNKNOWN')
    result = (dt - datetime(1970, 1, 1)).total_seconds()
    require(math.isfinite(result), 'C16_TIMESTAMP_NONFINITE')
    return result

def _rows(video_doc):
    require(type(video_doc) is dict and type(video_doc.get('ocel:events')) is dict,
            'C16_VIDEO_OCEL_MISSING')
    rows = []
    for item in video_doc['ocel:events'].values():
        require(type(item) is dict and type(item.get('ocel:vmap')) is dict,
                'C16_VIDEO_RECORD_INVALID')
        start = naive_timestamp(item.get('ocel:timestamp'))
        end = naive_timestamp(item['ocel:vmap'].get('end_time'))
        require(start <= end and end-start <= 86400, 'C16_VIDEO_DURATION_INVALID')
        label = item.get('ocel:activity')
        kind = DOOR_LABELS.get(' '.join(label.strip().casefold().split())) if isinstance(label, str) else None
        rows.append((start, end, kind))
    require(0 < len(rows) <= 10000, 'C16_VIDEO_EVENT_COUNT_INVALID')
    return rows

def _union_seconds(rows):
    if not rows:
        return 0.0
    intervals = sorted((a - CONTEXT_SECONDS, b + CONTEXT_SECONDS) for a,b,_ in rows)
    total, lo, hi = 0., *intervals[0]
    for a,b in intervals[1:]:
        if a <= hi:
            hi = max(hi,b)
        else:
            total += hi-lo
            lo,hi = a,b
    return total + hi-lo

def _cost(rows):
    return {
        'annotations_to_review':len(rows),
        'sum_of_annotated_interval_seconds': round(sum(b-a for a,b,_ in rows), 3),
        'union_seconds_with_two_second_context':round(_union_seconds(rows),3),
        'actual_human_review_seconds':None,
    }

def _selected(rows, door_times, window):
    return [row for row in rows if row[2] is not None and any(
        0 <= stamp-row[1] <= window for stamp in door_times)]

def analyze(video_doc, outside_sensor_events):
    all_rows = _rows(video_doc)
    door_rows = [r for r in all_rows if r[2] is not None]
    # The same numeric values have a shared calendar representation, but not
    # independent proof that video and reed-device clocks were calibrated.
    closed = []
    require(type(outside_sensor_events) is list, 'C16_SENSOR_SCOPE_INVALID')
    for item in outside_sensor_events:
        require(type(item) is tuple and len(item) == 3,
                'C16_SENSOR_EVENT_TYPE_INVALID')
        t, sensor, state = item
        require(type(t) in (float,int) and type(t) is not bool and math.isfinite(t),
                'C16_SENSOR_TIME_INVALID')
        if sensor == 'ENTRANCE' and state == 'CLOSED':
            closed.append(float(t))
    full, label_only = _cost(all_rows), _cost(door_rows)
    selection = {f'{window}s':_cost(_selected(door_rows,closed,window)) for window in WINDOWS}
    for window in WINDOWS:
        match_per_closing = [sum(0 <= stamp-row[1] <= window for row in door_rows) for stamp in closed]
        selection[f'{window}s']['closing_events_without_candidate'] = sum(n==0 for n in match_per_closing)
        selection[f'{window}s']['closing_events_with_ambiguous_candidates'] = sum(n>1 for n in match_per_closing)
    shifts = {f'{shift:+d}s':_cost(_selected(door_rows,[t+shift for t in closed],5))['annotations_to_review'] for shift in SHIFTS}
    focused = selection['5s']
    return {
        'schema':SCHEMA,
        'status':'AUTHOR_ANNOTATION_DURATION_PROXY_NOT_OBSERVED_REVIEW_TIME',
        'denominators':{
            'video_annotation_total':len(all_rows),
            'literal_enter_leave_annotations':len(door_rows),
            'out_of_video_door_closings':len(closed),
        },
        'review_baselines':{
            'all_published_video_annotations':full,
            'literal_enter_leave_labels_only':label_only,
            'reed_closed_after_video_end_5s':focused,
        },
        'fixed_window_selection':selection,
        'predeclared_offset_sensitivity_candidate_counts_5s':shifts,
        'annotation_count_reduction_full_to_label':len(all_rows)-len(door_rows),
        'annotation_count_reduction_label_to_focused':len(door_rows)-focused['annotations_to_review'],
        'annotation_count_reduction_full_to_focused':len(all_rows)-focused['annotations_to_review'],
        'human_effort_seconds_delta':None,
        'human_cost_savings':None,
        'reviewer_gains_measured':False,
        'source_annotation_labels_are_independent_human_gold':False,
        'clock_calibration_proven':False,
        'source_level_false_confident_rate':'NOT_MEASURED',
        'correct_unknown_rate':'NOT_MEASURED',
        'accepted_tasks':0,
        'raw_event_ids_timestamps_actor_ids_or_values_exported':False,
    }
