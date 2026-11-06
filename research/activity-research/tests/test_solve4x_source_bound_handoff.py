import hashlib
import json
import sys
from pathlib import Path
from unittest import TestCase

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_source_bound_handoff as handoff
import solve4x_cross_source_coverage as c12


def event(t, activity, end=None):
    row = {"ocel:timestamp": t, "ocel:activity": activity}
    if end is not None:
        row["ocel:vmap"] = {"end_time": end}
    return row


class SourceBoundHandoff(TestCase):
    def setUp(self):
        self.files = {
            handoff.VIDEO: json.dumps({"ocel:events": {
                "private-video-key": event("2024-03-25T09:00:00", "Enter room",
                                           "2024-03-25T09:00:10")}}).encode(),
            handoff.SENSOR: json.dumps({"ocel:events": {
                "real-key-A": event("2024-03-25T09:00:12", "Door closed"),
                "real-key-B": event("2024-03-25T09:00:22", "Door opened")}}).encode(),
            handoff.UI: (b"timestamp,eventType,context.elementType,url\n"
                         b"2024-03-25T09:00:12.200,click,INPUT,https://private.invalid/a\n"
                         b"2024-03-25T09:00:22.200,typing,TEXTAREA,https://private.invalid/b\n"),
            handoff.REED: (b"time,reed_switch,reed_switch_state\n"
                           b"2024-03-25 09:00:12.100,reed_switch_door,closed\n"
                           b"2024-03-25 09:00:22.100,reed_switch_door,closed\n")}
        self.pins = {k:hashlib.sha256(v).hexdigest() for k,v in self.files.items()}

    def run_packet(self, files=None, pins=None):
        f = files or self.files
        return handoff.prepare_owner_local(
            f[handoff.VIDEO], f[handoff.SENSOR], f[handoff.UI], f[handoff.REED],
            expected_pins=pins or self.pins)

    def test_private_locators_link_to_original_records(self):
        packet = self.run_packet()
        self.assertEqual(len(packet["episodes"]), 2)
        a,b = packet["episodes"]
        self.assertEqual(a["sensor_observation"]["locator"]["source_event_key"],"real-key-A")
        self.assertEqual(b["sensor_observation"]["locator"]["source_event_key"],"real-key-B")
        self.assertEqual(a["raw_reed_candidates_5s"][0]["locator"]["record_number"],1)
        self.assertEqual(b["raw_reed_candidates_5s"][0]["locator"]["record_number"],2)
        self.assertEqual(a["browser_ui_candidates_5s"][0]["locator"]["physical_line_start"],2)
        self.assertEqual(a["author_video_annotation_candidates_5s"][0]["locator"]["source_event_key"],"private-video-key")
        self.assertEqual(packet["video_baseline_counts"],
                         {"all":1,"literal_enter_leave":1,"reed_closed_after_end_5s":1})
        self.assertFalse(packet["same_human_action_confirmed"])
        self.assertEqual(packet["human_gold"],"NOT_MEASURED")
        self.assertEqual(packet["accepted_tasks"],0)

    def test_conflicting_raw_state_does_not_confirm_action(self):
        episode = self.run_packet()["episodes"][1]
        self.assertFalse(episode["raw_reed_candidates_5s"][0]["state_compatible"])
        self.assertEqual(episode["same_human_action"],"UNKNOWN")

    def test_public_projection_only_aggregates(self):
        summary = handoff.public_summary(self.run_packet())
        content = json.dumps(summary)
        for secret in ("real-key", "private-video-key", "private.invalid",
                       "2024-03-25", "09:00:", "TEXTAREA"):
            self.assertNotIn(secret,content)
        self.assertEqual(summary["episode_count"],2)
        self.assertEqual(summary["episodes"][0]["original_source_locator"],"OWNER_LOCAL_REQUIRED")
        self.assertEqual(summary["pin_authority"],"CALLER_SUPPLIED_UNQUALIFIED")
        self.assertFalse(summary["authorized_source_locator_publicly_available"])

    def test_source_drift_and_missing_bytes_hold(self):
        files = dict(self.files)
        files[handoff.UI] += b"x"
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_SOURCE_SHA_HOLD"):
            self.run_packet(files)
        files = dict(self.files)
        files[handoff.REED] = None
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_SOURCE_BYTES_HOLD"):
            self.run_packet(files)

    def test_no_original_ocel_key_holds(self):
        files = dict(self.files)
        files[handoff.SENSOR] = json.dumps({"ocel:events":{
            "":event("2024-03-25T09:00:12","Door closed")}}).encode()
        pins = {k:hashlib.sha256(v).hexdigest() for k,v in files.items()}
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_OCEL_ORIGINAL_LOCATOR_HOLD"):
            self.run_packet(files,pins)

    def test_timezone_and_fake_clock_alignment_do_not_confirm(self):
        files = dict(self.files)
        files[handoff.SENSOR] = json.dumps({"ocel:events":{
            "real-key-A":event("2024-03-25T09:00:12Z","Door closed")}}).encode()
        pins = {k:hashlib.sha256(v).hexdigest() for k,v in files.items()}
        with self.assertRaisesRegex(c12.Hold,"CLOCK_CALIBRATION_UNKNOWN"):
            self.run_packet(files,pins)
        packet = self.run_packet()
        self.assertTrue(all(e["temporal_uncertainty"] == handoff.CLOCK
                            and e["same_human_action"] == "UNKNOWN"
                            for e in packet["episodes"]))

    def test_public_tampered_confirmation_is_rejected(self):
        packet = self.run_packet()
        packet["episodes"][0]["same_human_action"] = "CONFIRMED"
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_UNKNOWN_GUARD"):
            handoff.public_summary(packet)
    def test_locator_roundtrip_and_absent_source(self):
        packet = self.run_packet()
        refs = []
        for episode in packet["episodes"]:
            refs.append(episode["sensor_observation"])
            for k in ("raw_reed_candidates_5s", "browser_ui_candidates_5s",
                      "author_video_annotation_candidates_5s"):
                refs.extend(episode[k])
        self.assertEqual(len(refs), 7)
        for ref in refs:
            receipt = handoff.verify_owner_local_locator(
                self.files[ref["source_member"]],ref,expected_pins=self.pins)
            self.assertEqual(receipt["same_human_action"],"UNKNOWN")
            self.assertFalse(receipt["source_access_permission_attested"])
        self.assertFalse(handoff.public_summary(packet)["original_bytes_sha_verified"])
        self.assertTrue(handoff.public_summary(
            packet,source_files=self.files)["original_bytes_sha_verified"])

    def test_replay_rejects_tampered_sensor_class(self):
        packet = self.run_packet()
        packet["episodes"][0]["sensor_state_class"] = "FORGED"
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_REPLAY_MISMATCH"):
            handoff.public_summary(packet,source_files=self.files)

    def test_missing_locator_stale_csv_line_and_member_hold(self):
        packet = self.run_packet()
        source = packet["episodes"][0]["sensor_observation"]
        bad = {**source, "locator":{"kind":"OCEL_EVENT_KEY","source_event_key":"missing"}}
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_OCEL_EVENT_NOT_FOUND"):
            handoff.verify_owner_local_locator(self.files[handoff.SENSOR],bad,
                                               expected_pins=self.pins)
        row = packet["episodes"][0]["browser_ui_candidates_5s"][0]
        bad = {**row,"locator":{**row["locator"],"physical_line_start":500}}
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_CSV_LOCATOR_STALE"):
            handoff.verify_owner_local_locator(self.files[handoff.UI],bad,
                                               expected_pins=self.pins)
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_LOCATOR_REVISION_HOLD"):
            handoff.verify_owner_local_locator(self.files[handoff.VIDEO],source,
                                               expected_pins=self.pins)

    def test_duplicate_json_event_key_and_invalid_public_metadata_hold(self):
        files = dict(self.files)
        files[handoff.SENSOR] = files[handoff.SENSOR].replace(
            b'"real-key-A":', b'"real-key-A":null,"real-key-A":')
        pins = {k:hashlib.sha256(v).hexdigest() for k,v in files.items()}
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_DUPLICATE_JSON_KEY_HOLD"):
            self.run_packet(files,pins)
        packet = self.run_packet()
        packet["source_sha256"][handoff.UI]="private.example/"
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_PUBLIC_METADATA_HOLD"):
            handoff.public_summary(packet)
        packet = self.run_packet()
        packet["episodes"][0]["review_ordinal_not_original_id"]="private@email"
        with self.assertRaisesRegex(c12.Hold,"HANDOFF_UNKNOWN_GUARD"):
            handoff.public_summary(packet)
