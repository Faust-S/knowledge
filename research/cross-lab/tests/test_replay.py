"""Focused tests against an exact copy of owning U1, not a rewritten U1."""
from __future__ import annotations

import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pinned_owner
import replay


class ResearchReplayTests(unittest.TestCase):
    def test_original_owner_u1_and_original_label_studio_xml(self):
        module, blob = pinned_owner.load_native_u1()
        self.assertEqual(blob, "eb15aec5ba1a749c29d7c40a868127e1a384b6bf")
        self.assertEqual(module.VERSION, "IWXA_ENGINE_UNIVERSAL_EVIDENCE/0.1")
        self.assertEqual(pinned_owner.check_label_studio_xml(),
                         "7b82dbd05b4e28c53446d863c5bb48b72245a10d")

    def test_frozen_real_manifest_source_ids_and_blob(self):
        selection = replay.manifest()
        self.assertEqual(len(selection["items"]), 8)
        self.assertEqual(replay.PINNED_MANIFEST_BLOB,
                         replay.git_blob(replay.MANIFEST_PATH.read_bytes()))
        self.assertEqual(len({r["html_url"] for r in selection["items"]}), 8)
        self.assertTrue(all(r["projection_bytes"] > 0 for r in selection["items"]))
        self.assertTrue(selection["no_gold"])
        self.assertFalse(selection["e5_held_out"])

    def test_changed_manifest_fails(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "frozen.json"
            p.write_bytes(replay.MANIFEST_PATH.read_bytes() + b"\n")
            with patch.object(replay, "MANIFEST_PATH", p):
                with self.assertRaisesRegex(replay.ReplayHold, "FROZEN_MANIFEST_CHANGED"):
                    replay.manifest()

    @staticmethod
    def fixture(root: Path):
        items = []
        for repo in replay.REPOS:
            for i in range(2):
                number = 100 + i
                title = "Report error" if i == 0 else "Unexpected behavior"
                body = "Need to fix rendering.\n" if i == 0 else "Observation in event.\n"
                raw = (title + "\n" + body + "\n").encode("utf-8")
                (root / (repo.replace("/", "__") + f"__{number}.txt")).write_bytes(raw)
                items.append({
                    "repository": repo, "issue_number": number,
                    "html_url": f"https://github.com/{repo}/issues/{number}",
                    "created_at": "2026-11-03T08:00:00Z",
                    "projection_sha256": replay.sha256(raw),
                    "body_sha256": replay.sha256(body.encode()),
                    "projection_bytes": len(raw),
                })
        return {"schema": replay.MANIFEST_SCHEMA, "items": items,
                "no_gold": True, "e5_held_out": False,
                "selected_on": "2026-11-03"}

    def test_native_u1_on_eight_offline_test_documents(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            selection = self.fixture(root)
            with patch.object(replay, "manifest", return_value=selection):
                result, blind = replay.run(root)
            self.assertEqual(result["source_count"], 8)
            self.assertEqual(result["u1_raw_statements"], 16)
            self.assertEqual(result["u1_lexical_cues"], 8)
            self.assertEqual(result["sources_with_u1_cues"], 4)
            self.assertEqual(result["sources_without_cues_still_reviewed"], 4)
            self.assertEqual(result["sources_with_title_regex"], 4)
            self.assertEqual(result["sources_with_either_cue"], 4)
            self.assertTrue(all(x["included_for_human_review"] for x in result["worklist"]))
            self.assertEqual([x["priority"] for x in result["worklist"]],
                             ["U1_CUE"] * 4 + ["SOURCE_ONLY"] * 4)
            self.assertEqual(len(blind), 8)
            self.assertTrue(all(set(x) == {"data"} and
                                set(x["data"]) == {"source_text", "source_url"}
                                for x in blind))
            self.assertNotIn("Need to fix rendering", str(result))
            self.assertNotIn("annotations", str(blind))
            self.assertNotIn("predictions", str(blind))
            self.assertIsNone(result["precision"])
            self.assertFalse(result["independent_task_gold"])
            self.assertEqual(result["task_candidates_created"], 0)
            self.assertEqual(result["t1_acceptances_created"], 0)
            self.assertEqual(result["e4_approvals_created"], 0)

    def test_mutated_pinned_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            selection = self.fixture(root)
            row = selection["items"][0]
            self.assertEqual(replay.pinned_source(row, root)[:12], b"Report error")
            p = root / "python__cpython__100.txt"
            p.write_bytes(p.read_bytes() + b"changed")
            with self.assertRaisesRegex(replay.ReplayHold, "PROJECTION_VERSION_CHANGED"):
                replay.pinned_source(row, root)

    def test_wrong_owner_interface_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            selection = self.fixture(root)
            true_owner, _ = pinned_owner.load_native_u1()
            class BadOwner:
                inspect = staticmethod(true_owner.inspect)
                @staticmethod
                def review_hints(raw, claim, *, today):
                    hints = true_owner.review_hints(raw, claim, today=today)
                    hints["candidate_task_count"] = 1
                    return hints
            with patch.object(replay, "manifest", return_value=selection):
                with self.assertRaisesRegex(replay.ReplayHold, "U1_AUTHORITY_OR_SOURCE_MISMATCH"):
                    replay.run(root, owner_loader=lambda: (BadOwner(), "TEST_ONLY"))

    def test_owner_pin_mutation_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "universal_evidence.py"
            p.write_bytes(pinned_owner.U1_FILE.read_bytes() + b"# mutation\n")
            with patch.object(pinned_owner, "U1_FILE", p):
                with self.assertRaisesRegex(pinned_owner.PinMismatch, "SHA_MISMATCH"):
                    pinned_owner.load_native_u1()

    def test_label_studio_pin_mutation_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "config.xml"
            p.write_bytes(pinned_owner.E5_XML.read_bytes().replace(b"PROCESS", b"FAKE"))
            with patch.object(pinned_owner, "E5_XML", p):
                with self.assertRaisesRegex(pinned_owner.PinMismatch, "SHA_MISMATCH"):
                    pinned_owner.check_label_studio_xml()

    def test_save_new_no_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "receipt.json"
            replay.save_new(p, {"a": 1})
            with self.assertRaises(FileExistsError):
                replay.save_new(p, {"a": 2})


if __name__ == "__main__":
    unittest.main()
