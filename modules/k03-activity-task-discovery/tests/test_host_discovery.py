"""K03 user-provided source flow; synthetic owner-authorized fixture only."""
from __future__ import annotations

from datetime import date
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import host_discovery as host
import k03

TODAY = date(2026, 11, 5)
SOURCE = "У нас теряются заявки при передаче смены.\nНужно проверить заявки перед передачей.\n"


def input_source(text=SOURCE, *, source_id="doc-1", revision="v1",
                 epistemic="reported"):
    raw = text.encode("utf-8")
    return {
        "source_id": source_id,
        "revision": revision,
        "text": text,
        "epistemic": epistemic,
        "manifest": {
            "schema": "IWXA_ENGINE_UNIVERSAL_EVIDENCE/0.1",
            "kind": "PERSONAL_NOTE_UTF8",
            "owner_ref": "synthetic-example-owner",
            "jurisdiction": "UNDETERMINED",
            "as_of": "2026-11-05",
            "retention_until": "2027-12-31",
            "purpose": "ENGINE_RESEARCH_AND_TEST",
            "disclosure": "PERSONAL",
            "access_basis": "OWNER_AUTHORIZATION_CLAIM",
            "authorization_ref": "host-attestation-synthetic-only",
            "permission_asserted": True,
            "authorized_actions": ["LOCAL_ANALYSIS"],
            "revocation_status": "ACTIVE",
            "sha256": hashlib.sha256(raw).hexdigest(),
            "source_reference": "host://provided/doc-1",
        },
    }


def need(*, rev="v1", text="Хочу разобраться, почему теряются заявки"):
    return {
        "mode": "NEED", "text": text,
        "expected_revisions": {"doc-1": rev},
    }


class HostDiscoveryTests(unittest.TestCase):
    def test_clear_task_bypasses_all_sources_and_u1(self):
        request = {
            "mode": "CLEAR_TASK",
            "text": "Подготовить отчёт по заявкам",
            "expected_result": "Отчёт с перечнем просроченных заявок",
        }
        with patch.object(host.issue_replay.paired, "load_owner",
                          side_effect=AssertionError("U1 should be bypassed")):
            result = host.discover(request, [input_source()], today=TODAY)
        self.assertEqual(result["route"], "DIRECT_TASK_HOST_HANDOFF_NO_DISCOVERY")
        self.assertEqual(result["native_u1_calls"], 0)
        self.assertEqual(result["processed_source_bytes"], 0)
        self.assertFalse(result["task_created"])
        self.assertEqual(result["next_owner"], "HOST_TASK_QUALIFICATION")
        self.assertEqual(result["task_hypotheses"], [])

    def test_no_sources_asks_question_and_abstains(self):
        result = host.discover(
            {"mode": "NEED", "text": "Хочу, чтобы стало проще",
             "expected_revisions": {}}, [], today=TODAY)
        self.assertEqual(result["route"], "CLARIFICATION_REQUIRED")
        self.assertEqual(result["task_hypotheses"], [])
        self.assertEqual(result["native_u1_calls"], 0)
        self.assertEqual(result["source_count"], 0)
        self.assertEqual(result["activity_observations"][0]["tag"], "target")
        self.assertEqual(len(result["clarification_requests"]), 1)

    def test_user_source_live_pinned_original_u1_evidence(self):
        row = input_source()
        with patch.object(host.issue_replay.paired, "load_owner",
                          wraps=host.issue_replay.paired.load_owner) as loader:
            result = host.discover(need(), [row], today=TODAY)
        self.assertEqual(loader.call_count, 1)
        self.assertEqual(result["route"], "QUALIFICATION_REQUIRED")
        self.assertEqual(result["source_count"], 1)
        self.assertEqual(result["processed_source_bytes"],
                         len(SOURCE.encode("utf-8")))
        self.assertEqual(result["native_u1_calls"], 2)
        self.assertEqual(len(result["task_hypotheses"]), 1)
        hypothesis = result["task_hypotheses"][0]
        self.assertEqual(hypothesis["status"], "PROPOSED_NOT_QUALIFIED_TASK")
        self.assertFalse(hypothesis["independent_field_confirmation"])
        self.assertEqual(hypothesis["tag"], "inferred")
        self.assertIn("заявки", hypothesis["text"].lower())
        self.assertEqual(result["activity_observations"][0]["tag"], "target")
        self.assertTrue(all(x["tag"] == "reported"
                            for x in result["activity_observations"][1:]))
        e = hypothesis["evidence_links"][0]
        self.assertEqual(e["source_revision"], row["revision"])
        self.assertEqual(e["source_sha256"], row["manifest"]["sha256"])
        self.assertEqual(e["source_ref"], "host://provided/doc-1")
        span = e["locator"]
        self.assertGreater(span["byte_end"], span["byte_start"])
        self.assertLessEqual(span["byte_end"], len(SOURCE.encode("utf-8")))
        self.assertFalse(result["task_created"])
        self.assertFalse(result["result_created"])
        self.assertFalse(result["human_task_gold"])
        self.assertIsNone(result["task_f1"])

    def test_human_selection_returns_only_p01_intent(self):
        row = input_source()
        result = host.discover(need(), [row], today=TODAY)
        hypothesis = result["task_hypotheses"][0]
        selection = host.select_for_p01(
            result, hypothesis["id"],
            choice=host.CHOICE, selection_ref="human-approval-1",
            request=need(), sources=[row], today=TODAY)
        self.assertEqual(selection["schema"], host.SELECTION_SCHEMA)
        self.assertEqual(selection["hypothesis_id"], hypothesis["id"])
        self.assertEqual(selection["status"],
                         "SELECTED_CANDIDATE_AWAITING_HOST_TASK_QUALIFICATION")
        self.assertEqual(selection["next_owner"],
                         "P01_EXISTING_TASK_QUALIFICATION")
        self.assertFalse(selection["task_created"])
        self.assertFalse(selection["result_created"])
        self.assertIsNone(selection["task_id"])
        self.assertFalse(selection["human_selection_independently_verified"])

    def test_selection_rechecks_evidence_and_rejects_forgery(self):
        row = input_source()
        result = host.discover(need(), [row], today=TODAY)
        h = result["task_hypotheses"][0]
        forged = copy.deepcopy(result)
        forged["task_hypotheses"][0]["status"] = "ACCEPTED_TASK"
        with self.assertRaisesRegex(
                k03.DiscoveryHold,
                "K03_HOST_SELECTION_SOURCE_OR_EVIDENCE_CHANGED"):
            host.select_for_p01(
                forged, h["id"], choice=host.CHOICE,
                selection_ref="human-2", request=need(), sources=[row],
                today=TODAY)

    def test_selection_rejects_unsupported_and_auto_authority(self):
        row = input_source()
        result = host.discover(need(), [row], today=TODAY)
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_HOST_EXPLICIT_SELECTION_REQUIRED"):
            host.select_for_p01(
                result, "anything", choice="AUTOMATIC_APPROVAL",
                selection_ref="human-3", request=need(), sources=[row],
                today=TODAY)
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_HOST_UNSUPPORTED_HYPOTHESIS"):
            host.select_for_p01(
                result, "ACCEPTED-TASK-ID", choice=host.CHOICE,
                selection_ref="human-3", request=need(), sources=[row],
                today=TODAY)

    def test_stale_revision_rejected(self):
        row = input_source(revision="v1")
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_HOST_SOURCE_REVISION_STALE"):
            host.discover(need(rev="v2"), [row], today=TODAY)

    def test_modified_source_hash_rejected(self):
        row = input_source()
        row["text"] += "Подменённый хвост."
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_HOST_SOURCE_DIGEST_STALE"):
            host.discover(need(), [row], today=TODAY)

    def test_expired_or_revoked_native_u1_source_rejected(self):
        row = input_source()
        row["manifest"]["retention_until"] = "2025-01-01"
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_HOST_NATIVE_U1_SOURCE_HOLD"):
            host.discover(need(), [row], today=TODAY)
        row = input_source()
        row["manifest"]["revocation_status"] = "REVOKED"
        with self.assertRaisesRegex(
                k03.DiscoveryHold, "K03_HOST_SOURCE_PERMISSION_NOT_ASSERTED"):
            host.discover(need(), [row], today=TODAY)

    def test_unconfirmed_source_not_reinterpreted_as_observed(self):
        row = input_source(epistemic="observed")
        with self.assertRaisesRegex(
                k03.DiscoveryHold, "K03_HOST_SELF_REPORT_NOT_OBSERVED"):
            host.discover(need(), [row], today=TODAY)

    def test_no_related_cue_no_hypothesis(self):
        row = input_source(
            text="Нужно проверить заявки перед передачей.\n")
        request = need(text="Хочу, чтобы улучшилась вентиляция")
        result = host.discover(request, [row], today=TODAY)
        self.assertEqual(result["task_hypotheses"], [])
        self.assertEqual(result["route"], "CLARIFICATION_REQUIRED")
        self.assertEqual(result["metrics"]["comparison"]["literal_term_search"]
                         ["source_hits"], 0)

    def test_cue_silent_source_no_hypothesis(self):
        row = input_source(text="Заявки оформляются по регламенту.\n")
        result = host.discover(need(), [row], today=TODAY)
        self.assertEqual(result["route"], "CLARIFICATION_REQUIRED")
        self.assertEqual(result["task_hypotheses"], [])

    def test_user_data_not_sent_to_pinned_issue_corpus(self):
        row = input_source()
        with patch.object(host.issue_replay, "replay_issues",
                          side_effect=AssertionError("should not query issue corpus")), \
             patch.object(host.issue_replay, "replay_issue",
                          side_effect=AssertionError("should not query issue corpus")):
            result = host.discover(need(), [row], today=TODAY)
        self.assertEqual(result["source_count"], 1)
        self.assertEqual(result["native_u1_scope"],
                         "ENGINE_RESEARCH_AND_TEST_ONLY")

    def test_reject_no_revisions_and_duplicate_source(self):
        row = input_source()
        request = {"mode": "NEED", "text": "Неясная потребность"}
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_HOST_SOURCE_SET_INVALID"):
            host.discover(request, [row], today=TODAY)
        with self.assertRaisesRegex(k03.DiscoveryHold,
                                    "K03_HOST_EXPECTED_REVISION_INVALID"):
            host.discover(need(), [row, row], today=TODAY)

    def test_u1_owner_loaded_once_for_multiple_documents(self):
        row1 = input_source()
        row2 = input_source(source_id="doc-2", revision="v2")
        row2["manifest"]["source_reference"] = "host://provided/doc-2"
        request = {
            "mode": "NEED", "text": "Хочу разобраться, почему теряются заявки",
            "expected_revisions": {"doc-1": "v1", "doc-2": "v2"},
        }
        with patch.object(host.issue_replay.paired, "load_owner",
                          wraps=host.issue_replay.paired.load_owner) as loader:
            result = host.discover(request, [row1, row2], today=TODAY)
        self.assertEqual(loader.call_count, 1)
        self.assertEqual(result["source_count"], 2)
        self.assertEqual(result["native_u1_calls"], 4)
        self.assertEqual(result["processed_source_bytes"],
                         2 * len(SOURCE.encode("utf-8")))
        self.assertEqual(len(result["task_hypotheses"]), 2)
        self.assertEqual(
            {x["source_revision"] for h in result["task_hypotheses"]
             for x in h["evidence_links"]},
            {"v1", "v2"})
        self.assertTrue(all(h["status"] == "PROPOSED_NOT_QUALIFIED_TASK"
                            for h in result["task_hypotheses"]))
        self.assertFalse(result["task_created"])
        self.assertFalse(result["result_created"])

    def test_u1_loader_not_called_for_need_without_documents(self):
        with patch.object(host.issue_replay.paired, "load_owner",
                          side_effect=AssertionError("should not load U1")):
            result = host.discover(
                {"mode": "NEED", "text": "Хочу разобраться",
                 "expected_revisions": {}}, [], today=TODAY)
        self.assertEqual(result["route"], "CLARIFICATION_REQUIRED")
        self.assertEqual(result["native_u1_calls"], 0)
        self.assertFalse(result["task_created"])

    def test_no_task_level_f1_or_human_savings(self):
        row = input_source()
        result = host.discover(need(), [row], today=TODAY)
        self.assertIsNone(result["task_precision"])
        self.assertIsNone(result["task_recall"])
        self.assertIsNone(result["task_f1"])
        self.assertIsNone(result["metrics"]["human_time_saved_ms"])
        comparison = result["metrics"]["comparison"]
        self.assertEqual(comparison["direct_question"]["source_bytes_read"], 0)
        self.assertEqual(comparison["k03"]["linked_candidates"], 1)
        self.assertEqual(comparison["literal_term_search"]["source_hits"], 1)


if __name__ == "__main__":
    unittest.main()
