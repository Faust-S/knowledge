"""K05 -> Agent 0.3: existing ComparisonResult/0.2, no Result authority.

Consumer reads already-authorized pinned bytes supplied by U02/source host.
No connector, Store, Task evaluator or new public receipt schema is defined.
"""
from __future__ import annotations

from dataclasses import asdict, replace
import copy
import hashlib
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import k05_evaluation as k05


def fixture(a: bytes = b"version = 3.12.0\n", b: bytes = b"version = 3.13.0\n",
            *, expected: str = "EVIDENCE_CHANGED") -> tuple[k05.EvaluationCase, dict[str, bytes]]:
    older = k05.SourcePin(
        "python/cpython", "README.rst", "a" * 40,
        k05.git_blob_sha(a), 1, a.decode().strip(), "RELEASE_VERSION_OLDER"
    )
    newer = k05.SourcePin(
        "python/cpython", "README.rst", "b" * 40,
        k05.git_blob_sha(b), 1, b.decode().strip(), "RELEASE_VERSION_NEWER"
    )
    return k05.EvaluationCase("K05_AGENT_RESULT_EVIDENCE", (older, newer), expected), {
        older.version: a, newer.version: b,
    }


def verified_result_evidence(
    case: k05.EvaluationCase,
    authorized_bytes: dict[str, bytes],
) -> dict:
    """One in-process P01-ready evidence payload without claiming Result save.

    Never return a positive Result field without verifying recomputed evidence.
    The host's own Result schema/store remains responsible for persistence.
    """
    receipt = asdict(k05.evaluate_case(case, authorized_bytes, rounds=1))
    if not k05.verify_evidence_receipt(receipt, case, authorized_bytes):
        raise k05.PinMismatch("K05_RESULT_EVIDENCE_RECHECK_FAILED")
    return receipt


class AgentConsumerEvidence(unittest.TestCase):
    def test_two_revisions_provide_source_refs_line_sha_and_qualified_claim(self):
        case, raw = fixture()
        result = verified_result_evidence(case, raw)
        self.assertEqual(result["schema"], "IWXA_K05_COMPARISON_RESULT/0.2")
        self.assertEqual(result["status"], "CONFIRMED")
        self.assertEqual(result["tested"]["status"], "EVIDENCE_CHANGED")
        self.assertEqual(result["checks"]["baseline_tested_agreement"], True)
        obs = result["tested"]["observations"]
        self.assertEqual(len(obs), 2)
        for pin, record in zip(case.sources, obs):
            self.assertEqual(record["source"], "https://github.com/"
                             + pin.repository + "/blob/" + pin.version + "/" + pin.path)
            self.assertEqual(record["version"], pin.version)
            self.assertEqual(record["git_blob_sha"], pin.blob_sha)
            self.assertEqual(record["sha256"], hashlib.sha256(raw[pin.version]).hexdigest())
            self.assertEqual(record["locator"], "L1")
            self.assertEqual(record["line_sha256"],
                             hashlib.sha256(raw[pin.version].strip()).hexdigest())
            self.assertEqual(record["state"], "OBSERVED")
        self.assertFalse(result["scope"]["claim_labels_semantically_validated"])
        self.assertIsNone(result["unknown"]["semantic_claim_accuracy"])
        self.assertEqual(result["unknown"]["agent_result_readback"], "NOT_TESTED")

    def test_stable_observation_does_not_generate_conflict(self):
        case, raw = fixture(b"feature = active\n", b"feature = active\n",
                            expected="EVIDENCE_UNCHANGED")
        output = verified_result_evidence(case, raw)
        self.assertEqual(output["status"], "CONFIRMED")
        self.assertEqual(output["tested"]["status"], "EVIDENCE_UNCHANGED")

    def test_strict_literal_conflict_only_not_free_form_semantics(self):
        case, raw = fixture(b"enabled: true\n", b"enabled: false\n",
                            expected="LITERAL_CONFLICT")
        outcome = verified_result_evidence(case, raw)
        self.assertEqual(outcome["tested"]["status"], "LITERAL_CONFLICT")
        self.assertIsNone(outcome["unknown"]["semantic_claim_accuracy"])
        case = replace(case, expected_check="EVIDENCE_CHANGED")
        mismatched = verified_result_evidence(case, raw)
        self.assertEqual(mismatched["status"], "EXPECTED_RELATION_NOT_OBSERVED")
        self.assertFalse(mismatched["checks"]["expected_check_met"])

    def test_missing_or_modified_authorized_source_fails_closed(self):
        case, raw = fixture()
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_VERSION_UNAVAILABLE"):
            verified_result_evidence(case, {case.sources[0].version: raw[case.sources[0].version]})
        altered = dict(raw)
        altered[case.sources[1].version] += b"# stale or changed content\n"
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_VERSION_MISMATCH"):
            verified_result_evidence(case, altered)

    def test_unconfirmed_claim_is_unknown_not_accepted(self):
        case, raw = fixture(b"version = 3.12.0\n", b"version = 3.13.0\n")
        case = replace(case, sources=(case.sources[0], replace(
            case.sources[1], anchor="a statement never present in document")))
        receipt = verified_result_evidence(case, raw)
        self.assertEqual(receipt["status"], "UNKNOWN")
        self.assertEqual(receipt["tested"]["observations"][1]["state"], "UNKNOWN")
        self.assertIsNone(receipt["tested"]["observations"][1]["claim"])

    def test_forged_line_digest_locator_or_baseline_is_not_reusable(self):
        case, raw = fixture()
        for mutation in ("sha", "locator", "baseline", "version", "missing_observation"):
            receipt = verified_result_evidence(case, raw)
            obs = receipt["tested"]["observations"]
            if mutation == "sha":
                obs[0]["line_sha256"] = "0" * 64
            elif mutation == "locator":
                obs[0]["locator"] = "L200"
            elif mutation == "version":
                obs[0]["version"] = "f" * 40
            elif mutation == "baseline":
                receipt["baseline"]["status"] = "AGREEMENT"
            else:
                obs.pop()
            with self.subTest(mutation=mutation):
                self.assertFalse(k05.verify_evidence_receipt(receipt, case, raw))

    def test_extra_result_authority_fields_rejected(self):
        case, raw = fixture()
        for key, value in (
            ("task_accepted", True), ("human_gold", True),
            ("result_saved", True), ("is_current", True),
        ):
            receipt = verified_result_evidence(case, raw)
            receipt[key] = value
            with self.subTest(key=key):
                self.assertFalse(k05.verify_evidence_receipt(receipt, case, raw))

    def test_extra_nested_fields_rejected(self):
        case, raw = fixture()
        receipt = verified_result_evidence(case, raw)
        receipt["scope"]["task_f1"] = 1.0
        self.assertFalse(k05.verify_evidence_receipt(receipt, case, raw))
        receipt = verified_result_evidence(case, raw)
        receipt["measured"]["human_completion_time_ms"] = 1
        self.assertFalse(k05.verify_evidence_receipt(receipt, case, raw))

    def test_suite_receipt_is_still_accepted_without_new_schema(self):
        case, raw = fixture()
        suite_sources = {(p.repository, p.path, p.version): raw[p.version]
                         for p in case.sources}
        suite = k05.evaluate_suite((case,), suite_sources, rounds=2)
        self.assertTrue(k05.verify_suite_receipt(suite, (case,), suite_sources))
        suite["cases"][0]["task_accepted"] = True
        self.assertFalse(k05.verify_suite_receipt(suite, (case,), suite_sources))

    def test_k03_hypothesis_is_not_promoted_into_accepted_task(self):
        case, raw = fixture()
        receipt = verified_result_evidence(case, raw)
        self.assertNotIn("task_created", receipt)
        self.assertNotIn("task_accepted", receipt)
        self.assertFalse(receipt["scope"]["human_gold"])
        self.assertEqual(receipt["unknown"]["agent_result_readback"], "NOT_TESTED")


if __name__ == "__main__":
    unittest.main()
