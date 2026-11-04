#!/usr/bin/env python3
"""Owner-local, read-only Label Studio annotation-effort receipt for TASK-EXP-01.

The existing iwxa task_exp_01_review_bridge MUST validate both reviewer exports
first. This module reads only platform-reported lead_time; it never scores
Taskness, creates task gold, changes a reviewer label or publishes source text.
"""
from __future__ import annotations

import argparse
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'task_exp_01_source_metadata.json'
COMMITMENT = HERE / 'pre_gold_method_commitment_20261103.json'
MANIFEST_BLOB = '4ecaa74522ba1c3fa4e8851e877200c7767ad0de'
EXPECTED_METHOD_SHA = '93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0'
BRIDGE_SCHEMA = 'IWXA_TASK_EXP_01_INDEPENDENT_REVIEW_CROSSCHECK/0.1'
SCHEMA = 'IWXA_TASK_EXP_01_OWNER_LOCAL_REVIEW_EFFORT/0.1'
MAX_FILE_BYTES = 8_000_000


class EffortHold(ValueError):
    """Fixed codes only; no private source or reviewer identifiers."""


def require(ok: bool, code: str) -> None:
    if not ok:
        raise EffortHold(code)


def git_blob(raw: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(raw)).encode('ascii') + b'\0' + raw).hexdigest()


def read_json(path: Path):
    require(path.is_file() and not path.is_symlink(), 'LOCAL_INPUT_UNAVAILABLE')
    raw = path.read_bytes()
    require(0 < len(raw) <= MAX_FILE_BYTES, 'LOCAL_INPUT_SIZE_INVALID')
    # The original owner bridge uses a strict JSON parser. Preserve that
    # invariant when the effort adapter is invoked independently or when
    # files are replaced between the two owner-local steps.
    def unique_pairs(pairs):
        values = {}
        for key, value in pairs:
            require(key not in values, 'LOCAL_JSON_DUPLICATE_KEY')
            values[key] = value
        return values

    def nonfinite(_value):
        raise EffortHold('LOCAL_JSON_NONFINITE_NUMBER')

    def finite_float(value):
        number = float(value)
        require(math.isfinite(number), 'LOCAL_JSON_NONFINITE_NUMBER')
        return number

    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=unique_pairs,
                          parse_constant=nonfinite, parse_float=finite_float)
    except EffortHold:
        raise
    except (ValueError, UnicodeError, RecursionError):
        raise EffortHold('LOCAL_JSON_INVALID') from None


def frozen_sources(path: Path = MANIFEST) -> dict:
    raw = path.read_bytes()
    require(git_blob(raw) == MANIFEST_BLOB, 'ORIGINAL_SOURCE_MANIFEST_CHANGED')
    obj = json.loads(raw)
    require(type(obj) is dict and obj.get('schema') ==
            'IWXA_TASK_EXP_01_PUBLIC_ISSUE_SOURCE_SLICE/0.1' and
            obj.get('no_gold') is True and type(obj.get('items')) is list and
            len(obj['items']) == 8, 'ORIGINAL_SOURCE_SELECTION_INVALID')
    sources = {}
    for r in obj['items']:
        require(type(r) is dict and type(r.get('projection_sha256')) is str and
                type(r.get('projection_bytes')) is int and
                type(r.get('html_url')) is str and
                r.get('projection_sha256') not in sources, 'ORIGINAL_SOURCE_SELECTION_INVALID')
        sources[r['projection_sha256']] = r
    return sources


def read_method_commitment(path: Path = COMMITMENT) -> str:
    obj = read_json(path)
    require(type(obj) is dict and obj.get('schema') ==
            'IWXA_TASK_EXP_01_PRE_GOLD_METHOD_COMMITMENT/0.1' and
            obj.get('frozen_before_human_gold') is True and
            obj.get('method_output_sha256') == EXPECTED_METHOD_SHA and
            obj.get('frozen_manifest_git_blob') == MANIFEST_BLOB and
            obj.get('human_gold') is False and obj.get('sources') == 8,
            'PRE_GOLD_METHOD_COMMITMENT_INVALID')
    return EXPECTED_METHOD_SHA


def bridge_checked(receipt: dict) -> None:
    require(type(receipt) is dict and receipt.get('schema') == BRIDGE_SCHEMA and
            receipt.get('status') == 'BLINDED_REVIEW_CLAIMS_CHECKED_NOT_ADJUDICATED_NOT_GOLD' and
            receipt.get('reviewer_ids_distinct') is True and
            receipt.get('sources_checked') == 8 and
            receipt.get('adjudication_completed') is False and
            receipt.get('human_task_gold') is False,
            'OWNER_REVIEW_BRIDGE_RECEIPT_REQUIRED')


def extract_one(export: object, selected: dict) -> tuple[list[float | None], str]:
    require(type(export) is list and len(export) == 8, 'REVIEW_EXPORT_INCOMPLETE')
    found: dict[str, float | None] = {}
    annotator_claims: set[str] = set()
    for record in export:
        require(type(record) is dict and type(record.get('data')) is dict and
                (not record.get('predictions')) and
                type(record.get('annotations')) is list and
                len(record['annotations']) == 1, 'REVIEW_EXPORT_NOT_SOURCE_FIRST')
        data = record['data']
        digest = data.get('source_sha256')
        require(type(digest) is str and digest.startswith('sha256:') and
                digest[7:] in selected and digest not in found,
                'REVIEW_EXPORT_SOURCE_MISMATCH')
        expected = selected[digest[7:]]
        raw_text = data.get('source_text')
        require(type(raw_text) is str and
                hashlib.sha256(raw_text.encode('utf-8')).hexdigest() == digest[7:] and
                len(raw_text.encode('utf-8')) == expected['projection_bytes'] and
                data.get('source_ref') == expected['html_url'] and
                data.get('source_edition') == expected['updated_at'],
                'REVIEW_EXPORT_SOURCE_MISMATCH')
        ann = record['annotations'][0]
        require(type(ann) is dict and ann.get('was_cancelled') is not True and
                type(ann.get('result')) is list,
                'REVIEW_EXPORT_NOT_COMPLETED')
        ident = ann.get('completed_by')
        if type(ident) is dict:
            ident = ident.get('id')
        require(type(ident) in (str, int) and type(ident) is not bool and
                bool(str(ident).strip()), 'REVIEW_EXPORT_ANNOTATOR_MISSING')
        annotator_claims.add(str(ident))
        lead = ann.get('lead_time')
        if lead is None:
            found[digest] = None
        else:
            require(type(lead) in (int, float) and
                    math.isfinite(lead) and lead >= 0,
                    'LABEL_STUDIO_LEAD_TIME_INVALID')
            found[digest] = float(lead)
    require(len(annotator_claims) == 1 and len(found) == len(selected),
            'REVIEW_EXPORT_INCOMPLETE_OR_MIXED_REVIEWERS')
    return [found['sha256:' + h] for h in sorted(selected)], next(iter(annotator_claims))


def _quantile90(values: list[float]) -> float:
    # Nearest-rank: one directly observed sample, no interpolation.
    ordered = sorted(values)
    return ordered[math.ceil(0.9 * len(ordered)) - 1]


def _slot(values: list[float | None]) -> dict:
    valid = [t for t in values if t is not None]
    complete = len(valid) == 8
    # Individual finite values may still overflow their sum. Never serialize
    # Infinity/NaN as though they were measured seconds.
    observed_sum = sum(valid) if complete else None
    require(observed_sum is None or math.isfinite(observed_sum),
            'LABEL_STUDIO_LEAD_TIME_TOTAL_NONFINITE')
    return {
        'annotations': 8,
        'lead_time_reported': len(valid),
        'lead_time_missing': 8 - len(valid),
        'lead_time_seconds_sum': round(observed_sum, 3) if complete else None,
        'lead_time_seconds_median': round(statistics.median(valid), 3) if complete else None,
        'lead_time_seconds_p90_nearest_rank': round(_quantile90(valid), 3) if complete else None,
    }


def summarize(export_a: object, export_b: object, owner_receipt: dict,
              selected: dict, method_sha: str, *, hourly_rate_usd: Decimal | None = None) -> dict:
    bridge_checked(owner_receipt)
    a, a_claim = extract_one(export_a, selected)
    b, b_claim = extract_one(export_b, selected)
    require(a_claim != b_claim, 'SAME_REVIEWER_CLAIM')
    slot_a, slot_b = _slot(a), _slot(b)
    complete = slot_a['lead_time_missing'] == slot_b['lead_time_missing'] == 0
    observed_total = (slot_a['lead_time_seconds_sum'] +
                      slot_b['lead_time_seconds_sum']) if complete else None
    require(observed_total is None or math.isfinite(observed_total),
            'LABEL_STUDIO_LEAD_TIME_TOTAL_NONFINITE')
    total = round(observed_total, 3) if complete else None
    cost = None
    if hourly_rate_usd is not None:
        require(type(hourly_rate_usd) is Decimal and hourly_rate_usd.is_finite() and
                hourly_rate_usd >= 0, 'ASSUMED_HOURLY_RATE_INVALID')
        if complete:
            cost = str((Decimal(str(total)) * hourly_rate_usd / Decimal('3600')).quantize(
                Decimal('0.0001'), rounding=ROUND_HALF_UP))
    return {
        'schema': SCHEMA,
        'status': 'LEAD_TIME_RECORDED_NOT_TASK_GOLD' if complete else 'LEAD_TIME_PARTIAL_NOT_TASK_GOLD',
        'method_output_sha256': method_sha,
        'original_source_manifest_git_blob': MANIFEST_BLOB,
        'sources_verified': 8,
        'reviewer_slots': {'A': slot_a, 'B': slot_b},
        'annotation_count': 16,
        'label_studio_lead_time_seconds_total': total,
        'lead_time_seconds_includes_idle': True,
        'independent_attention_time_measured': False,
        'hourly_rate_usd_assumed': str(hourly_rate_usd) if hourly_rate_usd is not None else None,
        'estimated_review_cost_usd': cost,
        'rate_is_assumption_not_actual_expense': hourly_rate_usd is not None,
        'reviewer_identity_claims_independently_verified': False,
        'reviewer_independence_independently_verified': False,
        'human_task_gold': False,
        'adjudication_completed': False,
        'task_precision': None, 'task_recall': None, 'task_f1': None,
        'source_text_exported': False,
        'reviewer_ids_exported': False,
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--owner-bridge-receipt', type=Path, required=True,
                   help='Unmodified non-sensitive receipt from existing owner review_bridge')
    p.add_argument('--review-a', type=Path, required=True)
    p.add_argument('--review-b', type=Path, required=True)
    p.add_argument('--hourly-rate-usd', type=str,
                   help='Optional assumed hourly labor cost, not verified actual expense')
    p.add_argument('--out', required=True, type=Path)
    opts = p.parse_args()
    try:
        rate = Decimal(opts.hourly_rate_usd) if opts.hourly_rate_usd is not None else None
        require(not opts.out.exists(), 'REFUSE_OVERWRITE_EFFORT_RECEIPT')
        selected = frozen_sources()
        commitment = read_method_commitment()
        result = summarize(read_json(opts.review_a), read_json(opts.review_b),
                           read_json(opts.owner_bridge_receipt), selected, commitment,
                           hourly_rate_usd=rate)
        with opts.out.open('x', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2,
                      sort_keys=True, allow_nan=False)
            f.write('\n')
        print(json.dumps({'status': result['status'], 'sources': 8,
                          'complete_lead_time': result['label_studio_lead_time_seconds_total'] is not None,
                          'human_task_gold': False}, sort_keys=True))
        return 0
    except (EffortHold, OSError, TypeError, ValueError, InvalidOperation):
        print(json.dumps({'status': 'HOLD', 'code': 'OWNER_LOCAL_REVIEW_EFFORT_UNAVAILABLE'},
                         sort_keys=True), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
