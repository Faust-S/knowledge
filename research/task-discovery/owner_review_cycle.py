#!/usr/bin/env python3
"""Run existing TASK-EXP-01 owner review bridge, then public time adapter.

Owner-local orchestration only. Does not interpret labels, adjudicate, create a
second evaluator, publish documents or declare human gold.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Callable

import review_effort as effort_contract
import review_form_contract as form_contract

OWNER_BRIDGE_BLOB = '9b56bc4624341f54799340b08872d3cfbed6e13b'
BRIDGE_SCHEMA = 'IWXA_TASK_EXP_01_INDEPENDENT_REVIEW_CROSSCHECK/0.1'
EFFORT_SCHEMA = 'IWXA_TASK_EXP_01_OWNER_LOCAL_REVIEW_EFFORT/0.1'

# Approved owner-local diagnostic codes only. No arbitrary user-provided text,
# including upper-case input, can appear as an error receipt.
PUBLIC_HOLD_CODES = frozenset((
    'DUPLICATED_RESULT_KEY',
    'EFFORT_FILE_INCOMPATIBLE',
    'EFFORT_FROZEN_METHOD_BINDING_MISMATCH',
    'EFFORT_OUTPUT_NOT_WRITTEN',
    'EFFORT_RECEIPT_FILE_MISMATCH',
    'EFFORT_RECEIPT_INCOMPATIBLE',
    'EXPLICIT_LOCAL_REVIEW_CONFIRMATION_REQUIRED',
    'OWNER_BRIDGE_MISSING',
    'OWNER_BRIDGE_RECEIPT_INCOMPATIBLE',
    'OWNER_BRIDGE_TEST_PIN_MISMATCH',
    'OWNER_BRIDGE_VERSION_CHANGED',
    'OWNER_DISAGREEMENTS_INCOMPATIBLE',
    'OWNER_DISAGREEMENTS_NOT_WRITTEN',
    'OWNER_DISAGREEMENT_NOT_A_CONFLICT',
    'OWNER_DISAGREEMENT_RECEIPT_TOTALS_MISMATCH',
    'OWNER_DISAGREEMENT_REGION_COUNT_MISMATCH',
    'OWNER_DISAGREEMENT_REGIONS_INVALID',
    'OWNER_DISAGREEMENT_SOURCE_IDENTITY_MISMATCH',
    'OWNER_DISAGREEMENT_SOURCE_SELECTION_UNAVAILABLE',
    'OWNER_LOCAL_INPUT_OUTPUT_ALIAS_REFUSED',
    'OWNER_LOCAL_OUTPUT_DIRECTORY_UNAVAILABLE',
    'OWNER_LOCAL_OUTPUT_EXISTS_OR_CONFLICTS',
    'OWNER_LOCAL_OUTPUT_PUBLICATION_FAILED',
    'OWNER_LOCAL_PROCESS_UNAVAILABLE',
    'OWNER_LOCAL_RESULT_TOO_LARGE',
    'OWNER_LOCAL_STEP_REJECTED',
    'OWNER_LOCAL_SYMLINK_PATH_REFUSED',
    'OWNER_REVIEW_INSTRUMENT_MISMATCH',
    'OWNER_REVIEW_INSTRUMENT_MISSING',
    'PUBLIC_EFFORT_ADAPTER_MISSING',
    'RESULT_JSON_INVALID',
    'RESULT_JSON_NONFINITE_NUMBER',
    'RESULT_SCHEMA_INVALID',
    'REVIEW_INPUT_CHANGED_AFTER_BRIDGE',
    'REVIEW_INPUT_CHANGED_AFTER_EFFORT',
    'REVIEW_INPUT_CHANGED_BEFORE_PUBLICATION',
    'REVIEW_INPUT_SIZE_INVALID',
    'REVIEW_INPUT_UNAVAILABLE',
))


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
    def finite_float(value):
        number = float(value)
        need(math.isfinite(number), 'RESULT_JSON_NONFINITE_NUMBER')
        return number

    try:
        data = json.loads(raw, object_pairs_hook=no_duplicate,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()),
                          parse_float=finite_float)
    except CycleHold:
        raise
    except (ValueError, TypeError, UnicodeError, RecursionError):
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


def verify_owner_review_instrument(owner_root: Path, *,
                                   expected_xml_blob: str = form_contract.TASK_EXP_XML_BLOB) -> None:
    """Pin the actual TASK-EXP-01 human instrument, distinct from generic E5.

    This verifies owner-local provenance, NOT that either reviewer was blind.
    The Label Studio import/export adapter independently checks persisted XML.
    """
    xml = (owner_root / 'knowledge' / 'task-catalog' / 'engine' / 'research' /
           'TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml')
    need(xml.is_file() and not xml.is_symlink(), 'OWNER_REVIEW_INSTRUMENT_MISSING')
    try:
        receipt = form_contract.check_xml(xml.read_bytes(), pinned_blob=expected_xml_blob)
    except (form_contract.ContractHold, OSError):
        raise CycleHold('OWNER_REVIEW_INSTRUMENT_MISMATCH') from None
    need(receipt.get('owner_bridge_expected_fields_present') is True and
         receipt.get('generic_e5_xml_is_not_this_form') is True,
         'OWNER_REVIEW_INSTRUMENT_MISMATCH')


def run_cycle(*, owner_root: Path, packet: Path, review_a: Path, review_b: Path,
              disagreements_out: Path, effort_out: Path,
              hourly_rate_usd: str | None = None,
              confirmation: bool = False,
              runner: Callable[[list[str], Path], str] = executed,
              expected_owner_blob: str = OWNER_BRIDGE_BLOB,
              expected_owner_xml_blob: str = form_contract.TASK_EXP_XML_BLOB,
              effort_script: Path | None = None) -> dict:
    # Refuse symlink aliases before resolving paths. The owner bridge and
    # effort adapter must consume the exact same local files, not aliases
    # that could be redirected or mistaken for independent reviewer inputs.
    raw_inputs = (packet, review_a, review_b)
    raw_outputs = (disagreements_out, effort_out)
    need(all(not path.is_symlink() for path in raw_inputs + raw_outputs),
         'OWNER_LOCAL_SYMLINK_PATH_REFUSED')
    # Resolve before switching subprocess cwd into the owning task catalog.
    # A caller may supply relative owner-local input/output paths.
    owner_root, packet, review_a, review_b = (
        owner_root.resolve(), packet.resolve(), review_a.resolve(), review_b.resolve())
    disagreements_out, effort_out = disagreements_out.resolve(), effort_out.resolve()
    need(len({packet, review_a, review_b, disagreements_out, effort_out}) == 5,
         'OWNER_LOCAL_INPUT_OUTPUT_ALIAS_REFUSED')
    # Arguments deliberately match the owning bridge and existing effort adapter.
    need(confirmation, 'EXPLICIT_LOCAL_REVIEW_CONFIRMATION_REQUIRED')
    catalog, bridge = owner_bridge_path(owner_root)
    need(git_blob(bridge.read_bytes()) == expected_owner_blob,
         'OWNER_BRIDGE_TEST_PIN_MISMATCH')
    verify_owner_review_instrument(owner_root, expected_xml_blob=expected_owner_xml_blob)
    need(review_a != review_b and disagreements_out != effort_out and
         not disagreements_out.exists() and not effort_out.exists(),
         'OWNER_LOCAL_OUTPUT_EXISTS_OR_CONFLICTS')
    inputs = (packet, review_a, review_b)
    pinned = tuple(sha256_file(p) for p in inputs)
    script = effort_script or Path(__file__).resolve().with_name('review_effort.py')
    need(script.is_file() and not script.is_symlink(), 'PUBLIC_EFFORT_ADAPTER_MISSING')

    # The owner bridge and effort adapter can fail independently. Stage both
    # private files in their destination directories and expose neither final
    # result until both tools, their receipts, and the original inputs pass.
    # This also allows a safe retry after a failed second step.
    need(disagreements_out.parent.is_dir() and effort_out.parent.is_dir(),
         'OWNER_LOCAL_OUTPUT_DIRECTORY_UNAVAILABLE')
    with ExitStack() as scope:
        private_diff = Path(scope.enter_context(tempfile.TemporaryDirectory(
            prefix='.iwxa-m3-diff-', dir=disagreements_out.parent)))
        private_effort = Path(scope.enter_context(tempfile.TemporaryDirectory(
            prefix='.iwxa-m3-effort-', dir=effort_out.parent)))
        temporary = scope.enter_context(tempfile.TemporaryDirectory(
            prefix='iwxa-m3-receipt-'))
        staged_disagreements = private_diff / 'disagreements.json'
        staged_effort = private_effort / 'review-effort.json'
        bridge_command = [sys.executable, '-m', 'engine.research.task_exp_01_review_bridge',
                          '--source-first-packet', str(packet),
                          '--review-a', str(review_a), '--review-b', str(review_b),
                          '--restricted-disagreement-output', str(staged_disagreements),
                          '--confirm-independent-local-review']
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
        need(staged_disagreements.is_file() and not staged_disagreements.is_symlink(),
             'OWNER_DISAGREEMENTS_NOT_WRITTEN')
        disagreements = safe_json(staged_disagreements.read_text(encoding='utf-8'))
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
        # A matching count alone cannot prove this packet refers to the
        # eight pinned original sources. Keep the adjudicator's source queue
        # bound to the original selection without interpreting Task labels.
        need(type(native.get('sources_exactly_agreed')) is int and
             native['sources_exactly_agreed'] +
             native['sources_with_disagreement'] == 8,
             'OWNER_DISAGREEMENT_RECEIPT_TOTALS_MISMATCH')
        try:
            frozen = effort_contract.frozen_sources()
        except (effort_contract.EffortHold, OSError, ValueError):
            raise CycleHold('OWNER_DISAGREEMENT_SOURCE_SELECTION_UNAVAILABLE') from None
        seen_disagreements = set()
        observed_region_difference = 0
        for item in disagreements['disagreements']:
            need(type(item) is dict and
                 type(item.get('source_sha256')) is str and
                 item['source_sha256'].startswith('sha256:'),
                 'OWNER_DISAGREEMENT_SOURCE_IDENTITY_MISMATCH')
            source_sha = item['source_sha256'][7:]
            source = frozen.get(source_sha)
            need(source is not None and
                 source_sha not in seen_disagreements and
                 item.get('source_ref') == source['html_url'],
                 'OWNER_DISAGREEMENT_SOURCE_IDENTITY_MISMATCH')
            seen_disagreements.add(source_sha)
            # Ensure the queue contains a conflict rather than an agreed
            # source inserted by a stale or incompatible receipt.
            need(type(item.get('review_a_regions')) is list and
                 type(item.get('review_b_regions')) is list and
                 type(item.get('review_a_coverage')) is str and
                 type(item.get('review_b_coverage')) is str and
                 (item['review_a_regions'] != item['review_b_regions'] or
                  item['review_a_coverage'] != item['review_b_coverage']),
                 'OWNER_DISAGREEMENT_NOT_A_CONFLICT')
            # Cross-check the owning Bridge's region symmetric-difference
            # count without reinterpreting region labels or Task semantics.
            groups = []
            for key in ('review_a_regions', 'review_b_regions'):
                group = []
                for region in item[key]:
                    need(type(region) is list and len(region) == 6 and
                         type(region[0]) is int and type(region[1]) is int and
                         type(region[2]) is str and
                         all(x is None or type(x) is str for x in region[3:]),
                         'OWNER_DISAGREEMENT_REGIONS_INVALID')
                    group.append(tuple(region))
                need(len(set(group)) == len(group),
                     'OWNER_DISAGREEMENT_REGIONS_INVALID')
                groups.append(set(group))
            observed_region_difference += len(groups[0] ^ groups[1])
        need(type(native.get('disagreement_region_symmetric_difference')) is int and
             native['disagreement_region_symmetric_difference'] ==
             observed_region_difference,
             'OWNER_DISAGREEMENT_REGION_COUNT_MISMATCH')
        receipt = Path(temporary) / 'owner-bridge-receipt.json'
        receipt.write_text(json.dumps(native, ensure_ascii=False) + '\n', encoding='utf-8')
        effort_command = [sys.executable, str(script),
                          '--owner-bridge-receipt', str(receipt),
                          '--review-a', str(review_a), '--review-b', str(review_b),
                          '--out', str(staged_effort)]
        if hourly_rate_usd is not None:
            effort_command += ['--hourly-rate-usd', hourly_rate_usd]
        stage = safe_json(runner(effort_command, script.parent))
        need(stage.get('status') in ('LEAD_TIME_RECORDED_NOT_TASK_GOLD',
                                    'LEAD_TIME_PARTIAL_NOT_TASK_GOLD') and
             stage.get('sources') == 8 and stage.get('human_task_gold') is False,
             'EFFORT_RECEIPT_INCOMPATIBLE')
        need(tuple(sha256_file(p) for p in inputs) == pinned,
             'REVIEW_INPUT_CHANGED_AFTER_EFFORT')
        need(staged_effort.is_file(), 'EFFORT_OUTPUT_NOT_WRITTEN')
        effort = safe_json(staged_effort.read_text('utf-8'))
        need(effort.get('schema') == EFFORT_SCHEMA and
             effort.get('sources_verified') == 8 and
             effort.get('annotation_count') == 16 and
             effort.get('human_task_gold') is False and
             effort.get('adjudication_completed') is False and
             effort.get('source_text_exported') is False and
             effort.get('reviewer_ids_exported') is False,
             'EFFORT_FILE_INCOMPATIBLE')
        # The owning workflow uses one frozen pre-gold method. A success
        # receipt from the subprocess must not endorse a result file bound to
        # another method or frozen source selection.
        need(effort.get('method_output_sha256') ==
             effort_contract.EXPECTED_METHOD_SHA and
             effort.get('original_source_manifest_git_blob') ==
             effort_contract.MANIFEST_BLOB,
             'EFFORT_FROZEN_METHOD_BINDING_MISMATCH')
        # Verify that the exact receipt and saved artifact agree about
        # measured/partial platform time. This never asserts human attention
        # time, quality, adjudication, or completed scientific evaluation.
        complete = effort.get('label_studio_lead_time_seconds_total') is not None
        need(type(stage.get('complete_lead_time')) is bool and
             stage['complete_lead_time'] == complete and
             effort.get('status') == stage.get('status') and
             complete == (stage['status'] == 'LEAD_TIME_RECORDED_NOT_TASK_GOLD'),
             'EFFORT_RECEIPT_FILE_MISMATCH')
        need(tuple(sha256_file(p) for p in inputs) == pinned,
             'REVIEW_INPUT_CHANGED_BEFORE_PUBLICATION')
        need(not disagreements_out.exists() and not disagreements_out.is_symlink() and
             not effort_out.exists() and not effort_out.is_symlink(),
             'OWNER_LOCAL_OUTPUT_EXISTS_OR_CONFLICTS')
        # Same-filesystem links refuse overwrites. If the second link fails,
        # roll back only an inode that is still our own staged file. An external
        # process may replace the first path while publication is in progress;
        # blindly unlinking that name would delete its replacement.
        published = []
        try:
            for temporary_file, destination in (
                    (staged_disagreements, disagreements_out),
                    (staged_effort, effort_out)):
                temporary_file.chmod(0o600)
                identity = temporary_file.stat()
                os.link(temporary_file, destination)
                published.append((destination, identity.st_dev, identity.st_ino))
        except OSError:
            for destination, device, inode in published:
                try:
                    actual = destination.stat(follow_symlinks=False)
                    if (actual.st_dev, actual.st_ino) == (device, inode):
                        destination.unlink()
                except FileNotFoundError:
                    pass
                except OSError:
                    # Avoid deleting or replacing a path whose ownership
                    # cannot be established. The caller receives HOLD.
                    pass
            raise CycleHold('OWNER_LOCAL_OUTPUT_PUBLICATION_FAILED') from None
    # Deliberately no authority/grant flags, Task gold or reviewer IDs.
    return {
        'status': 'OWNER_BRIDGE_AND_REVIEW_EFFORT_COMPLETED_NOT_GOLD',
        'sources': 8, 'annotations': 16,
        'bridge_checked_not_adjudicated': True,
        'sources_with_disagreement': native['sources_with_disagreement'],
        'owner_review_instrument_git_blob': expected_owner_xml_blob,
        'owner_review_instrument_verified': True,
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
    except CycleHold as error:
        # Only allow predefined diagnostics; never expose a dynamic error.
        code = str(error)
        if code not in PUBLIC_HOLD_CODES:
            code = 'OWNER_LOCAL_M3_CYCLE_INCOMPLETE'
        print(json.dumps({'status': 'HOLD', 'code': code},
                         sort_keys=True), file=sys.stderr)
        return 2
    except (ValueError, OSError, TypeError):
        print(json.dumps({'status': 'HOLD', 'code': 'OWNER_LOCAL_M3_CYCLE_INCOMPLETE'},
                         sort_keys=True), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
