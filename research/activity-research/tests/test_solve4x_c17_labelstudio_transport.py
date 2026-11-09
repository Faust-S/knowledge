"""Synthetic C17 / Label Studio transport fixtures; never human gold."""
import copy
from datetime import datetime, timedelta
import json
from pathlib import Path
import sys
import unittest
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_c16_review_footprint as c16
import solve4x_c17_blind_review as c17
import solve4x_c17_labelstudio_transport as ls


class C17LabelStudioTransport(unittest.TestCase):
    def setUp(self):
        start = datetime(2024, 3, 25, 8, 30)
        video = {'ocel:events': {}}
        closed = []
        for i in range(23):
            begin = start + timedelta(seconds=10*i)
            end = begin + timedelta(seconds=5)
            label = ('Enter room' if i in (0, 8, 16) else
                     'Leave room' if i in (4, 12, 20) else 'Equipment activity')
            video['ocel:events'][f'private-event-{i}'] = {
                'ocel:timestamp': begin.isoformat(),
                'ocel:vmap': {'end_time': end.isoformat()},
                'ocel:activity': label, 'ocel:actor': 'private-human'}
            if i in (0, 8, 16):
                closed.append((c16.naive_timestamp(end.isoformat())+0.7,
                               'ENTRANCE', 'CLOSED'))
        self.packet = c17.prepare(video, closed)
        self.pin = self.packet['plan_sha256']
        self.urls = {
            clip: f'http://127.0.0.1:8080/data/local-files/?d=clips/{clip}.mp4'
            for clip in self.packet['arms']['all']}

    @staticmethod
    def exported(tasks, user=1, verdict='Невозможно определить'):
        return [dict(data=copy.deepcopy(t['data']), annotations=[{
            'completed_by': user, 'was_cancelled': False, 'lead_time': 2.5,
            'result': [{'from_name': 'verdict', 'to_name': 'video',
                        'type': 'choices', 'value': {'choices': [verdict]}}],
        }]) for t in tasks]

    def test_config_matches_transport_labels(self):
        root = ElementTree.parse(
            Path(__file__).resolve().parents[1] /
            'solve4x_c17_labelstudio_config.xml').getroot()
        choices = root.find(".//Choices[@name='verdict'][@toName='video']")
        self.assertIsNotNone(root.find(".//Video[@name='video'][@value='$video']"))
        self.assertIsNotNone(choices)
        self.assertEqual({x.attrib['value'] for x in choices.findall('Choice')},
                         set(ls.CHOICES))

    def test_six_blinded_role_imports(self):
        for role, n in (('reference_a',23),('reference_b',23),
                        ('adjudicator',23),('arm_all',23),
                        ('arm_literal_enter_leave',6),
                        ('arm_reed_closed_after_end_5s',3)):
            tasks = ls.prepare_import(self.packet, role, self.urls,
                                      expected_plan_sha256=self.pin)
            self.assertEqual(len(tasks),n)
            s = json.dumps(tasks)
            for private in ('private-event','private-human','Enter room',
                            'reed_closed_after_end_5s'):
                self.assertNotIn(private,s)
            self.assertTrue(all(set(t)=={'data'} for t in tasks))

    def test_export_to_existing_c17_score_without_inventing_effort(self):
        receipts = {}
        for user,role in enumerate(c17.ROLES,1):
            tasks = ls.prepare_import(self.packet,role,self.urls,
                                      expected_plan_sha256=self.pin)
            receipts[role] = ls.receipt_from_export(
                self.packet,role,tasks,self.exported(tasks,user=user),
                expected_plan_sha256=self.pin)
            self.assertEqual(receipts[role]['reviewer_key'],
                             f'label-studio-user-{user}')
            self.assertTrue(all(x['active_seconds'] is None
                                for x in receipts[role]['items']))
        summary = c17.score(self.packet,receipts)
        self.assertEqual(summary['denominators']['adjudicated_unknown'],23)
        self.assertIsNone(summary['arm_summaries']['all']['reported_active_seconds'])
        self.assertFalse(summary['reviewer_identity_and_independence_verified'])
        self.assertEqual(summary['accepted_tasks'],0)

    def test_external_urls_and_missing_clip_hold(self):
        for url in ('https://example.com/clip.mp4','file:///tmp/clip.mp4',
                    '/data/local-files/?d=../secret.mp4',
                    'http://outside.example/data/local-files/?d=clip.mp4',
                    'http://127.0.0.1/data/local-files/?d=%2e%2e/secret',
                    'http://127.0.0.1/data/local-files/?d=%252e%252e/secret',
                    'http://127.0.0.1/data/local-files/?d=clips/a.mp4&other=1'):
            urls = dict(self.urls)
            urls[self.packet['arms']['all'][0]] = url
            with self.subTest(url=url), self.assertRaisesRegex(
                    c17.ReviewHold,'C17_LS_MEDIA_URL_INVALID'):
                ls.prepare_import(self.packet,'reference_a',urls,
                                  expected_plan_sha256=self.pin)
        urls = dict(self.urls)
        urls.pop(self.packet['arms']['all'][0])
        with self.assertRaisesRegex(c17.ReviewHold,'C17_LS_CLIP_URL_COVERAGE_INVALID'):
            ls.prepare_import(self.packet,'reference_a',urls,
                              expected_plan_sha256=self.pin)

    def test_export_missing_duplicate_and_url_swapped_hold(self):
        tasks = ls.prepare_import(self.packet,'reference_a',self.urls,
                                  expected_plan_sha256=self.pin)
        export = self.exported(tasks)
        for wrong,code in ((export[:-1],'C17_LS_EXPORT_COVERAGE_INCOMPLETE'),
                           (export[:-1]+[copy.deepcopy(export[0])],
                            'C17_LS_EXPORT_BINDING_DRIFT')):
            with self.assertRaisesRegex(c17.ReviewHold,code):
                ls.receipt_from_export(self.packet,'reference_a',tasks,wrong,
                                       expected_plan_sha256=self.pin)
        wrong = copy.deepcopy(export)
        wrong[0]['data']['video'] = tasks[1]['data']['video']
        with self.assertRaisesRegex(c17.ReviewHold,'C17_LS_EXPORT_BINDING_DRIFT'):
            ls.receipt_from_export(self.packet,'reference_a',tasks,wrong,
                                   expected_plan_sha256=self.pin)

    def test_invalid_review_fails_closed(self):
        tasks = ls.prepare_import(self.packet,'reference_a',self.urls,
                                  expected_plan_sha256=self.pin)
        for condition,code in (('cancelled','C17_LS_ANNOTATION_INVALID'),
                               ('prediction','C17_LS_ANNOTATION_REQUIRED'),
                               ('reviewers','C17_LS_MULTIPLE_REVIEWERS_PER_ROLE'),
                               ('choice','C17_LS_VERDICT_INVALID'),
                               ('list','C17_LS_VERDICT_INVALID'),
                               ('time','C17_LS_LEAD_TIME_INVALID')):
            wrong = self.exported(tasks)
            ann = wrong[0]['annotations'][0]
            if condition=='cancelled': ann['was_cancelled']=True
            if condition=='prediction': wrong[0]['predictions']=[{}]
            if condition=='reviewers': ann['completed_by']=88
            if condition=='choice': ann['result'][0]['value']['choices']=['Other']
            if condition=='list': ann['result'][0]['value']['choices']=[[]]
            if condition=='time': ann['lead_time']=float('nan')
            with self.subTest(condition=condition),self.assertRaisesRegex(c17.ReviewHold,code):
                ls.receipt_from_export(self.packet,'reference_a',tasks,wrong,
                                       expected_plan_sha256=self.pin)

    def test_changed_external_plan_pin_holds(self):
        with self.assertRaisesRegex(c17.ReviewHold,'C17_EXTERNAL_PLAN_PIN_MISMATCH'):
            ls.prepare_import(self.packet,'reference_a',self.urls,
                              expected_plan_sha256='0'*64)


if __name__=='__main__':
    unittest.main()
