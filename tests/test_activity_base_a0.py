"""Synthetic-only A0 graph and fail-closed boundary checks."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tools.activity_base_anonymizer import BaselineHold, reconstruct

ROOT = Path(__file__).resolve().parents[1]
RARE = "SYNTH_RARE_PERSON_9b7b6f3e"
SECRET = "SYNTH_SECRET_NEVER_TRANSFER_84d9"


def synthetic_snapshot() -> dict:
    events = []
    traces = {
        "fulfilment": [
            ("new", "coordinator"),
            ("triaged", "reviewer"),
            ("approved", "reviewer"),
            ("in_progress", "worker"),
            ("finished", "worker"),
        ],
        "service": [
            ("new", "coordinator"),
            ("reviewed", "reviewer"),
            ("in_progress", "worker"),
            ("finished", "worker"),
        ],
    }
    for process, steps in traces.items():
        for case_no in range(2):
            for ordinal, (state, role) in enumerate(steps, 1):
                events.append({
                    "subject_scope": "synthetic_subject_a",
                    "case_ref": f"{process}_case_{case_no}",
                    "process_binding": process,
                    "ordinal": ordinal,
                    "state_binding": state,
                    "role_binding": role,
                    "status": "observed",
                    "actor_ref": RARE if case_no == 0 else "SYNTH_ACTOR_2",
                    "payload": {"email": "rare.person@example.invalid",
                                "access_token": SECRET,
                                "business_secret": "SYNTH_PRICE_1234567"},
                    "occurred_at": "2026-10-01T12:01:33.123Z",
                })
    return {
        "schema": "IWXA_SYNTHETIC_A0_SNAPSHOT/0.1",
        "selected_subject": "synthetic_subject_a",
        "events": events,
    }


class ActivityBaseA0Tests(unittest.TestCase):
    def test_two_processes_three_roles_five_states_and_transitions(self):
        result = reconstruct(synthetic_snapshot())
        self.assertEqual(result["role_count"], 3)
        self.assertEqual(len(result["processes"]), 2)
        self.assertEqual({len(p["states"]) for p in result["processes"]}, {4, 5})
        self.assertEqual({len(p["observed_successions"]) for p in result["processes"]}, {3, 4})
        for process in result["processes"]:
            self.assertEqual(process["trace_count"], 2)
            self.assertTrue(all(t["trace_occurrences"] == 2 for t in
                                process["observed_successions"]))
            self.assertTrue(all(t["relation"] == "OBSERVED_ORDER_NOT_CAUSAL_DEPENDENCY"
                                for t in process["observed_successions"]))

    def test_never_release_or_claim_anonymity(self):
        result = reconstruct(synthetic_snapshot())
        self.assertIs(result["anonymous"], False)
        self.assertIs(result["export_allowed"], False)
        self.assertIsNone(result["iwxa_package"])
        self.assertEqual(result["risk_assessment"], "NOT_PERFORMED")
        self.assertEqual(result["provenance_verification"], "NOT_PERFORMED")

    def test_negative_rare_identifiers_payload_secrets_not_copied(self):
        data = synthetic_snapshot()
        output = json.dumps(reconstruct(data), sort_keys=True)
        for raw in (RARE, SECRET, "rare.person@example.invalid", "SYNTH_PRICE_1234567",
                    "coordinator", "reviewer", "worker", "fulfilment", "service",
                    "synthetic_subject_a", "2026-10-01T12:01:33.123Z",
                    "fulfilment_case_0", "approved"):
            self.assertNotIn(raw, output)

    def test_stable_when_event_list_order_changes(self):
        original = synthetic_snapshot()
        shuffled = deepcopy(original)
        shuffled["events"].reverse()
        self.assertEqual(reconstruct(original), reconstruct(shuffled))
        self.assertEqual(reconstruct(original), reconstruct(original))

    def test_source_is_not_mutated(self):
        data = synthetic_snapshot()
        before = deepcopy(data)
        reconstruct(data)
        self.assertEqual(data, before)

    def test_no_cross_subject_link(self):
        data = synthetic_snapshot()
        data["events"][-1]["subject_scope"] = "synthetic_subject_b"
        with self.assertRaisesRegex(BaselineHold, "SUBJECT_SCOPE_VIOLATION"):
            reconstruct(data)

    def test_no_fictional_observed_transition(self):
        data = synthetic_snapshot()
        data["events"][0]["status"] = "inferred"
        with self.assertRaisesRegex(BaselineHold, "NON_OBSERVED_EVENT_REQUIRES_EVIDENCE_REVIEW"):
            reconstruct(data)

    def test_no_guess_for_missing_sequence(self):
        data = synthetic_snapshot()
        data["events"][0]["ordinal"] = 7
        with self.assertRaisesRegex(BaselineHold, "CASE_SEQUENCE_GAP_OR_DUPLICATE"):
            reconstruct(data)

    def test_duplicate_sequence_rejected(self):
        data = synthetic_snapshot()
        data["events"][1]["ordinal"] = 1
        with self.assertRaisesRegex(BaselineHold, "CASE_SEQUENCE_GAP_OR_DUPLICATE"):
            reconstruct(data)

    def test_case_cannot_change_process(self):
        data = synthetic_snapshot()
        data["events"][0]["process_binding"] = "service"
        with self.assertRaisesRegex(BaselineHold, "CASE_PROCESS_CONFLICT"):
            reconstruct(data)

    def test_unknown_real_input_is_rejected(self):
        data = synthetic_snapshot()
        data["schema"] = "REAL_T3_SNAPSHOT"
        with self.assertRaisesRegex(BaselineHold, "UNSUPPORTED_OR_NON_SYNTHETIC_INPUT"):
            reconstruct(data)

    def test_empty_selection_and_missing_subject_rejected(self):
        data = synthetic_snapshot()
        data["events"] = []
        with self.assertRaisesRegex(BaselineHold, "EVENT_SELECTION_INVALID"):
            reconstruct(data)
        data = synthetic_snapshot()
        data.pop("selected_subject")
        with self.assertRaisesRegex(BaselineHold, "SUBJECT_SELECTION_REQUIRED"):
            reconstruct(data)

    def test_malformed_ordinal_or_tag_rejected(self):
        data = synthetic_snapshot()
        data["events"][0]["ordinal"] = True
        with self.assertRaisesRegex(BaselineHold, "EVENT_ORDINAL_INVALID"):
            reconstruct(data)
        data = synthetic_snapshot()
        data["events"][0]["role_binding"] = None
        with self.assertRaisesRegex(BaselineHold, "BOUND_EVENT_FIELDS_REQUIRED"):
            reconstruct(data)

    def test_cli_writes_internal_graph_not_input(self):
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "synthetic.json"
            output_path = Path(directory) / "candidate.json"
            input_path.write_text(json.dumps(synthetic_snapshot()), encoding="utf-8")
            original = input_path.read_bytes()
            result = subprocess.run([
                sys.executable, str(ROOT / "tools/activity_base_anonymizer.py"),
                "--synthetic-a0", "--input", str(input_path), "--output", str(output_path),
            ], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(input_path.read_bytes(), original)
            self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")),
                             reconstruct(synthetic_snapshot()))
            self.assertNotIn(SECRET, output_path.read_text(encoding="utf-8"))

    def test_cli_refuses_to_overwrite_source_or_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "synthetic.json"
            input_path.write_text(json.dumps(synthetic_snapshot()), encoding="utf-8")
            command = [sys.executable, str(ROOT / "tools/activity_base_anonymizer.py"),
                       "--synthetic-a0", "--input", str(input_path), "--output"]
            blocked = subprocess.run(command + [str(input_path)],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(blocked.returncode, 2)
            self.assertIn("HOLD:OUTPUT_COLLIDES_WITH_INPUT", blocked.stderr)
            existing = Path(directory) / "existing.json"
            existing.write_text("KEEP", encoding="utf-8")
            blocked = subprocess.run(command + [str(existing)],
                                     capture_output=True, text=True, check=False)
            self.assertEqual(blocked.returncode, 2)
            self.assertEqual(existing.read_text(encoding="utf-8"), "KEEP")


if __name__ == "__main__":
    unittest.main()
