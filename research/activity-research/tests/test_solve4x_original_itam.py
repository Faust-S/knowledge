import sys
from pathlib import Path
from unittest import TestCase
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import solve4x_original_itam as original
import solve4x_zip_range_probe as index

class Tests(TestCase):
    def test_minimal_rows_and_no_raw_event_values(self):
        data=b'{"event":"secret text","time":"2024"}\n{"event":"other","time":"2025"}\n'
        r=original.parse_jsonl(data)
        self.assertEqual(r["structure"]["nonempty_jsonl_rows"],2)
        self.assertEqual(r["structure"]["outer_keys"]["event"],2)
        self.assertNotIn("secret text",str(r))
        self.assertFalse(r["source"]["raw_rows_published"])
        self.assertEqual(r["qualification"]["accepted_tasks"],0)
    def test_invalid_json_is_hold(self):
        with self.assertRaisesRegex(index.Hold,"ITAM_MULTILINE_OR_NONSTANDARD_JSON_HOLD"):
            original.parse_jsonl(b'{"broken"\n')
    def test_pretty_document_and_line_records(self):
        r=original.parse_jsonl(b'{\n  "ocel:events": {},\n  "ocel:objects": {}\n}\n')
        self.assertEqual(r["structure"]["parse_mode"],"WHOLE_JSON_OBJECT")
        r2=original.parse_jsonl(b'{"activity":"a"}\n{"activity":"b"}\n')
        self.assertEqual(r2["structure"]["parse_mode"],"JSON_LINES")
        self.assertEqual(r2["structure"]["nonempty_jsonl_rows"],2)
    def test_empty_is_hold(self):
        with self.assertRaisesRegex(index.Hold,"ITAM_JSONL_BYTES_INVALID"):
            original.parse_jsonl(b'')
    def test_nonobject_is_hold(self):
        with self.assertRaisesRegex(index.Hold,"ITAM_UNSUPPORTED_WHOLE_JSON_ROOT"):
            original.parse_jsonl(b'[1,2]\n')
