"""Boundary tests and genuine engine integration. No substitute risk or noise engine."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "tools" / "activity-observation-review.py"
SPEC = importlib.util.spec_from_file_location("activity_observation", WORKER)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def payload(request):
    return json.dumps(request, separators=(",", ":")).encode()


def cohort():
    return {"profile": "ACTIVITY_ARX_COHORT_V1", "technology_sha256": "a" * 64,
            "observation_unit": "ORGANIZATION", "source_kind": "DECLARED_MODEL", "k": 2,
            "columns": [{"key": "machine_class",
                         "hierarchy": [["a", "laser"], ["b", "laser"], ["c", "mill"], ["d", "mill"]],
                         "max_level": 1}],
            "rows": [{"unit_id": f"org{i}", "values": [x]} for i, x in enumerate("abcd")]}


def dp_request():
    return {"profile": "ACTIVITY_DP_AGGREGATE_V1", "technology_sha256": "a" * 64,
            "observation_unit": "ORGANIZATION", "source_kind": "DECLARED_EXECUTION",
            "metric": "ACCEPTED_ORDER_COUNT", "public_bound": 20, "epsilon_milli": 500,
            "rows": [{"unit_id": f"org{i}", "value": v} for i, v in enumerate([0, 2, 12, 50])]}


def call(request, engine):
    p = subprocess.run([sys.executable, str(WORKER), "--" + engine], input=payload(request),
                       capture_output=True, timeout=110)
    return p.returncode, json.loads(p.stdout), p.stderr


class Boundary(unittest.TestCase):
    def test_java_21_profile(self):
        self.assertEqual(worker.java_major('openjdk version "21.0.9" 2026-10-20'), 21)
        self.assertEqual(worker.java_major('java version "17.0.16"'), 17)
        self.assertEqual(worker.java_major('unknown runtime'), 0)

    def test_valid_arx(self):
        self.assertEqual(worker.load_request(payload(cohort()), "arx"), cohort())

    def test_valid_dp(self):
        self.assertEqual(worker.load_request(payload(dp_request()), "opendp"), dp_request())

    def test_duplicate_units(self):
        for engine, factory in (("arx", cohort), ("opendp", dp_request)):
            r = factory()
            r["rows"][1]["unit_id"] = r["rows"][0]["unit_id"]
            with self.assertRaisesRegex(worker.Hold, "OBSERVATION_UNIT_INVALID"):
                worker.load_request(payload(r), engine)

    def test_route_revisions_cannot_be_declared_as_units(self):
        r = cohort()
        r["observation_unit"] = "ROUTE_REVISION"
        with self.assertRaisesRegex(worker.Hold, "OBSERVATION_PROFILE_INVALID"):
            worker.load_request(payload(r), "arx")

    def test_hierarchy_missing_value(self):
        r = cohort()
        r["rows"][0]["values"] = ["other"]
        with self.assertRaisesRegex(worker.Hold, "ARX_ROW_INVALID"):
            worker.load_request(payload(r), "arx")

    def test_inconsistent_hierarchy(self):
        r = cohort()
        r["columns"][0]["hierarchy"] = [["a", "group", "root"], ["b", "group", "other"],
                                         ["c", "mill", "root"], ["d", "mill", "root"]]
        with self.assertRaisesRegex(worker.Hold, "ARX_HIERARCHY_INVALID"):
            worker.load_request(payload(r), "arx")

    def test_technical_limits_not_a_statistic(self):
        r = dp_request()
        r["metric"] = "QUALITY_TOLERANCE"
        with self.assertRaisesRegex(worker.Hold, "OPENDP_POLICY_INVALID"):
            worker.load_request(payload(r), "opendp")

    def test_public_bounds_required(self):
        r = dp_request()
        for bad in [0, True, 100001]:
            r["public_bound"] = bad
            with self.assertRaisesRegex(worker.Hold, "OPENDP_POLICY_INVALID"):
                worker.load_request(payload(r), "opendp")

    def test_empty_dp_cohort_is_valid(self):
        r = dp_request()
        r["rows"] = []
        self.assertEqual(worker.load_request(payload(r), "opendp"), r)

    def test_duplicate_json_key(self):
        with self.assertRaisesRegex(worker.Hold, "OBSERVATION_DUPLICATE_KEY"):
            worker.load_request(b'{"profile":1,"profile":2}', "opendp")

    def test_hold_does_not_leak_values(self):
        r = cohort()
        r["rows"][1]["unit_id"] = r["rows"][0]["unit_id"]
        code, result, stderr = call(r, "arx")
        self.assertEqual(code, 2)
        self.assertEqual(result, {"status": "HOLD", "code": "OBSERVATION_UNIT_INVALID",
                                  "anonymity": "NOT_ESTABLISHED", "export_allowed": False, "iwxa_package": None})
        self.assertEqual(stderr, b"")


@unittest.skipUnless(os.environ.get("IWXA_ACTIVITY_REAL_ARX") == "1", "real ARX not selected")
class OriginalArx(unittest.TestCase):
    def test_generalization_and_exact_risk(self):
        r = cohort()
        code, result, stderr = call(r, "arx")
        self.assertEqual(code, 0, result)
        self.assertEqual(result["input_sha256"], hashlib.sha256(payload(r)).hexdigest())
        self.assertEqual(result["row_count"], 4)
        self.assertAlmostEqual(result["before_highest_sample_risk"], 1)
        self.assertAlmostEqual(result["after_highest_sample_risk"], .5)
        self.assertTrue(result["result_available"])
        self.assertEqual(result["levels"], [{"key": "machine_class", "level": 1, "max_level": 1}])
        self.assertFalse(result["export_allowed"])
        self.assertEqual(stderr, b"")

    def test_no_solution_without_changing_protected_column(self):
        r = cohort()
        r["columns"][0]["max_level"] = 0
        code, result, _ = call(r, "arx")
        self.assertEqual(code, 0, result)
        self.assertFalse(result["result_available"])
        self.assertIsNone(result["after_highest_sample_risk"])
        self.assertEqual(result["levels"], [])


@unittest.skipUnless(os.environ.get("IWXA_ACTIVITY_REAL_OPENDP") == "1", "real OpenDP not selected")
class OriginalOpenDP(unittest.TestCase):
    def test_single_bounded_sum(self):
        r = dp_request()
        code, result, _ = call(r, "opendp")
        self.assertEqual(code, 0, result)
        self.assertEqual(result["input_sha256"], hashlib.sha256(payload(r)).hexdigest())
        self.assertEqual(result["version"], "0.16.0")
        self.assertTrue(0 < result["privacy_map_at_one"] <= .5)
        self.assertEqual(result["delta"], 0)
        self.assertGreaterEqual(result["scale"], 40)
        self.assertIsInstance(result["noisy_value"], int)
        self.assertEqual(result["budget_accounting"], "NOT_PERFORMED")
        self.assertFalse(result["export_allowed"])
        self.assertFalse({"row_count", "exact_sum", "rows", "unit_id"} & result.keys())

    def test_count_and_empty_dataset(self):
        r = dp_request()
        r.update(metric="CONTRIBUTING_ORGANIZATIONS", public_bound=1, rows=[])
        code, result, _ = call(r, "opendp")
        self.assertEqual(code, 0, result)
        self.assertTrue(0 < result["privacy_map_at_one"] <= .5)
        self.assertGreaterEqual(result["scale"], 2)
        self.assertIsInstance(result["noisy_value"], int)


if __name__ == "__main__":
    unittest.main()
