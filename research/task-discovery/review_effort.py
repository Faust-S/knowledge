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
import os
from pathlib import Path
from tempfile import TemporaryDirectory
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


def read_json(path: Path, *, return_sha256: bool = False):
    """Parse one exact byte snapshot; optionally bind its SHA to the parsed JSON."""
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
        parsed = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_pairs,
                            parse_constant=nonfinite, parse_float=finite_float)
        return (parsed, hashlib.sha256(raw).hexdigest()) if return_sha256 else parsed
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
            require(type(lead) in (int, float) and lead >= 0,
                    'LABEL_STUDIO_LEAD_TIME_INVALID')
            # JSON permits arbitrarily large decimal integers. Python's
            # math.isfinite(big_int) first converts to float and can raise an
            # uncaught OverflowError instead of the fixed owner-local HOLD.
            try:
                seconds = float(lead)
            except OverflowError:
                raise EffortHold('LABEL_STUDIO_LEAD_TIME_INVALID') from None
            require(math.isfinite(seconds),
                    'LABEL_STUDIO_LEAD_TIME_INVALID')
            found[digest] = seconds
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



ACTIVE_TIME_SCHEMA = 'IWXA_TASK_EXP_01_OWNER_LOCAL_REVIEW_ACTIVE_TIME/0.1'
ACTIVE_TIME_METHOD = 'PER_SOURCE_STOPWATCH_IDLE_EXCLUDED'


def active_time_totals(log: object, selected: dict,
                       export_sha256: tuple[str, str] | None) -> dict:
    """Sum owner-local stopwatch records bound to the two unchanged exports.

    A timing log is a human/operator claim, NOT independently proven attention
    time, a Task label, or evidence that Cross-Lab improved results.
    """
    require(type(log) is dict and set(log) == {
        'schema', 'measurement_method', 'review_export_sha256',
        'active_seconds_by_source'
    } and log['schema'] == ACTIVE_TIME_SCHEMA and
            log['measurement_method'] == ACTIVE_TIME_METHOD,
            'ACTIVE_TIME_LOG_FORMAT_INVALID')
    require(type(export_sha256) is tuple and len(export_sha256) == 2 and
            all(type(v) is str and len(v) == 64 for v in export_sha256),
            'ACTIVE_TIME_EXPORT_BINDING_REQUIRED')
    bound = log['review_export_sha256']
    require(type(bound) is dict and set(bound) == {'A', 'B'} and
            bound['A'] == export_sha256[0] and bound['B'] == export_sha256[1],
            'ACTIVE_TIME_EXPORT_BINDING_MISMATCH')
    parts = log['active_seconds_by_source']
    require(type(parts) is dict and set(parts) == {'A', 'B'},
            'ACTIVE_TIME_LOG_FORMAT_INVALID')
    expected = {'sha256:' + digest for digest in selected}
    totals = {}
    for slot in ('A', 'B'):
        records = parts[slot]
        require(type(records) is list and len(records) == 8,
                'ACTIVE_TIME_SOURCE_SET_INCOMPLETE')
        seen = set()
        seconds = []
        for row in records:
            require(type(row) is dict and set(row) == {
                'source_sha256', 'active_seconds'},
                'ACTIVE_TIME_ROW_INVALID')
            key, sec = row['source_sha256'], row['active_seconds']
            require(type(key) is str and key in expected and key not in seen,
                    'ACTIVE_TIME_SOURCE_SET_INVALID')
            require(type(sec) in (int, float) and sec > 0,
                    'ACTIVE_TIME_SECONDS_INVALID')
            try:
                value = float(sec)
            except OverflowError:
                raise EffortHold('ACTIVE_TIME_SECONDS_INVALID') from None
            require(math.isfinite(value), 'ACTIVE_TIME_SECONDS_INVALID')
            seen.add(key)
            seconds.append(value)
        require(seen == expected, 'ACTIVE_TIME_SOURCE_SET_INCOMPLETE')
        total_slot = sum(seconds)
        require(math.isfinite(total_slot), 'ACTIVE_TIME_TOTAL_NONFINITE')
        totals[slot] = round(total_slot, 3)
    total = sum(totals.values())
    require(math.isfinite(total), 'ACTIVE_TIME_TOTAL_NONFINITE')
    return {'slots': totals, 'total': round(total, 3)}


def summarize(export_a: object, export_b: object, owner_receipt: dict,
              selected: dict, method_sha: str, *, hourly_rate_usd: Decimal | None = None,
              active_time_log: dict | None = None,
              export_sha256: tuple[str, str] | None = None) -> dict:
    bridge_checked(owner_receipt)
    a, a_claim = extract_one(export_a, selected)
    b, b_claim = extract_one(export_b, selected)
    require(a_claim != b_claim, 'SAME_REVIEWER_CLAIM')
    slot_a, slot_b = _slot(a), _slot(b)
    recorded = (active_time_totals(active_time_log, selected, export_sha256)
                if active_time_log is not None else None)
    complete = slot_a['lead_time_missing'] == slot_b['lead_time_missing'] == 0
    observed_total = (slot_a['lead_time_seconds_sum'] +
                      slot_b['lead_time_seconds_sum']) if complete else None
    require(observed_total is None or math.isfinite(observed_total),
            'LABEL_STUDIO_LEAD_TIME_TOTAL_NONFINITE')
    total = round(observed_total, 3) if complete else None
    cost = None
    active_cost = None
    if hourly_rate_usd is not None:
        require(type(hourly_rate_usd) is Decimal and hourly_rate_usd.is_finite() and
                hourly_rate_usd >= 0, 'ASSUMED_HOURLY_RATE_INVALID')
        if complete:
            cost = str((Decimal(str(total)) * hourly_rate_usd / Decimal('3600')).quantize(
                Decimal('0.0001'), rounding=ROUND_HALF_UP))
        if recorded is not None:
            active_cost = str((Decimal(str(recorded['total'])) * hourly_rate_usd /
                               Decimal('3600')).quantize(
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
        'active_time_reported': recorded is not None,
        'reported_active_seconds_by_reviewer': recorded['slots'] if recorded else None,
        'reported_active_seconds_total': recorded['total'] if recorded else None,
        'active_time_measurement_claim': ACTIVE_TIME_METHOD if recorded else None,
        'active_time_independently_verified': False,
        'estimated_active_review_cost_usd': active_cost,
        'rate_is_assumption_not_actual_expense': hourly_rate_usd is not None,
        'reviewer_identity_claims_independently_verified': False,
        'reviewer_independence_independently_verified': False,
        'human_task_gold': False,
        'adjudication_completed': False,
        'task_precision': None, 'task_recall': None, 'task_f1': None,
        'source_text_exported': False,
        'reviewer_ids_exported': False,
    }


def write_restricted_result(path: Path, result: dict) -> None:
    """Publish one complete owner-local JSON without exposing partial output.

    A temporary 0700 directory lives next to the final file so that the
    exclusive hard link cannot cross filesystem boundaries. Preserve the
    original result on collision, never follow a dangling output symlink.
    """
    require(path.parent.is_dir(), 'LOCAL_OUTPUT_DIRECTORY_UNAVAILABLE')
    require(not path.exists() and not path.is_symlink(),
            'REFUSE_OVERWRITE_EFFORT_RECEIPT')
    with TemporaryDirectory(prefix='.iwxa-m3-effort-', dir=path.parent) as tmp:
        staged = Path(tmp) / 'review-effort.json'
        fd = os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(result, stream, ensure_ascii=False,
                      indent=2, sort_keys=True, allow_nan=False)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        # os.link fails if the final destination already exists. The private
        # temporary directory is cleaned on *any* error before publication.
        os.link(staged, path)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--owner-bridge-receipt', type=Path, required=True,
                   help='Unmodified non-sensitive receipt from existing owner review_bridge')
    p.add_argument('--review-a', type=Path, required=True)
    p.add_argument('--review-b', type=Path, required=True)
    p.add_argument('--active-time-input', type=Path,
                   help='Private per-source stopwatch log bound to both review export SHA256')
    p.add_argument('--hourly-rate-usd', type=str,
                   help='Optional assumed hourly labor cost, not verified actual expense')
    p.add_argument('--out', required=True, type=Path)
    opts = p.parse_args()
    try:
        rate = Decimal(opts.hourly_rate_usd) if opts.hourly_rate_usd is not None else None
        require(not opts.out.exists() and not opts.out.is_symlink(),
                'REFUSE_OVERWRITE_EFFORT_RECEIPT')
        selected = frozen_sources()
        commitment = read_method_commitment()
        log = read_json(opts.active_time_input) if opts.active_time_input else None
        # Read each export ONCE. The stopwatch digest must identify exactly
        # the bytes parsed for summarization, not an earlier disk snapshot.
        export_a, sha_a = read_json(opts.review_a, return_sha256=True)
        export_b, sha_b = read_json(opts.review_b, return_sha256=True)
        export_hashes = (sha_a, sha_b) if log is not None else None
        result = summarize(export_a, export_b,
                           read_json(opts.owner_bridge_receipt), selected, commitment,
                           hourly_rate_usd=rate, active_time_log=log,
                           export_sha256=export_hashes)
        write_restricted_result(opts.out, result)
        print(json.dumps({'status': result['status'], 'sources': 8,
                          'complete_lead_time': result['label_studio_lead_time_seconds_total'] is not None,
                          'active_time_reported': result['active_time_reported'],
                          'human_task_gold': False}, sort_keys=True))
        return 0
    except (EffortHold, OSError, TypeError, ValueError, InvalidOperation):
        print(json.dumps({'status': 'HOLD', 'code': 'OWNER_LOCAL_REVIEW_EFFORT_UNAVAILABLE'},
                         sort_keys=True), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
