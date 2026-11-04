import json
import sys
from pathlib import Path
from unittest import TestCase
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_c13_episode_triage as triage
import solve4x_cross_source_coverage as c12

def doc(*events):
    return {"ocel:events": {str(i): e for i,e in enumerate(events)}}
def sensor(t,label="Door opened"):
    return {"ocel:timestamp":t,"ocel:activity":label}
def video():
    return doc({"ocel:timestamp":"2024-03-25T09:00:00",
                "ocel:vmap":{"end_time":"2024-03-25T09:00:10"}})

class C13Tests(TestCase):
    def setUp(self):
        self.video=video()
        self.sensors=doc(sensor("2024-03-25T09:00:04"),
                         sensor("2024-03-25T09:00:20"))
        self.ui=(b"timestamp,eventType,context.elementType,url\n"
                 b"2024-03-25T09:00:21,Left click,INPUT,https://internal.example/sensitive\n")
    def test_scoped_episode_and_redacted_semantics(self):
        r=triage.analyze(self.video,self.sensors,self.ui)
        self.assertEqual(r["sensor_total"],2)
        self.assertEqual(r["sensor_outside_video"],1)
        self.assertEqual(r["episodes"][0]["sensor_signal_class"],
                         "ENTRANCE_REED_SWITCH_CANDIDATE")
        self.assertEqual(r["episodes"][0]["ui_event_classes"]["MOUSE_CLICK"],1)
        self.assertEqual(r["episodes"][0]["ui_target_classes"]["FORM_FIELD"],1)
        self.assertEqual(r["source_records_for_complete_candidate_review"],2)
        self.assertNotIn("https://",json.dumps(r))
        self.assertNotIn("2024-03-25",json.dumps(r))
        self.assertEqual(r["accepted_tasks"],0)
    def test_unmapped_labels_never_echo(self):
        x=doc(sensor("2024-03-25T09:00:20","Jane Doe secret project"))
        ui=b"timestamp,eventType\n2024-03-25T09:00:21,Jane Doe logged in\n"
        r=triage.analyze(self.video,x,ui)
        self.assertEqual(r["episodes"][0]["sensor_signal_class"],"UNMAPPED_SENSOR_ACTIVITY")
        self.assertEqual(r["episodes"][0]["ui_event_classes"]["UNMAPPED_BROWSER_EVENT"],1)
        self.assertNotIn("Jane",str(r))
    def test_two_sensors_one_ui_not_two_matches(self):
        x=doc(sensor("2024-03-25T09:00:20"),sensor("2024-03-25T09:00:22"))
        r=triage.analyze(self.video,x,self.ui)
        self.assertEqual(r["unique_ui_candidate_records_5s"],1)
        self.assertEqual(r["one_to_one_time_only_upper_bound_5s"],1)
        self.assertEqual(r["source_records_for_complete_candidate_review"],3)
    def test_timezone_abstention(self):
        x=doc(sensor("2024-03-25T09:00:20+01:00"))
        with self.assertRaisesRegex(c12.Hold,"CLOCK_CALIBRATION_UNKNOWN"):
            triage.analyze(self.video,x,self.ui)
    def test_eventtype_column_required(self):
        with self.assertRaisesRegex(c12.Hold,"UI_EVENTTYPE_FIELD_INVALID"):
            triage.analyze(self.video,self.sensors,b"timestamp,other\n2024-03-25T09:00:21,click\n")
    def test_no_near_ui_stays_unknown(self):
        r=triage.analyze(self.video,self.sensors,
            b"timestamp,eventType\n2024-03-25T09:05:21,Left click\n")
        self.assertEqual(r["episodes"][0]["nearby_ui_record_count"],0)
        self.assertEqual(r["episodes"][0]["same_human_action"],"UNKNOWN")
        self.assertEqual(r["new_human_actions_confirmed"],0)
    def test_closed_source_vocabulary(self):
        self.assertEqual(triage.sensor_category("Mouse cupboard open"),
                         "CUPBOARD_REED_SWITCH_CANDIDATE")
        self.assertEqual(triage.sensor_category("Shelf distance"),
                         "DISTANCE_SHELF_CANDIDATE")
        self.assertEqual(triage.sensor_category("Temperature humidity"),
                         "TEMPERATURE_HUMIDITY_CANDIDATE")
    def test_unmapped_target_never_echoes(self):
        b=b"timestamp,eventType,context.elementType\n2024-03-25T09:00:21,click,secret_441\n"
        r=triage.analyze(self.video,self.sensors,b)
        self.assertEqual(r["episodes"][0]["ui_target_classes"]["UNMAPPED_TARGET"],1)
        self.assertNotIn("secret_441",str(r))
