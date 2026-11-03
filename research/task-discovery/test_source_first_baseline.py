"""Offline engineering regression; synthetic texts are never human task gold."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import source_first_baseline as baseline


def fixture(directory: Path) -> dict:
    sources = []
    for i in range(8):
        repo, number = "public-example/project", 100 + i
        title = "Request: need support" if i % 2 == 0 else "Weekly notes"
        body = f"Case {i} description about work.\n"
        original = (title + "\n" + body + "\n").encode("utf-8")
        (directory / f"public-example__project__{number}.txt").write_bytes(original)
        sources.append({
            "repository": repo, "issue_number": number,
            "html_url": f"https://github.com/{repo}/issues/{number}",
            "projection_bytes": len(original),
            "projection_sha256": hashlib.sha256(original).hexdigest(),
            "body_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        })
    return {"schema": baseline.MANIFEST_SCHEMA, "no_gold": True, "items": sources}


class SourceFirstBaselineTests(unittest.TestCase):
    def test_all_eight_and_cue_silent_retained(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture(root)
            path = root / "sources.json"
            path.write_text(json.dumps(manifest), encoding="utf-8")
            result = baseline.replay(baseline.read_manifest(path), input_dir=root)
            self.assertEqual(result["sources_verified"], 8)
            self.assertEqual(result["sources_review_included"], 8)
            self.assertEqual(result["sources_with_title_regex_cues"], 4)
            self.assertEqual(result["sources_without_title_regex_cues_still_included"], 4)
            self.assertEqual(result["title_regex_cue_count"], 12)
            self.assertFalse(result["human_task_gold"])
            self.assertIsNone(result["human_task_f1"])
            self.assertFalse(result["source_bytes_in_receipt"])
            self.assertNotIn("description about work", json.dumps(result))
            self.assertNotIn("Request: need support", json.dumps(result))
            self.assertEqual(result["methods"]["NATIVE_U1"],
                             "NOT_RUN_PRIVATE_OWNER_SOURCE_NOT_COPIED")

    def test_changed_bytes_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture(root)
            path = root / "public-example__project__103.txt"
            path.write_bytes(path.read_bytes() + b"edited")
            with self.assertRaisesRegex(baseline.BaselineHold,
                                        "FROZEN_SOURCE_CONTENT_CHANGED"):
                baseline.replay(manifest, input_dir=root)

    def test_source_identity_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = fixture(root)
            bad = copy.deepcopy(original)
            bad["items"][0]["html_url"] = "https://other.invalid/test"
            with self.assertRaisesRegex(baseline.BaselineHold,
                                        "MANIFEST_SOURCE_INVALID"):
                baseline.replay(bad, input_dir=root)
            bad = copy.deepcopy(original)
            bad["items"][0] = bad["items"][1]
            with self.assertRaisesRegex(baseline.BaselineHold,
                                        "DUPLICATE_FROZEN_SOURCE"):
                baseline.replay(bad, input_dir=root)
            with self.assertRaisesRegex(baseline.BaselineHold,
                                        "MANIFEST_NOT_FROZEN_EXPLORATORY_EIGHT"):
                baseline.replay({"schema": baseline.MANIFEST_SCHEMA,
                                 "no_gold": True, "items": original["items"][:-1]},
                                input_dir=root)

    def test_utf8_coordinates(self):
        spans = baseline.title_spans("📌 Request: need help\nbody\n".encode("utf-8"))
        self.assertEqual(spans, [{"byte_start": 5, "byte_end": 12},
                                 {"byte_start": 14, "byte_end": 18}])

    def test_deterministic_cues_without_human_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = fixture(root)
            a = baseline.replay(manifest, input_dir=root)
            b = baseline.replay(manifest, input_dir=root)
            self.assertEqual(a["source_rows"], b["source_rows"])
            self.assertEqual(a["method_pattern_sha256"], b["method_pattern_sha256"])
            self.assertTrue(all(r["task_discovery_label"] is None
                                for r in a["source_rows"]))


if __name__ == "__main__":
    unittest.main()
