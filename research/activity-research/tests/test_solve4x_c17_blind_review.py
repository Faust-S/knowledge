import copy
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
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

    def test_tampered_blind_tasks_hold_before_scoring(self):
        bad = copy.deepcopy(self.packet)
        bad['blind_tasks']['arm_all'][0]['clip_id'] = 'clip-9999'
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_BLIND_TASKS_DRIFT'):
            c17.public_plan(bad)
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_BLIND_TASKS_DRIFT'):
            c17.score(bad, self.receipts())
        bad = copy.deepcopy(self.packet)
        bad['blind_tasks']['reference_a'][0]['media_locator'] = 'private.invalid'
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_BLIND_TASKS_DRIFT'):
            c17.blank_receipt(bad, 'reference_a')
        bad = copy.deepcopy(self.packet)
        bad['blind_tasks'].pop('adjudicator')
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_BLIND_TASKS_DRIFT'):
            c17.public_plan(bad)

    def test_c17_does_not_self_attest_unchecked_source_bytes(self):
        self.assertFalse(c17.public_plan(self.packet)['source_bytes_verified_by_c17'])

    def test_external_plan_pin_rejects_stale_or_invalid_value(self):
        self.assertTrue(c17.require_precommitted_plan(
            self.packet, self.packet['plan_sha256']))
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_EXTERNAL_PLAN_PIN_INVALID'):
            c17.require_precommitted_plan(self.packet, 'not-a-sha')
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_EXTERNAL_PLAN_PIN_MISMATCH'):
            c17.require_precommitted_plan(self.packet, '0' * 64)

    def test_owner_cli_requires_frozen_plan_sha(self):
        # Synthetic transport only, not human reviews or video access.
        with tempfile.TemporaryDirectory(prefix='c17-owner-') as tmp:
            root = Path(tmp)
            packet_path, receipts_path = root / 'packet.json', root / 'receipts.json'
            packet_path.write_text(json.dumps(self.packet), encoding='utf-8')
            receipts_path.write_text(json.dumps(self.receipts()), encoding='utf-8')
            pin = self.packet['plan_sha256']
            for command in ('blank', 'score'):
                out = root / (command + '.json')
                args = [command, '--packet', str(packet_path)]
                if command == 'score':
                    args += ['--receipts', str(receipts_path)]
                args += ['--out', str(out)]
                with redirect_stderr(StringIO()):
                    with self.assertRaises(SystemExit) as err:
                        c17.main(args)
                self.assertEqual(err.exception.code, 2)
                self.assertFalse(out.exists())
                with self.assertRaisesRegex(
                        c17.ReviewHold, 'C17_EXTERNAL_PLAN_PIN_MISMATCH'):
                    c17.main(args + ['--expected-plan-sha256', '0' * 64])
                self.assertFalse(out.exists())
                stdout = StringIO()
                with redirect_stdout(stdout):
                    self.assertIsNone(c17.main(
                        args + ['--expected-plan-sha256', pin]))
                self.assertTrue(out.is_file())
                meta = json.loads(stdout.getvalue())
                self.assertEqual(meta['frozen_plan_sha256'], pin)
                self.assertTrue(meta['external_plan_pin_matched'])
                self.assertFalse(meta['source_video_review_or_human_gold_attested'])
                if command == 'score':
                    score = json.loads(out.read_text(encoding='utf-8'))
                    self.assertFalse(score['reviewer_identity_and_independence_verified'])
                else:
                    self.assertIsNone(json.loads(out.read_text())['reference_a']['reviewer_key'])
                self.assertNotIn('private-reviewer', stdout.getvalue())


    def _refingerprint(self, packet):
        frozen = {k: packet[k] for k in (
            'source_sha256', 'context_seconds', 'owner_index', 'arms')}
        packet['plan_sha256'] = c17._digest(frozen)
        return packet

    def test_malformed_private_owner_packet_holds_without_python_traceback(self):
        # Recompute the digest to reach structural validation, not only hash drift.
        bad = copy.deepcopy(self.packet)
        bad['owner_index'][0] = None
        self._refingerprint(bad)
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_PACKET_INDEX_INVALID'):
            c17.public_plan(bad)
        bad = copy.deepcopy(self.packet)
        bad['owner_index'][0].pop('selected_in')
        self._refingerprint(bad)
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_PACKET_INDEX_INVALID'):
            c17.blank_receipt(bad, 'reference_a')
        bad = copy.deepcopy(self.packet)
        bad['owner_index'][0]['selected_in'] = [['all']]
        self._refingerprint(bad)
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_PACKET_INDEX_INVALID'):
            c17.score(bad, self.receipts())
        bad = copy.deepcopy(self.packet)
        bad['owner_index'][0]['source_event_key'] = []
        self._refingerprint(bad)
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_PACKET_INDEX_INVALID'):
            c17.public_plan(bad)
        bad = copy.deepcopy(self.packet)
        bad['arms']['literal_enter_leave'] = [dict(unhashable=True)]
        self._refingerprint(bad)
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_PACKET_ARMS_INVALID'):
            c17.public_plan(bad)
        bad = copy.deepcopy(self.packet)
        bad['owner_index'][0]['annotation_start'] = float('nan')
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_FROZEN_PLAN_INVALID'):
            c17.public_plan(bad)

    def test_owner_cli_malformed_packet_rejected_before_any_output(self):
        with tempfile.TemporaryDirectory(prefix='c17-invalid-packet-') as tmp:
            root = Path(tmp)
            packet_path, output_path = root / 'packet.json', root / 'blank.json'
            bad = copy.deepcopy(self.packet)
            bad['owner_index'][0]['selected_in'] = None
            self._refingerprint(bad)
            packet_path.write_text(json.dumps(bad), encoding='utf-8')
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_PACKET_INDEX_INVALID'):
                c17.main(['blank', '--packet', str(packet_path),
                          '--expected-plan-sha256', bad['plan_sha256'],
                          '--out', str(output_path)])
            self.assertFalse(output_path.exists())

    def test_media_window_screen_is_aggregate_only_and_clock_unknown(self):
        # Start is a hypothetical metadata origin, NOT a calibrated clock.
        public = c17.public_media_window_sanity(
            self.packet, assumed_scene_start='2024-03-25T08:29:58',
            declared_media_duration_seconds=228.0)
        self.assertEqual(public['method_window_counts']['all']['selected_annotations'], 23)
        self.assertEqual(public['method_window_counts']['literal_enter_leave']['selected_annotations'], 6)
        self.assertEqual(public['method_window_counts']['reed_closed_after_end_5s']['selected_annotations'], 3)
        self.assertEqual(public['method_window_counts']['all']['outside_declared_video_bounds'], 1)
        self.assertEqual(public['method_window_counts']['reed_closed_after_end_5s']['outside_declared_video_bounds'], 0)
        self.assertEqual(public['max_trailing_overhang_seconds'], 1.0)
        self.assertEqual(public['max_leading_overhang_seconds'], 0.0)
        self.assertEqual(public['status'],
                         'PUBLISHED_MEDIA_METADATA_WINDOW_SCREEN_NOT_VIDEO_ALIGNMENT')
        for flag in ('media_video_bytes_verified',
                     'camera_frame_to_ocel_clock_calibrated',
                     'camera_origin_independently_attested',
                     'original_media_permissions_attested',
                     'video_clips_prepared_or_reviewed', 'ready_for_human_review',
                     'source_event_ids_timestamps_and_media_paths_exported'):
            self.assertFalse(public[flag])
        self.assertEqual(public['independent_human_gold'], 'NOT_MEASURED')
        self.assertEqual(public['accepted_tasks'], 0)
        text = json.dumps(public)
        for sensitive in ('private-source', 'secret-actor', '2024-03-25', 'clip-0001'):
            self.assertNotIn(sensitive, text)

    def test_media_window_screen_includes_boundary_context(self):
        result = c17.public_media_window_sanity(
            self.packet, assumed_scene_start='2024-03-25T08:30:00',
            declared_media_duration_seconds=235.0)
        self.assertEqual(result['max_leading_overhang_seconds'], 2)
        self.assertEqual(result['method_window_counts']['all']['leading_context_outside_bounds'], 1)
        self.assertEqual(result['method_window_counts']['all']['trailing_context_outside_bounds'], 0)
        self.assertEqual(result['method_window_counts']['all']['outside_declared_video_bounds'], 1)

    def test_media_window_invalid_origin_or_duration_holds(self):
        for bad in (None, float('nan'), float('inf'), -1, 0, 86401, True):
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_DURATION_INVALID'):
                c17.public_media_window_sanity(
                    self.packet, assumed_scene_start='2024-03-25T08:30:00',
                    declared_media_duration_seconds=bad)
        for origin in ('2024-03-25T08:30:00Z', '', 'not-a-time', None):
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_ASSUMED_ORIGIN_INVALID'):
                c17.public_media_window_sanity(
                    self.packet, assumed_scene_start=origin,
                    declared_media_duration_seconds=392.166667)

    def test_media_window_invalid_owner_annotation_holds(self):
        altered = copy.deepcopy(self.packet)
        altered['owner_index'][0]['annotation_end'] = '2024-03-25T08:29:59'
        altered['plan_sha256'] = c17._digest({
            name: altered[name] for name in
            ('source_sha256', 'context_seconds', 'owner_index', 'arms')})
        with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_ANNOTATION_INTERVAL_INVALID'):
            c17.public_media_window_sanity(
                altered, assumed_scene_start='2024-03-25T08:30:00',
                declared_media_duration_seconds=392.166667)

    def test_owner_media_verification_uses_real_ffprobe_and_bounded_bytes(self):
        import hashlib
        import shutil
        import subprocess
        import zlib
        if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
            self.skipTest('ffmpeg and ffprobe not installed')
        with tempfile.TemporaryDirectory(prefix='c17-media-local-') as tmp:
            root = Path(tmp)
            video_path = root / 'synthetic.mp4'
            build = subprocess.run(
                ['ffmpeg', '-hide_banner', '-loglevel', 'error',
                 '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30',
                 '-t', '2', '-an', '-c:v', 'mpeg4', '-y', str(video_path)],
                capture_output=True, timeout=35, check=False)
            self.assertEqual(build.returncode, 0,
                             'synthetic ffmpeg fixture failed')
            data = video_path.read_bytes()
            index = {
                'schema': 'IWXA_SOLVE4X_ZIP_RANGE_INDEX/0.1',
                'status': 'ZIP_RANGE_INDEX_ONLY_NOT_MULTIMODAL_REPLAY',
                'source': {'central_sha256': c17.SOLVE4X_ZIP_CENTRAL_SHA256},
                'target_files': [{
                    'name': 'scene01/scene01.mp4',
                    'compression_method': 8,
                    'uncompressed_bytes': len(data),
                    'zip_crc32': f'{zlib.crc32(data):08x}',
                }],
            }
            # Synthetic MP4 has different bytes from the pinned Solve4X
            # archive. Override the real immutable member only in this test.
            synthetic_pin = {
                **index['target_files'][0],
                'compressed_bytes': 1000,
                'zip_local_header_offset': 12345,
            }
            index['target_files'][0].update({
                'compressed_bytes': 1000,
                'zip_local_header_offset': 12345,
            })
            patcher = patch.object(c17, 'SOLVE4X_SCENE01_MP4_PIN',
                                   synthetic_pin)
            patcher.start()
            self.addCleanup(patcher.stop)
            pin = self.packet['plan_sha256']
            def check(**kwargs):
                return c17.verify_owner_local_media(
                    self.packet, video_path, index,
                    expected_plan_sha256=pin,
                    assumed_scene_start='2024-03-25T08:29:58',
                    declared_video_duration_seconds=2.0, **kwargs)
            valid = check(expected_media_sha256=hashlib.sha256(data).hexdigest())
            self.assertTrue(valid['matches_explicitly_supplied_media_sha256'])
            self.assertTrue(valid['matches_pinned_zip_index_size_and_crc'])
            self.assertEqual(valid['ffprobe_duration_seconds'], 2.0)
            self.assertFalse(valid['archive_content_sha_independently_attested'])
            self.assertFalse(valid['media_to_ocel_clock_calibrated'])
            self.assertFalse(valid['media_permissions_attested'])
            self.assertFalse(valid['ready_for_human_review'])
            self.assertEqual(valid['human_gold'], 'NOT_MEASURED')
            self.assertNotIn(str(video_path), json.dumps(valid))
            unpinned = check()
            self.assertFalse(unpinned['matches_explicitly_supplied_media_sha256'])
            altered = copy.deepcopy(index)
            altered['source']['central_sha256'] = '0' * 64
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_INDEX_NOT_PINNED'):
                c17.verify_owner_local_media(
                    self.packet, video_path, altered,
                    expected_plan_sha256=pin,
                    assumed_scene_start='2024-03-25T08:29:58',
                    declared_video_duration_seconds=2.0)
            altered = copy.deepcopy(index)
            altered['target_files'][0]['zip_crc32'] = '00000000'
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_MEMBER_PIN_DRIFT'):
                c17.verify_owner_local_media(
                    self.packet, video_path, altered,
                    expected_plan_sha256=pin,
                    assumed_scene_start='2024-03-25T08:29:58',
                    declared_video_duration_seconds=2.0)
            altered = copy.deepcopy(index)
            altered['target_files'][0]['uncompressed_bytes'] = 1
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_MEMBER_PIN_DRIFT'):
                c17.verify_owner_local_media(
                    self.packet, video_path, altered,
                    expected_plan_sha256=pin,
                    assumed_scene_start='2024-03-25T08:29:58',
                    declared_video_duration_seconds=2.0)
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_SHA_MISMATCH'):
                check(expected_media_sha256='0' * 64)
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_DECLARED_DURATION_DRIFT'):
                c17.verify_owner_local_media(
                    self.packet, video_path, index,
                    expected_plan_sha256=pin,
                    assumed_scene_start='2024-03-25T08:29:58',
                    declared_video_duration_seconds=3.0)
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_EXTERNAL_PLAN_PIN_MISMATCH'):
                c17.verify_owner_local_media(
                    self.packet, video_path, index,
                    expected_plan_sha256='0' * 64,
                    assumed_scene_start='2024-03-25T08:29:58',
                    declared_video_duration_seconds=2.0)
            link = root / 'link.mp4'
            link.symlink_to(video_path)
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_PATH_INVALID'):
                c17.verify_owner_local_media(
                    self.packet, link, index,
                    expected_plan_sha256=pin,
                    assumed_scene_start='2024-03-25T08:29:58',
                    declared_video_duration_seconds=2.0)
            with self.assertRaisesRegex(c17.ReviewHold, 'C17_MEDIA_SOURCE_UNAVAILABLE'):
                c17.verify_owner_local_media(
                    self.packet, root / 'missing.mp4', index,
                    expected_plan_sha256=pin,
                    assumed_scene_start='2024-03-25T08:29:58',
                    declared_video_duration_seconds=2.0)

    def test_owner_media_rejects_path_replacement_between_hash_and_ffprobe(self):
        import hashlib
        import os
        import shutil
        import subprocess
        import zlib
        from unittest.mock import patch

        if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
            self.skipTest('ffmpeg and ffprobe not installed')
        with tempfile.TemporaryDirectory(prefix='c17-media-race-') as tmp:
            root = Path(tmp)
            media = root / 'original.mp4'
            replacement = root / 'replacement.mp4'
            for path, color in ((media, 'black'), (replacement, 'white')):
                run = subprocess.run(
                    ['ffmpeg', '-hide_banner', '-loglevel', 'error',
                     '-f', 'lavfi', '-i',
                     f'color=c={color}:s=160x90:r=30',
                     '-t', '2', '-an', '-c:v', 'mpeg4',
                     '-y', str(path)],
                    capture_output=True, timeout=35, check=False)
                self.assertEqual(run.returncode, 0)
            original = media.read_bytes()
            self.assertNotEqual(
                hashlib.sha256(original).hexdigest(),
                hashlib.sha256(replacement.read_bytes()).hexdigest())
            index = {
                'schema': 'IWXA_SOLVE4X_ZIP_RANGE_INDEX/0.1',
                'status': 'ZIP_RANGE_INDEX_ONLY_NOT_MULTIMODAL_REPLAY',
                'source': {'central_sha256': c17.SOLVE4X_ZIP_CENTRAL_SHA256},
                'target_files': [{
                    'name': 'scene01/scene01.mp4',
                    'compression_method': 8,
                    'uncompressed_bytes': len(original),
                    'zip_crc32': f'{zlib.crc32(original):08x}',
                }],
            }
            synthetic_pin = {
                **index['target_files'][0],
                'compressed_bytes': 1000,
                'zip_local_header_offset': 12345,
            }
            index['target_files'][0].update({
                'compressed_bytes': 1000,
                'zip_local_header_offset': 12345,
            })
            patcher = patch.object(c17, 'SOLVE4X_SCENE01_MP4_PIN',
                                   synthetic_pin)
            patcher.start()
            self.addCleanup(patcher.stop)
            actual_run = subprocess.run

            def replace_during_probe(*args, **kwargs):
                os.replace(replacement, media)
                return actual_run(*args, **kwargs)

            with patch('subprocess.run', side_effect=replace_during_probe):
                with self.assertRaisesRegex(
                        c17.ReviewHold, 'C17_MEDIA_SOURCE_CHANGED'):
                    c17.verify_owner_local_media(
                        self.packet, media, index,
                        expected_plan_sha256=self.packet['plan_sha256'],
                        expected_media_sha256=hashlib.sha256(original).hexdigest(),
                        assumed_scene_start='2024-03-25T08:29:58',
                        declared_video_duration_seconds=2.0)

    def test_original_solve4x_member_is_pinned_independently_of_json_claims(self):
        # Fixture confirmed in two separate pinned ZIP-range Action artifacts.
        pin = c17.SOLVE4X_SCENE01_MP4_PIN
        self.assertEqual(pin, {
            'name': 'scene01/scene01.mp4',
            'compressed_bytes': 86978890,
            'uncompressed_bytes': 87053127,
            'compression_method': 8,
            'zip_crc32': '81b9100c',
            'zip_local_header_offset': 13914870,
        })
        index = {
            'schema': 'IWXA_SOLVE4X_ZIP_RANGE_INDEX/0.1',
            'status': 'ZIP_RANGE_INDEX_ONLY_NOT_MULTIMODAL_REPLAY',
            'source': {'central_sha256': c17.SOLVE4X_ZIP_CENTRAL_SHA256},
            'target_files': [dict(pin)],
        }
        with tempfile.TemporaryDirectory(prefix='c17-original-pin-') as tmp:
            missing = Path(tmp) / 'not-a-real-video.mp4'

            def check(value):
                return c17.verify_owner_local_media(
                    self.packet, missing, value,
                    expected_plan_sha256=self.packet['plan_sha256'],
                    assumed_scene_start='2024-03-25T08:48:23',
                    declared_video_duration_seconds=392.166667)

            # A real pinned index passes member validation before the local
            # media absence is reported. Do not fabricate an original MP4.
            with self.assertRaisesRegex(
                    c17.ReviewHold, 'C17_MEDIA_SOURCE_UNAVAILABLE'):
                check(index)
            for key, forged_value in (
                    ('uncompressed_bytes', 60000),
                    ('compressed_bytes', 20),
                    ('zip_crc32', '00000001'),
                    ('zip_local_header_offset', 12),
                    ('compression_method', 0),
                    ('name', 'scene01/scene01.mp4.replacement'),
                    ):
                forged = copy.deepcopy(index)
                forged['target_files'][0][key] = forged_value
                expected = ('C17_MEDIA_ZIP_MEMBER_UNRESOLVED' if key == 'name'
                            else 'C17_MEDIA_MEMBER_PIN_DRIFT')
                with self.subTest(key=key):
                    with self.assertRaisesRegex(c17.ReviewHold, expected):
                        check(forged)

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
