import json
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import solve4x_c16_review_footprint as c

def e(start,end,label):
    return {'ocel:timestamp':start,'ocel:vmap':{'end_time':end},'ocel:activity':label}
def v(*events):
    return {'ocel:events':{str(i):ev for i,ev in enumerate(events)}}
def close(*values):
    return [(c.naive_timestamp(x),'ENTRANCE','CLOSED') for x in values]

class FootprintTests(unittest.TestCase):
    def setUp(self):
        self.doc=v(e('2024-03-25T08:48:30','2024-03-25T08:48:38','Enter room'),
                   e('2024-03-25T08:48:39','2024-03-25T08:48:45','Access equipment'),
                   e('2024-03-25T08:50:40','2024-03-25T08:51:00','Leave room'),
                   e('2024-03-25T08:51:01','2024-03-25T08:51:03','Use form'))
        self.closed=close('2024-03-25T08:48:38.4','2024-03-25T08:51:02')

    def test_durations(self):
        r=c.analyze(self.doc,self.closed)
        self.assertEqual(r['denominators'],{'video_annotation_total':4,'literal_enter_leave_annotations':2,'out_of_video_door_closings':2})
        self.assertEqual(r['review_baselines']['all_published_video_annotations']['sum_of_annotated_interval_seconds'],36)
        self.assertEqual(r['review_baselines']['literal_enter_leave_labels_only']['sum_of_annotated_interval_seconds'],28)
        self.assertEqual(r['fixed_window_selection']['1s']['annotations_to_review'],1)
        self.assertEqual(r['fixed_window_selection']['5s']['annotations_to_review'],2)
        self.assertIsNone(r['human_effort_seconds_delta'])
    def test_union_overlaps(self):
        self.assertEqual(c._union_seconds([(0.,10.,None),(9.,11.,None),(15.,16.,None)]),20.)
    def test_two_closings_one_annotation(self):
        r=c.analyze(v(e('2024-03-25T08:48:30','2024-03-25T08:48:38','Enter room')),close('2024-03-25T08:48:38.1','2024-03-25T08:48:38.5'))
        self.assertEqual(r['fixed_window_selection']['1s']['annotations_to_review'],1)
    def test_early_close_not_matched(self):
        r=c.analyze(v(e('2024-03-25T08:48:30','2024-03-25T08:48:38','Enter room')),close('2024-03-25T08:48:29.9'))
        self.assertEqual(r['fixed_window_selection']['5s']['closing_events_without_candidate'],1)
    def test_ambiguous_candidate_count(self):
        r=c.analyze(v(e('2024-03-25T08:48:30','2024-03-25T08:48:38','Enter room'),
                      e('2024-03-25T08:48:30','2024-03-25T08:48:38','Leave room')),close('2024-03-25T08:48:38.2'))
        self.assertEqual(r['fixed_window_selection']['1s']['closing_events_with_ambiguous_candidates'],1)
    def test_other_label_not_promoted(self):
        r=c.analyze(v(e('2024-03-25T08:48:30','2024-03-25T08:48:38','private actor entered room')),self.closed)
        self.assertEqual(r['denominators']['literal_enter_leave_annotations'],0)
        self.assertNotIn('private actor',json.dumps(r))
    def test_aware_clock_hold(self):
        with self.assertRaisesRegex(c.Hold,'C16_CLOCK_DOMAIN_UNKNOWN'):
            c.analyze(v(e('2024-03-25T08:48:30Z','2024-03-25T08:48:38Z','Enter room')),self.closed)
    def test_invalid_duration_hold(self):
        with self.assertRaisesRegex(c.Hold,'C16_VIDEO_DURATION_INVALID'):
            c.analyze(v(e('2024-03-25T08:48:39','2024-03-25T08:48:38','Enter room')),self.closed)
    def test_nonfinite_sensor_hold(self):
        with self.assertRaisesRegex(c.Hold,'C16_SENSOR_TIME_INVALID'):
            c.analyze(self.doc,[(float('inf'),'ENTRANCE','CLOSED')])
    def test_opening_not_selected(self):
        t=self.closed[0][0]
        r=c.analyze(self.doc,[(t,'ENTRANCE','OPENED'),(t,'UNKNOWN','CLOSED')])
        self.assertEqual(r['denominators']['out_of_video_door_closings'],0)
    def test_fixed_shifts_and_abstention(self):
        r=c.analyze(self.doc,self.closed)
        self.assertEqual(set(r['predeclared_offset_sensitivity_candidate_counts_5s']),{'+1s','-1s','+5s','-5s','+90s','+86400s'})
        self.assertEqual(r['predeclared_offset_sensitivity_candidate_counts_5s']['+86400s'],0)
        self.assertEqual(r['correct_unknown_rate'],'NOT_MEASURED')
        self.assertFalse(r['reviewer_gains_measured'])
        self.assertEqual(r['accepted_tasks'],0)
    def test_redaction(self):
        d=v(e('2024-03-25T08:48:30','2024-03-25T08:48:38','Enter room'))
        d['ocel:events']={'private-case':next(iter(d['ocel:events'].values()))}
        r=c.analyze(d,self.closed)
        self.assertNotIn('private-case',json.dumps(r))
        self.assertNotIn('2024-03-25',json.dumps(r))
    def test_empty_video_hold(self):
        with self.assertRaisesRegex(c.Hold,'C16_VIDEO_EVENT_COUNT_INVALID'):
            c.analyze(v(),self.closed)
