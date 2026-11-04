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


def frozen_literal(manifest):
    # Method-only synthetic fixture: never human gold or actual E5 evidence.
    selected = {0, 4, 5, 7}
    rows = [{"source_sha256": item["projection_sha256"], "hit": i in selected}
            for i, item in enumerate(manifest["items"])]
    return {
        "schema": compare.literal.SCHEMA,
        "status": "PINNED_LITERAL_SEARCH_BEFORE_HUMAN_GOLD",
        "frozen_manifest_git_blob": compare.frozen.MANIFEST_GIT_BLOB,
        "method_spec_sha256": compare.literal.SPEC_SHA,
        "method_output_sha256": compare.literal.source_output_sha(rows),
        "sources_verified": 8,
        "sources_with_literal_hit": 4,
        "sources_without_literal_hit_still_included": 4,
        "source_rows": rows,
        "source_text_exported": False,
        "human_gold": False,
        "task_precision": None, "task_recall": None, "task_f1": None,
    }


FIXTURE_METHOD_SHA = ms.freeze(*fake_inputs())["method_output_sha256"]


@patch.object(compare, "EXPECTED_METHOD_SHA", FIXTURE_METHOD_SHA)
@patch.object(compare.baseline, "TITLE_PATTERN", "immutable-method")
class PostReviewCueTests(unittest.TestCase):
    def test_source_metrics_use_frozen_cues_not_task_predictions(self):
        m, s, a = inputs()
        result = compare.analyze(
            m, s, a)
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
        self.assertNotIn('"source_text":', json.dumps(result))
        self.assertIs(result["source_text_exported"], False)

    def test_pinned_literal_is_fourth_source_level_method_not_task_f1(self):
        manifest, snap, review = inputs()
        literal = frozen_literal(manifest)
        with patch.object(compare.literal, "OUTPUT_SHA",
                          literal["method_output_sha256"]):
            result = compare.analyze(
                manifest, snap, review, literal_snapshot=literal)
        self.assertEqual(set(result["source_retrieval"]), set(compare.METHODS))
        stats = result["source_retrieval"]["literal_exact"]
        self.assertEqual((stats["tp"], stats["fp"], stats["fn"], stats["tn"]),
                         (2, 1, 0, 4))
        self.assertEqual((stats["resolved_denominator"], stats["unresolved_excluded"]),
                         (7, 1))
        self.assertEqual(result["exact_search_baseline"],
                         "PINNED_FULL_SOURCE_LITERAL_HITS_SCORED_NOT_TASK")
        self.assertEqual(result["literal_exact_output_sha256"],
                         literal["method_output_sha256"])
        self.assertFalse(result["human_gold"])
        self.assertIsNone(result["task_f1"])
        self.assertFalse(result["individual_source_resolutions_exported"])

    def test_literal_tamper_refused_even_when_hit_count_unchanged(self):
        manifest, snap, review = inputs()
        literal = frozen_literal(manifest)
        pinned = literal["method_output_sha256"]
        literal["source_rows"][0]["hit"] = False
        literal["source_rows"][1]["hit"] = True
        with patch.object(compare.literal, "OUTPUT_SHA", pinned):
            with self.assertRaisesRegex(
                    compare.ComparisonHold, "FROZEN_LITERAL_SOURCE_HITS_CHANGED"):
                compare.analyze(manifest, snap, review,
                                literal_snapshot=literal)

    def test_literal_replay_must_match_exact_manifest_and_method_pin(self):
        manifest, snap, review = inputs()
        literal = frozen_literal(manifest)
        pinned = literal["method_output_sha256"]
        with patch.object(compare.literal, "OUTPUT_SHA", pinned):
            bad = copy.deepcopy(literal)
            bad["method_output_sha256"] = "0" * 64
            with self.assertRaisesRegex(
                    compare.ComparisonHold, "FROZEN_LITERAL_REPLAY_NOT_VERIFIED"):
                compare.analyze(manifest, snap, review, literal_snapshot=bad)
            bad = copy.deepcopy(literal)
            bad["source_rows"][0]["source_sha256"] = "a" * 64
            with self.assertRaisesRegex(
                    compare.ComparisonHold, "FROZEN_LITERAL_SOURCE_ROWS_INVALID"):
                compare.analyze(manifest, snap, review, literal_snapshot=bad)
            bad = copy.deepcopy(literal)
            bad["human_gold"] = True
            with self.assertRaisesRegex(
                    compare.ComparisonHold, "FROZEN_LITERAL_REPLAY_NOT_VERIFIED"):
                compare.analyze(manifest, snap, review, literal_snapshot=bad)

    def test_refuse_false_adjudication_and_visibility_claims(self):
        for key in ("human_adjudication_claimed", "methods_hidden_during_review"):
            m, s, a = inputs()
            a[key] = False
            with self.subTest(key=key), self.assertRaisesRegex(
                    compare.ComparisonHold, "MANUAL_ADJUDICATION_NOT_CONFIRMED"):
                compare.analyze(m, s, a)

    def test_refuse_forged_frozen_method_digest(self):
        m, s, a = inputs()
        s["method_output_sha256"] = "0" * 64
        with self.assertRaisesRegex(
                compare.ComparisonHold, "FROZEN_METHOD_REPLAY_NOT_VERIFIED"):
            compare.analyze(m, s, a)

    def test_tampered_cue_coordinates_are_not_the_frozen_method(self):
        manifest, snapshot, review = inputs()
        # Reuse the original stored SHA but replace one actual frozen cue.
        snapshot["source_rows"][0]["title_regex_cue_spans"] = []
        with self.assertRaisesRegex(
                compare.ComparisonHold, "FROZEN_METHOD_COORDINATES_CHANGED"):
            compare.analyze(manifest, snapshot, review)

    def test_unpinned_hash_override_is_not_part_of_public_analysis(self):
        manifest, snapshot, review = inputs()
        with self.assertRaises(TypeError):
            compare.analyze(manifest, snapshot, review,
                            method_sha=snapshot["method_output_sha256"])

    def test_no_negative_label_from_unresolved_source(self):
        m, s, a = inputs(["UNRESOLVED"] * 8)
        out = compare.analyze(m, s, a)
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

    def test_zero_cues_with_confirmed_task_has_measurable_zero_f1(self):
        # No lexical cue predicted, but a human adjudicator found a task:
        # TP=0 FP=0 FN=1 TN=7; precision undefined, recall/F1 = 0.
        m, s, a = inputs(["TASK_PRESENT"] + ["NO_TASK"] * 7)
        out = compare.analyze(
            m, s, a)
        no_cues = compare.confusion(
            set(), {r["source_sha256"]: entry["resolution"]
                    for r, entry in zip(s["source_rows"], a["sources"])})
        self.assertEqual((no_cues["tp"], no_cues["fp"],
                          no_cues["fn"], no_cues["tn"]), (0, 0, 1, 7))
        self.assertIsNone(no_cues["precision"])
        self.assertEqual(no_cues["recall"], 0.0)
        self.assertEqual(no_cues["f1"], 0.0)
        # On this fixture the pinned U1 also has only negative cues.
        self.assertEqual(out["source_retrieval"]["pinned_u1"]["f1"], 0.0)
        self.assertFalse(out["human_gold"])
        self.assertIsNone(out["task_f1"])

    def test_false_cue_with_no_positive_gold_has_zero_f1(self):
        m, s, a = inputs(["NO_TASK"] * 8)
        out = compare.analyze(
            m, s, a)
        title = out["source_retrieval"]["title_regex"]
        self.assertEqual((title["tp"], title["fp"], title["fn"]), (0, 3, 0))
        self.assertEqual(title["precision"], 0.0)
        self.assertIsNone(title["recall"])
        self.assertEqual(title["f1"], 0.0)
        self.assertEqual(title["resolved_denominator"], 8)

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
                compare.analyze(m, s, a)

    def test_manual_source_input_never_augments_engine_or_gold(self):
        m, s, a = inputs()
        a["task_f1"] = 1.0
        with self.assertRaisesRegex(
                compare.ComparisonHold, "MANUAL_ADJUDICATION_NOT_CONFIRMED"):
            compare.analyze(m, s, a)
        m, s, a = inputs()
        s["task_candidates_created"] = 1
        with self.assertRaisesRegex(
                compare.ComparisonHold, "FROZEN_METHOD_REPLAY_NOT_VERIFIED"):
            compare.analyze(m, s, a)


    def test_main_exact_search_hold_is_controlled_without_traceback(self):
        # A frozen literal replay may refuse changed source bytes.
        # The operator receives only the fixed safe HOLD, never a traceback.
        from io import StringIO
        from pathlib import Path
        import sys
        fake_argv = ["source_cue_post_review.py",
                     "--manual-adjudication", "/PRIVATE/reviewer-adjudication.json"]
        with (
            patch.object(sys, "argv", fake_argv),
            patch.object(compare.effort, "read_json", return_value={}),
            patch.object(compare, "replay_method", return_value=({}, {})),
            patch.object(compare.literal, "replay",
                         side_effect=compare.literal.ExactHold(
                             "FROZEN_EXACT_SOURCE_BYTES_CHANGED")),
            patch.object(sys, "stderr", new_callable=StringIO) as err,
        ):
            self.assertEqual(compare.main(), 2)
            output = json.loads(err.getvalue())
        self.assertEqual(output, {
            "status": "HOLD",
            "code": "SOURCE_CUE_EXPLORATORY_ANALYSIS_INCOMPLETE",
        })
        self.assertNotIn("FROZEN_EXACT_SOURCE_BYTES_CHANGED", json.dumps(output))
        self.assertNotIn("/PRIVATE", json.dumps(output))


if __name__ == "__main__":
    unittest.main()
