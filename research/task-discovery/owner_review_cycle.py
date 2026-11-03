#!/usr/bin/env python3
"""Run existing TASK-EXP-01 owner review bridge, then public time adapter.

Owner-local orchestration only. Does not interpret labels, adjudicate, create a
second evaluator, publish documents or declare human gold.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Callable

OWNER_BRIDGE_BLOB = '9b56bc4624341f54799340b08872d3cfbed6e13b'
BRIDGE_SCHEMA = 'IWXA_TASK_EXP_01_INDEPENDENT_REVIEW_CROSSCHECK/0.1'
EFFORT_SCHEMA = 'IWXA_TASK_EXP_01_OWNER_LOCAL_REVIEW_EFFORT/0.1'


class CycleHold(ValueError):
    """Fixed local failure codes; no reviewer text in the message."""


def need(condition: bool, code: str) -> None:
    if not condition:
        raise CycleHold(code)


def git_blob(raw: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(raw)).encode('ascii') + b'\0' + raw).hexdigest()


def sha256_file(path: Path) -> str:
    need(path.is_file() and not path.is_symlink(), 'REVIEW_INPUT_UNAVAILABLE')
    need(0 < path.stat().st_size <= 8_000_000, 'REVIEW_INPUT_SIZE_INVALID')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_json(raw: str) -> dict:
    def no_duplicate(pairs):
        obj = {}
        for key, value in pairs:
            need(key not in obj, 'DUPLICATED_RESULT_KEY')
            obj[key] = value
        return obj
    try:
        data = json.loads(raw, object_pairs_hook=no_duplicate,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError, UnicodeError):
        raise CycleHold('RESULT_JSON_INVALID') from None
    need(type(data) is dict, 'RESULT_SCHEMA_INVALID')
    return data


def executed(command: list[str], cwd: Path) -> str:
    try:
        proc = subprocess.run(command, cwd=cwd, capture_output=True, text=True,
                              encoding='utf-8', timeout=180, check=False)
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        raise CycleHold('OWNER_LOCAL_PROCESS_UNAVAILABLE') from None
    # The native tools may include input paths in diagnostics. Never forward
    # their raw stdout/stderr if the process fails.
    need(proc.returncode == 0, 'OWNER_LOCAL_STEP_REJECTED')
    need(len(proc.stdout) < 32_000, 'OWNER_LOCAL_RESULT_TOO_LARGE')
    return proc.stdout.strip()


def owner_bridge_path(owner_root: Path) -> tuple[Path, Path]:
    catalog = owner_root / 'knowledge' / 'task-catalog'
    bridge = catalog / 'engine' / 'research' / 'task_exp_01_review_bridge.py'
    need(bridge.is_file() and not bridge.is_symlink(), 'OWNER_BRIDGE_MISSING')
    need(git_blob(bridge.read_bytes()) == OWNER_BRIDGE_BLOB,
         'OWNER_BRIDGE_VERSION_CHANGED')
    return catalog, bridge


def run_cycle(*, owner_root: Path, packet: Path, review_a: Path, review_b: Path,
              disagreements_out: Path, effort_out: Path,
              hourly_rate_usd: str | None = None,
              confirmation: bool = False,
              runner: Callable[[list[str], Path], str] = executed,
              expected_owner_blob: str = OWNER_BRIDGE_BLOB,
              effort_script: Path | None = None) -> dict:
    # Resolve before switching subprocess cwd into the owning task catalog.
    # A caller may supply relative owner-local input/output paths.
    owner_root, packet, review_a, review_b = (
        owner_root.resolve(), packet.resolve(), review_a.resolve(), review_b.resolve())
    disagreements_out, effort_out = disagreements_out.resolve(), effort_out.resolve()
    # Arguments deliberately match the owning bridge and existing effort adapter.
    need(confirmation, 'EXPLICIT_LOCAL_REVIEW_CONFIRMATION_REQUIRED')
    catalog, bridge = owner_bridge_path(owner_root)
    need(git_blob(bridge.read_bytes()) == expected_owner_blob,
         'OWNER_BRIDGE_TEST_PIN_MISMATCH')
    need(review_a != review_b and disagreements_out != effort_out and
         not disagreements_out.exists() and not effort_out.exists(),
         'OWNER_LOCAL_OUTPUT_EXISTS_OR_CONFLICTS')
    inputs = (packet, review_a, review_b)
    pinned = tuple(sha256_file(p) for p in inputs)
    script = effort_script or Path(__file__).resolve().with_name('review_effort.py')
    need(script.is_file() and not script.is_symlink(), 'PUBLIC_EFFORT_ADAPTER_MISSING')

    bridge_command = [sys.executable, '-m', 'engine.research.task_exp_01_review_bridge',
                      '--source-first-packet', str(packet),
                      '--review-a', str(review_a), '--review-b', str(review_b),
                      '--restricted-disagreement-output', str(disagreements_out),
                      '--confirm-independent-local-review']
    with tempfile.TemporaryDirectory(prefix='iwxa-m3-receipt-') as temporary:
        native = safe_json(runner(bridge_command, catalog))
        need(native.get('schema') == BRIDGE_SCHEMA and
             native.get('status') == 'BLINDED_REVIEW_CLAIMS_CHECKED_NOT_ADJUDICATED_NOT_GOLD' and
             native.get('sources_checked') == 8 and
             native.get('reviewer_ids_distinct') is True and
             native.get('human_task_gold') is False and
             native.get('adjudication_completed') is False,
             'OWNER_BRIDGE_RECEIPT_INCOMPATIBLE')
        need(tuple(sha256_file(p) for p in inputs) == pinned,
             'REVIEW_INPUT_CHANGED_AFTER_BRIDGE')
        # A successful bridge response is not sufficient: the reviewer needs
        # the actual owner-local disagreement packet for adjudication.
        need(disagreements_out.is_file() and not disagreements_out.is_symlink(),
             'OWNER_DISAGREEMENTS_NOT_WRITTEN')
        disagreements = safe_json(disagreements_out.read_text(encoding='utf-8'))
        need(disagreements.get('schema') ==
             'IWXA_TASK_EXP_01_LOCAL_DISAGREEMENT_PACKET/0.1' and
             disagreements.get('status') ==
             'ADJUDICATION_PENDING_NO_AUTOMATIC_TASK_ADOPTION' and
             type(disagreements.get('disagreements')) is list and
             type(native.get('sources_with_disagreement')) is int and
             len(disagreements['disagreements']) ==
             native['sources_with_disagreement'] and
             disagreements.get('human_task_gold') is False,
             'OWNER_DISAGREEMENTS_INCOMPATIBLE')
        receipt = Path(temporary) / 'owner-bridge-receipt.json'
        receipt.write_text(json.dumps(native, ensure_ascii=False) + '\n', encoding='utf-8')
        effort_command = [sys.executable, str(script),
                          '--owner-bridge-receipt', str(receipt),
                          '--review-a', str(review_a), '--review-b', str(review_b),
                          '--out', str(effort_out)]
        if hourly_rate_usd is not None:
            effort_command += ['--hourly-rate-usd', hourly_rate_usd]
        stage = safe_json(runner(effort_command, script.parent))
        need(stage.get('status') in ('LEAD_TIME_RECORDED_NOT_TASK_GOLD',
                                    'LEAD_TIME_PARTIAL_NOT_TASK_GOLD') and
             stage.get('sources') == 8 and stage.get('human_task_gold') is False,
             'EFFORT_RECEIPT_INCOMPATIBLE')
        need(tuple(sha256_file(p) for p in inputs) == pinned,
             'REVIEW_INPUT_CHANGED_AFTER_EFFORT')
        need(effort_out.is_file(), 'EFFORT_OUTPUT_NOT_WRITTEN')
        effort = safe_json(effort_out.read_text('utf-8'))
        need(effort.get('schema') == EFFORT_SCHEMA and
             effort.get('sources_verified') == 8 and
             effort.get('annotation_count') == 16 and
             effort.get('human_task_gold') is False and
             effort.get('adjudication_completed') is False and
             effort.get('source_text_exported') is False and
             effort.get('reviewer_ids_exported') is False,
             'EFFORT_FILE_INCOMPATIBLE')
    # Deliberately no authority/grant flags, Task gold or reviewer IDs.
    return {
        'status': 'OWNER_BRIDGE_AND_REVIEW_EFFORT_COMPLETED_NOT_GOLD',
        'sources': 8, 'annotations': 16,
        'bridge_checked_not_adjudicated': True,
        'sources_with_disagreement': native['sources_with_disagreement'],
        'platform_lead_time_complete': (
            effort.get('label_studio_lead_time_seconds_total') is not None),
        'human_gold': False, 'adjudication_completed': False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner-root', type=Path, required=True)
    parser.add_argument('--source-first-packet', type=Path, required=True)
    parser.add_argument('--review-a', type=Path, required=True)
    parser.add_argument('--review-b', type=Path, required=True)
    parser.add_argument('--restricted-disagreements-out', type=Path, required=True)
    parser.add_argument('--effort-out', type=Path, required=True)
    parser.add_argument('--hourly-rate-usd')
    parser.add_argument('--confirm-independent-local-review', action='store_true')
    opts = parser.parse_args()
    try:
        result = run_cycle(
            owner_root=opts.owner_root, packet=opts.source_first_packet,
            review_a=opts.review_a, review_b=opts.review_b,
            disagreements_out=opts.restricted_disagreements_out,
            effort_out=opts.effort_out, hourly_rate_usd=opts.hourly_rate_usd,
            confirmation=opts.confirm_independent_local_review)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (CycleHold, ValueError, OSError, TypeError):
        print(json.dumps({'status': 'HOLD', 'code': 'OWNER_LOCAL_M3_CYCLE_INCOMPLETE'},
                         sort_keys=True), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
