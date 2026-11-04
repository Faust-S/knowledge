import sys
from pathlib import Path
from unittest import TestCase
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_same_case_audit as a
import solve4x_zip_range_probe as idx

class IdentityTests(TestCase):
    def setUp(self):
        self.v = {"localisations":[
            {"tcin":0,"tcout":1,"data":{"process":"ID001","label":"Case","activity":"Handover"}},
            {"tcin":1,"tcout":2,"data":{"process":"ID002","label":"Case","activity":"Check-Out"}}]}
        self.o = {"ocel:objects":{"ID001":{"ocel:type":"order"},
                                   "ID002":{"ocel:type":"order"}},
                  "ocel:events":{
                    "e1":{"ocel:activity":"Check-Out","ocel:omap":["ID001"]},
                    "e2":{"ocel:activity":"Other","ocel:omap":["ID002"]}}}
    def test_references_and_vocabulary_only(self):
        result=a.analyze_scene(self.v,self.o)
        self.assertEqual(result["counts"]["case_references_in_both"],2)
        self.assertEqual(result["counts"]["ocel_registered_events"],2)
        self.assertEqual(result["counts"]["shared_literal_activity_strings"],0)
        self.assertEqual(result["counts"]["video_annotated_activity_segments"],2)
        self.assertEqual(result["counts"]["literal_activity_multiset_match_without_marker"],1)
        self.assertEqual(result["counts"]["literal_activity_multiset_match_with_end_time_marker"],0)
        self.assertEqual(result["constraints"]["accepted_tasks"],0)
        self.assertEqual(result["constraints"]["independent_itam_raw_log_source"],"NOT_LOADED")
    def test_unmatched_case_not_false_confident(self):
        self.v["localisations"][0]["data"]["process"]="ID900"
        result=a.analyze_scene(self.v,self.o)
        self.assertEqual(result["counts"]["case_references_in_both"],1)
    def test_same_literal_activity_in_video_marked_ocel(self):
        self.o["ocel:events"]["e2"]["ocel:activity"]="Handover"
        self.o["ocel:events"]["e2"]["ocel:vmap"]={"end_time":"2024-01-01T00:00:00Z"}
        r=a.analyze_scene(self.v,self.o)
        self.assertEqual(r["counts"]["literal_activity_multiset_match_with_end_time_marker"],1)
        self.assertFalse(r["counts"]["literal_video_ocel_marked_activity_multisets_equal"])
        self.assertEqual(r["constraints"]["end_time_field_marker_origin"],
                         "STRUCTURAL_PROXY_NOT_INDEPENDENTLY_ATTESTED")
        self.assertEqual(result["constraints"]["false_confident_claim_rate_vs_human_gold"],"NOT_MEASURED")
    def test_no_video_localisations_is_hold(self):
        with self.assertRaisesRegex(idx.Hold,"VIDEO_LOCALISATIONS_MISSING"):
            a.analyze_scene({"localisations":None},self.o)
    def test_no_ocel_is_hold(self):
        with self.assertRaisesRegex(idx.Hold,"OCEL_EVENTS_OR_OBJECTS_MISSING"):
            a.analyze_scene(self.v,{"ocel:events":[]})
    def test_nested_annotation_is_visited(self):
        self.v["localisations"]=[{"tcin":0,"tcout":2,"data":{"label":"Scope"},
                                  "localisation":[{"tcin":0,"tcout":1,
                                                   "data":{"process":"ID001","label":"Chat"}}]}]
        result=a.analyze_scene(self.v,self.o)
        self.assertEqual(result["counts"]["author_annotation_nodes"],2)
        self.assertEqual(result["counts"]["case_references_in_both"],1)
