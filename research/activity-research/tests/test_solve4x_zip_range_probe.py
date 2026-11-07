"""No external requests: bounded ZIP structure and negative epistemic tests."""
import io
import sys
import zipfile
from pathlib import Path
from unittest import TestCase, main

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_zip_range_probe as p


def archive():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("solve4x/scene01/scene01_vid.json", '{"synthetic":1}')
        z.writestr("solve4x/scene01/scene01_ocel.json", '{"synthetic":2}')
        z.writestr("solve4x/scene01/scene01.mp4", b"fake video")
    return out.getvalue()


class ZIPIndexTests(TestCase):
    def test_synthetic_index_without_full_files(self):
        raw = archive()
        tail = raw[-p.MAX_TAIL:]
        start = len(raw) - len(tail)
        offset, size, count = p.parse_eocd(tail, start, len(raw))
        entries = p.parse_central_directory(raw[offset:offset+size], count)
        self.assertEqual(len(entries), 3)
        report = p.summarize(entries, {"test": True})
        self.assertEqual(report["target_files_count"], 3)
        self.assertEqual([x["name"] for x in report["target_files"] if x["name"].endswith(".mp4")],
                         ["solve4x/scene01/scene01.mp4"])
        self.assertFalse(report["media_downloaded"])
        self.assertTrue(report["target_name_both_video_and_ocel"])
        self.assertFalse(report["case_level_two_modalities_loaded"])
        self.assertEqual(report["human_task_gold"], "NOT_MEASURED")

    def test_invalid_content_range(self):
        with self.assertRaisesRegex(p.Hold, "HTTP_RANGE_HEADER_INVALID"):
            p.parse_content_range("bytes */900")
        with self.assertRaisesRegex(p.Hold, "HTTP_RANGE_TOTAL_MISMATCH"):
            p.parse_content_range("bytes 0-5/100", 101)

    def test_truncated_zip_fails(self):
        with self.assertRaisesRegex(p.Hold, "ZIP_END_RECORD_NOT_FOUND"):
            p.parse_eocd(b"not a zip", 0, 9)

    def test_bad_central_entry_fails(self):
        with self.assertRaisesRegex(p.Hold, "ZIP_CENTRAL_RECORD_INVALID"):
            p.parse_central_directory(b"x"*46, 1)

    def test_disallows_false_alignment_claim(self):
        r = p.summarize([], {"dummy": True})
        self.assertEqual(r["source_independent_alignment"], "NOT_MEASURED")
        self.assertEqual(r["accepted_tasks"], 0)
        self.assertFalse(r["media_downloaded"])


if __name__ == "__main__":
    main()
