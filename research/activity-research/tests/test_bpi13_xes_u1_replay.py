"""BPI 2013 XES bridge contract tests: synthetic fixtures, NOT independent case gold."""
from __future__ import annotations

from datetime import datetime, timezone
import gzip
from hashlib import sha1, sha256
import io
import sys
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import bpi13_xes_u1_replay as bridge


def sample_xes(*, missing_timezone=False, duplicate_case=False, wrong_event=False):
    stamp = "2024-02-12T13:14:15" + ("" if missing_timezone else "+01:00")
    bad = "" if wrong_event else '<string key="concept:name" value="Awaiting Assignment"/>'
    first = f"""<trace>
      <string key="concept:name" value="case-alpha"/>
      <event>
        <string key="concept:name" value="Opened"/>
        <date key="time:timestamp" value="{stamp}"/>
      </event>
      <event>
        {bad}
        <date key="time:timestamp" value="2024-02-12T14:14:15+01:00"/>
      </event>
    </trace>"""
    second = first if duplicate_case else """<trace>
      <string key="concept:name" value="case-beta"/>
      <event>
        <string key="concept:name" value="Opened"/>
        <date key="time:timestamp" value="2024-02-12T12:14:15+01:00"/>
      </event>
      <event>
        <string key="concept:name" value="Closed"/>
        <date key="time:timestamp" value="2024-02-12T15:14:15+01:00"/>
      </event>
    </trace>"""
    return ('<?xml version="1.0" encoding="UTF-8"?>'
            '<log xmlns="http://www.xes-standard.org/">' + first + second + '</log>').encode()


def compressed_fixture(raw=None):
    raw = sample_xes() if raw is None else raw
    data = gzip.compress(raw, mtime=0)
    return data


def fixture_pins(data):
    return (patch.object(bridge, "MIRROR_BYTES", len(data)),
            patch.object(bridge, "MIRROR_BLOB", bridge.git_blob(data)))


class XesTests(TestCase):
    def test_pinned_synthetic_xes_parser(self):
        data = compressed_fixture()
        a, b = fixture_pins(data)
        with a, b:
            traces, stats = bridge.parse_xes(data)
        self.assertEqual(stats["recorded_traces"], 2)
        self.assertEqual(stats["registered_events"], 4)
        self.assertEqual(stats["registered_activity_labels"], 3)
        self.assertEqual(len(traces["case-alpha"]), 2)
        self.assertEqual(traces["case-alpha"][1][1], "Awaiting Assignment")

    def test_invalid_sha_rejected(self):
        data = compressed_fixture()
        with self.assertRaisesRegex(bridge.Hold, "BPI_PINNED_MIRROR_GIT_BLOB_MISMATCH"):
            bridge.parse_xes(data)

    def test_timezone_required(self):
        data = compressed_fixture(sample_xes(missing_timezone=True))
        a, b = fixture_pins(data)
        with a, b, self.assertRaisesRegex(bridge.Hold, "XES_TIMESTAMP_TIMEZONE_REQUIRED"):
            bridge.parse_xes(data)

    def test_duplicate_case_rejected(self):
        data = compressed_fixture(sample_xes(duplicate_case=True))
        a, b = fixture_pins(data)
        with a, b, self.assertRaisesRegex(bridge.Hold, "BPI_DUPLICATE_CASE_ID"):
            bridge.parse_xes(data)

    def test_activity_required(self):
        data = compressed_fixture(sample_xes(wrong_event=True))
        a, b = fixture_pins(data)
        with a, b, self.assertRaisesRegex(bridge.Hold, "BPI_ACTIVITY_MISSING"):
            bridge.parse_xes(data)

    def test_dtd_and_entities_rejected(self):
        raw = sample_xes().replace(b"<log ", b'<!DOCTYPE log [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><log ', 1)
        data = compressed_fixture(raw)
        a, b = fixture_pins(data)
        with a, b, self.assertRaisesRegex(bridge.Hold, "BPI_XML_DTD_OR_ENTITY_FORBIDDEN"):
            bridge.parse_xes(data)

    def test_native_pinned_owner_u1_synthetic_end_to_end(self):
        data = compressed_fixture()
        a, b = fixture_pins(data)
        with a, b:
            result = bridge.analyze(data, max_traces=2)
        self.assertEqual(result["sample"]["registered_events"], 4)
        self.assertEqual(result["sample"]["traces"], 2)
        self.assertEqual(result["u1"]["pinned_owner_git_blob"],
                         "eb15aec5ba1a749c29d7c40a868127e1a384b6bf")
        self.assertFalse(result["u1"]["engine_accepted"])
        self.assertEqual(result["qualification"]["task_discovery_quality"], "NOT_MEASURED")
        self.assertFalse(result["sample"]["raw_case_ids_or_actor_ids_exported"])
        self.assertEqual(result["sample"]["real_world_activity_truth"], "UNKNOWN")


if __name__ == "__main__":
    main()
