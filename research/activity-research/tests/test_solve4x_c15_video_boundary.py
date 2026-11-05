import json
import sys
from pathlib import Path
from unittest import TestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_c14_raw_reed_review as c14
import solve4x_cross_source_coverage as c12


def video_event(t, end, label):
    return {"ocel:timestamp": t, "ocel:activity": label,
            "ocel:vmap": {"end_time": end}}


def video_doc(*events):
    return {"ocel:events": {str(i): event for i, event in enumerate(events)}}


def closings(*timestamps):
    return [(c12.stamp(t), "ENTRANCE", "CLOSED") for t in timestamps]


class VideoBoundaries(TestCase):
    def setUp(self):
        self.video = video_doc(
            video_event("2024-03-25T08:48:32", "2024-03-25T08:48:37", "Enter room"),
            video_event("2024-03-25T08:50:55", "2024-03-25T08:50:59", "Leave room"),
            video_event("2024-03-25T08:49:00", "2024-03-25T08:49:05", "Check asset"))
        self.events = closings("2024-03-25T08:48:38", "2024-03-25T08:51:01")

    def test_room_entries_and_exits_proximity(self):
        r = c14.video_boundary_evidence(self.video, self.events)
        w = r["fixed_boundary_windows"]["5s"]
        self.assertEqual(w["closings_with_candidate"], 2)
        self.assertEqual(w["one_to_one_time_boundary_upper_bound"], 2)
        self.assertEqual(w["enter_room_edges"], 1)
        self.assertEqual(w["leave_room_edges"], 1)
        self.assertEqual(r["non_door_video_boundary_baseline"]["5s"]["candidate_annotation_edges"], 0)
        self.assertFalse(r["clock_synchronization_confirmed"])

    def test_two_closings_same_annotation_not_two_unique_pairs(self):
        e = closings("2024-03-25T08:48:37.100", "2024-03-25T08:48:37.200")
        w = c14.video_boundary_evidence(self.video, e)["fixed_boundary_windows"]["1s"]
        self.assertEqual(w["closings_with_candidate"], 2)
        self.assertEqual(w["one_to_one_time_boundary_upper_bound"], 1)

    def test_other_label_is_baseline_only(self):
        e = closings("2024-03-25T08:49:06")
        r = c14.video_boundary_evidence(self.video, e)
        self.assertEqual(r["fixed_boundary_windows"]["5s"]["candidate_annotation_edges"], 0)
        self.assertEqual(r["non_door_video_boundary_baseline"]["5s"]["candidate_annotation_edges"], 1)

    def test_plus_day_negative(self):
        r = c14.video_boundary_evidence(self.video, self.events)
        self.assertEqual(r["plus_one_day_negative_15s"]["candidate_annotation_edges"], 0)

    def test_entrance_opened_is_excluded(self):
        e = self.events + [(self.events[0][0], "ENTRANCE", "OPENED")]
        r = c14.video_boundary_evidence(self.video, e)
        self.assertEqual(r["outside_video_entrance_closing_events"], 2)

    def test_unknown_label_never_promoted(self):
        v = video_doc(video_event("2024-03-25T08:48:32",
                                  "2024-03-25T08:48:37",
                                  "Private person is at door"))
        r = c14.video_boundary_evidence(v, self.events)
        self.assertEqual(r["video_entrance_exit_annotations"], 0)

    def test_aware_time_holds(self):
        v = video_doc(video_event("2024-03-25T08:48:32Z",
                                  "2024-03-25T08:48:37Z", "Enter room"))
        with self.assertRaisesRegex(c12.Hold, "CLOCK_CALIBRATION_UNKNOWN"):
            c14.video_boundary_evidence(v, self.events)

    def test_reversed_time_holds(self):
        v = video_doc(video_event("2024-03-25T08:48:40",
                                  "2024-03-25T08:48:37", "Enter room"))
        with self.assertRaisesRegex(c12.Hold, "C15_VIDEO_INTERVAL_REVERSED"):
            c14.video_boundary_evidence(v, self.events)

    def test_aggregation_redacts_source_values_and_actor_ids(self):
        v = video_doc(video_event("2024-03-25T08:48:32",
                                  "2024-03-25T08:48:37",
                                  "private@example.test"))
        r = c14.video_boundary_evidence(v, self.events)
        serialized = json.dumps(r)
        self.assertNotIn("private@example.test", serialized)
        self.assertNotIn("08:48", serialized)
        self.assertEqual(r["same_human_action"], "UNKNOWN")
        self.assertEqual(r["accepted_tasks"], 0)
        self.assertFalse(r["source_values_and_actor_ids_exported"])
