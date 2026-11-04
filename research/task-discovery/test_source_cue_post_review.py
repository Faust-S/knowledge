"""Synthetic-only checks for source-cue descriptive analysis (no Task gold)."""
from __future__ import annotations

import copy
import json
import unittest
from unittest.mock import patch

import method_snapshot as ms
import source_cue_post_review as compare
from test_method_snapshot import fake_inputs


def inputs(statuses=None):
    manifest, report = fake_inputs()
    snap = ms.freeze(manifest, report)
    values = statuses or [
        "TASK_PRESENT", "NO_TASK", "NO_TASK", "NO_TASK",
        "TASK_PRESENT", "NO_TASK", "NO_TASK", "UNRESOLVED",
    ]
    review = {
        "schema": compare.INPUT_SCHEMA,
        "human_adjudication_claimed": True,
        "methods_hidden_during_review": True,
        "sources": [
            {"source_sha256": row["projection_sha256"], "resolution": state}
            for row, state in zip(manifest["items"], values)
        ],
    }
    return manifest, snap, review


class PostReviewCueTests(unittest.TestCase):
    def test_source_metrics_use_frozen_cues_not_task_predictions(self):
        m, s, a = inputs()
        result = compare.analyze(
            m, s, a, method_sha=s["method_output_sha256"])
        self.assertEqual((result["resolved_sources"],
                          result["unresolved_sources"]), (7, 1))
        self.assertEqual(
            (result["source_retrieval"]["title_regex"]["tp"],
             result["source_retrieval"]["title_regex"]["fp"],
             result["source_retrieval"]["title_regex"]["fn"],
             result["source_retrieval"]["title_regex"]["tn"]),
            (1, 2, 1, 3))
        self.assertEqual(
            (result["source_retrieval"]["pinned_u1"]["tp"],
             result["source_retrieval"]["pinned_u1"]["fp"],
             result["source_retrieval"]["pinned_u1"]["fn"],
             result["source_retrieval"]["pinned_u1"]["tn"]),
            (1, 1, 1, 4))
        self.assertEqual(
            (result["source_retrieval"]["either_cue"]["tp"],
             result["source_retrieval"]["either_cue"]["fp"],
             result["source_retrieval"]["either_cue"]["fn"],
             result["source_retrieval"]["either_cue"]["tn"]),
            (2, 2, 0, 3))
        self.assertAlmostEqual(result["source_retrieval"]["title_regex"]["precision"], 1/3)
        self.assertEqual(result["source_retrieval"]["either_cue"]["recall"], 1.0)
        self.assertFalse(result["human_gold"])
        self.assertIsNone(result["task_f1"])
        self.assertFalse(result["human_independence_independently_verified"])
        self.assertNotIn("source_ref", json.dumps(result))
        self.assertNotIn("TASK_PRESENT", json.dumps(result))
        self.assertNotIn("source_text", json.dumps(result))

    def test_refuse_false_adjudication_and_visibility_claims(self):
        for key in ("human_adjudication_claimed", "methods_hidden_during_review"):
            m, s, a = inputs()
            a[key] = False
            with self.subTest(key=key), self.assertRaisesRegex(
                    compare.ComparisonHold, "MANUAL_ADJUDICATION_NOT_CONFIRMED"):
                compare.analyze(m, s, a, method_sha=s["method_output_sha256"])

    def test_refuse_forged_frozen_method_digest(self):
        m, s, a = inputs()
        s["method_output_sha256"] = "0" * 64
        with self.assertRaisesRegex(
                compare.ComparisonHold, "FROZEN_METHOD_REPLAY_NOT_VERIFIED"):
            compare.analyze(m, s, a, method_sha=compare.EXPECTED_METHOD_SHA)

    def test_no_negative_label_from_unresolved_source(self):
        m, s, a = inputs(["UNRESOLVED"] * 8)
        out = compare.analyze(m, s, a, method_sha=s["method_output_sha256"])
        c = out["source_retrieval"]["either_cue"]
        self.assertEqual(c["resolved_denominator"], 0)
        self.assertEqual(c["unresolved_excluded"], 8)
        self.assertIsNone(c["precision"])
        self.assertIsNone(c["recall"])
        self.assertIsNone(c["f1"])

    def test_zero_precision_denominator_is_undefined(self):
        m, s, a = inputs(["NO_TASK"] * 8)
        # Explicitly use no-positive cue set to exercise null vs zero.
        c = compare.confusion(set(), {r["source_sha256"]: "NO_TASK"
                                     for r in s["source_rows"]})
        self.assertEqual(c["tn"], 8)
        self.assertIsNone(c["precision"])
        self.assertIsNone(c["recall"])
        self.assertIsNone(c["f1"])

    def test_resolutions_must_cover_exact_frozen_eight_once(self):
        for alteration, code in (
                ("duplicate", "MANUAL_SOURCE_SELECTION_OR_RESOLUTION_INVALID"),
                ("foreign", "MANUAL_SOURCE_SELECTION_OR_RESOLUTION_INVALID"),
                ("invalid", "MANUAL_SOURCE_SELECTION_OR_RESOLUTION_INVALID"),
                ("missing", "MANUAL_ADJUDICATION_NOT_CONFIRMED"),
        ):
            m, s, a = inputs()
            if alteration == "duplicate":
                a["sources"][7]["source_sha256"] = a["sources"][0]["source_sha256"]
            elif alteration == "foreign":
                a["sources"][7]["source_sha256"] = "a" * 64
            elif alteration == "invalid":
                a["sources"][0]["resolution"] = True
            else:
                a["sources"].pop()
            with self.subTest(alteration=alteration), self.assertRaisesRegex(
                    compare.ComparisonHold, code):
                compare.analyze(m, s, a, method_sha=s["method_output_sha256"])

    def test_manual_source_input_never_augments_engine_or_gold(self):
        m, s, a = inputs()
        a["task_f1"] = 1.0
        with self.assertRaisesRegex(
                compare.ComparisonHold, "MANUAL_ADJUDICATION_NOT_CONFIRMED"):
            compare.analyze(m, s, a, method_sha=s["method_output_sha256"])
        m, s, a = inputs()
        s["task_candidates_created"] = 1
        with self.assertRaisesRegex(
                compare.ComparisonHold, "FROZEN_METHOD_REPLAY_NOT_VERIFIED"):
            compare.analyze(m, s, a, method_sha=s["method_output_sha256"])


if __name__ == "__main__":
    unittest.main()
