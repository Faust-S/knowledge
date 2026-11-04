"""Offline orchestration tests. All review inputs are synthetic; never E5 gold."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import owner_review_cycle as cycle


class CycleFixture:
    def __init__(self, location: Path):
        self.root = location
        self.owner_root = location / 'owner'
        catalog = self.owner_root / 'knowledge' / 'task-catalog'
        bridge = catalog / 'engine' / 'research' / 'task_exp_01_review_bridge.py'
        bridge.parent.mkdir(parents=True)
        bridge.write_text('''# synthetic bridge stub; never actual owner labels\n''', encoding='utf-8')
        self.bridge_blob = cycle.git_blob(bridge.read_bytes())
        self.packet = location / 'packet.json'
        self.a = location / 'a.json'
        self.b = location / 'b.json'
        for path in (self.packet, self.a, self.b):
            path.write_text('{"fixture":"not real review"}\n', encoding='utf-8')
        self.disagreement = location / 'private-diff.json'
        self.effort = location / 'private-effort.json'
        self.effort_script = location / 'review_effort.py'
        self.effort_script.write_text('# synthetic executable placeholder\n', encoding='utf-8')
        self.calls = []

    def runner(self, command, cwd):
        self.calls.append((command, cwd))
        if len(self.calls) == 1:
            Path(command[command.index('--restricted-disagreement-output') + 1]).write_text(
                json.dumps({
                    'schema': 'IWXA_TASK_EXP_01_LOCAL_DISAGREEMENT_PACKET/0.1',
                    'status': 'ADJUDICATION_PENDING_NO_AUTOMATIC_TASK_ADOPTION',
                    'disagreements': [], 'human_task_gold': False,
                }) + '\n', encoding='utf-8')
            return json.dumps({
                'schema': cycle.BRIDGE_SCHEMA,
                'status': 'BLINDED_REVIEW_CLAIMS_CHECKED_NOT_ADJUDICATED_NOT_GOLD',
                'sources_checked': 8, 'sources_with_disagreement': 0,
                'reviewer_ids_distinct': True,
                'human_task_gold': False, 'adjudication_completed': False})
        if len(self.calls) == 2:
            Path(command[command.index('--out') + 1]).write_text(json.dumps({
                'schema': cycle.EFFORT_SCHEMA, 'sources_verified': 8,
                'annotation_count': 16, 'human_task_gold': False,
                'adjudication_completed': False, 'source_text_exported': False,
                'reviewer_ids_exported': False,
                'label_studio_lead_time_seconds_total': 72.0}) + '\n', encoding='utf-8')
            return json.dumps({'status': 'LEAD_TIME_RECORDED_NOT_TASK_GOLD',
                               'sources': 8, 'human_task_gold': False})
        raise AssertionError('unexpected third process')

    def execute(self, **overrides):
        options = dict(owner_root=self.owner_root, packet=self.packet,
                       review_a=self.a, review_b=self.b,
                       disagreements_out=self.disagreement, effort_out=self.effort,
                       confirmation=True, runner=self.runner,
                       expected_owner_blob=self.bridge_blob,
                       effort_script=self.effort_script)
        options.update(overrides)
        with patch.object(cycle, 'OWNER_BRIDGE_BLOB', self.bridge_blob):
            return cycle.run_cycle(**options)


class OwnerReviewCycleTests(unittest.TestCase):
    def test_owner_and_effort_are_invoked_in_order_and_bound_to_same_files(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in (f.packet, f.a, f.b)]
            result = f.execute(hourly_rate_usd='50.50')
            self.assertEqual(result['status'], 'OWNER_BRIDGE_AND_REVIEW_EFFORT_COMPLETED_NOT_GOLD')
            self.assertEqual(result['annotations'], 16)
            self.assertEqual(result['sources_with_disagreement'], 0)
            self.assertFalse(result['human_gold'])
            self.assertEqual(len(f.calls), 2)
            native, wc = f.calls[0]
            effort, ec = f.calls[1]
            self.assertEqual(wc, f.owner_root / 'knowledge' / 'task-catalog')
            self.assertEqual(ec, f.effort_script.parent)
            self.assertEqual(native[1:3], ['-m', 'engine.research.task_exp_01_review_bridge'])
            self.assertIn('--confirm-independent-local-review', native)
            self.assertIn('--owner-bridge-receipt', effort)
            self.assertEqual(effort[effort.index('--review-a') + 1], str(f.a))
            self.assertEqual(effort[effort.index('--review-b') + 1], str(f.b))
            self.assertEqual(effort[-2:], ['--hourly-rate-usd', '50.50'])
            self.assertTrue(f.disagreement.exists() and f.effort.exists())
            self.assertEqual(before, [hashlib.sha256(p.read_bytes()).hexdigest()
                                      for p in (f.packet, f.a, f.b)])
            self.assertNotIn('fixture', json.dumps(result))

    def test_never_claim_review_without_explicit_local_confirmation(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            with self.assertRaisesRegex(cycle.CycleHold, 'EXPLICIT_LOCAL_REVIEW_CONFIRMATION_REQUIRED'):
                f.execute(confirmation=False)
            self.assertFalse(f.calls)

    def test_owner_bridge_revision_change_is_hold(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            with self.assertRaisesRegex(cycle.CycleHold, 'OWNER_BRIDGE_TEST_PIN_MISMATCH'):
                f.execute(expected_owner_blob='0' * 40)
            self.assertFalse(f.calls)

    def test_unqualified_bridge_receipt_cannot_trigger_effort(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            def fake(command, cwd):
                f.calls.append((command, cwd))
                return '{"schema":"OTHER","human_task_gold":true}'
            with self.assertRaisesRegex(cycle.CycleHold, 'OWNER_BRIDGE_RECEIPT_INCOMPATIBLE'):
                f.execute(runner=fake)
            self.assertEqual(len(f.calls), 1)
            self.assertFalse(f.effort.exists())

    def test_changed_export_after_owner_bridge_is_hold_before_effort(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            def changing(command, cwd):
                response = f.runner(command, cwd)
                f.a.write_text('{"modified":true}\n', encoding='utf-8')
                return response
            with self.assertRaisesRegex(cycle.CycleHold, 'REVIEW_INPUT_CHANGED_AFTER_BRIDGE'):
                f.execute(runner=changing)
            self.assertEqual(len(f.calls), 1)

    def test_changed_export_during_effort_is_hold(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            def changing(command, cwd):
                response = f.runner(command, cwd)
                if len(f.calls) == 2:
                    f.b.write_text('{"modified":true}\n', encoding='utf-8')
                return response
            with self.assertRaisesRegex(cycle.CycleHold, 'REVIEW_INPUT_CHANGED_AFTER_EFFORT'):
                f.execute(runner=changing)
            self.assertEqual(len(f.calls), 2)

    def test_missing_disagreement_packet_rejects_bridge_success(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            def missing(command, cwd):
                result = f.runner(command, cwd)
                if len(f.calls) == 1:
                    Path(command[command.index('--restricted-disagreement-output') + 1]).unlink()
                return result
            with self.assertRaisesRegex(cycle.CycleHold,
                                        'OWNER_DISAGREEMENTS_NOT_WRITTEN'):
                f.execute(runner=missing)
            self.assertEqual(len(f.calls), 1)
            self.assertFalse(f.effort.exists())

    def test_corrupt_disagreement_packet_is_hold(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            def invalid(command, cwd):
                result = f.runner(command, cwd)
                if len(f.calls) == 1:
                    Path(command[command.index('--restricted-disagreement-output') + 1]).write_text(
                        '{"schema":"wrong","disagreements":[]}\n',
                        encoding='utf-8')
                return result
            with self.assertRaisesRegex(cycle.CycleHold,
                                        'OWNER_DISAGREEMENTS_INCOMPATIBLE'):
                f.execute(runner=invalid)
            self.assertEqual(len(f.calls), 1)

    def test_disagreement_count_mismatch_is_hold(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            def mismatch(command, cwd):
                result = f.runner(command, cwd)
                if len(f.calls) == 1:
                    actual = Path(command[command.index('--restricted-disagreement-output') + 1])
                    obj = json.loads(actual.read_text('utf-8'))
                    obj['disagreements'] = [{'source_sha256': 'unmatched'}]
                    actual.write_text(json.dumps(obj), encoding='utf-8')
                return result
            with self.assertRaisesRegex(cycle.CycleHold,
                                        'OWNER_DISAGREEMENTS_INCOMPATIBLE'):
                f.execute(runner=mismatch)
            self.assertEqual(len(f.calls), 1)

    def test_missing_effort_file_does_not_claim_completion(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            def no_write(command, cwd):
                if not f.calls:
                    return f.runner(command, cwd)
                return json.dumps({'status':'LEAD_TIME_RECORDED_NOT_TASK_GOLD',
                                   'sources':8,'human_task_gold':False})
            with self.assertRaisesRegex(cycle.CycleHold, 'EFFORT_OUTPUT_NOT_WRITTEN'):
                f.execute(runner=no_write)

    def test_second_step_failure_never_publishes_partial_private_results(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            def failing_second(command, cwd):
                if not f.calls:
                    return f.runner(command, cwd)
                raise cycle.CycleHold('SYNTHETIC_EFFORT_FAILURE')
            with self.assertRaisesRegex(cycle.CycleHold, 'SYNTHETIC_EFFORT_FAILURE'):
                f.execute(runner=failing_second)
            self.assertFalse(f.disagreement.exists())
            self.assertFalse(f.effort.exists())
            # Rerun with the same verified inputs works; no manual cleanup.
            f.calls.clear()
            self.assertFalse(f.execute()['human_gold'])
            self.assertTrue(f.disagreement.exists() and f.effort.exists())

    def test_conflicting_output_race_rolls_back_only_our_first_link(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            def racing(command, cwd):
                result = f.runner(command, cwd)
                if len(f.calls) == 2:
                    f.effort.write_text('created-by-another-process\n', encoding='utf-8')
                return result
            with self.assertRaisesRegex(
                    cycle.CycleHold, 'OWNER_LOCAL_OUTPUT_PUBLICATION_FAILED'):
                f.execute(runner=racing)
            self.assertFalse(f.disagreement.exists())
            self.assertEqual(f.effort.read_text('utf-8'), 'created-by-another-process\n')
            self.assertEqual(len(f.calls), 2)

    def test_published_private_outputs_have_restricted_permissions(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            f.execute()
            if __import__('os').name == 'posix':
                self.assertEqual(f.disagreement.stat().st_mode & 0o777, 0o600)
                self.assertEqual(f.effort.stat().st_mode & 0o777, 0o600)

    def test_inputs_and_output_paths_must_be_distinct(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            with self.assertRaisesRegex(cycle.CycleHold, 'OWNER_LOCAL_INPUT_OUTPUT_ALIAS_REFUSED'):
                f.execute(effort_out=f.disagreement)
            with self.assertRaisesRegex(cycle.CycleHold, 'OWNER_LOCAL_INPUT_OUTPUT_ALIAS_REFUSED'):
                f.execute(review_b=f.a)

    def test_symlinked_reviewer_input_is_refused_before_execution(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            alias = f.root / 'review-a-alias.json'
            alias.symlink_to(f.a)
            with self.assertRaisesRegex(
                    cycle.CycleHold, 'OWNER_LOCAL_SYMLINK_PATH_REFUSED'):
                f.execute(review_a=alias)
            self.assertFalse(f.calls)

    def test_output_cannot_alias_an_input(self):
        with TemporaryDirectory() as td:
            f = CycleFixture(Path(td))
            with self.assertRaisesRegex(
                    cycle.CycleHold, 'OWNER_LOCAL_INPUT_OUTPUT_ALIAS_REFUSED'):
                f.execute(effort_out=f.packet)
            self.assertFalse(f.calls)

    def test_bad_json_or_duplicate_keys_cannot_qualify(self):
        for value in ('{"schema":"a","schema":"b"}', '{"a":NaN}', '[1,2,3]'):
            with self.subTest(value=value), self.assertRaises(cycle.CycleHold):
                cycle.safe_json(value)


if __name__ == '__main__':
    unittest.main()
