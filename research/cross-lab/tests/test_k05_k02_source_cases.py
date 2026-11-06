from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import k05_k02_source_cases as cases
import k05_evaluation as k05


class K02SourceCaseTests(unittest.TestCase):
    def test_predeclared_eight_case_classes_and_sources(self):
        self.assertEqual(len(cases.TASKS), 8)
        self.assertEqual(len({x.case_id for x in cases.TASKS}), 8)
        self.assertEqual({x.difficulty for x in cases.TASKS}, {"simple", "moderate", "complex"})
        self.assertEqual(sum(x.source_code_required for x in cases.TASKS), 1)
        self.assertEqual(sum(x.judge.startswith("UNKNOWN") for x in cases.TASKS), 2)
        self.assertEqual(cases.K02_OWNER_COMMIT, "2fac2a6b007a84f3cf14220d2d4a668f9d97916c")

    def test_source_code_needs_exact_verified_owner_blob(self):
        data = b"hostAuthorityGranted:false,proofOfInvoke:null,\n"
        with patch.object(cases, "K02_OWNER_BLOB", k05.git_blob_sha(data)):
            proof = cases._owner_code_evidence(data)
        self.assertEqual(proof["source_assertion"], "MODEL_RECOMMENDATION_NOT_EXECUTION_AUTHORITY")
        self.assertEqual(proof["locator"], "L1")
        self.assertEqual(proof["git_blob_sha"], k05.git_blob_sha(data))
        with patch.object(cases, "K02_OWNER_BLOB", "0" * 40):
            with self.assertRaisesRegex(k05.PinMismatch, "K02_SOURCE_REVISION_MISMATCH"):
                cases._owner_code_evidence(data)

    def test_missing_or_duplicate_source_code_anchor_rejected(self):
        with patch.object(cases, "K02_OWNER_BLOB", k05.git_blob_sha(b"no evidence\n")):
            with self.assertRaisesRegex(k05.PinMismatch, "K02_SOURCE_CODE_ANCHOR_UNSUPPORTED"):
                cases._owner_code_evidence(b"no evidence\n")
        raw = (cases.CODE_ANCHOR + "\n") * 2
        with patch.object(cases, "K02_OWNER_BLOB", k05.git_blob_sha(raw.encode())):
            with self.assertRaisesRegex(k05.PinMismatch, "K02_SOURCE_CODE_ANCHOR_UNSUPPORTED"):
                cases._owner_code_evidence(raw.encode())

    def test_source_corpus_cannot_promote_gold_or_inference_metrics(self):
        source_code = cases.CODE_ANCHOR.encode()
        pins = {}
        # Create real K05 suite entries using real source pin objects, but use
        # the actual source bytes in separate CI to prove pinned Git SHA.
        for item in k05.PUBLIC_SUITE:
            for pin in item.sources:
                pins[(pin.repository, pin.path, pin.version)] = b""
        fake_suite = {
            "schema": k05.SUITE_SCHEMA,
            "status": "PASS",
            "summary": {"unique_source_versions": 6},
            "cases": [
                {
                    "case_id": c.case_id, "status": "CONFIRMED",
                    "tested": {"observations": [
                        {"source": "https://github.com/" + p.repository, "version": p.version}
                        for p in c.sources]},
                }
                for c in k05.PUBLIC_SUITE
            ],
        }
        with patch.object(cases.k05, "evaluate_suite", return_value=fake_suite), \
             patch.object(cases.k05, "verify_suite_receipt", return_value=True), \
             patch.object(cases, "_owner_code_evidence", return_value={
                 "source_ref": "pinned:K02", "version": cases.K02_OWNER_COMMIT,
                 "git_blob_sha": cases.K02_OWNER_BLOB}):
            report = cases.build_source_corpus(pins, source_code)
        self.assertEqual(report["case_count"], 8)
        self.assertEqual(report["unique_verified_source_versions"], 7)
        self.assertIsNone(report["inference_cost_usd"])
        self.assertIsNone(report["inference_latency_ms"])
        self.assertIsNone(report["router_cost_usd"])
        self.assertIsNone(report["task_f1"])
        self.assertEqual(report["model_quality"], "NOT_MEASURED")
        self.assertTrue(all(x["quality_gold"] is None for x in report["cases"]))
        self.assertTrue(all(x["model_responses"] is None for x in report["cases"]))

    def test_incomplete_suite_or_false_source_status_rejected(self):
        fake_suite = {"status": "HOLD", "schema": k05.SUITE_SCHEMA}
        with patch.object(cases.k05, "evaluate_suite", return_value=fake_suite), \
             patch.object(cases.k05, "verify_suite_receipt", return_value=False):
            with self.assertRaisesRegex(k05.PinMismatch, "K05_SOURCE_SUITE_UNVERIFIED"):
                cases.build_source_corpus({}, b"")


if __name__ == "__main__":
    unittest.main()
