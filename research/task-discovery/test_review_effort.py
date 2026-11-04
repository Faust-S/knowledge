"""Synthetic Label Studio transport regressions; NOT human Task gold."""
import copy
from decimal import Decimal
import hashlib
import json
import unittest

import review_effort as e


def fixture():
    selected = {}
    a, b = [], []
    for n in range(8):
        text = f'Synthetic task {n}\nObserved issue {n}.\n\n'
        raw = text.encode('utf-8')
        sha = hashlib.sha256(raw).hexdigest()
        url = f'https://github.com/example/fixture/issues/{n+101}'
        selected[sha] = {'projection_bytes': len(raw), 'html_url': url,
                         'updated_at': '2026-11-03T10:10:00Z'}
        data = {'source_text': text, 'source_sha256': 'sha256:' + sha,
                'source_ref': url, 'source_edition': '2026-11-03T10:10:00Z'}
        a.append({'data': copy.deepcopy(data), 'annotations': [
            {'result': [], 'completed_by': 10, 'lead_time': float(n + 1), 'was_cancelled': False}]})
        b.append({'data': copy.deepcopy(data), 'annotations': [
            {'result': [], 'completed_by': {'id': 20}, 'lead_time': float(2 * (n+1)),
             'was_cancelled': False}]})
    owner = {'schema': e.BRIDGE_SCHEMA,
             'status': 'BLINDED_REVIEW_CLAIMS_CHECKED_NOT_ADJUDICATED_NOT_GOLD',
             'reviewer_ids_distinct': True, 'sources_checked': 8,
             'adjudication_completed': False, 'human_task_gold': False}
    return a, b, owner, selected


class EffortTests(unittest.TestCase):
    def test_full_eight_plus_eight_and_cost(self):
        a, b, receipt, sources = fixture()
        out = e.summarize(a[::-1], b, receipt, sources, 'pinned', hourly_rate_usd=Decimal('60'))
        self.assertEqual(out['status'], 'LEAD_TIME_RECORDED_NOT_TASK_GOLD')
        self.assertEqual(out['label_studio_lead_time_seconds_total'], 108.0)
        self.assertEqual(out['estimated_review_cost_usd'], '1.8000')
        self.assertEqual(out['reviewer_slots']['A']['lead_time_seconds_p90_nearest_rank'], 8.0)
        self.assertEqual(out['reviewer_slots']['B']['lead_time_seconds_median'], 9.0)
        self.assertFalse(out['human_task_gold'])
        self.assertFalse(out['reviewer_independence_independently_verified'])
        self.assertNotIn('Synthetic task', json.dumps(out))
        self.assertNotIn('example/fixture', json.dumps(out))
        self.assertNotIn('completed_by', json.dumps(out))

    def test_missing_lead_time_is_not_zero_or_completed_cost(self):
        a, b, receipt, sources = fixture()
        a[0]['annotations'][0].pop('lead_time')
        out = e.summarize(a, b, receipt, sources, 'pinned', hourly_rate_usd=Decimal('60'))
        self.assertEqual(out['status'], 'LEAD_TIME_PARTIAL_NOT_TASK_GOLD')
        self.assertIsNone(out['label_studio_lead_time_seconds_total'])
        self.assertIsNone(out['estimated_review_cost_usd'])
        self.assertEqual(out['reviewer_slots']['A']['lead_time_missing'], 1)

    def test_strict_local_json_rejects_duplicate_keys_and_nonfinite(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as folder:
            path = Path(folder) / 'review.json'
            for value, expected in (
                ('{"a":1,"a":2}', 'LOCAL_JSON_DUPLICATE_KEY'),
                ('{"a":{"b":1,"b":2}}', 'LOCAL_JSON_DUPLICATE_KEY'),
                ('{"a":NaN}', 'LOCAL_JSON_NONFINITE_NUMBER'),
                ('{"a":Infinity}', 'LOCAL_JSON_NONFINITE_NUMBER'),
                ('{"a":1e999}', 'LOCAL_JSON_NONFINITE_NUMBER'),
                ('{"a":-1e999}', 'LOCAL_JSON_NONFINITE_NUMBER'),
                ('{"a":-Infinity}', 'LOCAL_JSON_NONFINITE_NUMBER'),
                ('{"a":', 'LOCAL_JSON_INVALID'),
            ):
                with self.subTest(value=value):
                    path.write_text(value, encoding='utf-8')
                    with self.assertRaisesRegex(e.EffortHold, expected):
                        e.read_json(path)

    def test_finite_individual_times_must_not_overflow_slot_or_total(self):
        a, b, receipt, sources = fixture()
        # Every sample is finite, but sum of eight is Infinity in float.
        for row in a:
            row['annotations'][0]['lead_time'] = 1e308
        with self.assertRaisesRegex(e.EffortHold,
                                    'LABEL_STUDIO_LEAD_TIME_TOTAL_NONFINITE'):
            e.summarize(a, b, receipt, sources, 'pinned')
        a, b, receipt, sources = fixture()
        # Each reviewer's sum stays finite; their combined total overflows.
        for row in a + b:
            row['annotations'][0]['lead_time'] = 1.2e307
        with self.assertRaisesRegex(e.EffortHold,
                                    'LABEL_STUDIO_LEAD_TIME_TOTAL_NONFINITE'):
            e.summarize(a, b, receipt, sources, 'pinned')

    def test_regular_partial_time_remains_null_and_serializable(self):
        a, b, receipt, sources = fixture()
        b[0]['annotations'][0].pop('lead_time')
        output = e.summarize(a, b, receipt, sources, 'pinned')
        self.assertIsNone(output['label_studio_lead_time_seconds_total'])
        self.assertEqual(output['status'], 'LEAD_TIME_PARTIAL_NOT_TASK_GOLD')
        json.dumps(output, allow_nan=False)

    def test_restricted_output_publishes_complete_json_exclusively(self):
        import os
        from pathlib import Path
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as td:
            path = Path(td) / 'effort.json'
            payload = {'human_task_gold': False, 'status': 'synthetic'}
            e.write_restricted_result(path, payload)
            self.assertEqual(json.loads(path.read_text('utf-8')), payload)
            if os.name == 'posix':
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaisesRegex(e.EffortHold,
                                        'REFUSE_OVERWRITE_EFFORT_RECEIPT'):
                e.write_restricted_result(path, {'overwritten': True})
            self.assertEqual(json.loads(path.read_text('utf-8')), payload)
            self.assertFalse(list(Path(td).glob('.iwxa-m3-effort-*')))

    def test_restricted_output_write_failure_leaves_no_partial_result(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import patch
        with TemporaryDirectory() as td:
            path = Path(td) / 'effort.json'
            with patch.object(e.json, 'dump', side_effect=OSError('disk unavailable')):
                with self.assertRaises(OSError):
                    e.write_restricted_result(path, {'test': 'synthetic'})
            self.assertFalse(path.exists())
            self.assertFalse(list(Path(td).glob('.iwxa-m3-effort-*')))
            with patch.object(e.os, 'link', side_effect=OSError('link unavailable')):
                with self.assertRaises(OSError):
                    e.write_restricted_result(path, {'test': 'synthetic'})
            self.assertFalse(path.exists())
            self.assertFalse(list(Path(td).glob('.iwxa-m3-effort-*')))
            with self.assertRaises(ValueError):
                e.write_restricted_result(path, {'unsafe': float('inf')})
            self.assertFalse(path.exists())
            e.write_restricted_result(path, {'retry': True})
            self.assertEqual(json.loads(path.read_text('utf-8')), {'retry': True})

    def test_restricted_output_rejects_dangling_symlink(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as td:
            root = Path(td)
            path = root / 'effort.json'
            try:
                path.symlink_to(root / 'nonexistent')
            except (OSError, NotImplementedError):
                self.skipTest('OS does not support symlinks')
            with self.assertRaisesRegex(e.EffortHold,
                                        'REFUSE_OVERWRITE_EFFORT_RECEIPT'):
                e.write_restricted_result(path, {'synthetic': True})
            self.assertTrue(path.is_symlink())
            self.assertFalse((root / 'nonexistent').exists())

    def test_source_changed_rejected(self):
        a, b, receipt, sources = fixture()
        a[0]['data']['source_text'] += 'changed'
        with self.assertRaisesRegex(e.EffortHold, 'REVIEW_EXPORT_SOURCE_MISMATCH'):
            e.summarize(a,b,receipt,sources,'pinned')

    def test_duplicate_or_missing_source_rejected(self):
        a, b, receipt, sources = fixture()
        a[2] = copy.deepcopy(a[0])
        with self.assertRaisesRegex(e.EffortHold, 'REVIEW_EXPORT_SOURCE_MISMATCH'):
            e.summarize(a,b,receipt,sources,'pinned')
        a,b,receipt,sources=fixture()
        a.pop()
        with self.assertRaisesRegex(e.EffortHold, 'REVIEW_EXPORT_INCOMPLETE'):
            e.summarize(a,b,receipt,sources,'pinned')

    def test_source_predictions_or_cancelled_review_rejected(self):
        a,b,r,s=fixture()
        b[0]['predictions']=[{'model_version':'injected'}]
        with self.assertRaisesRegex(e.EffortHold, 'REVIEW_EXPORT_NOT_SOURCE_FIRST'):
            e.summarize(a,b,r,s,'pinned')
        a,b,r,s=fixture()
        b[0]['annotations'][0]['was_cancelled'] = True
        with self.assertRaisesRegex(e.EffortHold, 'REVIEW_EXPORT_NOT_COMPLETED'):
            e.summarize(a,b,r,s,'pinned')

    def test_invalid_time_is_hold(self):
        for bad in (float('nan'), float('inf'), -1.0, '3.5', True):
            a,b,r,s=fixture()
            a[0]['annotations'][0]['lead_time'] = bad
            with self.subTest(value=bad), self.assertRaisesRegex(e.EffortHold, 'LABEL_STUDIO_LEAD_TIME_INVALID'):
                e.summarize(a,b,r,s,'pinned')

    def test_bridge_required_and_distinct_reviewer_claims(self):
        a,b,r,s=fixture()
        r['status']='GOLD'
        with self.assertRaisesRegex(e.EffortHold,'OWNER_REVIEW_BRIDGE_RECEIPT_REQUIRED'):
            e.summarize(a,b,r,s,'pinned')
        a,b,r,s=fixture()
        for x in b:x['annotations'][0]['completed_by']=10
        with self.assertRaisesRegex(e.EffortHold,'SAME_REVIEWER_CLAIM'):
            e.summarize(a,b,r,s,'pinned')

    def test_uncertain_rate_is_not_real_expense(self):
        a,b,r,s=fixture()
        out=e.summarize(a,b,r,s,'pinned')
        self.assertIsNone(out['estimated_review_cost_usd'])
        self.assertIsNone(out['hourly_rate_usd_assumed'])
        with self.assertRaisesRegex(e.EffortHold,'ASSUMED_HOURLY_RATE_INVALID'):
            e.summarize(a,b,r,s,'pinned',hourly_rate_usd=Decimal('-1'))


if __name__ == '__main__':
    unittest.main()
