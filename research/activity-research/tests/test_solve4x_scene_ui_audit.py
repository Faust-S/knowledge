import sys
from pathlib import Path
from unittest import TestCase
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import solve4x_scene_ui_audit as audit
import solve4x_zip_range_probe as archive

class UISourceTests(TestCase):
    def test_schema_and_no_raw_rows(self):
        src=b'time;action;actor\n00:01;open;A\n00:02;close;A\n'
        r=audit.analyze(src)
        self.assertEqual(r["scope"]["row_count"],2)
        self.assertEqual(r["scope"]["distinct_nonempty_counts"]["action"],2)
        self.assertNotIn("00:01",str(r))
        self.assertFalse(r["source"]["original_rows_exported"])
        self.assertEqual(r["qualification"]["accepted_tasks"],0)
    def test_bad_row_arity(self):
        with self.assertRaisesRegex(archive.Hold,"UI_CSV_ROW_ARITY_INVALID"):
            audit.analyze(b'time,action,actor\n00:01,open\n')
    def test_empty(self):
        with self.assertRaisesRegex(archive.Hold,"UI_CSV_SIZE_HOLD"):
            audit.analyze(b'')
    def test_single_column(self):
        with self.assertRaises(archive.Hold):
            audit.analyze(b'onlyone\nline\n')
