"""K05 source-offset projection for owner K03 issue evidence, no second evaluator."""
from __future__ import annotations
import copy
import hashlib
import json
import sys
from pathlib import Path
from unittest import TestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import k05_evaluation as k05


def example():
    raw = b"Request help\nThere is a problem with performance.\n"
    ref = "https://github.com/public/example/issues/123"
    digest = hashlib.sha256(raw).hexdigest()
    manifest = json.dumps({
        "schema": "IWXA_TASK_EXP_01_PUBLIC_ISSUE_SOURCE_SLICE/0.1",
        "no_gold": True,
        "items": [{
            "html_url": ref,
            "projection_sha256": digest,
            "projection_bytes": len(raw),
            "source_projection": "TITLE_NEWLINE_BODY_NEWLINE_UTF8",
        }],
    }, sort_keys=True).encode()
    blob = k05.git_blob_sha(manifest)
    begin = raw.index(b"problem")
    bundle = {
        "schema": "IWXA_K03_PUBLIC_ISSUE_DISCOVERY/0.1.0",
        "case_id": "ISSUE-" + digest[:16],
        "source_ref": ref,
        "source_sha256": digest,
        "source_manifest_git_blob": blob,
        "human_task_gold": False,
        "accepted_task_count": 0,
        "task_type_accepted": False,
        "source_text_exported": False,
        "activity_observations": [
            {"id": "O-1", "source_ref": ref, "source_sha256": digest,
             "source_version": blob, "locator": {
                 "byte_start": 0, "byte_end": len(raw)}},
            {"id": "E-1", "source_ref": ref, "source_sha256": digest,
             "source_version": blob, "locator": {
                 "byte_start": begin, "byte_end": begin + 7},
             "cue_kind": "REPORTED_PROBLEM_REVIEW_CUE"},
        ],
    }
    return bundle, raw, manifest, blob


class K03SourceProjectionTests(TestCase):
    def project(self, bundle, raw, manifest, blob):
        return k05.project_k03_issue_evidence(
            bundle, raw, manifest_bytes=manifest,
            expected_manifest_git_blob=blob)

    def test_matching_revision_source_locator_and_portable_receipt(self):
        bundle, raw, manifest, blob = example()
        proof = self.project(bundle, raw, manifest, blob)
        self.assertEqual(proof["schema"], "IWXA_K05_SOURCE_OFFSET_PROJECTION/0.1")
        self.assertTrue(proof["scope"]["source_sha256_verified"])
        self.assertTrue(proof["scope"]["source_locator_verified"])
        self.assertFalse(proof["scope"]["k03_native_u1_replayed_by_k05"])
        self.assertEqual(proof["measured"]["direct_read_reference_bytes"], len(raw))
        self.assertEqual(proof["measured"]["pinned_cue_excerpt_bytes"], 7)
        self.assertLess(proof["measured"]["pinned_cue_excerpt_bytes"], len(raw))
        self.assertIsNone(proof["evidence_observations"][1]["observation"]["claim"])
        self.assertIsNone(proof["evidence_observations"][1]["observation"]["git_blob_sha"])
        self.assertTrue(k05.verify_k03_source_projection(
            proof, bundle, raw, manifest_bytes=manifest,
            expected_manifest_git_blob=blob))
        self.assertNotIn("There is a problem", json.dumps(proof))

    def test_stale_revisions_are_rejected(self):
        bundle, raw, manifest, blob = example()
        changed = raw.replace(b"problem", b"trouble")
        self.assertEqual(len(changed), len(raw))
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_VERSION_MISMATCH"):
            self.project(bundle, changed, manifest, blob)
        stale = copy.deepcopy(bundle)
        stale["source_sha256"] = "0" * 64
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_MANIFEST_BINDING_CHANGED"):
            self.project(stale, raw, manifest, blob)
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_MANIFEST_VERSION_CHANGED"):
            self.project(bundle, raw, manifest + b" ", blob)

    def test_unsubstantiated_claim_and_forged_span_are_rejected(self):
        bundle, raw, manifest, blob = example()
        invented = copy.deepcopy(bundle)
        invented["activity_observations"][1]["claim"] = "TASK_ALREADY_COMPLETED"
        with self.assertRaisesRegex(k05.PinMismatch, "UNSUPPORTED_SEMANTIC_ASSERTION"):
            self.project(invented, raw, manifest, blob)
        forged = copy.deepcopy(bundle)
        forged["activity_observations"][1]["asserted_span_sha256"] = "0" * 64
        with self.assertRaisesRegex(k05.PinMismatch, "ASSERTED_SPAN_NOT_SOURCE_BOUND"):
            self.project(forged, raw, manifest, blob)
        missing = copy.deepcopy(bundle)
        missing["activity_observations"][1]["source_ref"] = "https://github.com/other/issues/1"
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_OBSERVATION_REVISION_CHANGED"):
            self.project(missing, raw, manifest, blob)

    def test_invalid_locator_and_modified_receipt_are_rejected(self):
        bundle, raw, manifest, blob = example()
        proof = self.project(bundle, raw, manifest, blob)
        proof["evidence_observations"][1]["source_span_sha256"] = "0" * 64
        self.assertFalse(k05.verify_k03_source_projection(
            proof, bundle, raw, manifest_bytes=manifest,
            expected_manifest_git_blob=blob))
        changed = copy.deepcopy(bundle)
        changed["activity_observations"][1]["locator"]["byte_end"] = len(raw) + 1
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_LOCATOR_INVALID"):
            self.project(changed, raw, manifest, blob)
        changed = copy.deepcopy(bundle)
        changed["activity_observations"][1]["locator"]["byte_start"] = True
        with self.assertRaisesRegex(k05.PinMismatch, "SOURCE_LOCATOR_INVALID"):
            self.project(changed, raw, manifest, blob)

    def test_no_human_gold_metrics_or_task_acceptance(self):
        bundle, raw, manifest, blob = example()
        proof = self.project(bundle, raw, manifest, blob)
        for name in ("task_precision", "task_recall", "task_f1",
                     "human_task_completion_ms", "semantic_claim_accuracy"):
            self.assertIsNone(proof["unknown"][name])
        self.assertFalse(proof["unknown"]["human_task_gold"])
        self.assertEqual(proof["unknown"]["agent_result_readback"], "NOT_TESTED")
        promoted = copy.deepcopy(bundle)
        promoted["human_task_gold"] = True
        with self.assertRaisesRegex(k05.PinMismatch, "TASK_AUTHORITY_NOT_SOURCE_EVIDENCE"):
            self.project(promoted, raw, manifest, blob)
        promoted = copy.deepcopy(bundle)
        promoted["accepted_task_count"] = 1
        with self.assertRaisesRegex(k05.PinMismatch, "TASK_AUTHORITY_NOT_SOURCE_EVIDENCE"):
            self.project(promoted, raw, manifest, blob)
