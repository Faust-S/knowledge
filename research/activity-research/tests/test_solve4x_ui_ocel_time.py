import sys
from pathlib import Path
from unittest import TestCase
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import solve4x_ui_ocel_time as mod
import solve4x_zip_range_probe as archive

def event(t,marked=False):
 return {"ocel:timestamp":t,"ocel:activity":"A","ocel:omap":[],
         "ocel:vmap":{"end_time":"2024-01-01T00:00:02Z"} if marked else {}}

class TemporalTests(TestCase):
 def setUp(self):
  self.csv=b'timestamp,action\n2024-01-01T00:00:00Z,click\n2024-01-01T00:00:03Z,click\n'
  self.scene={"ocel:events":{"sys":event("2024-01-01T00:00:01Z"),
                             "vid":event("2024-01-01T00:00:03Z",True)}}
 def test_windows_are_counts_not_claims(self):
  r=mod.analyze(self.csv,self.scene)
  self.assertEqual(r["counts"]["window_counts"]["1s"]["ui_near_system"],1)
  self.assertEqual(r["counts"]["window_counts"]["5s"]["ui_near_system"],2)
  self.assertEqual(r["counts"]["window_counts"]["1s"]["ui_near_video_derived"],1)
  self.assertFalse(r["limitations"]["temporal_proximity_confirms_same_action"])
  self.assertEqual(r["limitations"]["accepted_tasks"],0)
 def test_ambiguous_many_to_one_is_not_pairs(self):
  r=mod.analyze(self.csv,self.scene)
  self.assertTrue(r["limitations"]["matched_event_pairs_are_not_one_to_one"])
 def test_missing_timezone_holds(self):
  with self.assertRaisesRegex(archive.Hold,"TIMESTAMP_TIMEZONE_REQUIRED"):
   mod.to_epoch("2024-01-01T00:00:00")
 def test_invalid_csv_is_hold(self):
  with self.assertRaises(archive.Hold):
   mod.parse_csv(b'activity,other\na,b\n')
 def test_missing_scene_is_hold(self):
  with self.assertRaisesRegex(archive.Hold,"SCENE_OCEL_EVENTS_MISSING"):
   mod.analyze(self.csv,{})
