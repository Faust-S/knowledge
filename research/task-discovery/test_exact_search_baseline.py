"""Synthetic-only checks for pre-gold literal source lookup, never Task gold."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import exact_search_baseline as exact


def fixture(folder: Path):
    rows = []
    for i in range(8):
        title = 'Need a feature request' if i % 2 == 0 else 'Weekly notes'
        body = f'Observed behavior case {i}.\n' if i % 2 == 0 else f'Routine discussion case {i}.\n'
        raw = (title + '\n' + body + '\n').encode('utf-8')
        digest = hashlib.sha256(raw).hexdigest()
        item = {'repository': 'example/public', 'issue_number': i + 100,
                'html_url': f'https://github.com/example/public/issues/{i+100}',
                'projection_sha256': digest,
                'projection_bytes': len(raw),
                'body_sha256': hashlib.sha256(body.encode('utf-8')).hexdigest()}
        (folder / f'example__public__{i+100}.txt').write_bytes(raw)
        rows.append(item)
    return {'schema': exact.baseline.MANIFEST_SCHEMA, 'no_gold': True, 'items': rows}


def fake_output_digest(manifest):
    rows = [{'source_sha256': item['projection_sha256'], 'hit': i % 2 == 0}
            for i, item in enumerate(manifest['items'])]
    return exact.source_output_sha(rows)


class LiteralExactTests(unittest.TestCase):
    def test_exact_literal_full_source_and_no_gold(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = fixture(root)
            with patch.object(exact, 'OUTPUT_SHA', fake_output_digest(manifest)):
                result = exact.replay(manifest, input_dir=root)
            self.assertEqual(result['sources_verified'], 8)
            self.assertEqual(result['sources_with_literal_hit'], 4)
            self.assertEqual(result['sources_without_literal_hit_still_included'], 4)
            self.assertEqual([r['hit'] for r in result['source_rows']],
                             [True, False] * 4)
            self.assertFalse(result['human_gold'])
            self.assertIsNone(result['task_f1'])
            self.assertFalse(result['source_text_exported'])
            self.assertNotIn('Observed behavior', json.dumps(result))

    def test_casefold_and_literal_not_regex(self):
        self.assertTrue(exact.exact_hit(b'NEED to repair'))
        self.assertTrue(exact.exact_hit(b'Unrequested bugfix'))
        self.assertFalse(exact.exact_hit(b'Routine weekly note'))
        self.assertFalse(exact.exact_hit(b'Futures are scheduled'))

    def test_source_drift_rejected_even_if_outcome_unchanged(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = fixture(root)
            file = root / 'example__public__101.txt'
            file.write_bytes(file.read_bytes() + b'edited')
            with patch.object(exact, 'OUTPUT_SHA', fake_output_digest(manifest)):
                with self.assertRaises((exact.ExactHold,
                                        exact.baseline.BaselineHold)):
                    exact.replay(manifest, input_dir=root)

    def test_rule_change_and_output_change_both_refused(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = fixture(root)
            with patch.object(exact, 'TERMS', exact.TERMS + ('unknown',)):
                with self.assertRaisesRegex(exact.ExactHold,
                                            'PRE_GOLD_EXACT_RULE_CHANGED'):
                    exact.replay(manifest, input_dir=root)
            with self.assertRaisesRegex(exact.ExactHold,
                                        'PRE_GOLD_EXACT_SOURCE_OUTCOMES_CHANGED'):
                exact.replay(manifest, input_dir=root)

    def test_duplicate_source_rejected(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            manifest = fixture(root)
            manifest['items'][-1] = manifest['items'][0]
            with self.assertRaisesRegex(exact.ExactHold,
                                        'FROZEN_EXACT_SOURCE_IDENTITY_CHANGED'):
                exact.replay(manifest, input_dir=root)

    def test_real_method_config_is_pinned(self):
        self.assertEqual(exact.frozen.canonical_sha(exact.specification()),
                         exact.SPEC_SHA)
        self.assertEqual(len(exact.TERMS), 12)
        self.assertEqual(exact.OUTPUT_SHA,
                         '7512d8e85790cc4444214fc8757e3cb24c8214bfd54fe8a36e057f78aa16fec1')


if __name__ == '__main__':
    unittest.main()
