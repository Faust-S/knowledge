"""Compatibility assertions for existing P01 Task-draft consumer.

Do not import P01/private sources. This verifies the public K03 return values
against the already-existing IWXA_K03_SELECTION/0.1.0 wire contract.
No new selector, Task Engine, Review, or accepted Task.
"""
from __future__ import annotations

from copy import deepcopy
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import issue_replay
import k03


CHOICE = "HUMAN_SELECT_FOR_QUALIFICATION"
STATUS = "SELECTED_CANDIDATE_AWAITING_HOST_TASK_QUALIFICATION"
NEXT_OWNER = "HOST_TASK_QUALIFICATION"
ISSUE_SHA = "a" * 64
ISSUE_REF = "https://github.com/owner/repo/issues/123"


def desk():
    return k03.discover_case(k03.load_pinned_pilot(), k03.load_rationale(), "CASE-2")


def issue():
    item = {
        "repository": "owner/repo",
        "issue_number": 123,
        "html_url": ISSUE_REF,
        "projection_sha256": ISSUE_SHA,
        "projection_bytes": 100,
    }
    row = {
        "source_ref": ISSUE_REF,
        "source_sha256": ISSUE_SHA,
        "u1_raw_statements": 1,
        "u1_review_cue_spans": [{
            "byte_start": 8, "byte_end": 15,
            "cue_kind": "REPORTED_PROBLEM_REVIEW_CUE",
        }],
        "title_regex_cue_spans": [],
    }
    return issue_replay.issue_case(item, row, exact_hit=False)


def selected_issue(bundle):
    with patch.object(issue_replay, "replay_issue", return_value=bundle):
        return issue_replay.selected_issue_hypothesis(
            bundle, bundle["task_hypotheses"][0]["id"],
            choice=CHOICE, selection_ref="person-review-001")


class P01ExistingContract(TestCase):
    def check_p01_selection(self, discovery, selection):
        self.assertEqual(selection["schema"], "IWXA_K03_SELECTION/0.1.0")
        self.assertEqual(selection["status"], STATUS)
        self.assertEqual(selection["next_owner"], NEXT_OWNER)
        self.assertEqual(selection["choice"], CHOICE)
        self.assertEqual(selection["task_created"], False)
        self.assertIsNone(selection["task_id"])
        self.assertEqual(selection["result_created"], False)
        self.assertEqual(discovery["accepted_task_count"], 0)
        self.assertFalse(discovery["task_type_accepted"])
        self.assertFalse(discovery["human_task_gold"])
        self.assertEqual(discovery["route"], "QUALIFICATION_REQUIRED")
        self.assertTrue(discovery["clarification_requests"])
        self.assertTrue(selection["selection_ref"])
        hypotheses = {h["id"]: h for h in discovery["task_hypotheses"]}
        selected = hypotheses[selection["hypothesis_id"]]
        self.assertEqual(selected["status"], "PROPOSED_NOT_QUALIFIED_TASK")
        self.assertFalse(selected["independent_field_confirmation"])
        self.assertEqual(selected["text"], selection["candidate_text"])
        self.assertEqual(selected["evidence_links"], selection["evidence_links"])
        observations = {x["id"]: x for x in discovery["activity_observations"]}
        self.assertEqual(len(observations), len(discovery["activity_observations"]))
        self.assertTrue(selection["evidence_links"])
        for link in selection["evidence_links"]:
            self.assertIn(link["evidence_id"], observations)

    def test_desk_owner_emits_existing_selection_for_p01(self):
        r = desk()
        selected = k03.select_hypothesis(
            r, "H-CASE-2-1", choice=CHOICE, selection_ref="person-review-001")
        self.check_p01_selection(r, selected)
        self.assertEqual(r["schema"], "IWXA_K03_DISCOVERY/0.1.0")
        self.assertEqual(selected["case_id"], r["case_id"])
        self.assertEqual(len(r["source_git_blob"]), 40)
        by_id = {o["id"]: o for o in r["activity_observations"]}
        for link in selected["evidence_links"]:
            self.assertEqual(
                by_id[link["evidence_id"]]["source_version"], r["source_git_blob"])

    def test_issue_owner_emits_same_selection_schema_with_source_sha(self):
        r = issue()
        selected = selected_issue(r)
        self.check_p01_selection(r, selected)
        self.assertEqual(r["schema"], "IWXA_K03_PUBLIC_ISSUE_DISCOVERY/0.1.0")
        self.assertEqual(selected["source_ref"], ISSUE_REF)
        self.assertEqual(selected["source_sha256"], ISSUE_SHA)
        for link in selected["evidence_links"]:
            row = next(x for x in r["activity_observations"]
                       if x["id"] == link["evidence_id"])
            self.assertEqual(row["source_ref"], ISSUE_REF)
            self.assertEqual(row["source_sha256"], ISSUE_SHA)

    def test_no_human_selection_does_not_create_receipt(self):
        r = desk()
        self.assertEqual(r["accepted_task_count"], 0)
        with self.assertRaisesRegex(
                k03.DiscoveryHold, "EXPLICIT_HUMAN_SELECTION_REQUIRED"):
            k03.select_hypothesis(
                r, "H-CASE-2-1",
                choice="AUTOMATIC_ACCEPT", selection_ref="person-review-001")
        with self.assertRaisesRegex(
                k03.DiscoveryHold, "EXPLICIT_HUMAN_SELECTION_REQUIRED"):
            k03.select_hypothesis(r, "H-CASE-2-1",
                                  choice=CHOICE, selection_ref="")

    def test_unlinked_zero_evidence_abstains(self):
        r = k03.discover_case(
            k03.load_pinned_pilot(), k03.load_rationale(), "CASE-0")
        self.assertEqual(r["route"], "CLARIFICATION_REQUIRED")
        self.assertEqual(r["task_hypotheses"], [])
        self.assertEqual(len(r["clarification_requests"]), 1)
        with self.assertRaisesRegex(
                k03.DiscoveryHold, "HYPOTHESIS_NOT_SELECTABLE"):
            k03.select_hypothesis(
                r, "H-CASE-0-1",
                choice=CHOICE, selection_ref="person-review-001")

    def test_changed_pinned_desk_source_sha_rejected(self):
        r = desk()
        r["source_git_blob"] = "f" * 40
        with self.assertRaisesRegex(
                k03.DiscoveryHold, "DISCOVERY_AUTHORITY_CHANGED"):
            k03.select_hypothesis(
                r, "H-CASE-2-1",
                choice=CHOICE, selection_ref="person-review-001")

    def test_mutated_desk_evidence_links_rejected(self):
        r = desk()
        r["task_hypotheses"][0]["evidence_links"][0]["evidence_id"] = "FORGED"
        with self.assertRaisesRegex(
                k03.DiscoveryHold, "HYPOTHESIS_EVIDENCE_OR_AUTHORITY_CHANGED"):
            k03.select_hypothesis(
                r, "H-CASE-2-1", choice=CHOICE, selection_ref="person-review-001")

    def test_unknown_desk_hypothesis_id_rejected(self):
        r = desk()
        with self.assertRaisesRegex(
                k03.DiscoveryHold, "HYPOTHESIS_NOT_SELECTABLE"):
            k03.select_hypothesis(
                r, "H-NOT-IN-SOURCE", choice=CHOICE,
                selection_ref="person-review-001")

    def test_unavailable_pinned_desk_source_rejected(self):
        r = desk()
        with patch.object(k03, "load_pinned_pilot",
                          side_effect=OSError("source not mounted")):
            with self.assertRaises(OSError):
                k03.select_hypothesis(
                    r, "H-CASE-2-1",
                    choice=CHOICE, selection_ref="person-review-001")

    def test_changed_issue_sha_or_links_rejected_after_fresh_replay(self):
        verified = issue()
        cases = []
        stale = deepcopy(verified)
        stale["source_sha256"] = "f" * 64
        cases.append(stale)
        links = deepcopy(verified)
        links["task_hypotheses"][0]["evidence_links"][0]["evidence_id"] = "FORGED"
        cases.append(links)
        with patch.object(issue_replay, "replay_issue", return_value=verified) as replay:
            for payload in cases:
                with self.subTest(change=payload):
                    with self.assertRaisesRegex(
                            k03.DiscoveryHold, "ISSUE_SELECTION_REPLAY_MISMATCH"):
                        issue_replay.selected_issue_hypothesis(
                            payload, verified["task_hypotheses"][0]["id"],
                            choice=CHOICE, selection_ref="person-review-001")
            self.assertEqual(replay.call_count, 2)

    def test_unknown_issue_hypothesis_id_rejected(self):
        verified = issue()
        with patch.object(issue_replay, "replay_issue", return_value=verified):
            with self.assertRaisesRegex(
                    k03.DiscoveryHold, "HYPOTHESIS_NOT_SELECTABLE"):
                issue_replay.selected_issue_hypothesis(
                    verified, "H-UNKNOWN", choice=CHOICE,
                    selection_ref="person-review-001")

    def test_unavailable_issue_source_does_not_create_receipt(self):
        verified = issue()
        with patch.object(issue_replay, "replay_issue",
                          side_effect=OSError("original unavailable")):
            with self.assertRaises(OSError):
                issue_replay.selected_issue_hypothesis(
                    verified, verified["task_hypotheses"][0]["id"],
                    choice=CHOICE, selection_ref="person-review-001")

    def test_clear_task_uses_existing_bypass_without_discovery(self):
        direct = k03.bypass_clear_task(
            "Prepare a report", "A verifiable report with references")
        self.assertEqual(direct["route"], "DIRECT_TASK_HOST_HANDOFF_NO_DISCOVERY")
        self.assertEqual(direct["next_owner"], NEXT_OWNER)
        self.assertEqual(direct["task_hypotheses"], [])
        self.assertEqual(direct["clarification_requests"], [])
        self.assertFalse(direct["task_created"])
        with self.assertRaisesRegex(
                k03.DiscoveryHold, "DIRECT_TASK_REQUIRES_CLEAR_RESULT"):
            k03.bypass_clear_task("Prepare a report", "")


if __name__ == "__main__":
    import unittest
    unittest.main()
