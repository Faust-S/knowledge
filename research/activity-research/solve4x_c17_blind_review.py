#!/usr/bin/env python3
"""C17: owner-local blinded video review plan and aggregate-only scoring.

Reuses C16 selection. Never downloads/decodes video, invents human reviews,
creates Tasks, or treats author OCEL labels as independent human truth.
The private packet contains original source locators and must stay owner-local.
Only public_plan() and score() are suitable for publishing as aggregates.
"""
from __future__ import annotations

import hashlib
import json
import math
import re

import solve4x_c16_review_footprint as c16

SCHEMA = 'IWXA_SOLVE4X_C17_BLIND_VIDEO_REVIEW/0.1'
RECEIPT = 'IWXA_SOLVE4X_C17_OWNER_LOCAL_REVIEW_RECEIPT/0.1'
ARMS = ('all', 'literal_enter_leave', 'reed_closed_after_end_5s')
ROLES = ('reference_a', 'reference_b', 'adjudicator', 'arm_all',
         'arm_literal_enter_leave', 'arm_reed_closed_after_end_5s')
VERDICTS = frozenset(('VISIBLE_ENTER_OR_EXIT', 'NOT_VISIBLE', 'UNKNOWN'))
SOURCE_SHA = '619f52a0fb845926790388008b505fff5969adcd25cac31f0bb0e62d01980e99'
CONTEXT_SECONDS = c16.CONTEXT_SECONDS
HEX64 = re.compile(r'[a-f0-9]{64}\Z')


class ReviewHold(ValueError):
    """Fixed rejection code; do not include source text or reviewer identity."""


def require(ok, code):
    if not ok:
        raise ReviewHold(code)


def _digest(obj):
    try:
        canonical = json.dumps(obj, ensure_ascii=False, sort_keys=True,
                               separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, OverflowError, RecursionError):
        # A malformed private packet must HOLD with a fixed code. Never
        # print an owner event/key or an exception containing private data.
        raise ReviewHold('C17_FROZEN_PLAN_INVALID') from None
    return hashlib.sha256(canonical).hexdigest()


def _blank_blind_tasks(arms):
    """Deterministic reviewer tasks; never copy private media or author labels."""
    return {
        role: [{'clip_id': clip_id, 'media_locator': None}
               for clip_id in arms['all' if role.startswith('reference_') or
                                   role == 'adjudicator' else role.removeprefix('arm_')]]
        for role in ROLES
    }


def prepare(video_doc, outside_sensor_events, *, source_sha256=SOURCE_SHA):
    """Create a private index + blinded task IDs; no media or human values.

    The caller must verify source bytes against source_sha256 before this call.
    Event keys/time coordinates are used only in owner_index, never public_plan.
    """
    require(type(source_sha256) is str and HEX64.fullmatch(source_sha256),
            'C17_SOURCE_SHA_INVALID')
    footprint = c16.analyze(video_doc, outside_sensor_events)
    rows = c16._rows(video_doc)
    events = video_doc['ocel:events']
    require(len(rows) == len(events) and
            all(type(key) is str and key for key in events),
            'C17_SOURCE_EVENT_KEYS_INVALID')
    pairs = sorted(zip(events.items(), rows),
                   key=lambda pair: (pair[1][0], pair[1][1],
                                     pair[1][2] or '', pair[0][0]))
    closed = [float(t) for t, sensor, state in outside_sensor_events
              if sensor == 'ENTRANCE' and state == 'CLOSED']
    index = []
    arms = {name: [] for name in ARMS}
    for ordinal, ((source_key, event), (start, end, kind)) in enumerate(pairs, 1):
        label_only = kind is not None
        focused = label_only and any(0 <= t - end <= 5 for t in closed)
        clip_id = f'clip-{ordinal:04d}'
        # Intentionally no author label, actor ID or sensor explanation in
        # blinded tasks. Exact event keys and timestamps stay owner-local.
        index.append({'clip_id': clip_id, 'source_event_key': source_key,
                      'annotation_start': event['ocel:timestamp'],
                      'annotation_end': event['ocel:vmap']['end_time'],
                      'author_label_family': kind or 'OTHER',
                      'selected_in': [name for name, select in zip(
                          ARMS, (True, label_only, focused)) if select]})
        arms['all'].append(clip_id)
        if label_only:
            arms['literal_enter_leave'].append(clip_id)
        if focused:
            arms['reed_closed_after_end_5s'].append(clip_id)
    expected = footprint['review_baselines']
    require((len(arms['all']) == expected['all_published_video_annotations']['annotations_to_review']
             and len(arms['literal_enter_leave']) ==
             expected['literal_enter_leave_labels_only']['annotations_to_review']
             and len(arms['reed_closed_after_end_5s']) ==
             expected['reed_closed_after_video_end_5s']['annotations_to_review']),
            'C17_C16_SELECTION_DRIFT')
    frozen = {'source_sha256': source_sha256, 'context_seconds': CONTEXT_SECONDS,
              'owner_index': index, 'arms': arms}
    return {'schema': SCHEMA,
            'status': 'OWNER_LOCAL_PACKET_NOT_HUMAN_GOLD',
            'plan_sha256': _digest(frozen), **frozen,
            'blind_tasks': _blank_blind_tasks(arms),
            'not_for_publication': True}


def _verified_packet(packet):
    require(type(packet) is dict and packet.get('schema') == SCHEMA and
            packet.get('status') == 'OWNER_LOCAL_PACKET_NOT_HUMAN_GOLD' and
            packet.get('not_for_publication') is True and
            type(packet.get('owner_index')) is list and
            type(packet.get('arms')) is dict and
            type(packet.get('plan_sha256')) is str and
            type(packet.get('source_sha256')) is str and
            packet.get('context_seconds') == CONTEXT_SECONDS,
            'C17_PACKET_INVALID')
    frozen = {k: packet[k] for k in ('source_sha256', 'context_seconds',
                                    'owner_index', 'arms')}
    require(HEX64.fullmatch(packet['source_sha256']) and
            _digest(frozen) == packet['plan_sha256'],
            'C17_PACKET_FINGERPRINT_MISMATCH')
    index, arms = packet['owner_index'], packet['arms']
    require(0 < len(index) <= 10000 and set(arms) == set(ARMS),
            'C17_PACKET_SCOPE_INVALID')
    # Validate the private index BEFORE extracting IDs, making sets or
    # constructing derived blind tasks. A corrupt JSON packet must return
    # ReviewHold, not an unhandled TypeError/KeyError or traceback.
    expected_fields = {
        'clip_id', 'source_event_key', 'annotation_start', 'annotation_end',
        'author_label_family', 'selected_in'}
    require(all(
        type(row) is dict and set(row) == expected_fields and
        type(row['clip_id']) is str and
        type(row['source_event_key']) is str and bool(row['source_event_key']) and
        type(row['annotation_start']) is str and bool(row['annotation_start']) and
        type(row['annotation_end']) is str and bool(row['annotation_end']) and
        row['author_label_family'] in ('ENTER_ROOM', 'LEAVE_ROOM', 'OTHER') and
        type(row['selected_in']) is list and
        all(type(k) is str and k in ARMS for k in row['selected_in']) and
        len(set(row['selected_in'])) == len(row['selected_in'])
        for row in index),
        'C17_PACKET_INDEX_INVALID')
    ids = [row['clip_id'] for row in index]
    require(len(set(ids)) == len(index) and
            ids == [f'clip-{i:04d}' for i in range(1, len(index)+1)],
            'C17_PACKET_CLIP_IDS_INVALID')
    require(all(type(v) is list and
                all(type(k) is str and k in ids for k in v) and
                len(v) == len(set(v)) for v in arms.values()) and
            arms['all'] == ids and
            all(arms[name] == [row['clip_id'] for row in index
                              if name in row['selected_in']] for name in ARMS),
            'C17_PACKET_ARMS_INVALID')
    # The original plan digest covers owner_index and arms. The derived,
    # unblinded task inventory must match those frozen arms exactly; otherwise
    # it could silently reorder/drop or add clips without changing plan_sha256.
    require(packet.get('blind_tasks') == _blank_blind_tasks(arms),
            'C17_BLIND_TASKS_DRIFT')
    return ids, arms


def public_plan(packet):
    """Safe to include in the existing aggregate-only C12/C14 report."""
    ids, arms = _verified_packet(packet)
    return {
        'schema': SCHEMA,
        'status': 'BLIND_REVIEW_DESIGN_READY_NO_MEDIA_OR_HUMAN_MEASUREMENT',
        'source_sha256': packet['source_sha256'],
        'source_bytes_verified_by_c17': False,
        'frozen_plan_sha256': packet['plan_sha256'],
        'denominators': {'video_annotations': len(ids),
                         'literal_enter_leave': len(arms['literal_enter_leave']),
                         'reed_focused': len(arms['reed_closed_after_end_5s'])},
        'independent_video_reviews': 0,
        'adjudicated_clips': 0,
        'active_review_seconds': None,
        'label_studio_lead_time_seconds': None,
        'missed_visible_clips': None,
        'unknown_agreement_rate': None,
        'contradicted_confident_claims': None,
        'clock_calibration_proven': False,
        'source_author_labels_are_human_gold': False,
        'real_video_decoded': False,
        'human_activity_gold': 'NOT_MEASURED',
        'task_precision': None,
        'accepted_tasks': 0,
        'source_identifiers_times_actors_or_verdicts_exported': False,
    }


def public_media_window_sanity(packet, *, assumed_scene_start,
                               declared_media_duration_seconds):
    """Read-only screen of planned review windows against *claimed* media time.

    The origin and duration are external metadata, not synchronized camera
    frames. Never generate clips or promote this check to media verification.
    The output contains counts only: no owner event IDs or timestamps.
    """
    ids, arms = _verified_packet(packet)
    require(type(declared_media_duration_seconds) in (int, float) and
            math.isfinite(declared_media_duration_seconds) and
            0 < declared_media_duration_seconds <= 86400,
            'C17_MEDIA_DURATION_INVALID')
    try:
        origin = c16.naive_timestamp(assumed_scene_start)
    except c16.Hold:
        raise ReviewHold('C17_MEDIA_ASSUMED_ORIGIN_INVALID') from None
    flags = {}
    max_left, max_right = 0.0, 0.0
    for row in packet['owner_index']:
        try:
            begin = c16.naive_timestamp(row['annotation_start'])
            end = c16.naive_timestamp(row['annotation_end'])
        except c16.Hold:
            raise ReviewHold('C17_MEDIA_ANNOTATION_TIME_INVALID') from None
        require(begin <= end and end - begin <= 86400,
                'C17_MEDIA_ANNOTATION_INTERVAL_INVALID')
        lower = begin - origin - CONTEXT_SECONDS
        upper = end - origin + CONTEXT_SECONDS
        leading = max(0.0, -lower)
        trailing = max(0.0, upper - declared_media_duration_seconds)
        max_left = max(max_left, leading)
        max_right = max(max_right, trailing)
        flags[row['clip_id']] = (leading > 0, trailing > 0)
    require(len(flags) == len(ids), 'C17_MEDIA_CLIP_SCOPE_DRIFT')
    scope = {}
    for method in ARMS:
        selected = arms[method]
        scope[method] = {
            'selected_annotations': len(selected),
            'outside_declared_video_bounds': sum(
                any(flags[clip_id]) for clip_id in selected),
            'leading_context_outside_bounds': sum(
                flags[clip_id][0] for clip_id in selected),
            'trailing_context_outside_bounds': sum(
                flags[clip_id][1] for clip_id in selected),
        }
    return {
        'schema': SCHEMA,
        'status': 'PUBLISHED_MEDIA_METADATA_WINDOW_SCREEN_NOT_VIDEO_ALIGNMENT',
        'method': 'OWNER_INDEX_WITH_EXTERNAL_UNCALIBRATED_MEDIA_ORIGIN',
        'source_sha256': packet['source_sha256'],
        'frozen_plan_sha256': packet['plan_sha256'],
        'declared_video_duration_seconds': round(
            float(declared_media_duration_seconds), 6),
        'context_seconds_each_side': CONTEXT_SECONDS,
        'method_window_counts': scope,
        'max_leading_overhang_seconds': round(max_left, 3),
        'max_trailing_overhang_seconds': round(max_right, 3),
        'media_video_bytes_verified': False,
        'camera_frame_to_ocel_clock_calibrated': False,
        'camera_origin_independently_attested': False,
        'original_media_permissions_attested': False,
        'video_clips_prepared_or_reviewed': False,
        'independent_human_gold': 'NOT_MEASURED',
        'accepted_tasks': 0,
        'ready_for_human_review': False,
        'source_event_ids_timestamps_and_media_paths_exported': False,
    }


# The pinned central-directory SHA is a provenance locator, NOT a media
# content SHA. C17 does not silently promote ZIP CRC into independent proof.
SOLVE4X_ZIP_CENTRAL_SHA256 = (
    'bd47f03d561c6468d77df80ec8f920a3dd65502987440abf8a25dacaeb16c5b5')

# Independently captured from two successful pinned Solve4X ZIP-range
# central-directory replays. A caller-controlled JSON index that merely
# repeats the central SHA cannot prove its own member CRC/size/offset.
# Pin the exact original MP4 member tuple before examining any local video.
SOLVE4X_SCENE01_MP4_PIN = {
    'name': 'scene01/scene01.mp4',
    'compressed_bytes': 86978890,
    'uncompressed_bytes': 87053127,
    'compression_method': 8,
    'zip_crc32': '81b9100c',
    'zip_local_header_offset': 13914870,
}


def verify_owner_local_media(packet, media_file, zip_index, *,
                             expected_plan_sha256, assumed_scene_start,
                             declared_video_duration_seconds,
                             expected_media_sha256=None):
    """Owner-local MP4 byte/probe gate against the pinned ZIP central index.

    Never downloads media, exports frame/audio, calibrates a camera clock or
    creates review clips. If the independent media SHA is unavailable, CRC and
    size are ONLY weak archive-member consistency checks.
    """
    import os
    from pathlib import Path
    import stat
    import subprocess
    import zlib

    require_precommitted_plan(packet, expected_plan_sha256)
    require(type(zip_index) is dict and
            zip_index.get('schema') == 'IWXA_SOLVE4X_ZIP_RANGE_INDEX/0.1' and
            zip_index.get('status') ==
                'ZIP_RANGE_INDEX_ONLY_NOT_MULTIMODAL_REPLAY' and
            type(zip_index.get('source')) is dict and
            zip_index['source'].get('central_sha256') ==
                SOLVE4X_ZIP_CENTRAL_SHA256 and
            type(zip_index.get('target_files')) is list,
            'C17_MEDIA_INDEX_NOT_PINNED')
    candidates = [e for e in zip_index['target_files']
                  if type(e) is dict and e.get('name') in
                  ('scene01/scene01.mp4', 'solve4x/scene01/scene01.mp4')]
    require(len(candidates) == 1, 'C17_MEDIA_ZIP_MEMBER_UNRESOLVED')
    member = candidates[0]
    require(all(member.get(field) == expected
                for field, expected in SOLVE4X_SCENE01_MP4_PIN.items()),
            'C17_MEDIA_MEMBER_PIN_DRIFT')
    expected_bytes = member.get('uncompressed_bytes')
    expected_crc32 = member.get('zip_crc32')
    require(member.get('compression_method') in (0, 8) and
            type(expected_bytes) is int and
            0 < expected_bytes <= 128 * 1024 * 1024 and
            type(expected_crc32) is str and
            re.fullmatch('[0-9a-f]{8}', expected_crc32) is not None,
            'C17_MEDIA_INDEX_ENTRY_INVALID')
    require(type(declared_video_duration_seconds) in (int, float) and
            math.isfinite(declared_video_duration_seconds) and
            0 < declared_video_duration_seconds <= 86400,
            'C17_MEDIA_DURATION_INVALID')
    require(expected_media_sha256 is None or
            (type(expected_media_sha256) is str and
             HEX64.fullmatch(expected_media_sha256) is not None),
            'C17_MEDIA_SHA_PIN_INVALID')
    require(isinstance(media_file, (str, Path)), 'C17_MEDIA_PATH_INVALID')
    try:
        target = Path(media_file).expanduser()
        repo_root = Path(__file__).resolve().parents[2]
        absolute = target.resolve(strict=True)
        require(not target.is_symlink() and
                absolute != repo_root and repo_root not in absolute.parents,
                'C17_MEDIA_PATH_INVALID')
        with target.open('rb') as stream:
            before = os.fstat(stream.fileno())
            require(stat.S_ISREG(before.st_mode) and
                    before.st_size == expected_bytes,
                    'C17_MEDIA_SIZE_OR_TYPE_MISMATCH')
            media_sha = hashlib.sha256()
            crc = 0
            size = 0
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                media_sha.update(chunk)
                crc = zlib.crc32(chunk, crc)
                size += len(chunk)
                require(size <= expected_bytes,
                        'C17_MEDIA_SIZE_OR_TYPE_MISMATCH')
            after = os.fstat(stream.fileno())
    except OSError:
        raise ReviewHold('C17_MEDIA_SOURCE_UNAVAILABLE') from None
    require(size == expected_bytes and
            all(getattr(before, field) == getattr(after, field)
                for field in ('st_dev', 'st_ino', 'st_size',
                              'st_mtime_ns', 'st_ctime_ns')),
            'C17_MEDIA_SOURCE_CHANGED')
    digest = media_sha.hexdigest()
    require(f'{crc:08x}' == expected_crc32, 'C17_MEDIA_CRC_MISMATCH')
    require(expected_media_sha256 is None or digest == expected_media_sha256,
            'C17_MEDIA_SHA_MISMATCH')
    # FFprobe opens the filename independently from the SHA/CRC stream.
    # Detect an atomic replacement or in-place rewrite before/after probing:
    # otherwise SHA could describe file A while duration describes file B.
    def _require_same_media_file():
        try:
            current = os.stat(absolute, follow_symlinks=False)
        except OSError:
            raise ReviewHold('C17_MEDIA_SOURCE_CHANGED') from None
        require(stat.S_ISREG(current.st_mode) and
                all(getattr(before, field) == getattr(current, field)
                    for field in ('st_dev', 'st_ino', 'st_size',
                                  'st_mtime_ns', 'st_ctime_ns')),
                'C17_MEDIA_SOURCE_CHANGED')

    _require_same_media_file()
    try:
        process = subprocess.run([
            'ffprobe', '-v', 'error', '-show_entries',
            'format=duration:stream=codec_type,codec_name,r_frame_rate',
            '-of', 'json', str(absolute)],
            capture_output=True, timeout=35, check=False)
    except (OSError, subprocess.TimeoutExpired):
        _require_same_media_file()
        raise ReviewHold('C17_MEDIA_FFPROBE_UNAVAILABLE') from None
    _require_same_media_file()
    require(process.returncode == 0 and
            0 < len(process.stdout) <= 65536, 'C17_MEDIA_FFPROBE_FAILED')
    try:
        descriptor = json.loads(process.stdout)
        duration = float(descriptor['format']['duration'])
        videos = [stream for stream in descriptor.get('streams', [])
                  if type(stream) is dict and
                  stream.get('codec_type') == 'video']
    except (ValueError, TypeError, KeyError, OverflowError):
        raise ReviewHold('C17_MEDIA_FFPROBE_INVALID') from None
    require(math.isfinite(duration) and duration > 0 and
            len(videos) >= 1, 'C17_MEDIA_FFPROBE_INVALID')
    require(abs(duration - declared_video_duration_seconds) <= 0.1,
            'C17_MEDIA_DECLARED_DURATION_DRIFT')
    window_screen = public_media_window_sanity(
        packet, assumed_scene_start=assumed_scene_start,
        declared_media_duration_seconds=duration)
    _require_same_media_file()
    return {
        'schema': 'IWXA_SOLVE4X_C17_MEDIA_LOCAL_VERIFICATION/0.1',
        'status': 'OWNER_LOCAL_MEDIA_CRC_SIZE_PROBE_PASS_CLOCK_UNKNOWN',
        'source_zip_central_sha256': SOLVE4X_ZIP_CENTRAL_SHA256,
        'media_file_bytes': size,
        'media_file_sha256': digest,
        'matches_pinned_zip_index_size_and_crc': True,
        'matches_explicitly_supplied_media_sha256':
            expected_media_sha256 is not None,
        'archive_content_sha_independently_attested': False,
        'zip_index_retrieved_live_by_c17': False,
        'ffprobe_duration_seconds': round(duration, 6),
        'ffprobe_video_stream_count': len(videos),
        'ffprobe_video_codec_names':
            sorted(set(str(stream.get('codec_name', 'UNKNOWN'))
                       for stream in videos)),
        'media_window_screen': window_screen,
        'media_to_ocel_clock_calibrated': False,
        'independent_camera_start_attested': False,
        'media_permissions_attested': False,
        'actual_human_review_seconds': None,
        'human_gold': 'NOT_MEASURED',
        'accepted_tasks': 0,
        'ready_for_human_review': False,
        'media_paths_frames_audio_or_source_keys_exported': False,
    }


def require_precommitted_plan(packet, expected_plan_sha256):
    """Check a separately retained owner-local plan SHA before review.

    The expected value must have been frozen before reviewers saw clips.
    This check does not authenticate reviewers, source video or human gold.
    """
    _verified_packet(packet)
    require(type(expected_plan_sha256) is str and
            HEX64.fullmatch(expected_plan_sha256) is not None,
            'C17_EXTERNAL_PLAN_PIN_INVALID')
    require(packet['plan_sha256'] == expected_plan_sha256,
            'C17_EXTERNAL_PLAN_PIN_MISMATCH')
    return True


def blank_receipt(packet, role):
    """Owner-local skeleton only. Never pre-populate human verdicts or time."""
    _, arms = _verified_packet(packet)
    require(role in ROLES, 'C17_ROLE_INVALID')
    method = 'all' if role.startswith('reference_') or role == 'adjudicator' else role.removeprefix('arm_')
    return {'schema': RECEIPT, 'plan_sha256': packet['plan_sha256'],
            'role': role, 'reviewer_key': None,
            'items': [{'clip_id': name, 'verdict': None,
                       'active_seconds': None, 'label_studio_lead_time_seconds': None}
                      for name in arms[method]]}


def _seconds(value, *, allow_zero):
    if value is None:
        return None
    require(type(value) in (int, float) and (value >= 0 if allow_zero else value > 0),
            'C17_REVIEW_SECONDS_INVALID')
    try:
        result = float(value)
    except OverflowError:
        raise ReviewHold('C17_REVIEW_SECONDS_INVALID') from None
    require(math.isfinite(result), 'C17_REVIEW_SECONDS_INVALID')
    return result


def _checked_receipt(packet, role, receipt, expected_ids):
    require(type(receipt) is dict and set(receipt) == {
                'schema', 'plan_sha256', 'role', 'reviewer_key', 'items'} and
            receipt['schema'] == RECEIPT and
            receipt['plan_sha256'] == packet['plan_sha256'] and
            receipt['role'] == role,
            'C17_REVIEW_RECEIPT_NOT_BOUND')
    key = receipt['reviewer_key']
    require(type(key) is str and 0 < len(key) <= 128 and key.strip() == key,
            'C17_REVIEWER_CLAIM_REQUIRED')
    rows = receipt['items']
    require(type(rows) is list and len(rows) == len(expected_ids),
            'C17_REVIEW_COVERAGE_INCOMPLETE')
    observed = {}
    for row in rows:
        require(type(row) is dict and set(row) == {
                    'clip_id', 'verdict', 'active_seconds', 'label_studio_lead_time_seconds'} and
                type(row['clip_id']) is str and row['clip_id'] in expected_ids and
                row['clip_id'] not in observed and type(row['verdict']) is str and
                row['verdict'] in VERDICTS,
                'C17_REVIEW_ROW_INVALID')
        active = _seconds(row['active_seconds'], allow_zero=False)
        lead = _seconds(row['label_studio_lead_time_seconds'], allow_zero=True)
        observed[row['clip_id']] = (row['verdict'], active, lead)
    require(set(observed) == set(expected_ids), 'C17_REVIEW_COVERAGE_INCOMPLETE')
    return key, observed


def _total(measurements, offset):
    numbers = [values[offset] for values in measurements.values()]
    if any(value is None for value in numbers):
        return None
    try:
        total = math.fsum(numbers)
    except OverflowError:
        raise ReviewHold('C17_REVIEW_TIME_SUM_NONFINITE') from None
    require(math.isfinite(total), 'C17_REVIEW_TIME_SUM_NONFINITE')
    return round(total, 3)


def score(packet, receipts):
    """Aggregate *claimed* owner-local video reviews; no independent truth claim.

    A/B and adjudicator must each assess all 23. Unresolved reference verdicts
    never turn into negative examples. Compare three independent arm sessions
    only descriptively: no causal labor savings or physical identity inference.
    """
    ids, arms = _verified_packet(packet)
    require(type(receipts) is dict and set(receipts) == set(ROLES),
            'C17_REVIEW_RECEIPTS_INCOMPLETE')
    checks = {}
    keys = []
    for role in ROLES:
        requested = arms['all' if role.startswith('reference_') or role == 'adjudicator'
                         else role.removeprefix('arm_')]
        key, parsed = _checked_receipt(packet, role, receipts[role], requested)
        keys.append(key)
        checks[role] = parsed
    require(len(set(keys)) == len(ROLES), 'C17_REUSED_REVIEWER_CLAIM')
    a, b, adjudicated = (checks[r] for r in ROLES[:3])
    final = {key: adjudicated[key][0] for key in ids}
    visible = {key for key, verdict in final.items() if verdict == 'VISIBLE_ENTER_OR_EXIT'}
    unknown = {key for key, verdict in final.items() if verdict == 'UNKNOWN'}
    result = {}
    for name in ARMS:
        values = checks['arm_'+name]
        selection = set(arms[name])
        # Method provides candidate exposure, not a predicted positive action.
        result[name] = {
            'clips_reviewed': len(selection),
            'adjudicated_visible_in_selection': len(selection & visible),
            'adjudicated_visible_omitted': len(visible-selection),
            'adjudicated_unknown_in_selection': len(selection & unknown),
            'visible_clip_retrieval_fraction': (round(len(selection & visible)/len(visible), 6)
                                                if visible else None),
            'confident_contradictions_vs_adjudicator': sum(
                result_row[0] == 'VISIBLE_ENTER_OR_EXIT' and
                final[clip] == 'NOT_VISIBLE'
                for clip, result_row in values.items()),
            'confident_on_adjudicated_unknown': sum(
                result_row[0] == 'VISIBLE_ENTER_OR_EXIT' and clip in unknown
                for clip, result_row in values.items()),
            'unknown_agreement_with_adjudicator': sum(
                result_row[0] == 'UNKNOWN' and clip in unknown
                for clip, result_row in values.items()),
            'unknown_on_resolved_reference': sum(
                result_row[0] == 'UNKNOWN' and clip not in unknown
                for clip, result_row in values.items()),
            'reported_active_seconds': _total(values, 1),
            'label_studio_lead_time_seconds': _total(values, 2),
        }
    full = result['all']['reported_active_seconds']
    focused = result['reed_closed_after_end_5s']['reported_active_seconds']
    return {
        'schema': SCHEMA,
        'status': 'OWNER_CLAIMED_INDEPENDENT_CLIP_REVIEWS_NOT_ATTESTED_PHYSICAL_GOLD',
        'denominators': {'video_annotations': len(ids),
                         'reviewed_reference_a': len(a),
                         'reviewed_reference_b': len(b),
                         'adjudicated': len(adjudicated),
                         'adjudicated_visible': len(visible),
                         'adjudicated_not_visible': sum(v == 'NOT_VISIBLE' for v in final.values()),
                         'adjudicated_unknown': len(unknown),
                         'reference_a_b_disagreements': sum(a[i][0] != b[i][0] for i in ids),
                         'reference_a_b_agreement_unknown': sum(
                             a[i][0] == b[i][0] == 'UNKNOWN' for i in ids)},
        'arm_summaries': result,
        'reference_active_seconds': {role: _total(checks[role], 1) for role in ROLES[:3]},
        'descriptive_active_seconds_full_minus_focused': (
            round(full-focused, 3) if full is not None and focused is not None else None),
        'reported_active_time_is_self_report_not_verified': True,
        'label_studio_lead_time_may_include_idle': True,
        'reviewer_identity_and_independence_verified': False,
        'adjudicator_truth_independently_verified': False,
        'same_actor_or_intention_proven': False,
        'clock_calibration_proven': False,
        'causal_labor_saving_established': False,
        'task_precision': None,
        'accepted_tasks': 0,
        'source_identifiers_times_actors_or_reviewer_keys_exported': False,
    }


def _owner_json(path):
    """Reuse existing Task Discovery's strict owner-local JSON reader."""
    import sys
    from pathlib import Path
    sibling = str(Path(__file__).resolve().parents[1] / 'task-discovery')
    if sibling not in sys.path:
        sys.path.insert(0, sibling)
    from review_effort import read_json
    return read_json(Path(path), return_sha256=True)


def _owner_output(path, data):
    """Never put source locators or owner reviews inside a Git checkout."""
    import os
    from pathlib import Path
    target = Path(path).expanduser().resolve()
    repo_root = Path(__file__).resolve().parents[2]
    require(target != repo_root and repo_root not in target.parents and
            target.parent.is_dir(), 'C17_OWNER_OUTPUT_PATH_INVALID')
    raw = (json.dumps(data, ensure_ascii=False, sort_keys=True,
                      indent=2, allow_nan=False) + '\n').encode('utf-8')
    fd = None
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            fd = None
            handle.write(raw)
    except FileExistsError:
        raise ReviewHold('C17_OWNER_OUTPUT_EXISTS') from None
    finally:
        if fd is not None:
            os.close(fd)


def main(argv=None):
    """Owner-local CLI. Never run with source data in public CI/artifacts."""
    import argparse
    parser = argparse.ArgumentParser(description='C17 owner-local blinded review adapter')
    sub = parser.add_subparsers(dest='command', required=True)
    prepare_parser = sub.add_parser('prepare')
    prepare_parser.add_argument('--video-ocel', required=True)
    prepare_parser.add_argument('--sensors-ocel', required=True)
    prepare_parser.add_argument('--out', required=True)
    blank_parser = sub.add_parser('blank')
    blank_parser.add_argument('--packet', required=True)
    blank_parser.add_argument('--out', required=True)
    blank_parser.add_argument('--expected-plan-sha256', required=True)
    score_parser = sub.add_parser('score')
    score_parser.add_argument('--packet', required=True)
    score_parser.add_argument('--receipts', required=True)
    score_parser.add_argument('--out', required=True)
    score_parser.add_argument('--expected-plan-sha256', required=True)
    media_parser = sub.add_parser('media-verify')
    media_parser.add_argument('--packet', required=True)
    media_parser.add_argument('--zip-index', required=True)
    media_parser.add_argument('--video-file', required=True)
    media_parser.add_argument('--assumed-scene-start', required=True)
    media_parser.add_argument('--declared-duration-seconds', required=True, type=float)
    media_parser.add_argument('--expected-plan-sha256', required=True)
    media_parser.add_argument('--expected-media-sha256')
    media_parser.add_argument('--out', required=True)
    args = parser.parse_args(argv)
    if args.command == 'prepare':
        from solve4x_cross_source_coverage import SHA
        from solve4x_c14_raw_reed_review import _outside_video_events
        video, video_sha = _owner_json(args.video_ocel)
        sensors, sensors_sha = _owner_json(args.sensors_ocel)
        require(video_sha == SHA['scene01/scene01_video_ocel.json'] and
                sensors_sha == SHA['scene01/scene01_sensors_ocel.json'],
                'C17_ORIGINAL_SOURCE_SHA_MISMATCH')
        packet = prepare(video, _outside_video_events(video, sensors),
                         source_sha256=video_sha)
        _owner_output(args.out, packet)
        status = public_plan(packet)['status']
    elif args.command == 'blank':
        packet, _ = _owner_json(args.packet)
        require_precommitted_plan(packet, args.expected_plan_sha256)
        _owner_output(args.out, {role: blank_receipt(packet, role) for role in ROLES})
        status = 'C17_BLANK_RECEIPTS_NO_HUMAN_VALUES'
    elif args.command == 'score':
        packet, _ = _owner_json(args.packet)
        require_precommitted_plan(packet, args.expected_plan_sha256)
        receipts, _ = _owner_json(args.receipts)
        _owner_output(args.out, score(packet, receipts))
        status = 'C17_OWNER_LOCAL_AGGREGATE_SCORE_CREATED'
    else:
        packet, _ = _owner_json(args.packet)
        zip_index, _ = _owner_json(args.zip_index)
        media_report = verify_owner_local_media(
            packet, args.video_file, zip_index,
            expected_plan_sha256=args.expected_plan_sha256,
            expected_media_sha256=args.expected_media_sha256,
            assumed_scene_start=args.assumed_scene_start,
            declared_video_duration_seconds=args.declared_duration_seconds)
        _owner_output(args.out, media_report)
        status = media_report['status']
    print(json.dumps({'schema': SCHEMA, 'status': status,
                      'frozen_plan_sha256': packet['plan_sha256'],
                      'external_plan_pin_matched': args.command != 'prepare',
                      'source_video_review_or_human_gold_attested': False,
                      'files_exported_to_public_github': False}, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ReviewHold, c16.Hold) as exc:
        import sys
        print(str(exc), file=sys.stderr)
        sys.exit(2)
