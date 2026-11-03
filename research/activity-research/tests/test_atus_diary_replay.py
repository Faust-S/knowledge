"""Offline synthetic contract tests for a *real-corpus* adapter; not independent field data."""
import csv
from datetime import date
import hashlib
import io
import json
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from atus_diary_replay import analyze, select_csv, eligible_diaries, Hold

HEADER = ["TUCASEID", "TUACTIVITY_N", "TUACTDUR24",
          "TUTIER1CODE", "TUTIER2CODE", "TUTIER3CODE"]
GOOD_1 = [
    ["20250101000011", 1, 420, "01", "01", "01"],
    ["20250101000011", 2, 60, "18", "01", "01"],
    ["20250101000011", 3, 540, "05", "01", "01"],
    ["20250101000011", 4, 420, "01", "01", "01"]
]
GOOD_2 = [
    ["20250101000012", 1, 840, "01", "01", "01"],
    ["20250101000012", 2, 600, "12", "01", "01"],
]
BAD = [
    ["20250101000013", 1, 25, "01", "01", "01"],
    ["20250101000013", 2, 25, "01", "01", "01"],
]


def make_zip(rows, header=HEADER, filename="atusact_2025.dat"):
    buff = io.StringIO()
    writer = csv.writer(buff, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(filename, buff.getvalue())
    return output.getvalue()


class U1Stub:
    VERSION = "IWXA_ENGINE_UNIVERSAL_EVIDENCE/0.1"

    @staticmethod
    def inspect(raw, manifest, *, today=None):
        assert manifest["sha256"] == hashlib.sha256(raw).hexdigest()
        assert manifest["kind"] == "EVENT_LOG_JSONL"
        lines = raw.decode("utf-8").splitlines()
        data = [json.loads(line) for line in lines]
        assert len({e["event_id"] for e in data}) == len(data)
        assert all(e["attributes"]["epistemic"] ==
                   "SURVEY_REPORTED_CODED_NOT_DIRECT_OBSERVATION" for e in data)
        assert all(e["attributes"]["goal"] == "UNKNOWN" for e in data)
        assert all(not e["case_id"].isdigit() for e in data)
        return {
            "schema": U1Stub.VERSION,
            "unit_count": len(data),
            "units": [{
                "kind": "RawEvent",
                "evidence_strength": "REPORTED_EVENT_IN_UNVERIFIED_LOG",
                "process_context": {
                    "scope": "REPORTED_CASE_SEQUENCE_NOT_VERIFIED_EXECUTION"
                },
            } for _ in data],
            "source": {"id": "ESRC-SYNTHETIC-CONTRACT",
                       "source_origin": "LOCALLY_SUPPLIED_ORIGIN_NOT_INDEPENDENTLY_VERIFIED"},
            "task_type_ids_assigned": 0,
            "engine_accepted": False
        }


def stub_loader():
    return U1Stub, "eb15aec5ba1a749c29d7c40a868127e1a384b6bf"


class ATUSTests(unittest.TestCase):

    def test_deterministic_complete_diaries_to_u1(self):
        payload = make_zip(GOOD_1 + BAD + GOOD_2)
        result = analyze(payload, max_diaries=2, u1_loader=stub_loader)
        self.assertEqual(result["projection"]["sample_diaries"], 2)
        self.assertEqual(result["projection"]["u1_reported_events"], 6)
        self.assertEqual(result["stats"]["complete_24h_diary_cases"], 2)
        self.assertEqual(result["stats"]["source_csv_rows"], 8)
        self.assertEqual(result["projection"]["input_jsonl_sha256"],
                         analyze(payload, max_diaries=2, u1_loader=stub_loader)["projection"]["input_jsonl_sha256"])
        self.assertFalse(result["u1"]["engine_accepted"])
        self.assertFalse(result["projection"]["reported_behavior_is_direct_observation"])
        self.assertEqual(result["qualification"]["real_world_task_discovery"], "NOT_MEASURED")

    def test_exact_zip_sha_enforced(self):
        payload = make_zip(GOOD_1 + GOOD_2)
        got = analyze(payload, expected_zip_sha256=hashlib.sha256(payload).hexdigest(),
                      u1_loader=stub_loader)
        self.assertTrue(got["origin"]["pinned_source_sha_verified"])
        with self.assertRaisesRegex(Hold, "ATUS_SOURCE_SHA_MISMATCH"):
            analyze(payload, expected_zip_sha256="0" * 64, u1_loader=stub_loader)

    def test_reject_ambiguous_member(self):
        payload = io.BytesIO()
        with ZipFile(payload, "w") as z:
            z.writestr("atusact-2025.csv", "a")
            z.writestr("atusact_2025.dat", "b")
        with self.assertRaisesRegex(Hold, "ATUS_ACTIVITY_MEMBER_MISSING_OR_AMBIGUOUS"):
            select_csv(payload.getvalue())

    def test_reject_missing_required_columns(self):
        payload = make_zip(GOOD_1, header=HEADER[:-1])
        with self.assertRaisesRegex(Hold, "ATUS_REQUIRED_COLUMNS_MISSING_OR_DUPLICATE"):
            analyze(payload, u1_loader=stub_loader)

    def test_reject_unusable_diaries_and_invalid_sample(self):
        payload = make_zip(BAD)
        with self.assertRaisesRegex(Hold, "ATUS_NO_COMPLETE_DIARIES"):
            analyze(payload, u1_loader=stub_loader)
        with self.assertRaisesRegex(Hold, "ATUS_SAMPLE_SIZE_INVALID"):
            analyze(make_zip(GOOD_1), max_diaries=17, u1_loader=stub_loader)

    def test_source_and_events_are_bounded(self):
        payload = make_zip(GOOD_1 + GOOD_2)
        got = analyze(payload, u1_loader=stub_loader)
        self.assertFalse(got["projection"]["sampled_case_ids_exported"])
        self.assertFalse(got["projection"]["raw_activity_rows_exported"])
        self.assertEqual(got["u1"]["evidence_strength"], "REPORTED_EVENT_IN_UNVERIFIED_LOG")


if __name__ == "__main__":
    unittest.main()
