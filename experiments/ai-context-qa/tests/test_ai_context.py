"""Test exact IWXA source copies with synthetic data only, not the private model."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT_SOURCE = Path(__file__).resolve().parents[1] / "source"
sys.path.insert(0, str(ROOT_SOURCE))
import search
import system


class AIContextSyntheticTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.k = self.root / "knowledge" / "system"
        self.k.mkdir(parents=True)
        (self.k / "CHANGE_EVENTS.jsonl").write_text("", encoding="utf-8")
        (self.root / "docs").mkdir()
        (self.root / "archive").mkdir()
        policy = {
            "schema": "IWXA_SOURCE_READ_POLICY/1", "default": "CURRENT_ONLY",
            "current_semantics": {"T0": "minimal particles", "T1": "minimal processes"},
            "archived_source_ids": [], "archived_scopes": [], "archived_roles": [],
            "archived_path_prefixes": ["archive/"], "archived_paths": [],
            "archived_title_patterns": []
        }
        (self.k / "SOURCE_READ_POLICY.json").write_text(json.dumps(policy), encoding="utf-8")
        self.rows = [
            self.make_local("S-HEALTHY", "docs/healthy.md", "CurrentSignal cooperative result", "current"),
            self.make_local("S-STALE", "docs/stale.md", "StaleSignal original source", "current"),
            self.make_local("S-ARCHIVE", "archive/legacy.md", "HistoricalSignal old source",
                            "history", default_read_status="HISTORICAL_ONLY"),
            {
                "id": "S-EXTERNAL", "path": None, "title": "ExternalReference",
                "sha256": hashlib.sha256(b"ExternalCacheSignal").hexdigest(),
                "scope": "external", "authority_role": "REFERENCE",
                "origin": {"repository": "Example/External"},
                "locator": {"kind": "GITHUB_FILE", "repository": "Example/External",
                            "commit": "a" * 40, "path": "readme.md"}
            }
        ]
        (self.k / "SOURCE_REGISTRY.jsonl").write_text(
            "".join(json.dumps(r) + "\n" for r in self.rows), encoding="utf-8")
        (self.k / "WORK_REGISTRY.json").write_text(
            json.dumps({"items": [{"name": "ExternalCandidateBeta",
                                    "source_ids": ["S-EXTERNAL"]}]}), encoding="utf-8")
        (self.k / "KNOWLEDGE_GRAPH.json").write_text(json.dumps({
            "nodes": [{"id": "S-ARCHIVE", "source_ids": ["S-ARCHIVE"]},
                      {"id": "S-HEALTHY", "source_ids": ["S-HEALTHY"]},
                      {"id": "DOMAIN", "source_ids": ["S-HEALTHY"]}],
            "edges": [{"source": "S-ARCHIVE", "target": "DOMAIN", "type": "REF"},
                      {"source": "S-HEALTHY", "target": "DOMAIN", "type": "REF"}]
        }), encoding="utf-8")
        for module in (search, system):
            for attr, value in (("ROOT", self.root), ("K", self.k)):
                p = patch.object(module, attr, value)
                p.start()
                self.addCleanup(p.stop)

    def make_local(self, sid, path, text, scope, **kwargs):
        data = text.encode("utf-8")
        (self.root / path).write_bytes(data)
        return {
            "id": sid, "path": path, "title": sid, "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data), "scope": scope, "authority_role": "LOCAL",
            "origin": {"repository": "Example/Owner"},
            "locator": {"kind": "LOCAL_FILE", "path": path}, **kwargs
        }

    def db(self, basename):
        return self.root / basename

    def test_current_search_and_archive_opt_in(self):
        self.assertEqual([r["source_id"] for r in search.query("CurrentSignal",
                         self.db("one.sqlite"), self.rows)], ["S-HEALTHY"])
        self.assertEqual(search.query("HistoricalSignal", self.db("one.sqlite"), self.rows), [])
        archival = search.query("HistoricalSignal", self.db("one.sqlite"),
                                self.rows, include_archived=True)
        self.assertEqual([r["source_id"] for r in archival], ["S-ARCHIVE"])
        self.assertEqual(archival[0]["reading_status"], "ARCHIVED_COMPATIBILITY_ONLY")
        self.assertEqual(search.query("HistoricalSignal", self.db("one.sqlite"), self.rows), [])

    def test_sha_drift_skips_bad_source_but_keeps_healthy(self):
        rows = [dict(self.rows[1], sha256="0" * 64), self.rows[0]]
        status = {}
        found = search.query("CurrentSignal", self.db("two.sqlite"), rows, status_out=status)
        self.assertEqual([r["source_id"] for r in found], ["S-HEALTHY"])
        self.assertEqual(status["retrieval_status"], "REVIEW_REQUIRED_SOURCE_DRIFT")
        self.assertEqual(status["stale_source_ids"], ["S-STALE"])
        self.assertEqual(status["indexed_sources"], 1)

    def test_cached_index_is_invalidated_on_drift_then_restored(self):
        row = self.rows[0]
        db = self.db("three.sqlite")
        self.assertEqual(len(search.query("CurrentSignal", db, [row])), 1)
        (self.root / row["path"]).write_text("CurrentSignal damaged", encoding="utf-8")
        status = {}
        self.assertEqual(search.query("CurrentSignal", db, [row], status_out=status), [])
        self.assertEqual(status["stale_source_ids"], ["S-HEALTHY"])
        (self.root / row["path"]).write_text("CurrentSignal cooperative result", encoding="utf-8")
        self.assertEqual(len(search.query("CurrentSignal", db, [row])), 1)

    def test_external_cache_validated_and_recovered(self):
        row = self.rows[3]
        cache_file = self.root / "external-cache.txt"
        cache_file.write_bytes(b"ExternalCacheSignal")
        cache = {"S-EXTERNAL": str(cache_file)}
        db = self.db("external.sqlite")
        found = search.query("ExternalCacheSignal", db, [row], cache=cache)
        self.assertEqual(found[0]["content_kind"], "FULL_TEXT")
        cache_file.write_bytes(b"ExternalCacheSignal damaged")
        status = {}
        self.assertEqual(search.query("ExternalCacheSignal", db, [row],
                                      cache=cache, status_out=status), [])
        self.assertEqual(status["retrieval_status"], "REVIEW_REQUIRED_SOURCE_DRIFT")
        cache_file.write_bytes(b"ExternalCacheSignal")
        self.assertEqual(search.query("ExternalCacheSignal", db, [row], cache=cache)[0]
                         ["content_kind"], "FULL_TEXT")

    def test_external_reference_without_cache_is_metadata_only(self):
        found = search.query("ExternalCandidateBeta", self.db("metadata.sqlite"),
                             [self.rows[3]])
        self.assertEqual(found[0]["content_kind"], "METADATA_AND_CANDIDATES_ONLY")

    def test_text_hash_normalizes_crlf(self):
        (self.root / "docs" / "crlf.md").write_bytes(b"line1\r\nline2\r\n")
        row = dict(self.rows[0], path="docs/crlf.md",
                   sha256=hashlib.sha256(b"line1\nline2\n").hexdigest())
        self.assertEqual(search.source_bytes(row), b"line1\nline2\n")

    def test_archived_graph_node_is_invisible_without_opt_in(self):
        with self.assertRaisesRegex(ValueError, "Archived node"):
            search.graph_node("S-ARCHIVE")
        self.assertEqual(search.graph_node("S-ARCHIVE", True)["reading_mode"],
                         "EXPLICIT_ARCHIVE_INCLUDED")
        self.assertEqual(len(search.graph_node("DOMAIN")["edges"]), 1)

    def state(self):
        return {
            "root": self.root, "k": self.k,
            "sources": {r["id"]: r for r in self.rows}, "repositories": [], "gaps": [],
            "records": {"items": {"items": []}, "domains": {"cards": []}},
            "model": {
                "subject_lines": [], "subject_views": [], "axes": [], "layers": [],
                "constraints": [], "processes": [],
                "records": {"items": "WORK_REGISTRY.json"},
                "bindings": [{"id": "B-TEST", "name": "Synthetic", "item_ids": [],
                              "subject_lines": [], "layers": {}, "owning_repository": "Example/Owner"}],
                "context_profiles": [{"id": "whole", "name": "Synthetic whole",
                                      "mode": "DETAIL", "binding_ids": ["B-TEST"],
                                      "dependency_binding_ids": [], "process_ids": [],
                                      "required_source_ids": ["S-HEALTHY", "S-ARCHIVE"]}]
            }
        }

    def sync(self):
        (self.k / "SYNC_STATE.json").write_text(json.dumps({
            "schema": "IWXA_INDEPENDENT_SYNC_STATE/1", "status": "PENDING_SOURCE_REVIEW",
            "checked_at": "2026-10-07", "knowledge_base_head": "a" * 40,
            "observation_fingerprint": "b" * 64,
            "semantic_reconciliation_performed": False, "normative_adoption": False,
            "runtime_qualification": False, "streams": [], "errors": [],
            "candidates": [{"event_id": "OLD-EVENT", "source_after": "c" * 40,
                            "affected_binding_ids": ["B-TEST"]}]
        }), encoding="utf-8")

    def test_stale_sync_is_not_used_as_live_context(self):
        self.sync()
        st = self.state()
        stale = system.independent_sync(st, ["B-TEST"], knowledge_head="d" * 40)
        self.assertEqual(stale["status"], "HISTORICAL_OBSERVATION_EXCLUDED")
        self.assertEqual(stale["candidate_event_ids"], [])
        self.assertEqual(stale["currentness"], "REVIEW_REQUIRED")
        match = system.independent_sync(st, ["B-TEST"], knowledge_head="a" * 40)
        self.assertEqual(match["candidate_event_ids"], ["OLD-EVENT"])

    def test_context_uses_same_archive_policy(self):
        self.sync()
        st = self.state()
        # This is NOT full model verification. Only the context and sync paths are exercised.
        with patch.object(system, "verify", return_value={"status": "SYNTHETIC_ONLY"}), \
             patch.object(system, "fingerprint", return_value="SYNTHETIC"):
            packet = system.context(st, "whole", "Synthetic task", "d" * 40,
                                    max_chars=20000)
            ids = {row["id"] for row in packet["sources"]}
            self.assertIn("S-HEALTHY", ids)
            self.assertNotIn("S-ARCHIVE", ids)
            self.assertEqual(packet["independent_sync"]["candidate_event_ids"], [])
            self.assertEqual(packet["currentness"], "REVIEW_REQUIRED")
            history = system.context(st, "whole", "History task", "d" * 40,
                                     max_chars=20000, include_archived=True)
            rows = {row["id"]: row for row in history["sources"]}
            self.assertEqual(rows["S-ARCHIVE"]["reading_status"],
                             "ARCHIVED_COMPATIBILITY_ONLY")


if __name__ == "__main__":
    unittest.main()
