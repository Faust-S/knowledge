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
        self.assertEqual(r["structure"]["outer_known_field_occurrences"]["event"],2)
        self.assertNotIn("secret text",str(r))
        self.assertFalse(r["source"]["raw_rows_published"])
        self.assertEqual(r["qualification"]["accepted_tasks"],0)
    def test_unknown_map_key_never_exposed(self):
        raw=b'{"ocel:events":{"customer-secret-918":{"ocel:activity":"A"}}}'
        report=original.parse_jsonl(raw)
        self.assertNotIn("customer-secret-918",str(report))
        self.assertIn("ocel:events",report["structure"]["first_record_container_shapes"])
        self.assertEqual(report["structure"]["first_record_container_shapes"]["ocel:events"]["record_count"],1)
    def test_invalid_json_is_hold(self):
        with self.assertRaisesRegex(index.Hold,"ITAM_NONSTANDARD_JSON_FRAMING_HOLD"):
            original.parse_jsonl(b'{"broken"\n')
    def test_pretty_document_and_line_records(self):
        r=original.parse_jsonl(b'{\n  "ocel:events": {},\n  "ocel:objects": {}\n}\n')
        self.assertEqual(r["structure"]["parse_mode"],"WHOLE_JSON_OBJECT")
        r2=original.parse_jsonl(b'{"activity":"a"}\n{"activity":"b"}\n')
        self.assertEqual(r2["structure"]["parse_mode"],"JSON_LINES")
        self.assertEqual(r2["structure"]["nonempty_jsonl_rows"],2)
    def test_pretty_sequential_objects(self):
        raw=(b'{\n  "ocel:activity": "A"\n}\n'
             b'{\n  "ocel:activity": "B"\n}\n')
        r=original.parse_jsonl(raw)
        self.assertEqual(r["structure"]["parse_mode"],"MULTILINE_JSON_SEQUENCE")
        self.assertEqual(r["structure"]["nonempty_jsonl_rows"],2)
        self.assertFalse(r["source"]["raw_rows_published"])
    def test_framing_diagnostics_never_disclose_private_fields(self):
        raw=b'{\n"private-user-555":"sensitive-person-999"\n}\n'
        diag=original.framing_profile(raw)
        self.assertEqual(diag["first_token_class"], "OBJECT")
        self.assertGreater(diag["invalid_individual_json_lines"],0)
        self.assertFalse(diag["source_contents_returned"])
        self.assertNotIn("private-user-555",str(diag))
        self.assertNotIn("sensitive-person-999",str(diag))
    def test_empty_is_hold(self):
        with self.assertRaisesRegex(index.Hold,"ITAM_JSONL_BYTES_INVALID"):
            original.parse_jsonl(b'')
    def test_nonobject_is_hold(self):
        with self.assertRaisesRegex(index.Hold,"ITAM_UNSUPPORTED_WHOLE_JSON_ROOT"):
            original.parse_jsonl(b'[1,2]\n')
