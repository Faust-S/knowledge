import json
import sys
from pathlib import Path
from unittest import TestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_c14_raw_reed_review as c14
import solve4x_cross_source_coverage as c12

def doc(*events):
    return {"ocel:events": {str(i): e for i, e in enumerate(events)}}
def video():
    return doc({"ocel:timestamp": "2024-03-25T09:00:00",
                "ocel:vmap": {"end_time": "2024-03-25T09:00:10"}})
def sensor(t, a="Door opened"):
    return {"ocel:timestamp": t, "ocel:activity": a}

UI = (b"timestamp,eventType,domPath,context.elementType,context.elementId,url,context.elementValue\n"
      b"2024-03-25T09:00:21,click,/secret,button,secret-id,https://private.invalid,admin\n")
RAW = (b"time,reed_switch,reed_switch_state\n"
       b"2024-03-25 09:00:20.100,reed_switch_door,reed_switch_opened\n"
       b"2024-03-25 09:00:29.100,reed_switch_door,reed_switch_closed\n")

class C14Tests(TestCase):
    def test_original_transition_not_human_gold(self):
        r=c14.analyze(video(),doc(sensor("2024-03-25T09:00:20")),UI,RAW)
        self.assertEqual(r["time_sensor_and_state"]["1s"]["one_to_one_upper_bound"],1)
        self.assertEqual(r["review_episodes"][0]["raw_state_classes"],{"OPENED":1})
        self.assertEqual(r["review_episodes"][0]["ui_context_populated_field_counts"]["has_dom_path"],1)
        self.assertEqual(r["source_rows_to_review_total"],3)
        self.assertFalse(r["limitations"]["cross_device_clock_calibration_proven"])
        self.assertNotIn("secret",json.dumps(r))
    def test_sensor_state_conflict_prevents_strong_match(self):
        r=c14.analyze(video(),doc(sensor("2024-03-25T09:00:20","Door closed")),UI,RAW)
        self.assertEqual(r["time_and_sensor_only"]["1s"]["one_to_one_upper_bound"],1)
        self.assertEqual(r["time_sensor_and_state"]["1s"]["one_to_one_upper_bound"],0)
    def test_unknown_source_state_is_unknown(self):
        r=c14.analyze(video(),doc(sensor("2024-03-25T09:00:20","Door state change")),UI,RAW)
        self.assertEqual(r["review_episodes"][0]["ocel_state_class"],"UNKNOWN")
        self.assertEqual(r["time_sensor_and_state"]["5s"]["candidate_edges"],0)
    def test_no_duplicate_pair_in_one_to_one(self):
        rows=c14.parse_raw_reed(RAW)
        e=[(rows[0][0],"ENTRANCE","OPENED"),(rows[0][0]+0.1,"ENTRANCE","OPENED")]
        result=c14._counts(e,rows,window=1,require_state=True)
        self.assertEqual(result["episodes_with_raw_candidates"],2)
        self.assertEqual(result["one_to_one_upper_bound"],1)
    def test_multiple_candidate_ambiguity(self):
        r=c14.parse_raw_reed(RAW+b"2024-03-25 09:00:20.200,reed_switch_door,reed_switch_opened\n")
        e=[(r[0][0],"ENTRANCE","OPENED")]
        self.assertEqual(c14._counts(e,r,window=1,require_state=True)["episodes_with_multiple_raw_candidates"],1)
    def test_unknown_hardware_not_matched(self):
        x=b"time,reed_switch,reed_switch_state\n2024-03-25 09:00:20,private_sensor_id,reed_switch_opened\n"
        r=c14.analyze(video(),doc(sensor("2024-03-25T09:00:20")),UI,x)
        self.assertEqual(r["raw_sensor_classes"]["UNKNOWN"],1)
        self.assertEqual(r["time_and_sensor_only"]["5s"]["candidate_edges"],0)
        self.assertNotIn("private_sensor_id",str(r))
    def test_schema_failure(self):
        with self.assertRaisesRegex(c12.Hold,"RAW_REED_SCHEMA_HOLD"):
            c14.parse_raw_reed(b"foo,bar\n1,2\n")
    def test_raw_timezone_hold(self):
        with self.assertRaisesRegex(c12.Hold,"CLOCK_CALIBRATION_UNKNOWN"):
            c14.parse_raw_reed(b"time,reed_switch,reed_switch_state\n2024-03-25T09:00:20Z,reed_switch_door,opened\n")
    def test_extra_csv_column_rejected(self):
        with self.assertRaisesRegex(c12.Hold,"RAW_REED_ROW_ARITY_HOLD"):
            c14.parse_raw_reed(RAW+b"2024-03-25 09:00:21,reed_switch_door,opened,extra\n")
    def test_out_of_order_is_counted(self):
        x=RAW+b"2024-03-25 09:00:10,reed_switch_door,reed_switch_closed\n"
        self.assertEqual(c14.analyze(video(),doc(sensor("2024-03-25T09:00:20")),UI,x)["raw_timestamps_out_of_order"],1)
    def test_unrecognized_values_redacted(self):
        x=b"time,reed_switch,reed_switch_state\n2024-03-25 09:00:20,sensitive@example.com,secret_value\n"
        r=c14.analyze(video(),doc(sensor("2024-03-25T09:00:20","private person")),UI,x)
        self.assertNotIn("sensitive",str(r))
        self.assertNotIn("private person",str(r))
        self.assertEqual(r["limitations"]["accepted_tasks"],0)
    def test_negative_day_control(self):
        r=c14.analyze(video(),doc(sensor("2024-03-25T09:00:20")),UI,RAW)
        self.assertEqual(r["sensor_plus_one_day_negative"]["candidate_edges"],0)
