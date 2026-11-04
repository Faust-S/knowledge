import json
import sys
from pathlib import Path
from unittest import TestCase
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import solve4x_cross_source_coverage as a
def event(t,end=None):
 return {"ocel:timestamp":t,"ocel:vmap":{"end_time":end} if end else {}}
def doc(*xs):
 return {"ocel:events":{str(i):v for i,v in enumerate(xs)}}
class CrossSourceTests(TestCase):
 def setUp(self):
  self.video=doc(event("2024-03-25T09:00:00","2024-03-25T09:00:10"))
  self.sensor=doc(event("2024-03-25T09:00:04"),event("2024-03-25T09:00:21"))
  self.ui=b'timestamp,eventType\n2024-03-25T09:00:05,click\n2024-03-25T09:00:22,click\n'
 def test_conditional_coverage(self):
  result=a.analyze(self.video,self.sensor,self.ui)
  self.assertEqual(result["denominators"]["sensor_events"],2)
  self.assertEqual(result["sensor_video"]["outside"],1)
  self.assertEqual(result["sensor_ui"]["1s"]["one_to_one_upper_bound"],2)
  self.assertEqual(result["plus_one_day_negative"]["30s"]["candidate_edges"],0)
  self.assertFalse(result["calibrated_clock"])
  self.assertEqual(result["accepted_tasks"],0)
 def test_many_to_one_candidate_not_two_matches(self):
  r=a.pairing([1,2],[1.5],1)
  self.assertEqual(r["sensor_with_ui"],2)
  self.assertEqual(r["one_to_one_upper_bound"],1)
 def test_timezone_requires_abstention(self):
  with self.assertRaisesRegex(a.Hold,"CALIBRATION_UNKNOWN"):
   a.analyze(self.video,self.sensor,b'timestamp,eventType\n2024-03-25T09:00:05Z,click\n')
 def test_invalid_csv_missing_column(self):
  with self.assertRaisesRegex(a.Hold,"UI_TIMESTAMP_COLUMN_MISSING"):
   a.analyze(self.video,self.sensor,b'action,other\na,b\n')
 def test_reversed_video_interval(self):
  with self.assertRaisesRegex(a.Hold,"VIDEO_INTERVAL_INVALID"):
   a.analyze(doc(event("2024-03-25T09:00:11","2024-03-25T09:00:10")),self.sensor,self.ui)
 def test_video_end_missing(self):
  with self.assertRaisesRegex(a.Hold,"TIMESTAMP_MISSING"):
   a.analyze(doc(event("2024-03-25T09:00:11")),self.sensor,self.ui)
 def test_zero_sensors(self):
  with self.assertRaisesRegex(a.Hold,"OCEL_EVENTS_EMPTY"):
   a.analyze(self.video,doc(),self.ui)
 def test_interval_inclusive_edges(self):
  r=a.inside([10,20,21],[(10,20)])
  self.assertEqual(r["inside"],2)
  self.assertEqual(r["outside"],1)
 def test_no_source_value_export(self):
  r=a.analyze(self.video,self.sensor,self.ui)
  self.assertNotIn("2024-03-25",json.dumps(r))
  self.assertNotIn("click",json.dumps(r))
 def test_empty_ui(self):
  with self.assertRaisesRegex(a.Hold,"UI_FILE_INVALID"):
   a.analyze(self.video,self.sensor,b'')
