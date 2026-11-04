"""Synthetic structural checks; only live CI provides original source counts."""
import sys
from pathlib import Path
from unittest import TestCase
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_global_itam_audit as a
import solve4x_zip_range_probe as idx

def ev(activity, time, *, end=False):
    return {"ocel:activity":activity, "ocel:timestamp":time, "ocel:omap":[],
            "ocel:vmap":{"end_time":"2024-01-01T00:00:01Z"} if end else {}}

class GlobalITAMTests(TestCase):
    def test_exact_ids_and_unmarked_system_records(self):
        g={"ocel:events":{"a":ev("Check Out","2024-01-01T00:00:00Z"),
                          "b":ev("Other","2024-01-01T00:01:00Z")},
           "ocel:objects":{"asset001":{}}}
        s={"ocel:events":{"a":ev("Check Out","2024-01-01T00:00:00Z"),
                          "c":ev("Human Handover","2024-01-01T00:02:00Z",end=True)},
           "ocel:objects":{"asset001":{},"employee":{}}}
        r=a.compare(g,s)
        c=r["counts"]
        self.assertEqual(c["shared_exact_event_ids"],1)
        self.assertEqual(c["scene_unmarked_matching_global_timestamp_activity"],1)
        self.assertEqual(c["scene_marked_matching_global_timestamp_activity"],0)
        self.assertEqual(c["scene_only_event_ids"],1)
        self.assertFalse(r["limits"]["unmatched_events_are_hidden_work"])
        self.assertFalse(r["raw_source_events_exported"])
    def test_different_ids_same_signature_is_not_exact_id_link(self):
        g={"ocel:events":{"one":ev("Same","T")},"ocel:objects":{}}
        s={"ocel:events":{"two":ev("Same","T")},"ocel:objects":{}}
        c=a.compare(g,s)["counts"]
        self.assertEqual(c["shared_exact_event_ids"],0)
        self.assertEqual(c["matching_timestamp_and_activity_multiplicity"],1)
    def test_duplicate_signatures_count_bounded(self):
        g={"ocel:events":{"a":ev("A","T"),"b":ev("A","T")},"ocel:objects":{}}
        s={"ocel:events":{"c":ev("A","T")},"ocel:objects":{}}
        self.assertEqual(a.compare(g,s)["counts"]["matching_timestamp_and_activity_multiplicity"],1)
    def test_missing_global_is_hold(self):
        with self.assertRaisesRegex(idx.Hold,"GLOBAL_NOT_OCEL"):
            a.compare({"events":[]},{"ocel:events":{},"ocel:objects":{}})
    def test_invalid_omap_is_hold(self):
        with self.assertRaisesRegex(idx.Hold,"EVENT_SCHEMA_INVALID"):
            a.compare({"ocel:events":{"a":{"ocel:activity":"A","ocel:timestamp":"T","ocel:omap":"X"}},
                       "ocel:objects":{}},{"ocel:events":{"b":ev("A","T")},"ocel:objects":{}})
