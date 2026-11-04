import json
import sys
from pathlib import Path
from unittest import TestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_scene_component_lineage as a


def e(name="Act", time="2024-03-25T08:00:00", links=None, vmap=None):
    return {"ocel:activity": name, "ocel:timestamp": time,
            "ocel:omap": links or [], "ocel:vmap": vmap or {}}


def doc(**events):
    return {"ocel:events": events, "ocel:objects": {}}


class LineageTest(TestCase):
    def test_exact_component_union_and_no_unproven_itam(self):
        joined = doc(v1=e("Video", links=["A"], vmap={"end_time":"T"}),
                     s1=e("Sensor"), s2=e("Sensor 2"))
        video = doc(v1=e("Video", links=["A"]))
        sensor = doc(s1=e("Sensor"), s2=e("Sensor 2"))
        r = a.analyze(joined, video, sensor)
        self.assertEqual(r["counts"]["video_only_exact"], 1)
        self.assertEqual(r["counts"]["sensor_only_exact"], 2)
        self.assertEqual(r["counts"].get("joined_event_not_in_components", 0), 0)
        self.assertEqual(r["counts"]["joined_without_end_time_field"], 2)
        self.assertFalse(r["joined_event_not_in_components_is_itam_event"])
        self.assertEqual(r["accepted_tasks"], 0)

    def test_same_activity_different_id_is_not_same_event(self):
        r = a.analyze(doc(j1=e("A")), doc(v1=e("A")), doc())
        self.assertEqual(r["counts"]["joined_event_not_in_components"], 1)
        self.assertEqual(r["counts"]["video_events_absent_from_joined"], 1)

    def test_conflicting_same_id_not_promoted(self):
        r = a.analyze(doc(x=e("A",links=["1"])), doc(x=e("A",links=["2"])), doc())
        self.assertEqual(r["counts"]["joined_video_same_id_core_conflict"], 1)
        self.assertEqual(r["counts"]["source_id_present_but_no_exact_core"], 1)
        self.assertEqual(r["counts"].get("video_only_exact", 0), 0)

    def test_duplicate_object_link_counts(self):
        r = a.analyze(doc(x=e(links=["1","1"])), doc(x=e(links=["1"])), doc())
        self.assertEqual(r["counts"]["source_id_present_but_no_exact_core"], 1)

    def test_two_component_copies_are_not_independent(self):
        r = a.analyze(doc(x=e()), doc(x=e()), doc(x=e()))
        self.assertEqual(r["counts"]["both_components_exact"], 1)
        self.assertFalse(r["video_and_sensor_both_exact_is_independent_confirmation"])

    def test_sensor_missing_event_in_joined_detected(self):
        r = a.analyze(doc(x=e()), doc(x=e()), doc(y=e()))
        self.assertEqual(r["counts"]["sensor_events_absent_from_joined"], 1)

    def test_malformed_object_links_reject(self):
        with self.assertRaisesRegex(a.Hold, "VIDEO_OBJECT_LINKS_INVALID"):
            a.analyze(doc(x=e()), doc(x={"ocel:activity":"A",
                                        "ocel:timestamp":"T","ocel:omap":"A"}), doc())

    def test_missing_component_reject_not_zero(self):
        with self.assertRaisesRegex(a.Hold, "SENSOR_NOT_OCEL"):
            a.analyze(doc(x=e()),doc(x=e()),{})

    def test_output_redacted(self):
        r = a.analyze(doc(secret_id=e("Secret person name",links=["sensitive-object"])),
                      doc(),doc())
        out = json.dumps(r)
        self.assertNotIn("secret_id",out)
        self.assertNotIn("Secret person name",out)
        self.assertNotIn("sensitive-object",out)
        self.assertEqual(r["human_action_gold"],"NOT_MEASURED")
