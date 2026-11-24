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
WORKER = ROOT / "tools" / "activity-d05-simpy.py"
SPEC = importlib.util.spec_from_file_location("activity_simpy", WORKER)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def retained(field, value):
    return {"field": field, "mode": "RETAIN_DECLARATION", "value": value, "guidance": None}


def operation(key, kind, predecessors, duration):
    return {"operation_id": key, "label": key, "kind": kind, "parallel": False, "milestone": False,
            "predecessors": predecessors, "role": "Functional role", "equipment_requirement": "Functional equipment",
            "material_requirement": "Material per drawing", "parameters": [
                retained("duration", duration), retained("unit", "hours"), retained("setup", "0"), retained("buffer", "0")]}


def fixture():
    candidate = {"status": "LOCAL_CANDIDATE_FOR_DISCLOSURE_REVIEW", "export_allowed": False,
                 "anonymity": "NOT_ESTABLISHED", "domain_validation": "NOT_PERFORMED",
                 "disclosure_review": "NOT_PERFORMED", "iwxa_package": None,
                 "technology": {"terms": {"purpose": "Cut and inspect"},
                                "route_parameters": [retained("hoursPerDay", "8")],
                                "operations": [operation("cut", "internal", [], "1"),
                                               operation("inspect", "inspection", ["cut"], "0.5")],
                                "quality_checks": [{"check_id": "qc1", "title": "Dimension", "operation_id": "inspect",
                                                    "control_type": "after-op", "responsible_role": "Inspector",
                                                    "declared_fields": [{"field": "upper_limit", "value": "0.2"}]}]}}
    base = {"hours_per_day": "8", "other_cost_minor_per_order": 300,
            "resources": [{"key": "laser", "capacity": 1, "rate_minor_per_minute": 100},
                          {"key": "qc", "capacity": 1, "rate_minor_per_minute": 50}],
            "operations": [{"operation_id": "cut", "duration": "1", "unit": "hours",
                            "setup_hours": "0", "buffer_hours": "0", "resource_key": "laser"},
                           {"operation_id": "inspect", "duration": "0.5", "unit": "hours",
                            "setup_hours": "0", "buffer_hours": "0", "resource_key": "qc"}]}
    recipient = copy.deepcopy(base)
    recipient["resources"][0]["capacity"] = 2
    return {"profile": worker.PROFILE, "candidate": candidate, "arrival_minutes": [0, 0],
            "deadline_after_minutes": 120, "buffer_policy": "RELEASE_RESOURCE_DURING_BUFFER", "currency": "RUB",
            "baseline": base, "recipient": recipient}


def payload(request):
    return json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def call(request):
    p = subprocess.run([sys.executable, str(WORKER)], input=payload(request), capture_output=True, timeout=30)
    return p.returncode, json.loads(p.stdout), p.stderr


class Boundaries(unittest.TestCase):
    def test_explicit_scenario(self):
        req, tech, nodes, baseline, recipient = worker.load(payload(fixture()))
        self.assertEqual(len(nodes), 2)
        self.assertEqual(baseline[1]["cut"]["duration"], 60)
        self.assertEqual(recipient[0]["laser"]["capacity"], 2)

    def test_retained_conditions_cannot_be_shortened(self):
        r = fixture()
        r["recipient"]["operations"][0]["duration"] = "0.5"
        with self.assertRaisesRegex(worker.Hold, "SIMPY_RETAINED_PARAMETER_CHANGED"):
            worker.load(payload(r))

    def test_parameterized_duration_can_be_adapted(self):
        r = fixture()
        r["candidate"]["technology"]["operations"][0]["parameters"][0] = {
            "field": "duration", "mode": "PARAMETERIZE", "value": None, "guidance": "Measure on recipient equipment"}
        r["recipient"]["operations"][0]["duration"] = "0.5"
        self.assertEqual(worker.load(payload(r))[4][1]["cut"]["duration"], 30)

    def test_original_d05_unit_semantics(self):
        r = fixture()
        op = r["candidate"]["technology"]["operations"][0]
        op["parameters"][1] = retained("unit", "work-days")
        for scenario in (r["baseline"], r["recipient"]):
            scenario["operations"][0]["unit"] = "work-days"
        self.assertEqual(worker.load(payload(r))[3][1]["cut"]["duration"], 480)

    def test_no_implicit_calendar_or_resource(self):
        r = fixture()
        r["recipient"]["hours_per_day"] = "12"
        with self.assertRaisesRegex(worker.Hold, "SIMPY_RETAINED_PARAMETER_CHANGED"):
            worker.load(payload(r))
        r = fixture()
        r["recipient"]["operations"][0]["resource_key"] = None
        with self.assertRaisesRegex(worker.Hold, "SIMPY_RESOURCE_UNASSIGNED"):
            worker.load(payload(r))

    def test_graph_cycle(self):
        r = fixture()
        r["candidate"]["technology"]["operations"][0]["predecessors"] = ["inspect"]
        with self.assertRaisesRegex(worker.Hold, "SIMPY_CANDIDATE_CYCLE"):
            worker.load(payload(r))

    def test_no_skipped_operations(self):
        r = fixture()
        r["recipient"]["operations"].pop()
        with self.assertRaisesRegex(worker.Hold, "SIMPY_SCENARIO_PROFILE"):
            worker.load(payload(r))

    def test_no_accepted_execution_claim(self):
        r = fixture()
        r["candidate"]["domain_validation"] = "ACCEPTED"
        code, result, err = call(r)
        self.assertEqual(code, 2)
        self.assertEqual(result["code"], "SIMPY_CANDIDATE_PROFILE")
        self.assertEqual(err, b"")


@unittest.skipUnless(os.environ.get("IWXA_ACTIVITY_REAL_SIMPY") == "1", "real SimPy not selected")
class OriginalSimPy(unittest.TestCase):
    def test_capacity_alternative_keeps_technology_and_quality(self):
        r = fixture()
        code, out, err = call(r)
        self.assertEqual(code, 0, out)
        self.assertEqual(err, b"")
        self.assertEqual(out["input_sha256"], hashlib.sha256(payload(r)).hexdigest())
        self.assertEqual(out["technology_sha256"], hashlib.sha256(worker.canonical(r["candidate"]["technology"])).hexdigest())
        self.assertEqual(out["quality_checks_count"], 1)
        self.assertEqual(out["evidence"], "MODEL_NOT_EXECUTION")
        self.assertFalse(out["export_allowed"])
        base, recipient = out["baseline"], out["recipient"]
        self.assertEqual([o["completion_minutes"] for o in base["orders"]], [90, 150])
        self.assertEqual([o["completion_minutes"] for o in recipient["orders"]], [90, 120])
        self.assertEqual(base["on_time_model_orders"], 1)
        self.assertEqual(recipient["on_time_model_orders"], 2)
        self.assertEqual(base["sum_queue_minutes"], 60)
        self.assertEqual(recipient["sum_queue_minutes"], 30)
        self.assertEqual(base["declared_total_cost_minor"], 15600)
        self.assertEqual(recipient["declared_total_cost_minor"], 15600)

    def test_buffer_resource_policy_is_explicit(self):
        r = fixture()
        r["candidate"]["technology"]["operations"][0]["parameters"][3] = retained("buffer", "0.5")
        for scenario in (r["baseline"], r["recipient"]):
            scenario["operations"][0]["buffer_hours"] = "0.5"
        released = worker.run(payload(r))
        r["buffer_policy"] = "HOLD_RESOURCE_DURING_BUFFER"
        held = worker.run(payload(r))
        self.assertGreater(held["baseline"]["elapsed_minutes"], released["baseline"]["elapsed_minutes"])
        self.assertGreater(held["baseline"]["resource_cost_minor"], released["baseline"]["resource_cost_minor"])

    def test_deterministic_repeat(self):
        r = fixture()
        self.assertEqual(worker.run(payload(r)), worker.run(payload(r)))


if __name__ == "__main__":
    unittest.main()
