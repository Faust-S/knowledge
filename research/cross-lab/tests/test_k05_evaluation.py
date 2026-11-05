from __future__ import annotations

from dataclasses import asdict, replace
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import k05_evaluation as k05


def make_case(a: bytes = b"item: catalog\n", b: bytes = b"item: unified\n"):
    pin_a = k05.SourcePin(
        "Faust-S/knowledge", "AGENTS.md", "a" * 40, k05.git_blob_sha(a),
        1, "item: catalog", "CATALOG"
    )
    pin_b = k05.SourcePin(
        "Faust-S/knowledge", "AGENTS.md", "b" * 40, k05.git_blob_sha(b),
        1, "item: unified", "UNIFIED"
    )
    return k05.EvaluationCase("OFFLINE_CASE", (pin_a, pin_b)), {
        pin_a.version: a, pin_b.version: b
    }


class K05Tests(unittest.TestCase):
    def test_two_pinned_versions_conflict_and_baseline_agree(self):
        case, source = make_case()
        result = asdict(k05.evaluate_case(case, source, rounds=3))
        self.assertEqual(result["status"], "CONFIRMED")
        self.assertFalse(result["scope"]["claim_labels_semantically_validated"])
        self.assertIsNone(result["unknown"]["semantic_claim_accuracy"])
        self.assertEqual(result["baseline"]["status"], "EVIDENCE_CHANGED")
        self.assertEqual(result["tested"]["status"], "EVIDENCE_CHANGED")
        self.assertEqual([o["state"] for o in result["tested"]["observations"]],
                         ["OBSERVED", "OBSERVED"])
        self.assertEqual([o["locator"] for o in result["tested"]["observations"]],
                         ["L1", "L1"])
        self.assertTrue(result["checks"]["baseline_tested_agreement"])
        self.assertEqual(result["measured"]["versions_verified"], 2)
        self.assertLessEqual(result["tested"]["review_bytes"], result["baseline"]["review_bytes"])
        self.assertFalse(result["scope"]["human_gold"])
        self.assertIsNone(result["unknown"]["precision"])
        self.assertEqual(result["unknown"]["agent_result_readback"], "NOT_TESTED")
        self.assertNotIn("item: catalog", str(result))

    def test_modified_source_hard_fails_instead_of_unknown(self):
        case, source = make_case()
        source[case.sources[0].version] += b"changed"
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_VERSION_MISMATCH"):
            k05.evaluate_case(case, source)

    def test_missing_source_is_hold(self):
        case, source = make_case()
        source.pop(case.sources[1].version)
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_VERSION_UNAVAILABLE"):
            k05.evaluate_case(case, source)

    def test_missing_anchor_returns_unknown_without_supported_claim(self):
        case, source = make_case(b"item: catalog\n", b"item: changed\n")
        case = replace(case, sources=(case.sources[0],
                                     replace(case.sources[1],
                                             blob_sha=k05.git_blob_sha(source["b" * 40]))))
        result = asdict(k05.evaluate_case(case, source, rounds=1))
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertEqual(result["tested"]["observations"][1]["state"], "UNKNOWN")
        self.assertIsNone(result["tested"]["observations"][1]["claim"])
        self.assertFalse(result["checks"]["expected_check_met"])

    def test_stale_locator_detected_by_baseline_divergence(self):
        case, source = make_case(b"item: catalog\n", b"prefix\nitem: unified\n")
        case = replace(case, sources=(case.sources[0],
                                     replace(case.sources[1],
                                             blob_sha=k05.git_blob_sha(source["b" * 40]))))
        result = asdict(k05.evaluate_case(case, source, rounds=1))
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertEqual(result["baseline"]["observations"][1]["locator"], "L2")
        self.assertFalse(result["checks"]["baseline_tested_agreement"])

    def test_ambiguous_direct_source_is_not_silently_accepted(self):
        case, source = make_case(b"item: catalog\nitem: catalog\n", b"item: unified\n")
        case = replace(case, sources=(replace(case.sources[0],
                                             blob_sha=k05.git_blob_sha(source["a" * 40])),
                                     case.sources[1]))
        result = asdict(k05.evaluate_case(case, source, rounds=2))
        self.assertEqual(result["baseline"]["observations"][0]["state"], "UNKNOWN")
        self.assertEqual(result["status"], "UNKNOWN")

    def test_invalid_case_and_remote_source_rejected(self):
        case, sources = make_case()
        with self.assertRaisesRegex(ValueError, "DISTINCT"):
            k05.evaluate_case(replace(case, sources=(case.sources[0], case.sources[0])), sources)
        with self.assertRaisesRegex(ValueError, "ROUNDS"):
            k05.evaluate_case(case, sources, rounds=0)
        with self.assertRaisesRegex(k05.PinMismatch, "REMOTE_SOURCE_NOT_ALLOWLISTED"):
            k05.fetch_public_pinned_source(replace(case.sources[0], path="private.txt"))


    def test_explicit_boolean_literals_only_prove_narrow_conflict(self):
        case, sources = make_case(b"enabled: true\n", b"enabled: false\n")
        case = replace(
            case,
            expected_check="LITERAL_CONFLICT",
            sources=(
                replace(case.sources[0], anchor="enabled: true",
                        blob_sha=k05.git_blob_sha(sources["a" * 40])),
                replace(case.sources[1], anchor="enabled: false",
                        blob_sha=k05.git_blob_sha(sources["b" * 40])),
            ),
        )
        result = asdict(k05.evaluate_case(case, sources, rounds=2))
        self.assertEqual(result["status"], "CONFIRMED")
        self.assertEqual(result["tested"]["status"], "LITERAL_CONFLICT")
        self.assertEqual(result["tested"]["observations"][0]["literal_value"], True)
        self.assertEqual(result["tested"]["observations"][1]["literal_value"], False)

    def test_different_claim_labels_do_not_prove_semantic_conflict(self):
        case, sources = make_case(b"same line\n", b"same line\n")
        case = replace(
            case,
            expected_check="EVIDENCE_UNCHANGED",
            sources=(
                replace(case.sources[0], anchor="same line",
                        blob_sha=k05.git_blob_sha(sources["a" * 40])),
                replace(case.sources[1], anchor="same line",
                        blob_sha=k05.git_blob_sha(sources["b" * 40])),
            ),
        )
        result = asdict(k05.evaluate_case(case, sources, rounds=1))
        self.assertEqual(result["status"], "CONFIRMED")
        self.assertEqual(result["tested"]["status"], "EVIDENCE_UNCHANGED")

    def test_wrong_expected_relation_cannot_be_confirmed(self):
        case, sources = make_case()
        case = replace(case, expected_check="LITERAL_CONFLICT")
        result = k05.evaluate_case(case, sources, rounds=1)
        self.assertEqual(result.status, "EXPECTED_RELATION_NOT_OBSERVED")
        self.assertFalse(result.checks["expected_check_met"])

    def test_receipt_detects_mutated_evidence_without_claiming_readback(self):
        case, sources = make_case()
        receipt = asdict(k05.evaluate_case(case, sources, rounds=2))
        self.assertTrue(k05.verify_evidence_receipt(receipt, case, sources))
        receipt["tested"]["observations"][0]["line_sha256"] = "0" * 64
        self.assertFalse(k05.verify_evidence_receipt(receipt, case, sources))

    def test_receipt_requires_correct_source_version_and_unknown_fields(self):
        case, sources = make_case()
        receipt = asdict(k05.evaluate_case(case, sources, rounds=1))
        receipt["unknown"]["agent_result_readback"] = "PASS"
        self.assertFalse(k05.verify_evidence_receipt(receipt, case, sources))
        receipt = asdict(k05.evaluate_case(case, sources, rounds=1))
        receipt["scope"]["source_access"] = "SYNTHETIC"
        self.assertFalse(k05.verify_evidence_receipt(receipt, case, sources))

    def test_boolean_round_count_rejected(self):
        case, sources = make_case()
        with self.assertRaisesRegex(ValueError, "INVALID_BENCHMARK_ROUNDS"):
            k05.evaluate_case(case, sources, rounds=True)

    def test_real_pin_metadata_stable(self):
        p, q = k05.PUBLIC_CASE.sources
        self.assertEqual((p.repository, p.path), (q.repository, q.path))
        self.assertNotEqual(p.version, q.version)
        self.assertNotEqual(p.blob_sha, q.blob_sha)
        self.assertEqual((p.locator_line, q.locator_line), (3, 5))
        self.assertEqual(k05.SCHEMA, "IWXA_K05_COMPARISON_RESULT/0.2")

    def test_remote_replay_uses_real_verified_bytes_without_readback_claims(self):
        case, sources = make_case()
        with patch.object(k05, "PUBLIC_CASE", case), patch.object(
            k05, "fetch_public_pinned_source",
            side_effect=lambda pin: sources[pin.version]
        ):
            result = k05.public_replay(rounds=1)
        self.assertEqual(result.status, "CONFIRMED")
        self.assertIsNone(result.unknown["human_completion_time_ms"])
        self.assertEqual(result.unknown["agent_result_readback"], "NOT_TESTED")


if __name__ == "__main__":
    unittest.main()
