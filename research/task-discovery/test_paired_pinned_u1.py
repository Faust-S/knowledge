"""Paired replay contract tests (synthetic; no human-task gold)."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import paired_pinned_u1 as pair
from test_source_first_baseline import fixture


class FakeOwner:
    def inspect(self, raw, claim, *, today):
        return {"unit_count": 1,
                "units": [{"id": "test", "kind": "RawStatement",
                           "locator": {"byte_start": 0, "byte_end": len(raw)}}],
                "source": {"id": "source"}, "engine_accepted": False}

    def review_hints(self, raw, claim, *, today):
        start = raw.find(b"Request")
        hits = ([] if start < 0 else [{"source_unit_id": "test",
                  "cue_byte_start": start, "cue_byte_end": start + 7,
                  "cue_kind": "TEST_ONLY"}])
        return {"source": {"id": "source"}, "hints": hits,
                "hint_count": len(hits), "candidate_task_count": 0,
                "task_type_ids_assigned": 0, "engine_accepted": False}


class PairedTests(unittest.TestCase):
    def test_symmetric_same_source_pair_without_gold(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            manifest = fixture(root)
            report = pair.paired_run(manifest, input_dir=root,
                load=lambda: (FakeOwner(), "PINNED_TEST_ONLY",
                              lambda metadata, raw: {"sha": metadata["projection_sha256"]}))
            self.assertEqual(report["sources_verified"], 8)
            self.assertEqual(report["u1_raw_statements"], 8)
            self.assertEqual(report["pinned_u1_cues"], 4)
            self.assertEqual(report["title_cues"], 12)
            self.assertEqual(report["source_level_cue_intersection"], 4)
            self.assertEqual(report["source_level_cue_union"], 4)
            self.assertEqual(report["sources_without_either_cue_still_included"], 4)
            self.assertFalse(report["human_gold"])
            self.assertIsNone(report["task_f1"])
            self.assertNotIn("Case 1 description", json.dumps(report))

    def test_invalid_pinned_u1_locator_refused(self):
        class Bad(FakeOwner):
            def review_hints(self, raw, claim, *, today):
                output = super().review_hints(raw, claim, today=today)
                if output["hints"]:
                    output["hints"][0]["cue_byte_end"] = 999999
                return output
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            manifest = fixture(root)
            with self.assertRaisesRegex(pair.baseline.BaselineHold,
                                        "PINNED_U1_EVIDENCE_NOT_SOURCE_BOUND"):
                pair.paired_run(manifest, input_dir=root,
                    load=lambda: (Bad(), "PINNED_TEST_ONLY", lambda m, r: {}))


if __name__ == "__main__":
    unittest.main()
