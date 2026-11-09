#!/usr/bin/env python3
"""Owner-local Label Studio JSON transport for the existing C17 frozen plan.

Only moves blinded clip URLs and claimed annotations. Never downloads video,
creates clips, calibrates clocks, attests independence or scores humans.
"""
from __future__ import annotations

import argparse
import json
import math
from urllib.parse import unquote, urlsplit

import solve4x_c17_blind_review as c17

SCHEMA = 'IWXA_SOLVE4X_C17_LABEL_STUDIO_TRANSPORT/0.1'
CHOICES = {
    'Вход или выход виден': 'VISIBLE_ENTER_OR_EXIT',
    'Вход или выход не виден': 'NOT_VISIBLE',
    'Невозможно определить': 'UNKNOWN',
}


def require(ok, code):
    c17.require(ok, code)


def role_clip_ids(packet, role, pin):
    c17.require_precommitted_plan(packet, pin)
    return [item['clip_id'] for item in c17.blank_receipt(packet, role)['items']]


def _local_media_url(url):
    """Only owner-local Label Studio media URLs; never public-source URLs."""
    require(type(url) is str and 0 < len(url) <= 2048 and
            not any(c in url for c in '\r\n\\'), 'C17_LS_MEDIA_URL_INVALID')
    try:
        u = urlsplit(url)
        local_path = (not u.scheme and not u.netloc and
                      u.path == '/data/local-files/' and bool(u.query))
        loopback = (u.scheme in ('http', 'https') and
                    u.hostname in ('localhost', '127.0.0.1', '::1') and
                    u.username is None and u.password is None and
                    u.path.startswith('/data/local-files/') and bool(u.query))
    except ValueError:
        raise c17.ReviewHold('C17_LS_MEDIA_URL_INVALID') from None
    path = unquote(u.path + '?' + u.query)
    require((local_path or loopback) and not u.fragment and
            not any(part == '..' for part in path.replace('?', '/').split('/')),
            'C17_LS_MEDIA_URL_INVALID')
    return url


def prepare_import(packet, role, media_urls, *, expected_plan_sha256):
    """Create blinded task URLs. Video content and clock are NOT attested."""
    ids = role_clip_ids(packet, role, expected_plan_sha256)
    require(type(media_urls) is dict and
            all(type(k) is str for k in media_urls) and
            set(ids).issubset(media_urls) and
            set(media_urls).issubset(set(packet['arms']['all'])),
            'C17_LS_CLIP_URL_COVERAGE_INVALID')
    return [{'data': {'video': _local_media_url(media_urls[clip_id]),
                      'clip_id': clip_id,
                      'plan_sha256': packet['plan_sha256']}} for clip_id in ids]


def _annotator_key(value):
    if type(value) is dict:
        value = value.get('id')
    require(type(value) is int and value > 0,
            'C17_LS_REVIEWER_UNRESOLVED')
    return 'label-studio-user-' + str(value)


def receipt_from_export(packet, role, imported, exported, *, expected_plan_sha256):
    """Convert raw Label Studio JSON to C17 receipt, not independent gold.

    Exact data matching prevents clip/URL/plan swaps. lead_time remains UI
    elapsed time, never silently treated as active reviewer effort.
    """
    ids = role_clip_ids(packet, role, expected_plan_sha256)
    require(type(imported) is list and type(exported) is list and
            len(imported) == len(exported) == len(ids),
            'C17_LS_EXPORT_COVERAGE_INCOMPLETE')
    expected = {}
    for task in imported:
        require(type(task) is dict and set(task) == {'data'} and
                type(task['data']) is dict and
                set(task['data']) == {'video', 'clip_id', 'plan_sha256'},
                'C17_LS_IMPORT_INVALID')
        data = task['data']
        clip = data['clip_id']
        require(type(clip) is str and clip in ids and clip not in expected and
                data['plan_sha256'] == packet['plan_sha256'],
                'C17_LS_IMPORT_BINDING_DRIFT')
        _local_media_url(data['video'])
        expected[clip] = data
    require(set(expected) == set(ids), 'C17_LS_EXPORT_COVERAGE_INCOMPLETE')
    observed = {}
    reviewer_keys = set()
    for task in exported:
        require(type(task) is dict and type(task.get('data')) is dict,
                'C17_LS_EXPORT_TASK_INVALID')
        data = task['data']
        clip = data.get('clip_id')
        require(type(clip) is str and clip in expected and clip not in observed and
                data == expected[clip], 'C17_LS_EXPORT_BINDING_DRIFT')
        require(not task.get('predictions') and
                type(task.get('annotations')) is list and
                len(task['annotations']) == 1,
                'C17_LS_ANNOTATION_REQUIRED')
        ann = task['annotations'][0]
        require(type(ann) is dict and ann.get('was_cancelled') is False and
                type(ann.get('result')) is list and len(ann['result']) == 1,
                'C17_LS_ANNOTATION_INVALID')
        result = ann['result'][0]
        require(type(result) is dict and result.get('from_name') == 'verdict' and
                result.get('to_name') == 'video' and
                result.get('type') == 'choices' and
                type(result.get('value')) is dict and
                set(result['value']) == {'choices'} and
                type(result['value']['choices']) is list and
                len(result['value']['choices']) == 1 and
                type(result['value']['choices'][0]) is str and
                result['value']['choices'][0] in CHOICES,
                'C17_LS_VERDICT_INVALID')
        lead = ann.get('lead_time')
        if lead is not None:
            require(type(lead) in (int, float) and math.isfinite(lead) and
                    0 <= lead <= 86400, 'C17_LS_LEAD_TIME_INVALID')
        reviewer_keys.add(_annotator_key(ann.get('completed_by')))
        observed[clip] = {
            'clip_id': clip,
            'verdict': CHOICES[result['value']['choices'][0]],
            'active_seconds': None,
            'label_studio_lead_time_seconds': lead,
        }
    require(set(observed) == set(ids), 'C17_LS_EXPORT_COVERAGE_INCOMPLETE')
    require(len(reviewer_keys) == 1, 'C17_LS_MULTIPLE_REVIEWERS_PER_ROLE')
    receipt = c17.blank_receipt(packet, role)
    receipt['reviewer_key'] = next(iter(reviewer_keys))
    receipt['items'] = [observed[clip_id] for clip_id in ids]
    c17._checked_receipt(packet, role, receipt, ids)
    return receipt


def main(argv=None):
    p = argparse.ArgumentParser(description='Private C17 / Label Studio transport')
    sub = p.add_subparsers(dest='command', required=True)
    for name in ('import', 'receipt'):
        subp = sub.add_parser(name)
        subp.add_argument('--packet', required=True)
        subp.add_argument('--expected-plan-sha256', required=True)
        subp.add_argument('--role', required=True, choices=c17.ROLES)
        subp.add_argument('--out', required=True)
        if name == 'import':
            subp.add_argument('--media-map', required=True)
        else:
            subp.add_argument('--import-file', required=True)
            subp.add_argument('--export-file', required=True)
    args = p.parse_args(argv)
    packet, _ = c17._owner_json(args.packet)
    if args.command == 'import':
        media_map, _ = c17._owner_json(args.media_map)
        result = prepare_import(packet, args.role, media_map,
                                expected_plan_sha256=args.expected_plan_sha256)
    else:
        imported, _ = c17._owner_json(args.import_file)
        exported, _ = c17._owner_json(args.export_file)
        result = receipt_from_export(packet, args.role, imported, exported,
                                     expected_plan_sha256=args.expected_plan_sha256)
    c17._owner_output(args.out, result)
    print(json.dumps({'schema': SCHEMA, 'role': args.role,
                      'status': 'OWNER_LOCAL_TRANSPORT_NOT_INDEPENDENT_GOLD',
                      'items': len(result if args.command == 'import' else result['items']),
                      'active_human_time_measured': False,
                      'reviewer_identity_independently_verified': False,
                      'accepted_tasks': 0}, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except c17.ReviewHold as error:
        import sys
        print(str(error), file=sys.stderr)
        sys.exit(2)
