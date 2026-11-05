"""K03 issue adapter: deterministic source/selection contract, not Task gold."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import issue_replay as issue
import k03


def example(*, hints=True, title=False):
    sha = "a" * 64
    row = {
        "source_ref": "https://github.com/owner/repo/issues/123",
        "source_sha256": sha,
        "u1_raw_statements": 2,
        "u1_review_cue_spans": (
            [{"byte_start": 8, "byte_end": 15,
              "cue_kind": "REPORTED_PROBLEM_REVIEW_CUE"}] if hints else []),
        "title_regex_cue_spans": (
            [{"byte_start": 0, "byte_end": 3}] if title else []),
    }
    item = {
        "repository": "owner/repo", "issue_number": 123,
        "html_url": row["source_ref"], "projection_sha256": sha,
        "projection_bytes": 100,
    }
    return item, row


class SourceContractTests(TestCase):
    def test_pre_gold_manifest_is_byte_pinned(self):
        manifest = issue.checked_manifest()
        self.assertEqual(len(manifest["items"]), 8)
        self.assertTrue(manifest["no_gold"])

    def test_source_to_candidate_links_are_not_tasks(self):
        item, row = example()
        bundle = issue.issue_case(item, row, exact_hit=True)
        self.assertEqual(bundle["route"], "QUALIFICATION_REQUIRED")
        self.assertEqual(len(bundle["task_hypotheses"]), 1)
        self.assertEqual(len(bundle["clarification_requests"]), 1)
        self.assertEqual(len(bundle["activity_observations"]), 2)
        h = bundle["task_hypotheses"][0]
        self.assertFalse(h["independent_field_confirmation"])
        self.assertEqual(h["status"], "PROPOSED_NOT_QUALIFIED_TASK")
        self.assertEqual(bundle["activity_observations"][1]["tag"], "reported")
        self.assertEqual(bundle["activity_observations"][1]["locator"]["byte_start"], 8)
        self.assertEqual(h["evidence_links"][0]["evidence_id"],
                         bundle["activity_observations"][1]["id"])
        self.assertEqual(bundle["accepted_task_count"], 0)
        self.assertFalse(bundle["task_type_accepted"])
        self.assertFalse(bundle["human_task_gold"])
        self.assertFalse(bundle["source_text_exported"])
        self.assertEqual(
            issue.verify_issue_case(bundle, item, row, exact_hit=True)["status"],
            "PASS_PINNED_PROJECTION_REPLAY")

    def test_cue_silent_but_title_regex_and_literal_abstains(self):
        item, row = example(hints=False, title=True)
        bundle = issue.issue_case(item, row, exact_hit=True)
        self.assertTrue(bundle["baseline"]["title_regex_cue"])
        self.assertTrue(bundle["baseline"]["full_source_literal_hit"])
        self.assertFalse(bundle["baseline"]["pinned_native_u1_cue"])
        self.assertEqual(bundle["task_hypotheses"], [])
        self.assertEqual(bundle["route"], "CLARIFICATION_REQUIRED")
        self.assertEqual(len(bundle["clarification_requests"]), 1)

    def test_u1_body_cue_not_suppressed_by_title_regex(self):
        item, row = example(hints=True, title=False)
        bundle = issue.issue_case(item, row, exact_hit=False)
        self.assertEqual(len(bundle["task_hypotheses"]), 1)
        self.assertFalse(bundle["baseline"]["title_regex_cue"])
        self.assertTrue(bundle["baseline"]["pinned_native_u1_cue"])

    def test_unpinned_source_identity_refused(self):
        item, row = example()
        item["html_url"] = "https://example.org/injected"
        with self.assertRaisesRegex(k03.DiscoveryHold, "ISSUE_CASE_SOURCE_INVALID"):
            issue.issue_case(item, row, exact_hit=False)

    def test_unpinned_evidence_source_ref_refused(self):
        item, row = example()
        row["source_ref"] += "?edited=1"
        with self.assertRaisesRegex(k03.DiscoveryHold, "ISSUE_CASE_ROW_NOT_SOURCE_BOUND"):
            issue.issue_case(item, row, exact_hit=False)

    def test_unpinned_sha_refused(self):
        item, row = example()
        row["source_sha256"] = "b" * 64
        with self.assertRaisesRegex(k03.DiscoveryHold, "ISSUE_CASE_ROW_NOT_SOURCE_BOUND"):
            issue.issue_case(item, row, exact_hit=False)

    def test_out_of_range_span_refused(self):
        item, row = example()
        row["u1_review_cue_spans"][0]["byte_end"] = 999999
        with self.assertRaisesRegex(Exception, "INVALID_U1_OFFSET"):
            issue.issue_case(item, row, exact_hit=False)

    def test_unknown_cue_kind_refused(self):
        item, row = example()
        row["u1_review_cue_spans"][0]["cue_kind"] = "TASK_ACCEPTED"
        with self.assertRaisesRegex(Exception, "UNEXPECTED_U1_CUE_KIND"):
            issue.issue_case(item, row, exact_hit=False)

    def test_duplicate_cues_refused(self):
        item, row = example()
        row["u1_review_cue_spans"] *= 2
        with self.assertRaisesRegex(k03.DiscoveryHold, "ISSUE_DUPLICATE_REVIEW_CUE"):
            issue.issue_case(item, row, exact_hit=False)

    def test_duplicate_or_tampered_bundle_refused(self):
        item, row = example()
        orig = issue.issue_case(item, row, exact_hit=True)
        for change in ("source_sha256", "route", "hypothesis", "baseline"):
            forged = copy.deepcopy(orig)
            if change == "hypothesis":
                forged["task_hypotheses"][0]["text"] = "Approved"
            elif change == "baseline":
                forged["baseline"]["full_source_literal_hit"] = False
            else:
                forged[change] = "ATTACK"
            with self.subTest(change=change):
                with self.assertRaisesRegex(k03.DiscoveryHold,
                                            "ISSUE_BUNDLE_CHANGED_OR_UNTRUSTED"):
                    issue.verify_issue_case(forged, item, row, exact_hit=True)

    def test_issue_hypothesis_selection_replays_before_emit(self):
        item, row = example()
        bundle = issue.issue_case(item, row, exact_hit=True)
        with patch.object(issue, "replay_issues",
                          return_value={"cases": [bundle]}) as replay:
            output = issue.selected_issue_hypothesis(
                bundle, bundle["task_hypotheses"][0]["id"],
                choice=issue.SELECTION, selection_ref="human-001")
            replay.assert_called_once_with(input_dir=None, get_source=None)
        self.assertEqual(output["schema"], k03.SELECTION_SCHEMA)
        self.assertFalse(output["task_created"])
        self.assertFalse(output["result_created"])
        self.assertIsNone(output["task_id"])
        self.assertEqual(output["next_owner"], "HOST_TASK_QUALIFICATION")
        self.assertEqual(output["source_sha256"], item["projection_sha256"])

    def test_selection_rejects_forged_verified_receipt(self):
        item, row = example()
        canonical = issue.issue_case(item, row, exact_hit=True)
        tampered = copy.deepcopy(canonical)
        tampered["task_hypotheses"][0]["text"] = "Approved already"
        with patch.object(issue, "replay_issues",
                          return_value={"cases": [canonical]}):
            with self.assertRaisesRegex(k03.DiscoveryHold,
                                        "ISSUE_SELECTION_REPLAY_MISMATCH"):
                issue.selected_issue_hypothesis(
                    tampered, tampered["task_hypotheses"][0]["id"],
                    choice=issue.SELECTION, selection_ref="human-001")

    def test_selection_rejects_unknown_id_even_after_replay(self):
        item, row = example()
        canonical = issue.issue_case(item, row, exact_hit=True)
        with patch.object(issue, "replay_issues",
                          return_value={"cases": [canonical]}):
            with self.assertRaisesRegex(k03.DiscoveryHold,
                                        "HYPOTHESIS_NOT_SELECTABLE"):
                issue.selected_issue_hypothesis(
                    canonical, "H-UNSUPPORTED", choice=issue.SELECTION,
                    selection_ref="human-001")

    def test_selection_rejects_automatic_confirmation(self):
        item, row = example()
        canonical = issue.issue_case(item, row, exact_hit=True)
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "EXPLICIT_HUMAN_SELECTION_REQUIRED"):
            issue.selected_issue_hypothesis(
                canonical, "H-UNSUPPORTED",
                choice="AUTO_ACCEPT", selection_ref="human-001")

    def test_receipt_never_carries_raw_public_document(self):
        item, row = example()
        receipt = issue.issue_case(item, row, exact_hit=True)
        encoded = json.dumps(receipt)
        self.assertNotIn("raw_text", encoded)
        self.assertNotIn("body_text", encoded)
        self.assertNotIn("source_bytes", encoded)
        self.assertNotIn("private_secret", encoded)
        self.assertNotIn("user_task_accepted", encoded)


if __name__ == "__main__":
    import unittest
    unittest.main()
