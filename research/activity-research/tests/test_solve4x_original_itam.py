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
    def test_original_itam_unmarked_exact_match_only(self):
        original_bytes=(b'{"ocel:events":{"evt-1":{"ocel:activity":"Check out",'
                        b'"ocel:timestamp":"2024-01-01T00:00:00"},'
                        b'"evt-2":{"ocel:activity":"Other",'
                        b'"ocel:timestamp":"2024-01-01T00:01:00"}}}')
        scene_bytes=(b'{"ocel:events":{"evt-1":{"ocel:activity":"Check out",'
                     b'"ocel:timestamp":"2024-01-01T00:00:00"},'
                     b'"video-1":{"ocel:activity":"Human action",'
                     b'"ocel:timestamp":"2024-01-01T00:00:05",'
                     b'"ocel:vmap":{"end_time":"2024-01-01T00:00:06"}}}}')
        r=original.compare_original_itam_to_scene(original_bytes,scene_bytes)
        self.assertEqual(r["literal_event_id_intersection"],1)
        self.assertEqual(r["literal_activity_and_timestamp_multiset_intersection"],1)
        self.assertEqual(r["scene_non_video_marker_events"],1)
        self.assertFalse(r["literal_event_match_proves_independent_human_action"])
        self.assertFalse(r["raw_values_exported"])
        self.assertEqual(r["human_task_gold"],"NOT_MEASURED")
    def test_unrecognised_event_schema_abstains(self):
        source=b'{"object":"x","action":"y"}'
        scene=b'{"ocel:events":{}}'
        r=original.compare_original_itam_to_scene(source,scene)
        self.assertEqual(r["status"],"ORIGINAL_ITAM_EVENT_SCHEMA_NOT_QUALIFIED")
        self.assertEqual(r["matched_scene_unmarked"],"NOT_MEASURED")
        self.assertEqual(r["accepted_tasks"],0)
    def test_same_activity_different_timestamp_not_exact(self):
        source=(b'{"ocel:events":{"1":{"ocel:activity":"A",'
                b'"ocel:timestamp":"2024-01-01T00:00:00"}}}')
        scene=(b'{"ocel:events":{"1":{"ocel:activity":"A",'
               b'"ocel:timestamp":"2024-01-01T00:00:01"}}}')
        r=original.compare_original_itam_to_scene(source,scene)
        self.assertEqual(r["literal_event_id_intersection"],1)
        self.assertEqual(r["exact_ids_and_activity_timestamp"],0)
        self.assertFalse(r["time_zone_or_clock_calibration_proven"])
    def test_event_object_links_need_same_membership(self):
        original_data=(b'{"ocel:events":{"evt-1":{"ocel:activity":"Use",'
                       b'"ocel:timestamp":"2024-01-01T00:00:00",'
                       b'"ocel:omap":["asset-A","person-1"]}}}')
        scene_equal=(b'{"ocel:events":{"evt-1":{"ocel:activity":"Use",'
                     b'"ocel:timestamp":"2024-01-01T00:00:00",'
                     b'"ocel:omap":["person-1","asset-A"]}}}')
        same=original.compare_original_itam_to_scene(original_data,scene_equal)
        self.assertEqual(same["exact_ids_timestamp_activity_and_object_links"],1)
        self.assertEqual(same["shared_event_ids_with_comparable_object_links"],1)
        scene_different=scene_equal.replace(b"person-1",b"person-2")
        diff=original.compare_original_itam_to_scene(original_data,scene_different)
        self.assertEqual(diff["exact_ids_and_activity_timestamp"],1)
        self.assertEqual(diff["exact_ids_timestamp_activity_and_object_links"],0)
        self.assertEqual(diff["accepted_tasks"],0)
    def test_missing_object_links_abstains(self):
        data=b'{"ocel:events":{"a":{"ocel:activity":"A","ocel:timestamp":"T"}}}'
        r=original.compare_original_itam_to_scene(data,data)
        self.assertEqual(r["shared_event_ids_with_comparable_object_links"],0)
        self.assertEqual(r["exact_ids_timestamp_activity_and_object_links"],0)
    def test_duplicate_object_links_are_not_exact(self):
        source=(b'{"ocel:events":{"1":{"ocel:activity":"A",'
                b'"ocel:timestamp":"T","ocel:omap":["X","X"]}}}')
        scene=(b'{"ocel:events":{"1":{"ocel:activity":"A",'
               b'"ocel:timestamp":"T","ocel:omap":["X"]}}}')
        result=original.compare_original_itam_to_scene(source,scene)
        self.assertEqual(result["exact_ids_and_activity_timestamp"],1)
        self.assertEqual(result["shared_event_ids_with_comparable_object_links"],1)
        self.assertEqual(result["exact_ids_timestamp_activity_and_object_links"],0)
    def test_representation_overlap_without_event_identity(self):
        left={"e1":{"ocel:activity":"Check out",
                    "ocel:timestamp":"2024-03-25T08:48:22",
                    "ocel:omap":["sensitive-object-ID"]}}
        right={"other":{"ocel:activity":" check out ",
                       "ocel:timestamp":"2024-03-25T08:48:23",
                       "ocel:omap":["second-object-ID"]}}
        r=original.source_alignment_coverage(left,right)
        self.assertEqual(r["shared_literal_activity_strings"],0)
        self.assertEqual(r["shared_casefold_trim_activity_strings"],1)
        self.assertEqual(r["shared_literal_object_references"],0)
        self.assertEqual(r["time_window_counts"]["1s"]["scene_events_near_original"],1)
        self.assertEqual(r["clock_comparison_mode"],
                         "CONDITIONAL_SAME_NAIVE_WALL_CLOCK_NOT_CALIBRATED")
        self.assertNotIn("sensitive-object-ID",str(r))
        self.assertFalse(r["clock_calibration_confirmed"])
    def test_mixed_clock_formats_abstain(self):
        left={"e1":{"ocel:activity":"A","ocel:timestamp":"2024-03-25T10:48:22+02:00"}}
        right={"e2":{"ocel:activity":"A","ocel:timestamp":"2024-03-25T08:48:22"}}
        r=original.source_alignment_coverage(left,right)
        self.assertEqual(r["clock_comparison_mode"],
                         "UNKNOWN_MIXED_OR_INVALID_TIMESTAMP_FORMATS")
        self.assertIsNone(r["time_window_counts"]["1s"])
        self.assertEqual(r["accepted_tasks"],0)
    def test_explicit_tz_normalization_not_calibration(self):
        left={"e1":{"ocel:activity":"A","ocel:timestamp":"2024-03-25T10:48:22+02:00"}}
        right={"e2":{"ocel:activity":"A","ocel:timestamp":"2024-03-25T08:48:22Z"}}
        r=original.source_alignment_coverage(left,right)
        self.assertEqual(r["time_window_counts"]["1s"]["scene_events_near_original"],1)
        self.assertEqual(r["clock_comparison_mode"],
                         "EXPLICIT_ZONES_NORMALIZED_NOT_CALIBRATED")
        self.assertFalse(r["event_identity_or_semantic_mapping_confirmed"])
    def test_invalid_source_clock_abstains(self):
        left={"a":{"ocel:activity":"A","ocel:timestamp":"not-a-clock"}}
        right={"b":{"ocel:activity":"A","ocel:timestamp":"2024-03-25T08:48:22"}}
        r=original.source_alignment_coverage(left,right)
        self.assertEqual(r["source_timestamp_format_counts"]["INVALID"],1)
        self.assertIsNone(r["time_window_counts"]["5s"])

    def test_author_export_contract_shape_not_proof(self):
        source={"42":{"ocel:activity":"Check-Out",
                      "ocel:timestamp":"2024-03-25T07:48:23Z",
                      "ocel:omap":["item_asset_1","missing"]}}
        objects={"item_asset_1":{},"admin_user_6":{},"other-prefix":{}}
        out=original.author_exporter_contract_coverage(source,objects)
        self.assertEqual(out["ocel_object_links_resolved_in_source"],1)
        self.assertEqual(out["object_ids_with_exporter_role_prefix"],2)
        self.assertEqual(out["object_ids_without_known_role_prefix"],1)
        self.assertTrue(out["format_consistency_not_authentication"])
    def test_published_clock_candidate_and_negative_controls(self):
        src={"42":{"ocel:timestamp":"2024-03-25T07:48:22Z"}}
        scene={"A":{"ocel:timestamp":"2024-03-25T08:48:23"}}
        result=original.published_site_clock_hypothesis(src,scene)
        windows=result["variant_windows"]
        self.assertEqual(windows["AUGSBURG_EUROPE_BERLIN_HYPOTHESIS"]["1s"]["max_cardinality_time_only_pairs"],1)
        self.assertEqual(windows["UTC_NAIVE_UNCALIBRATED_CONTROL"]["30s"]["scene_events_with_candidate"],0)
        self.assertEqual(windows["NEXT_DAY_NEGATIVE_CONTROL"]["30s"]["scene_events_with_candidate"],0)
        self.assertFalse(result["clock_synchronization_proven"])
    def test_many_to_one_cannot_count_two_event_pairs(self):
        src={"42":{"ocel:timestamp":"2024-03-25T07:48:22Z"}}
        scene={"A":{"ocel:timestamp":"2024-03-25T08:48:22"},
               "B":{"ocel:timestamp":"2024-03-25T08:48:23"}}
        result=original.published_site_clock_hypothesis(src,scene)
        stats=result["variant_windows"]["AUGSBURG_EUROPE_BERLIN_HYPOTHESIS"]["1s"]
        self.assertEqual(stats["scene_events_with_candidate"],2)
        self.assertEqual(stats["max_cardinality_time_only_pairs"],1)
    def test_naive_source_and_aware_scene_abstain(self):
        src={"a":{"ocel:timestamp":"2024-03-25T07:48:22"}}
        scene={"b":{"ocel:timestamp":"2024-03-25T08:48:22"}}
        out=original.published_site_clock_hypothesis(src,scene)
        self.assertEqual(out["status"],"ORIGINAL_CLOCK_NOT_ALL_AWARE_HOLD")
        scene={"b":{"ocel:timestamp":"2024-03-25T08:48:22+01:00"}}
        src={"a":{"ocel:timestamp":"2024-03-25T07:48:22Z"}}
        self.assertEqual(original.published_site_clock_hypothesis(src,scene)["status"],
                         "SCENE_CLOCK_NOT_ALL_NAIVE_HOLD")
    def test_outside_recording_date_and_invalid_source_abstain(self):
        src={"a":{"ocel:timestamp":"2024-03-25T07:48:22Z"}}
        other={"b":{"ocel:timestamp":"2024-03-26T08:48:22"}}
        self.assertEqual(original.published_site_clock_hypothesis(src,other)["status"],
                         "SCENE_OUTSIDE_PUBLISHED_RECORDING_DATE_HOLD")
        bad={"b":{"ocel:timestamp":"bad-timestamp"}}
        self.assertEqual(original.published_site_clock_hypothesis(src,bad)["status"],
                         "SOURCE_OR_SCENE_CLOCK_INVALID_HOLD")
    def test_conditional_time_only_report_does_not_disclose_event_values(self):
        src={"hidden-source-id":{"ocel:timestamp":"2024-03-25T07:48:22Z",
                                 "ocel:activity":"sensitive-action"}}
        scene={"hidden-scene-id":{"ocel:timestamp":"2024-03-25T08:48:22",
                                   "ocel:activity":"sensitive-action"}}
        report=str(original.published_site_clock_hypothesis(src,scene))
        self.assertNotIn("hidden-",report)
        self.assertNotIn("sensitive-action",report)
        self.assertEqual(original.published_site_clock_hypothesis(src,scene)["accepted_tasks"],0)
    def test_empty_is_hold(self):
        with self.assertRaisesRegex(index.Hold,"ITAM_JSONL_BYTES_INVALID"):
            original.parse_jsonl(b'')
    def test_nonobject_is_hold(self):
        with self.assertRaisesRegex(index.Hold,"ITAM_UNSUPPORTED_WHOLE_JSON_ROOT"):
            original.parse_jsonl(b'[1,2]\n')
