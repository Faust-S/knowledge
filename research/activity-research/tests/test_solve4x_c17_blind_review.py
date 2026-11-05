import copy
import json
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_c17_blind_review as c17
import solve4x_c16_review_footprint as c16


class C17BlindReview(unittest.TestCase):
    def setUp(self):
        start = datetime(2024, 3, 25, 8, 30)
        self.video = {'ocel:events': {}}
        self.closed = []
        for i in range(23):
            t = start + timedelta(seconds=10*i)
            end = t + timedelta(seconds=5)
            label = ('Enter room' if i in (0, 8, 16) else
                     'Leave room' if i in (4, 12, 20) else 'Equipment activity')
            self.video['ocel:events']['private-source-'+str(i)] = {
                'ocel:timestamp':t.isoformat(),
                'ocel:vmap':{'end_time':end.isoformat()},
                'ocel:activity':label,
                'ocel:actor':'secret-actor',
            }
            if i in (0, 8, 16):
                self.closed.append((c16.naive_timestamp(end.isoformat())+0.7,
                                    'ENTRANCE', 'CLOSED'))
        self.packet = c17.prepare(self.video, self.closed)

    def receipts(self):
        forms = {}
        for ordinal, role in enumerate(c17.ROLES, 1):
            form = c17.blank_receipt(self.packet, role)
            form['reviewer_key'] = 'private-reviewer-'+str(ordinal)
            for row in form['items']:
                row.update(verdict='UNKNOWN', active_seconds=2.0,
                           label_studio_lead_time_seconds=3.0)
            forms[role] = form
        return forms

    def test_cohort_counts_and_c16_selection(self):
        s = c17.public_plan(self.packet)
        self.assertEqual(s['denominators'], {'video_annotations':23,
                         'literal_enter_leave':6, 'reed_focused':3})
        self.assertEqual(len(self.packet['blind_tasks']['arm_all']), 23)
        self.assertEqual(len(self.packet['blind_tasks']['arm_reed_closed_after_end_5s']),3)
        self.assertEqual(len(self.packet['blind_tasks']['reference_a']),23)
        self.assertIsNone(s['active_review_seconds'])
        self.assertEqual(s['human_activity_gold'],'NOT_MEASURED')
        self.assertFalse(s['real_video_decoded'])

    def test_no_private_source_identifiers_in_public_plan_and_blind_tasks(self):
        public = json.dumps(c17.public_plan(self.packet))
        blinds = json.dumps(self.packet['blind_tasks'])
        for secret in ('private-source','secret-actor','2024-03-25',
                       'Enter room','Leave room'):
            self.assertNotIn(secret, public+blinds)
        self.assertIn('private-source-0',json.dumps(self.packet['owner_index']))

    def test_stable_with_shuffled_event_insertion(self):
        reversed_doc = {'ocel:events': dict(reversed(list(self.video['ocel:events'].items())))}
        self.assertEqual(c17.prepare(reversed_doc,self.closed)['plan_sha256'],
                         self.packet['plan_sha256'])

    def test_blank_form_never_invents_review_or_seconds(self):
        blank = c17.blank_receipt(self.packet,'reference_b')
        self.assertIsNone(blank['reviewer_key'])
        self.assertTrue(all(row['verdict'] is None and row['active_seconds'] is None
                            for row in blank['items']))
        with self.assertRaisesRegex(c17.ReviewHold,'C17_REVIEWER_CLAIM_REQUIRED'):
            c17.score(self.packet, {**self.receipts(),'reference_b':blank})

    def test_aggregate_scoring_and_ambiguous_reference(self):
        forms = self.receipts()
        all_ids = self.packet['arms']['all']
        select = self.packet['arms']['reed_closed_after_end_5s']
        omitted = next(x for x in all_ids if x not in select)
        for role in ('reference_a','reference_b','adjudicator'):
            for row in forms[role]['items']:
                if row['clip_id'] in (select[0], omitted):
                    row['verdict']='VISIBLE_ENTER_OR_EXIT'
        forms['reference_b']['items'][0]['verdict']='NOT_VISIBLE'
        for row in forms['arm_all']['items']:
            row['verdict']='VISIBLE_ENTER_OR_EXIT' if row['clip_id']==select[0] else 'UNKNOWN'
        for row in forms['arm_reed_closed_after_end_5s']['items']:
            row['verdict']='VISIBLE_ENTER_OR_EXIT' if row['clip_id']==select[0] else 'UNKNOWN'
        result = c17.score(self.packet, forms)
        self.assertEqual(result['denominators']['adjudicated_visible'],2)
        self.assertEqual(result['denominators']['reference_a_b_disagreements'],1)
        focused = result['arm_summaries']['reed_closed_after_end_5s']
        self.assertEqual(focused['adjudicated_visible_omitted'],1)
        self.assertEqual(focused['adjudicated_visible_in_selection'],1)
        self.assertEqual(focused['visible_clip_retrieval_fraction'],0.5)
        self.assertEqual(focused['reported_active_seconds'],6.)
        self.assertEqual(result['arm_summaries']['all']['reported_active_seconds'],46.)
        self.assertEqual(result['descriptive_active_seconds_full_minus_focused'],40.)
        self.assertFalse(result['causal_labor_saving_established'])
        self.assertIsNone(result['task_precision'])
        self.assertNotIn('private-reviewer',json.dumps(result))
        self.assertNotIn('private-source',json.dumps(result))

    def test_no_visible_denominator_is_null_not_perfect_recall(self):
        r = c17.score(self.packet,self.receipts())
        self.assertIsNone(r['arm_summaries']['all']['visible_clip_retrieval_fraction'])
        self.assertEqual(r['denominators']['adjudicated_unknown'],23)

    def test_missing_time_stays_null_with_complete_verdicts(self):
        forms = self.receipts()
        forms['arm_all']['items'][0]['active_seconds']=None
        forms['arm_literal_enter_leave']['items'][0]['label_studio_lead_time_seconds']=None
        r=c17.score(self.packet,forms)
        self.assertIsNone(r['arm_summaries']['all']['reported_active_seconds'])
        self.assertIsNone(r['arm_summaries']['literal_enter_leave']['label_studio_lead_time_seconds'])
        self.assertIsNone(r['descriptive_active_seconds_full_minus_focused'])

    def test_confident_claim_on_unknown_not_scored_as_false_truth(self):
        forms = self.receipts()
        forms['arm_all']['items'][0]['verdict']='VISIBLE_ENTER_OR_EXIT'
        forms['arm_all']['items'][1]['verdict']='VISIBLE_ENTER_OR_EXIT'
        forms['adjudicator']['items'][1]['verdict']='NOT_VISIBLE'
        r = c17.score(self.packet,forms)['arm_summaries']['all']
        self.assertEqual(r['confident_on_adjudicated_unknown'],1)
        self.assertEqual(r['confident_contradictions_vs_adjudicator'],1)

    def test_reject_duplicate_clip(self):
        forms=self.receipts()
        forms['arm_all']['items'][1]['clip_id']=forms['arm_all']['items'][0]['clip_id']
        with self.assertRaisesRegex(c17.ReviewHold,'C17_REVIEW_ROW_INVALID'):
            c17.score(self.packet,forms)

    def test_reject_stale_manifest_receipt(self):
        forms=self.receipts()
        forms['reference_a']['plan_sha256']='0'*64
        with self.assertRaisesRegex(c17.ReviewHold,'C17_REVIEW_RECEIPT_NOT_BOUND'):
            c17.score(self.packet,forms)

    def test_reject_missing_full_reference_coverage(self):
        forms=self.receipts()
        forms['reference_a']['items'].pop()
        with self.assertRaisesRegex(c17.ReviewHold,'C17_REVIEW_COVERAGE_INCOMPLETE'):
            c17.score(self.packet,forms)

    def test_reject_reused_reviewer_claim(self):
        forms=self.receipts()
        forms['arm_all']['reviewer_key']=forms['reference_a']['reviewer_key']
        with self.assertRaisesRegex(c17.ReviewHold,'C17_REUSED_REVIEWER_CLAIM'):
            c17.score(self.packet,forms)

    def test_reject_unapproved_verdict_and_bool_seconds(self):
        forms=self.receipts()
        forms['arm_all']['items'][0]['verdict']='SOME_TASK_ACCEPTED'
        with self.assertRaisesRegex(c17.ReviewHold,'C17_REVIEW_ROW_INVALID'):
            c17.score(self.packet,forms)
        forms=self.receipts()
        forms['arm_all']['items'][0]['active_seconds']=True
        with self.assertRaisesRegex(c17.ReviewHold,'C17_REVIEW_SECONDS_INVALID'):
            c17.score(self.packet,forms)

    def test_reject_nonfinite_overflow_and_negative(self):
        for bad in (float('inf'),float('nan'),-3,10**1000):
            forms=self.receipts()
            forms['arm_all']['items'][0]['active_seconds']=bad
            with self.assertRaises(c17.ReviewHold):
                c17.score(self.packet,forms)

    def test_reject_bad_input_time_and_aware_clocks(self):
        bad=copy.deepcopy(self.video)
        bad['ocel:events']['private-source-0']['ocel:timestamp']='2024-03-25T08:00:00Z'
        with self.assertRaisesRegex(c16.Hold,'C16_CLOCK_DOMAIN_UNKNOWN'):
            c17.prepare(bad,self.closed)
        with self.assertRaisesRegex(c17.ReviewHold,'C17_SOURCE_SHA_INVALID'):
            c17.prepare(self.video,self.closed,source_sha256='bad')

    def test_packet_tampering_rejected(self):
        bad=copy.deepcopy(self.packet)
        bad['owner_index'][0]['annotation_end']='2024-03-25T20:00:00'
        with self.assertRaisesRegex(c17.ReviewHold,'C17_PACKET_FINGERPRINT_MISMATCH'):
            c17.public_plan(bad)
        bad=copy.deepcopy(self.packet)
        bad['arms']['reed_closed_after_end_5s'].append(bad['arms']['all'][-1])
        with self.assertRaisesRegex(c17.ReviewHold,'C17_PACKET_FINGERPRINT_MISMATCH'):
            c17.public_plan(bad)

    def test_missing_receipts_fail_closed(self):
        with self.assertRaisesRegex(c17.ReviewHold,'C17_REVIEW_RECEIPTS_INCOMPLETE'):
            c17.score(self.packet,{})

    def test_unknown_not_relabelled_negative_for_recall(self):
        forms=self.receipts()
        selected = self.packet['arms']['reed_closed_after_end_5s']
        for row in forms['adjudicator']['items']:
            if row['clip_id']==selected[0]:
                row['verdict']='VISIBLE_ENTER_OR_EXIT'
        r=c17.score(self.packet,forms)
        self.assertEqual(r['arm_summaries']['reed_closed_after_end_5s']['visible_clip_retrieval_fraction'],1)
        self.assertEqual(r['denominators']['adjudicated_unknown'],22)
        self.assertFalse(r['adjudicator_truth_independently_verified'])


if __name__=='__main__':
    unittest.main()
