"""Pure method-snapshot engineering checks, no human task gold."""
from __future__ import annotations
import copy
import hashlib
import json
import unittest

import method_snapshot as ms


def fake_inputs():
    items = []
    rows = []
    for i in range(8):
        repo, number = "example/public", 100 + i
        url = f"https://github.com/{repo}/issues/{number}"
        digest = hashlib.sha256(str(i).encode()).hexdigest()
        items.append({"repository": repo, "issue_number": number,
                      "html_url": url, "projection_sha256": digest,
                      "projection_bytes": 100})
        rows.append({"repository": repo, "issue_number": number,
                     "source_sha256": digest, "source_first_included": True,
                     "task_discovery_label": None, "u1_raw_statements": 2,
                     "title_regex_cue_spans": ([{"byte_start": 0, "byte_end": 4}] if i < 3 else []),
                     "pinned_u1_review_cue_spans": ([{"byte_start": 7, "byte_end": 12,
                             "cue_kind": "REPORTED_PROBLEM_REVIEW_CUE"}] if i in (2, 4) else [])})
    manifest = {"schema": "IWXA_TASK_EXP_01_PUBLIC_ISSUE_SOURCE_SLICE/0.1",
                "no_gold": True, "items": items}
    report = {"schema": ms.PAIRED_SCHEMA,
              "status": "PINNED_OWNER_U1_VS_TITLE_CUES_NO_HUMAN_GOLD",
              "u1_owner_snapshot_blob": ms.OWNER_U1_GIT_BLOB,
              "human_gold": False, "task_precision": None, "task_recall": None,
              "task_f1": None, "human_review_time_ms": None,
              "task_candidates_created": 0, "source_text_published": False,
              "sources_verified": 8, "sources_review_included": 8,
              "title_pattern_sha256": hashlib.sha256(b"immutable-method").hexdigest(),
              "u1_raw_statements": 16, "pinned_u1_cues": 2, "title_cues": 3,
              "sources_with_pinned_u1_cues": 2, "sources_with_title_cues": 3,
              "source_level_cue_intersection": 1, "source_level_cue_union": 4,
              "sources_without_either_cue_still_included": 4,
              "source_rows": rows}
    return manifest, report


class MethodSnapshotTests(unittest.TestCase):
    def test_cue_silent_sources_are_retained_without_gold(self):
        manifest, report = fake_inputs()
        frozen = ms.freeze(manifest, report)
        self.assertEqual(frozen["sources"], 8)
        self.assertEqual(frozen["source_level_without_either_cue"], 4)
        self.assertEqual(len(frozen["source_rows"]), 8)
        self.assertFalse(frozen["human_gold"])
        self.assertIsNone(frozen["task_precision"])
        self.assertNotIn("source_text", json.dumps(frozen["source_rows"]))
        self.assertNotIn("annotations", json.dumps(frozen))
        self.assertEqual(frozen["method_output_sha256"], ms.freeze(manifest, report)["method_output_sha256"])

    def test_reordering_rows_does_not_change_frozen_sha(self):
        manifest, report = fake_inputs()
        before = ms.freeze(manifest, report)
        report["source_rows"].reverse()
        after = ms.freeze(manifest, report)
        self.assertEqual(before["method_output_sha256"], after["method_output_sha256"])

    def test_changed_sha_is_refused(self):
        manifest, report = fake_inputs()
        report["source_rows"][2]["source_sha256"] = "0" * 64
        with self.assertRaisesRegex(ms.SnapshotHold, "METHOD_SOURCE_IDENTITY_OR_LABEL_MISMATCH"):
            ms.freeze(manifest, report)

    def test_missing_cue_silent_source_is_refused(self):
        manifest, report = fake_inputs()
        report["source_rows"][7] = copy.deepcopy(report["source_rows"][0])
        with self.assertRaisesRegex(ms.SnapshotHold, "METHOD_SOURCE_IDENTITY_OR_LABEL_MISMATCH"):
            ms.freeze(manifest, report)

    def test_human_gold_or_task_claim_is_refused(self):
        manifest, report = fake_inputs()
        report["human_gold"] = True
        with self.assertRaisesRegex(ms.SnapshotHold, "UNQUALIFIED_OR_AUTHORITY"):
            ms.freeze(manifest, report)
        report["human_gold"] = False
        report["task_candidates_created"] = 1
        with self.assertRaisesRegex(ms.SnapshotHold, "UNQUALIFIED_OR_AUTHORITY"):
            ms.freeze(manifest, report)

    def test_secret_or_raw_text_fields_refused(self):
        manifest, report = fake_inputs()
        report["source_rows"][0]["source_text"] = "private"
        with self.assertRaisesRegex(ms.SnapshotHold, "INVALID_METHOD_ROW_SHAPE"):
            ms.freeze(manifest, report)

    def test_invalid_byte_offset_and_unknown_kind_refused(self):
        manifest, report = fake_inputs()
        report["source_rows"][2]["title_regex_cue_spans"][0]["byte_end"] = 500
        with self.assertRaisesRegex(ms.SnapshotHold, "INVALID_TITLE_OFFSET"):
            ms.freeze(manifest, report)
        manifest, report = fake_inputs()
        report["source_rows"][2]["pinned_u1_review_cue_spans"][0]["cue_kind"] = "ACCEPTED_TASK"
        with self.assertRaisesRegex(ms.SnapshotHold, "UNEXPECTED_U1_CUE_KIND"):
            ms.freeze(manifest, report)

    def test_summary_inconsistency_refused(self):
        manifest, report = fake_inputs()
        report["source_level_cue_union"] = 3
        with self.assertRaisesRegex(ms.SnapshotHold, "METHOD_TOTALS_MISMATCH"):
            ms.freeze(manifest, report)

    def test_git_blob_hash_matches_python(self):
        self.assertEqual(ms.git_blob_sha(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a")

if __name__ == "__main__":
    unittest.main()
