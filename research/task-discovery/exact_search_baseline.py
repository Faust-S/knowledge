#!/usr/bin/env python3
"""Pre-gold literal search baseline for the pinned eight TASK-EXP-01 sources.

This is neither Task prediction nor an annotation system. The operator-facing
receipt contains aggregates only; source text and matches are not exported.
The exact-query rule and eight source-level outcomes were pinned before any
independent human adjudication, without modifying the older U1/regex method.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import method_snapshot as frozen
import source_first_baseline as baseline

SCHEMA = 'IWXA_TASK_EXP_01_PRE_GOLD_LITERAL_EXACT_SEARCH/0.1'
TERMS = (
    'bug', 'error', 'fail', 'request', 'need', 'should', 'cannot',
    "can't", "doesn't", 'please add', 'feature request', 'expected behavior',
)
SPEC_SHA = '062a2c09af237b9d32bce9fc8a01fd73d53a762039b529e17213c4869f143e66'
OUTPUT_SHA = '7512d8e85790cc4444214fc8757e3cb24c8214bfd54fe8a36e057f78aa16fec1'


class ExactHold(ValueError):
    """Fixed refusal code; never echo source text or operator input."""


def need(ok: bool, code: str) -> None:
    if not ok:
        raise ExactHold(code)


def specification() -> dict:
    return {
        'schema': 'IWXA_TASK_EXP_01_LITERAL_EXACT_SOURCE_SEARCH/0.1',
        'case_handling': 'UNICODE_CASEFOLD',
        'scope': 'FULL_TITLE_NEWLINE_BODY_NEWLINE',
        'match': 'LITERAL_SUBSTRING_NO_REGEX_NO_STEM',
        'terms': list(TERMS),
    }


def source_output_sha(rows: list[dict]) -> str:
    return frozen.canonical_sha({
        'manifest_git_blob': frozen.MANIFEST_GIT_BLOB,
        'spec_sha256': SPEC_SHA,
        'source_rows': rows,
    })


def exact_hit(raw: bytes) -> bool:
    text = raw.decode('utf-8', 'strict').casefold()
    return any(phrase in text for phrase in TERMS)


def replay(manifest: dict, *, input_dir: Path | None = None,
           fetch_source=None) -> dict:
    need(frozen.canonical_sha(specification()) == SPEC_SHA,
         'PRE_GOLD_EXACT_RULE_CHANGED')
    need(type(manifest) is dict and manifest.get('schema') == baseline.MANIFEST_SCHEMA and
         manifest.get('no_gold') is True and type(manifest.get('items')) is list and
         len(manifest['items']) == 8, 'FROZEN_EXACT_MANIFEST_INVALID')
    rows = []
    seen = set()
    for item in manifest['items']:
        need(type(item) is dict and type(item.get('projection_sha256')) is str and
             item['projection_sha256'] not in seen,
             'FROZEN_EXACT_SOURCE_IDENTITY_CHANGED')
        seen.add(item['projection_sha256'])
        raw = (fetch_source(item) if fetch_source is not None
               else baseline._projection(item, input_dir))
        need(type(raw) is bytes and len(raw) == item['projection_bytes'] and
             baseline.sha(raw) == item['projection_sha256'],
             'FROZEN_EXACT_SOURCE_BYTES_CHANGED')
        title, newline, body = raw.partition(b'\n')
        need(newline == b'\n' and body.endswith(b'\n') and
             baseline.sha(body[:-1]) == item['body_sha256'],
             'FROZEN_EXACT_BODY_BYTES_CHANGED')
        rows.append({'source_sha256': item['projection_sha256'],
                     'hit': exact_hit(raw)})
    need(len(seen) == 8 and source_output_sha(rows) == OUTPUT_SHA,
         'PRE_GOLD_EXACT_SOURCE_OUTCOMES_CHANGED')
    return {
        'schema': SCHEMA,
        'status': 'PINNED_LITERAL_SEARCH_BEFORE_HUMAN_GOLD',
        'frozen_manifest_git_blob': frozen.MANIFEST_GIT_BLOB,
        'method_spec_sha256': SPEC_SHA,
        'method_output_sha256': OUTPUT_SHA,
        'sources_verified': 8,
        'sources_with_literal_hit': sum(row['hit'] for row in rows),
        'sources_without_literal_hit_still_included': sum(not row['hit'] for row in rows),
        'source_rows': rows,
        'source_text_exported': False,
        'human_gold': False,
        'task_precision': None, 'task_recall': None, 'task_f1': None,
    }


def checked_manifest() -> dict:
    need(frozen.git_blob_sha(frozen.SELECTION.read_bytes()) == frozen.MANIFEST_GIT_BLOB,
         'FROZEN_EXACT_MANIFEST_BLOB_CHANGED')
    return baseline.read_manifest(frozen.SELECTION)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input-dir', type=Path,
                   help='Optional directory of locally verified pinned projections')
    args = p.parse_args()
    try:
        result = replay(checked_manifest(), input_dir=args.input_dir)
        # Do not emit per-source identifiers, matches, texts, or annotations.
        print(json.dumps({key: value for key, value in result.items()
                          if key != 'source_rows'}, sort_keys=True, allow_nan=False))
        return 0
    except (ExactHold, baseline.BaselineHold, OSError, ValueError, TypeError,
            KeyError, UnicodeError):
        print(json.dumps({'status': 'HOLD',
                          'code': 'FROZEN_LITERAL_EXACT_SEARCH_UNAVAILABLE'}),
              file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
